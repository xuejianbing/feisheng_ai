/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 铁索连环 Evaluator · 唯一权威策略源 =================
 * 指令 02：铁索连环状态规划与重铸决策。
 *
 * 设计模型（方案 §4）：
 *   S  = { p | isPlayerLinked(p) }               当前横置集合
 *   T  = 目标集合（1~2 人）
 *   S' = S △ T                                   toggle（对称差）
 *   ΔU = U(S') - U(S)                            该动作的净状态收益
 *   UseThreshold = RecastValue + UseMargin
 *   bestUse = argmax{ ΔU(T1), ΔU(T2), ... }
 *   若可重铸：bestUse 只有达到 UseThreshold 才允许使用，否则重铸
 *
 * 本文件对全局横置集合做「最多两次 toggle」的局面状态优化，
 * 而不是「一张能选两个敌人的普通锦囊」。
 *
 * 关键约束：
 *   - 纯模拟：绝不修改真实 Player，绝不调用 link()；
 *   - 候选 = RECAST + 所有合法单目标 + 所有合法双目标；
 *   - 允许单目标、允许只解除队友、允许 [解除队友 + 链敌人]；
 *   - 已横置敌人再次被选 = 解链敌人（负收益，不得因「敌人」标签加分）；
 *   - 不得用 top1/top2 近似代替 pair 组合评估。
 */
import { isPlayerLinked } from '../state/playerState.js';
import { dispositionOf } from '../relations/relations.js';   /* ★ 统一敌我系统单一权威源 */
import { _status } from '../../foundation/adapt/host.js';   /* 仅用于轻量诊断落点 */

function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') {
			window.__DJSC.swallow(e);
		}
	} catch (_) { /* swallow 自身失败时不再递归 */ }
}

/* ================= 10.1 纯状态模拟（Task 2） ================= */

/**
 * 读取当前全局横置集合。纯读取，不修改任何 Player。
 * @param {Array} players
 * @returns {Set}
 */
export function getCurrentLinkedSet(players) {
	const s = new Set();
	try {
		(players || []).forEach(function (p) {
			if (!p) return;
			if (isPlayerLinked(p)) s.add(p);
		});
	} catch (e) { _swallow(e); }
	return s;
}

/**
 * 对目标集合做对称差翻转：已横置 → 解除，未横置 → 横置。
 * 纯函数：返回新的 Set，绝不修改 beforeSet，也绝不触碰真实 Player。
 * @param {Set} beforeSet
 * @param {Array} targets
 * @returns {Set}
 */
export function toggleLinkedSet(beforeSet, targets) {
	const after = new Set(beforeSet || []);
	try {
		(targets || []).forEach(function (t) {
			if (!t) return;
			if (after.has(t)) after.delete(t);
			else after.add(t);
		});
	} catch (e) { _swallow(e); }
	return after;
}

/* ================= 10.2 动作枚举（Task 3） ================= */

/* 去重 + 过滤空目标；不修改输入数组 */
function _dedupeTargets(candidates) {
	const out = [];
	const seen = new Set();
	(candidates || []).forEach(function (t) {
		if (!t || seen.has(t)) return;
		seen.add(t);
		out.push(t);
	});
	return out;
}

function _mkAction(type, targets, beforeLinked) {
	return {
		type: type,                                        /* 'recast' | 'use' */
		targets: targets,                                  /* Player[] */
		beforeLinked: beforeLinked,
		afterLinked: type === 'recast'
			? new Set(beforeLinked)
			: toggleLinkedSet(beforeLinked, targets),
		score: 0,
		delta: 0,
		reason: '',
	};
}

/**
 * 生成全部合法铁索动作。
 * @param {*} player 施法者（仅作上下文，不修改）
 * @param {*} card   铁索牌对象
 * @param {Array} candidates 宿主规则允许的目标（已过 filterTarget/selectTarget）
 * @param {Object} [context] { canRecast?, players?, beforeLinked? }
 * @returns {Array} 候选动作列表
 */
