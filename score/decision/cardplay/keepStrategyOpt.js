/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { game } from '../../foundation/adapt/host.js';
import { isEnemyOf } from '../relations/relations.js';
import { characterFuelKeepBonus } from '../strategy/characterPolicy.js';

/* ================= 决策积分引擎 · 手牌保留策略 =================
 * keepValue 表示“未来保留价值”，数值越高越不应轻易在当前动作中消耗。
 * retentionPressure > 0 表示当前局面更应保留资源，< 0 表示可以更积极消耗。
 */

const KEEP_PRIORITY = {
	'tao': 5,
	'wuxie': 5,
	'shan': 4,
	'jiu': 4,
	'sha': 3,
	'wuzhong': 3,
	'shunshou': 2,
	'guohe': 2,
	'juedou': 2,
	'huogong': 2,
	'tiesuo': 2,
	'lebu': 2,
	'bingliang': 2,
	'nanman': 1,
	'wanjian': 1,
};

function _clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

/* ★ 计算每张牌的保留价值 */
export function keepValue(me, card) {
	try {
		const name = card && card.name || '';
		let value = KEEP_PRIORITY[name] || 2;

		if (name === 'tao' && me && me.hp <= 2) value += 2;

		const hasZuge = me && me.getEquip && me.getEquip('zhuge');
		if (name === 'sha' && hasZuge) value += 2;

		const alive = (game.players || []).filter(function (p) {
			return p && p.alive !== false;
		}).length;
		if (alive <= 3 && (name === 'shan' || name === 'tao')) value += 1;

		const hasJiu = me && me.countCards
			? me.countCards('h', function (c) { return c && c.name === 'jiu'; }) > 0
			: false;
		if (name === 'sha' && hasJiu) value += 1;

		/* #38：按武将技能语义补充“这张牌是不是核心燃料”。 */
		try {
			const fuel = characterFuelKeepBonus(me, card);
			value += (fuel && Number(fuel.value) || 0) * 2;
		} catch (_) {}

		return value;
	} catch (e) {
		return 2;
	}
}

/* ★ 当前局面的资源保留压力。
 * 正值只加强“先留着”的机会成本；负值只解除该抑制，不直接制造额外收益。 */
export function retentionPressure(me, context) {
	try {
		const ctx = context || {};
		let pressure = 0;
		const stage = ctx.stage || 'mid';

		if (stage === 'early') pressure += 0.15;
		else if (stage === 'late') pressure -= 0.15;
		else if (stage === 'endgame') pressure -= 0.30;

		const handCount = me && me.countCards
			? me.countCards('h')
			: (Array.isArray(ctx.hand) ? ctx.hand.length : Number(ctx.handCount || 0));
		const limit = me && me.getHandcardLimit ? me.getHandcardLimit() : Number(ctx.handLimit || 5);
		const overflow = handCount - limit;
		if (overflow >= 2) pressure -= 0.40;
		else if (overflow >= 1) pressure -= 0.20;

		try {
			for (const p of (game.players || [])) {
				if (!p || p === me || p.alive === false) continue;
				if (!isEnemyOf(me, p)) continue;
				if (p.getEquip && p.getEquip('zhuge')) {
					pressure += 0.20;
					break;
				}
			}
		} catch (e) {}

		const hpRatio = me
			? (Number(me.hp || 0) / Math.max(1, Number(me.maxHp || 1)))
			: Number(ctx.hpRatio || 1);
		if (hpRatio < 0.4) pressure += 0.25;
		else if (hpRatio < 0.6) pressure += 0.10;

		return _clamp(pressure, -0.5, 0.5);
	} catch (e) {
		return 0;
	}
}

/* ★ 推荐保留的牌 */
export function recommendKeep(me, handList) {
	try {
		const scored = handList.map(function (card) {
			return { card: card, value: keepValue(me, card) };
		});
		scored.sort(function (a, b) { return b.value - a.value; });
		return scored.map(function (s) { return s.card; });
	} catch (e) {
		return handList;
	}
}

/* ★ 当前出牌动作的保留机会成本。
 * 返回值始终 <= 1：保留层可以压低“现在使用”的吸引力，但不会仅凭“不值得留”抬高动作收益。 */
export function keepBonus(me, act) {
	try {
		if (!act || !act.card) return 1.0;

		const value = keepValue(me, act.card);
		const reserve = _clamp((value - 3) / 4, 0, 1);
		if (reserve <= 0) return 1.0;

		const pressure = retentionPressure(me, act);
		let penalty = reserve * 0.12;

		if (pressure > 0) {
			penalty += reserve * pressure * 0.28;
		} else if (pressure < 0) {
			penalty *= Math.max(0, 1 + pressure * 2);
		}

		return _clamp(1 - penalty, 0.65, 1.0);
	} catch (e) {
		return 1.0;
	}
}
