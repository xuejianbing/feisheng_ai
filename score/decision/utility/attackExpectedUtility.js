import { applyOwnedUtility } from './utilityPipeline.js?v=41a';
import { ensureUtilityVector, recordUtilityContribution } from './utilityVector.js?v=41a';

const probability = (value, fallback = 0.5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const count = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/* 决斗：对方先响应，拥有K张杀时，我方至少K张即可获胜。
 * pAny是至少一张杀的推断；独立同分布近似转换为每张牌概率，再计算二项分布。
 * 只接收公开手牌数、我方杀数及概率，不接收对方手牌内容。 */
export function duelResponseDistribution(handCount, ownSha, pAny) {
	const n = count(handCount), mine = count(ownSha), any = probability(pAny);
	if (!n) return { winProbability: 1, expectedOwnResponses: 0, perCardProbability: 0 };
	const q = any === 1 ? 1 : 1 - Math.pow(1 - any, 1 / n);
	if (q === 1) return { winProbability: mine >= n ? 1 : 0, expectedOwnResponses: Math.min(mine, n), perCardProbability: 1 };
	// 单手牌数异常偏大时采用保守均值近似，避免不受限循环。
	if (n > 100) return { winProbability: mine >= n * q ? 0.75 : 0.25, expectedOwnResponses: Math.min(mine, n * q), perCardProbability: q };
	let mass = Math.pow(1 - q, n), win = 0, spent = 0;
	for (let k = 0; k <= n; k++) {
		if (k <= mine) win += mass;
		spent += Math.min(k, mine) * mass;
		if (k < n) mass *= (n - k) / (k + 1) * q / (1 - q);
	}
	return { winProbability: probability(win), expectedOwnResponses: spent, perCardProbability: q };
}

export function evaluateAttackExpectedValue(id, context) {
	const c = context || {};
	let hit, damage = 1, ownResponseCost = 0, distribution = null;
	if (id === 'sha') {
		hit = (1 - probability(c.shanProbability)) * (c.hasBagua ? 1 - probability(c.baguaSuccess) : 1);
		// 已生效的酒加伤属于当前动作；手里尚未使用的酒留给Planner评估。
		if (Number.isFinite(c.drunkDamage) && c.drunkDamage > 0) damage += c.drunkDamage;
	} else if (id === 'juedou') {
		distribution = duelResponseDistribution(c.targetHandCount, c.ownSha, c.shaProbability);
		hit = distribution.winProbability;
		ownResponseCost = distribution.expectedOwnResponses * 0.3;
	} else return null;
	const kill = Number.isFinite(c.targetHp) && c.targetHp <= damage ? 6 : 0;
	const lowHp = id === 'sha' && Number.isFinite(c.targetHp) && c.targetHp <= 2 ? 1 : 0;
	const lethal=c.lethal?.schema==='versus-lethal-v1'?c.lethal:null;
	if(lethal){hit=probability(lethal.hitProbability);damage=Math.max(0,Number(lethal.damage)||0);}
	const killProbability=lethal?probability(lethal.killProbability,0):hit*(kill>0?1:0);
	const offense = lethal ? hit*(2*damage+(lethal.hpDamage>0?lowHp:0))+6*killProbability : hit * (2 * damage + kill + lowHp);
	const resolution=lethal?probability(lethal.resolutionProbability,1):1;
	const duelFailure=lethal?probability(lethal.duelFailureProbability,1-hit):1-hit;
	// 反击只在成功伤害后发生，概率计一次；决斗失败自伤按1点血量价值计算。
	const risk = -(c.vengeance ? 3 * hit : 0) - (id === 'juedou' ? 2 * duelFailure : 0);
	const resourceCost = -ownResponseCost*resolution;
	const score = Math.round((offense + risk + resourceCost) * 100) / 100;
	return { score, offense, risk, resourceCost, hitProbability: hit, damage,
		...(lethal?{killProbability,dyingProbability:lethal.dyingProbability,rescueProbability:lethal.rescueProbability,lethalCertain:false}:{}),
		responseProbability: id === 'sha' ? probability(c.shanProbability) : probability(c.shaProbability),
		expectedOwnResponses: (distribution?.expectedOwnResponses || 0)*resolution };
}

export function createAttackUtilitySeed(evaluation, scale) {
	const seed = { score: 0 };
	const total = evaluation.score * scale;
	const offense = evaluation.offense * scale, risk = evaluation.risk * scale, cost = evaluation.resourceCost * scale;
	applyOwnedUtility(seed, 'attackExpectedValue', [
		{ dimension: 'offense', delta: offense, note: '命中、伤害与击杀期望', details: { hitProbability: evaluation.hitProbability, responseProbability: evaluation.responseProbability, damage: evaluation.damage, scale,
			killProbability:evaluation.killProbability,dyingProbability:evaluation.dyingProbability,rescueProbability:evaluation.rescueProbability,lethalCertain:evaluation.lethalCertain } },
		{ dimension: 'risk', delta: risk, note: '成功伤害反击/决斗失败自伤' },
		{ dimension: 'resourceCost', delta: cost, note: '决斗响应消耗我方杀', details: { expectedOwnResponses: evaluation.expectedOwnResponses } },
		{ dimension: 'legacyResidual', delta: total - offense - risk - cost, note: 'EV舍入差额' },
	]);
	seed.score = total;
	return seed;
}

/* 未迁移的中间加成明记为legacyResidual；不能把它们伪装成攻击EV已迁移。 */
export function adoptAttackUtilitySeed(candidate, seed, options = {}) {
	if (!seed) return candidate;
	Object.defineProperty(candidate, 'utilityVector', { value: ensureUtilityVector(seed), writable: true, configurable: true, enumerable: false });
	recordUtilityContribution(candidate, { source: options.roundingOnly ? 'candidateRounding' : 'legacyCandidateGeneration', dimension: 'legacyResidual', before: seed.score, after: candidate.score, note: options.roundingOnly ? '候选运行分舍入差额' : '其它未迁移候选修正及运行分数舍入' });
	return candidate;
}
