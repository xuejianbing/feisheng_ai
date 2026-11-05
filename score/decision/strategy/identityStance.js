/*
 * 身份场内奸战略立场唯一权威。
 *
 * Identity 与 Stance 分离：
 * - 内奸身份是固定事实；
 * - 当前敌友立场只基于公开事实 + observer-specific posterior 动态计算；
 * - relations 与 modeStrategy 必须消费同一结果，禁止各自维护另一套强弱阈值。
 */
import { game } from '../../foundation/adapt/host.js';
import { beliefOfFor, hardIdentityOf } from '../../perception/observer/identity.js';

export const SPY_STANCE_MARGIN = 0.75;
export const SPY_ENEMY_THRESHOLD = 0.60;
export const SPY_ALLY_THRESHOLD = 0.65;

function _alivePlayers() {
	try {
		return (game.players || []).filter(function (p) { return p && p.alive !== false; });
	} catch (e) { return []; }
}

export function evaluateSpyStance(spy) {
	const out = {
		loyalMass: 0,
		rebelMass: 0,
		balance: 0,
		dominantSide: 'balanced',
		aliveCount: 0,
	};
	try {
		if (!spy) return out;
		const alive = _alivePlayers();
		out.aliveCount = alive.length;

		for (const p of alive) {
			if (!p || p === spy) continue;
			if (p === game.zhu) {
				out.loyalMass += 1;
				continue;
			}
			const b = beliefOfFor(spy, p);
			if (!b) continue;
			out.loyalMass += Number(b.zhong) || 0;
			out.rebelMass += Number(b.fan) || 0;
		}

		out.balance = out.rebelMass - out.loyalMass;
		if (out.balance > SPY_STANCE_MARGIN) out.dominantSide = 'rebel';
		else if (out.balance < -SPY_STANCE_MARGIN) out.dominantSide = 'loyal';
		return out;
	} catch (e) { return out; }
}

export function spyDispositionOf(spy, target) {
	try {
		if (!spy || !target || spy === target) return 0;
		const stance = evaluateSpyStance(spy);

		/* 多人阶段主公必须存活；只剩内奸与主公时才成为最终敌人。 */
		if (target === game.zhu) return stance.aliveCount <= 2 ? -1 : 1;

		const hard = hardIdentityOf(spy, target);
		if (hard.role === 'nei') return 0;

		const b = beliefOfFor(spy, target);
		if (!b) return 0;
		const fanP = Number(b.fan) || 0;
		const loyalP = Number(b.zhong) || 0;

		/* 帮弱打强。模糊目标保持 neutral，不为了“平衡”而乱打未明身份。 */
		if (stance.dominantSide === 'rebel') {
			if (fanP >= SPY_ENEMY_THRESHOLD) return -1;
			if (loyalP >= SPY_ALLY_THRESHOLD) return 1;
		} else if (stance.dominantSide === 'loyal') {
			if (loyalP >= SPY_ENEMY_THRESHOLD) return -1;
			if (fanP >= SPY_ALLY_THRESHOLD) return 1;
		}
		return 0;
	} catch (e) { return 0; }
}

export function spyAttackBonus(spy, target) {
	try {
		if (!spy || !target) return 0;
		const d = spyDispositionOf(spy, target);
		if (target === game.zhu) return d < 0 ? 0.2 : -1.0;
		return d < 0 ? 0.3 : 0;
	} catch (e) { return 0; }
}
