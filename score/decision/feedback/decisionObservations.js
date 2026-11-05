/* 职责：Commit 后的认知、技能、风格、决策、回放和团队观测。
 * 调用方在 Commit 时传入最终动作，不在 Evaluate 阶段提前写记录。 */
import { game, _status } from '../../foundation/adapt/host.js';
import { skillProfileOf } from '../skills/skills.js';
import { cfg, safe, keyOf } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { styleOf } from '../../perception/observer/observer.js';
import { recordSkillUse } from '../../perception/feedback/feedback.js';
import { recordStyleOutcome } from '../../perception/feedback/styleFeedback.js';
import { broadcastIntent } from '../../perception/team/teamBroadcast.js';
import { characterPolicySnapshot } from '../strategy/characterPolicy.js';
import { protectScore } from '../../perception/team/team.js';
import { equipValue } from '../cardplay/equipScarcity.js';
import { candidateTargetValue, candidatePolicySnapshot } from '../state/actionCandidate.js';
import { observeElementUse } from '../../perception/feedback/elementFeedback.js';
import { metaRecordSkill } from '../../cognition/metaCognition.js';
import { recordDecisionContext } from '../../model/features/autoFeature.js';
import { round } from '../scoring/scoreLedger.js';
import { recordDecision, _getRoundNumber, _autofeatCtx } from '../records/decisionRecords.js';

export function observeCognitionLog({ me, best, modelConf, metaMod, intervention }) {

/* ★ 认知日志 */
		try {
			if (window.__DJSC.cognitionLog && window.__DJSC.cognitionLog.log) {
				window.__DJSC.cognitionLog.log({
					round: (typeof _status !== 'undefined' && _status.roundNumber) || 0,
					player: (me.name1 || me.name) || '?',
					action: best.type + ':' + best.id,
					model: modelConf,
					meta: metaMod,
					intervention: intervention,
					effective: (window.__DJSC.metaCognition && modelConf && metaMod)
						? window.__DJSC.metaCognition.effective(modelConf, metaMod) : 0,
				});
			}
		} catch (eCL) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eCL); }



}

export function observeSkillFeedback({ me, best }) {

/* ===== 技能反馈：记录本次技能使用的预测收益 ===== */
		try {
			if (best && best.type === "skill" && cfg("skillFeedback", true) !== false) {
				const sid = best.id;
				let predicted = 0;
				try {
					const prof = skillProfileOf(sid);
					if (prof && prof.profit) predicted = prof.profit.originalBase || prof.profit.base || 0;
				} catch (eP) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eP); }
				if (predicted > 0) {
					recordSkillUse(sid, keyOf(me), predicted);
					/* ★ 元素反馈：观察技能使用 */
					try {
						observeElementUse('skill', sid, me, { hpBefore: me.hp || 0 });
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					/* ★ 元认知：记录技能使用 */
					try { metaRecordSkill(sid); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}
			}
		} catch (eFb) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFb); }
		

}

export function observeStyleFeedback({ me }) {

/* ===== 风格反馈：记录本局每个敌人的风格与胜负信号 ===== */
		try {
			if (cfg("styleFeedback", true) !== false) {
				for (const p of (game.players || [])) {
					if (!p || p === me || p.alive === false) continue;
					const s = styleOf(p);
					if (s && s.tag && s.tag !== "unknown") {
						recordStyleOutcome(s.tag, keyOf(p), (round[keyOf(p)] || 0));
					}
				}
			}
		} catch (eSf) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSf); }
		

}

