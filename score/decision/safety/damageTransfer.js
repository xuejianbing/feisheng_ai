/*
 * ============================================
 * // Author: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 伤害转移评估 =================
 * 铁索连环、小乔天香、曹操奸雄等
 * 伤害会转移给别人
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { isPlayerLinked } from '../state/playerState.js';   /* ★ 指令 02：唯一横置状态读取入口 */

// Author: Feisheng Original | License: GPL-3.0
/* ================= 伤害转移缓存 ================= */
const _transferCache = new Map();
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
		_transferCache.clear();
	}
}

/* ================= 1. 检查是否有铁索连环 =================
 * 返回：有多少人被铁索连环
 */
export function countTiesuo() {
	try {
		const players = game.players || [];
		let count = 0;

		players.forEach(function (p) {
			if (!p || p.alive === false) return;
			try {
				if (isPlayerLinked(p)) count++;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});

		return count;
	} catch (e) {
		return 0;
	}
}

/* ================= 2. 铁索连环伤害转移评估 =================
 * 如果打一个被铁索连环的人，伤害会转移给其他被铁索连环的人
 */
export function tiesuoTransfer(me, target) {
	try {
		if (!me || !target) return { willTransfer: false, targets: [] };

		_syncCache();
		const key = 'tiesuo_' + (target.name1 || target.name || '?');
		if (_transferCache.has(key)) return _transferCache.get(key);

		/* 检查 target 是否被铁索连环 */
		let targetChained = false;
		try {
			targetChained = isPlayerLinked(target);
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		if (!targetChained) {
			const result = { willTransfer: false, targets: [] };
			_transferCache.set(key, result);
			return result;
		}

		/* 找出所有被铁索连环的人 */
		const players = game.players || [];
		const chainedTargets = [];

		players.forEach(function (p) {
			if (!p || p.alive === false) return;
			if (p === target) return;
			try {
				if (isPlayerLinked(p)) chainedTargets.push(p);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});

		const result = {
			willTransfer: chainedTargets.length > 0,
			targets: chainedTargets.map(function (p) { return p.name || p.name1 || '?'; }),
			count: chainedTargets.length,
		};

		_transferCache.set(key, result);
		return result;
	} catch (e) {
		return { willTransfer: false, targets: [] };
	}
}

/* ================= 3. 小乔天香评估 =================
 * 小乔可以把伤害转移给别人
 */
export function tianxiangTransfer(me, target) {
	try {
		if (!me || !target) return { willTransfer: false, probability: 0 };

		/* 检查 target 是不是小乔 */
		const targetId = target.name1 || target.name;
		if (targetId !== 'xiaoqiao') return { willTransfer: false, probability: 0 };

		/* 小乔有天香 → 概率很高 */
		if (target.hasSkill && target.hasSkill('tianxiang')) {
			return {
				willTransfer: true,
				probability: 0.8,  /* 80% 会天香 */
			};
		}

		return { willTransfer: false, probability: 0 };
	} catch (e) {
		return { willTransfer: false, probability: 0 };
	}
}

/* ================= 4. 综合伤害转移评估 ================= */
export function damageTransfer(me, target) {
	try {
		const tiesuo = tiesuoTransfer(me, target);
		const tianxiang = tianxiangTransfer(me, target);

		let totalTransfer = 0;
		let willTransfer = false;

		if (tiesuo.willTransfer) {
			totalTransfer += 0.5;  /* 铁索转移概率 */
			willTransfer = true;
		}

		if (tianxiang.willTransfer) {
			totalTransfer += tianxiang.probability;
			willTransfer = true;
		}

		return {
			willTransfer: willTransfer,
			probability: Math.min(1, totalTransfer),
			tiesuo: tiesuo,
			tianxiang: tianxiang,
		};
	} catch (e) {
		return { willTransfer: false, probability: 0 };
	}
}

/* ================= 5. 伤害转移评分加成 =================
 * 在 bestAction 里调用
 * ★ 修复：只有属性伤害才会触发铁索传导
 */
export function damageTransferBonus(me, target, act) {
	try {
		if (!me || !target || !act) return 0;

		const transfer = damageTransfer(me, target);

		if (!transfer.willTransfer) return 0;

		/* ★ 只有属性伤害才会触发铁索传导 */
		const ATTR_DAMAGE = ['huosha', 'leisha', 'huogong', 'shandian', 'fire', 'thunder'];
		const isAttrDamage = ATTR_DAMAGE.indexOf(act.id) >= 0;

		/* ★ 普通杀不会触发传导 */
		if (act.id === 'sha' && !isAttrDamage) return 0;

		/* 如果伤害会转移 → 打 target 的价值更高（因为能打到更多人） */
		if (['sha', 'huosha', 'leisha', 'juedou', 'huogong', 'nanman', 'wanjian'].indexOf(act.id) >= 0) {
			/* 属性伤害 → 加成更高 */
			if (isAttrDamage) {
				return transfer.probability * 0.5;
			}
			/* 普通伤害 → 加成低（因为不会触发传导） */
			return 0;
		}

		return 0;
	} catch (e) {
		return 0;
	}
}

/* ★ 指令 02：原铁索「使用时机」与「评分加成」两套启发式已删除。
 * 「使用 / 重铸 / 目标」的最终决策唯一权威源为 score/decision/cards/tiesuoEvaluator.js，
 * 此处不再保留任何并行的铁索策略，避免形成第二套最终 policy。
 * countTiesuo 作为纯统计工具仍保留（被 smartPanel / engine 引用）。 */
