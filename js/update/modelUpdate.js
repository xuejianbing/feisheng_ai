/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 模型权重在线更新（宿主编排层） =================
 * 职责：把「扩展整包更新」与「模型权重更新」彻底分开。
 *  - 本模块只更新模型参数数据，绝不下载/解压/覆盖扩展文件；
 *  - 判新旧一律比较模型权重版本（releaseSeq），不再拿扩展版本与服务器扩展版本混判；
 *  - 扩展版本只用于「兼容性」判断（新权重要求的扩展区间）。
 *
 * 分层：本文件是宿主接入层（网络 / 存储 / 弹窗 / 对局状态）；
 *  纯数据契约与版本口径在 weightBundle.js，安全应用与回滚在 applyWeights.js。
 *
 * 存储隔离（只新增下列键，绝不触碰既有存档）：
 *   djsc_official_weights_v1  已应用的官方权重记录
 *   djsc_model_update_pending_v1 待生效（对局中/训练中延迟应用）
 *   djsc_weights_backup_v1    应用官方权重前的活跃权重备份
 *   沿用 djsc_update_check_ts 作为 6 小时节流（保持节流连续性）
 * 绝不触碰：djsc_weights_v3（活跃权重存档，仅通过 weights.js 的公开接口读写）、
 *   djsc_model_state（A/B 状态机）、djsc_ai_db / djsc_mode_models_v1（训练样本 / 专项模型）、
 *   djsc_weight_persist_v1（校准固化）与校准器相关键。
 */
import { styledDialog, progressDialog } from './updateUi.js?v=41a';
import { VERSION } from '../config/version.js?v=41a';
import { safeGet, safeSet, safeRemove } from '../../score/foundation/storage/storage.js?v=41a';
import { game, _status } from '../../score/foundation/adapt/host.js?v=41a';
import { DEFAULT_WEIGHTS } from '../../score/model/weights/defaultWeights.js?v=41a';
import {
    MODEL_PROTOCOL, MODEL_ID, MODEL_MANIFEST_URL, BUILTIN_RELEASE_SEQ,
    normalizeReleaseSeq, classifyManifestState,
    decodeBase64, paramSpec, paramsDigest, validateBundle,
} from './weightBundle.js?v=41a';
import { applyOfficialBundle, snapshotToParams, detectUserModel } from './applyWeights.js?v=41a';
import {
    buildPendingRecord, evaluatePending, verifyRestoreSource,
    createTransactionLock, evaluateApplyGate, buildOfficialRecord, verifyOfficialRecord, isOfficialRecordShape,
} from './updateCore.js?v=41a';

/* ---------- 存储键 ---------- */
const CHECK_TS_KEY = 'djsc_update_check_ts';
const OFFICIAL_KEY = 'djsc_official_weights_v1';
const PENDING_KEY = 'djsc_model_update_pending_v1';
const BACKUP_KEY = 'djsc_weights_backup_v1';

const CHECK_INTERVAL_MS = 6 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const RETRY_BACKOFF_MS = 800;

const _swallow = e => { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (e2) {} };
const _log = (msg, warn) => { try { const t = '[无名AI·模型权重] ' + msg; if (warn) console.warn(t); else console.log(t); } catch (e) {} };

