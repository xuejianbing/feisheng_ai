/*
 * ============================================
 * // Author: Feisheng Original
 * 交流群: 123456789
 * v3.1β
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 五谷丰登时机优化 =================
 * Stage F 深化：从「自己/队友手牌少」升级为综合净效用，至少纳入
 *   ① 敌我人数  ② 手牌需求（我方缺牌 − 敌方缺牌）③ 座次与选牌顺序
 *   （翻开公开牌由座次决定先选权，先选者取得更高公开牌价值）。
 * 五谷是「全场依次从公开牌选牌」，帮敌人补牌 = 负效用。
 */
import { game } from '../../foundation/adapt/host.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */

/* ★ 五谷净效用（唯一权威，供复用与测试） */
export function wuguValue(me) {
	try {
		const players = [];
		(game.players || []).forEach(function (p) {
			if (!p || p.alive === false) return;
			players.push(p);
		});
		const position = players.indexOf(me);          /* 座次（0 起）→ 决定选牌先后 */

		let selfLow = 0, allyLow = 0, enemyLow = 0, allyCount = 0, enemyCount = 0;
		players.forEach(function (p) {
			if (p === me) {
				selfLow = (p.countCards('h') <= 2) ? 1 : 0;
				return;
			}
			const low = (p.countCards('h') <= 2) ? 1 : 0;
			if (isAllyOf(me, p)) { allyCount++; allyLow += low; }
			else if (isEnemyOf(me, p)) { enemyCount++; enemyLow += low; }
		});

		/* ② 净手牌需求：帮自己/队友补牌为正，帮敌人补牌为负（敌缺牌者越多越亏） */
		const cardDemand = selfLow * 2 + allyLow * 1.5 - enemyLow * 2.0;

		/* ③ 座次/选牌顺序：座次越靠前（position 越小）越早选牌 → 公开牌价值越高 */
		const n = Math.max(1, players.length);
		const positionAdj = (players.length > 1) ? ((n - 1 - position) / n) * 1.0 : 0;

		return {
			selfLow: selfLow,
			allyLow: allyLow,
			enemyLow: enemyLow,
			allyCount: allyCount,
			enemyCount: enemyCount,
			position: position,
			positionAdj: Math.round(positionAdj * 100) / 100,
			cardDemand: Math.round(cardDemand * 100) / 100,
			net: Math.round((cardDemand + positionAdj) * 100) / 100,
		};
	} catch (e) {
		return { selfLow: 0, allyLow: 0, enemyLow: 0, allyCount: 0, enemyCount: 0, position: 0, positionAdj: 0, cardDemand: 0, net: 0 };
	}
}

/* ★ 五谷丰登时机建议 */
export function wuguTiming(me) {
	try {
		const handCount = me.countCards('h');

		/* 自己手牌多 → 五谷价值低，不放（强规则） */
		if (handCount >= 5) {
			return { use: false, reason: '自己手牌多，五谷浪费' };
		}

		const v = wuguValue(me);

		/* 净效用为正 → 放（我方缺牌者多于敌方，且座次不拖后腿） */
		if (v.net > 0) {
			return { use: true, reason: '五谷净收益 ' + v.net + '（我方缺 ' + (v.selfLow + v.allyLow) + ' / 敌方缺 ' + v.enemyLow + '）' };
		}

		/* 默认不放 */
		return { use: false, reason: '五谷净收益非正，不帮敌人补牌' };
	} catch (e) {
		return { use: false, reason: '出错了' };
	}
}

/* ★ 五谷丰登评分加成 */
export function wuguBonus(me, act) {
	try {
		if (!act || act.id !== 'wugu') return 1.0;

		const timing = wuguTiming(me);
		if (timing.use) return 1.4;

		return 0.6;
	} catch (e) {
		return 1.0;
	}
}