export function observeDecisionRecord({ me, acts, best, bestT, modelConf, characterPolicy, sit, stageLabel, atkMul, keepMul, burstMul, riskLabel, risk, focus, team, teamCombos, seat, econ, incoming, forecast, mt, decisionPlan }) {

/* ===== 记录本次决策（六层信号 + 候选 + 胜出） ===== */
		try {
			const layers = {
				character: characterPolicySnapshot(characterPolicy),
				tempo: { mode: sit.mode, stage: stageLabel, baseTempo: sit.tempo, atkMul: atkMul, keepMul: keepMul, burstMul: burstMul, desc: sit.tempoDesc || sit.desc },
				risk: { label: riskLabel, atk: risk.atk, def: risk.def, safe: risk.safe },
				team: { focus: focus ? focus.name : null, focusScore: focus ? focus.score : 0, protect: team.protect ? team.protect.name : null, protectScore: team.protect ? team.protect.score : 0, comboCount: teamCombos.length },
				seat: { enemyPressure: seat.enemyPressure, nextEnemy: seat.nextEnemy ? (seat.nextEnemy.name || "?") : null, prevEnemy: seat.prevEnemy ? (seat.prevEnemy.name || "?") : null },
				econ: { handCount: econ.handCount, handValue: econ.handValue, equipCount: econ.equipCount, equipValue: econ.equipValue, hp: econ.hp, maxHp: econ.maxHp, hpRatio: econ.hpRatio, totalValue: econ.totalValue, stripPressure: econ.strip ? econ.strip.pressure : 0 },
				style: { target: bestT ? (bestT.name || "?") : null, tag: (function () { try { return bestT ? styleOf(bestT).tag : null; } catch (e) { return null; } })() },
				forecast: {
					incomingTotal: incoming.total,
					selfRisk: incoming.selfRisk,
					killRisk: incoming.killRisk,
					topEnemy: (incoming.byEnemy && incoming.byEnemy[0]) ? incoming.byEnemy[0].name : null,
					teamRisk: forecast.team.map(function (t) { return t.name + "(" + t.risk + ")"; }).slice(0, 3),
					advice: forecast.advice,
				},
				multiturn: {
					overall: mt ? mt.overall : "stable",
					r1: mt && mt.r1 ? mt.r1.trend : null,
					r3: mt && mt.r3 ? mt.r3.trend : null,
					advice: mt ? mt.advice : "",
				},
			};
			/* ★ 复用本次 bestAction 已计算的 decisionPlan；观测层不得再次触发 Planner。 */
			try {
				if (decisionPlan && decisionPlan.best) {
					layers.plan = {
						isKill: decisionPlan.isKill || false,
						total: decisionPlan.best.total,
						futureScore: decisionPlan.best.futureScore || 0,
						steps: (decisionPlan.best.steps || []).map(function (s) { return s.id || s; }).slice(0, 3),
						alternatives: (decisionPlan.alternatives || []).map(function (alt) {
							return { id: alt.action && alt.action.id, total: alt.total };
						}).slice(0, 2),
					};
				}
			} catch (ePlan) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePlan); }
			recordDecision(me, layers, acts, best, modelConf);
			/* ★ 决策对比模式：记录本局面各档案的选择，供对比面板统计 */
			try {
				if (window.__DJSC && window.__DJSC.compare && window.__DJSC.compare.record) {
					window.__DJSC.compare.record(me, acts, best);
				}
			} catch (eComp) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eComp); }
		} catch (eRec) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRec); }
		

}

export function observeDecisionReplay({ me, acts, best, modelConf, metaMod, intervention }) {

/* ★ 决策回放时间轴 + 自动特征发现：独立 try 包裹，绝不因上面 layers/plan 构建异常而被连坐跳过。
		 * 此前放在大 try 内，任一步抛错即整体丢失，面板恒 0。 */
		try {
			if (window.__DJSC && window.__DJSC.replay && window.__DJSC.replay.record) {
				window.__DJSC.replay.record({
					player: (me.name1 || me.name) || '?',
					round: _getRoundNumber(),
					me: me,
					state: { hp: me.hp, maxHp: me.maxHp },
					candidates: (acts || []).slice(0, 6),
					rule: best.type === 'card' || best.type === 'skill' ? { type: best.type, id: best.id, score: best.score, target: candidateTargetValue(best), reason: best.reason || '', policy: candidatePolicySnapshot(best) } : null,
					model: modelConf ? { label: modelConf.label, confidence: modelConf.maxProb !== undefined ? modelConf.maxProb : (modelConf.confidence !== undefined ? modelConf.confidence : 0) } : null,
					meta: metaMod ? { familiarity: metaMod.familiarity, modulator: metaMod.modulator, level: metaMod.level } : null,
					bus: { winner: best.type + ':' + best.id, reason: (best.reason || '').slice(0, 60) },
					final: { type: best.type, id: best.id, score: best.score, target: candidateTargetValue(best), reason: best.reason || '', policy: candidatePolicySnapshot(best) },
					intervention: intervention || 'none',
				});
			}
		} catch (eRep) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRep); }
		

}

export function observeAutoFeature({ me, best, bestT }) {

/* ★ 自动特征发现：把本步决策的场景组合喂给 autoFeature（此前只有挂载无调用，总样本恒 0）。 */
		try {
			recordDecisionContext(_autofeatCtx(me, best, bestT));
		} catch (eAF) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eAF); }
		

}

export function observeTeamBroadcast({ me, best, bestT }) {

/* ★ 广播：告诉队友我打谁 */
		try {
			if (bestT && (best.type === 'card' || best.type === 'skill')) {
				const id = best.id || '';
				const ATK = ['sha','juedou','huogong','nanman','wanjian','zhujin','shunshou','guohe','tiesuo','lebu','bingliang'];
				if (ATK.indexOf(id) >= 0) {
					broadcastIntent(me, bestT.name1 || bestT.name, id, best.score);
				}
			}
		} catch (eB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eB); }


}