export function generateTiesuoActions(player, card, candidates, context) {
	context = context || {};
	const legal = _dedupeTargets(candidates);
	const players = context.players || legal;
	const beforeLinked = context.beforeLinked || getCurrentLinkedSet(players);

	const actions = [];

	/* RECAST：始终作为一个显式候选（宿主允许重铸时） */
	if (context.canRecast !== false) {
		actions.push(_mkAction('recast', [], beforeLinked));
	}

	/* 单目标 */
	for (let i = 0; i < legal.length; i++) {
		actions.push(_mkAction('use', [legal[i]], beforeLinked));
	}

	/* 双目标（i<j 保证无重复 pair） */
	for (let i = 0; i < legal.length; i++) {
		for (let j = i + 1; j < legal.length; j++) {
			actions.push(_mkAction('use', [legal[i], legal[j]], beforeLinked));
		}
	}

	return actions;
}

/* ================= 10.3 状态 utility（Task 4） =================
 * 敌人被横置 = 我方局面有利（正）；队友被横置 = 有害（负）；中性 ≈ 近零负。
 * 绝不把中性当作明确敌人；绝不在本文件重造 threat（角色价值可由外部注入）。
 */

const LINK_BASE = 2.0;         /* 一名满血明确敌人被横置的基准状态价值 */
const NEUTRAL_RATIO = 0.25;    /* 中性目标被横置的残余代价系数（近零，绝不等于敌） */

/* 血量权重：越残血，被横置的收益/风险越大 */
function _hpWeight(p) {
	try {
		const hp = (typeof p.hp === 'number') ? p.hp : 1;
		const maxHp = (typeof p.maxHp === 'number' && p.maxHp > 0) ? p.maxHp : Math.max(hp, 1);
		const risk = Math.max(0, Math.min(1, (maxHp - hp) / maxHp));
		return 1 + risk * 0.8;
	} catch (e) { _swallow(e); return 1; }
}

/* 角色价值权重（可选注入，禁止在此重造 threat 计算） */
function _roleWeight(p, context) {
	try {
		if (context && typeof context.roleValueOf === 'function') {
			const w = context.roleValueOf(p);
			if (typeof w === 'number' && isFinite(w) && w > 0) return w;
		}
	} catch (e) { _swallow(e); }
	return 1;
}

/* 属性机会 modifier（方案 §11 轻量版）：
 *   我方持有属性手段 → 横置敌人更值钱；
 *   敌方持有属性威胁 → 横置队友更危险。
 * 只对明确的 enemy/ally 生效，中性不受影响。 */
function _opportunityMul(d, context) {
	try {
		context = context || {};
		if (d < 0 && context.hasOurAttr) return 1.15;
		if (d > 0 && context.enemyAttrThreat) return 1.15;
	} catch (e) { _swallow(e); }
	return 1;
}

/* 单个玩家被横置时的状态价值 */
function _linkedValueOf(me, p, context) {
	try {
		if (!p || p === me) return 0;
		const rel = (context && typeof context.relationOf === 'function')
			? context.relationOf(me, p)
			: dispositionOf(me, p);
		const w = _hpWeight(p) * _roleWeight(p, context) * _opportunityMul(rel, context);
		if (rel < 0) return LINK_BASE * w;          /* 敌人：正 */
		if (rel > 0) return -LINK_BASE * w;         /* 队友：负 */
		return -LINK_BASE * NEUTRAL_RATIO;          /* 中性：轻负，绝不等于敌 */
	} catch (e) { _swallow(e); return 0; }
}

/**
 * 对一个横置集合求状态价值 U(S)。纯函数，不修改任何 Player。
 * @param {*} me 决策者
 * @param {Array} players 全局玩家（保留位，当前仅使用 linkedSet）
 * @param {Set} linkedSet 横置集合
 * @param {Object} [context] { relationOf?, roleValueOf?, hasOurAttr?, enemyAttrThreat? }
 * @returns {number}
 */
export function evaluateLinkedState(me, players, linkedSet, context) {
	context = context || {};
	let u = 0;
	try {
		(linkedSet ? Array.from(linkedSet) : []).forEach(function (p) {
			u += _linkedValueOf(me, p, context);
		});
	} catch (e) { _swallow(e); }
	return Math.round(u * 1000) / 1000;
}

/* ================= 10.4 动作评分（Task 5） ================= */

/**
 * 计算一个铁索动作的净状态收益 ΔU = U(after) - U(before)。
 * 写回 action.delta / action.score 并返回 delta。
 * 语义要点：已横置敌人再次被选 = toggle 解链 → 负收益（不得因「敌人」标签加分）。
 * @param {*} me
 * @param {Object} action generateTiesuoActions 产出的候选
 * @param {Object} [context]
 * @returns {number}
 */
