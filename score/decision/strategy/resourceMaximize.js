/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.4.0
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 单英雄资源最大化 + 损失最小化（ResourceMaximize） =================
 * 需求：② 每个英雄整合手上【全部资源】——手牌 + 装备 + 体力 + 判定区 + 技能强度，
 *        1) 最大化：输出"明确的目标线路"（斩杀 / 解延时 / 回血），而不是一个模糊的整数 lean；
 *        2) 损失最小化：识别最大的潜在损失诱因（自身乐/兵/闪电、低血被斩、手牌低空手），
 *           给"规避/保命"动作加分、给"冒险/自曝"动作减分。
 *
 * 最大化明确性：resourceMaximize 产出 goals[]（带清晰的目标/动作/期望分），并按优先级给
 * engine 的每个动作做"确定性"加分（命中目标线路才加，方向相反不动），杜绝模糊加权。
 * 纯计算模块；两个加分函数由 engine 调用。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { resourceBalance } from '../resource/economy.js';
import { skillProfileOf } from '../skills/skills.js';
import { dispositionOf, actionValue } from '../relations/relations.js';

/* 分类表（语义明确） */
const ATK_LIST = ["sha","juedou","huogong","nanman","wanjian","lijian","fanjian","sidian","huosha","leisha","zhujin"];
const BREAK_LIST = ["shunshou","guohe"];        /* 拆/抢：可解自己或他人的判定/装备 */
const DELAY_LIST = ["lebu","bingliang","shandian"];  /* 延时锦囊（判定区） */
const DEF_LIST = ["shan","tao","jiu","wuxie"];

function num(v, dflt) { try { const n = Number(v); return isFinite(n) ? n : dflt; } catch (e) { return dflt; } }
function skillsOf(p) { try { return Array.isArray(p.skills) ? p.skills.filter(function (s) { return typeof s === 'string'; }) : []; } catch (e) { return []; } }
function pname(p) { try { return (p && (p.name1 || p.name || '?') || '?'); } catch (e) { return '?'; } }

/* 构建候选目标：优先用 ctx.targets（engine 传入），否则自建（遍历玩家 + 敌我判定），
 * 避免依赖 engine 具体作用域里的局部变量名。 */
function buildCandidates(me, ctx) {
	try {
		const arr = (ctx && ctx.targets) || [];
		if (arr && arr.length) return arr;
		const out = [];
		(game.players || []).forEach(function (p) {
			if (!p || p === me || p.alive === false) return;
			/* relations 敌我约定：d<0=敌、d>0=友、d=0=中性。
			 * 斩杀候选只取真敌(d<0)；真友与身份未明(0)一律不列入，避免盲杀队友/盲目打未明目标，
			 * 与 identity/disposition 口径完全一致。 */
			if (dispositionOf(me, p) >= 0) return;
			out.push({
				pp: p, name: pname(p), hp: num(p.hp, 3),
				alive: p.alive !== false, threat: Math.max(0, 3 - num(p.hp, 3)),
			});
		});
		return out;
	} catch (e) { return []; }
}

function handBy(me) {
	try { return (me.getCards('h') || []).map(function (c) { return c && c.name || ''; }).filter(Boolean); } catch (e) { return []; }
}

/* 延时判定区负债 */
function judgeDebt(me) {
	try {
		const names = [];
		(me.getCards('j') || []).forEach(function (c) { if (c && c.name) names.push(c.name); });
		let debt = 0;
		if (names.indexOf('lebu') >= 0) debt += 2.0;
		if (names.indexOf('bingliang') >= 0) debt += 1.2;
		if (names.indexOf('shandian') >= 0) debt += 1.5;
		return { names, debt: Math.round(debt * 100) / 100 };
	} catch (e) { return { names: [], debt: 0 }; }
}

/* 手牌进攻密度 / 连招潜力 */
function attackHand(me) {
	try {
		const h = handBy(me);
		let atk = 0, def = 0;
		h.forEach(function (n) { if (ATK_LIST.indexOf(n) >= 0) atk++; if (DEF_LIST.indexOf(n) >= 0) def++; });
		const sp = h.length > 0 ? atk / h.length : 0;
		const combo = (atk >= 2 && sp >= 0.5) || (atk >= 1 && h.indexOf('wuxie') >= 0 && sp >= 0.5);
		return { attackCount: atk, defendCount: def, total: h.length, atkRatio: Math.round(sp * 100) / 100, comboPotential: combo };
	} catch (e) { return { attackCount: 0, defendCount: 0, total: 0, atkRatio: 0, comboPotential: false }; }
}

