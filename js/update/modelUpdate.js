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
import { safeGet, safeSet, safeRemove, getStore } from '../../score/foundation/storage/storage.js?v=41a';
import { lib, game, _status } from '../../score/foundation/adapt/host.js?v=41a';
import { DEFAULT_WEIGHTS } from '../../score/model/weights/defaultWeights.js?v=41a';
import {
    MODEL_PROTOCOL, MODEL_ID, MODEL_MANIFEST_URL, BUILTIN_RELEASE_SEQ,
    normalizeReleaseSeq, classifyManifestState,
    decodeBase64, paramSpec, paramsDigest, validateBundle,
} from './weightBundle.js?v=41a';
import { applyOfficialBundle, snapshotToParams, detectUserModel, recoverInterruptedTransaction as recoverTx } from './applyWeights.js?v=41a';
import {
    buildPendingRecord, evaluatePending, verifyRestoreSource,
    createTransactionLock, createRecoveryGuard, evaluateApplyGate, buildOfficialRecord, verifyOfficialRecord,
    classifyIntegrityArchive, computeMaxBundleBytes, fetchTextWithLimits, MAX_MANIFEST_BYTES,
    computeTrainingEvidence, restoreOfficialRecord, decodeBackupParams,
    generateTxId, classifyInterruptedTx, reauthorizeRecord, rollbackStatusText,
} from './updateCore.js?v=41a';

/* ---------- 存储键 ---------- */
const CHECK_TS_KEY = 'djsc_update_check_ts';
const OFFICIAL_KEY = 'djsc_official_weights_v1';
const PENDING_KEY = 'djsc_model_update_pending_v1';
const BACKUP_KEY = 'djsc_weights_backup_v1';           /* 长期恢复点（仅安装成功后轮换） */
const STAGING_KEY = 'djsc_weights_backup_staging_v1';  /* 安装事务暂存备份（P2-1） */
const TX_KEY = 'djsc_model_update_tx_v1';              /* 安装事务日志（P0-1，崩溃恢复） */

const CHECK_INTERVAL_MS = 6 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const RETRY_BACKOFF_MS = 800;

const _swallow = e => { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (e2) {} };
const _log = (msg, warn) => { try { const t = '[无名AI·模型权重] ' + msg; if (warn) console.warn(t); else console.log(t); } catch (e) {} };

