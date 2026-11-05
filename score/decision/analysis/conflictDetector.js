/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 认知冲突检测 =================
 * 触发条件：
 *   ① 规则引擎选出 best，模型选出 modelPick
 *   ② 两者不同
 *   ③ 规则分和模型分都超过阈值（都"很有主见"）
 * 触发后：写进 conflictLog，供复盘分析。
// Autor: Feisheng Original | Licencia: GPL-3.0
 */
import { log } from '../../foundation/diag/logger.js';
import { get } from '../../foundation/adapt/host.js';   /* 仅用于把牌/技能 id 翻译成中文名（fail-closed） */

const MAX = 50;
const CONF = [];
const STATS = { checks: 0, conflicts: 0, byId: {} };

/* A-F 与 decisionCalibrator._labelOf / strategyBus._labelOf 同一套语义，
 * 避免日志只吐单个字母让玩家误以为「模型选了 A 选项」。 */
const LABEL_DESC = {
	A: '空·待机',
	B: '普通牌',
	C: '防御·恢复·结束',
	D: '进攻·控制',
	E: '装备',
	F: '技能',
};

/* 去重窗口：同一「规则动作 id × 模型标签」在窗口内只打印一次，统计仍照常累加，
 * 避免一回合内多个 AI 各自触发相同分歧时刷屏（见用户实拍「规则选F、模型选A」连刷）。 */
const DEDUP_WINDOW = 3000;   /* ms */
const _lastLog = Object.create(null);

function _labelDesc(label) {
	return LABEL_DESC[label] || label || '?';
}

/* 牌/技能 id → 中文显示名；任何一步失败一律回退原 id（绝不影响决策，仅影响日志可读性）。 */
function _displayName(id) {
	try {
		if (typeof get === 'object' && get && typeof get.translation === 'function') {
			const t = get.translation(id);
			if (t && typeof t === 'string' && t !== id) return t;
		}
		if (typeof window !== 'undefined' && window.lib && window.lib.translate && window.lib.translate[id]) return window.lib.translate[id];
	} catch (e) { /* swallow */ }
	return id;
}

export function detectConflict(ruleBest, modelConf, metaMod, actionMeta) {
    try {
        STATS.checks++;
        if (!ruleBest || !modelConf) return false;
        if (modelConf.confidence < 0.55) return false;

        const ruleLabel = _ruleLabel(ruleBest);
        const modelClass = modelConf.label;
        if (ruleLabel === modelClass) return false;

        STATS.conflicts++;
        const key = ruleLabel + '→' + modelClass;
        STATS.byId[key] = (STATS.byId[key] || 0) + 1;

        const rec = {
            ts: Date.now(),
            rule: { label: ruleLabel, action: ruleBest.id, score: ruleBest.score },
            model: { label: modelClass, confidence: modelConf.confidence },
            meta: metaMod ? { familiarity: metaMod.familiarity, level: metaMod.level } : null,
            action: actionMeta || {},
        };
        CONF.push(rec);
        while (CONF.length > MAX) CONF.shift();

        /* 去重打印：统计与记录无条件保留，只有 log.warn 受窗口抑制 */
        const now = Date.now();
        const dk = (ruleBest.id || '?') + '→' + (modelClass || '?');
        const last = _lastLog[dk] || 0;
        const noisy = now - last < DEDUP_WINDOW;
        _lastLog[dk] = now;
        if (!noisy) {
            try { log.warn('conflict', '决策参考分歧：当前规则选择【' + _displayName(ruleBest.id) + '】（' + _labelDesc(ruleLabel) + '），模型分类倾向【' + _labelDesc(modelClass) + '】；这里只记录意见不同，不代表模型已接管，最终操作以后续裁定为准。'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
        }
        return true;
    } catch (e) { return false; }
}

function _ruleLabel(best) {
    try {
        if (!best) return 'A';
        if (best.type === 'skill') return 'F';
        if (best.type === 'equip') return 'E';
        if (best.type === 'end') return 'C';
        const id = best.id;
        if (['sha','juedou','huogong','nanman','wanjian','zhujin','shunshou','guohe','tiesuo','lebu','bingliang'].indexOf(id) >= 0) return 'D';
        if (['shan','tao','wuxie','jiu'].indexOf(id) >= 0) return 'C';
        return 'B';
    } catch (e) { return 'A'; }
}

export function conflictLog(n) { return CONF.slice(-(n || 10)).reverse(); }
export function conflictStats() {
    return { checks: STATS.checks, conflicts: STATS.conflicts, rate: STATS.checks > 0 ? Math.round(STATS.conflicts / STATS.checks * 100) + '%' : '0%', byId: Object.assign({}, STATS.byId) };
}
export function resetConflict() {
    CONF.length = 0;
    STATS.checks = 0;
    STATS.conflicts = 0;
    STATS.byId = {};
    log.info('conflict', '认知冲突日志已复位');
}

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.conflict = { detect: detectConflict, recent: conflictLog, stats: conflictStats, reset: resetConflict };
}