export function scoreTiesuoAction(me, action, context) {
	context = context || {};
	try {
		if (!action) return 0;
		const before = action.beforeLinked || new Set();
		const after = action.afterLinked || toggleLinkedSet(before, action.targets);
		const uBefore = evaluateLinkedState(me, null, before, context);
		const uAfter = evaluateLinkedState(me, null, after, context);
		const delta = Math.round((uAfter - uBefore) * 1000) / 1000;
		action.delta = delta;
		action.score = delta;
		return delta;
	} catch (e) { _swallow(e); return 0; }
}

/* ================= 10.5 重铸门槛 + 全局分数映射（Task 6） =================
 * evaluator 内部只负责「局面 utility」：
 *   - use: ΔU
 *   - recast: RecastValue
 *
 * 但“略高于重铸”不等于“值得真正打出铁索”。因此增加明确使用门槛：
 *   UseThreshold = RecastValue + USE_MARGIN
 *
 * 通过门槛后，再由 tiesuoUtilityToEngineRaw() 把 utility 映射到 engine 的
 * raw score 尺度。映射锚点：LINK_BASE=2.0（横置一名普通敌人） ↔ 全局 raw=5，
 * 因此 GLOBAL_SCALE=2.5。最终仍由 engine 统一经过 toInt8()。
 */

const RECAST_DRAW_VALUE = 2.2;   /* 重铸摸一张牌的期望价值（稳定基准） */
const RECAST_CARD_COST = 1.0;    /* 舍弃本铁索牌的机会成本 */

export const TIESUO_USE_MARGIN = 1.3;
export const TIESUO_GLOBAL_SCALE = 2.5;
export const TIESUO_GLOBAL_RAW_CAP = 20;

/**
 * 返回“真正值得使用铁索”的最低 ΔU。
 * 默认：RecastValue + 1.3。可由 context.useMargin / useThreshold 覆写，
 * 便于离线调参与行为回归，但生产默认值保持单一真相源。
 */
export function tiesuoUseThreshold(recastValue, context) {
	context = context || {};
	try {
		if (typeof context.useThreshold === 'number' && isFinite(context.useThreshold)) {
			return Math.round(context.useThreshold * 1000) / 1000;
		}
		const margin = (typeof context.useMargin === 'number' && isFinite(context.useMargin))
			? context.useMargin
			: TIESUO_USE_MARGIN;
		const rv = (typeof recastValue === 'number' && isFinite(recastValue)) ? recastValue : 0;
		return Math.round((rv + margin) * 1000) / 1000;
	} catch (e) { _swallow(e); return Math.round(((Number(recastValue) || 0) + TIESUO_USE_MARGIN) * 1000) / 1000; }
}

/**
 * 把 tiesuo evaluator 的 utility 映射到 engine raw score。
 * 统一用于“使用”和“重铸”，避免 use 沿用普通卡 s、recast 却只拿 1.2 的尺度断层。
 */
export function tiesuoUtilityToEngineRaw(utility, context) {
	context = context || {};
	try {
		if (typeof utility !== 'number' || !isFinite(utility)) return 0;
		const scale = (typeof context.globalScale === 'number' && isFinite(context.globalScale))
			? context.globalScale
			: TIESUO_GLOBAL_SCALE;
		const cap = (typeof context.globalRawCap === 'number' && isFinite(context.globalRawCap) && context.globalRawCap > 0)
			? context.globalRawCap
			: TIESUO_GLOBAL_RAW_CAP;
		const raw = utility * scale;
		return Math.round(Math.max(-cap, Math.min(cap, raw)) * 1000) / 1000;
	} catch (e) { _swallow(e); return 0; }
}

/**
 * 估算重铸价值 RecastValue = ExpectedDrawValue - CardOpportunityCost。
 * 必须稳定、非零、可与 ΔU 同层比较；可由 context 覆写。
 * @param {*} player
 * @param {Object} [context] { recastValue?, expectedDrawValue?, cardOpportunityCost? }
 * @returns {number}
 */
export function estimateTiesuoRecastValue(player, context) {
	context = context || {};
	try {
		if (typeof context.recastValue === 'number' && isFinite(context.recastValue)) {
			return Math.round(context.recastValue * 1000) / 1000;
		}
		let draw = RECAST_DRAW_VALUE;
		let cost = RECAST_CARD_COST;
		if (typeof context.expectedDrawValue === 'number' && isFinite(context.expectedDrawValue)) draw = context.expectedDrawValue;
		if (typeof context.cardOpportunityCost === 'number' && isFinite(context.cardOpportunityCost)) cost = context.cardOpportunityCost;
		return Math.round((draw - cost) * 1000) / 1000;
	} catch (e) { _swallow(e); return Math.round((RECAST_DRAW_VALUE - RECAST_CARD_COST) * 1000) / 1000; }
}

