import {settleDecisionContext} from '../features/autoFeature.js?v=41a';
import {beginModeContext,modeSampleMeta} from '../../foundation/runtime/modeContext.js?v=41a';
import {identityModelCompatibility} from '../features/identityCompatibility.js?v=41a';
import {publicIdentityRole} from '../../perception/observer/identityFacts.js?v=41a';
import { runtimePerformance } from '../../foundation/diag/performanceCore.js?v=41a';

/* ===== 阵营（camp）推导（4.1.5.2）=====
 * 身份场：zhu/zhong → lord（主公方），fan → rebel（反贼方），nei → nei（内奸）
 * 其他模式（斗地主等）：landlord / farmer
 * 目的：标签从「个人胜/负」升级为「阵营胜负」（winCamp / campWon），供后端分层训练。 */
function _campOf(p) {
    try {
        const id = (p && p.identity) || '';
        if (id === 'zhu' || id === 'zhong' || id === 'mingzhong') return 'lord';
        if (id === 'fan') return 'rebel';
        if (id === 'nei') return 'nei';
        if (id === 'dizhu' || id === 'landlord') return 'landlord';
        if (id === 'farmer' || id === 'nongmin') return 'farmer';
        if (p && p.isZhu === true) return 'landlord';
        return null;
    } catch (e) { return null; }
}
/* 终局获胜阵营：优先看宿主各玩家的 win 标记，兜底用采样者自身胜负 */
function _winCampOf(me, won) {
    try {
        const camp = _campOf(me);
        const ps = (typeof game !== 'undefined' && game && Array.isArray(game.players)) ? game.players : [];
        const seen = {};
        for (let i = 0; i < ps.length; i++) {
            const p = ps[i];
            if (!p || p.win !== true) continue;
            const c = _campOf(p);
            if (c) seen[c] = 1;
        }
        const camps = Object.keys(seen);
        if (camps.length) return camps.indexOf(camp) >= 0 ? camp : camps[0];
        if (typeof won === 'boolean' && camp) return won ? camp : null;
        return null;
    } catch (e) { return null; }
}
/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { createSaveRetry } from './saveRetry.js?v=41a';
import { buildActionCreditLedger } from './actionCredit.js?v=41a';
import { createTrainingDBConnection } from './trainingDBConnection.js?v=41a';
import { game } from '../../foundation/adapt/host.js?v=41a';
import { writeTrainingSnapshot } from './trainingExportFile.js?v=41a';
import { createSamplePersistence } from './samplePersistence.js?v=41a';
import { sampleDigest, isCloudArchived } from './cloudSampleState.js?v=41a';
import { log } from '../../foundation/diag/logger.js?v=41a';  /* ★ 自动导出/清理日志走统一日志分级 */
import { cfg } from '../../foundation/config/util.js?v=41a';    /* ★ 读取配置（满额一条龙需要群号等） */
import { dirOf, downloadText, fileOf } from '../../foundation/storage/storagePaths.js?v=41a';  /* ★ 统一导出路径（手机端兜底下载） */
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js?v=41a';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */
import { FEATURE_DIM } from '../features/features.js?v=41a';  /* ★ 4.0.24 根因修复：维度单一来源改从 features.js 导入（130→134，fix7 目标身份四维）。旧硬编码 130 与 features.js 134 失配，导致 trainRecordSample 入口全拒、样本线 15:18 起全灭 */
import { adaptToCurrentDim } from '../features/dimensionAdapter.js?v=41a';

/* ================= 训练数据缓冲（1万样本自动导出版） ================= */

const MAX_SAMPLES = 10000;  /* 满额暂停新增并尝试按批导出；未经核验不清理 */
const REWARD_BOUND = 147;   /* ★ 奖励上界：决策引擎会给"必胜/击杀"加 +999 灌爆得分(≈1003)，
                             * 而 _scoreToLabel(6档) 与 TD 归一化(÷147) 均按 -127..127 设计。
                             * 入库/导出前统一切到该量纲，避免极端值主导标签与价值目标。 */
const STORAGE_KEY = 'djsc_training_samples_v1';

/* ★ IndexedDB 封装（替换 localStorage，支持3万+样本）。
 * 优化：所有读写共用单例连接，避免高频训练记样本时反复 indexedDB.open。 */
// 作者：飞升原创 | License: GPL-3.0
const DB_NAME = 'djsc_ai_db';
const DB_STORE = 'samples';
const samplePersistence = createSamplePersistence();
let _trainingGeneration = 0, _clearTask = null, _clearResetCounters = false;
let _lastClearStatus = '尚未清空';
let _dbReady = false;
let _dbInstance = null;   /* ★ 单例连接：初始化一次后复用，不再每次 open */

const dbConnection = createTrainingDBConnection({
    provider: () => typeof indexedDB === 'undefined' ? null : indexedDB,
    lost: () => { _dbReady = false; _dbInstance = null; },
});
function getDB() { return dbConnection.current(); }
async function initDB() {
    const db = await dbConnection.open();
    _dbInstance = db; _dbReady = true;
    return db;
}

/* 从游标读取原有主键；旧版自增记录无需重建数据库。 */
async function getAllSamplesAsync() {
    try { await _dbInit; } catch (_) { return []; }
    const db = getDB();
    if (!_dbReady || !db) return [];
    return new Promise((resolve) => {
        let timer, done = false;
        const finish = result => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
        try {
            const tx = db.transaction(DB_STORE, 'readonly');
            const rows = [];
            timer = setTimeout(() => { finish([]); try { tx.abort(); } catch (_) {} dbConnection.invalidate(); }, 8000);
            const request = tx.objectStore(DB_STORE).openCursor();
            request.onsuccess = () => {
                if (done) return;
                const cursor = request.result;
                if (!cursor) return;
                const sample = cursor.value;
                if (sample && typeof sample === 'object') samplePersistence.loaded(sample, cursor.primaryKey);
                rows.push(sample);
                cursor.continue();
            };
            tx.oncomplete = () => finish(rows);
            tx.onerror = tx.onabort = () => finish([]);
        } catch (_) { finish([]); }
    });
}

const _dbInit = initDB();
// 启动失败由保存重试恢复连接；避免尚无样本时出现未处理拒绝。
void _dbInit.catch(() => {});

/* ★ 从 IndexedDB 加载全部样本（优先），失败则回退 localStorage（兼容旧版）
 * 注意：模块加载时 initDB 尚未完成，因此任何时候都发起一次异步 DB 读；读不到再回退 */
function loadFromStorage() {
    const generation = _trainingGeneration;
    return getSamplesAsyncFromDB().then(function (arr) {
        if (generation !== _trainingGeneration && !_clearTask) return;
        if (Array.isArray(arr) && arr.length) {
            const san = _sanitizeBuffer(arr);
            BUFFER = san.list.concat(BUFFER);
            _loadFromStorageFallback();
            _keyIndex.clear();
            if (san.repaired||san.dimAdaptedCount) saveToStorage();
            /* 内存索引在下次 push 时按需重建 */
            console.log('[trainExport] ✅ 从 IndexedDB 加载了 ' + BUFFER.length + ' 条历史样本' +
                ((san.repaired || san.dropped||san.dimAdaptedCount) ? '（数据隔离：修复 reward ' + san.repaired + ' 条，适配历史维度 '+san.dimAdaptedCount+' 条，丢弃污染 ' + san.dropped + ' 条）' : ''));
            // Keep the fallback: the DB may be older after a failed transaction.
        } else {
            _loadFromStorageFallback();
        }
    });
}