/* ---------- 存储读写 ---------- */
const readJSON = key => { try { const raw = safeGet(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
const writeJSON = (key, val) => { try { return safeSet(key, JSON.stringify(val)) === true; } catch (e) { return false; } };
const removeKey = key => { try { return safeRemove(key) === true; } catch (e) { return false; } };

/* ---------- 模块解析：优先 window 挂载（生产引擎挂载点），兜底动态导入同一实例 ---------- */
let _wFallback = null, _msFallback = null;
const weightsModuleSync = () => {
    try { const w = window.__DJSC && window.__DJSC.__weightsModule; if (w) return w; } catch (e) {}
    return _wFallback;
};
const loadWeightsModule = async () => {
    const live = weightsModuleSync();
    if (live) return live;
    if (!_wFallback) { try { _wFallback = await import('../../score/model/weights/weights.js?v=41a'); } catch (e) { _wFallback = null; } }
    return _wFallback;
};
const loadModelState = async () => {
    try { const m = window.__DJSC && window.__DJSC.modelState; if (m && typeof m.getState === 'function') return m; } catch (e) {}
    try { if (!_msFallback) _msFallback = await import('../../score/model/net/modelState.js?v=41a'); } catch (e) { _msFallback = null; }
    return _msFallback;
};

/* 运行时模型契约（唯一来源：weights.js 的 MODEL_SCHEMA / DATA_EPOCH） */
const getContract = async () => {
    const wm = await loadWeightsModule();
    if (!wm || !wm.MODEL_SCHEMA || !Array.isArray(wm.MODEL_SCHEMA.dims)) return null;
    return {
        schemaVersion: wm.MODEL_SCHEMA.version,
        featureDim: wm.MODEL_SCHEMA.featureDim,
        dims: wm.MODEL_SCHEMA.dims.slice(),
        dataEpoch: Number(wm.DATA_EPOCH),
    };
};

/* 内置默认权重（作为"是否本地训练成果"的基线之一） */
const defaultParams = () => ({
    w1: DEFAULT_WEIGHTS.w1, b1: DEFAULT_WEIGHTS.b1, w2: DEFAULT_WEIGHTS.w2, b2: DEFAULT_WEIGHTS.b2,
    w3: DEFAULT_WEIGHTS.w3, b3: DEFAULT_WEIGHTS.b3, w4: DEFAULT_WEIGHTS.w4, b4: DEFAULT_WEIGHTS.b4,
    pr1: DEFAULT_WEIGHTS.pr1, pr2: DEFAULT_WEIGHTS.pr2,
});

const activeParamsNow = async () => {
    const wm = await loadWeightsModule();
    if (!wm || typeof wm.__snapshotModel !== 'function') return null;
    let snap = null;
    try { snap = wm.__snapshotModel(); } catch (e) { snap = null; }
    return snapshotToParams(snap);
};

/* 本地训练器解析：优先全局挂载（生产引擎），兜底动态导入同一实例。
 * localTrainer 会原地改写共享主模型，是必须阻塞的独立训练状态源。 */
let _ltFallback = null;
const loadLocalTrainer = async () => {
    try { const w = window.__DJSC; if (w && typeof w.isTraining === 'function') return { isTraining: w.isTraining }; } catch (e) {}
    if (!_ltFallback) { try { _ltFallback = await import('../../score/model/train/localTrainer.js?v=41a'); } catch (e) { _ltFallback = null; } }
    return _ltFallback;
};

/* ---------- 对局状态：宁可延迟，绝不在对局/训练中替换权重 ----------
 * 事件可靠性：game:start / game:end 仅由插件广播在特定路径发布，
 * 且 uninstallScoreEngine() 会 busClear() 清空全部订阅 —— 单靠事件总线不可靠。
 * 因此采用三通道：① 宿主 game.on('gameOver')（与 engine/panel 同源的可靠局末）；
 *              ② 事件总线（可重订阅、幂等，绝不重复订阅）；
 *              ③ 待生效任务存在时的低频看门狗（兜底，任务消失即自停）。 */
let _inGame = false, _inGameKnown = false, _busOk = false, _busTimer = null;
let _busHandlers = null, _gameOverBound = false, _pendingWatcher = null, _disposed = false;
const PENDING_WATCH_MS = 4000;
const _readOver = () => { try { if (_status && _status.over === true) return true; } catch (e) {} return false; };

const _onGameStart = () => { _inGame = true; _inGameKnown = true; };
const _onGameEnd = () => {
    _inGame = false; _inGameKnown = true;
    /* ★ 局刚结束，此刻不在对局中 —— 延迟应用的默认时机 */
    tryApplyPending().catch(_swallow);
};

/* 幂等订阅：先 off 再 on（bus.off 按引用删除）。
 * 既能在被 busClear 清空后重新订阅，又保证同一处理器最多只订阅一次。 */
const _ensureBus = () => {
    try {
        const bus = window.__DJSC && window.__DJSC.eventBus;
        if (bus && typeof bus.on === 'function') {
            if (!_busHandlers) _busHandlers = { onStart: _onGameStart, onEnd: _onGameEnd };
            if (typeof bus.off === 'function') {
                try { bus.off('game:start', _busHandlers.onStart); } catch (e) {}
                try { bus.off('game:end', _busHandlers.onEnd); } catch (e) {}
            }
            bus.on('game:start', _busHandlers.onStart);
            bus.on('game:end', _busHandlers.onEnd);
            _busOk = true;
            return true;
        }
    } catch (e) { _swallow(e); }
    return false;
};

/* 可靠兜底通道：直接订阅宿主 gameOver（不依赖事件总线）。
 * 无法解除订阅（宿主未提供 off），故用 _disposed 守卫避免卸载后回调。 */
const _bindGameOver = () => {
    if (_gameOverBound) return true;
    try {
        if (game && typeof game.on === 'function') {
            game.on('gameOver', function () { if (_disposed) return; _onGameEnd(); });
            _gameOverBound = true;
            return true;
        }
    } catch (e) { _swallow(e); }
    return false;
};

const _startPendingWatch = () => {
    if (_pendingWatcher || _disposed) return;
    _pendingWatcher = setInterval(function () {
        if (_disposed || !readPending()) { _stopPendingWatch(); return; }
        tryApplyPending().catch(_swallow);
    }, PENDING_WATCH_MS);
};
const _stopPendingWatch = () => { if (_pendingWatcher) { try { clearInterval(_pendingWatcher); } catch (e) {} _pendingWatcher = null; } };

/* 状态闸门：模型状态机 + A/B 候选 + 真实训练器 + 对局状态，逐项检查。
 * 未知/检查失败一律保守不放行（见 updateCore.evaluateApplyGate）。 */
const canApplyNow = async () => {
    const ms = await loadModelState();
    let modelState = null, modelStateKnown = false;
    if (ms && typeof ms.getState === 'function') {
        try { modelState = ms.getState(); modelStateKnown = true; } catch (e) { modelStateKnown = false; }
    }
    let hasCandidate = false;
    if (ms && typeof ms.hotSwapStats === 'function') {
        try { const s = ms.hotSwapStats(); hasCandidate = !!(s && s.hasCandidate); } catch (e) { _swallow(e); }
    }
    try {
        const hs = window.__DJSC && window.__DJSC.hotSwap;
        if (hs && typeof hs.stats === 'function') { const s = hs.stats(); if (s && s.hasCandidate) hasCandidate = true; }
    } catch (e) { _swallow(e); }
    const lt = await loadLocalTrainer();
    let isTraining = null, trainerKnown = false;
    if (lt && typeof lt.isTraining === 'function') {
        try { isTraining = lt.isTraining() === true; trainerKnown = true; } catch (e) { trainerKnown = false; }
    }
    let hasActiveEvent = false;
    try { hasActiveEvent = !!(_status && _status.event); } catch (e) {}
    return evaluateApplyGate({
        modelState, modelStateKnown, isTraining, trainerKnown, hasCandidate,
        over: _readOver(), inGame: _inGame, inGameKnown: _inGameKnown, hasActiveEvent,
    });
};

/* ---------- 本地官方权重记录与完整性 ---------- */
const asOfficialRecord = obj => {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.modelId !== MODEL_ID || typeof obj.modelVersion !== 'string') return null;
    if (!Number.isFinite(Number(obj.releaseSeq))) return null;
    return obj;
};
export const readOfficialRecord = () => asOfficialRecord(readJSON(OFFICIAL_KEY));
export const readPending = () => readJSON(PENDING_KEY);
export const hasBackup = () => !!readJSON(BACKUP_KEY);

export const localModelRelease = () => {
    const rec = readOfficialRecord();
    if (rec) return { releaseSeq: normalizeReleaseSeq(rec.releaseSeq), modelVersion: rec.modelVersion, source: 'official' };
    return { releaseSeq: BUILTIN_RELEASE_SEQ, modelVersion: 'builtin-default', source: 'builtin' };
};

/* ★ 完整性核验：官方记录存在时，读回存档逐项核对（不依赖在线内存），
 *   用于识别「版本相同但文件损坏」→ 允许重新获取；同时区分「已被本地训练覆盖」（正常）。 */
export const verifyOfficialIntegrity = async () => {
    const rec = readOfficialRecord();
    if (!rec) return { state: 'none' };
    const contract = await getContract();
    if (!contract) return { state: 'unknown', reason: '运行时契约不可用' };
    const wm = weightsModuleSync();
    const raw = (wm && typeof wm.__readArchive === 'function') ? wm.__readArchive() : null;
    if (!raw) return { state: 'broken', reason: '官方权重记录存在，但权重存档缺失（运行时已回退内置默认模型）' };
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { return { state: 'broken', reason: '权重存档无法解析' }; }
    if (!obj || obj.v !== contract.schemaVersion) return { state: 'broken', reason: '权重存档网络结构版本不符' };
    if (Number(obj.dv || 0) < contract.dataEpoch) return { state: 'broken', reason: '权重存档数据纪元 ' + obj.dv + ' 过旧（会被拒载）' };
    const spec = paramSpec(contract.dims);
    const params = {};
    for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        const bytes = decodeBase64(obj[s.key]);
        const need = s.kind === 'int16' ? s.len * 2 : s.len;
        if (!bytes || bytes.byteLength !== need) return { state: 'broken', reason: '存档参数 ' + s.key + ' 缺失或长度不符' };
        params[s.key] = obj[s.key];
    }
    const digest = paramsDigest(params, contract.dims);
    if (!digest) return { state: 'broken', reason: '存档参数无法计算摘要' };
    if (digest !== String(rec.sha256 || '').toLowerCase()) {
        return { state: 'superseded', reason: '当前生效模型已不是该官方权重（例如本地训练成果已生效）', digest };
    }
    return { state: 'ok', digest };
};

/* ---------- 网络 ---------- */
const _fetchOnce = async (url, timeoutMs, asText) => {
    if (typeof fetch !== 'function') throw new Error('当前环境不支持网络请求');
    const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) {} }, timeoutMs) : null;
    let res;
    try { res = await fetch(url, ctl ? { signal: ctl.signal } : undefined); }
    finally { if (timer) clearTimeout(timer); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return asText ? await res.text() : await res.json();
};
const _fetchWithRetry = async (url, opt) => {
    opt = opt || {};
    const retries = Number.isFinite(opt.retries) ? opt.retries : 0;
    const timeoutMs = opt.timeoutMs || FETCH_TIMEOUT_MS;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS * attempt));
        try { return await _fetchOnce(url, timeoutMs, !!opt.asText); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('请求失败');
};