/* 轻量名字（诊断只存名字/id，禁止长期保存完整 Player） */
function _nameOf(p) {
	try {
		if (!p) return '?';
		return p.name || p.name1 || p.name2 || (p.playerid !== undefined ? ('#' + p.playerid) : '?');
	} catch (e) { _swallow(e); return '?'; }
}

/* 写入最近一次 evaluator 结果（只存名字/id/分数） */
function _recordDiagnostics(result, context) {
	try {
		if (!_status || typeof _status !== 'object') return;
		const cands = (result.candidates || []).slice(0, 12).map(function (a) {
			return {
				type: a.type,
				targets: (a.targets || []).map(_nameOf),
				delta: a.delta,
				score: a.score,
			};
		});
		const b = result.bestAction;
		_status.djsc_lastTiesuo = {
			before: Array.from(result.players || []).filter(function (p) { return result.beforeSet && result.beforeSet.has(p); }).map(_nameOf),
			candidates: cands,
			best: b ? { type: b.type, targets: (b.targets || []).map(_nameOf), score: b.score, delta: b.delta } : null,
			recastValue: result.recastValue,
			useThreshold: result.useThreshold,
			currentStateValue: result.currentStateValue,
		};
	} catch (e) { _swallow(e); }
}

/**
 * 铁索最终策略主入口：枚举 → 评分 → 同层竞争 → 返回最优动作。
 * @param {*} player 施法者
 * @param {*} card   铁索牌
 * @param {Object} [context]
 *   candidates/targets  合法目标 Player[]
 *   players             全局玩家（读取当前横置集合）
 *   canRecast           是否允许重铸（默认 true）
 *   beforeLinked        已知横置集合（省略则读 players）
 *   recastValue/expectedDrawValue/cardOpportunityCost
 *   useMargin/useThreshold  使用门槛（默认 RecastValue + 1.3）
 *   relationOf/roleValueOf/hasOurAttr/enemyAttrThreat
 *   actions             已生成的候选（省略则内部生成）
 * @returns {{bestAction:Object|null, candidates:Array, currentStateValue:number, recastValue:number, useThreshold:number}}
 */
export function evaluateTiesuoActions(player, card, context) {
	context = context || {};
	try {
		let candidates = Array.isArray(context.actions) && context.actions.length
			? context.actions
			: null;
		if (!candidates) {
			const legal = context.candidates || context.targets || [];
			candidates = generateTiesuoActions(player, card, legal, context);
		}

		const recastValue = estimateTiesuoRecastValue(player, context);

		const before = (context.beforeLinked)
			|| (candidates.length ? candidates[0].beforeLinked : null)
			|| getCurrentLinkedSet(context.players || context.candidates || context.targets || []);
		const currentStateValue = evaluateLinkedState(player, context.players || null, before, context);

		candidates.forEach(function (act) {
			if (!act) return;
			if (act.type === 'recast') {
				act.delta = 0;
				act.score = recastValue;
				act.reason = act.reason || '重铸摸牌（RecastValue=' + recastValue + '）';
			} else {
				const delta = scoreTiesuoAction(player, act, context);
				act.score = delta;
				act.reason = act.reason || (delta > 0 ? '净状态收益' : (delta === 0 ? '无状态变化' : '无意义/降分'));
			}
		});

		const useThreshold = tiesuoUseThreshold(recastValue, context);
		let recastAction = null;
		let bestUse = null;
		for (let i = 0; i < candidates.length; i++) {
			const a = candidates[i];
			if (!a) continue;
			if (a.type === 'recast') {
				if (!recastAction || a.score > recastAction.score) recastAction = a;
				continue;
			}
			if (a.type === 'use' && (!bestUse || a.score > bestUse.score)) bestUse = a;
		}

		/* 可重铸时：普通单目标 +2 并不足以使用，必须显著胜过重铸。
		 * 不可重铸时则退化为“选最佳合法 use”，由 engine 的全局分数再决定是否行动。 */
		let bestAction = null;
		if (recastAction) {
			bestAction = (bestUse && bestUse.score >= useThreshold) ? bestUse : recastAction;
		} else {
			bestAction = bestUse;
		}

		const result = {
			bestAction: bestAction,
			candidates: candidates,
			currentStateValue: currentStateValue,
			recastValue: recastValue,
			useThreshold: useThreshold,
		};
		/* 诊断落点需要 beforeSet / players（仅内部用，不长期持有） */
		result.beforeSet = before;
		result.players = context.players || null;
		_recordDiagnostics(result, context);
		return result;
	} catch (e) {
		_swallow(e);
		return { bestAction: null, candidates: [], currentStateValue: 0, recastValue: 0, useThreshold: 0 };
	}
}