function _loadFromStorageFallback() {
    try {
        const raw = _lsGet(STORAGE_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                /* Restore all compatible legacy records; capacity controls collection, not recovery. */
                const san = _sanitizeBuffer(arr);
                const restored = san.list;
                const byKey = new Map(BUFFER.map(sample => [samplePersistence.fallbackValue(sample)._storageKey, sample]));
                for (const sample of restored) {
                    const key = sample._storageKey;
                    const prior = key === undefined ? null : byKey.get(key);
                    if (prior && (sample._dataRevision || 0) <= (prior._dataRevision || 0)) continue;
                    samplePersistence.dirty(sample);
                    if (prior) BUFFER[BUFFER.indexOf(prior)] = sample;
                    else BUFFER.push(sample);
                    if (key !== undefined) byKey.set(key,sample);
                }
                saveToStorage();
                _keyIndex.clear();
                console.log('[trainExport] ✅ 从本地加载了 ' + BUFFER.length + ' 条历史样本（回退模式）' +
                    ((san.repaired || san.dropped||san.dimAdaptedCount) ? '（数据隔离：修复 reward ' + san.repaired + ' 条，适配历史维度 '+san.dimAdaptedCount+' 条，丢弃污染 ' + san.dropped + ' 条）' : ''));
            }
        }
    } catch (e) {
        console.warn('[trainExport] 加载历史样本失败：', e);
    }
}

/* ★ 从 IndexedDB 批量读取全部样本（复用单例连接，与 getAllSamplesAsync 等价） */
function getSamplesAsyncFromDB() {
    return getAllSamplesAsync();
}

/* ★ 保存样本：优先 IndexedDB（大数据承载，避免 localStorage 配额爆满），
 * 不可用时回退 localStorage 并裁剪到安全数量，杜绝 QuotaExceededError 拖垮主程序。
 * 防抖优化，避免频繁序列化卡顿 */
let _saveTimer = null;
function saveToStorage() {
    if (_clearTask) return;
    try {
        /* ★ 防抖：1秒内多次调用只保存一次 */
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function () {
            /* ★ 卡顿修复：IndexedDB 已接管持久化时跳过 localStorage 兜底——
             *   兜底会对数千条样本做全量 JSON.stringify（数 MB 字符串），
             *   游戏中每秒防抖一次、样本随局数累积 → 「越打越卡」的主因。
             *   IndexedDB 写入异步失败时 _persistToDB 的 onerror 内自行兜底。 */
            let _dbTook = false;
            try { _dbTook = _persistToDB(); } catch (ePDb) { _dbTook = false; }
            if (!_dbTook) _persistToLocalStorageFallback();
        }, 1000);
    } catch (e) {
        console.warn('[trainExport] 保存样本失败：', e);
    }
}

const saveRetry = createSaveRetry({
    pending: () => BUFFER.some(sample => !sample._persisted),
    save: async () => {
        const timing = runtimePerformance.start('training.dbSave', { detached: true });
        try { const db = await initDB(); return await samplePersistence.flush(db, () => BUFFER); }
        finally { runtimePerformance.end(timing); }
    },
    backup: () => _persistToLocalStorageFallback(),
    failed: () => dbConnection.invalidate(),
});
async function _persistToDB() {
    const result = await saveRetry.run();
    if (result.ok && result.pending) saveToStorage();
    return result;
}
export async function trainRetrySave() {
    if (_clearTask) return { ok: false, err: '正在清空训练样本', saving: trainingSaveStatus(), clearing: !!_clearTask, lastClear: _lastClearStatus };
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _persistToLocalStorageFallback();
    const result = await saveRetry.run({ manual: true });
    if (result.ok && result.pending) saveToStorage();
    return { ...result, saving: trainingSaveStatus() };
}
function trainingSaveStatus() {
    const state = saveRetry.status();
    const labels = { idle: '等待保存', saving: '正在保存', saved: '已保存', pending: '仍有更新待保存', retrying: '等待自动重试', paused: '连续失败，自动重试已暂停', clearing: '正在清空训练样本' };
    return { ...state, label: labels[state.phase], pending: BUFFER.filter(sample => !sample._persisted).length,
        fallback: {..._fallbackStatus}, connected: !!getDB() };
}

/* 完整兜底：原子写入并读回；配额失败保留已有备份和内存，绝不裁剪
 * ★ P2-31：中央存储 safeSet 不抛异常而以 false 表达失败，故按返回值判定重试，
 *   不能再依赖 catch（旧直调 localStorage 时靠 QuotaExceededError 进裁剪分支）。 */
let _fallbackStatus = {complete:false,count:0,error:''};
function _persistToLocalStorageFallback() {
    if (_clearTask) return;
    const timing = runtimePerformance.start('training.backup');
    try {
        // Atomic full backup only. Never replace a good backup with a truncated suffix.
        const data = BUFFER.map(sample => samplePersistence.fallbackValue(sample));
        const raw = JSON.stringify(data);
        if (_lsSet(STORAGE_KEY, raw) && _lsGet(STORAGE_KEY) === raw) {
            _fallbackStatus = {complete:true,count:data.length,error:''};
            return true;
        }
        _fallbackStatus = {complete:false,count:0,error:'完整备份写入失败，旧备份与内存保留'};
        return false;
    } catch (e) {
        console.warn('[trainExport] 保存样本失败：', e);
        _fallbackStatus = {complete:false,count:0,error:'完整备份异常，旧副本保留'};
    } finally { runtimePerformance.end(timing); }
}

/* ★ 数据隔离（v3.1α）：旧版本样本存在 reward 写入 bug（reward 恒 ~100，与 meta.score 完全脱节），
 * 客户设备上的旧 IndexedDB/localStorage 样本及旧导出文件若原样进入 BUFFER，会污染在线训练与再导出。
 * 权威值是 meta.score（±147 裁剪前的原始评分，pushSample 里 r=score|0 截断、m.score=Math.round），
 * 两者正常差 ≤1（截断 vs 取整）；超过即判旧版污染并以 score 修复；无 score 依据且 reward 非法的丢弃。
 * 启动加载与手动导入统一过 _sanitizeSample，实现新旧版本数据隔离。 */
const REWARD_REPAIR_TOL = 1;
function _sanitizeSample(s) {
    if (!s || typeof s !== 'object') return { sample: null };
    const f = s.f || s.features;
    const adapted = adaptToCurrentDim({...s,f});
    if(adapted.error)return {sample:null,...(adapted.error==='invalid-features'?{nonFinite:true}:{wrongDim:true})};
    const ms = s.m && s.m.score;
    let r = (typeof s.r === 'number') ? s.r : ((typeof s.reward === 'number') ? s.reward : NaN);
    let repaired = false;
    if (s.m?.rewardSchema !== 'action-outcome-v1' && typeof ms === 'number' && Number.isFinite(ms)) {
        const rFixed = _clampR(Math.round(ms), -REWARD_BOUND, REWARD_BOUND);
        if (!Number.isFinite(r) || Math.abs(r - rFixed) > REWARD_REPAIR_TOL) { r = rFixed; repaired = true; samplePersistence.dirty(s); }
    }
    if (!Number.isFinite(r)) return { sample: null, nonFinite: true };
    s.f = Array.from(adapted.sample.f);
    if(adapted.sample._dimAdapted===true){
        s._dimAdapted=true;s._originalDim=adapted.sample._originalDim;
        s._missingFeatureIndices=adapted.sample._missingFeatureIndices?.slice()||[130,131,132,133];
    }
    if(adapted.adapted)samplePersistence.dirty(s);
    s.r = _clampR(Math.round(r), -REWARD_BOUND, REWARD_BOUND);
    return { sample: s, repaired: repaired, adapted:adapted.adapted };
}