const _touchCheckTs = () => { try { safeSet(CHECK_TS_KEY, String(Date.now())); } catch (e) { _swallow(e); } };

const _rangeText = range => {
    if (!range || (range.min == null && (range.max == null || range.max === ''))) return '不限';
    const min = range.min != null ? ('≥' + range.min) : '';
    const max = (range.max != null && range.max !== '') ? ('≤' + range.max) : '';
    return min + (min && max ? ' 且 ' : '') + max;
};

/* ---------- 结果反馈：失败绝不伪装成更新成功 ---------- */
const _report = (result, manual) => {
    const latest = result.latest || null;
    _log('检查 ' + result.state + ' | 本地权重 ' + result.local.modelVersion + ' | 远程 ' + (latest ? latest.modelVersion : '—') + (result.message ? (' | ' + result.message) : ''), result.state === 'unreachable');
    if (!manual) {
        /* 自动检查保持安静：只有需要用户处理时才提示 */
        if (result.state === 'latest' || result.state === 'unreachable' || result.state === 'unsupported' || result.state === 'superseded') return;
    }
    switch (result.state) {
        case 'latest':
            styledDialog({
                title: '模型权重已是最新',
                message: '当前模型权重：' + result.local.modelVersion + '\n服务器最新：' + (latest ? latest.modelVersion : '未知'),
            });
            break;
        case 'unreachable':
            styledDialog({ title: '检查失败', message: '模型权重服务器暂时不可用。\n原因：' + (result.message || '未知') + '\n\n可稍后重试；此期间扩展与现有模型均照常使用。' });
            break;
        case 'unsupported':
            styledDialog({ title: '暂无模型权重更新', message: '服务器尚未提供独立的模型权重更新（协议未启用）。\n\n扩展程序本身的更新请按原有整包方式获取。' });
            break;
        case 'invalid':
            styledDialog({ title: '模型权重元数据异常', message: '服务器返回的权重元数据不完整或异常：\n' + (result.message || '未知') + '\n\n已忽略本次结果，现有模型不受影响。' });
            break;
        case 'broken':
            styledDialog({
                title: '本地官方权重异常',
                message: '检测到本地官方权重记录与权重存档不一致：\n' + (result.integrity && result.integrity.reason || '内容异常')
                    + '\n\n可重新下载同一版本权重修复；也可继续使用当前回退模型。',
                buttons: [
                    { label: '重新下载修复', value: 'fix', primary: true },
                    { label: '暂不处理', value: 'no' },
                ],
            }).then(v => { if (v === 'fix') downloadAndApply({ latest: result.latest }); });
            break;
        case 'needsExtensionUpdate':
            styledDialog({
                title: '需要更新扩展程序',
                message: '发现新模型权重：' + (latest ? latest.modelVersion : '?')
                    + '\n\n该模型要求扩展版本 ' + _rangeText(latest && latest.requiresExtension) + '，当前扩展为 ' + VERSION + '，不兼容。'
                    + '\n\n请领取最新完整安装包升级扩展程序；在线权重不会强行替换不兼容的模型。',
            });
            break;
        case 'available':
            styledDialog({
                title: '发现新模型权重',
                message: '当前模型权重：' + result.local.modelVersion
                    + '\n最新模型权重：' + (latest ? latest.modelVersion : '?')
                    + (latest && latest.requiresExtension ? ('\n要求扩展版本：' + _rangeText(latest.requiresExtension)) : '')
                    + (latest && latest.publishedAt ? ('\n发布时间：' + latest.publishedAt) : '')
                    + (latest && latest.notes ? ('\n\n更新说明：\n' + latest.notes) : '')
                    + '\n\n· 只更新 AI 模型参数数据，不改动扩展文件'
                    + '\n· 不影响训练样本、候选记录与历史统计'
                    + (result.hasUserModel ? '\n· ⚠ 检测到本地训练模型，安装前会单独询问是否保留' : ''),
                buttons: [
                    { label: '下载并安装', value: 'go', primary: true },
                    { label: '暂不更新', value: 'no' },
                ],
            }).then(v => { if (v === 'go') downloadAndApply({ latest }); });
            break;
        case 'superseded':
            _log('本地权重已被本地训练成果覆盖，官方记录视为已被替换（非异常）');
            break;
        default:
            _log('未知状态：' + result.state, true);
    }
};

