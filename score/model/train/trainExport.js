/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { reg } from '../../foundation/runtime/registry.js';
import { log } from '../../foundation/diag/logger.js';  /* ★ 自动导出/清理日志走统一日志分级 */
import { cfg } from '../../foundation/config/util.js';    /* ★ 读取配置（满额一条龙需要群号等） */
import { writeData, fileOf } from '../../foundation/storage/storagePaths.js';  /* ★ 统一导出路径（手机端兜底下载） */
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ================= 训练数据缓冲（1万样本自动导出版） ================= */

const MAX_SAMPLES = 10000;  /* ★ 攒到1万条自动导出+清空 */
const FEATURE_DIM = 130;    /* ★ 特征维度单一来源（与 features.FEATURE_DIM 对齐），杜绝 96/130 混用错位 */
const REWARD_BOUND = 147;   /* ★ 奖励上界：决策引擎会给"必胜/击杀"加 +999 灌爆得分(≈1003)，
                             * 而 _scoreToLabel(6档) 与 TD 归一化(÷147) 均按 -127..127 设计。
                             * 入库/导出前统一切到该量纲，避免极端值主导标签与价值目标。 */
const STORAGE_KEY = 'djsc_training_samples_v1';
const STORAGE_SAFE_COUNT = 2500;  /* ★ localStorage 兜底安全上限：防 quota 爆满（≈1.5MB） */

/* ★ IndexedDB 封装（替换 localStorage，支持3万+样本）。
 * 优化：所有读写共用单例连接，避免高频训练记样本时反复 indexedDB.open。 */
// 作者：飞升原创 | License: GPL-3.0
const DB_NAME = 'djsc_ai_db';
const DB_STORE = 'samples';
let _dbReady = false;
let _dbInstance = null;   /* ★ 单例连接：初始化一次后复用，不再每次 open */

/* ★ 获取单例连接（初始化后缓存），失败返回 null */
function getDB() {
    return _dbInstance;
}

function initDB() {
    return new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') { resolve(false); return; }
            if (_dbInstance) { _dbReady = true; resolve(true); return; }  /* 已有连接 */
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains(DB_STORE)) {
                    d.createObjectStore(DB_STORE, { autoIncrement: true });
                }
            };
            req.onsuccess = (e) => {
                _dbInstance = e.target.result;   /* ★ 缓存连接 */
                _dbReady = true;
                resolve(true);
            };
            req.onerror = () => { resolve(false); };
        } catch (e) { resolve(false); }
    });
}

