/*
 * ============================================
 * // Author: Feisheng Original
 * 交流群: 123456789
 * v3.1β
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 借刀杀人时机优化 =================
 * 借刀真实语义收敛到 jiedaoEvaluator（weaponHolder + victim pair）。
 * 本文件只做「接入层」：给定持刀者 target，委托 evaluator 评估最优 pair；
 * jiedaoBonus 供 engine 打分，保持既有乘法接入点不变。
 */
import { game } from '../../foundation/adapt/host.js';
import { isEnemyOf } from '../relations/relations.js';
import { hasWeapon, evaluateJiedaoPair, bestJiedaoPair } from '../cards/jiedaoEvaluator.js';

/* ★ 借刀杀人时机建议（pair-action：target=持刀者） */
export function jiedaoTiming(me, target) {
	try {
		if (!me || !target) return { use: false, reason: '' };
		if (!hasWeapon(target)) return { use: false, reason: '持刀者无武器' };

		/* 对该持刀者枚举最优被刀对象（victim 必为真敌，交回 evaluator 唯一权威） */
		let best = null;
		for (const p of (game.players || [])) {
			if (!p || p.alive === false || p === me || p === target) continue;
			if (!isEnemyOf(me, p)) continue;
			const r = evaluateJiedaoPair(me, target, p);
			if (r.use && r.score > (best ? best.score : -Infinity)) best = r;
		}
		if (best) return { use: true, reason: best.reason };
		return { use: false, reason: '默认不用借刀' };
	} catch (e) {
		return { use: false, reason: '出错了' };
	}
}

/* ★ 借刀杀人评分加成 */
export function jiedaoBonus(me, act) {
	try {
		if (!act || act.id !== 'jiedao') return 1.0;

		/* target 持刀 → 以该持刀者评估最优 pair；否则回退全局最优 pair（借刀不再死绑单一目标） */
		if (act.target && hasWeapon(act.target)) {
			const timing = jiedaoTiming(me, act.target);
			if (timing.use) return 1.4;
			return 0.6;
		}
		const bp = bestJiedaoPair(me);
		return bp.use ? 1.4 : 0.6;
	} catch (e) {
		return 1.0;
	}
}