function _sanitizeBuffer(arr) {
    const list = [];
    let repaired = 0, dropped = 0, dimMismatch = 0, dimAdaptedCount=0;
    for (let i = 0; i < arr.length; i++) {
        const r = _sanitizeSample(arr[i]);
        if (!r.sample) { dropped++; continue; }
        /* 入库统一为正式维度；历史130维已由显式适配保留缺失身份标记。 */
        if (r.sample.f && Array.isArray(r.sample.f) && r.sample.f.length !== FEATURE_DIM) { dimMismatch++; continue; }
        if (r.repaired) repaired++;
        if(r.adapted)dimAdaptedCount++;
        list.push(r.sample);
    }
    if (dimMismatch) console.log('[trainExport] 丢弃旧维度样本 ' + dimMismatch + ' 条（当前 FEATURE_DIM=' + FEATURE_DIM + '）');
    return { list: list, repaired: repaired, dropped: dropped, dimMismatch: dimMismatch, dimAdaptedCount };
}

/* 导入只恢复白名单训练字段，不能相信文件携带的数据库主键/已保存标记。 */
function _normalizeImportedSample(raw) {
    const source = { ...raw, m: raw.m || raw.meta || null };
    const sanitized = _sanitizeSample(source);
    if (!sanitized.sample) return sanitized;
    const valid = (value, fallback, check) => value === undefined ? fallback : check(value) ? value : undefined;
    const target = valid(raw.value_target, null, x => x === null || (typeof x === 'number' && Number.isFinite(x) && x >= -1 && x <= 1));
    const confidenceDefault = source.m && typeof source.m.conf === 'number' && Number.isFinite(source.m.conf) && source.m.conf >= 0 && source.m.conf <= 1 ? source.m.conf : 0.3;
    const conf = valid(raw.conf, confidenceDefault, x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1);
    const count = valid(raw.count, 1, x => Number.isSafeInteger(x) && x > 0);
    const ts = valid(raw.ts, Date.now(), x => typeof x === 'number' && Number.isFinite(x) && x >= 0);
    const fbAsync = valid(raw.fbAsync, false, x => typeof x === 'boolean');
    if ([target, conf, count, ts, fbAsync].some(x => x === undefined) || (fbAsync && target === null)) return { sample: null, invalidLabels: true };
    return { ...sanitized, sample: { f: source.f.slice(), r: source.r, m: source.m,
        value_target: target, fbAsync, conf, count, ts, _persisted: false,
        ...(source._dimAdapted===true?{_dimAdapted:true,_originalDim:source._originalDim,_missingFeatureIndices:source._missingFeatureIndices.slice()}:{}) } };
}

function _importMergeKey(sample) {
    // 保留完整元数据差异，包括玩家、局标识、事务号、目标和执行状态。
    const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
    return JSON.stringify([sample.f, sample.r, ordered(sample.m || null), sample.value_target ?? null,
        sample.fbAsync === true, sample.conf ?? 0.3]);
}

let BUFFER = [];
let _keyIndex = new Map();  /* 特征去重索引：key -> sample，避免每次 push O(N) 重建 join */
let _exportCount = 0;
let _autoExportTask = null, _nextAutoExportAt = 0, _pausedSamples = 0;
let _lastExportStatus = '尚未导出';
const AUTO_EXPORT_RETRY_MS = 60000;

/* 启动时自动加载历史样本 */
const _startupLoad = loadFromStorage();

/* ★ 自动推断场景标签：根据meta里的action/id判断当前是什么决策场景 */
function _inferScene(meta) {
    if (!meta) return 'unknown';
    if (meta.scene) return meta.scene;
    const action = (meta.action || '').toLowerCase();
    const id = (meta.id || '').toLowerCase();
    const reason = (meta.reason || '').toLowerCase();

    // 【身份感知维度】身份判断场景
    if (reason.includes('身份') || reason.includes('identity') || id.includes('identity') || reason.includes('忠臣') || reason.includes('反贼') || reason.includes('内奸')) return 'identity';
    // 【铁索维度】铁索连环场景
    if (id.includes('tiesuo') || id.includes('ironchain') || reason.includes('铁索') || reason.includes('连环') || reason.includes('重置')) return 'tiesuo';
    // 【出牌顺序维度】顺序场景
    if (reason.includes('顺序') || reason.includes('order') || reason.includes('先后') || reason.includes('酒杀') || reason.includes('先杀后酒')) return 'order';
    // 【开局维度】开局选牌场景
    if (reason.includes('开局') || reason.includes('opening') || reason.includes('首回合') || reason.includes('盲打') || reason.includes('第一回合')) return 'opening';
    // 杀/闪/酒选择场景
    if (id.includes('sha') || id.includes('shan') || id.includes('jiu') || reason.includes('杀') || reason.includes('闪') || reason.includes('酒')) return 'kill';
    // 技能使用场景
    if (action === 'skill') return 'skill';
    // 出牌场景
    if (action === 'card') return 'card';
    return 'general';
}

export function pushSample(features, reward, meta) { return !!_pushSample(features, reward, meta); }
function _pushSample(features, reward, meta) {
    const compatibility = identityModelCompatibility();
    const _isIdentityMode = meta?.modeContext?.mode === 'identity';
    /* ★ 4.1.5.2：身份场推理仍暂停；cfg('identitySampling') 打开后只放行训练样本（带 camp/winCamp） */
    if (_isIdentityMode ? !cfg('identitySampling', false) : !compatibility.sampleAllowed) {
        _diagBump(_sampleDiag.rejected,(meta?.action || 'unknown') + ':identity-feature-schema-migration');
        return false;
    }
    if (_clearTask) return false;
    const arr = new Array(features.length);
    for (let i = 0; i < features.length; i++) arr[i] = features[i] | 0;
    
    /* ★ 奖励切到设计量纲 [-REWARD_BOUND, REWARD_BOUND]，杜绝引擎"必胜+999"极端值
     *   主导 _scoreToLabel 6档标签与 TD(value_target) 归一化 */
    const reward0 = reward | 0;
    const rBound = reward0 > REWARD_BOUND ? REWARD_BOUND : (reward0 < -REWARD_BOUND ? -REWARD_BOUND : reward0);
    
    /* ★ 精确样本合并：特征 + reward + player + action + id 相同才合并 */
    const rewardKey = rBound;
    const playerKey = (meta && meta.player) || '';
    const actionKey = (meta && meta.action) || '';
    const idKey = ((meta && meta.id) || '') + '\u0001' + ((meta && meta.sessionId) || '') + '\u0001' + ((meta && meta.transactionId) || '') + '\u0001' + JSON.stringify(meta && meta.target || null) + '\u0001' + ((meta && meta.actorId) || '');
    /* 用 \u0001 作分隔防止字段拼接碰撞 */
    const key = arr.join(',') + '\u0001' + rewardKey + '\u0001' + playerKey + '\u0001' + actionKey + '\u0001' + idKey;
    
    /* ★ O(1) 命中：直接让已有样本计数+1，不用 O(N) 扫描重建 join */
    const existing = _keyIndex.get(key);
    if (existing !== undefined) {
        existing.count = (existing.count || 1) + 1;  // 计数+1
        // Preserve capture timestamp; content fingerprint identifies revisions.
        samplePersistence.dirty(existing);                  /* ★ 增量持久化：更新过就要重新落库 */
        saveToStorage();
        return existing;
    }
    
    if (BUFFER.length >= MAX_SAMPLES) {
        _pausedSamples++;
        _lastExportStatus = '容量不足：保留全部旧样本，暂停新增；等待可靠存储或核验导出';
        saveToStorage();
        if (!_autoExportTask && Date.now() >= _nextAutoExportAt) void autoExportFullBuffer();
        return false;
    }

    const sample = {
        f: arr,
        r: rBound,
        m: meta || null,
        conf: (meta && meta.conf && !isNaN(meta.conf)) ? meta.conf : 0.3,  /* ★ 存置信度，默认30% */
        value_target: meta?.rewardSchema === 'action-outcome-v1' && meta.rewardStatus === 'observed' && Number.isFinite(meta.observedValueTarget) ? _clampR(meta.observedValueTarget, -1, 1) : null,
        fbAsync: meta?.rewardSchema === 'action-outcome-v1' && meta.rewardStatus === 'observed',
        count: 1,
        ts: Date.now(),
        _persisted: false,  /* ★ 增量持久化：新样本默认未落库，_persistToDB 只写未持久化的 */
        scene: _inferScene(meta),  /* ★ 自动推断场景标签 */
        r0: reward0,   /* ★PR7d：钳制前原始 reward（血缘：公式变了可用 r0 重算） */
        gen: {   /* ★PR7d：生成指纹——build=客户端构建号，fv=特征维度版本，formula=label/reward 公式标识 */
            build: (typeof window !== 'undefined' && window.__DJSC) ? ((window.__DJSC.VERSION || 'v?') + '@' + (window.__DJSC.BUILD_DATE || '')) : 'unknown',
            fv: features.length,
            formula: 'reward=action-outcome-v1(clamp|REWARD_BOUND|); label=_scoreToLabel(reward); vt=observedValueTarget/44.1',
        },
    };
    BUFFER.push(sample);
    _keyIndex.set(key, sample);
    /* ★ 自动保存到本地 */
    saveToStorage();
    return sample;
}

