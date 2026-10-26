import { applyOwnedUtility } from './utilityPipeline.js?v=41a';

/* 一点预计伤害沿用攻击EV的2分量纲；不再把全场AOE当作固定正价值。 */
export function createAreaUtilitySeed(value, scale) {
 if (!value || !Number.isFinite(value.enemyImpact) || !Number.isFinite(value.allyImpact) || !Number.isFinite(scale) || scale < 0) return null;
 const seed = { score: 0 };
 applyOwnedUtility(seed, 'areaExpectedValue', [
  { dimension: 'offense', delta: 2 * value.enemyImpact * scale, note: 'AOE预计敌方伤害收益', details: { enemyHit: value.enemyHit, enemyCount: value.enemyCount, scale } },
  { dimension: 'risk', delta: -2 * value.allyImpact * scale, note: 'AOE预计友方伤害及濒死救援风险', details: { allyHit: value.allyHit, allyCount: value.allyCount, unknownCount: value.unknownCount || 0,
   casualtyRisk:value.teamRisk?.casualtyRisk||0,rescueCost:value.teamRisk?.rescueCost||0,orderStatus:value.teamRisk?.orderStatus||'public-baseline' } },
 ]);
 return seed;
}

export function applyDeepValueEvidence(candidate, evidence) {
 if (!candidate || candidate.type !== 'card' || !evidence) return false;
 return applyOwnedUtility(candidate, 'deepValueEvidence', [{ dimension: 'uncertainty', delta: 0,
  note: '重复的卡牌/目标/局势估计，仅对账，不叠加完整价值', details: { ...evidence, scoring: false } }]);
}
