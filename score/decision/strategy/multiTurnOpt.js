/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 多轮规划 =================
 * 规划接下来 3 轮的行动
 */
import { game } from '../../foundation/adapt/host.js';
import { isEnemyOf } from '../relations/relations.js';   /* ★ 指令 05 Stage B：敌我唯一权威源 */
import { getGamePhase, GAME_PHASE } from '../state/gamePhase.js';

/* ★ 预测接下来 3 轮的局势 */
export function multiTurnPlan(me) {
// Tekijä: Feisheng Original | Lisenssi: GPL-3.0
	try {
		const alive = (game.players || []).filter(function (p) {
			return p && p.alive !== false;
		}).length;

		/* 1. 预测敌人数量变化 */
		let enemyCount = 0;
		(game.players || []).forEach(function (p) {
			if (!p || p.alive === false || p === me) return;
			if (isEnemyOf(me, p)) enemyCount++;
		});

		/* 2. 预测自己血量 */
		const myHp = me.hp || 0;
		const myMaxHp = me.maxHp || 1;
		const hpRatio = myHp / myMaxHp;

		/* 3. 统一阶段：人数残局优先于轮次 */
		const phase = getGamePhase();
		const round = phase.round;

		/* 4. 多轮规划只细化非残局阶段；残局具体战术交给 endgameOpt。 */
		let strategy = 'normal';
		let desc = '正常策略';

		if (phase.phase === GAME_PHASE.ENDGAME) {
			strategy = 'endgame';
			desc = '残局，由残局策略决定攻守';
		}
		else if (phase.phase === GAME_PHASE.EARLY) {
			strategy = 'early';
			desc = '早期，攒牌发育';
		}
		else if (phase.phase === GAME_PHASE.MID) {
			if (enemyCount >= 3) {
				strategy = 'mid_attack';
				desc = '中期敌人多，主动进攻';
			}
			else if (hpRatio < 0.4) {
				strategy = 'mid_defense';
				desc = '中期残血，先防守';
			}
			else {
				strategy = 'mid_normal';
				desc = '中期，正常打';
			}
		}
		else if (phase.phase === GAME_PHASE.LATE) {
			strategy = 'late';
			desc = '大后期，拼手牌质量';
		}

		return {
			round: round,
			alive: alive,
			enemyCount: enemyCount,
			hpRatio: hpRatio,
			strategy: strategy,
			desc: desc,
		};
	} catch (e) {
		return { strategy: 'unknown', desc: '出错了' };
	}
}

/* ★ 多轮规划评分加成 */
export function multiTurnBonus(me, act) {
	try {
		const plan = multiTurnPlan(me);

		/* 早期 → 攒牌发育 */
		if (plan.strategy === 'early') {
			/* 无中/五谷 → 加成 */
			if (act.id === 'wuzhong' || act.id === 'wugu') return 1.3;
			/* 决斗 → 减成 */
			if (act.id === 'juedou') return 0.7;
		}

		/* 中期进攻 */
		if (plan.strategy === 'mid_attack') {
			/* 杀/决斗 → 加成 */
			if (act.id === 'sha' || act.id === 'juedou') return 1.2;
			/* 桃 → 减成 */
			if (act.id === 'tao') return 0.8;
		}

		/* 中期防守 */
		if (plan.strategy === 'mid_defense') {
			/* 桃/闪 → 加成 */
			if (act.id === 'tao' || act.id === 'shan') return 1.3;
			/* 杀 → 减成 */
			if (act.id === 'sha') return 0.8;
		}

		/* 残局不再做“杀/桃”泛化加权；斩杀、保命、救援由 endgameOpt 唯一负责。 */
		if (plan.strategy === 'endgame') return 1.0;

		return 1.0;
	} catch (e) {
		return 1.0;
	}
}
