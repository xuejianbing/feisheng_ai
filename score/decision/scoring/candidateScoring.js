/* 职责：按原顺序应用基本规则、收益方向、知识、画像和战略优先级修正。
 * 修改原候选，不生成或执行动作，不改变模型格式。 */
import { game } from '../../foundation/adapt/host.js';
import { applyCampSkillProgressBonus } from '../skills/skillProgress.js';
import { applyResourceMaximizeBonus, applyLossMinimizeBonus } from '../strategy/resourceMaximize.js';
import { getModeStrategy } from '../strategy/modeStrategy.js';
import { applyStrategicIntentToCandidates } from '../strategy/intentAlignment.js';
import { applyCharacterPolicyToCandidates } from '../strategy/characterPolicy.js';
import { initializeUtilityPipeline, trackUtilityStage, finalizeUtilityPipeline } from '../utility/utilityPipeline.js';
import { actionValue as relActionValue } from '../relations/relations.js';
import { focusTarget } from '../../perception/team/team.js';
import { keepBonus } from '../cardplay/keepStrategyOpt.js';
import { ensureCandidatePolicy } from '../state/actionCandidate.js';
import { applySharedBonus } from '../../perception/knowledge/sharedKnowledge.js';
import { applyBasicCardPlayRules, applyBasicSkillRules, applyBasicEquipRules, applyBasicJudgeRules, applyBasicTargetRules } from '../rules/basicRules.js';
export function scoreCandidates(context, _getRoundNumber) {
const { me, acts, focus, characterPolicy, strategicState, _isAllyMemo } = context;
		/* ★ #39 Unified Utility Pipeline
		 * 此刻 candidate.score 已包含候选生成/专项 timing 等历史逻辑，作为 legacyBase。
		 * 从这里开始的通用后处理逐段写入 Utility Vector；canonical score 暂不切换。 */
		try { initializeUtilityPipeline(acts); }
		catch (eU) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eU); }

		/* 手牌保留压力已统一进入 keepBonus()；此处不再维护第二套 handKeepBias，
		 * 防止“越想保留，出牌分反而越高”的方向冲突。 */

		/* ★ 模式专属加成 → #39 team 维度 */
		try {
			trackUtilityStage(acts, 'modeStrategy', 'team', function () {
				const modeStrategy = getModeStrategy();
				acts.forEach(function (a) {
					try {
						const boost = modeStrategy.decisionBoost(me, a);
						if (boost) a.score += boost;
						a.mode = modeStrategy.name;
					} catch (eB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eB); }
				});
			});
		} catch (eM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eM); }

		/* ★ 暗身份隐藏奖励（逐模式 hiddenIdentity 配置；主公/明置/明置身份局除外）
		 * 身份隐蔽角色（反/忠/内、国战未亮势力）行动评分乘以倍率更积极；
		 * 动作指向明身份/明势力目标（会暴露自己）→ 倍率回落 1（等效"无意义暴露身份"软惩罚）。
		 * 倍率随轮数微弱提升（lateGrowthPerRound 为每轮涨幅，封顶倍率 maxMultiplier 防爆）。 */
		try {
			trackUtilityStage(acts, 'identityExposure', 'uncertainty', function () {
				const modeStrategy = getModeStrategy();
				const hi = (modeStrategy.hiddenIdentity) || { enable: false, multiplier: 1 };
			if (hi.enable) {
				const isZhu = me.identity === 'zhu';
				const isShown = !!me.identityShown;
				if (!isZhu && !isShown) {
					/* 轮数微弱成长： base + perRound*round，封顶 maxMultiplier */
					const base = (hi.multiplier || 1);
					const perRound = (hi.lateGrowthPerRound || 0.004);
					const cap = (hi.maxMultiplier || base + 0.15);
					const round = _getRoundNumber();
					let mul = base + perRound * round;
					if (mul > cap) mul = cap;
					acts.forEach(function (a) {
						try {
							let expose = false;
							if (a && a.target) {
								for (const p of (game.players || [])) {
									if (!p) continue;
									if ((p.name1 || p.name || '') === a.target) {
										if (modeStrategy.name === 'identity') {
										expose = (p === game.zhu) || !!p.identityShown || p.identity === 'mingzhong';
									} else if (p.identity || p.identityShown) expose = true;
										break;
									}
								}
							}
							if (!expose) a.score *= mul;   /* 隐蔽出手 → 倍率（随轮数提升） */
							/* expose → 保持 1，不额外激励("暴露身份"软惩罚) */
						} catch (eH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eH); }
					});
				}
			}
			});
		} catch (eHI) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eHI); }

		/* ★ 攻击队友禁令：直接从候选中剔除所有攻击队友的动作 */
		try {
			const ATK_IDS = ["sha", "juedou", "huogong", "nanman", "wanjian", "jiedao", "lijian", "fanjian", "sidian", "huosha", "leisha", "zhujin", "shunshou", "guohe", "lebu", "bingliang", "tiesuo"];
			acts.forEach(function (a) {
				if (a.type !== "card") return;
				if (ATK_IDS.indexOf(a.id) < 0) return;
				/* 找到目标玩家对象 */
				let tgt = null;
				try {
					if (a.target) {
						for (const p of (game.players || [])) {
							if (!p) continue;
							if ((p.name1 || p.name || "") === a.target) { tgt = p; break; }
						}
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				if (!tgt) return;
				if (_isAllyMemo(tgt)) {
					/* ★ 不刻意加规则，让模型自己学：
					 *   打队友的惩罚不写死，而是把"是否打队友"作为特征写进 130 维特征
					 *   模型从对局反馈中自己学习这个特征的权重
					 *   打多了自然就知道不好，但又不会绝对禁止 */
					a.reason = (a.reason || "") + "（[特征]打队友）";
				}
			});
		} catch (eBan) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBan); }


		/* ★ 统一候选 policy 默认值 */
		acts.forEach(function (a) { try { ensureCandidatePolicy(a); } catch (e) {} });

		/* ★ 基本规则仍属 legacy 语义；保持原有逐模块故障隔离。
		 * 若某模块改分，显式进入 legacyResidual，不伪装成已迁移语义维度。 */
		try { trackUtilityStage(acts, 'basicCardRules', 'legacyResidual', function () { applyBasicCardPlayRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicSkillRules', 'legacyResidual', function () { applyBasicSkillRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicEquipRules', 'legacyResidual', function () { applyBasicEquipRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicJudgeRules', 'legacyResidual', function () { applyBasicJudgeRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		try { trackUtilityStage(acts, 'basicTargetRules', 'legacyResidual', function () { applyBasicTargetRules(me, acts); }); }
		catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ 统一收益系统方向守卫（actionValue）：对每个已带目标(含技能按类别补写后)的 act 强制方向判定
		 *   - 攻击/控制/拆除 → 只对 disposition<0 真敌加分，中性(身份未明)强负，真友强罚；
		 *   - 辅助/救援/增益 → 只对 disposition>0 真友加分，中性强负，真敌强罚(★杜绝给敌方摸牌/增益)。
		 *   - 必须位于所有 applyBasicXxxRules（含 applyBasicSkillRules 补写技能目标）之后执行，
		 *     否则技能 act 尚无 target，守卫不生效——此前顺序错位导致技能方向判定恒为空转。 */
		try {
			trackUtilityStage(acts, 'actionDirectionGuard', 'team', function () {
				acts.forEach(function (a) {
				try {
					if (!a) return;
					/* 多目标 act 展开成单目标名字数组逐项判定；单目标回退到 a.target */
					const names = Array.isArray(a.targetList)
						? a.targetList.map(function (p) { return (p && (p.name1 || p.name)) || ''; }).filter(Boolean)
						: (a.target ? [a.target] : []);
					if (!names.length) return;
					let minVal = 0;
					names.forEach(function (nm) {
						const actForValue = {
							id: a.id,
							type: a.type,
							target: nm,
							base: (typeof a.score === 'number' ? a.score : 0),
							purpose: a.purpose || undefined,
						};
						const val = relActionValue(me, actForValue);
						if (val < minVal) minVal = val;
					});
					/* 仅当方向守卫给出强负/方向修正时叠加，避免干扰既有主体评分。
					 * 多目标取最负者，避免任一方向违规目标被漏判。 */
					if (minVal < 0) {
						a.score += minVal;
						a.reason = (a.reason || '') + '（收益方向守卫 -' + Math.abs(Math.round(minVal * 10) / 10) + '）';
					}
				} catch (eAV) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAV); }
				});
			});
		} catch (eAVal) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAVal); }

		/* ★ 公共知识库：群体智慧加成（此前 applySharedBonus 只挂载从未调用，采纳数恒 0。
		 * 有高置信推荐时给对应候选加 30% 以内的分，并把采纳数 +1） */
		try { trackUtilityStage(acts, 'sharedKnowledge', 'team', function () { applySharedBonus(me, acts, { focusTarget: focus ? focus.target : null }); }); } catch (eS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eS); }

		/* ★ 功能①阵营共享技能进度：扶持近觉醒核心（勿耗核心 / 集中资源护核心） */
		try { trackUtilityStage(acts, 'campSkillProgress', 'future', function () { applyCampSkillProgressBonus(me, acts); }); } catch (eCP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCP); }
		/* ★ 功能②单英雄资源最大化：明确目标线路 + 连招潜力（命中 topLine 才加，不模糊） */
		try { trackUtilityStage(acts, 'resourceMaximize', 'resource', function () { applyResourceMaximizeBonus(me, acts); }); } catch (eRM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRM); }
		/* ★ 功能②'损失最小化：识别最大损失诱因，规避给正、冒险自曝给负 */
		try { trackUtilityStage(acts, 'lossMinimize', 'risk', function () { applyLossMinimizeBonus(me, acts); }); } catch (eLM) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eLM); }

		/* ★ #38 武将画像只做有界软 utility 修正，不改 eligible / priority tier。 */
		try { trackUtilityStage(acts, 'characterPolicy', 'synergy', function () { applyCharacterPolicyToCandidates(me, acts, characterPolicy); }); }
		catch (eCP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCP); }

		/* ★ #39 双轨对账：到此为止所有统一后处理分值变化应已进入 Utility Vector。 */
		try { finalizeUtilityPipeline(acts); }
		catch (eU) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eU); }

		/* ★ #37 战略层不修改 score：
		 * 只有明确 CRITICAL/FORCED 职责且候选高度对齐时提升 policy tier。
		 * 普通 FOCUS/BALANCE/DEVELOP 只记录 alignment，仍由 utility 排序。 */
		try { applyStrategicIntentToCandidates(acts, strategicState); }
		catch (eSI) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSI); }


}
