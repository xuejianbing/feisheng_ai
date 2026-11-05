/* 职责：单技能候选的原基础估值；返回候选或 undefined，不写候选集合，不执行动作。 */
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

export function buildSkillCandidate(context, sid) {
const { me, team, seat, econ, sit, risk, riskTaking, teamwork, ROLE_PREFS, atkMul, keepMul, stageLabel, ATK_CARDS, DEF_CARDS, hand, combos, teamCombos, focus, SEAT_TARGET_CARDS, incoming, burst, mt, tsMap, bestT, bestTs, acts, trendMul, _isEnemyMemo, _isAllyMemo } = context;

			try {
				const prof = skillProfileOf(sid);
				if (!prof) return;

				const multi = prof.profit && prof.profit.multi;

				/* 用 multi.final 作为基础分 */
				let base = multi ? multi.final : (prof.profit.base || 0);
				if (base > 15) base = 15;
				if (base < -15) base = -15;
				if (base <= 0) return;

				/* 去掉双倍放大 —— multi.final 已是综合分 */
				let s = base * sit.tempo * (risk.atk || 1) * (atkMul || 1);

				/* 时机条件加成 */
				if (prof.timing.condition === '低血' && econ.hpRatio < 0.4) s *= 1.4;
				if (prof.timing.condition === '已受伤' && econ.hpDeficit > 0) s *= 1.2;

				/* 风险维度缩放 */
				const riskKey = multi ? multi.dims.risk : (
					prof.profit.risk >= 0.5 ? 'judge' : (prof.profit.risk >= 0.3 ? 'judge' : 'none')
				);
				if (riskKey === 'judge' || riskKey === 'compare') {
					s *= (stageLabel === 'endgame' ? 0.7 : 0.9) * (0.5 + 0.5 * (riskTaking || 1));
				}

				/* 团队维度缩放 */
				if (multi) {
					const teamTag = (prof.tags.teamGain || 0)
						+ (prof.tags.teamAid || 0)
						+ (prof.tags.teamChain || 0);
					const hurtTag = Math.abs(prof.tags.teamHurt || 0)
						+ Math.abs(prof.tags.teamRisk || 0);
					const teamShift = ((teamwork || 1) - 1) * 0.6;
					s += (teamTag - hurtTag) * teamShift;
				}

				/* 时机适配 */
				const timKey = multi ? multi.dims.timing : prof.timing.phase;
				if (timKey === 'dying') {
					let hasDying = false;
					for (const p of (game.players || [])) {
						if (p && p !== me && (p.hp || 0) <= 0) { hasDying = true; break; }
					}
					if (!hasDying) s *= 0.3;
				}
				if (timKey === 'damaged' && econ.hpRatio > 0.7) s *= 0.6;
				if (timKey === 'phaseUse' && sit.mode === 'defense') s *= 0.85;

				/* 范围调整：AOE 残局加成 */
				if (multi && (multi.dims.range === 'many' || multi.dims.range === 'all')) {
					const alive = (game.players || []).filter(function (p) {
						return p && p.alive !== false;
					}).length;
					if (alive <= 4) s *= 1.15;
				}

				/* 目标匹配 */
				if (prof.targets.category === 'enemy' && focus) s *= 1.15;
				if (prof.targets.category === 'ally' && team.protect) {
					s *= (0.9 + 0.3 * (teamwork || 1));
				}

				/* 趋势 */
				s *= trendMul.skill;

				/* 条件分支 */
				try {
					const br = skillBranchesOf(sid);
					if (br && br.branches.length) {
						const tgt = bestT || null;
						br.branches.forEach(function (b) {
							if (checkBranch(b.trigger, me, tgt)) s += b.bonus * 1.5;
						});
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

				/* 净效果过滤 */
				try {
					const st = skillStagesOf(sid);
					if (st && st.cost.net < -2 && st.effect.net <= 0) s *= 0.6;
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

				/* 条件-收益联动 */
				try {
					const ia = skillInteractionOf(sid);
					if (ia && ia.interactions.length) {
						let maxRatio = 1.0;
						ia.interactions.forEach(function (it) {
							if (it.ratio > maxRatio) maxRatio = it.ratio;
						});
						s *= (1.0 + (maxRatio - 1.0) * 0.3);
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

				/* 协作分工 */
				if (ROLE_PREFS && ROLE_PREFS.skill) {
					try {
						const tags = skillTagsOf(sid);
						if (tags) {
							const cat = tags.atk * ROLE_PREFS.skill.atk +
								tags.def * ROLE_PREFS.skill.def +
								tags.aux * ROLE_PREFS.skill.aux +
								tags.ctrl * ROLE_PREFS.skill.ctrl +
								tags.draw * ROLE_PREFS.skill.draw;
							const avg = ROLE_PREFS.skill.atk + ROLE_PREFS.skill.def
								+ ROLE_PREFS.skill.aux + ROLE_PREFS.skill.ctrl
								+ ROLE_PREFS.skill.draw;
							const ratio = (cat / Math.max(0.1, avg)) * 5;
							s *= Math.max(0.5, Math.min(1.8, ratio));
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}

				/* 连招 */
				combos.forEach(function (c) {
					if (c.setup === sid) s += c.bonus * 0.5;
				});

				/* ★ skillTiming 技能触发时机分析加成（软指标化） */
				try {
					const st = window.__DJSC && window.__DJSC.skillTiming;
					if (st) {
						const analysis = st.predictSkillBehavior(sid, me);
						if (analysis) {
							/* 自动发动技能小加成 */
							if (analysis.isAuto) s *= getMetric('skill_auto_bonus');
							/* 锁定技小加成 */
							if (analysis.isForced) s *= getMetric('skill_forced_bonus');
							/* 有利技能加成 */
							if (analysis.predict === 'benefit') s *= getMetric('skill_benefit_bonus');
							/* 有害技能减分 */
							if (analysis.predict === 'cost') s *= getMetric('skill_cost_penalty');
							/* 有摸牌效果加成 */
							if (analysis.effects.indexOf('draw') >= 0) s *= getMetric('skill_draw_bonus');
							/* 有回血效果加成 */
							if (analysis.effects.indexOf('recover') >= 0) s *= getMetric('skill_recover_bonus');
							/* 有造成伤害效果加成 */
							if (analysis.effects.indexOf('damage') >= 0) s *= getMetric('skill_damage_bonus');
							/* 有弃牌效果减分 */
							if (analysis.effects.indexOf('discard') >= 0) s *= getMetric('skill_discard_penalty');
							/* 有失去体力效果减分 */
							if (analysis.effects.indexOf('loseHp') >= 0) s *= getMetric('skill_losehp_penalty');
							/* 有翻面效果减分 */
							if (analysis.effects.indexOf('turnOver') >= 0) s *= getMetric('skill_turnover_penalty');
							/* 有移除技能效果减分 */
							if (analysis.effects.indexOf('removeSkill') >= 0) s *= getMetric('skill_removeskill_penalty');
							/* 有添加技能效果加成 */
							if (analysis.effects.indexOf('addSkill') >= 0) s *= getMetric('skill_addskill_bonus');
							/* 有获得牌效果加成 */
							if (analysis.effects.indexOf('gainCard') >= 0) s *= getMetric('skill_gaincard_bonus');
							/* 有拆判定效果加成 */
							if (analysis.effects.indexOf('discardJudge') >= 0) s *= getMetric('skill_discardjudge_bonus');
							/* 有控顶效果加成 */
							if (analysis.effects.indexOf('deckTop') >= 0) s *= getMetric('skill_decktop_bonus');
						}
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

				/* 新 reason */
				let reason = '技能' + sid + '（多维 ' + (Math.round(base * 100) / 100);
				if (multi) {
					reason += '，对象 ' + multi.dims.object
						+ ' 时机 ' + multi.dims.timing
						+ ' 频率 ' + multi.dims.frequency;
					const tg = (prof.tags.teamGain || 0) + (prof.tags.teamAid || 0);
					if (tg > 0) reason += '，团队+' + (Math.round(tg * 10) / 10);
				}
				reason += '）';

				return {
					type: 'skill', id: sid,
					score: runtimeScore(s),
					reason: reason,
					multi: multi,
				};
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