/* 技能攻防强度 */
function skillPower(me) {
	try {
		let attack = 0, defense = 0, burst = 0;
		skillsOf(me).forEach(function (sid) {
			try {
				const prof = skillProfileOf(sid);
				if (!prof || !prof.tags) return;
				const t = prof.tags;
				attack += num(t.atk, 0) + num(t.aoe, 0) * 1.5 + num(t.ctrl, 0) * 0.6;
				defense += num(t.def, 0) + num(t.sustain, 0) * 1.2;
				burst += num(t.burst, 0) + num(t.awaken, 0) * 1.2;
			} catch (eS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eS); }
		});
		return { attack: Math.round(attack * 10) / 10, defense: Math.round(defense * 10) / 10, burst: Math.round(burst * 10) / 10 };
	} catch (e) { return { attack: 0, defense: 0, burst: 0 }; }
}

/* ================= 主入口（最大化）：产出明确目标线路 ================= */
export function resourceMaximize(me, ctx) {
	try {
		if (!me) return null;
		ctx = ctx || {};
		const bal = resourceBalance(me);
		const judge = judgeDebt(me);
		const ah = attackHand(me);
		const pw = skillPower(me);
		const h = handBy(me);
		const enemies = buildCandidates(me, ctx);
		/* 斩杀候选：低血且存活 */
		let killTarget = null;
		enemies.forEach(function (t) {
			if (t.hp === undefined || t.hp > 1 || t.alive === false) return;
			if (!killTarget || (t.threat || 0) > (killTarget.threat || 0)) killTarget = t;
		});

		const goals = [];
		const hasBreakSelf = BREAK_LIST.some(function (n) { return h.indexOf(n) >= 0; });

		/* G1 斩杀：有可斩杀的 1 血敌人，且我有攻击牌或爆发技能 */
		if (killTarget && (ah.attackCount > 0 || pw.burst > 0)) {
			goals.push({
				type: 'kill', score: 10,
				targetName: pname(killTarget.pp || killTarget),
				hint: '斩杀 ' + pname(killTarget.pp || killTarget) + '（1 血，威胁 ' + num(killTarget.threat, 0) + '）',
				actions: ATK_LIST, targetSelf: false,
			});
		}
		/* G2 解自雷：自身判定区有乐/兵/闪电，且我有顺/拆可解 */
		const riskySelf = judge.names.indexOf('lebu') >= 0 || judge.names.indexOf('shandian') >= 0 || judge.names.indexOf('bingliang') >= 0;
		if (riskySelf && hasBreakSelf) {
			goals.push({
				type: 'breakDelay', score: 9,
				targetName: pname(me), hint: '拆除自身 ' + judge.names.join('/') + '，避免空过/受伤',
				actions: BREAK_LIST, targetSelf: true,
			});
		}
		/* G3 回血保命：低血（<=1）且有桃/酒或回复技能 */
		const hasHeal = DEF_LIST.some(function (n) { return (n === 'tao' || n === 'jiu') && h.indexOf(n) >= 0; });
		if (me.hp <= 1 && (hasHeal || pw.defense > 0)) {
			goals.push({
				type: 'heal', score: 7,
				targetName: pname(me), hint: '自己低血，优先回血保命',
				actions: ['tao', 'jiu'], targetSelf: true,
			});
		}
		/* G4 爆发连招：资源足且有 combo 潜力并已排除必打斩杀/G2 时 */
		if (ah.comboPotential && ah.attackCount >= 2 && goals.length === 0) {
			goals.push({
				type: 'burst', score: 5,
				targetName: killTarget ? pname(killTarget.pp || killTarget) : '',
				hint: '手牌连招潜力高，尝试打出爆发',
				actions: ATK_LIST, targetSelf: false,
			});
		}
		goals.sort(function (a, b) { return b.score - a.score; });
		const topLine = goals[0] || null;

		return {
			balance: bal,
			judge,
			hand: ah,
			power: pw,
			goals,
			topLine,
			topGoalName: topLine ? topLine.type : 'none',
		};
	} catch (e) { return null; }
}

/* ================= 决策加分（最大化）：以实际收益（actionValue）为准，不按动作 ID 机械触发 =================
 * 原则：不"看到某牌/某动作就加固定分"。每个候选动作用 relations.actionValue 估出它对目标线路的
 * 实际收益；只有该动作命中目标线路【且】实际收益为正时才加分，且幅度与实际收益绑定（正收益越高加越多，
 * 无收益/负收益一律不动，负向由方向守卫负责罚）。 */
