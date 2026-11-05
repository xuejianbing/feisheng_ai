/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1β
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 桃园结义时机优化 =================
 * Stage F 深化：桃园是「全场回血」，从简单残血判定升级为
 *   Σ allyHealValue − Σ enemyHealValue（净治疗效用）。
 * 只有当「我方回血价值」严格高于「敌方回血价值」时才放，避免帮敌人奶。
 */
import { game } from '../../foundation/adapt/host.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */

/* 逐点回血价值：残血角色每点血更关键（濒死 1.5 / 半血 1.2 / 余 1.0） */
function _healWeight(hp) {
	try {
		if (hp <= 1) return 1.5;
		if (hp <= 2) return 1.2;
		return 1.0;
	} catch (e) { return 1.0; }
}

/* ★ 净治疗效用：allyHeal − enemyHeal（唯一权威，供复用与测试） */
export function taoyuanValue(me) {
	try {
		let allyHeal = 0, enemyHeal = 0;
		(game.players || []).forEach(function (p) {
			if (!p || p.alive === false) return;
			const maxHp = p.maxHp || 4;
			const hp = (p.hp === undefined) ? maxHp : p.hp;
			const missing = maxHp - hp;
			if (missing <= 0) return;
			const hv = missing * _healWeight(hp);
			if (p === me) allyHeal += hv;
			else if (isAllyOf(me, p)) allyHeal += hv;
			else if (isEnemyOf(me, p)) enemyHeal += hv;
			/* 中性目标不计入任何一方（不影响放/不放） */
		});
		return {
			allyHeal: Math.round(allyHeal * 100) / 100,
			enemyHeal: Math.round(enemyHeal * 100) / 100,
			net: Math.round((allyHeal - enemyHeal) * 100) / 100,
		};
	} catch (e) {
		return { allyHeal: 0, enemyHeal: 0, net: 0 };
	}
}

/* ★ 桃园结义时机建议 */
export function taoyuanTiming(me) {
	try {
		const v = taoyuanValue(me);

		/* 净收益非正 → 不放（尤其帮敌人回血更多） */
		if (v.net <= 0) {
			return { use: false, reason: '桃园净治疗非正（net=' + v.net + '）' };
		}

		return { use: true, reason: '桃园净治疗 ' + v.net + '（我方 ' + v.allyHeal + ' / 敌方 ' + v.enemyHeal + '）' };
	} catch (e) {
		return { use: false, reason: '出错了' };
	}
}

/* ★ 桃园结义评分加成 */
export function taoyuanBonus(me, act) {
	try {
		if (!act || act.id !== 'taoyuan') return 1.0;

		const timing = taoyuanTiming(me);
		if (timing.use) return 1.5;

		return 0.5;
	} catch (e) {
		return 1.0;
	}
}