/* ================= 10.6 宿主原生 AI 收敛入口（Task 9 补强） =================
 * 背景（用户实测：残局仍会「单连」「无意义也不重铸」）：
 *   optimization.js 的宿主原生铁索 result.target 仍保留旧启发
 *     「同阵营可连人数 < 2 → return 0」，在残局（1 队友 + 1 敌人）会把两个目标
 *     都判 0；basic.order / useful 亦恒高，使重铸输给使用。
 *   → 宿主侧必须消费 evaluator 唯一权威结论，而不是维护第二套策略。
 */

/* 收集 evaluator 的合法目标：存活且非施法者（与 engine tsMap 口径一致）。 */
function _aliveCandidates(me, players) {
	const out = [];
	(players || []).forEach(function (p) {
		if (!p || p === me) return;
		try {
			if (typeof p.isDead === 'function' ? p.isDead() : (typeof p.hp === 'number' && p.hp <= 0)) return;
		} catch (e) { _swallow(e); }
		out.push(p);
	});
	return out;
}

/**
 * 宿主侧唯一权威决策入口：返回 evaluator 对当前铁索局面的结论。
 * use=false 表示「重铸/不使用」，宿主应让出顺序走重铸路径。
 * @returns {{use:boolean, targets:Array}}
 */
export function hostTiesuoDecision(me, players, context) {
	context = context || {};
	try {
		const list = (players && players.length) ? players : (context.players || []);
		const ctx = {};
		for (const k in context) {
			if (Object.prototype.hasOwnProperty.call(context, k)) ctx[k] = context[k];
		}
		ctx.candidates = _aliveCandidates(me, list);
		ctx.players = list;
		const res = evaluateTiesuoActions(me, null, ctx);
		const best = res.bestAction;
		if (best && best.type === 'use' && best.targets && best.targets.length) {
			return { use: true, targets: best.targets };
		}
		return { use: false, targets: [] };
	} catch (e) { _swallow(e); return { use: false, targets: [] }; }
}

const HOST_LINK_EFFECT_MAG = 0.9;   /* 宿主 result.target 基准幅度（与原生一致） */

/**
 * 宿主 lib.card.tiesuo.ai.result.target 的 evaluator 化实现。
 * 返回与宿主约定一致的带方向 effect：
 *   evaluator 选中该目标 → 已横置 +mag / 未横置 -mag（乘 attitude 后即为「使用价值」正负）；
 *   未选中 / 判重铸 / 目标非法 → 0（宿主不会选中它）。
 * @returns {number}
 */
export function hostTiesuoTargetEffect(me, target, players, context) {
	try {
		if (!target) return 0;
		const hasTag = function (t) {
			return (typeof target.hasSkillTag === 'function') ? !!target.hasSkillTag(t) : false;
		};
		if (hasTag('link') || hasTag('noLink') || hasTag('nodamage')) return 0;
		if (hasTag('nofire') && hasTag('nothunder')) return 0;
		const d = hostTiesuoDecision(me, players, context);
		if (!d.use || d.targets.indexOf(target) < 0) return 0;
		let mag = HOST_LINK_EFFECT_MAG;
		try {
			if (!hasTag('nofire') && typeof target.getEquip === 'function' && target.getEquip('tengjia')) mag *= 2;
		} catch (e) { _swallow(e); }
		return isPlayerLinked(target) ? mag : -mag;
	} catch (e) { _swallow(e); return 0; }
}

export default {
	getCurrentLinkedSet, toggleLinkedSet, generateTiesuoActions,
	evaluateLinkedState, scoreTiesuoAction,
	estimateTiesuoRecastValue, tiesuoUseThreshold, tiesuoUtilityToEngineRaw, evaluateTiesuoActions,
	hostTiesuoDecision, hostTiesuoTargetEffect,
};