/* ---------- 检查更新（模型权重版本，不是扩展版本） ---------- */
export const checkModelUpdate = async opt => {
    opt = opt || {};
    const manual = !!opt.manual;
    const local = localModelRelease();
    _touchCheckTs();

    /* 1) 先做本地完整性核验：损坏时必须能重新获取（与"是最新"区分开） */
    const integrity = await verifyOfficialIntegrity().catch(() => ({ state: 'unknown' }));

    /* 2) 拉清单 */
    let manifest = null, fetchErr = null;
    try {
        manifest = await _fetchWithRetry(MODEL_MANIFEST_URL, { retries: manual ? 1 : 0 });
    } catch (e) { fetchErr = e; }

    const hasUserModel = await (async () => {
        try {
            const active = await activeParamsNow();
            const contract = await getContract();
            const rec = readOfficialRecord();
            return !!(contract && detectUserModel({ activeParams: active, defaultParams: defaultParams(), officialDigest: rec && rec.sha256, dims: contract.dims }).isUserModel);
        } catch (e) { return false; }
    })();

    if (!manifest) {
        if (integrity.state === 'broken') {
            const result = { state: 'broken', local, integrity, hasUserModel, message: '服务器不可用，暂时无法重新下载修复' };
            _report(result, true);
            return result;
        }
        const result = { state: 'unreachable', local, message: String((fetchErr && fetchErr.message) || fetchErr) };
        _report(result, manual);
        return result;
    }

    /* 状态判定走纯函数（weightBundle.classifyManifestState），与自动化测试同一口径 */
    const cls = classifyManifestState({
        manifest, localSeq: local.releaseSeq, extensionVersion: VERSION, integrityState: integrity.state,
    });
    const result = { state: cls.state, local, latest: cls.latest, integrity, hasUserModel, message: cls.message };
    /* available / broken / needsExtensionUpdate 有可操作项 → 自动检查也要提示；latest 等仅在手动检查时提示 */
    const actionable = (cls.state === 'available' || cls.state === 'broken' || cls.state === 'needsExtensionUpdate');
    _report(result, manual || actionable);
    return result;
};

/* ---------- 下载 + 校验（未通过全部检查不允许应用） ---------- */
const _absolutize = url => {
    try { return new URL(url, MODEL_MANIFEST_URL).href; } catch (e) { return url; }
};

