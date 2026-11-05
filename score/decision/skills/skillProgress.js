/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 阵营技能进度情报（SkillProgress） =================
 * 需求：① 每个阵营共享彼此技能的"进度信息"（觉醒条件达成度 / 限定技使用状态 /
 *        计数类技能进度 / 能力供需提示），让团队知道"护谁、扶谁、压谁"。
 *
 * 设计：本模块只做"尽力而为"的读取 + 防御性判定，绝不因读不到宿主内部字段而瞎猜。
 *  - 能读到的（血量 / 手牌 / 标记 / 技能定义源码）→ 计算达成度；
 *  - 读不到的 → 标 known=false / confidence 低，不产生加分。
 * 纯计算模块：只 import 宿主读取 API 与 relations / skills 的只读函数。
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { dispositionOf } from '../../decision/relations/relations.js';
import { skillProfileOf } from './skills.js';

/* 攻击类牌（与 engine 的 ATK_IDS 对齐；用于"勿消耗近觉醒核心"方向判定） */
const ATK_IDS = ["sha","juedou","huogong","nanman","wanjian","jiedao","lijian","fanjian","sidian","huosha","leisha","zhujin","shunshou","guohe","lebu","bingliang","tiesuo"];

/* ================= 工具：数值读取（全部防御） ================= */
function num(v, dflt) {
	try { const n = Number(v); return isFinite(n) ? n : dflt; } catch (e) { return dflt; }
}
function handCountOf(p) {
	try { return num(p.countCards ? p.countCards('h') : 0, 0); } catch (e) { return 0; }
}
function hpOf(p) {
	try { return num(p.hp, 3); } catch (e) { return 3; }
}
function maxHpOf(p) {
	try { return num(p.maxHp, 3); } catch (e) { return 3; }
}
function skillsOf(p) {
	try { return Array.isArray(p.skills) ? p.skills.filter(function (s) { return typeof s === 'string'; }) : []; } catch (e) { return []; }
}

/* ================= 觉醒条件解析 =================
 * 从觉醒技 condition 源码里抽出血量/手牌/标记的上限或下限阈值，
 * 用当前值比较，算出"已满足子条件数 / 总子条件数" → 达成度 0~1。
 * 解析不到任何规则 → 返回沉浸式 unknown（不在决策里硬下结论）。
 */