/* ---------- 存储读写 ---------- */
const readJSON = key => { try { const raw = safeGet(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
const writeJSON = (key, val) => { try { return safeSet(key, JSON.stringify(val)) === true; } catch (e) { return false; } };
const removeKey = key => { try { return safeRemove(key) === true; } catch (e) { return false; } };
/* ★ P1-3：可靠的底层读取——safeGet 会吞掉存储异常，"读失败"与"缺键"无法区分。
 * 直读 getStore()：存储访问异常 / JSON 解析异常向调用方抛出；返回 null 仅表示"确实不存在"。
 * 供官方记录删除核验与崩溃恢复判定使用（绝不允许读失败冒充"记录不存在"）。 */
const readOfficialRecordStrict = () => {
    let ls = null;
    try { ls = getStore(); } catch (e) { throw e; }
    if (!ls) return null;                       /* 无存储环境：等同不存在（写入/删除同样会失败并不被采信） */
    const raw = ls.getItem(OFFICIAL_KEY);       /* 异常向上抛：存储访问失败 */
    if (raw === null || raw === undefined || raw === '') return null;
    return JSON.parse(raw);                     /* 解析异常向上抛：记录损坏 */
};

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
    const schema = wm.MODEL_SCHEMA;
    return {
        schemaVersion: schema.version,
        featureDim: schema.featureDim,
        dims: schema.dims.slice(),
        dataEpoch: Number(wm.DATA_EPOCH),
        /* ★ P2-5：把 dtype / architecture 一并下发，供 validateBundle 校验模型语义 */
        dtype: schema.dtype ? { weights: schema.dtype.weights, biases: schema.dtype.biases } : undefined,
        architecture: schema.architecture ? {
            activation: schema.architecture.activation, norm: schema.architecture.norm,
            residual: schema.architecture.residual, critic: schema.architecture.critic,
        } : undefined,
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
 * ★ 真实生命周期核查结论（本轮 P0）：
 *   - 宿主 **没有** `game.on`，也从不发布 `gameOver` 事件 ——
 *     `game.on('gameOver', …)` 是死代码（engine/panel 中同样如此，靠轮询兜底）。
 *   - 新一局通过 `game.reload()` → `window.location.reload()` 重新加载页面，
 *     因此 `_status.gameStarted` / `_status.over` / `_status.event` 均为"每局一份"。
 *   - 可靠的每局开始信号：`lib.announce.publish('Noname.Game.Event.GameStart')`
 *     （宿主 gameEvent.js 在 gameStart 事件中发布），并置 `_status.gameStarted = true`。
 *   - 可靠的局末信号：`_status.over === true`（由 game.over() 置位）。
 * 因此门禁以宿主实时信号为主（见 updateCore.evaluateApplyGate），事件总线与看门狗仅作兜底。 */
let _inGame = false, _inGameKnown = false, _busOk = false, _busTimer = null;
let _busHandlers = null, _announceHandler = null, _pendingWatcher = null, _disposed = false;
const PENDING_WATCH_MS = 4000;
const _readOver = () => { try { if (_status && _status.over === true) return true; } catch (e) {} return false; };
const _readGameStarted = () => { try { return _status && _status.gameStarted === true; } catch (e) { return false; } };
/* 兜底：存在活动事件链且玩家已就绪（覆盖 gameStarted 未置位的开局瞬间 / 观察者模式） */
const _hasActiveEvent = () => {
    try {
        const players = game && game.players;
        return !!(_status && _status.event) && !!(players && players.length);
    } catch (e) { return false; }
};

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

/* 宿主真实每局开始通道：lib.announce（EventTarget 实现，支持 unsubscribe）。
 * 不依赖插件初始化时仅触发一次的广播，也不依赖不存在的 game.on。 */
const _ensureAnnounce = () => {
    if (_announceHandler) return true;
    try {
        if (lib && lib.announce && typeof lib.announce.subscribe === 'function') {
            const handler = () => { if (_disposed) return; _onGameStart(); };
            lib.announce.subscribe('Noname.Game.Event.GameStart', handler);
            _announceHandler = handler;
            return true;
        }
    } catch (e) { _swallow(e); }
    return false;
};
const _dropAnnounce = () => {
    if (!_announceHandler) return;
    try {
        if (lib && lib.announce && typeof lib.announce.unsubscribe === 'function') {
            lib.announce.unsubscribe('Noname.Game.Event.GameStart', _announceHandler);
        }
    } catch (e) { _swallow(e); }
    _announceHandler = null;
};

const _startPendingWatch = () => {
    if (_pendingWatcher || _disposed) return;
    _pendingWatcher = setInterval(function () {
        const p = readPending();
        if (_disposed || !p || p.hold) { _stopPendingWatch(); return; }
        _ensureBus();   /* 事件被清空后自愈重订阅（幂等，不会重复订阅） */
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
    return evaluateApplyGate({
        modelState, modelStateKnown, isTraining, trainerKnown, hasCandidate,
        gameStarted: _readGameStarted(), over: _readOver(), hasActiveEvent: _hasActiveEvent(),
        inGame: _inGame, inGameKnown: _inGameKnown,
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

/* ★ 完整性核验（P2-1）：官方记录存在时读回存档逐项核对，区分三种情况：
 *   broken     存档结构无效/缺失/回退默认 → 损坏（可重新获取修复）
 *   superseded 结构有效且确为本地训练成果 → 正常（非异常）
 *   mismatch   结构有效但无法判定训练还是外部改写 → 保守，绝不自动覆盖 */
export const verifyOfficialIntegrity = async () => {
    const rec = readOfficialRecord();
    if (!rec) return { state: 'none' };
    const contract = await getContract();
    const wm = weightsModuleSync();
    const raw = (wm && typeof wm.__readArchive === 'function') ? wm.__readArchive() : null;
    /* ★ P1-4：训练证据必须来自可信来源，不能仅凭 `trained > 0`
     *   （官方权重自身也可能带非零训练步数，安装后 META.trained 即官方包 trained）。
     *   依据：① 官方记录里保存的官方训练步数；② 状态机的候选晋升计数。 */
    let hasTrainingEvidence = false, defaultDigest = null;
    if (contract) {
        defaultDigest = paramsDigest(defaultParams(), contract.dims);
        let archiveTrained = 0, promotedCount = 0;
        try {
            const obj = raw ? JSON.parse(raw) : null;
            if (obj && typeof obj === 'object') {
                archiveTrained = Number(obj.trained || 0);
                const spec = paramSpec(contract.dims);
                let okShape = true;
                for (let i = 0; i < spec.length; i++) {
                    const b = decodeBase64(obj[spec[i].key]);
                    const need = spec[i].kind === 'int16' ? spec[i].len * 2 : spec[i].len;
                    if (!b || b.byteLength !== need) { okShape = false; break; }
                }
                if (!okShape) archiveTrained = 0;
            }
        } catch (e) { _swallow(e); }
        try {
            const ms = await loadModelState();
            if (ms && typeof ms.hotSwapStats === 'function') {
                const s = ms.hotSwapStats();
                promotedCount = Number((s && s.promoted) || 0) || 0;
            }
        } catch (e) { _swallow(e); }
        hasTrainingEvidence = computeTrainingEvidence({
            archiveTrained, officialTrained: rec.trained, promotedCount,
        });
    }
    return classifyIntegrityArchive({ raw, contract, officialRec: rec, hasTrainingEvidence, defaultDigest });
};

/* ---------- 网络（P2-2 / P2-3） ----------
 * 统一走 updateCore.fetchTextWithLimits：超时覆盖"完整下载过程"（含正文读取），
 * 并按维度派生的上限做体积预检，异常大响应提前拒绝，避免内存被撑爆。 */
const _fetchText = (url, opt) => fetchTextWithLimits({
    url,
    fetchImpl: (typeof fetch === 'function') ? fetch : null,
    AbortControllerImpl: (typeof AbortController === 'function') ? AbortController : null,
    timeoutMs: (opt && opt.timeoutMs) || FETCH_TIMEOUT_MS,
    retries: (opt && Number.isFinite(opt.retries)) ? opt.retries : 0,
    maxBytes: (opt && opt.maxBytes) || MAX_MANIFEST_BYTES,
    backoffMs: RETRY_BACKOFF_MS,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
});

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
                dangerous: true, defaultValue: 'no',
            }).then(v => { if (v === 'fix' && result.latest) downloadAndApply({ latest: result.latest }); });
            break;
        case 'mismatch':
            styledDialog({
                title: '本地权重与官方记录不一致',
                message: (result.integrity && result.integrity.reason || '权重存档内容与官方记录不一致')
                    + '\n\n为避免误覆盖，本程序不会自动替换当前权重。\n'
                    + '· 若这是你自己的训练成果 → 保持现状即可\n'
                    + '· 若确认存档损坏 → 可重新下载同一版本权重修复',
                buttons: [
                    { label: '重新下载修复', value: 'fix', primary: true },
                    { label: '保持现状', value: 'no' },
                ],
                dangerous: true, defaultValue: 'no',
            }).then(v => { if (v === 'fix' && result.latest) downloadAndApply({ latest: result.latest }); });
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
                dangerous: true, defaultValue: 'no',
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

    /* 2) 拉清单（清单体积上限收口） */
    let manifest = null, fetchErr = null;
    try {
        const text = await _fetchText(MODEL_MANIFEST_URL, { retries: manual ? 1 : 0, maxBytes: MAX_MANIFEST_BYTES });
        manifest = JSON.parse(text);
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
    /* ★ P2-1：同版本但内容与官方记录不一致且无法判定（mismatch）→ 单独提示，绝不自动替换 */
    let state = cls.state, message = cls.message;
    if (integrity.state === 'mismatch' && cls.state === 'latest') { state = 'mismatch'; message = integrity.reason; }
    const result = { state, local, latest: cls.latest, integrity, hasUserModel, message };
    /* available / broken / needsExtensionUpdate / mismatch 有可操作项 → 自动检查也要提示 */
    const actionable = (state === 'available' || state === 'broken' || state === 'needsExtensionUpdate' || state === 'mismatch');
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
    /* ★ P2-3：体积上限由网络维度派生，异常大响应在下载阶段即被拒绝 */
    const maxBytes = computeMaxBundleBytes(contract.dims);
    const raw = await _fetchText(url, { retries: 1, maxBytes });
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
/* ★ P1-3：恢复旧版本记录必须读回核验；无旧记录时必须确认新记录已删除。
 * 读回一律走 readOfficialRecordStrict：读取抛异常 = 验证失败（绝不当成"记录不存在"）。
 * 返回 { ok, errors }，供上层区分"完整回滚 / 部分回滚 / 回滚失败"。 */
const _restoreOfficialRecord = prevRec => restoreOfficialRecord({
    prevRec,
    writeRecord: rec => writeJSON(OFFICIAL_KEY, rec),
    readRecord: readOfficialRecordStrict,
    removeRecord: () => removeKey(OFFICIAL_KEY),
    verify: verifyOfficialRecord,
});
/* ★ P1：清除官方记录并**读回确认不存在**（删除的返回值与"读取异常"都不可信） */
const _clearOfficialRecordVerified = () => restoreOfficialRecord({
    prevRec: null,
    readRecord: readOfficialRecordStrict,
    removeRecord: () => removeKey(OFFICIAL_KEY),
    verify: verifyOfficialRecord,
});

/* ★ P0-1：事务结果 → 待生效任务收尾。
 * 事务内部已完成回滚（只使用本次事务的基线，不读长期备份）。
 * 回滚完整 → 清理待生效记录；回滚不完整 → 保留记录与备份并置 hold 停止自动重试。 */
const _finishPendingTx = r => {
    if (r && r.ok) { removeKey(PENDING_KEY); _stopPendingWatch(); return; }
    if (r && r.rollbackStatus === 'complete') { removeKey(PENDING_KEY); _stopPendingWatch(); return; }
    const p = readPending();
    if (p) { p.hold = true; p.holdReason = '上次事务回滚未完成，已保留恢复数据'; writeJSON(PENDING_KEY, p); }
    _stopPendingWatch();
};

/* 事务结果如实告知：一律引用 updateCore.rollbackStatusText（三态与返回值一致，
 * 绝不用文案掩盖错误的状态；partial = 模型已回滚但官方记录未恢复）。 */

/* ---------- 崩溃恢复（P0-1 / 并发保护） ----------
 * 恢复逻辑在 applyWeights.recoverInterruptedTransaction（依赖注入，可在 Node 侧直接测试），
 * 这里注入宿主侧依赖：存储 + 模型 bridge + **官方记录读写能力**
 * （恢复需要核对/修复官方记录实际内容，而不是只看日志阶段）。
 * ★ 并发保护（P1 补丁）：恢复**全程持有统一事务锁**（与手动安装/手动恢复/待生效应用同一把锁），
 *   并在恢复期间置 recovering 标志——两者任意一项即拒绝新的模型修改操作，
 *   杜绝"启动恢复读取旧事务数据的同时新安装覆盖暂存/日志"的竞态窗口。
 * 返回 { action, reason }；action='manual' 时调用方必须阻止继续安装。 */
let _txManualBlocked = false;
export const recoverInterruptedTransaction = async () => {
    const out = await _recoveryGuard.run(async () => {
        const plan = await recoverTx({
            storageOps,
            getBridge: buildBridge,
            contract: await getContract(),
            /* ★ P1-3：读取异常必须可区分于"记录不存在"（抛异常 → 恢复判定为"不可读" → 保守人工处理） */
            readRecord: readOfficialRecordStrict,
            writeRecord: rec => writeJSON(OFFICIAL_KEY, rec),
            removeRecord: () => removeKey(OFFICIAL_KEY),
            verifyRecord: verifyOfficialRecord,
            onStep: m => _log(m, true),
        });
        if (plan && (plan.action === 'manual' || plan.manual === true)) {
            _txManualBlocked = true;
            _log('检测到未完成且无法自动恢复的安装事务：' + (plan.reason || '') + '（已保留恢复数据，暂停自动安装）', true);
        } else if (plan) {
            _txManualBlocked = false;
        }
        return plan;
    });
    if (!out.started) {
        /* 已有事务在运行（极少数启动竞态）：不改动任何数据，保留日志供下次启动恢复 */
        _log('启动恢复被跳过：已有更新任务正在运行（事务数据保留）', true);
        return { action: 'busy', ok: false, reason: '已有更新任务正在运行' };
    }
    return out.value;
};

/* 是否因未完成事务而暂停安装（人工标记内存缓存 + 持久日志双保险；恢复进行中一律暂停） */
const _txBlocked = () => {
    if (_recoveryGuard.blocked() || _txManualBlocked) return true;
    const plan = classifyInterruptedTx(storageOps.readTx());
    return plan.action === 'manual';
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
    /* 长期恢复点：只有安装整体成功后才轮换（P2-1），恢复流程绝不写入 */
    writeBackup: rec => writeJSON(BACKUP_KEY, rec),
    readBackup: () => readJSON(BACKUP_KEY),
    /* 安装事务暂存备份：失败/取消时清除，绝不影响长期恢复点 */
    writeStagingBackup: rec => writeJSON(STAGING_KEY, rec),
    readStagingBackup: () => readJSON(STAGING_KEY),
    removeStagingBackup: () => removeKey(STAGING_KEY),
    /* 安装事务日志（P0-1）：记录事务阶段，供崩溃后重启识别与安全恢复 */
    writeTx: journal => writeJSON(TX_KEY, journal),
    readTx: () => readJSON(TX_KEY),
    removeTx: () => removeKey(TX_KEY),
};

/* ★ P1-1：统一事务锁——下载安装 / 待生效应用 / 恢复备份 共用，
 * 同一时刻只允许一个"修改主模型"的更新事务。
 * ★ P1 补丁：崩溃恢复同样受此锁约束（见 createRecoveryGuard 的使用）。 */
const _tx = createTransactionLock();
const _recoveryGuard = createRecoveryGuard(_tx);
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
        /* ★ P0-1：存在无法自动恢复的未完成事务 → 阻止继续安装（保留恢复数据） */
        if (_txBlocked()) {
            prog.close();
            await styledDialog({
                title: '检测到未完成的安装事务',
                message: '上次安装事务未能自动恢复，为避免覆盖唯一可用的恢复数据，已暂停在线安装。\n\n'
                    + '· 你的长期备份与事务暂存备份均已保留\n'
                    + '· 请重启游戏后再试；若仍无法恢复，可在控制台用 __DJSC.modelUpdate.restoreBackup() 手动还原更新前的模型',
            });
            return { ok: false, err: 'unfinished transaction requires attention' };
        }
        prog.update('下载并校验权重包…');
        const { bundle, res, contract } = await downloadBundle(opt.latest);
        const txId = generateTxId();

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
                dangerous: true, defaultValue: 'keep',
            });
            if (choice !== 'apply') return { ok: false, err: 'user kept local model' };
        }

        const preserveUserModel = !!(det.known && det.isUserModel);
        const baseModelDigest = active ? paramsDigest(active, contract.dims) : null;
        /* ★ P1-1：把本次安装当作一次"已授权事务"，复用 evaluatePending 的授权规则，
         *   在真正写入前重新核对当前模型是否仍是授权时的模型。
         *   authRecord 是**事务内可变状态**：用户重新授权覆盖新模型 B 后必须把授权基线
         *   重绑为 B 的摘要（否则下一次复核仍拿 A 的旧摘要判断，反复弹窗直至达到重建上限）。 */
        let authRecord = buildPendingRecord({
            latest: opt.latest, bundle, baseModelDigest, userAuthorized: true,
            reason: '手动安装', savedAt: Date.now(), contract,
        });
        const finalCheck = async () => {
            const g = await canApplyNow();
            if (!g.ok) return { ok: false, reason: g.reason };
            const cur = await activeParamsNow();
            const curDigest = cur ? paramsDigest(cur, contract.dims) : null;
            const decision = evaluatePending({
                pending: authRecord, contract, currentDigest: curDigest,
                officialRec: readOfficialRecord(), gate: g,
            });
            if (decision.action === 'apply') return { ok: true };
            if (decision.action === 'drop') return { ok: false, reason: decision.reason };
            /* reprompt：等待/确认期间模型已变化 → 必须重新征得用户同意 */
            const choice = await styledDialog({
                title: '当前模型已变化，需要重新确认',
                message: '在你确认安装期间，当前生效模型发生了变化：\n' + decision.reason + '。\n\n'
                    + '· 「保留当前模型」：放弃本次安装，你的当前模型继续生效（推荐）\n'
                    + '· 「仍然安装」：用官方权重替换当前模型（更新前的模型会被备份保存）',
                buttons: [
                    { label: '保留当前模型', value: 'keep', primary: true },
                    { label: '仍然安装', value: 'apply' },
                ],
                dangerous: true, defaultValue: 'keep',
            });
            if (choice !== 'apply') return { ok: false, reason: '用户在模型变化后选择保留当前模型' };
            if (!curDigest) return { ok: false, reason: '无法读取当前模型基线，已中止安装（未做任何改动）' };
            /* 重新授权绑定"即将被覆盖的模型"：事务随后会重建快照与暂存备份（rebaseline） */
            authRecord = reauthorizeRecord(authRecord, curDigest);
            return { ok: true, rebaseline: true };
        };

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
        /* ★ P0-1 / P0-2：单事务完成"取基线 → 备份 → 应用 → 提交记录 → 轮换备份 → 清理"，
         *   最终授权复核返回 rebaseline 时由事务内部重建基线（绝不复用过期快照）。 */
        const r = await applyOfficialBundle({
            bridge, storageOps, bundle, decoded: res.decoded, dims: contract.dims,
            probe: res.probe, runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion,
            mode: 'install', preserveUserModel, txId,
            /* ★ P0-1：把安装前的官方记录纳入事务恢复信息（崩溃恢复"回滚模型+恢复旧记录"的依据） */
            prevOfficialRecord: rec,
            confirmBeforeWrite: finalCheck,
            commitRecord: async info => writeOfficialRecordVerified(bundle, info.digest, info.size, contract),
            revertRecord: async () => _restoreOfficialRecord(rec),
            onStep: m => prog.update(m),
        });
        prog.close();
        if (r.ok) {
            removeKey(PENDING_KEY);
            await styledDialog({
                title: '模型权重更新完成',
                message: '新模型权重已生效：' + bundle.modelVersion + '\n\n'
                    + '· 已通过结构 / 体积 / SHA-256 / 数值有限性 / 前向自检\n'
                    + '· 版本记录已写入并读回核对通过\n'
                    + '· 长期备份已轮换为更新前的模型\n'
                    + '· 优化器状态已重置，后续本地训练从新权重继续\n'
                    + '· 重启游戏后仍会加载该权重',
            });
            return { ok: true, applied: true, modelVersion: bundle.modelVersion, txId: r.txId };
        }
        await styledDialog({
            title: '安装未完成',
            message: '新权重未通过校验或提交步骤失败。'
                + (rollbackStatusText(r) || '已尝试回滚（未能完全确认，请重启游戏后检查模型状态）。')
                + (r.partialWrite ? '\n（检测到写入过程已产生部分修改，已尝试恢复）' : '')
                + '\n\n原因：\n' + (r.errors || []).join('\n'),
        });
        return { ok: false, errors: r.errors, rolledBack: r.rolledBack, partialWrite: !!r.partialWrite, failedAt: r.failedAt, rollbackStatus: r.rollbackStatus };
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
    /* ★ P1-3：上次回滚未完成的任务被置为 hold —— 不再自动重试（避免配额不足时反复损坏数据），
     *   同时保留待生效记录与备份供人工/重新下载恢复。 */
    if (pending.hold === true) {
        _stopPendingWatch();
        return { ok: false, skipped: true, reason: '待生效任务处于保留状态（上次回滚未完成），请重启或重新下载后处理' };
    }
    /* ★ P0-1：存在无法自动恢复的未完成安装事务 → 阻止继续安装（保留恢复数据） */
    if (_txBlocked()) {
        _stopPendingWatch();
        return { ok: false, skipped: true, reason: '存在未完成的安装事务，已暂停自动安装以避免覆盖恢复数据' };
    }
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
    /* 当前模型与授权基线不一致 → 必须重新征得用户同意，不得静默覆盖 */
    let authorized = pending;
    if (decision.action === 'reprompt') {
        const choice = await styledDialog({
            title: '待生效权重需要重新确认',
            message: '你之前下载的模型权重已就绪，但这期间当前生效模型发生了变化：\n' + decision.reason + '。\n\n'
                + '· 「保留当前模型」：放弃本次待生效权重，你当前的模型继续生效（推荐）\n'
                + '· 「仍然安装」：用待生效的官方权重替换当前模型（更新前的模型会被备份保存）',
            buttons: [
                { label: '保留当前模型', value: 'keep', primary: true },
                { label: '仍然安装', value: 'apply' },
            ],
            dangerous: true, defaultValue: 'keep',
        });
        if (choice !== 'apply') { removeKey(PENDING_KEY); return { ok: false, err: 'user kept local model' }; }
        /* 用户重新授权"当前模型" → 重绑授权基线（与手动安装共用同一原则），避免最终复核再次误判 */
        if (!currentDigest) return { ok: false, skipped: true, reason: '无法读取当前模型基线' };
        authorized = reauthorizeRecord(pending, currentDigest);
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
    const txId = generateTxId();
    const r = await applyOfficialBundle({
        bridge, storageOps, bundle: pending.bundle, decoded: res.decoded, dims: contract.dims,
        probe: res.probe, runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion,
        mode: 'install', preserveUserModel: !!(det.known && det.isUserModel), txId,
        /* ★ P0 / P1-1：真正写入前再次用同一套授权规则复核状态与模型基线；
         * 若复核期间模型再次变化 → 返回 rebaseline，由事务重建基线（不复用过期快照）。 */
        confirmBeforeWrite: async () => {
            const g = await canApplyNow();
            if (!g.ok) return { ok: false, reason: g.reason };
            const cur = await activeParamsNow();
            const curDigest = cur ? paramsDigest(cur, contract.dims) : null;
            const d2 = evaluatePending({ pending: authorized, contract, currentDigest: curDigest, officialRec: readOfficialRecord(), gate: g });
            if (d2.action === 'apply') return { ok: true };
            if (d2.action === 'drop') return { ok: false, reason: d2.reason };
            /* reprompt：复核期间模型又变化 → 重新征询，并请求重建事务基线 */
            const choice = await styledDialog({
                title: '当前模型又发生变化，需要重新确认',
                message: '在你确认安装期间，当前生效模型再次发生了变化：\n' + d2.reason + '。\n\n'
                    + '· 「保留当前模型」：放弃本次安装，你的当前模型继续生效（推荐）\n'
                    + '· 「仍然安装」：用官方权重替换当前模型（更新前的模型会被重新备份保存）',
                buttons: [
                    { label: '保留当前模型', value: 'keep', primary: true },
                    { label: '仍然安装', value: 'apply' },
                ],
                dangerous: true, defaultValue: 'keep',
            });
            if (choice !== 'apply') return { ok: false, reason: '用户在模型再次变化后选择保留当前模型' };
            if (!curDigest) return { ok: false, reason: '无法读取当前模型基线，已中止（未做任何改动）' };
            authorized = reauthorizeRecord(authorized, curDigest);
            return { ok: true, rebaseline: true };
        },
        /* ★ P0-1：安装前的官方记录纳入事务恢复信息 */
        prevOfficialRecord: officialRec,
        commitRecord: async info => writeOfficialRecordVerified(pending.bundle, info.digest, info.size, contract),
        revertRecord: async () => _restoreOfficialRecord(officialRec),
    });
    if (r.ok) {
        _finishPendingTx(r);
        await styledDialog({ title: '模型权重已生效', message: '已应用待生效的模型权重：' + pending.bundle.modelVersion + '\n\n（版本记录已写入并读回核对通过）' });
        return r;
    }
    _finishPendingTx(r);
    await styledDialog({
        title: r.rollbackStatus === 'complete' ? '权重应用失败（已回滚）' : '权重应用失败（回滚不完整，请重启检查）',
        message: (rollbackStatusText(r) || '已尝试回滚（未能完全确认，请重启游戏后检查模型状态）。')
            + (r.partialWrite ? '\n（检测到写入过程已产生部分修改，已尝试恢复）' : '')
            + '\n\n原因：\n' + (r.errors || []).join('\n'),
    });
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
        dangerous: true, defaultValue: 'no',
    });
    if (need !== 'go') return { ok: false, err: 'cancelled' };
    const gate = await canApplyNow();
    if (!gate.ok) { styledDialog({ title: '暂时无法还原', message: '当前' + gate.reason + '，请稍后再试。' }); return { ok: false, err: gate.reason }; }
    const bundleLike = { params: rec.params, trained: (rec.meta && rec.meta.trained) || 0, accuracy: (rec.meta && rec.meta.accuracy) || 0, size: 0 };
    const decoded = decodeBackupParams(rec, contract.dims);
    if (!decoded) { styledDialog({ title: '备份已损坏', message: '备份参数不完整，无法还原。' }); return { ok: false, err: 'backup corrupt' }; }
    /* ★ P1：模型恢复与官方记录清理属于**同一个恢复事务**。
     * 记录清理失败 → 事务回滚模型恢复（使用本次操作开始前的完整运行时快照），
     * 并恢复记录，绝不留下"模型 A 已恢复、记录仍指向 B"的不一致状态。 */
    const prevRec = readOfficialRecord();
    const r = await applyOfficialBundle({
        bridge, storageOps, bundle: bundleLike, decoded, dims: contract.dims, probe: null,
        runtimeEpoch: contract.dataEpoch, schemaVersion: contract.schemaVersion,
        mode: 'restore', preserveUserModel: true,
        confirmBeforeWrite: async () => (await canApplyNow()).ok,
        commitRecord: async () => _clearOfficialRecordVerified(),
        revertRecord: async () => _restoreOfficialRecord(prevRec),
    });
    if (r.ok) {
        await styledDialog({ title: '已还原', message: '已恢复更新前的模型（官方权重记录已清除并读回确认，原备份仍保留）。' });
    } else if (r.failedAt === 'record') {
        await styledDialog({
            title: '还原未完成（官方记录未能清理）',
            message: '模型已恢复，但官方版本记录未能清除并核验：\n' + (r.errors || []).join('\n')
                + '\n\n为避免"模型与版本记录不一致"，' + (rollbackStatusText(r) || '已尝试回滚（未能完全确认，请重启游戏后检查）。')
                + '\n\n原长期备份未被修改。',
        });
    } else {
        await styledDialog({
            title: '还原失败',
            message: (rollbackStatusText(r) || '已尝试回滚（未能完全确认，请重启游戏后检查模型状态）。')
                + '原长期备份未被修改。\n\n原因：\n' + (r.errors || []).join('\n'),
        });
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
    txJournal: storageOps.readTx(),
    txAction: classifyInterruptedTx(storageOps.readTx()).action,
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
        /* 对局生命周期订阅：
         *  ① 宿主真实每局开始通道 lib.announce（'Noname.Game.Event.GameStart'）；
         *  ② 扩展自身事件总线（可重订阅、幂等）；
         *  门禁本身以宿主实时信号 `_status.gameStarted` / `_status.over` 为准。 */
        _disposed = false;
        _ensureAnnounce();
        if (!_ensureBus()) {
            let n = 0;
            _busTimer = setInterval(function () {
                if (_disposed || _ensureBus() || ++n > 20) { if (_busTimer) clearInterval(_busTimer); _busTimer = null; }
            }, 1000);
        }
        /* 启动时：先按事务日志恢复未完成的安装事务（**恢复全程持统一事务锁**，
         * 期间新的安装/恢复/待生效应用一律被拒绝），再尝试应用待生效权重，最后按 6 小时节流静默检查 */
        if (readPending()) _startPendingWatch();
        const ts = parseInt(safeGet(CHECK_TS_KEY) || '0', 10) || 0;
        recoverInterruptedTransaction().catch(_swallow).then(() => {
            return tryApplyPending().catch(_swallow);
        }).then(() => {
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
    _dropAnnounce();
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