const downloadBundle = async latest => {
    const contract = await getContract();
    if (!contract) throw new Error('无法读取运行时模型契约（模型模块未就绪）');
    const url = _absolutize(latest.url);
    const raw = await _fetchWithRetry(url, { retries: 1, asText: true });
    if (typeof raw !== 'string' || !raw.length) throw new Error('权重包为空');
    let bundle = null;
    try { bundle = JSON.parse(raw); } catch (e) { throw new Error('权重包不是合法 JSON'); }
    const res = validateBundle(bundle, contract);
    if (!res.ok) throw new Error('权重包校验未通过：' + res.errors.join('；'));
    /* 清单与内容交叉核对：避免"下载期间文件被覆盖"导致元数据与内容不一致 */
    if (String(bundle.sha256 || '').toLowerCase() !== String(latest.sha256 || '').toLowerCase()) throw new Error('权重包摘要与清单不一致（文件可能已被替换）');
    if (Number(bundle.size) !== Number(latest.size)) throw new Error('权重包体积与清单不一致');
    if (normalizeReleaseSeq(bundle.releaseSeq) !== normalizeReleaseSeq(latest.releaseSeq)) throw new Error('权重包版本序号与清单不一致');
    if (bundle.modelVersion !== latest.modelVersion) throw new Error('权重包版本标识与清单不一致');
    return { bundle, res, contract };
};

/* ---------- 记录 / 应用 / 延迟 ---------- */
/* ★ P1-4：写入官方记录后必须读回核对；失败不报告完整成功。 */
const writeOfficialRecordVerified = (bundle, digest, size, contract) => {
    const want = buildOfficialRecord({ modelId: MODEL_ID, bundle, digest, size, contract });
    if (!writeJSON(OFFICIAL_KEY, want)) return { ok: false, record: want, errors: ['官方权重记录写入失败（存储不可用或配额不足）'] };
    const back = readOfficialRecord();
    if (!back) return { ok: false, record: want, errors: ['官方权重记录读回失败或格式非法'] };
    const errs = verifyOfficialRecord(back, want);
    if (errs.length) return { ok: false, record: want, errors: errs };
    return { ok: true, record: want, errors: [] };
};
/* 原样写回一条既有记录（用于回滚时恢复旧版本元数据） */
const writeOfficialRecordRaw = rec => (rec ? writeJSON(OFFICIAL_KEY, rec) : removeKey(OFFICIAL_KEY));

/* 备份记录 → 解码参数（供恢复与回滚复用） */
const decodeBackupParams = (rec, dims) => {
    if (!rec || !rec.params) return null;
    const spec = paramSpec(dims);
    const decoded = {};
    for (let i = 0; i < spec.length; i++) {
        const s = spec[i];
        const bytes = decodeBase64(rec.params[s.key]);
        const need = s.kind === 'int16' ? s.len * 2 : s.len;
        if (!bytes || bytes.byteLength !== need) return null;
        decoded[s.key] = s.kind === 'int16' ? (() => { const o = new Int16Array(s.len); const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); for (let k = 0; k < s.len; k++) o[k] = dv.getInt16(k * 2, true); return o; })() : Int8Array.from(bytes);
    }
    return decoded;
};

/* ★ P1-4：权重已应用但版本记录未持久化 → 恢复旧权重与旧记录，保持一致状态。
 * 复用备份（更新前模型）走独立恢复事务，绝不覆盖备份本身。 */
const _rollbackToBackup = async (contract, prevRec) => {
    const rec = storageOps.readBackup();
    if (!rec || !rec.params) return { ok: false, err: 'no backup' };
    const srcErrs = verifyRestoreSource(rec, contract.dims, contract.schemaVersion);
    if (srcErrs.length) return { ok: false, err: 'backup invalid', errors: srcErrs };
    const bridge = await buildBridge();
    if (!bridge) return { ok: false, err: 'bridge unavailable' };
    const decoded = decodeBackupParams(rec, contract.dims);
    if (!decoded) return { ok: false, err: 'backup decode failed' };
    const bundleLike = { params: rec.params, trained: (rec.meta && rec.meta.trained) || 0, accuracy: (rec.meta && rec.meta.accuracy) || 0, size: 0 };
    const r = await applyOfficialBundle({
        bridge, storageOps, bundle: bundleLike, decoded, dims: contract.dims, probe: null,
        runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion, mode: 'restore',
    });
    if (r.ok) writeOfficialRecordRaw(prevRec);
    return r;
};

const buildBridge = async () => {
    const wm = await loadWeightsModule();
    if (!wm) return null;
    return {
        snapshotModel: wm.__snapshotModel,
        restoreModel: wm.__restoreModel,
        saveWeights: wm.saveWeights,
        getMeta: wm.getMeta,
        forward: wm.forward,
        setAccuracy: wm.setAccuracy,
    };
};

const storageOps = {
    readArchive: () => { const wm = weightsModuleSync(); if (wm && typeof wm.__readArchive === 'function') { try { return wm.__readArchive(); } catch (e) {} } return null; },
    writeBackup: rec => writeJSON(BACKUP_KEY, rec),
    readBackup: () => readJSON(BACKUP_KEY),
};

/* ★ P1-1：统一事务锁——下载安装 / 待生效应用 / 恢复备份 共用，
 * 同一时刻只允许一个修改主模型的更新事务。 */
const _tx = createTransactionLock();
const _acquireTx = () => _tx.acquire();
const _releaseTx = () => _tx.release();

