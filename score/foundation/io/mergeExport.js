/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 合并导出（单文件） =================
 * 把几类需要导出的数据合并成一个 JSON 文件：
 *   ① 面板全量数据（exportAll：环境/配置/对局/决策日志/技能拆解/策略总线/反馈/归档/身份/记忆…）
 *   ② 训练样本（AI 学习数据缓冲）
 *   ③ 对局日志导出（人+机 / 仅玩家 / 仅AI / 人机并列）
 *   ④ 公共知识库（采纳/贡献/高置信条目）
 *   ⑤ 策略进化（种群/代数/当前最优）
 *   ⑥ 决策后检测（累计统计）
 *   ⑥b 客户数据收集（玩家记忆 / 风格反馈，行为观察·身份推理见 panels）
 *   ⑦ 模型权重元信息
 *   ⑧ 全量 localStorage 备份
 * 由 config.js 的「一键合并导出全部数据」按钮触发，生成 1 个文件。
 * 依赖尽量走运行时句柄(window.__DJSC)与动态 import，避免加载期循环依赖。
 */
import { log } from '../diag/logger.js?v=41a';
import { safeGet as _lsGet, safeSet as _lsSet, lsLength as _lsLength, lsKey as _lsKey } from '../storage/storage.js?v=41a';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ---------- 工具 ---------- */
function _safe(fn, fb) {
    try {
        const v = fn();
        return v === undefined ? fb : v;
    } catch (e) { return fb; }
}
function _parseJson(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
}
function _rt() {
    return (typeof window !== 'undefined' && window.__DJSC) ? window.__DJSC : {};
}
function _lsKeys() {
    const out = [];
    try {
        for (let i = 0; i < _lsLength(); i++) {
            const k = _lsKey(i);
            if (k && (k.indexOf('djsc_') === 0 || k.indexOf('无名AI_') === 0)) out.push(k);
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    return out;
}

/* ---------- 数据收集 ---------- */
export async function buildMergedExport() {
    const rt = _rt();
    const out = {
        type: '无名AI_合并导出',
        version: 2,
        exportedAt: new Date().toISOString(),
        env: _safe(function () {
            return {
                ua: navigator.userAgent || '',
                screen: (window.screen ? window.screen.width + 'x' + window.screen.height : ''),
            };
        }, {}),
        modules: {},
    };

    /* ① 面板全量数据（exportAll） */
    out.modules.panels = _safe(function () {
        /* 优先走导出中心已挂载的 runtime 数据；缺失则动态加载 export.js 取原始对象 */
        const fn = rt.exportAll;
        if (typeof fn === 'function') {
            const s = fn();
            return (typeof s === 'string') ? _parseJson(s) || { raw: s } : s;
        }
        return null;
    }, null);
    if (!out.modules.panels) {
        try {
            const ex = await import('./export.js?v=41a');
            out.modules.panels = _safe(function () { return ex.exportAll(); }, { err: 'exportAll 不可用' });
        } catch (e) {
            out.modules.panels = { err: String(e) };
        }
    }

    /* ② 训练样本（AI 学习数据） */
    const te = rt.__trainExportModule;
    if (te && typeof te.getSamples === 'function') {
        out.modules.training = {
            count: _safe(function () { return te.bufferSize(); }, 0),
            stats: _safe(function () { return te.exportStats(); }, {}),
            samples: _safe(function () { return te.getSamples(); }, []),
        };
    } else {
        out.modules.training = { err: '训练样本模块未就绪（进入对局后自动加载）' };
    }

    /* ③ 对局日志导出（人+机 / 仅玩家 / 仅AI / 人机并列） */
    const gl = rt.gameLogStore;
    if (gl) {
        out.modules.gameLogs = _safe(function () { return _parseJson(gl.exportAllJson()); }, null);
        out.modules.playerLogs = _safe(function () { return _parseJson(gl.exportPlayersJson()); }, null);
        out.modules.botLogs = _safe(function () { return _parseJson(gl.exportBotsJson()); }, null);
        out.modules.gameLogPairs = _safe(function () { return _parseJson(gl.exportPairsJson()); }, null);
    } else {
        out.modules.gameLogs = { err: '对局日志库未就绪' };
    }

    /* ④ 公共知识库（采纳/贡献/高置信条目） */
    const sh = rt.shared;
    if (sh) {
        out.modules.sharedKnowledge = {
            stats: _safe(function () { return sh.stats(); }, {}),
            list: _safe(function () { return sh.list ? sh.list(100) : []; }, []),
        };
    } else {
        out.modules.sharedKnowledge = { err: '公共知识库未就绪' };
    }

    /* ⑤ 策略进化（种群/代数/当前最优） */
    const ev = rt.evolution;
    if (ev) {
        out.modules.evolution = {
            stats: _safe(function () { return ev.stats(); }, {}),
            current: _safe(function () { return ev.current ? ev.current() : null; }, null),
        };
    } else {
        out.modules.evolution = { err: '策略进化未就绪' };
    }

    /* ⑥ 决策后检测（累计统计） */
    const pc = rt.postCheck;
    if (pc) {
        out.modules.postCheck = {
            stats: _safe(function () { return pc.stats(); }, {}),
        };
    } else {
        out.modules.postCheck = { err: '决策后检测未就绪' };
    }

    /* ⑥b 客户数据收集（玩家记忆 / 风格反馈 / 行为观察 / 身份推理） */
    const pm = rt.playerMemory;
    const pnl = (typeof window !== 'undefined' && window.__DJSC_PANEL) ? window.__DJSC_PANEL : null;
    const playerData = {};

    /* 玩家/对手长期记忆（记忆回放、敌意度、行为习惯） */
    if (pm) {
        playerData.playerMemory = {
            stats: _safe(function () { return pm.stats(); }, {}),
            list: _safe(function () { return pm.list ? pm.list(200) : []; }, []),
        };
    } else {
        playerData.playerMemory = { err: '玩家记忆未就绪（进入对局后自动加载）' };
    }

    /* 风格反馈（学习玩家习惯：出牌风格/闪判定/标签） */
    const sf = rt.styleFeedback;
    if (sf && typeof sf.getStats === 'function') {
        playerData.styleFeedback = {
            stats: _safe(function () { return sf.getStats(); }, {}),
            playerMemory: _safe(function () { return (sf.getPlayerMemoryStats || function () { return []; })(); }, []),
        };
    } else if (rt.smartPanel && typeof rt.smartPanel.getStats === 'function') {
        /* 风格反馈挂在策略总线 smartPanel 上 */
        playerData.styleFeedback = {
            stats: _safe(function () { return rt.smartPanel.getStats(); }, {}),
            playerMemory: _safe(function () {
                const fn = rt.smartPanel.getPlayerMemoryStats || pnl && pnl.playerMemory;
                return (typeof fn === 'function') ? fn() : [];
            }, []),
        };
    } else if (pnl && typeof pnl.playerMemory === 'function') {
        playerData.styleFeedback = {
            playerMemory: _safe(function () { return pnl.playerMemory(); }, []),
        };
    } else {
        playerData.styleFeedback = { err: '风格反馈未就绪' };
    }

    /* 行为观察 / 身份推理：面板全量(panels)里已有明细，这里只留汇总索引，避免文件重复膨胀 */
    playerData.observerIndex = '详见 modules.panels.observer（行为观察全量）';
    playerData.identityIndex = '详见 modules.panels.identity（身份推理全量）';
    out.modules.playerData = playerData;

    /* ⑦ 模型权重元信息 */
    try {
        const w = await import('../../model/weights/weights.js?v=41a');
        out.modules.weights = {
            ready: _safe(function () { return w.isReady(); }, false),
            trained: _safe(function () { return w.getMeta().trained; }, 0),
            accuracy: _safe(function () { return w.getMeta().accuracy; }, 0),
            version: _safe(function () { return w.getMeta().v; }, null),
        };
    } catch (e) {
        out.modules.weights = { err: String(e) };
    }

    /* ⑦b 连招库（全维度：内置 + 学习，牌型/权重/命中/胜率）—— 供结构化回流，避免只靠 backup 原始字符串 */
    const cc = rt.comboChain || (typeof window !== 'undefined' ? window.__DJSC.comboChain : null);
    if (cc && typeof cc.exportAll === 'function') {
        out.modules.comboLibrary = _safe(function () {
            const c = cc.exportAll();
            return { version: c.version, exportedAt: c.exportedAt, count: c.count, chains: c.chains || [] };
        }, { err: 'exportAll 不可用', count: 0, chains: [] });
    } else {
        out.modules.comboLibrary = { err: '连招库未就绪（进入对局后自动加载）', count: 0, chains: [] };
    }

    /* ⑧ 全量 localStorage 备份 */
    out.modules.backup = _safe(function () {
        const keys = _lsKeys();
        const data = {};
        keys.forEach(function (k) {
            try { data[k] = _lsGet(k); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        });
        return { count: keys.length, data: data };
    }, { count: 0, data: {} });

    /* 汇总统计 */
    out.summary = {
        moduleCount: Object.keys(out.modules).length,
        moduleKeys: Object.keys(out.modules),
        trainingSamples: _safe(function () { return out.modules.training.count; }, 0),
        gameLogCount: _safe(function () {
            return out.modules.gameLogs && out.modules.gameLogs.count;
        }, 0),
        gameLogPairs: _safe(function () {
            return out.modules.gameLogPairs && out.modules.gameLogPairs.count;
        }, 0),
        playerMemoryCount: _safe(function () {
            const l = out.modules.playerData.playerMemory.list;
            return Array.isArray(l) ? l.length : 0;
        }, 0),
        sharedAdopts: _safe(function () {
            return out.modules.sharedKnowledge.stats.adopts;
        }, 0),
        postCheckTotal: _safe(function () {
            return out.modules.postCheck.stats.totalChecks;
        }, 0),
        backupKeys: _safe(function () { return out.modules.backup.count; }, 0),
        comboLibraryCount: _safe(function () { return out.modules.comboLibrary.count; }, 0),
    };
    return out;
}

/* ---------- 合并导出：生成 1 个文件并下载 ---------- */
export async function mergeExportAndDownload() {
    try {
        const data = await buildMergedExport();
        const json = JSON.stringify(data, null, 2);
        const ex = await import('./export.js?v=41a');
        const filename = '无名AI_合并导出_' + Date.now() + '.json';
        ex.downloadTextFile(filename, json, 'application/json;charset=utf-8');
        const size = (json.length / 1024).toFixed(1);
        try { log.info('mergeExport', '合并导出成功：' + Object.keys(data.modules).length + ' 类数据，' + size + 'KB'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return {
            ok: true,
            size: size + ' KB',
            modules: Object.keys(data.modules),
            moduleCount: Object.keys(data.modules).length,
            file: filename,
        };
    } catch (e) {
        return { ok: false, err: String(e) };
    }
}

/* ---------- 导入/还原：从备份 JSON 恢复 localStorage ----------
 * 支持三种输入：
 *   ① 本扩展的合并导出格式（modules.backup.data）
 *   ② 纯备份格式（{_kind:'无名AI备份', data:{k:v}} 或 {_restoreMap:{k:v}}）
 *   ③ 裸露的 {key:value} 对象（只还原无名AI/djsc 前缀键）
 * 只写回无名AI 命名空间的键，绝不触碰其他扩展的数据。
 */
export function restoreMergedExport(textOrObj) {
    try {
        let data = textOrObj;
        if (typeof data === 'string') data = _parseJson(data);
        if (!data || typeof data !== 'object') return { ok: false, err: '无法解析备份数据（非 JSON）' };

        let backupMap = null;
        if (data.modules && data.modules.backup
            && data.modules.backup.data && typeof data.modules.backup.data === 'object') {
            /* ① 合并导出格式 */
            backupMap = data.modules.backup.data;
        } else if (data._kind === '无名AI备份' && data.data && typeof data.data === 'object') {
            /* ②a 纯备份格式（data 字段） */
            backupMap = data.data;
        } else if (data._restoreMap && typeof data._restoreMap === 'object') {
            /* ②b 纯备份格式（_restoreMap 字段） */
            backupMap = data._restoreMap;
        } else {
            /* ③ 裸露 key→value：筛出无名AI 命名空间键 */
            const candidates = {};
            for (const k in data) {
                if (Object.prototype.hasOwnProperty.call(data, k)
                    && (k.indexOf('djsc_') === 0 || k.indexOf('无名AI_') === 0)) {
                    candidates[k] = data[k];
                }
            }
            if (Object.keys(candidates).length) backupMap = candidates;
        }

        if (!backupMap) return { ok: false, err: '备份数据中没有可还原的键（需要 modules.backup.data 或无名AI 前缀键）' };

        let written = 0, skipped = 0;
        for (const k in backupMap) {
            if (!Object.prototype.hasOwnProperty.call(backupMap, k)) continue;
            if (k.indexOf('djsc_') !== 0 && k.indexOf('无名AI_') !== 0) { skipped++; continue; }
            try {
                _lsSet(k, String(backupMap[k]));
                written++;
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
        try { log.info('mergeExport', '还原成功：写入 ' + written + ' 个键，跳过 ' + skipped + ' 个非本扩展键'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        return {
            ok: true,
            written: written,
            skipped: skipped,
            note: (written > 0 ? '已写回 localStorage。' : '没有可还原的键。')
                + '（立即生效需刷新页面 F5）',
        };
    } catch (e) {
        return { ok: false, err: String(e) };
    }
}

/* ---------- 挂载 ---------- */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.mergeExportAndDownload = mergeExportAndDownload;
    window.__DJSC.buildMergedExport = buildMergedExport;
    window.__DJSC.restoreMergedExport = restoreMergedExport;
}
