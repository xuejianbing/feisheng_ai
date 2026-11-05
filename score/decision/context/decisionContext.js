/* 职责：汇总单次主动决策的性格、团队、资源、预测及原有权重。
 * 原分析函数和缓存由调用方提供；不创建第二份缓存、不触发执行或训练。 */
import { detectCombo } from '../skills/skills.js';
import { situationFactor, maxBurstThreat } from '../threat/threat.js';
import { chooseStrategy } from '../strategy/strategy.js';
export function buildDecisionContext(me, analyzers) {
const { analyzePersonality, analyzeTeamPlan, analyzeSeatPressure, analyzeEconomy, analyzeForecast, multiTurnCached } = analyzers;
		/* ===== 调用拆分的子模块 ===== */
		const P = analyzePersonality(me);
		const team = analyzeTeamPlan(me);
		const seat = analyzeSeatPressure(me);
		const econ = analyzeEconomy(me);
		const forecast = analyzeForecast(me);

		/* ===== 策略模式：根据情况选择攻击/防御/辅助策略 ===== */
		let currentStrategy = { type: 'balanced', value: 1.0 };
		try {
			const strategy = chooseStrategy(me);
			currentStrategy = strategy;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		const sit = situationFactor(me);
		const riskLabel = P.label;
		const risk = P.risk;
		const riskTaking = P.riskTaking;
		const teamwork   = P.teamwork;

		/* ===== AI 协作分工（角色） ===== */
		const ALLY_ROLE = P.allyRole;
		const ROLE_PREFS = ALLY_ROLE ? ({
			attack:  { atk: 1.35, skill: { atk: 1.4, def: 0.7, aux: 0.7, ctrl: 0.9, draw: 1.0 }, cardAtk: 1.3, cardDef: 0.8 },
			aux:     { atk: 0.75, skill: { atk: 0.7, def: 1.2, aux: 1.5, ctrl: 0.9, draw: 1.2 }, cardAtk: 0.8, cardDef: 1.3 },
			control: { atk: 1.0,  skill: { atk: 0.9, def: 1.0, aux: 1.0, ctrl: 1.5, draw: 1.1 }, cardAtk: 1.0, cardDef: 1.0 },
			defense: { atk: 0.7,  skill: { atk: 0.6, def: 1.5, aux: 1.2, ctrl: 0.9, draw: 1.0 }, cardAtk: 0.7, cardDef: 1.4 },
			balanced:{ atk: 1.0,  skill: { atk: 1.0, def: 1.0, aux: 1.0, ctrl: 1.0, draw: 1.0 }, cardAtk: 1.0, cardDef: 1.0 },
		})[ALLY_ROLE] : null;

		/* ===== 策略乘数：根据当前策略调整攻击/防御权重 ===== */
		let strategyAtkMul = 1.0;
		let strategyDefMul = 1.0;
		if (currentStrategy.type === 'attack') {
			strategyAtkMul = 1.2;
			strategyDefMul = 0.9;
		} else if (currentStrategy.type === 'defense') {
			strategyAtkMul = 0.8;
			strategyDefMul = 1.3;
		}

		const atkMul = (sit.atkMul || 1) * strategyAtkMul;
		const keepMul = (sit.keepMul || 1) * strategyDefMul;
		const burstMul = sit.burstMul || 1;
		const stageLabel = sit.stage || "mid";
		const ATK_CARDS = ["sha", "juedou", "huogong", "nanman", "wanjian", "zhujin", "shunshou", "guohe", "tiesuo", "lebu", "bingliang"];
		const DEF_CARDS = ["shan", "tao", "wuxie", "jiu"];
		const hand = [];
		try { me.getCards("h").forEach(function (c) { hand.push(c.name || ""); }); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const combos = detectCombo(me);

		const teamCombos = team.combos;
		const focus = team.focus;

		const SEAT_TARGET_CARDS = ["lebu", "bingliang"];
		/* ===== 下回合预测（先见之明）+ 多回合趋势 ===== */
		const incoming = forecast.incoming;
		/* ===== 敌方爆发威胁（连弩 + 多杀）===== */
		const burst = maxBurstThreat(me);
		const mt = multiTurnCached(me);
return { P, team, seat, econ, forecast, currentStrategy, sit, riskLabel, risk, riskTaking, teamwork, ALLY_ROLE, ROLE_PREFS, strategyAtkMul, strategyDefMul, atkMul, keepMul, burstMul, stageLabel, ATK_CARDS, DEF_CARDS, hand, combos, teamCombos, focus, SEAT_TARGET_CARDS, incoming, burst, mt };
}
