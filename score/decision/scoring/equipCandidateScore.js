/* 职责：单装备候选的原基础估值；返回候选或 undefined，不写候选集合，不执行动作。 */
/* 职责：生成技能、卡牌、装备、结束回合候选，保留原有基础评分。
 * 通用评分修正归 scoring/candidateScoring.js；不执行动作或学习。
 * valuation 连接引擎现有收益与动量计算，不复制状态。 */
import { game, get, _status } from '../../foundation/adapt/host.js';
import { VAL_CARD } from '../../knowledge/tables/value-tables.js';
import { evaluateTiesuoActions, tiesuoUtilityToEngineRaw } from '../cards/tiesuoEvaluator.js';
import { evaluateActionTransitionPenalty } from '../state/turnStrategicState.js';
import { skillProfileOf, skillBranchesOf, checkBranch, skillStagesOf, skillInteractionOf, skillTagsOf } from '../skills/skills.js';
import { isAllyOf, dispositionOf, targetScore, probHasShan, threatOf, linkedChainValue } from '../threat/threat.js';
import { isPlayerLinked } from '../state/playerState.js';
import { miniPredict } from '../../model/net/mini-model.js';
import { miniFeatures } from '../skills/skills.js';
import { fireAttackExpectedHit } from '../../perception/observer/observer.js';
import { identityOfFor as _identityOfFor, confidenceOfFor as _confidenceOfFor, hardIdentityOf as _hardIdentityOf } from '../../perception/observer/identity.js';
import { cfg, safe } from '../../foundation/config/util.js';
import { getDecisionBonus } from '../feedback/decisionFeedback.js';
import { equipReplaceCost } from '../resource/economy.js';
import { styleOf } from '../../perception/observer/observer.js';
import { isSameCamp, isEnemy } from '../strategy/modeStrategy.js';
import { probHasWuxie, probHasTao, probHasCard } from '../../model/predict/handInference.js';
import { wuxieBonus } from '../timing/wuxieTiming.js';
import { wuguBonus } from '../timing/wuguTiming.js';
import { equipScarcity, isKeyEquip } from '../cardplay/equipScarcity.js';
import { situationStrategyBonus } from '../../cognition/situationEval.js';
import { analyzeOpponentMood, moodStrategyBonus } from '../../cognition/moodState.js';
import { counterRelationBonus } from '../../knowledge/counters/mutualRelations.js';
import { getCardPriority } from '../tuning/orderOptimizer.js';
import { damageTransferBonus } from '../safety/damageTransfer.js';
import { treeSearchBonus } from '../strategy/treeSearch.js';
import { deckTopBonus } from '../../model/predict/deckTopPredict.js';
import { aliveCount, gameTheoryBonus } from '../../cognition/reasoning/gameTheory.js';
import { responseBonus } from '../cardplay/responseOpt.js';
import { discardBonus } from '../cardplay/discardOpt.js';
import { endgameBonus, isEndgame } from '../tuning/endgameOpt.js';
import { opponentPredictBonus } from '../../model/predict/opponentPredict.js';
import { resourceTimingBonus } from '../resource/resourceTiming.js';
import { aoeBonus } from '../timing/aoeTiming.js';
import { judgeBonus } from '../timing/judgeTiming.js';
import { equipReplaceBonus } from '../cardplay/equipReplace.js';
import { keepBonus } from '../cardplay/keepStrategyOpt.js';
import { multiTurnBonus } from '../strategy/multiTurnOpt.js';
import { duelBonus } from '../timing/duelTiming.js';
import { jiedaoBonus } from '../timing/jiedaoTiming.js';
import { shandianBonus } from '../timing/shandianTiming.js';
import { taoyuanBonus } from '../timing/taoyuanTiming.js';
import { shaTargetBonus } from '../tuning/shaTargetOpt.js';
import { taoBonus } from '../timing/taoTiming.js';
import { jiuBonus } from '../timing/jiuTiming.js';
import { shunshouBonus } from '../timing/shunshouTiming.js';
import { deepValueBonus } from '../utility/deepValue.js';
import { makeActionCandidate, runtimeScore, applyRelativeUtilityDelta, targetKey } from '../state/actionCandidate.js';
import { predict } from '../../model/weights/weights.js';
import { psychologyBonus } from '../../cognition/reasoning/psychology.js';
import { comboChainBonus } from '../strategy/comboChain.js';
import { playerMemoryBonus } from '../../perception/memory/playerMemory.js';
import { getAutoFeatureWeight } from '../../model/features/autoFeature.js';
import { getMetric } from '../../cognition/reasoning/softMetrics.js';
import { _buildCardDecisionContext, _resolveCardCandidateTarget } from '../rules/basicRules.js';

import { turnMomentum } from './scoreEvents.js';
import { opportunityCost, expectedValue, marginalValue, readCardOverride, _calcAllyDamagePenalty } from './candidateValuation.js';

export function buildEquipCandidate(context, c) {
const { me, team, seat, econ, sit, risk, riskTaking, teamwork, ROLE_PREFS, atkMul, keepMul, stageLabel, ATK_CARDS, DEF_CARDS, hand, combos, teamCombos, focus, SEAT_TARGET_CARDS, incoming, burst, mt, tsMap, bestT, bestTs, acts, trendMul, _isEnemyMemo, _isAllyMemo } = context;

				try {
					const t = get.subtype ? get.subtype(c) : null;
					if (!t) return;
					const eq = me.getCards("e", function (ec) { try { return get.subtype(ec) === t; } catch (e) { return false; } });
					const oldCard = eq[0] || null;
					const eqCost = equipReplaceCost(me, c, oldCard);
					if (eqCost.net > 0) {
						return {
							type: "equip",
							id: c.name || "",
							score: runtimeScore(eqCost.net * 2 * sit.tempo * risk.safe),
							reason: "装备" + (c.name || "") + "（价值" + eqCost.newValue + ">" + eqCost.oldValue + "，拆风险" + Math.round(eqCost.stripPressure * 100) + "%）",
						};
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
