import { keepBonus } from '../cardplay/keepStrategyOpt.js?v=41a';
import { applyOwnedUtility } from './utilityPipeline.js?v=41a';

const OWNER = 'cardConsumption';
const BASE_COST = Object.freeze({ shan: 1.5, tao: 1.5, wuxie: 1.5, jiu: 0.8, sha: 0.3,
	guohe: 0.4, shunshou: 0.4, wuzhong: 0.2, tiesuo: 0.2, lebu: 0.3, bingliang: 0.3,
	nanman: 0.4, wanjian: 0.4, juedou: 0.4, huogong: 0.4 });

/* 兼容原基础机会成本表与手牌/低血修正，不与保留估计相加。 */
export function baseCardOpportunityCost(id, econ) {
	let cost = Object.hasOwn(BASE_COST, id) ? BASE_COST[id] : 0.3;
	if (econ) {
		if (econ.handCount <= 2) cost *= 1.6;
		else if (econ.handCount <= 4) cost *= 1.2;
		if (econ.hpRatio < 0.3 && ['shan', 'tao', 'wuxie'].includes(id)) cost *= 1.3;
	}
	return Math.round(cost * 100) / 100;
}

/* 基础、保留及预测估计都表示消耗同一张牌、放弃其未来用途的代价。
 * 基础表是绝对值；保留倍率转换为|当前收益|上的成本，避免负分方向反转。
 * 在候选专项来源之后统一扣一次，通用建议读取独立基准，不缩放这笔成本。 */
export function evaluateCardConsumptionCost(me, candidate, context = {}) {
	if (!candidate || candidate.type !== 'card' || candidate.id === 'tiesuo') return null;
	const score = candidate.score;
	if (typeof score !== 'number' || !Number.isFinite(score)) throw new TypeError('Invalid card utility');
	const parsedWeight = typeof context.weight === 'number' || (typeof context.weight === 'string' && context.weight.trim()) ? Number(context.weight) : NaN;
	const weight = Number.isFinite(parsedWeight) ? Math.max(0, parsedWeight) : 0.5;
	const baseCost = baseCardOpportunityCost(candidate.id, context.econ) * weight;
	const rawMultiplier = keepBonus(me, { id: candidate.id, card: context.card || { name: candidate.id }, stage: context.stage });
	const keepMultiplier = Number.isFinite(rawMultiplier) ? Math.max(0, Math.min(1, rawMultiplier)) : 1;
	const retentionCost = Math.abs(score) * (1 - keepMultiplier);
	const forecastCost = Number.isFinite(context.forecastRetention) ? Math.max(0, context.forecastRetention) : 0;
	const cost = Math.max(baseCost, retentionCost, forecastCost);
	if (!Number.isFinite(cost)) throw new TypeError('Invalid card consumption cost');
	return { baseCost, retentionCost, forecastCost, keepMultiplier, cost, weight,
		selectedEstimate: forecastCost > Math.max(baseCost, retentionCost) ? 'forecast' : retentionCost > baseCost ? 'retention' : baseCost > retentionCost ? 'base' : 'equal' };
}

export function applyCardConsumptionUtility(me, candidate, context) {
	if (candidate?.utilityVector?.ownedSources?.includes(OWNER)) return { applied: false };
	const estimate = evaluateCardConsumptionCost(me, candidate, context);
	if (!estimate) return null;
	const display = value => (Math.round(value * 10000) / 10000).toString();
	const applied = applyOwnedUtility(candidate, OWNER, [{ dimension: 'opportunityCost', delta: -estimate.cost,
		details: { ...estimate, aggregation: 'max' },
		note: '基础估计=' + display(estimate.baseCost) + '；保留估计=' + display(estimate.retentionCost) + '；预测估计=' + display(estimate.forecastCost) + '；取较大值一次扣除' }]);
	return { ...estimate, applied };
}
