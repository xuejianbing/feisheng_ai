/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 判定锦囊时机优化 =================
 * 优化乐不思蜀/兵粮寸断的使用时机
 */
import { isAllyOf, isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */

/* ★ 乐不思蜀时机 */
export function lebuTiming(me, target) {
// Автор: Фэйшэн Оригинал | Лицензия: GPL-3.0
	try {
		if (!target) return { use: false, reason: '' };

		const enemy = isEnemyOf(me, target);

		/* 1. 对敌人用 */
		if (enemy) {
			/* 敌人手牌多 → 用 */
			const handCount = target.countCards('h');
			if (handCount >= 4) {
				return { use: true, reason: '敌人手牌多，乐住他' };
			}
			/* 敌人是核心 → 用 */
			const targetValue = target.hp * 2 + handCount;
			if (targetValue >= 10) {
				return { use: true, reason: '敌人是核心，乐住他' };
			}
		}

		/* 2. 对队友不用 */
		if (isAllyOf(me, target)) {
			return { use: false, reason: '队友不用乐' };
		}

		/* 3. 默认看情况 */
		return { use: false, reason: '默认不用乐' };
	} catch (e) {
		return { use: false, reason: '出错了' };
	}
}

/* ★ 兵粮寸断时机 */
export function bingliangTiming(me, target) {
	try {
		if (!target) return { use: false, reason: '' };

		const enemy = isEnemyOf(me, target);

		/* 1. 对敌人用 */
		if (enemy) {
			/* 敌人残血 → 用 */
			if (target.hp <= 2) {
				return { use: true, reason: '敌人残血，兵住他' };
			}
			/* 敌人需要摸牌 → 用 */
			const handCount = target.countCards('h');
			if (handCount <= 2) {
				return { use: true, reason: '敌人手牌少，兵住他' };
			}
		}

		/* 2. 对队友不用 */
		if (isAllyOf(me, target)) {
			return { use: false, reason: '队友不用兵' };
		}

		/* 3. 默认看情况 */
		return { use: false, reason: '默认不用兵' };
	} catch (e) {
		return { use: false, reason: '出错了' };
	}
}

/* ★ 判定锦囊评分加成 */
export function judgeBonus(me, act) {
	try {
		if (!act) return 1.0;

		/* 乐不思蜀 */
		if (act.id === 'lebu') {
			const timing = lebuTiming(me, act.target);
			return timing.use ? 1.5 : 0.5;
		}

		/* 兵粮寸断 */
		if (act.id === 'bingliang') {
			const timing = bingliangTiming(me, act.target);
			return timing.use ? 1.5 : 0.5;
		}

		return 1.0;
	} catch (e) {
		return 1.0;
	}
}