function parseAwakenRules(p, src) {
	const rules = [];
	if (!src) return rules;
	/* 血量上限：me.hp <= N / me.hp < N / me.hp === N */
	let m;
	const hpRe = /me\.hp\s*(<=|<|=|===|>=|>)\s*(\d+)/g;
	while ((m = hpRe.exec(src))) {
		rules.push({ type: 'hp', op: m[1], val: num(m[2], 0) });
	}
	/* 体力上限：me.maxHp 类似 */
	const mhpRe = /me\.maxHp\s*(<=|<|=|===|>=|>)\s*(\d+)/g;
	while ((m = mhpRe.exec(src))) {
		rules.push({ type: 'maxHp', op: m[1], val: num(m[2], 0) });
	}
	/* 手牌数：me.countCards('h') op N 或 me.countCards("h") >= N */
	const handRe = /countCards\(\s*['"]h['"]\s*\)\s*(<=|<|=|===|>=|>)\s*(\d+)/g;
	while ((m = handRe.exec(src))) {
		rules.push({ type: 'hand', op: m[1], val: num(m[2], 0) });
	}
	/* 标记：countMark('xx') >= N */
	const markRe = /countMark\(\s*['"]([^'"]+)['"]\s*\)\s*(<=|<|=|===|>=|>)\s*(\d+)/g;
	while ((m = markRe.exec(src))) {
		rules.push({ type: 'mark', mark: m[1], op: m[2], val: num(m[3], 0) });
	}
	return rules;
}

function currentValueOf(p, rule) {
	if (rule.type === 'hp') return hpOf(p);
	if (rule.type === 'maxHp') return maxHpOf(p);
	if (rule.type === 'hand') return handCountOf(p);
	if (rule.type === 'mark') {
		try { if (typeof p.countMark === 'function') return num(p.countMark(rule.mark), 0); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return null;   /* 读不到标记 → 不可判（避免误当"未达成"） */
	}
	return 0;
}

function ruleSatisfied(cur, op, val) {
	switch (op) {
		case '<': return cur < val;
		case '<=': return cur <= val;
		case '>': return cur > val;
		case '>=': return cur >= val;
		case '=': case '===': case '==': return cur === val;
		default: return false;
	}
}

/* 逐个玩家：一个技能的觉醒达成度 */
function awakenProgressOf(p, sid, sk) {
	try {
		/* 提取 condition/filter 的函数源码做条件解析 */
		let fnSrc = '';
		if (sk && typeof sk.condition === 'function') fnSrc = String(sk.condition);
		else if (sk && typeof sk.filter === 'function') fnSrc = String(sk.filter);
		if (!fnSrc) return { known: false, reach: 0.5, confidence: 0 };

		const rules = parseAwakenRules(p, fnSrc);
		if (!rules.length) return { known: false, reach: 0.5, confidence: 0 };

		/* 只统计"可读取"的子条件；全部不可读 → 未知（不参与加分） */
		let sat = 0, sub = 0;
		rules.forEach(function (r) {
			const cur = currentValueOf(p, r);
			if (cur === null) return;
			sub++;
			if (ruleSatisfied(cur, r.op, r.val)) sat++;
		});
		if (!sub) return { known: false, reach: 0.5, confidence: 0 };
		const total = sub;
		return {
			known: true,
			reach: Math.round((sat / total) * 100) / 100,
			satisfiedCount: sat,
			totalCount: total,
			confidence: 0.6 + (sat / total) * 0.4,
			rules: rules.map(function (r) {
				const cur = currentValueOf(p, r);
				return r.type + '=' + (cur === null ? '?' : cur) + ' ' + r.op + ' ' + r.val;
			}),
		};
	} catch (e) { return { known: false, reach: 0.5, confidence: 0 }; }
}

/* 限定技是否已用：防御性读取常见宿主字段 */
function limitUsedOf(p, sid, sk) {
	try {
		const isLimit = !!(sk && (sk.limit === true || sk.limited === true));
		if (!isLimit) return { isLimit: false, used: false, known: true };
		/* 常见宿主存法：storage[sid+'_used'] / storage[sid] === true */
		if (p.storage) {
			if (p.storage[sid + '_used'] === true) return { isLimit: true, used: true, known: true };
			if (p.storage[sid] === true || p.storage[sid] === 'used') return { isLimit: true, used: true, known: true };
			if (p.storage[sid + '_times'] === 0) return { isLimit: true, used: true, known: true };
			if (typeof p.storage[sid] === 'number' && p.storage[sid] <= 0) return { isLimit: true, used: true, known: true };
		}
		return { isLimit: true, used: false, known: false };
	} catch (e) { return { isLimit: false, used: false, known: false }; }
}

/* 计数类技能进度：读取数值型 storage 或标记 */
function countProgressOf(p, sid, sk) {
	try {
		let raw = null;
		if (p.storage && typeof p.storage[sid] === 'number') raw = p.storage[sid];
		else if (p.storage && typeof p.storage[sid + '_count'] === 'number') raw = p.storage[sid + '_count'];
		if (raw === null || typeof raw !== 'number') return { known: false, count: 0 };
		return { known: true, count: raw };
	} catch (e) { return { known: false, count: 0 }; }
}

/* 能力供需：从技能 profile 推断该玩家当前"能做什么"
 * 静态能力 = 技能强度标签（回血/摸牌/爆发/防御/AOE），
 * 供团队判断"该把资源喂给谁 / 谁能发动爆发" */
function abilitiesOf(p) {
	const out = { sustain: 0, draw: 0, burst: 0, def: 0, aoe: 0, awaken: 0 };
	skillsOf(p).forEach(function (sid) {
		try {
			const prof = skillProfileOf(sid);
			if (!prof || !prof.tags) return;
			const t = prof.tags;
			out.sustain += num(t.sustain, 0);
			out.draw += num(t.draw, 0);
			out.burst += num(t.burst, 0);
			out.def += num(t.def, 0);
			out.aoe += num(t.aoe, 0);
			out.awaken += num(t.awaken, 0);
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	});
	Object.keys(out).forEach(function (k) { out[k] = Math.round(out[k] * 10) / 10; });
	return out;
}

/* ================= 主入口：单个玩家技能进度 ================= */
export function skillProgressOf(me, p) {
	try {
		if (!p || !p.skills) return { known: false, awaken: [], status: [], abilities: abilitiesOf(p) };
		const awaken = [];
		const status = [];
		let keyNeed = null;
		skillsOf(p).forEach(function (sid) {
			const sk = lib.skill && lib.skill[sid];
			const prof = skillProfileOf(sid);
			const t = prof && prof.tags;
			if (t && (t.awaken > 0.5 || t.limit > 0) && (t.awaken > 0.5 || sk.limit === true)) {
				const aw = awakenProgressOf(p, sid, sk);
				awaken.push({ sid, known: aw.known, reach: aw.reach, confidence: aw.confidence });
				if (aw.known && aw.reach > 0 && (!keyNeed || aw.reach > keyNeed.reach)) {
					keyNeed = { sid: sid, reach: aw.reach };
				}
				return;
			}
			/* 非觉醒：记录限定技使用状态 / 计数类进度 */
			if (t && t.limit > 0.5) {
				status.push({ sid, kind: 'limit', ...limitUsedOf(p, sid, sk) });
			} else if (t && (t.judge > 0 || t.costHp > 0 || t.loseCard > 0)) {
				status.push({ sid, kind: 'count', ...countProgressOf(p, sid, sk) });
			}
		});
		if (keyNeed && keyNeed.reach >= 1) {
			/* 已达觉醒则不再作为待扶持核心（避免已觉醒还当未觉醒护） */
			keyNeed = null;
		}
		return {
			known: true,
			hp: hpOf(p),
			hand: handCountOf(p),
			awaken,
			status,
			keyAwaken: keyNeed,
			abilities: abilitiesOf(p),
		};
	} catch (e) { return { known: false, awaken: [], status: [], abilities: abilitiesOf(p) }; }
}

/* ================= 阵营聚合：同阵营所有队友的进度 ================= */
export function campSkillProgress(me) {
	try {
		const list = [];
		for (const p of (game.players || [])) {
			if (!p || p === me || p.alive === false) continue;
			const disp = dispositionOf(me, p);
			if (disp <= 0) continue;   /* 只共享"我方"（友 or 中性不排除？：保守只取 友+中性可观察。此处只取非敌） */
			const prog = skillProgressOf(me, p);
			list.push({ player: p, name: (p.name || p.name1 || '?'), disposition: disp, progress: prog });
		}
		return list;
	} catch (e) { return []; }
}

/* ================= 决策加分：扶持近觉醒核心 =================
 * 阵营共享觉醒进度后：对"我方近觉醒核心"的队友——
 *  - 打它/耗它 → 减分（别刚把核心弄下去/废掉觉醒窗口）
 *  - 对它做辅助/救援/增益 → 加分（集中资源护核心、喂牌助觉醒）
 * 谨慎：只对 reach 高(>=0.66)且已知的觉醒核心生效，幅度克制。
 */
export function applyCampSkillProgressBonus(me, acts) {
	try {
		if (!me || !Array.isArray(acts) || !acts.length) return;
		const list = campSkillProgress(me);
		let core = null;
		list.forEach(function (c) {
			const ka = c.progress && c.progress.keyAwaken;
			if (!ka || !ka.reach) return;
			if (!core || ka.reach > core.reach) {
				core = { name: c.name, reach: ka.reach, progress: c.progress };
			}
		});
		if (!core || core.reach < 0.66 || core.reach <= 0) return;

		acts.forEach(function (a) {
			try {
				if (!a || !a.target) return;
				if (a.target !== core.name) return;
				const isAttack = ATK_IDS.indexOf(a.id) >= 0
					|| (a.type === 'skill' && a.purpose === 'attack');
				if (isAttack) {
					a.score = (a.score || 0) - 1.0;
					a.reason = (a.reason || '') + '（[队伍]勿消耗近觉醒核心' + core.name + ' re:' + Math.round(core.reach * 100) + '%）';
				} else {
					a.score = (a.score || 0) + 0.8;
					a.reason = (a.reason || '') + '（[队伍]集中资源扶近觉醒核心' + core.name + ' re:' + Math.round(core.reach * 100) + '%）';
				}
			} catch (ea) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ea); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}