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
import { game, get } from '../../foundation/adapt/host.js?v=41a';
import { isAllyOf, isEnemyOf } from '../relations/relations.js?v=41a';
import { probHasBagua } from '../threat/threat.js?v=41a';
import { baguaSuccessRate } from '../../model/predict/deckPredict.js?v=41a';
import { probHasSha, probHasShan } from '../../model/predict/handInference.js?v=41a';

function _clamp01(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

function _isAlive(player) {
 try { return player.alive !== false && (typeof player.isAlive !== 'function' || player.isAlive()); } catch (_) { return false; }
}

/* 仅已公开的常见免疫；不枚举暗置技能。藤甲遵循宿主unequip/unequip2条件。 */
export function aoePublicImmune(me, player, cardId) {
 try {
  const card = { name: cardId };
  const activeSkills = player.getSkills ? player.getSkills() : (player.skills || []);
  if (cardId === 'nanman' && ['huoshou','juxiang','huoshou1','juxiang1'].some(s => activeSkills.includes(s))) return true;
  if (player.hasSkillTag && player.hasSkillTag('unequip2')) return false;
  if (me && me.hasSkillTag && me.hasSkillTag('unequip', false, { name: cardId, target: player, card })) return false;
  return (player.getCards ? player.getCards('e') : []).some(c => (get.name ? get.name(c) : c.name) === 'tengjia');
 } catch (_) { return false; }
}

/* 南蛮所需“杀”没有单独的隐藏牌读取器：只由公开手牌数估计基础概率。 */
export function aoeResponseProbability(player, cardId) {
	try {
		if (!player) return 0.5;

		if (cardId === 'wanjian') {
			let p = probHasShan(player);
			/* 手牌持有概率与公开装备响应能力分层：八卦只在 response capability 层叠加。 */
			if (probHasBagua(player)) p = 1 - (1 - _clamp01(p)) * (1 - _clamp01(baguaSuccessRate()));
			return _clamp01(p);
		}

		if (cardId === 'nanman') {
			return _clamp01(probHasSha(player));
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
		let enemyCount = 0, allyCount = 0, unknownCount = 0;

		for (const p of (game.players || [])) {
			if (!p || !_isAlive(p) || p === me) continue;
			if (me && typeof me.canUse === 'function' && me.canUse({ name: cardId }, p, false) === false) continue;
			if (aoePublicImmune(me, p, cardId)) continue;

			const enemy = isEnemyOf(me, p);
			const ally = isAllyOf(me, p);
			if (!enemy && !ally) { unknownCount++; continue; }

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
			unknownCount: unknownCount,
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