/* ★ 满额一条龙：导出完成后告知用户，并支持一键复制群号
 *   限制说明：无名杀是本地沙箱，没有 QQ 开放接口，无法"自动上传到群"；
 *   这里把能自动化的都做完（导出 + 弹窗 + 一键复制群号 + 指引），最后一步发送由用户完成。 */
function _copyText(t) {
    try {
        if (typeof game !== 'undefined' && game && typeof game.copy === 'function') { game.copy(t, '', ''); return true; }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return true; }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    try {
        if (typeof document === 'undefined' || !document.createElement) return false;
        const ta = document.createElement('textarea');
        ta.value = t; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch (e) { return false; }
}

function _oneStopShare(exportResult) {
    try {
        const group = String((cfg('qqGroup', '') || '')).trim();
        const file = (exportResult && exportResult.file) || '（文件名见日志）';
        let msg = '📦 训练样本已满 ' + MAX_SAMPLES + ' 条，已自动导出：\n' + file + '\n\n';
        if (group) {
            msg += '点“确定”复制交流群号（' + group + '），把导出的文件发到群里即可贡献样本。';
            let go = true;
            try { go = (typeof confirm === 'function') ? !!confirm(msg) : true; } catch (e) { go = true; }
            if (go) {
                const copied = _copyText(group);
                try {
                    if (typeof alert === 'function') alert(copied ? ('✅ 群号已复制：' + group + '\n请把导出的文件发到群里。') : ('群号：' + group + '（复制失败，请手动记录）'));
                } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            }
        } else {
            msg += '（未配置交流群号：可在扩展设置里填写“交流群号”后自动支持一键复制）';
            try { if (typeof alert === 'function') alert(msg); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function bufferSize() { return BUFFER.length; }
function clearTrainingSamples(resetCounters = false) {
    if (_clearTask) { _clearResetCounters = _clearResetCounters || resetCounters; return _clearTask; }
    _clearResetCounters = resetCounters;
    _trainingGeneration++;
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _autoExportTask = null; // 旧导出回调通过代次检查失效。
    _lastClearStatus = '正在清空数据库和本地备份';
    const task = Promise.resolve().then(async () => {
        await saveRetry.suspend();
        try {
            await _startupLoad; // 旧读取完成后再清库，不允许迟到数据在成功后恢复。
            const db = await initDB();
            await samplePersistence.clear(db);
            if (!_lsRemove(STORAGE_KEY)) throw new Error('数据库已清空，但本地备份删除失败');
            if (_clearResetCounters && !_lsRemove('djsc_training_export_count')) throw new Error('重置计数删除失败');
            const removed = BUFFER.length;
            BUFFER = []; _keyIndex.clear();
            _pausedSamples = 0; _nextAutoExportAt = 0;
            if (_clearResetCounters) _exportCount = 0;
            _lastExportStatus = '训练样本已清空，等待新样本';
            _lastClearStatus = '数据库、内存和本地备份已清空';
            return { ok: true, count: 0, removed };
        } catch (e) {
            // 清理超时/部分失败时不能把内存丢弃；重新写回可修复不确定的迟到删除。
            BUFFER.forEach(sample => samplePersistence.dirty(sample));
            _lastClearStatus = '清空未完成，内存样本保留：' + String(e.message || e);
            dbConnection.invalidate();
            return { ok: false, count: BUFFER.length, err: String(e.message || e) };
        } finally { saveRetry.resume(); }
    });
    _clearTask = task;
    void task.then(result => {
        if (_clearTask !== task) return;
        _clearTask = null;
        if (!result.ok) { _persistToLocalStorageFallback(); saveToStorage(); }
    });
    return task;
}
export function bufferClear() { return clearTrainingSamples(false); }
export function resetAll() { return clearTrainingSamples(true); }
export function getSamples() { return BUFFER; }
export async function trainingSamplesReady() { await _startupLoad; }
export async function persistCloudConfirmations(entries) {
    const changes=[];
    for (const {sample,fp} of entries) {
        const value={fp,digest:sampleDigest(sample)};
        changes.push({sample,key:'_cloudAck',previous:sample._cloudAck,value});
        sample._cloudAck=value;
        samplePersistence.dirty(sample);
    }
    return persistMetadataChanges(changes);
}
export async function persistLegacyReview(samples) {
    const changes=samples.map(sample=>({sample,key:'_cloudLegacyReview',previous:sample._cloudLegacyReview,value:true}));
    for (const change of changes) { change.sample[change.key]=change.value;samplePersistence.dirty(change.sample); }
    return persistMetadataChanges(changes);
}
async function persistMetadataChanges(changes) {
    const captures=changes.map(({sample})=>samplePersistence.capture(sample));
    // run() may join an older transaction. Its ok only proves that older snapshot.
    // Check the exact captured revisions; never trust a cached fallback status.
    const unchanged=()=>captures.every(entry=>samplePersistence.unchanged(entry));
    try {
        await trainRetrySave();
        if (unchanged() && changes.every(({sample})=>sample._persisted)) return true;
        if (unchanged() && _persistToLocalStorageFallback() === true && unchanged()) return true;
    } catch (_) { /* Unexpected save exceptions also retain the pending upload. */ }
    for (const {sample,key,previous,value} of changes) {
        if (sample[key] === value) { sample[key]=previous;samplePersistence.dirty(sample); }
    }
    return false;
}
// Stable local primary key, including legacy records without transaction identity.
export function getSampleStorageKey(sample) { return samplePersistence.fallbackValue(sample)._storageKey; }
export function isFull() { return BUFFER.length >= MAX_SAMPLES; }

/* Compatibility entry point: unverified random cleanup is disabled. */
export function cleanLowValue() {
    // Threshold/random cleanup has no proof of a recoverable copy. Only verified export retirement may remove records.
    return 0;
}

export function exportAsJson() {
	/* PR5e：本地导出停用——数据统一云端上传 */
	return { ok: false, err: "本地导出已停用：训练数据自动上传云端，无需手动导出" };
    try {
        /* ★ 重构：默认不做任何过滤，全部样本(含负收益/低分/ban动作)原样导出，
         * 让模型学到完整的正负对照。仅显式传参才启用过滤。 */
        return exportAsJsonl({ dropViolations: false, minReward: -Infinity });
    } catch (e) { return '{"err":"' + String(e) + '"}'; }
}

/* ★ 第3层：带过滤的导出 */
export function exportAsJsonl(options) {
    options = options || {};
    /* ★ 重构：默认不再丢弃"违规"样本（原来是 dropViolations !== false 默认丢弃）。
     * 让样本全部进入训练，由异步实测(阵营净收益)与冠军策略价值决定正负/去留。
     * 仅当显式传入 dropViolations:true 才启用违规过滤。 */
    const dropViolations = !!options.dropViolations;
    const minReward = typeof options.minReward === 'number' ? options.minReward : -50;

    const lines = [];
    let total = 0, dropped = 0, rewardDropped = 0;

    for (const s of (options.samples || BUFFER)) {
        total++;

        /* ① 违规样本丢弃 */
        if (dropViolations && s.m && s.m.violation) {
            dropped++;
            continue;
        }

        /* ② reward 过低的丢弃 */
        if (typeof s.r === 'number' && s.r < minReward) {
            rewardDropped++;
            continue;
        }

        /* 拼成一行：features + reward + meta（reward 切到设计量纲，附带 value_target 供离线训练用） */
        const rRaw = s.r || 0;
        const rOut = rRaw > REWARD_BOUND ? REWARD_BOUND : (rRaw < -REWARD_BOUND ? -REWARD_BOUND : rRaw);
        const row = {
            features: Array.from(s.f || []),
            reward: rOut,
            meta: s.m || {},
            label_status: s.m?.rewardSchema === 'action-outcome-v1' ? s.m.rewardStatus : 'legacy-unknown',
            action_reward: s.m?.rewardStatus === 'observed' ? s.m.observedReward : null,
            count: s.count || 1,
            conf: s.conf,
            ts: s.ts,
            fbAsync: !!s.fbAsync,
            r0: (typeof s.r0 === 'number' ? s.r0 : null),   /* ★PR7d 血缘透传 */
            gen: s.gen || null,                              /* ★PR7d 血缘透传 */
        };
        if (typeof s.value_target === 'number' && isFinite(s.value_target)) row.value_target = s.value_target;
        lines.push(JSON.stringify(row));
    }

    try {
        console.log('[exportJSONL] 总样本 ' + total +
                    '，丢弃违规 ' + dropped +
                    '，丢弃低分 ' + rewardDropped +
                    '，导出 ' + lines.length);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

    /* 返回 jsonl 字符串 */
    const result = lines.join('\n');

    /* 同时返回统计 */
    try {
        const meta = {
            v: 2,
            dim: ((options.samples || BUFFER)[0] ? (options.samples || BUFFER)[0].f.length : 0),
            exportedAt: Date.now(),
            count: lines.length,
            total: total,
            droppedViolation: dropped,
            droppedLowReward: rewardDropped,
            stats: { count: lines.length },
        };
        return JSON.stringify(meta) + '\n' + result;
    } catch (e) {
        return result;
    }
}

function settledSample(sample) {
    return typeof sample.value_target === 'number' && Number.isFinite(sample.value_target) &&
        !(_gameStart && !_gameStart.closed && sample.m && sample.m.sessionId === _gameStart.id);
}
function captureExport() {
    const samples = BUFFER.slice();
    const entries = samples.filter(settledSample).map(sample => samplePersistence.capture(sample));
    // JSONL 同步序列化固定快照，等待文件期间的新增/回填不会改变已导出内容。
    const content = exportAsJsonl({ samples, dropViolations: false, minReward: -Infinity });
    return { entries, content, count: samples.length, generation: _trainingGeneration };
}
async function exportSnapshot(snapshot) {
    const filename = 'djsc_training_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.json';
    const result = await writeTrainingSnapshot(game, downloadText, dirOf('training'), filename, snapshot.content);
    if (snapshot.generation === _trainingGeneration && !_clearTask) {
    if (result.ok) _exportCount++;
    _lastExportStatus = !result.ok ? '导出失败：' + result.err : result.verified ? '原生文件已写入并读回核验' : result.note;
    }
    return { ...result, count: snapshot.count, file: fileOf('training', filename), size: (snapshot.content.length / 1024).toFixed(1) + 'KB' };
}
export async function downloadJson() {
	/* PR5e：本地导出停用——数据统一云端上传 */
	return { ok: false, err: "本地导出已停用：训练数据自动上传云端，无需手动导出" };
    if (_clearTask) return { ok: false, err: '正在清空训练样本，请稍后导出' };
    try { return await exportSnapshot(captureExport()); }
    catch (e) { _lastExportStatus = '导出失败，样本保留：' + String(e.message || e); return { ok: false, err: String(e.message || e) }; }
}
function autoExportFullBuffer() {
    if (_clearTask) return Promise.resolve({ ok: false, cancelled: true });
    const generation = _trainingGeneration;
    if (_autoExportTask) return _autoExportTask;
    _nextAutoExportAt = Date.now() + AUTO_EXPORT_RETRY_MS;
    _lastExportStatus = '样本已满，正在导出；暂停新增独立样本';
    _autoExportTask = (async () => {
        try {
            const snapshot = captureExport();
            const result = await exportSnapshot(snapshot);
            if (generation !== _trainingGeneration || _clearTask) return { ...result, cancelled: true };
            if (!result.ok || !result.verified) {
                log.info('train', _lastExportStatus + '；当前保留 ' + BUFFER.length + ' 条，满额时暂停新增独立样本，至少60秒后可重试。');
                return result;
            }
            await initDB();
            if (generation !== _trainingGeneration || _clearTask) return { ...result, cancelled: true };
            if (!_dbReady || !getDB()) throw new Error('数据库不可用，暂不清理已导出样本');
            const retired = await samplePersistence.retire(getDB(), snapshot.entries, () => BUFFER, sample => generation === _trainingGeneration && !_clearTask && settledSample(sample) && isCloudArchived(sample), removed => {
                if (generation !== _trainingGeneration || _clearTask) return;
                BUFFER = BUFFER.filter(sample => !removed.has(sample));
                for (const [key, sample] of _keyIndex) if (removed.has(sample)) _keyIndex.delete(key);
                _persistToLocalStorageFallback();
            });
            if (generation !== _trainingGeneration || _clearTask) return { ...result, cancelled: true };
            _lastExportStatus = '文件已核验；已清理 ' + retired + ' 条，保留 ' + BUFFER.length + ' 条未结算或有更新的样本';
            log.info('train', _lastExportStatus);
            saveToStorage();
            return { ...result, retired };
        } catch (e) {
            if (generation !== _trainingGeneration || _clearTask) return { ok: false, cancelled: true };
            _lastExportStatus = '自动导出或批次清理未完成，样本保留：' + String(e.message || e);
            try { log.info('train', _lastExportStatus); } catch (_) {}
            saveToStorage();
            return { ok: false, err: String(e.message || e) };
        } finally {
            if (generation === _trainingGeneration) {
                _nextAutoExportAt = Date.now() + AUTO_EXPORT_RETRY_MS;
                _autoExportTask = null;
            }
        }
    })();
    return _autoExportTask;
}
export function exportStats() {
    const actionLabels = { observed: 0, pending: 0, unresolved: 0, legacy: 0 };
    for (const sample of BUFFER) {
        const status = sample.m?.rewardSchema === 'action-outcome-v1' ? sample.m.rewardStatus : 'legacy';
        actionLabels[status in actionLabels ? status : 'pending']++;
    }
    return { count: BUFFER.length, actionLabels, max: MAX_SAMPLES, exports: _exportCount,
    paused: BUFFER.length >= MAX_SAMPLES, pausedSamples: _pausedSamples, exporting: !!_autoExportTask, lastExport: _lastExportStatus, saving: trainingSaveStatus(), clearing: !!_clearTask, lastClear: _lastClearStatus }; }

/* ================= 训练钩子 ================= */
let _gameStart = null;

/* ★ 采样诊断（fix9）：按动作类型统计「接受/拒绝」，玩家面板可直接查看。
 *   背景：数据审计发现技能(skill)样本在新包下断崖，需在线区分「没采到」与「采了被拒」。 */
const _sampleDiag = { accepted: {}, rejected: {} };
function _diagBump(bucket, type) {
    try { const k = type || 'unknown'; bucket[k] = (bucket[k] || 0) + 1; } catch (eD) {}
}
export function getSampleDiagnostics() {
    return {
        accepted: Object.assign({}, _sampleDiag.accepted),
        rejected: Object.assign({}, _sampleDiag.rejected),
    };
}

export function trainStartGame(me) {
    try {
        _gameStart = {
            time: Date.now(),
            id: 'train_' + Date.now() + '_' + Math.random().toString(36).slice(2),
            player: me ? (me.name || me.name1 || '?') : '?',
            playerRef: me,
        };
        beginModeContext(_gameStart.id);
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function trainRecordSample(me, best, sit, score, features, execution = {}) {
    try {
        if (!identityModelCompatibility().sampleAllowed) {
            _diagBump(_sampleDiag.rejected,(best?.type || 'unknown') + ':identity-feature-schema-migration');
            return null;
        }
        if (!me || !best || !(Array.isArray(features) || ArrayBuffer.isView(features)) || features.length !== FEATURE_DIM || !features.every(Number.isFinite)) {
            /* ★ 4.0.24：拒绝原因细分（此前只记 type，无法区分 noMe/noFeat/维度失配/非有限值） */
            const _rej = [];
            if (!me) _rej.push('noMe');
            if (!best) _rej.push('noBest');
            if (me && best) {
                if (!(Array.isArray(features) || ArrayBuffer.isView(features))) _rej.push('noFeat');
                else {
                    if (features.length !== FEATURE_DIM) _rej.push('dim' + features.length);
                    if (!features.every(Number.isFinite)) _rej.push('nonFinite');
                }
            }
            _diagBump(_sampleDiag.rejected, (best && best.type || 'unknown') + ':' + (_rej.join('|') || '?'));
            return;
        }

        /* ★ sessionId 自愈：扩展热重载或对局开始事件未被捕获时，兜底创建训练会话。
         *   数据审计发现约 3% 样本 sessionId=null（无归属、反馈/终局回填全部失效），此分支保证任何时刻采样的样本都可归属。 */
        if (!_gameStart || !_gameStart.id) {
            _gameStart = {
                time: Date.now(),
                id: 'train_' + Date.now() + '_' + Math.random().toString(36).slice(2),
                player: me ? (me.name || me.name1 || '?') : '?',
                playerRef: me,
            };
            try { beginModeContext(_gameStart.id); } catch (eSess) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSess); }
        }

        /* ★ 第2层：读取违规标记 */
        let violation = false;
        let violationInfo = null;
        try {
            if (_status && _status.djsc_lastViolation) {
                const v = _status.djsc_lastViolation;
                if (v && execution.transactionId && v.transactionId === execution.transactionId) {
                    violation = true;
                    violationInfo = { type: v.type, card: v.card, target: v.target };
                }
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        /* ★ 用真实特征（从 engine.js 传入的 best._feat），缺失则用 FEATURE_DIM 维全0占位
         *   （勿用旧 96 维，会与 130 维模型错位，污染样本库） */
        const f = features && features.length ? features : new Array(FEATURE_DIM).fill(0);

        if (_gameStart && !_gameStart.playerRef && game.me === me) { _gameStart.playerRef = me; _gameStart.player = me.name || me.name1 || '?'; }
        if (_gameStart?.playerRef === me && execution.actorId) _gameStart.actorId = execution.actorId;
        const recorded = _pushSample(f, 0, {
            player: me.name || me.name1 || '?',
            action: best.type || 'unknown',
            recast: best.recast===true,
            id: best.id || '',
            score: Math.round(score || 0),
            conf: (best && best._conf && !isNaN(best._conf)) ? best._conf : 0.3,  /* ★ 存置信度 */
			source: execution.source || 'real', demonstration: execution.demonstration || null, executionState: execution.transactionId ? 'committed' : 'unverified', sessionId: _gameStart && _gameStart.id || null,
            rewardSchema: 'action-outcome-v1', rewardStatus: 'pending', transactionId: execution.transactionId || null,
            actorId: execution.actorId || null, target: execution.target || null,
            identity: me.identity || null,   /* ★ fix7: 采样者身份明文（zhu/zhong/fan/nei），后端可按身份分层训练评估 */
            camp: _campOf(me),   /* ★ 4.1.5.2：采样者阵营（lord/rebel/nei/landlord/farmer），供阵营胜负标签 */
            tgtIdentity: publicIdentityRole(best && typeof best.target === 'object' ? best.target : null),
            modeContext: modeSampleMeta(me),
            v5: execution.v5 || null,   /* ★ PR5e.4：v5 双种子集成对最终动作的评分 {ens,s42,s456}，样本级 shadow 对比随 m 上传 */
            negative: null,   /* ★ 负收益样本标记（AI 造成的负收益动作） */
            violation: violation,
            violationType: violationInfo ? violationInfo.type : null,
            violationCard: violationInfo ? violationInfo.card : null,
            violationTarget: violationInfo ? violationInfo.target : null,
        });
        if (recorded) _diagBump(_sampleDiag.accepted, best && best.type);
        return recorded ? { sessionId: _gameStart && _gameStart.id || null, sample: recorded } : null;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function trainSettleGame(me, won) {
    try {
        const start = _gameStart;
        if (!start) return;
        const verdict = typeof won === 'boolean' ? won ? 'win' : 'lose' : 'unknown';
        const winCamp = _winCampOf(me, won);   /* ★ 4.1.5.2：获胜阵营（动态阵营胜负） */
        let updated = 0;
        for (const s of BUFFER) {
            if (!s.m || s.m.sessionId !== start.id || s.m.executionState !== 'committed') continue;
            if (start.playerRef && start.playerRef !== me) continue;
            if (start.actorId ? s.m.actorId !== start.actorId : s.m.player !== start.player) continue;
            // 终局标签属于整局，绝不覆盖动作value_target或把静态r当即时奖励倒推。
            s.m.gameOutcome = verdict;
            s.m.outcomeTarget = typeof won === 'boolean' ? won ? 1 : -1 : null;
            s.m.winCamp = winCamp;
            s.m.campWon = (winCamp && s.m.camp) ? (winCamp === s.m.camp) : null;   /* ★ 4.1.5.2：本阵营是否获胜 */
            samplePersistence.dirty(s); updated++;
        }
        if (updated) saveToStorage();
        start.closed = true;
        // 保留本局ID接受最后一个宿主事件的迟到反馈；下一局start更换ID隔离。
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC?.swallow) window.__DJSC.swallow(e); }
}

function _clampR(v, lo, hi) { return v > hi ? hi : (v < lo ? lo : v); }

/* 后续技能choice完成后绑定真实目标；只允许未完成观测的精确事务更新。 */
export function trainBindSampleTargets(execution, target) {
    if (!execution?.transactionId || !execution.actorId || execution.sessionId !== _gameStart?.id) return false;
    const matches = BUFFER.filter(s => s.m?.transactionId === execution.transactionId && s.m.sessionId === execution.sessionId &&
        s.m.actorId === execution.actorId && s.m.executionState === 'committed');
    if (matches.length !== 1 || matches[0].m.action !== 'skill' || matches[0].m.rewardStatus === 'observed') return false;
    matches[0].m.target = target || null;
    samplePersistence.dirty(matches[0]); saveToStorage(); return true;
}

export function trainFeedbackSample(feedback) {
    try {
        if (!_gameStart || !feedback?.transactionId || !feedback.actorId || !feedback.sessionId) return 0;
        if (feedback.sessionId !== _gameStart.id) return 0;
        // 精确事务匹配，不按名称、牌名、时间窗批量覆盖。
        const matches = BUFFER.filter(s => s.m?.sessionId === feedback.sessionId && s.m?.transactionId === feedback.transactionId &&
            s.m.actorId === feedback.actorId && s.m.executionState === 'committed' && s.m.action === feedback.type && s.m.id === feedback.id);
        if (matches.length !== 1 || matches[0].m.rewardStatus === 'observed') return 0;
        const s = matches[0];
        if (JSON.stringify(s.m.target) !== JSON.stringify(feedback.target || null)) return 0;
        if (feedback.status !== 'observed' || !Number.isFinite(feedback.reward)) {
            s.m.rewardStatus = 'unresolved'; s.m.outcomeReason = feedback.reason || 'missing-observation';
            s.m.partialObservation = { status: feedback.status, scope: feedback.scope, immediateReward: feedback.immediateReward, deltas: feedback.deltas || [], choices: feedback.choices || [] };
        } else {
            s.r = _clampR(Math.round(feedback.reward * 12), -REWARD_BOUND, REWARD_BOUND);
            s.value_target = _clampR(feedback.reward / 12, -1, 1);
            s.fbAsync = true; s.m.rewardStatus = 'observed'; s.m.negative = feedback.reward < 0;
            s.m.observedReward = feedback.reward;
            s.m.actionOutcome = { attribution: feedback.attribution, scope: feedback.scope || 'immediate-event', futureStatus: feedback.futureStatus || 'unobserved', normalization: 12, deltas: feedback.deltas || [], choices: feedback.choices || [] };
        }
        samplePersistence.dirty(s); saveToStorage();
        try { settleDecisionContext(feedback, s); } catch (_) {}
        return 1;
    } catch (_) { return 0; }
}

/* 完成且仅自身资源成本的酒杀链；全部样本核对成功后一次回填，缺一不可。 */
export function trainApplyCostCredits(group) {
 try {
  const ledger=buildActionCreditLedger(group);
  if(!ledger.eligible||group.sessionId!==_gameStart?.id)return {applied:0,reason:'ineligible-credit'};
  const selected=[];
  for(let i=0;i<ledger.allocations.length;i++) {
   const a=ledger.allocations[i],observation=group.observations[i];
   const matches=BUFFER.filter(s=>s.m?.sessionId===group.sessionId&&s.m.transactionId===a.transactionId&&s.m.actorId===group.actorId&&
    s.m.executionState==='committed'&&s.m.rewardSchema==='action-outcome-v1'&&s.m.action===a.type&&s.m.id===a.id);
   if(matches.length!==1)return {applied:0,reason:'missing-or-ambiguous-sample'};
   const s=matches[0];
   if(s.m.rewardStatus==='observed'||s.m.outcomeReason!=='delayed-effect-unattributed'||s.m.partialObservation?.status!=='partial'||
    JSON.stringify(s.m.target)!==JSON.stringify(a.target)||s.m.partialObservation.immediateReward!==observation.immediateReward||
    JSON.stringify(s.m.partialObservation.deltas)!==JSON.stringify(observation.deltas))return {applied:0,reason:'sample-evidence-mismatch'};
   selected.push(s);
  }
  const feedback=[];
  for(let i=0;i<selected.length;i++) {
   const s=selected[i],a=ledger.allocations[i],creditAllocation={schema:ledger.schema,groupId:ledger.groupId,policy:ledger.policy,
    groupReward:group.groupReward,allocations:ledger.allocations.map(x=>({transactionId:x.transactionId,reward:x.reward})),unallocatedReward:0};
   const result={transactionId:a.transactionId,actorId:group.actorId,sessionId:group.sessionId,type:a.type,id:a.id,target:a.target,
    status:'observed',reward:a.reward,immediateReward:a.reward,scope:'completed-cost-only-chain',futureStatus:'consumed-no-hit',
    attribution:'completed-chain-local-cost',normalization:12,deltas:group.observations[i].deltas,creditAllocation};
   s.r=_clampR(Math.round(a.reward*12),-REWARD_BOUND,REWARD_BOUND);s.value_target=_clampR(a.reward/12,-1,1);s.fbAsync=true;
   Object.assign(s.m,{rewardStatus:'observed',outcomeReason:null,observedReward:a.reward,negative:a.reward<0,creditAllocation,actionOutcome:result});
   samplePersistence.dirty(s);feedback.push(result);
  }
  saveToStorage();
  for(let i=0;i<feedback.length;i++){try{settleDecisionContext(feedback[i],selected[i]);}catch(_){}}
  return {applied:selected.length,feedback};
 }catch(_){return {applied:0,reason:'credit-error'};}
}

/* ================= 面板接口 ================= */
export function trainClearBuffer() { return bufferClear(); }

export function trainStats() {
    return exportStats();
}

export function trainExportAndDownload() {
	/* PR5e：本地导出停用——数据统一云端上传 */
	return { ok: false, err: "本地导出已停用：训练数据自动上传云端，无需手动导出" };
    return downloadJson();
}

/* ★ 冠军策略替换数据回流：把被"冠军策略固化"替换/淘汰掉的旧决策点重新写回样本库。
 * 这些决策点在固化嵌入时因条数上限/价值排序被挤出，但不该丢失——回流入样本库，
 * 让它们继续参与后续训练/重算，避免训练数据因"替换"而白白流失。
 * list: [ {hero, action, id, value, count, emb} ]。emb 为被替换决策点的原冠军嵌入特征；
 * 有 emb 则原样回流（保留真实特征，避免污染嵌入池），缺失时才用全0占位(仅保留决策元信息)。 */
export function recycleChampionSamples(list) {
    let n = 0;
    try {
        for (const it of (list || [])) {
            if (!it || !it.action || !it.id) continue;
            /* ★ 修复：优先用被替换决策点的原冠军嵌入特征回流，全0特征不再写回，
             *  否则下次固化时可能以空向量成为冠军嵌入（泛化余弦恒-1、样本互相合并）
             * ★ P1-20：缺 emb 时直接跳过，不再写 130 维全 0 伪样本（空向量会把
             *  网络对"零状态"的分类梯度推向某标签，且彼此完全相同会被合并/计数放大） */
            if (!it.emb || it.emb.length !== FEATURE_DIM) continue;
            pushSample(it.emb, Math.max(1, Math.round((it.value || 0) * 10)), {
                player: it.hero || '',
                action: it.action,
                id: it.id,
                score: Math.round((it.value || 0) * 10),
                conf: 0.6,
                source: 'champ_recycle',
                recycled: true,
            });
            n++;
            if (n >= 200) break;   /* 上限保护，防止一次回流过多撑爆样本库 */
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return n;
}


/* ============================================
 * ★ 扩展：把所有能接入训练的模块都接入
 * ============================================ */

/* 导入各个模块的训练数据 */
async function collectExtendedTrainingData() {
    const data = {
        /* 对局总结相关 */
        archive: null,
        replay: null,
        report: null,
        feedback: null,
        
        /* 身份与势力相关 */
        identity: null,
        threat: null,
        
        /* 牌堆与手牌相关 */
        deckMemory: null,
        handInference: null,
        
        /* 技能与卡牌相关 */
        skillTags: null,
        cardStrategy: null,
        
        /* 局势与规划相关 */
        situationEval: null,
        multiTurnPlan: null,
        
        /* 对手预测相关 */
        opponentPredict: null,
        
        /* 软指标相关 */
        softMetrics: null,
    };
    
    try {
        /* 尝试从 window.__DJSC 获取数据 */
        const J = window.__DJSC || {};
        /* ★ 连接性修复：__DJSC 下的模块御法不同——有的是函数、有的是对象。
         *   旧写法一律 `v()` 调用，遇到对象会抛 TypeError，
         *   整段 try 随即跳出，导致其后所有数据项被静默跳过。
         *   此处统一：函数→调用；对象→优先 stats()，否则取非函数字段。 */
        const pull = function (v) {
            try {
                if (typeof v === 'function') return v();
                if (v && typeof v === 'object') {
                    if (typeof v.stats === 'function') return v.stats();
                    const o = {};
                    for (const k in v) { if (typeof v[k] !== 'function') o[k] = v[k]; }
                    return o;
                }
                return null;
            } catch (e) { return null; }
        };
        if (J.archive) data.archive = pull(J.archive);
        if (J.replay) data.replay = pull(J.replay);
        if (J.report) data.report = pull(J.report);
        if (J.feedback) data.feedback = pull(J.feedback);
        if (J.identity) data.identity = pull(J.identity);
        if (J.threat) data.threat = pull(J.threat);
        if (J.deckMemory) data.deckMemory = pull(J.deckMemory);
        if (J.handInference) data.handInference = pull(J.handInference);
        if (J.skillTags) data.skillTags = pull(J.skillTags);
        if (J.cardStrategy) data.cardStrategy = pull(J.cardStrategy);
        if (J.situationEval) data.situationEval = pull(J.situationEval);
        if (J.multiTurnPlan) data.multiTurnPlan = pull(J.multiTurnPlan);
        if (J.opponentPredict) data.opponentPredict = pull(J.opponentPredict);
        if (J.softMetrics) data.softMetrics = pull(J.softMetrics);
    } catch (e) {
        console.warn('[trainExport] 收集扩展数据失败：', e);
    }
    
    return data;
}

/* 导出扩展训练数据 */
export async function exportExtendedTrainingData() {
	/* PR5e：本地导出停用——数据统一云端上传 */
	return { ok: false, err: "本地导出已停用：训练数据自动上传云端，无需手动导出" };
    const extended = await collectExtendedTrainingData();
    return {
        ...extended,
        timestamp: Date.now(),
        version: 'v2.3.25_extended'
    };
}

/* 修改原有的 exportJSONL 函数，加入扩展数据 */
/* 注意：exportJSONL 不存在于当前代码库，此劫持已废弃。
 * 扩展数据通过 collectExtendedTrainingData() 单独导出，见上方。 */

/* ================= ★ 导入功能（合并样本，不覆盖） ================= */
export function importFromJson(jsonStr) {
    if (_clearTask) return { ok: false, err: '正在清空训练样本，暂不导入' };
    try {
        jsonStr = String(jsonStr).trim();
        if (!jsonStr) return { ok: false, err: '文件内容为空' };

        let samples = null;

        /* 第1步：先试直接解析成对象 */
        try {
            const data = JSON.parse(jsonStr);
            if (Array.isArray(data)) {
                samples = data;  // 纯数组格式
            } else if (data.samples && Array.isArray(data.samples)) {
                samples = data.samples;  // { samples: [...] } 格式
            } else if (data.features && Array.isArray(data.features)) {
                samples = [data];  // 单个样本格式
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        /* 第2步：JSONL 逐行解析 */
        if (!samples) {
            samples = [];
            const lines = jsonStr.split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    if (Array.isArray(obj)) {
                        samples = obj;  // 整行就是数组
                        break;
                    } else if (obj.samples && Array.isArray(obj.samples)) {
                        samples = obj.samples;  // 元数据行
                        break;
                    } else if (obj.f || obj.features) {
                        samples.push(obj);  // 单行样本
                    }
                } catch (e2) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e2); }
            }
        }

        /* 第3步：实在不行，把整个文件当一个大数组找 */
        if (!samples || samples.length === 0) {
            const match = jsonStr.match(/\[\s*\{.*\}\s*\]/s);
            if (match) {
                try { samples = JSON.parse(match[0]); } catch (e3) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e3); }
            }
        }

        if (!samples || !Array.isArray(samples)) {
            return { ok: false, err: '格式错误：找不到样本数组（请确认是导出的训练文件）' };
        }

        let added = 0, merged = 0, skipped = 0, repaired = 0, adaptedCount=0;
        /* ★ P1-19：导入强校验——维度必须等于 FEATURE_DIM(134)，且每项都是有限数。
         * 否则旧 48/96 维样本或含 NaN/字符串的样本会被静默零填充成伪 134 维样本污染训练。
         * ★ 数据隔离：统一过 _sanitizeSample——旧版 reward 损坏样本（reward 与 meta.score 脱节）
         *   以 score 为准修复后再入库，杜绝客户旧导出文件污染当前训练。 */
        let skippedWrongDim = 0, skippedNonFinite = 0, skippedInvalidLabels = 0;
        const existingSamples = new Map();
        for (const sample of BUFFER) {
            const key = _importMergeKey(sample);
            if (!existingSamples.has(key)) existingSamples.set(key, sample);
        }

        for (const s of samples) {
            if (!s || typeof s !== 'object') { skipped++; continue; }
            const san = _normalizeImportedSample(s);
            if (!san.sample) {
                if (san.wrongDim) skippedWrongDim++;
                else if (san.nonFinite) skippedNonFinite++;
                else if (san.invalidLabels) skippedInvalidLabels++;
                else skipped++;
                continue;
            }
            if (san.repaired) repaired++;
            if(san.adapted)adaptedCount++;
            const sample = san.sample, key = _importMergeKey(sample);
            const existing = existingSamples.get(key);
            if (existing) {
                const count = (existing.count || 1) + sample.count;
                if (!Number.isSafeInteger(count)) { skipped++; continue; }
                existing.count = count;
                // Preserve the existing capture timestamp on import merge.
                samplePersistence.dirty(existing);
                merged++;
                continue;
            }
            if (BUFFER.length >= MAX_SAMPLES) { skipped++; continue; }
            samplePersistence.dirty(sample);
            BUFFER.push(sample); existingSamples.set(key, sample); added++;
        }

        saveToStorage();
        return {
            ok: true,
            added: added,
            merged: merged,
            skipped: skipped,
            skippedWrongDim: skippedWrongDim,
            skippedNonFinite: skippedNonFinite,
            skippedInvalidLabels: skippedInvalidLabels,
            repairedReward: repaired,   /* ★ 数据隔离：以 meta.score 为准修复的旧版损坏 reward 条数 */
            adaptedCount,
            total: BUFFER.length,
        };
    } catch (e) {
        return { ok: false, err: '解析失败：' + String(e) };
    }
}

/* 导出成友好格式（方便导入） */
export function exportForImport() {
    return JSON.stringify({
        version: 1,
        exportedAt: Date.now(),
        count: BUFFER.length,
        samples: BUFFER,
    });
}

/* 面板接口 */
export function trainImport(jsonStr) {
    return importFromJson(jsonStr);
}

/* ================= ★ 内置训练数据：已移除 =================
 * v3.1：不再随包分发原始样本，改为随包分发「内置默认权重」（score/model/weights/defaultWeights.js）。
 * 默认权重由这 4972 条样本离线训练得到，装载体积从 3.2MB 降到 ~68KB，且开箱即有可用模型。
 * 玩家后续对局产生的样本照常缓冲/自动导出，用于各自设备上的增量训练。 */

console.log('[trainExport] ✅ 已接入 14 个扩展训练模块 + 导入/导出功能');
