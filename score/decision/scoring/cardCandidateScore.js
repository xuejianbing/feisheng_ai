/* 职责：单卡牌候选的原基础估值；返回候选或 undefined，不写候选集合，不执行动作。 */
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

export function buildCardCandidate(context, id, cardDecisionCtx) {
const { me, team, seat, econ, sit, risk, riskTaking, teamwork, ROLE_PREFS, atkMul, keepMul, stageLabel, ATK_CARDS, DEF_CARDS, hand, combos, teamCombos, focus, SEAT_TARGET_CARDS, incoming, burst, mt, tsMap, bestT, bestTs, acts, trendMul, _isEnemyMemo, _isAllyMemo } = context;

			try {
				const v = VAL_CARD[id];
				if (!v || !v.use || v.use < 0) return;
				const boundTarget = _resolveCardCandidateTarget(me, id, cardDecisionCtx, bestT || null);
				const cardTarget = boundTarget.target;
				let cardTargetStyle = null;
				try { if (cardTarget) cardTargetStyle = styleOf(cardTarget); } catch (eS) { cardTargetStyle = null; }

				/* C 阶段 clamp：卡牌使用价值规范上限 +4 */
				let cardUse = v.use;
				if (cardUse > 4) cardUse = 4;

				const ev = expectedValue(me, id, cardTarget);
				const mv = marginalValue(id, hand);
				let s = ev * (0.5 + 0.5 * mv / (cardUse || 1)) * 2 * sit.tempo;

				/* ★ 记忆驱动：根据 cardTarget 的风格调整卡牌价值 */
				try {
					if (cardTarget && cardTargetStyle) {
						const sStyle = cardTargetStyle;
						if (sStyle.tag === "aggressive") {
							/* 面对激进敌人：防御牌价值提高 */
							if (['shan', 'tao', 'jiu', 'wuxie', 'exjiu'].indexOf(id) >= 0) {
								s *= 1.2;
							}
						} else if (sStyle.tag === "vengeful") {
							/* 面对复仇心重敌人：攻击牌价值降低（避免招惹） */
							if (['sha', 'juedou', 'huogong', 'guohe', 'shunshou'].indexOf(id) >= 0) {
								s *= 0.85;
							}
						} else if (sStyle.tag === "cautious") {
							/* 面对保守敌人：攻击牌价值提高（压迫他） */
							if (['sha', 'juedou', 'huogong'].indexOf(id) >= 0) {
								s *= 1.1;
							}
						}
					}
				} catch (eStyle) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eStyle); }

				/* ★ 融合 optimization.js 的覆写信号 */
				try {
					const ov = readCardOverride(id, me, cardTarget);
					if (ov) {
						/* 覆写分作为加权基准
						 *   ov.score > 0：opt 认为该牌此目标可出 → 加成
						 *   ov.score < 0：opt 认为该牌此目标不该出 → 惩罚
						 * 权重 ov.weight（默认 1.2）
						 */
						const w = ov.weight || 1.2;
						/* 覆写分直接加到 s 上（不替换，保留 EV 的稳定基线） */
						s += ov.score * w * sit.tempo * 2;
					}
				} catch (eOv) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eOv); }

				/* ★ 博弈策略层加成 */
				try {
					const psyBonus = psychologyBonus(
						me,
						{ type: 'card', id: id, target: cardTarget ? (cardTarget.name1 || cardTarget.name) : null },
						cardTarget
					);
					if (psyBonus !== 1.0) s *= psyBonus;
				} catch (ePsy) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePsy); }

				/* ★ 连招链加成 */
				try {
					const chainBonus = comboChainBonus(
						me,
						{ type: 'card', id: id, target: cardTarget ? (cardTarget.name1 || cardTarget.name) : null },
						cardTarget
					);
					if (chainBonus !== 1.0) s *= chainBonus;
				} catch (eChain) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eChain); }

				/* ★ 对手长期记忆加成 */
				try {
					const memBonus = playerMemoryBonus(
						me,
						cardTarget,
						{ type: 'card', id: id, target: cardTarget ? (cardTarget.name1 || cardTarget.name) : null }
					);
					if (memBonus !== 1.0) s *= memBonus;
				} catch (eMem) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eMem); }

				/* ★ AI工具集成（软指标：权重由模型自己学） */
				try {
					const aiT = window.__DJSC && window.__DJSC.aiTools;
					if (aiT && cardTarget) {
						let aiBonus = 1.0;

						/* ① 嘲讽度：嘲讽高的目标优先打（软指标权重） */
						const threaten = aiT.threaten(cardTarget) || 0;
						if (threaten > 1.5) {
							const w = getMetric('threaten_bonus', 1.15);
							aiBonus *= w;
						}

						/* ② 卖血将：别随便打（软指标权重） */
						if (aiT.isMaixie(cardTarget)) {
							const w = getMetric('maixie_penalty', 0.75);
							aiBonus *= w;
						}

						/* ③ 亡语技能：别随便杀（软指标权重） */
						if (aiT.hasDeathSkill(cardTarget)) {
							const w = getMetric('deathskill_penalty', 0.85);
							aiBonus *= w;
						}

						/* ④ 无视防具：打他更有效（软指标权重） */
						if (aiT.hasUnequip(cardTarget)) {
							const w = getMetric('unequip_bonus', 1.1);
							aiBonus *= w;
						}

						/* ⑤ 主公身份：开局就明置，直接用 game.zhu 判断（不需要推理） */
						/* 注意：主公身份开局就明置，所有人都知道，不需要通过技能推理 */

						if (aiBonus !== 1.0) s *= aiBonus;
					}
				} catch (eAiT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAiT); }

				/* ★ 自动发现维度加成（软接管：让模型自己学） */
				try {
					const afContext = {
						cardType: id,
						targetIsAlly: cardTarget && isSameCamp(me, cardTarget),
						targetIsEnemy: cardTarget && isEnemy(me, cardTarget),
						myLowHp: (me.hp || 0) <= 2,
						myFewHand: me.countCards ? me.countCards('h') <= 2 : false,
						tgtLowHp: cardTarget && (cardTarget.hp || 0) <= 1,
						tgtManyHand: cardTarget && (cardTarget.countCards ? cardTarget.countCards('h') >= 5 : false),
						isEndgame: (game.players || []).filter(function (p) { return p && p.alive !== false; }).length <= 3,
						isEarly: (game.players || []).filter(function (p) { return p && p.alive !== false; }).length >= 7,
					};
					const afWeight = getAutoFeatureWeight(afContext);
					if (afWeight !== 0) s *= (1 + afWeight * 0.1);
				} catch (eAF) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAF); }

				/* ★ 五期：火攻期望命中率修正 */
				try {
					if (id === 'huogong' && cardTarget) {
						var hitRate = fireAttackExpectedHit(me, cardTarget);
						/* 命中率 0~1，直接作为乘数，低于 0.3 直接劝退 */
						if (hitRate < 0.3) s *= 0.5;
						else s *= (0.7 + hitRate * 0.6);
					}
				} catch (eFire) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFire); }

				/* ★ 友方伤害线性衰减 */
				try {
					const DMG = ['sha', 'juedou', 'huogong', 'nanman', 'wanjian', 'zhujin'];
					if (cardTarget && DMG.indexOf(id) >= 0) {
						if (isSameCamp(me, cardTarget)) {
							s += _calcAllyDamagePenalty(me, cardTarget, id);
						}
					}
				} catch (eHard) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eHard); }

				/* ===== ★ 24 模块集成：卡牌评分加成 ===== */
				try {
					/* ① 手牌推断：根据对手手牌概率调整卡牌价值 */
					if (cardTarget) {
						if (id === 'sha' || id === 'juedou') {
							const shanProb = probHasShan(cardTarget);
							if (shanProb > 0.6) s *= 0.7;      // 对手大概率有闪 → 杀价值降低
							else if (shanProb < 0.3) s *= 1.2; // 对手大概率没闪 → 杀价值提高
						}
						if (id === 'wuxie') {
							const wuxieProb = probHasWuxie(cardTarget);
							if (wuxieProb > 0.5) s *= 1.15;   // 对手大概率有无懈 → 我也要有无懈
						}
						if (id === 'tao') {
							const taoProb = probHasTao(cardTarget);
							if (taoProb > 0.4) s *= 0.9;      // 对手大概率有桃 → 击杀难度高
						}
					}

					/* ② 装备稀缺度：关键装备价值提高 */
					if (isKeyEquip(id)) {
						const scarcity = equipScarcity(id);
						if (scarcity <= 2) s *= 1.3;       // 仅剩 2 张以下 → 价值飙升
					}

					/* ③ 对手情绪：根据情绪状态调整卡牌价值 */
					if (cardTarget) {
						const mood = analyzeOpponentMood(cardTarget);
						if (mood) {
							const moodDelta = moodStrategyBonus(me, cardTarget, { id: id });
							s = applyRelativeUtilityDelta(s, moodDelta);
						}
					}

					/* ④ 武将克制：根据克制关系调整 */
					if (cardTarget) {
						const relationDelta = counterRelationBonus(me, cardTarget, { id: id });
						s = applyRelativeUtilityDelta(s, relationDelta);
					}

					/* ⑤ 出牌顺序：根据优先级调整 */
					const priority = getCardPriority(id);
					if (priority > 3) s *= 1.1;           // 高优先级卡牌价值提高

					/* ⑥ 铁索连环：考虑伤害转移 */
					if (id === 'tiesuo' || id === 'sha' || id === 'juedou') {
						const transferDelta = damageTransferBonus(me, cardTarget, { id: id });
						s = applyRelativeUtilityDelta(s, transferDelta);
					}

					/* ⑦ 概率树搜索：考虑后续影响 */
					if (cardTarget && (id === 'sha' || id === 'juedou')) {
						const treeDelta = treeSearchBonus(me, cardTarget, { id: id });
						s = applyRelativeUtilityDelta(s, treeDelta);
					}

					/* ⑧ 牌堆顶预测：考虑牌堆顶的牌 */
					const deckDelta = deckTopBonus(me, { id: id });
					s = applyRelativeUtilityDelta(s, deckDelta);

					/* ⑨ 博弈论：根据游戏阶段调整 */
					const gameDelta = gameTheoryBonus(me, { id: id });
					s = applyRelativeUtilityDelta(s, gameDelta);

					/* ⑩ 局面策略：根据局面估值调整 */
					const situationDelta = situationStrategyBonus(me, { id: id });
					s = applyRelativeUtilityDelta(s, situationDelta);
				} catch (e24) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e24); }

					/* ===== ★ v1.7.0 新增 5 个优化模块 ===== */
					try {
						/* ⑪ 响应阶段优化：出闪/出无懈/出桃 */
						const respBonus = responseBonus(me, { id: id, source: cardTarget, target: cardTarget });
						if (respBonus !== 1.0) s *= respBonus;

						/* ⑫ 弃牌阶段优化 */
						const discardB = discardBonus(me, { card: { name: id } });
						if (discardB !== 1.0) s *= discardB;

						/* ⑬ 残局策略 */
						const endB = endgameBonus(me, { id: id });
						if (endB !== 1.0) s *= endB;

						/* ⑭ 对手预测 */
						if (cardTarget) {
							const oppB = opponentPredictBonus(me, cardTarget, { id: id });
							if (oppB !== 1.0) s *= oppB;
						}

						/* ⑮ 资源使用时机 */
						const resB = resourceTimingBonus(me, { id: id, target: cardTarget });
						if (resB !== 1.0) s *= resB;
					} catch (e17) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e17); }

					/* ===== ★ v1.8.0 新增 5 个优化模块 ===== */
					try {
						/* ⑯ AOE 时机优化 */
						const aoeB = aoeBonus(me, { id: id });
						if (aoeB !== 1.0) s *= aoeB;

						/* ⑰ 判定锦囊时机优化 */
						const judgeB = judgeBonus(me, { id: id, target: cardTarget });
						if (judgeB !== 1.0) s *= judgeB;

						/* ⑱ 装备更换优化 */
						const equipB = equipReplaceBonus(me, { id: id, card: { name: id } });
						if (equipB !== 1.0) s *= equipB;

						/* ⑲ 手牌保留策略：只施加“现在消耗这张牌”的机会成本，不制造正收益 */
						const keepB = keepBonus(me, { id: id, card: { name: id }, stage: stageLabel });
						if (keepB !== 1.0) s *= keepB;

						/* ⑳ 多轮规划 */
						const mtB = multiTurnBonus(me, { id: id });
						if (mtB !== 1.0) s *= mtB;
					} catch (e18) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e18); }

					/* ===== ★ v1.0.2 新增 5 个锦囊时机优化模块 ===== */
					try {
						/* ㉑ 决斗时机优化 */
						const duelB = duelBonus(me, { id: id, target: cardTarget });
						if (duelB !== 1.0) s *= duelB;

						/* ㉒ 借刀杀人时机优化 */
						const jiedaoB = jiedaoBonus(me, { id: id, target: cardTarget });
						if (jiedaoB !== 1.0) s *= jiedaoB;

						/* ㉓ 闪电时机优化 */
						const shandianB = shandianBonus(me, { id: id });
						if (shandianB !== 1.0) s *= shandianB;

						/* ㉔ 桃园结义时机优化 */
						const taoyuanB = taoyuanBonus(me, { id: id });
						if (taoyuanB !== 1.0) s *= taoyuanB;

						/* ㉕ 五谷丰登时机优化 */
						const wuguB = wuguBonus(me, { id: id });
						if (wuguB !== 1.0) s *= wuguB;
					} catch (e19) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e19); }

					/* ===== ★ v1.0.3 新增 5 个时机优化模块 ===== */
					try {
						/* ㉖ 杀目标选择优化 */
						if (cardTarget) {
							const shaB = shaTargetBonus(me, cardTarget);
							if (shaB !== 1.0) s *= shaB;
						}

						/* ㉗ 桃使用时机优化 */
						const taoB = taoBonus(me, { id: id });
						if (taoB !== 1.0) s *= taoB;

						/* ㉘ 酒使用时机优化 */
						const jiuB = jiuBonus(me, { id: id });
						if (jiuB !== 1.0) s *= jiuB;

						/* ㉙ 无懈可击时机优化 */
						const wuxieB = wuxieBonus(me, { id: id });
						if (wuxieB !== 1.0) s *= wuxieB;

						/* ㉚ 顺手牵羊时机优化 */
						const shunshouB = shunshouBonus(me, { id: id, target: cardTarget });
						if (shunshouB !== 1.0) s *= shunshouB;
					} catch (e20) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e20); }

					/* ===== ★ v1.0.4 深度价值量化模块 ===== */
					try {
						/* ㉛ 深度价值量化 */
						const deepB = deepValueBonus(me, { id: id, target: cardTarget });
						if (deepB !== 1.0) s *= deepB;
					} catch (e21) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e21); }

				/* ★ E 阶段：救援濒死队友 —— 桃博弈模型 */
				if (id === 'tao') {
					try {
						let dyingAlly = null, dyingEnemy = null;
						for (const p of (game.players || [])) {
							if (!p || p === me) continue;
							if (!p.isAlive ? (p.alive === false) : false) continue;
							if ((p.hp || 0) > 0) continue;
							/* ★ 敌我系统判"是否该救"：isAllyOf(含行为推断软翻转)识别真队友。
							 *   替换旧 isSameCamp——身份未明时保守视敌会漏救真队友 */
							let isFriend = false;
							try { isFriend = _isAllyMemo(p); } catch (eCamp) { isFriend = false; }
							if (isFriend && !dyingAlly) dyingAlly = p;
							else if (!isFriend && !dyingEnemy) dyingEnemy = p;
						}

						if (dyingAlly) {
							/* ============ 桃博弈模型 ============ */

							/* ① 目标价值：身份 + 血量上限 + 威胁度 */
							let targetValue = 1.0;
							try {
								const tHp = dyingAlly.maxHp || 4;
								if (tHp >= 5) targetValue += 0.6;
								else if (tHp >= 4) targetValue += 0.3;
								const mode = (get && typeof get.mode === 'function') ? get.mode() : ((_status && _status.mode) || '');
								if (mode === 'identity') {
									const hard = _hardIdentityOf(me, dyingAlly);
									const tid = _identityOfFor(me, dyingAlly);
									const conf = _confidenceOfFor(me, dyingAlly);
									if (dyingAlly === game.zhu) targetValue += 1.5;
									else if (hard && hard.role && hard.role !== 'nei') targetValue += 1.0;
									else if (tid !== 'unknown' && conf >= 0.65) targetValue += 0.5;
								}
								try {
									const th = threatOf(dyingAlly);
									targetValue += Math.min(1.0, th * 0.15);
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

							/* ② 救援成功率：自己手里桃数量 */
							let myTaoCount = 0;
							try {
								myTaoCount = me.countCards ? me.countCards('hs', 'tao') : 0;
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
							const hpDeficit = Math.max(1, -(dyingAlly.hp || 0) + 1);
							const needed = hpDeficit;
							const enough = myTaoCount >= needed ? 1.0 : (myTaoCount / needed);

							/* ③ 桃的机会成本：自己血量低 → 桃更贵 */
							let opportunityCost = 1.0;
							try {
								const myHp = me.hp || 0;
								const myMax = me.maxHp || 1;
								const hpRatio = myHp / Math.max(1, myMax);
								if (hpRatio < 0.3) opportunityCost = 3.0;
								else if (hpRatio < 0.5) opportunityCost = 2.0;
								else if (hpRatio < 0.7) opportunityCost = 1.3;
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

							/* ④ ★ 敌方再救风险：敌方手里的桃/酒越多 → 我救完可能又被打 */
							let enemyTaoRisk = 0;
							try {
								for (const p of (game.players || [])) {
									if (!p || p === me || p === dyingAlly) continue;
									if (p.alive === false) continue;
									if (!isEnemy(me, p)) continue;
									let knownTao = 0;
									try {
										const known = p.getKnownCards ? p.getKnownCards() : [];
										known.forEach(function (c) {
											const n = get.name(c);
											if (n === 'tao' || n === 'jiu') knownTao++;
										});
									} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
									enemyTaoRisk += knownTao;
									try {
										const hc = p.countCards ? p.countCards('h') : 0;
										enemyTaoRisk += hc * 0.08;
									} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								}
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

							/* ⑤ 综合评分 */
							let score = 6 * targetValue * enough / Math.max(1, opportunityCost);
							const riskFactor = 1 / (1 + enemyTaoRisk * 0.3);
							score *= riskFactor;

							/* ⑥ 队友自己能自救 → 优先让他自救 */
							try {
								const allyTao = dyingAlly.countCards ? dyingAlly.countCards('hs', 'tao') : 0;
								const allyJiu = dyingAlly.countCards ? dyingAlly.countCards('hs', 'jiu') : 0;
								const selfSave = allyTao + allyJiu;
								if (selfSave >= needed) {
									score *= 0.4;
								}
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

							/* ⑦ 濒死目标 HP 缺口越大，救援紧迫度越高 */
							if (hpDeficit >= 2) score *= 1.4;

							s += score;

						} else if (dyingEnemy) {
							s -= 8;
						}
					} catch (eDying) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDying); }
				}


				/* 酒：濒死时也能当桃用，但优先级低于桃 */
				if (id === 'jiu') {
					try {
						let dyingAlly = null;
						for (const p of (game.players || [])) {
							if (!p || p === me) continue;
							if (p.alive === false || (p.hp || 0) > 0) continue;
							if (_isAllyMemo(p)) { dyingAlly = p; break; }   /* 敌我系统：真队友濒死才救（身份未明也能识别） */
						}
						if (dyingAlly) {
							const hpDeficit = Math.max(1, -(dyingAlly.hp || 0) + 1);
							/* 酒救援优先级比桃低一档（因为酒有攻击副作用） */
							s += hpDeficit >= 2 ? 5 : 3;
						}
					} catch (eDying) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDying); }
				}

				/* AOE 的响应概率、友军风险、残血权重与牌堆稀缺统一由 aoeTiming.js 评估。 */

				/* ★ 敌方爆发威胁调整 */
				if (burst.value >= 0.4) {
					/* 拆牌类：目标是爆发威胁者 → 大幅加分（优先拆连弩） */
					if ((id === 'guohe' || id === 'shunshou') && cardTarget === burst.target) {
						s += 3 * burst.value;
					}
					/* 防御牌：敌方连弩在 → 强烈保留 */
					if (DEF_CARDS.indexOf(id) >= 0) {
						s *= 1.0 + 0.6 * burst.value;
					}
					/* 攻击牌：趁对方未爆发提前压制（先手斩） */
					if (ATK_CARDS.indexOf(id) >= 0) {
						s *= 1.0 + 0.4 * burst.value;
					}
					/* 若目标是爆发威胁者本人，ATK 权重再加一档 */
					if (cardTarget === burst.target && ATK_CARDS.indexOf(id) >= 0) {
						s *= 1.15;
					}
				}

				/* ★ 连弩出牌顺序优化：装连弩 + 手里有杀时，调整候选优先级 */
				try {
					const hasZhuge = !!me.getEquip && !!me.getEquip('zhuge');
					const myShaCount = me.countCards ? me.countCards('hs', 'sha') : 0;
					if (hasZhuge && myShaCount > 0) {
						/* 1) 拆牌类前置：拆掉敌方防具，为后续连杀开路 */
						if (id === 'guohe' || id === 'shunshou') {
							if (cardTarget && !isSameCamp(me, cardTarget)) {
								/* 目标有装备 → 强前置 */
								const equips = cardTarget.getCards ? cardTarget.getCards('e') : [];
								if (equips.length > 0) s += 3.5;
								else s += 1.0;
							}
						}
						/* 2) 酒前置：有酒且有杀时，先喝酒再杀 */
						if (id === 'jiu') {
							/* 目标 HP≥2 时酒才有意义（HP=1 时杀直接带走，酒浪费） */
							if (cardTarget && (cardTarget.hp || 0) >= 2) s += 3.0;
						}
						/* 3) AOE 后置：南蛮/万箭会先消耗敌方的杀/闪，
						 *    如果敌人被逼出闪，后续杀的命中率反降；
						 *    如果敌人用杀应答南蛮，则更耐杀。
						 *    综合来看，连弩状态下 AOE 应后置。 */
						if (id === 'nanman' || id === 'wanjian') {
							s *= 0.7;
						}
						/* 4) 无中/桃园等纯收益牌：连弩状态下不宜抢先后 */
						if (id === 'wuzhong' || id === 'taoyuan' || id === 'wugu') {
							s *= 0.85;
						}
						/* 5) 杀本身：连弩 + 多杀场景下，基础分抬升 */
						if (id === 'sha' && myShaCount >= 2) {
							s *= 1.15;
						}
					}
				} catch (eZhuge) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eZhuge); }

				if (ATK_CARDS.indexOf(id) >= 0) s *= risk.atk * atkMul * cfg('wAtkCard', 1);
				else if (DEF_CARDS.indexOf(id) >= 0) s *= risk.def * keepMul * cfg('wDefCard', 1);
				/* ★ 对象匹配加成：攻击牌打敌 / 拆牌打敌 / 治疗对友 */
				if (cardTarget) {
					/* ★ 第四层：敌我系统统一判定（dispositionOf 三态+行为推断），阵营系统不再兼任敌我 */
					let isAlly = false;
					let isEnemy = false;
					try {
						isAlly = _isAllyMemo(cardTarget);
						isEnemy = _isEnemyMemo(cardTarget);
					} catch (eR) {
						try { isEnemy = _isEnemyMemo(cardTarget); } catch (e2) { isEnemy = false; }
						isAlly = !isEnemy;
					}

					/* ★ 主忠互殴惩罚（调高，软指标） */
					try {
						if (isAlly && ['sha', 'juedou', 'huogong', 'zhujin', 'nanman', 'wanjian'].indexOf(id) >= 0) {
							/* 打队友：大幅扣分（主忠互殴惩罚变高） */
							s += getMetric('ally_attack_penalty');
							/* 残局打队友惩罚更重 */
							const aliveCount = (game.players || []).filter(function (p) { return p && p.alive !== false; }).length;
							if (aliveCount <= 4) {
								s += getMetric('ally_attack_endgame');
							}
						}
					} catch (eAlly) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAlly); }

					/* ★ 忠臣打主公：额外惩罚（软指标，初始-30，剩下让模型判断） */
					try {
						if (me.identity === 'zhong' || me.identity === 'zhu') {
							if (cardTarget && cardTarget === game.zhu) {
								if (['sha', 'juedou', 'huogong', 'zhujin', 'nanman', 'wanjian'].indexOf(id) >= 0) {
									s += getMetric('zhong_attack_zhu_penalty', -30);
								}
							}
						}
					} catch (eZhongZhu) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eZhongZhu); }

					/* ★ 阵亡+明置角色：身份100%确定，加入策略 */
					try {
						if (cardTarget && cardTarget.hp <= 0 && cardTarget.identityShown && cardTarget.identity) {
							/* 阵亡+明置的角色，身份100%确定 */
							if (cardTarget.identity === 'fan') {
								/* 确定是反贼 → 打他有额外加分 */
								if (['sha', 'juedou', 'huogong'].indexOf(id) >= 0) {
									s += getMetric('dead_fan_bonus', 5);
								}
							}
							if (cardTarget.identity === 'zhong') {
								/* 确定是忠臣 → 打他有额外惩罚 */
								if (['sha', 'juedou', 'huogong'].indexOf(id) >= 0) {
									s += getMetric('dead_zhong_penalty', -10);
								}
							}
						}
					} catch (eDeadIdentity) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDeadIdentity); }

					/* ★ 忠臣保护主公加分（新增，软指标） */
					try {
						if (me.identity === 'zhong' || me.identity === 'zhu') {
							/* 找主公 */
							const zhugong = (game.zhu && game.zhu.alive !== false) ? game.zhu : null;
							if (zhugong && zhugong !== me) {
								/* 治疗/保护牌对主公 → 高加分 */
								if (['tao', 'taoyuan'].indexOf(id) >= 0 && cardTarget === zhugong) {
									s += getMetric('protect_zhugong_bonus');
								}
								/* 主公受威胁时，防御牌/救援牌权重提高 */
								const zhugongHp = zhugong.hp || 0;
								const zhugongMaxHp = zhugong.maxHp || 4;
								if (zhugongHp <= 2 && zhugongMaxHp > 2) {
									if (['tao', 'shan', 'shandian', 'jiuge'].indexOf(id) >= 0) {
										s += getMetric('zhugong_under_threat');
									}
								}
							}
						}
					} catch (eZhugong) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eZhugong); }

					/* ★ 主公不能把内奸当反贼打：要根据实际价值判断 */
					try {
						if (me.identity === 'zhu') {
							/* 主公身份：不直接根据身份打，要根据实际行为价值 */
							/* 如果目标身份不明置，不能直接当反贼打 */
							if (cardTarget && !cardTarget.identityShown) {
								/* 身份不明置：降低攻击权重，让模型自己判断价值 */
								if (['sha', 'juedou', 'huogong', 'zhujin'].indexOf(id) >= 0) {
									/* 攻击权重打个折，不要太激进 */
									s *= 0.8;
								}
							}
						}
					} catch (eZhuValue) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eZhuValue); }

					/* 单体攻击牌打敌 → 加成 */
					if (['sha', 'juedou', 'huogong', 'zhujin'].indexOf(id) >= 0 && isEnemy) {
						s *= 1.12;
					}
					/* 拆牌/延时类打敌 → 加成 */
					if (['guohe', 'shunshou', 'lebu', 'bingliang'].indexOf(id) >= 0 && isEnemy) {
						s *= 1.08;
						/* ★ 衰减：顺敌方延时锦囊（兵/乐）→ 刷分漏洞衰减 0.3
						 *   原因：从敌方 A 顺兵/乐，再贴给敌方 B，
						 *   本质是拆东墙补西墙，不是真正收益 */
						if (id === 'shunshou' && cardTarget) {
							try {
								/* ★ V01修复：不读对手手牌内容，改用合法概率推断其手牌含延时锦囊 */
								const pDelay = Math.max(
									probHasCard(cardTarget, 'lebu'),
									probHasCard(cardTarget, 'bingliang')
								);
								if (pDelay >= 0.2) s *= 0.7;
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						}
					}
					/* ★ 通用 Strategic Transition 候选评分：不依赖具体牌名/敌友分支。
					 * create-state 与 remove-target-card 都由 gameProfile 语义驱动；
					 * CREATE→REMOVE、REMOVE→CREATE 统一在 ledger 中做 soft opportunity cost。 */
					try {
						if (cardTarget) {
							const tp = evaluateActionTransitionPenalty(me, cardTarget, id, {
								relationOf: function (mi, t) { return dispositionOf(mi, t); },
							});
							if (tp && typeof tp.penalty === 'number' && tp.penalty !== 0) s -= tp.penalty;
						}
					} catch (eStrategic) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eStrategic); }

					/* 治疗类对友 → 加成 */
					if (['tao', 'taoyuan', 'wuzhong'].indexOf(id) >= 0 && !isEnemy) {
						s *= 1.08;
					}
				}
				/* 高方差卡牌：按冒险轴缩放（赌徒性格更爱火攻/决斗） */
				if (["huogong", "juedou", "shandian"].indexOf(id) >= 0) s *= riskTaking * cfg('wRiskCard', 1);
				s -= opportunityCost(id, econ) * cfg('wOpportunityMul', 0.5);
				combos.forEach(function (c) { if (c.setup === id) s += c.bonus * cfg('wComboBonus', 1); });
				/* 团队技能联动加成 */
				teamCombos.forEach(function (c) {
					if (c.skill && (id === c.skill || (c.skill === "jizhi" && ["wuzhong","guohe","shunshou","nanman","wanjian","tiesuo","lebu","bingliang"].indexOf(id) >= 0))) {
						s += c.bonus * 0.5;
					}
				});
				/* 集火加成：攻击牌打集火目标（团队轴调节） */
				if (focus && cardTarget === focus.target && ATK_CARDS.indexOf(id) >= 0) s *= (0.85 + 0.4 * teamwork) * trendMul.focus * cfg('wFocusMul', 1);
				/* 座位压力加成：乐/兵优先打最近敌方下家 */
				if (SEAT_TARGET_CARDS.indexOf(id) >= 0) {
					if (seat.nextEnemy && cardTarget === seat.nextEnemy) s += 1.5;
					else s += seat.enemyPressure * 0.3 * cfg('wSeatPressure', 1);
				}
				/* 上家是敌人 → 防御牌保留倾向提高 */
				if (DEF_CARDS.indexOf(id) >= 0 && seat.prevEnemy) s *= 1.15;
				/* 下回合预测修正：高危时防御牌大涨、进攻牌降权 */
				if (DEF_CARDS.indexOf(id) >= 0) {
					if (incoming.killRisk) s *= 1.6;
					else if (incoming.selfRisk >= 0.6) s *= 1.3;
					else if (incoming.selfRisk >= 0.3) s *= 1.1;
					s *= cfg('wForecastMul', 1);
				}
				if (ATK_CARDS.indexOf(id) >= 0) {
					if (incoming.killRisk) s *= 0.75;
					else if (incoming.selfRisk >= 0.6) s *= 0.9;
					else if (incoming.selfRisk < 0.15) s *= 1.12;
					s *= cfg('wForecastMul', 1);
				}
				/* 多回合趋势修正 */
				if (mt && mt.overall === "worsening") {
					if (ATK_CARDS.indexOf(id) >= 0) s *= 1.1;
					if (DEF_CARDS.indexOf(id) >= 0) s *= 0.95;
				} else if (mt && mt.overall === "improving") {
					if (DEF_CARDS.indexOf(id) >= 0) s *= 1.08;
				}
				/* 趋势联动权重 */
				if (ATK_CARDS.indexOf(id) >= 0) s *= trendMul.atk;
				if (DEF_CARDS.indexOf(id) >= 0) s *= trendMul.keep;
				/* 协作分工：进攻/防御卡牌偏移 */
				if (ROLE_PREFS) {
					if (ATK_CARDS.indexOf(id) >= 0) s *= ROLE_PREFS.cardAtk;
					if (DEF_CARDS.indexOf(id) >= 0) s *= ROLE_PREFS.cardDef;
				}
				/* ★ 决策维度反馈（target / tempo / play） */
				try {
					const targetBonus = cardTarget ? getDecisionBonus('target', cardTarget.name1 || cardTarget.name) : 1.0;
					s *= targetBonus;
					const tempoBonus = getDecisionBonus('tempo', stageLabel);
					s *= tempoBonus;
					const playBonus = getDecisionBonus('play', id);
					s *= playBonus;
				} catch (eFB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFB); }

				/* ★ 单回合动量线性倍率：本回合持续高收益 → 乘胜追击（放大进攻向）；
				 *   持续低收益 → 及时止损（统一衰减）。范围 [0.7, 1.3]，0.5 步聚力/0.5 步衰减，
				 *   作为收敛期通用乘数作用于所有候选，不偏科。 */
				s *= turnMomentum(me);

				/* ★ 覆写命中时增强 reason */
				let ovTag = '';
				try {
					const ov = readCardOverride(id, me, cardTarget);
					if (ov) ovTag = ' | 覆写:' + Math.round(ov.score * 10) / 10 + '(' + (ov.reason || '').slice(0, 20) + ')';
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

				/* ★ 指令 02：铁索连环不再沿用普通 targetScore → top1/top2，
				 * 也不写死「最多连 6 个敌人」。交由唯一权威策略源 tiesuoEvaluator，
				 * 在同一层比较 RECAST / 单目标 / 双目标（含「解队友 + 链敌人」）。 */
				let targetNames = null;
				let targetDesc = '';
				let tieTargets = null;
				let recast = false;
				let actScore = s;
				if (id === 'tiesuo') {
					try {
						/* 合法目标：存活且非我（与既有 tsMap 口径一致） */
						const legalTie = [];
						for (const [pp] of tsMap) {
							if (!pp || pp === me) continue;
							try { if (pp.isDead ? pp.isDead() : (pp.hp !== undefined && pp.hp <= 0)) continue; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
							legalTie.push(pp);
						}
						/* ★ 属性机会 modifier（方案 §11.4 轻量版）：
						 *   我方持有属性伤害手段 → enemy-linked 价值上调；
						 *   敌方持有属性伤害威胁 → ally-linked 罚分上调。
						 * 复用 threat.linkedChainValue 校验「属性机会是否已在场上成立」。 */
						let hasOurAttr = false, enemyAttrThreat = false;
						try {
							const _isNatureCard = function (c, owner) {
								try {
									const n = get.name ? get.name(c, owner) : (c && c.name);
									if (n === 'huogong' || n === 'shandian') return true;
									if (game && game.hasNature && (game.hasNature(c, 'fire') || game.hasNature(c, 'thunder'))) return true;
								} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								return false;
							};
							const _hasNature = function (p) {
								try { return (p && p.getCards ? p.getCards('h') : []).some(function (c) { return _isNatureCard(c, p); }); }
								catch (e) { return false; }
							};
							if (_hasNature(me)) {
								hasOurAttr = true;
								/* 场上已有横置敌人时，若传导净收益为负（牵连更多队友）则不算「明确机会」 */
								let linkedEnemy = null;
								for (const [pp] of tsMap) {
									if (!pp || pp === me) continue;
									try { if (_isEnemyMemo(pp) && isPlayerLinked(pp)) { linkedEnemy = pp; break; } } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
								}
								if (linkedEnemy) {
									let cv = 0;
									try { cv = Math.max(linkedChainValue(me, linkedEnemy, 'fire'), linkedChainValue(me, linkedEnemy, 'thunder')); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
									if (!(cv > 0)) hasOurAttr = false;
								}
							}
							try {
								enemyAttrThreat = (game.players || []).some(function (p) {
									if (!p || p === me || p.alive === false) return false;
									try { if (!_isEnemyMemo(p)) return false; } catch (e) { return false; }
									return _hasNature(p);
								});
							} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						const tieRes = evaluateTiesuoActions(me, id, {
							candidates: legalTie,
							players: (game && game.players) || legalTie,
							canRecast: true,
							hasOurAttr: hasOurAttr,
							enemyAttrThreat: enemyAttrThreat,
						});
						const tieBest = tieRes.bestAction;
						const tieUtility = (tieBest && tieBest.type === 'use')
							? tieBest.delta
							: ((tieRes && typeof tieRes.recastValue === 'number') ? tieRes.recastValue : 0);
						/* ★ 铁索统一量纲：使用与重铸都从 evaluator utility → engine raw，
						 * 禁止 use 继续沿用普通卡 s、recast 却只拿 1.2，避免尺度断层。 */
						actScore = tiesuoUtilityToEngineRaw(tieUtility);
						if (tieBest && tieBest.type === 'use' && tieBest.targets && tieBest.targets.length) {
							tieTargets = tieBest.targets.slice();
							targetNames = tieTargets.map(function (p) { return p.name || p.name1; });
							targetDesc = '→' + targetNames.join('+') + '（连' + targetNames.length + '个，ΔU' + tieBest.delta
								+ '，门槛' + tieRes.useThreshold + '，raw' + actScore + '）';
						} else {
							/* evaluator 未达到使用门槛（或无有效目标）→ 显式重铸，不伪装成 use */
							recast = true;
							targetNames = null;
							targetDesc = '（重铸摸牌 RecastValue=' + tieUtility
								+ '，使用门槛=' + tieRes.useThreshold + '，raw=' + actScore + '）';
						}
					} catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); }
				} else if (cardTarget) {
					targetNames = targetKey(cardTarget);
					targetDesc = '→' + targetNames + (boundTarget.score ? '（目标分' + Math.round(boundTarget.score * 10) / 10 + '）' : '');
				}

				const cardAct = makeActionCandidate({
					type: "card",
					id: id,
					target: targetNames,
					targetObj: (id === 'tiesuo') ? null : cardTarget,
					targetList: (id === 'tiesuo' && !recast) ? tieTargets : null,
					targetResolved: id === 'tiesuo' ? true : boundTarget.resolved,
					recast: recast,
					targetScore: id === 'tiesuo' ? runtimeScore(bestTs) : runtimeScore(boundTarget.score || 0),
					score: runtimeScore(actScore),
					reason: (recast ? "重铸" : "使用") + (v.name || id) + targetDesc + "（EV" + Math.round(ev * 10) / 10 + " 边际" + Math.round(mv * 10) / 10 + ovTag + "）"
				});
				return cardAct;
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