export function applyResourceMaximizeBonus(me, acts, ctx) {
	try {
		if (!me || !Array.isArray(acts) || !acts.length) return;
		const rm = resourceMaximize(me, ctx);
		if (!rm || !rm.topLine) return;
		const tl = rm.topLine;
		const meName = pname(me);
		const fav = tl.type === 'kill' ? 1.2 : (tl.type === 'breakDelay' ? 1.0 : (tl.type === 'heal' ? 0.8 : 0.5));

		acts.forEach(function (a) {
			try {
				if (!a) return;
				const aTgt = a.target;
				/* 目标匹配：杀指向该敌，解/回血指向自己 */
				const tgtOk = tl.targetSelf
					? (aTgt === meName || aTgt === me.name || aTgt === me.name1)
					: (aTgt === tl.targetName);
				if (!tgtOk) return;
				const valAct = { id: a.id, type: a.type, base: 0, purpose: a.purpose, target: tl.targetSelf ? meName : aTgt };
				const val = actionValue(me, valAct);          /* 实际收益：含敌我/血量/目的 */
				if (val <= 0) return;                          /* 无实际正收益 → 绝不触发 */
				const bonus = Math.min(1.4, val * 0.5 + fav * 0.2);
				a.score = (a.score || 0) + bonus;
				a.reason = (a.reason || '') + '（[最大化]实际收益+' + Math.round(val * 10) / 10 + '，执行' + tl.type + '：' + tl.hint + '）';
			} catch (ea) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ea); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 损失最小化（MinMax）：识别最大损失诱因 ================= */
export function lossMinimize(me, ctx) {
	try {
		if (!me) return null;
		ctx = ctx || {};
		const judge = judgeDebt(me);
		const h = handBy(me);
		const bal = resourceBalance(me);
		const risks = [];

		/* R1 低血 + 有防御牌 → 保留 shan/tao 防斩杀，别当废牌打掉 */
		if (me.hp <= 1 && DEF_LIST.some(function (n) { return h.indexOf(n) >= 0; })) {
			risks.push({ type: 'retainDef', severity: 1.6, hint: '低血且持有闪/桃，保留防御牌防被斩' });
		}
		/* R2 手牌极少 → 避免空手暴露（被乐/被弃/无防御） */
		if (h.length > 0 && h.length <= 2) {
			risks.push({ type: 'handPoverty', severity: 1.0, hint: '手牌仅' + h.length + '张，尽量避免无备出尽' });
		}
		/* R3 判定区有雷且手头无顺拆 → 评估结算风险 */
		if (judge.names.length && !BREAK_LIST.some(function (n) { return h.indexOf(n) >= 0; })) {
			risks.push({ type: 'uncounteredDelay', severity: judge.debt * 0.6, hint: '判定区有 ' + judge.names.join('/') + ' 且无顺/拆可解' });
		}
		risks.sort(function (a, b) { return b.severity - a.severity; });
		const topRisk = risks[0] || null;
		return { risks, topRisk };
	} catch (e) { return null; }
}

/* ================= 决策加分（损失最小化）：以实际效果为准，不按动作 ID 机械触发 =================
 * 原则：不"看到闪/桃给敌就减分"。只有两种情况才干预：
 *  1) 回血止损：确实掉血/濒危、且桃酒作用自身实际能回血 → 加分（无收益不减）；
 *  2) 低血且仅剩唯一防御牌、且这次用几乎没有实际收益（actionValue<=0）→ 确认是无谓消耗才减分；
 *     若还有富余防御牌或该牌出手有实际用途(如挡必死/解危)则不动。 */
export function applyLossMinimizeBonus(me, acts, ctx) {
	try {
		if (!me || !Array.isArray(acts) || !acts.length) return;
		const lm = lossMinimize(me, ctx);
		if (!lm || !lm.topRisk) return;
		const tr = lm.topRisk;
		const meName = pname(me);
		const h = handBy(me);
		const defCount = h.filter(function (n) { return DEF_LIST.indexOf(n) >= 0; }).length;

		acts.forEach(function (a) {
			try {
				if (!a) return;
				/* 1) 回血止损：仅当确实掉血可回才加 */
				if (a.type === 'card' && (a.id === 'tao' || a.id === 'jiu')
					&& (a.target === meName || a.target === me.name || a.target === me.name1)) {
					if (me.hp !== undefined && me.hp <= 1) {
						a.score = (a.score || 0) + 0.7;
						a.reason = (a.reason || '') + '（[损失最小化]改为实际回血止损 HP=' + me.hp + '）';
					}
					return; /* ★ 修复：此处位于 forEach 回调内，非循环体，continue 非法导致扩展加载失败；改为 return */
				}
				/* 2) 低血且仅剩唯一防守牌、且该出手无实际收益 → 才是无谓消耗 */
				if (tr.type === 'retainDef' && defCount <= 1 && DEF_LIST.indexOf(a.id) >= 0
					&& !(a.target === meName || a.target === me.name || a.target === me.name1)) {
					const valAct = { id: a.id, type: a.type, base: 0, purpose: a.purpose, target: a.target };
					const val = actionValue(me, valAct);
					if (val <= 0) {
						a.score = (a.score || 0) - 0.5;
						a.reason = (a.reason || '') + '（[损失最小化]低血且为唯一闪/桃，此手无实际收益，勿浪费）';
					}
				}
			} catch (ea) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ea); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}