export const downloadAndApply = async opt => {
    opt = opt || {};
    if (!opt.latest) {
        styledDialog({ title: '无法安装', message: '请先「检查模型权重更新」获取最新版本信息后再安装。' });
        return { ok: false, err: 'no manifest entry' };
    }
    if (!_acquireTx()) {
        styledDialog({ title: '已有更新任务', message: '同一时刻只允许一个模型更新任务运行，请等待当前任务结束。' });
        return { ok: false, err: 'busy' };
    }
    const prog = progressDialog('下载模型权重…');
    try {
        prog.update('下载并校验权重包…');
        const { bundle, res, contract } = await downloadBundle(opt.latest);

        /* ★ 保护玩家本地训练成果：检测到本地训练模型时，绝不静默覆盖 */
        const active = await activeParamsNow();
        const rec = readOfficialRecord();
        const det = detectUserModel({ activeParams: active, defaultParams: defaultParams(), officialDigest: rec && rec.sha256, dims: contract.dims });
        if (det.known && det.isUserModel) {
            prog.close();
            const choice = await styledDialog({
                title: '检测到本地训练模型',
                message: '你当前生效的模型是你自己训练得到的，不是官方权重。\n\n'
                    + '· 「备份并切换」：先把当前模型参数完整备份到本地（仅含模型参数与元数据，不含 AdamW 动量/时间步；可在控制台用 __DJSC.modelUpdate.restoreBackup() 还原），再切换为官方权重\n'
                    + '· 训练样本、候选记录、历史统计不会被清空或改动\n'
                    + '· 「保留本地模型」：本次不安装，你的模型继续生效',
                buttons: [
                    { label: '备份并切换为官方权重', value: 'apply', primary: true },
                    { label: '保留本地模型', value: 'keep' },
                ],
            });
            if (choice !== 'apply') return { ok: false, err: 'user kept local model' };
        }

        const preserveUserModel = !!(det.known && det.isUserModel);
        const baseModelDigest = active ? paramsDigest(active, contract.dims) : null;

        const gate = await canApplyNow();
        if (!gate.ok) {
            /* 延迟到下一局结束 / 下次启动生效，绝不在对局或训练中替换权重。
             * ★ P0-3：记录授权时的基线模型摘要，实际生效前必须重新核对当前模型是否已变化。 */
            const pendingRec = buildPendingRecord({
                latest: opt.latest, bundle, baseModelDigest, userAuthorized: true,
                reason: gate.reason, savedAt: Date.now(), contract,
            });
            const stored = writeJSON(PENDING_KEY, pendingRec);
            prog.close();
            if (!stored) {
                await styledDialog({ title: '无法保存待生效权重', message: '设备持久化存储不可用，本次更新未应用（现有模型不受影响）。' });
                return { ok: false, err: 'storage unavailable for pending' };
            }
            await styledDialog({ title: '已下载，稍后生效', message: '当前' + gate.reason + '。\n\n为避免中途替换模型，权重将在本局结束后或下次启动时自动生效。\n\n（若在此期间你又训练出新的模型，生效前会再次询问，绝不静默覆盖）' });
            _startPendingWatch();   /* ★ P1-3：待生效任务存在期间的兜底看门狗 */
            return { ok: true, deferred: true, reason: gate.reason };
        }

        prog.update('写入并校验新权重…');
        const bridge = await buildBridge();
        if (!bridge) { prog.close(); await styledDialog({ title: '无法安装', message: '模型模块未就绪，本次更新未应用。' }); return { ok: false, err: 'bridge unavailable' }; }
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle, decoded: res.decoded, dims: contract.dims,
            probe: res.probe, runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion,
            mode: 'install', preserveUserModel,
            confirmBeforeWrite: async () => (await canApplyNow()).ok,
            onStep: m => prog.update(m),
        });
        prog.close();
        if (r.ok) {
            /* ★ P1-4：权重与版本元数据同一事务——记录写入并读回核对成功后才算完成 */
            const wr = writeOfficialRecordVerified(bundle, r.digest, r.size, contract);
            if (wr.ok) {
                removeKey(PENDING_KEY);
                await styledDialog({
                    title: '模型权重更新完成',
                    message: '新模型权重已生效：' + bundle.modelVersion + '\n\n'
                        + '· 已通过结构 / 体积 / SHA-256 / 数值有限性 / 前向自检\n'
                        + '· 版本记录已写入并读回核对通过\n'
                        + '· 优化器状态已重置，后续本地训练从新权重继续\n'
                        + '· 重启游戏后仍会加载该权重',
                });
                return { ok: true, applied: true, modelVersion: bundle.modelVersion };
            }
            /* 权重已应用但版本记录未持久化 → 回滚旧权重与旧记录，保持一致状态 */
            const rb = await _rollbackToBackup(contract, rec);
            removeKey(PENDING_KEY);
            await styledDialog({
                title: '更新未完成',
                message: '权重已下载校验通过，但版本记录未能持久化：\n' + (wr.errors || []).join('\n')
                    + '\n\n已' + (rb.ok ? '回滚到更新前的模型与版本记录' : '尝试回滚（未能完全确认，请重启游戏后检查模型状态）') + '。',
            });
            return { ok: false, err: 'official record not persisted', errors: wr.errors, rolledBack: !!rb.ok };
        }
        await styledDialog({
            title: '安装未完成',
            message: '新权重未通过校验，已' + (r.rolledBack ? '完整回滚到更新前的模型' : '尝试回滚（未能完全确认，请重启游戏后检查模型状态）') + '。\n\n原因：\n' + (r.errors || []).join('\n'),
        });
        return { ok: false, errors: r.errors, rolledBack: r.rolledBack };
    } catch (e) {
        prog.close();
        const msg = String((e && e.message) || e);
        await styledDialog({ title: '下载或安装失败', message: '原因：' + msg + '\n\n现有模型未受影响。' });
        return { ok: false, err: msg };
    } finally {
        _releaseTx();
    }
};

