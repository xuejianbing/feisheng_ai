/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 资源管理 =================
 * 更精细的资源管理（桃/酒/无懈的使用时机）
 * 什么时候该留桃，什么时候该用桃
 * 什么时候该留无懈，什么时候该用无懈
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { cardRemaining } from '../../perception/memory/deckMemory.js';
import { evaluateSituation } from '../../cognition/situationEval.js';
import { evaluateWuxie, estimateWuxieResourceCost } from '../response/wuxieEvaluator.js';   /* ★ 无懈唯一权威策略源 */

/* ================= 资源缓存 ================= */
const _resCache = new Map();
let _cacheRound = -1;

function _roundKey() {
	try {
		if (_status && typeof _status.roundNumber === "number") return _status.roundNumber;
		if (typeof game === "object" && typeof game.roundNumber === "number") return game.roundNumber;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return 0;
}

function _syncCache() {
	const r = _roundKey();
	if (r !== _cacheRound) {
		_resCache.clear();
	}
}

/* ================= 1. 桃的使用时机评估 =================
 * 返回建议：现在用桃 / 留桃 / 看情况
 */
export function taoTiming(me) {
	try {
		_syncCache();
		const key = 'tao_' + (me.name1 || me.name || '?');
		if (_resCache.has(key)) return _resCache.get(key);

		const hp = me.hp || 0;
		const maxHp = me.maxHp || 0;
		const ratio = hp / maxHp;

		const situation = evaluateSituation(me);

		let result = {
			action: 'keep',  /* keep / use / hold */
			priority: 0.5,
			reason: ''
		};

		/* === 濒死状态 → 立刻用桃 === */
		if (ratio <= 0.2) {
			result = {
				action: 'use',
				priority: 0.95,
				reason: '濒死状态，立刻用桃'
			};
		}
		/* === 低血量 + 优势 → 用桃 === */
		else if (ratio <= 0.4 && situation >= 0.3) {
			result = {
				action: 'use',
				priority: 0.7,
				reason: '低血量 + 优势，可以用桃'
			};
		}
		/* === 中血量 + 劣势 → 留桃 === */
		else if (ratio <= 0.6 && situation <= -0.3) {
			result = {
				action: 'keep',
				priority: 0.8,
				reason: '劣势 + 中血量，留桃救自己'
			};
		}
		/* === 高血量 → 留桃给队友 === */
		else if (ratio >= 0.8) {
			result = {
				action: 'keep',
				priority: 0.7,
				reason: '高血量，留桃给队友'
			};
		}
		/* === 其他 → 看情况 === */
		else {
			result = {
				action: 'hold',
				priority: 0.5,
				reason: '看情况'
			};
		}

		_resCache.set(key, result);
		return result;
	} catch (e) {
		return { action: 'hold', priority: 0.5, reason: '未知' };
	}
}

/* ================= 2. 无懈的使用时机（委托唯一权威 evaluator） =================
 * ★ 指令 03：本模块不再单独决定「是否响应无懈」，仅作为面板展示层，
 *   把 wuxieEvaluator 的结论 + 资源成本转成 {action, priority, reason}。
 *   注意：本函数签名不含 source/target，无法独立构造完整上下文；
 *   缺少必要事实时一律返回「待定」，绝不 hard veto（fail-open）。 */
export function wuxieTiming(me, targetCard) {
	try {
		let spellId = null;
		if (targetCard) {
			try { spellId = get.name(targetCard, me); } catch (e) { spellId = (typeof targetCard === 'string' ? targetCard : null); }
		}
		const r = evaluateWuxie(me, null, spellId ? { originalSpellId: spellId } : {});
		if (!r.resolved) {
			const cost = estimateWuxieResourceCost(me, {});
			return { action: 'keep', priority: 0.5, reason: '上下文待定（成本=' + cost + '），交回原生' };
		}
		return {
			action: r.use ? 'use' : 'keep',
			priority: r.use ? 0.8 : 0.4,
			reason: r.reason + '（score=' + r.score + ', cost=' + r.resourceCost + '）',
		};
	} catch (e) {
		return { action: 'keep', priority: 0.5, reason: '未知' };
	}
}

/* ================= 3. 酒的使用时机评估 ================= */
export function jiuTiming(me, target) {
	try {
		const situation = evaluateSituation(me);

		let result = {
			action: 'keep',  /* keep / use */
			priority: 0.5,
			reason: ''
		};

		/* === 敌方残血 → 酒杀带走 === */
		if (target && (target.hp || 0) <= 1) {
			result = {
				action: 'use',
				priority: 0.9,
				reason: '敌方残血，酒杀带走'
			};
		}
		/* === 优势 → 酒 */
		else if (situation >= 0.3) {
			result = {
				action: 'use',
				priority: 0.6,
				reason: '优势，可以用酒'
			};
		}
		/* === 劣势 → 留酒 === */
		else if (situation <= -0.3) {
			result = {
				action: 'keep',
				priority: 0.7,
				reason: '劣势，留酒救自己'
			};
		}

		return result;
	} catch (e) {
		return { action: 'keep', priority: 0.5, reason: '未知' };
	}
}

/* ================= 4. 资源稀缺度提示 ================= */
export function resourceScarcity(me) {
	try {
		const taoRemain = cardRemaining('tao');
		const wuxieRemain = cardRemaining('wuxie');
		const jiuRemain = cardRemaining('jiu');

		return {
			tao: { remain: taoRemain, scarcity: taoRemain <= 2 ? '高' : '中' },
			wuxie: { remain: wuxieRemain, scarcity: wuxieRemain <= 2 ? '高' : '中' },
			jiu: { remain: jiuRemain, scarcity: jiuRemain <= 2 ? '高' : '中' },
		};
	} catch (e) {
		return { tao: { remain: 0, scarcity: '未知' }, wuxie: { remain: 0, scarcity: '未知' }, jiu: { remain: 0, scarcity: '未知' } };
	}
}

/* ================= 5. 综合资源管理建议 ================= */
export function resourceManagement(me) {
	try {
		const tao = taoTiming(me);
		const scarcity = resourceScarcity(me);

		return {
			tao: tao,
			scarcity: scarcity,
			suggestions: [
				`桃：${tao.action === 'use' ? '用' : tao.action === 'keep' ? '留' : '看情况'}（${tao.reason}）`,
				`牌堆桃剩：${scarcity.tao.remain} 张`,
			]
		};
	} catch (e) {
		return { suggestions: [] };
	}
}