/* ★ 从 IndexedDB 读取所有样本（复用单例连接） */
function getAllSamplesAsync() {
    return new Promise((resolve) => {
        const db = getDB();
        if (!_dbReady || !db) { resolve([]); return; }
        try {
            const tx = db.transaction(DB_STORE, 'readonly');
            const r = tx.objectStore(DB_STORE).getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    });
}

/* ★ 启动时初始化 IndexedDB */
initDB();

/* ★ 从 IndexedDB 加载全部样本（优先），失败则回退 localStorage（兼容旧版）
 * 注意：模块加载时 initDB 尚未完成，因此任何时候都发起一次异步 DB 读；读不到再回退 */
function loadFromStorage() {
    getSamplesAsyncFromDB().then(function (arr) {
        if (Array.isArray(arr) && arr.length) {
            const san = _sanitizeBuffer(arr);
            BUFFER = san.list;
            for (let i = 0; i < BUFFER.length; i++) { if (!BUFFER[i]._persisted) BUFFER[i]._persisted = true; }
            _keyIndex.clear();
            /* 内存索引在下次 push 时按需重建 */
            console.log('[trainExport] ✅ 从 IndexedDB 加载了 ' + BUFFER.length + ' 条历史样本' +
                ((san.repaired || san.dropped) ? '（数据隔离：修复 reward ' + san.repaired + ' 条，丢弃污染 ' + san.dropped + ' 条）' : ''));
            /* 释放旧的超大 localStorage 键，腾出存储配额 */
            try { _lsRemove(STORAGE_KEY); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
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
                /* 兜底仅保留安全数量，防止 localStorage 溢出（先清洗再裁剪，旧版污染样本不占额度） */
                const san = _sanitizeBuffer(arr);
                BUFFER = san.list.slice(0, STORAGE_SAFE_COUNT);
                for (let i = 0; i < BUFFER.length; i++) { if (!BUFFER[i]._persisted) BUFFER[i]._persisted = true; }
                _keyIndex.clear();
                console.log('[trainExport] ✅ 从本地加载了 ' + BUFFER.length + ' 条历史样本（回退模式）' +
                    ((san.repaired || san.dropped) ? '（数据隔离：修复 reward ' + san.repaired + ' 条，丢弃污染 ' + san.dropped + ' 条）' : ''));
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
    try {
        /* ★ 防抖：1秒内多次调用只保存一次 */
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function () {
            _persistToDB();
            _persistToLocalStorageFallback();
        }, 1000);
    } catch (e) {
        console.warn('[trainExport] 保存样本失败：', e);
    }
}

/* ★ 主存储：整包写入 IndexedDB（重写 store，保持与 BUFFER 一致）。复用单例连接 */
function _persistToDB() {
    if (!_dbReady) return;
    try {
        const db = getDB();
        if (!db) return;
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        /* ★【卡死防护】增量写入：只 put 未持久化的新增样本(_persisted!==true)，
         *   不再每次 clear() + 全量重建整个 BUFFER。
         *   原实现每防抖都清空 + 重写全部样本，数千条时同步拖垮主线程 → 手机卡死。 */
        const fresh = [];
        for (let i = 0; i < BUFFER.length; i++) {
            if (!BUFFER[i]._persisted) fresh.push(BUFFER[i]);
        }
        if (!fresh.length) return;
        for (let k = 0; k < fresh.length; k += 200) {
            const slice = fresh.slice(k, k + 200);
            for (let j = 0; j < slice.length; j++) slice[j]._persisted = true;
        }
        /* 新建 store 才需要 init；已有 store 直接用 put 覆盖（含 _persisted 标记） */
        for (let m = 0; m < fresh.length; m += 200) {
            const slice = fresh.slice(m, m + 200);
            for (let n = 0; n < slice.length; n++) store.put(slice[n]);
        }
        tx.onerror = function () {
            console.warn('[trainExport] IndexedDB 写入失败，尝试落 localStorage：', tx.error);
            _persistToLocalStorageFallback();
        };
    } catch (e) {
        console.warn('[trainExport] IndexedDB 不可用：', e);
        _persistToLocalStorageFallback();
    }
}

/* ★ 兜底存储：仅存安全数量到本地存储，且失败时裁剪重试，绝不抛错
 * ★ P2-31：中央存储 safeSet 不抛异常而以 false 表达失败，故按返回值判定重试，
 *   不能再依赖 catch（旧直调 localStorage 时靠 QuotaExceededError 进裁剪分支）。 */
function _persistToLocalStorageFallback() {
    try {
        let data = BUFFER.length > STORAGE_SAFE_COUNT ? BUFFER.slice(-STORAGE_SAFE_COUNT) : BUFFER;
        if (_lsSet(STORAGE_KEY, JSON.stringify(data))) return;
        /* 配额仍满 → 进一步裁剪一半后重试一次 */
        const half = Math.floor(data.length / 2);
        if (half > 0 && _lsSet(STORAGE_KEY, JSON.stringify(data.slice(-half)))) return;
        /* 仍失败 → 放弃该键（避免半截大对象长期占配额），等下轮 IndexedDB/裁剪 */
        _lsRemove(STORAGE_KEY);
    } catch (e) {
        console.warn('[trainExport] 保存样本失败：', e);
    }
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
    if (!Array.isArray(f) || f.length !== FEATURE_DIM) return { sample: null, wrongDim: true };
    for (let i = 0; i < FEATURE_DIM; i++) if (!Number.isFinite(f[i])) return { sample: null, nonFinite: true };
    const ms = s.m && s.m.score;
    let r = (typeof s.r === 'number') ? s.r : ((typeof s.reward === 'number') ? s.reward : NaN);
    let repaired = false;
    if (typeof ms === 'number' && Number.isFinite(ms)) {
        const rFixed = _clampR(Math.round(ms), -REWARD_BOUND, REWARD_BOUND);
        if (!Number.isFinite(r) || Math.abs(r - rFixed) > REWARD_REPAIR_TOL) { r = rFixed; repaired = true; }
    }
    if (!Number.isFinite(r)) return { sample: null, nonFinite: true };
    s.f = f;
    s.r = _clampR(Math.round(r), -REWARD_BOUND, REWARD_BOUND);
    return { sample: s, repaired: repaired };
}

function _sanitizeBuffer(arr) {
    const list = [];
    let repaired = 0, dropped = 0;
    for (let i = 0; i < arr.length; i++) {
        const r = _sanitizeSample(arr[i]);
        if (!r.sample) { dropped++; continue; }
        if (r.repaired) repaired++;
        list.push(r.sample);
    }
    return { list: list, repaired: repaired, dropped: dropped };
}

let BUFFER = [];
let _keyIndex = new Map();  /* 特征去重索引：key -> sample，避免每次 push O(N) 重建 join */
let _exportCount = 0;

/* 启动时自动加载历史样本 */
loadFromStorage();

export function pushSample(features, reward, meta) {
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
    const idKey = (meta && meta.id) || '';
    const decisionKey = (meta && meta.decisionId) || '';
    /* 用 \u0001 作分隔防止字段拼接碰撞 */
    const key = arr.join(',') + '\u0001' + rewardKey + '\u0001' + playerKey + '\u0001' + actionKey + '\u0001' + idKey + '\u0001' + decisionKey;
    
    /* ★ O(1) 命中：直接让已有样本计数+1，不用 O(N) 扫描重建 join */
    const existing = _keyIndex.get(key);
    if (existing !== undefined) {
        existing.count = (existing.count || 1) + 1;  // 计数+1
        existing.ts = Date.now();                     // 更新时间
        existing._persisted = false;                  /* ★ 增量持久化：更新过就要重新落库 */
        saveToStorage();
        return true;
    }
    
    /* ★ 攒到1万条：自动导出 + 全局清空 */
    if (BUFFER.length >= MAX_SAMPLES) {
        try {
            /* 1. 自动导出当前所有样本 */
            const exportResult = downloadJson();
            if (exportResult.ok) {
                try { log.info('train', '✅ 样本已达 ' + MAX_SAMPLES + ' 条，自动导出完成：' + exportResult.file); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                /* ★ 一条龙：告知用户 + 一键复制群号（导出后可直接发群） */
                _oneStopShare(exportResult);
            } else {
                try { log.info('train', '⚠️ 样本导出失败：' + exportResult.err); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            }

            /* 2. 全局清空所有样本 */
            BUFFER = [];
            _keyIndex.clear();
            /* ★ 同时清空 IndexedDB store（增量模式不再自动 clear，需显式清，避免旧样本残留被 load 回） */
            try {
                if (_dbReady) {
                    const __db = getDB();
                    if (__db && __db.objectStoreNames && __db.objectStoreNames.contains(DB_STORE)) {
                        const __tx = __db.transaction(DB_STORE, 'readwrite');
                        __tx.objectStore(DB_STORE).clear();
                    }
                }
            } catch (eClr) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eClr); }
            saveToStorage();   /* 防抖落盘：空 BUFFER 写入，等价清空 store */

            /* 3. 清空 localStorage 相关键（IndexedDB 走单例连接，不能 deleteDatabase：
             *    已打开的连接会把 deleteDatabase 阻塞在 onblocked，库文件实际残留） */
            try {
                _lsRemove(STORAGE_KEY);
                _lsRemove('djsc_training_export_count');
            } catch (eLs) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eLs); }

            try { log.info('train', '✅ 全局清理完成，可以继续积累新样本'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        } catch (eAuto) {
            try { log.info('train', '⚠️ 自动导出+清理出错：' + eAuto.message); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
    }
    
    const sample = {
        f: arr,
        r: rBound,
        m: meta || null,
        conf: (meta && meta.conf && !isNaN(meta.conf)) ? meta.conf : 0.3,  /* ★ 存置信度，默认30% */
        value_target: 0,  /* ★ Critic目标价值：游戏结束时回填（赢=+1，输=-1，平=0） */
        count: 1,
        ts: Date.now(),
        _persisted: false,  /* ★ 增量持久化：新样本默认未落库，_persistToDB 只写未持久化的 */
    };
    BUFFER.push(sample);
    _keyIndex.set(key, sample);
    /* ★ 自动保存到本地 */
    saveToStorage();
    return true;
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
export function bufferClear() { BUFFER = []; _keyIndex.clear(); saveToStorage(); }
export function resetAll() { BUFFER = []; _keyIndex.clear(); _exportCount = 0; saveToStorage(); }
export function getSamples() { return BUFFER; }
export function isFull() { return BUFFER.length >= MAX_SAMPLES; }

/* ★ 自动清洗：最新7000条 + 随机3000条 = 总共10000条 */
export function cleanLowValue() {
    try {
        if (BUFFER.length < MAX_SAMPLES * 0.8) return 0;  /* 样本不够多，不清洗 */
        
        /* ★ 按时间排序（最新的在后面） */
        BUFFER.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
        
        const RECENT_COUNT = 7000;   /* 保留最新的7000条 */
        const RANDOM_COUNT = 3000;   /* 从历史里随机选3000条 */
        
        /* 分割成：历史样本 + 最新样本 */
        const recentSamples = BUFFER.slice(-RECENT_COUNT);  /* 最新的7000条 */
        const oldSamples = BUFFER.slice(0, -RECENT_COUNT);   /* 剩下的历史样本 */
        
        /* 从历史样本里随机选3000条 */
        oldSamples.sort(() => Math.random() - 0.5);  /* 打乱 */
        const randomSamples = oldSamples.slice(0, RANDOM_COUNT);
        
        /* 合并：最新7000 + 随机3000 */
        BUFFER = recentSamples.concat(randomSamples);
        _keyIndex.clear();   /* BUFFER 被整体替换，索引重建 */
        
        saveToStorage();
        
        const oldLen = recentSamples.length + oldSamples.length;
        const cleaned = oldLen - BUFFER.length;
        try { log.info('train', '自动清洗完成：最新7000条全保留，历史样本随机选3000条，共删除 ' + cleaned + ' 条，剩余 ' + BUFFER.length + ' 条'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return cleaned;
    } catch (e) { return 0; }
}

export function exportAsJson() {
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

    for (const s of BUFFER) {
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
            dim: (BUFFER[0] ? BUFFER[0].f.length : 0),
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

export function downloadJson() {
    try {
        const json = exportAsJson();
        /* ★ 统一路径：extension/无名AI/data/training/，写盘失败自动回退浏览器下载 */
        const filename = 'djsc_training_' + Date.now() + '.json';
        const how = writeData('training', filename, json, function (ok, mode) {
            if (ok) console.log('[trainExport] ✅ 样本已导出(' + mode + ')：' + fileOf('training', filename));
        });
        _exportCount++;
        return { ok: how !== 'none', via: how, size: (json.length / 1024).toFixed(1) + 'KB', count: BUFFER.length, file: fileOf('training', filename) };
    } catch (e) {
        return { ok: false, err: String(e) };
    }
}

export function exportStats() { return { count: BUFFER.length, max: MAX_SAMPLES, exports: _exportCount }; }

/* ================= 训练钩子 ================= */
let _gameStart = null;

export function trainStartGame(me) {
    try {
        _gameStart = {
            time: Date.now(),
            player: me ? (me.name || me.name1 || '?') : '?',
        };
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function trainRecordSample(me, best, sit, score, features, provenance) {
    try {
        if (!me || !best) return;

        /* ★ 第2层：读取违规标记 */
        let violation = false;
        let violationInfo = null;
        try {
            if (_status && _status.djsc_lastViolation) {
                const v = _status.djsc_lastViolation;
                if (v && (Date.now() - v.ts) < 5000) {
                    violation = true;
                    violationInfo = { type: v.type, card: v.card, target: v.target };
                }
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        /* ★ 用真实特征（从 engine.js 传入的 best._feat），缺失则用 FEATURE_DIM 维全0占位
         *   （勿用旧 96 维，会与 130 维模型错位，污染样本库） */
        const f = features && features.length ? features : new Array(FEATURE_DIM).fill(0);

        pushSample(f, score | 0, {
            player: me.name || me.name1 || '?',
            action: best.type || 'unknown',
            id: best.id || '',
            decisionId: provenance && provenance.decisionId ? String(provenance.decisionId) : '',
            score: Math.round(score || 0),
            conf: (best && best._conf && !isNaN(best._conf)) ? best._conf : 0.3,  /* ★ 存置信度 */
			source: 'real',
			negative: (typeof score === 'number' && score < 0),   /* 记录所选动作的即时评分符号，不代表已观测到局势收益 */
            violation: violation,
            violationType: violationInfo ? violationInfo.type : null,
            violationCard: violationInfo ? violationInfo.card : null,
            violationTarget: violationInfo ? violationInfo.target : null,
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function trainSettleGame(me, won) {
    try {
        /* ★ 3.1 封测：用 TD(γ) 时序差分价值回填，取代"全样本统一 ±1"的粗标签。
         * 每决策价值 = 即时奖励(r 归一化) + γ × 下一决策价值；
         * 终态价值用游戏胜负(±1)吸收。这样同一局里"关键/失误"决策能被区分。
         * ★ 重构：凡已被"异步后检测"实测回填的样本(fbAsync)一律跳过，不被静态/TD 覆盖。
         *    —— 正负分以异步实际结算为准（即时决策分除外）。 */
        const outcome = won ? 1.0 : -1.0;
        const GAMMA = 0.9;               /* TD 折扣因子 */
        const CLIP_D = 147;              /* 用于归一化 r 的最大分（r 约 -127..127） */
        const cutoff = Date.now() - 5 * 60 * 1000;  /* 5 分钟视为本局样本（与原逻辑一致） */

        const idx = [];
        for (let i = 0; i < BUFFER.length; i++) {
            if (BUFFER[i].fbAsync) continue;        /* ★ 异步实测样本保持不动 */
            if ((BUFFER[i].ts || 0) >= cutoff) idx.push(i);
        }
        if (idx.length === 0) return;

        let nextV = outcome;   /* 终态价值 = 胜负结果 */
        let updated = 0;
        for (let i = idx.length - 1; i >= 0; i--) {   /* 从最近往最早倒推 */
            const s = BUFFER[idx[i]];
            const normR = _clampR((s.r || 0) / CLIP_D, -1, 1);  /* 每个决策的即时奖励 */
            const target = normR + GAMMA * nextV;
            const v = _clampR(target, -1, 1);
            s.value_target = v;     /* ★ 覆盖为 TD 目标 */
            nextV = v;
            updated++;
        }
        if (updated > 0) {
            saveToStorage();
        }
        _gameStart = null;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 局部 clamp 工具（不改其它文件的语义） */
function _clampR(v, lo, hi) { return v > hi ? hi : (v < lo ? lo : v); }

/* ★ 异步价值归一化：把"阵营净收益(campNet)"折算到 [-1,1]，作为该决策的异步实测价值目标。
 * 典型幅度：击杀敌方一棋 ≈ +9，拆一乐 ≈ +3，误伤自己 ≈ -6 等，DIV=12 使之落在合理区间。 */
function _fbToTarget(campNet) {
    const v = (typeof campNet === 'number' && isFinite(campNet)) ? campNet : 0;
    return _clampR(v / 12, -1, 1);
}

/* ★ 异步结算正负分回填（重构核心）：异步后检测判定的"敌我双方净收益 + 其余实测收益"
 * 回写进对应决策点的样本 value_target，替代原先由静态评分/终端 TD 打上的标签。
 * 即时分（bestAction 同步加权选牌）不在此列，保持不变。
 * feedback: { type, id, player, campNet, gain, sign }（来自 postCheck 结算结果）。
 * 仅在"本局、本决策、最近窗口"内定位样本，防跨局污染。 */
export function trainFeedbackSample(feedback) {
    try {
        if (!feedback || !feedback.decisionId || !feedback.type || !feedback.id) return 0;
        if (!feedback.player && feedback.player !== '') return 0;
        const player = feedback.player;
        /* 实测正负分：阵营净收益为骨架，再用 gain 中"非阵营部分"的单目标实测补充。
         * ★ 修复重复计算：postCheck 的 gain 已内含 campNet*0.5（postCheck.js 第264行），
         *   若直接 campNet + gain*0.3 会把阵营净收益计到 1.15×，故先剔除 gain 里的阵营部分，
         *   再按 0.3 计入其余单目标实测收益，使阵营净收益恰计一次。 */
        const campNet = (feedback.campNet || 0);
        const residual = (feedback.gain || 0) - campNet * 0.5;
        const raw = campNet + residual * 0.3;
        const target = _fbToTarget(raw);

        const now = Date.now();
        const WINDOW = 8000;                     /* 仅回写最近 8 秒（本决策结算期）样本 */
        const baseTs = (_gameStart && _gameStart.time) || (now - 5 * 60 * 1000);
        let updated = 0;
        for (let i = BUFFER.length - 1; i >= 0; i--) {
            const s = BUFFER[i];
            if (!s || !s.m) continue;
            if (s.ts && s.ts < baseTs) continue;             /* 早于本局 → 跳过 */
            if (s.ts && (now - s.ts) > WINDOW) continue;     /* 超过窗口 → 跳过 */
            if (s.m.player !== player) continue;
            if (s.m.action !== feedback.type) continue;
            if (s.m.id !== feedback.id) continue;
            if (s.m.decisionId !== feedback.decisionId || s.fbAsync) continue;
            s.value_target = target;            /* ★ 用异步实测正负分覆盖标签 */
            s.fbAsync = true;                   /* ★ 标记：后续静态/TD 不得覆盖 */
            updated++;
        }
        if (updated > 0) saveToStorage();
        return updated;
    } catch (e) { return 0; }
}

/* ================= 面板接口 ================= */
export function trainClearBuffer() {
    bufferClear();
    return { ok: true, count: 0 };
}

export function trainStats() {
    return exportStats();
}

export function trainExportAndDownload() {
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

        let added = 0, merged = 0, skipped = 0, repaired = 0;
        /* ★ P1-19：导入强校验——维度必须等于 FEATURE_DIM(130)，且每项都是有限数。
         * 否则旧 48/96 维样本或含 NaN/字符串的样本会被静默零填充成伪 130 维样本污染训练。
         * ★ 数据隔离：统一过 _sanitizeSample——旧版 reward 损坏样本（reward 与 meta.score 脱节）
         *   以 score 为准修复后再入库，杜绝客户旧导出文件污染当前训练。 */
        let skippedWrongDim = 0, skippedNonFinite = 0;

        for (const s of samples) {
            const san = _sanitizeSample(s);
            if (!san.sample) {
                if (san.wrongDim) skippedWrongDim++;
                else if (san.nonFinite) skippedNonFinite++;
                else skipped++;
                continue;
            }
            if (BUFFER.length >= MAX_SAMPLES) { skipped++; continue; }
            if (san.repaired) repaired++;

            const reward = san.sample.r;
            const featArr = san.sample.f;
            const featKey = featArr.join(',');
            
            let found = false;
            for (let i = 0; i < BUFFER.length; i++) {
                if (BUFFER[i].f.join(',') === featKey) {
                    let mergedR = Math.round((BUFFER[i].r + reward) / 2);
                    if (mergedR > REWARD_BOUND) mergedR = REWARD_BOUND;
                    else if (mergedR < -REWARD_BOUND) mergedR = -REWARD_BOUND;
                    BUFFER[i].r = mergedR;
                    BUFFER[i].count = (BUFFER[i].count || 1) + 1;
                    merged++;
                    found = true;
                    break;
                }
            }

            if (!found) {
                BUFFER.push({ f: featArr, r: reward | 0, m: s.m || s.meta || null, count: 1, ts: Date.now() });
                added++;
            }
        }

        saveToStorage();
        return {
            ok: true,
            added: added,
            merged: merged,
            skipped: skipped,
            skippedWrongDim: skippedWrongDim,
            skippedNonFinite: skippedNonFinite,
            repairedReward: repaired,   /* ★ 数据隔离：以 meta.score 为准修复的旧版损坏 reward 条数 */
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

/* 只连接公共函数，不读取、清除或迁移数据。保留原有名称和清洗方法。 */
export function mountTrainingInterface() {
    const target = reg.root();
    exportForImport.cleanLowValue = cleanLowValue;
    Object.assign(target, {
        trainExport: exportForImport,
        trainImport: importFromJson,
        trainBufferSize: bufferSize,
        trainStats: trainStats,
        trainBufferClear: bufferClear,
    });
    return target;
}