/* 延迟应用（启动时 / 每局结束后调用）；任何失败都恢复旧模型。
 * ★ P0-3：生效前重新核对"当前模型是否仍是授权时的模型"，绝不静默覆盖等待期间新产生的训练成果。
 * ★ P1-1：与下载安装 / 恢复备份共用同一事务锁，避免交叉覆盖。 */
export const tryApplyPending = async () => {
    const pending = readPending();
    if (!pending || !pending.bundle) return { ok: false, skipped: true };
    if (!_acquireTx()) return { ok: false, skipped: true, reason: 'busy' };
    try {
        return await _tryApplyPendingLocked(pending);
    } finally {
        _releaseTx();
    }
};

const _tryApplyPendingLocked = async pending => {
    const contract = await getContract();
    if (!contract) return { ok: false, skipped: true, reason: '契约不可用' };
    const active = await activeParamsNow();
    const currentDigest = active ? paramsDigest(active, contract.dims) : null;
    const officialRec = readOfficialRecord();
    const gate = await canApplyNow();
    const decision = evaluatePending({ pending, contract, currentDigest, officialRec, gate });
    if (decision.action === 'drop') {
        removeKey(PENDING_KEY);
        _log('待生效权重已安全跳过：' + decision.reason, true);
        return { ok: false, skipped: true, reason: decision.reason };
    }
    if (decision.action === 'wait') return { ok: false, skipped: true, reason: decision.reason };
    if (decision.action === 'reprompt') {
        /* 当前模型与授权基线不一致 → 必须重新征得用户同意，不得静默覆盖 */
        const choice = await styledDialog({
            title: '待生效权重需要重新确认',
            message: '你之前下载的模型权重已就绪，但这期间当前生效模型发生了变化：\n' + decision.reason + '。\n\n'
                + '· 「保留当前模型」：放弃本次待生效权重，你当前的模型继续生效（推荐）\n'
                + '· 「仍然安装」：用待生效的官方权重替换当前模型（更新前的模型会被备份保存）',
            buttons: [
                { label: '保留当前模型', value: 'keep', primary: true },
                { label: '仍然安装', value: 'apply' },
            ],
        });
        if (choice !== 'apply') { removeKey(PENDING_KEY); return { ok: false, err: 'user kept local model' }; }
    }
    const res = validateBundle(pending.bundle, contract);
    if (!res.ok) {
        removeKey(PENDING_KEY);
        _log('待生效权重校验失败，已放弃：' + res.errors.join('；'), true);
        return { ok: false, errors: res.errors };
    }
    const bridge = await buildBridge();
    if (!bridge) return { ok: false, skipped: true, reason: '模型模块未就绪' };
    const det = detectUserModel({ activeParams: active, defaultParams: defaultParams(), officialDigest: officialRec && officialRec.sha256, dims: contract.dims });
    const r = await applyOfficialBundle({
        bridge, storageOps, bundle: pending.bundle, decoded: res.decoded, dims: contract.dims,
        probe: res.probe, runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion,
        mode: 'install', preserveUserModel: !!(det.known && det.isUserModel),
        confirmBeforeWrite: async () => (await canApplyNow()).ok,
    });
    if (r.ok) {
        /* ★ P1-4：版本记录写入并读回核对成功后才算完成；失败则回滚旧权重与旧记录 */
        const wr = writeOfficialRecordVerified(pending.bundle, r.digest, r.size, contract);
        if (wr.ok) {
            removeKey(PENDING_KEY);
            _stopPendingWatch();
            await styledDialog({ title: '模型权重已生效', message: '已应用待生效的模型权重：' + pending.bundle.modelVersion + '\n\n（版本记录已写入并读回核对通过）' });
            return r;
        }
        const rb = await _rollbackToBackup(contract, officialRec);
        removeKey(PENDING_KEY);
        _stopPendingWatch();
        await styledDialog({
            title: '待生效权重未完成',
            message: '权重已应用，但版本记录未能持久化：\n' + (wr.errors || []).join('\n')
                + '\n\n已' + (rb.ok ? '回滚到更新前的模型与版本记录' : '尝试回滚（未能完全确认，请重启游戏后检查模型状态）') + '。',
        });
        return { ok: false, err: 'official record not persisted', errors: wr.errors, rolledBack: !!rb.ok };
    }
    removeKey(PENDING_KEY);
    _stopPendingWatch();
    await styledDialog({ title: '权重应用失败', message: '已' + (r.rolledBack ? '回滚到更新前的模型' : '尝试回滚') + '。\n\n原因：\n' + (r.errors || []).join('\n') });
    return r;
};

/* 还原更新前的模型（用户本地训练成果备份）
 * ★ P0-2：恢复是独立事务（mode='restore'），绝不写入/覆盖原备份；失败时原备份保持不动。 */
