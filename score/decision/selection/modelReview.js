/* 职责：模型观测、冠军提权、DeepThink 和战略优先级屏障，执行顺序保持原样。
 * 护栏在其后。本模块不执行动作；延迟观测在 Commit 时读取最终 winner。
 * 原有模型接管禁用分支及冠军启用条件保持不变。 */
import { game, _status } from '../../foundation/adapt/host.js';
import { cfg } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { applyChampionRule, getEmbedding as champEmbedding, resolveChampionBoost } from '../strategy/championStrategy.js';
import { sameCandidatePolicyBand, isCandidateEligible, compareActionCandidates } from '../state/actionCandidate.js';
import { FEATURE_DIM } from '../../model/features/features.js';
import { isReady as weightsReady } from '../../model/weights/weights.js';
import { cognitiveModulate, decideIntervention } from '../../cognition/metaCognition.js';
import { criticBest as deepThinkCritic } from '../../cognition/deepThink.js';
export function reviewCandidate(context, { _aiStrengthFactor, _deferEffect, readFinalState }) {
let { best, modelConf, metaMod, intervention } = context;
const { me, acts, eligibleActs, bestT, bestTs } = context;
		/* ★ 用训练好的模型微调（best 已确定，可安全访问 best._feat） */
		try {
			if (weightsReady() && cfg('useTrainedModel', true) && best && best._feat) {
				const feat = new Int8Array(FEATURE_DIM);  /* ★ FEATURE_DIM 与 features.js 对齐（唯一真源，避免魔法数字漂移） */
				for (let i = 0; i < FEATURE_DIM && i < best._feat.length; i++) feat[i] = best._feat[i];
				modelConf = window.__DJSC && window.__DJSC.confidence ? window.__DJSC.confidence(feat) : null;
				/* ★ 决策置信由"冠军嵌入价值"优先决定（冠军策略优先，原为模型置信度预测）。
				 * 命中冠军嵌入 → 价值折算为置信；否则用模型置信度作观测/兜底。 */
				{
					const _chid = (me && (me.name || me.name1)) || '';
					const _chRow = (best && typeof champEmbedding === 'function') ? champEmbedding(best.type, best.id, _chid) : null;
					if (_chRow && _chRow.value > 0) {
						best._conf = 0.4 + Math.min(0.5, Math.abs(_chRow.value));
						best.reason = (best.reason || '') + '｜冠军:' + _chRow.value.toFixed(2) + '·' + (_chRow.count || 0) + '条';
					} else {
						best._conf = (modelConf && modelConf.maxProb && !isNaN(modelConf.maxProb)) ? modelConf.maxProb : 0.3;
					}
				}
				if (modelConf && modelConf.action !== 'skip') {
					metaMod = cognitiveModulate(
						{ type: best.type, id: best.id, target: best.target },
						{}
					);
					intervention = decideIntervention(modelConf, metaMod);
					const wModelMap = { model: 0.1, blend: 0.05, rule: 0.02, skip: 0 };  /* ★ 再调低权重，减少卡顿 */
					const baseW = wModelMap[intervention] || 0.1;
					let calibTrust = 0;
					try {
						if (window.__DJSC.calibrator && window.__DJSC.calibrator.modelTrust) {
							calibTrust = window.__DJSC.calibrator.modelTrust();
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					/* ★ AI 强度档位：缩放模型对决策的影响力（不砍规则/战术层，只调模型强度）
					 *   极弱≈纯规则、弱→明显放水、中→平衡、强→全力、极强→全力×2 */
					const strengthFactor = _aiStrengthFactor();
					const wModel = 0;   /* ★ 模型不再接管选牌分数：置 0，仅保留置信度/校准/训练观测，不改写任何动作分。对局接管权交予下方冠军策略。 */
					if (false) { /* ★ 模型逐动作接管已停用（false）：不再为每个候选跑整网预测，也不再打印"模型接管"，彻底交予冠军策略接管。 */
						let _takeoverCount = 0;  /* ★ 统计本轮接管次数 */
						let _lastMLog = '';
						/* ★ 复用同一块 Int8Array 作为候选特征缓冲，避免每个动作都分配一次 */
						const _fa = new Int8Array(FEATURE_DIM);
						for (let i = 0; i < acts.length; i++) {
							const a = acts[i];
							if (!a._feat) continue;
							_fa.fill(0);
							for (let j = 0; j < FEATURE_DIM && j < a._feat.length; j++) _fa[j] = a._feat[j];
							/* ★ 性能优化：best 已在上面算过 modelConf，直接复用，省一次整网预测 */
							const sub = (a === best && modelConf && modelConf.action) ? modelConf : window.__DJSC.confidence(_fa);
							if (!sub) continue;
							const modelStrength = (sub.probs ? Math.max.apply(null, sub.probs) : 0) * 32;
							a.score = Math.round(a.score * (1 - wModel) + modelStrength * wModel);
							var mLog = '[M:' + sub.label + '·' + intervention + '·F' + Math.round(metaMod.familiarity * 100) + '%]';
							a.reason = (a.reason || '') + mLog;
							_takeoverCount++;
							_lastMLog = mLog;
						}
						/* ★ 日志：不管有没有给其他动作提取特征，都打印一行 */
						try {
							var _baseMLog = '[M:' + (modelConf.action || '?') + '·' + intervention + '·F' + Math.round((metaMod && metaMod.familiarity) * 100) + '%]';
							if (_takeoverCount > 0) {
								game.log('模型接管 ×' + _takeoverCount + ' 个动作 ' + _lastMLog);
							} else {
								game.log('模型融合 ' + _baseMLog + ' (仅best)');
							}
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					}
					/* ★ 冠军策略固化：替换规则链 —— 命中样本训练出的同类型最高价值决策则提权并可能替换。
					 * 规则摘要（详见 championStrategy.applyChampionRule）：R1启用→R2同类型→R3候选命中→
					 * R4模糊判定→R5价值为正→R6提权→R7替换→R8兜底 */
					try {
						const _baseBoost = resolveChampionBoost(cfg('championBoost', 0));   /* ★ 配置0/缺省关闭；正数才启用冠军提权 */
						/* ★ 接上 AI 强度档位（此前该系数算完没人用=死开关；中=1.0 时行为与原来完全一致） */
						const champBoost = _baseBoost * strengthFactor;
						if (champBoost > 0 && typeof applyChampionRule === 'function') {
							const cr = applyChampionRule(eligibleActs, best, champBoost, {
								heroId: (me && (me.name1 || me.name)) || '',  /* ★ #38 当前实际行动者，禁止误用 game.me */
							});
							if (cr && cr.replaced && cr.best && cr.best !== best) {
								best = cr.best;
								best.reason = (best.reason || '') + '｜冠军:' + (cr.hit || 0) + '条';
							}
						}
					} catch (eChamp) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eChamp); }
					_deferEffect('model-observation', function () {
						const { best, bestT } = readFinalState();
						try {
							if (window.__DJSC.conflict && window.__DJSC.conflict.detect) {
								window.__DJSC.conflict.detect(best, modelConf, metaMod, { type: best.type, id: best.id, target: best.target });
							}
						} catch (eC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eC); }
						try {
							if (window.__DJSC.calibrator && window.__DJSC.calibrator.record && modelConf) {
								window.__DJSC.calibrator.record(best, modelConf, { me: me, bestT: bestT, bestTs: bestTs });
							}
						} catch (eCal) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCal); }
					});
					try {
						if (false && window.__DJSC.strategyBus && modelConf && modelConf.confidence >= 0.55) {   /* ★ 模型仲裁接管已停用（false），接管权交予冠军策略 */
							const busRes = window.__DJSC.strategyBus.arbitrate(best, modelConf, me, acts);
							if (busRes && busRes.picked) {
								best = busRes.picked;
								best.reason = (best.reason || '') + '｜总线：' + busRes.reason;
							}
						}
					} catch (eBus) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eBus); }
					try { _status.djsc_lastConfidence = modelConf; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					try { _status.djsc_lastMeta = { model: modelConf, meta: metaMod, intervention: intervention }; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}
			}
		} catch (eModel) {
			try { console.error('[模型融合] 异常：', eModel); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}

		/* ★ 模型深度思考（思考层，归"模型"职责；其余成片归子代理）。
		 * 对冠军策略已定夺的 best 做批判性多源复核：best 与次优分差小（分歧大）时才触发，
		 * 产出思维链 thinking，若推翻了则给出替代建议。尊重冠军策略的最终定夺。 */
		try {
			if (best && typeof deepThinkCritic === 'function') {
				const _dRes = deepThinkCritic(me, eligibleActs, best, {
					modelP: (modelConf && modelConf.maxProb) || 0,
					heroId: (me && (me.name || me.name1)) || '',
				});
				if (_dRes && Array.isArray(_dRes.thinking)) {
					try { _status.djsc_lastThinking = _dRes.thinking; } catch (eTH) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTH); }
				}
				if (_dRes && _dRes.replaced && _dRes.best && _dRes.best !== best) {
					best = _dRes.best;
					best.reason = (best.reason || '') + '｜深度思考:' + (_dRes.reason || '改打');
				}
			}
		} catch (eDeep) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eDeep); }

		/* ★ #37 Strategic Policy Barrier
		 * Champion/DeepThink 可以在同一 policy band 内优化，但不能把 CRITICAL/FORCED
		 * 身份职责降回普通动作。Guard 仍位于后方，保留最终安全否决权。 */
		try {
			acts.sort(compareActionCandidates);
			const strategicTop = acts.find(isCandidateEligible) || null;
			if (strategicTop && best && !sameCandidatePolicyBand(strategicTop, best) &&
				compareActionCandidates(strategicTop, best) < 0) {
				best = strategicTop;
				best.reason = (best.reason || '') + '｜战略职责边界';
			}
		} catch (ePolicy) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePolicy); }

return { best, modelConf, metaMod, intervention };
}
