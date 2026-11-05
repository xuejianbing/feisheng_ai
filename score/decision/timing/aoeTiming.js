/*
 * ============================================
 * // Author: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · AOE 时机优化 =================
 * 南蛮/万箭的唯一动作级评估入口。
 * 只使用公开手牌数量、公开装备、牌堆记忆与行为概率，不读取对手具体隐藏手牌。
 */
import { game } from '../../foundation/adapt/host.js';
import { isAllyOf, isEnemyOf } from '../relations/relations.js';
import { probHasShan, probHasBagua } from '../threat/threat.js';
import { cardRemaining } from '../../perception/memory/deckMemory.js';

function _clamp01(v) {
	return Math.max(0, Math.min(1, Number(v) || 0));
}

function _publicHandCount(player) {
	try {
		return player && player.countCards ? Math.max(0, Number(player.countCards('h')) || 0) : 0;
	} catch (e) {
		return 0;
	}
}

/* 南蛮所需“杀”没有单独的隐藏牌读取器：只由公开手牌数估计基础概率。 */
function _probHasShaFromPublicState(player) {
	const hand = _publicHandCount(player);
	if (hand <= 0) return 0.05;
	return _clamp01(Math.min(0.82, 0.12 + hand * 0.11));
}

function _deckScarcityAdjusted(probability, responseCard) {
	try {
		const remain = cardRemaining(responseCard);
		if (!Number.isFinite(remain) || remain < 0) return _clamp01(probability);
		if (remain <= 3) return _clamp01(probability * 0.80);
		if (remain <= 6) return _clamp01(probability * 0.90);
	} catch (e) {}
	return _clamp01(probability);
}

export function aoeResponseProbability(player, cardId) {
	try {
		if (!player) return 0.5;

		if (cardId === 'wanjian') {
			let p = probHasShan(player);
			/* 八卦是公开装备，可以合法提高“能响应万箭”的概率。 */
			if (probHasBagua(player)) p = 1 - (1 - p) * 0.5;
			return _deckScarcityAdjusted(p, 'shan');
		}

		if (cardId === 'nanman') {
			return _deckScarcityAdjusted(_probHasShaFromPublicState(player), 'sha');
		}

		return 0.5;
	} catch (e) {
		return 0.5;
	}
}

function _impactWeight(player) {
	try {
		const hp = Number(player && player.hp);
		if (hp <= 1) return 1.6;
		if (hp <= 2) return 1.25;
	} catch (e) {}
	return 1.0;
}

/* ★ 计算 AOE 期望收益。
 * enemyHit / allyHit 是预计无法响应的人数期望；
 * netImpact 额外考虑公开血线，但不包含任何“残局就该进攻”的阶段加成。 */
export function aoeValue(me, cardId) {
	try {
		let enemyHit = 0, allyHit = 0;
		let enemyImpact = 0, allyImpact = 0;
		let enemyCount = 0, allyCount = 0;

		for (const p of (game.players || [])) {
			if (!p || p.alive === false || p === me) continue;

			const enemy = isEnemyOf(me, p);
			const ally = isAllyOf(me, p);
			if (!enemy && !ally) continue;

			const responseProb = aoeResponseProbability(p, cardId);
			const hitProb = _clamp01(1 - responseProb);
			const impact = hitProb * _impactWeight(p);

			if (enemy) {
				enemyCount++;
				enemyHit += hitProb;
				enemyImpact += impact;
			} else if (ally) {
				allyCount++;
				allyHit += hitProb;
				allyImpact += impact;
			}
		}

		const netDamage = enemyHit - allyHit;
		const netImpact = enemyImpact - allyImpact;
		return {
			enemyHit: enemyHit,
			allyHit: allyHit,
			enemyImpact: enemyImpact,
			allyImpact: allyImpact,
			enemyCount: enemyCount,
			allyCount: allyCount,
			netDamage: netDamage,
			netImpact: netImpact,
			worth: netImpact > 0,
		};
	} catch (e) {
		return {
			enemyHit: 0, allyHit: 0,
			enemyImpact: 0, allyImpact: 0,
			enemyCount: 0, allyCount: 0,
			netDamage: 0, netImpact: 0, worth: false,
		};
	}
}

/* ★ AOE 时机建议：只看该 AOE 自身的期望交换，不重复消费 game phase。 */
export function aoeTiming(me, cardId) {
	try {
		const value = aoeValue(me, cardId);

		if (value.netImpact >= 0.6) {
			return { use: true, reason: 'AOE期望净收益 ' + value.netImpact.toFixed(2), value: value };
		}

		if (value.netImpact > 0 && value.enemyHit >= value.allyHit + 0.5) {
			return { use: true, reason: '敌方预计受击明显更多', value: value };
		}

		return { use: false, reason: 'AOE期望交换不足', value: value };
	} catch (e) {
		return { use: false, reason: 'AOE评估失败', value: null };
	}
}

/* ★ AOE 评分倍率。阶段/残局本身不在这里重复加权。 */
export function aoeBonus(me, act) {
	try {
		if (!act || (act.id !== 'nanman' && act.id !== 'wanjian')) return 1.0;
		return aoeTiming(me, act.id).use ? 1.5 : 0.5;
	} catch (e) {
		return 1.0;
	}
}