export const restoreBackup = async () => {
    const rec = storageOps.readBackup();
    if (!rec || !rec.params) { styledDialog({ title: '没有可还原的备份', message: '未找到更新前的模型备份。' }); return { ok: false, err: 'no backup' }; }
    if (!_acquireTx()) { styledDialog({ title: '已有更新任务', message: '同一时刻只允许一个模型更新任务运行，请稍后再试。' }); return { ok: false, err: 'busy' }; }
    try {
    const contract = await getContract();
    const bridge = await buildBridge();
    if (!contract || !bridge) { styledDialog({ title: '无法还原', message: '模型模块未就绪。' }); return { ok: false, err: 'not ready' }; }
    /* ★ P0-2：恢复前验证备份的参数、结构、摘要与版本兼容性 */
    const srcErrs = verifyRestoreSource(rec, contract.dims, contract.schemaVersion);
    if (srcErrs.length) {
        await styledDialog({ title: '备份不可用', message: '更新前的模型备份无法安全还原：\n' + srcErrs.join('\n') + '\n\n原备份已保留、未被修改。' });
        return { ok: false, err: 'backup invalid', errors: srcErrs };
    }
    const need = await styledDialog({
        title: '还原更新前的模型',
        message: '将把当前模型替换为更新前的备份（' + new Date(rec.savedAt || Date.now()).toLocaleString() + '）。\n\n'
            + '· 训练样本与统计不受影响\n· 还原后原备份仍会保留，可反复还原',
        buttons: [{ label: '确认还原', value: 'go', primary: true }, { label: '取消', value: 'no' }],
    });
    if (need !== 'go') return { ok: false, err: 'cancelled' };
    const gate = await canApplyNow();
    if (!gate.ok) { styledDialog({ title: '暂时无法还原', message: '当前' + gate.reason + '，请稍后再试。' }); return { ok: false, err: gate.reason }; }
    const bundleLike = { params: rec.params, trained: (rec.meta && rec.meta.trained) || 0, accuracy: (rec.meta && rec.meta.accuracy) || 0, size: 0 };
    const decoded = decodeBackupParams(rec, contract.dims);
    if (!decoded) { styledDialog({ title: '备份已损坏', message: '备份参数不完整，无法还原。' }); return { ok: false, err: 'backup corrupt' }; }
    const r = await applyOfficialBundle({
        bridge, storageOps, bundle: bundleLike, decoded, dims: contract.dims, probe: null,
        runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion,
        mode: 'restore', preserveUserModel: true,
        confirmBeforeWrite: async () => (await canApplyNow()).ok,
    });
    if (r.ok) {
        /* 只有恢复成功后才清除官方记录；原备份保留（支持反复恢复，绝不自我覆盖） */
        removeKey(OFFICIAL_KEY);
        await styledDialog({ title: '已还原', message: '已恢复更新前的模型（官方权重记录已清除，原备份仍保留）。' });
    } else {
        await styledDialog({ title: '还原失败', message: '已' + (r.rolledBack ? '回滚到当前模型' : '尝试回滚') + '，原备份未被修改。\n\n原因：\n' + (r.errors || []).join('\n') });
    }
    return r;
    } finally { _releaseTx(); }
};

export const modelUpdateStatus = () => ({
    extensionVersion: VERSION,
    local: localModelRelease(),
    official: readOfficialRecord(),
    hasPending: !!readPending(),
    hasBackup: hasBackup(),
    lastCheckTs: parseInt(safeGet(CHECK_TS_KEY) || '0', 10) || 0,
    intervalHours: Math.round(CHECK_INTERVAL_MS / 3600000),
});

/* ---------- 装配 ---------- */
export const installModelUpdate = () => {
    try {
        window.__DJSC = window.__DJSC || {};
        window.__DJSC.updateCheck = function () { return checkModelUpdate({ manual: true }); };
        window.__DJSC.modelUpdate = {
            check: function () { return checkModelUpdate({ manual: true }); },
            downloadAndApply,
            restoreBackup,
            status: modelUpdateStatus,
            localRelease: localModelRelease,
            officialRecord: readOfficialRecord,
            integrity: verifyOfficialIntegrity,
            hasBackup: hasBackup,
            readPending: readPending,
        };
        /* 对局生命周期订阅：可靠通道 gameOver + 可重订阅的事件总线 */
        _disposed = false;
        _bindGameOver();
        if (!_ensureBus()) {
            let n = 0;
            _busTimer = setInterval(function () {
                if (_disposed || _ensureBus() || ++n > 20) { if (_busTimer) clearInterval(_busTimer); _busTimer = null; }
            }, 1000);
        }
        /* 启动时：先尝试应用待生效权重（若存在），再按 6 小时节流做一次静默检查 */
        if (readPending()) _startPendingWatch();
        const ts = parseInt(safeGet(CHECK_TS_KEY) || '0', 10) || 0;
        tryApplyPending().catch(_swallow).then(() => {
            if (Date.now() - ts > CHECK_INTERVAL_MS) checkModelUpdate({ manual: false }).catch(_swallow);
        });
    } catch (e) {
        _log('装配失败：' + ((e && e.message) || e), true);
    }
};

/* 卸载：解除自身监听与定时器，绝不动其他模块的订阅 */
export const uninstallModelUpdate = () => {
    _disposed = true;
    _stopPendingWatch();
    if (_busTimer) { try { clearInterval(_busTimer); } catch (e) {} _busTimer = null; }
    try {
        const bus = window.__DJSC && window.__DJSC.eventBus;
        if (bus && typeof bus.off === 'function' && _busHandlers) {
            try { bus.off('game:start', _busHandlers.onStart); } catch (e) {}
            try { bus.off('game:end', _busHandlers.onEnd); } catch (e) {}
        }
    } catch (e) { _swallow(e); }
    _busOk = false;
};

export { MODEL_ID, MODEL_MANIFEST_URL };
