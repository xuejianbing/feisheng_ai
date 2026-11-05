/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无懈可击 Evaluator · 唯一权威策略源 =================
 * 指令 03：无懈可击响应决策修复。
 *
 * 设计模型（方案 §2/§14）：
 *   ΔU = [U(打无懈后原始锦囊最终状态) - U(不打后原始锦囊最终状态)] - C_wuxie
 *   若 ΔU > 阈值 → 出无懈；否则保留；上下文无法解析 → use=null（fail-open 交回原生 AI）。
 *
 * 三层职责：
 *   ① resolveWuxieContext   从真实事件链解析「原始锦囊 / 来源 / 目标 / 无懈链 parity」；
 *   ② evaluateTrickEffect   评估「原始锦囊最终生效」对己方的价值（含敌我方向）；
 *   ③ estimateWuxieResourceCost + evaluateWuxie   资源成本（soft，绝不 hard veto）→ 最终决定。
 *
 * 关键约束：
 *   - 最后一张无懈只提高成本，不得成为硬性禁止；
 *   - 顺手/过河不能只按「敌人对队友」硬判，需看目标区域价值 / 是否拆掉负面判定牌；
 *   - 反无懈必须回溯原始锦囊，按 parity 判断原锦囊最终 resolve/negate；
 *   - 上下文解析失败 → 不 hard block、不 hard force，交回原生 AI。
 */
import { get, _status } from '../../foundation/adapt/host.js';
import { dispositionOf } from '../relations/relations.js';   /* ★ 统一敌我系统单一权威源 */

function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') {
			window.__DJSC.swallow(e);
		}
	} catch (_) { /* swallow 自身失败时不再递归 */ }
}

/* ---------- 锦囊分类常量（唯一权威定义，禁止其它模块再维护第二套名单） ---------- */
const DELAYED_TRICKS = ['lebu', 'bingliang', 'shandian'];/* 延时类（判定区）：乐/兵/闪电（价值随目标/持有者） */
const AOE_TRICKS = ['nanman', 'wanjian'];                /* AOE：无单一目标 */
const SINGLE_DAMAGE_TRICKS = ['juedou', 'huogong'];      /* 单体伤害锦囊 */
const DESTROY_TRICKS = ['shunshou', 'guohe'];            /* 拆除类：顺/拆（看区域价值） */
const BENEFICIAL_TRICKS = ['wuzhong', 'taoyuan', 'wugu'];/* 增益类 */
const HARMFUL_JUDGE = ['lebu', 'bingliang', 'shandian']; /* 判定区「负面」延时牌（敌方拆掉 = 帮队友） */
/* 必须有明确受害目标才能可靠评估的锦囊 */
const TRICKS_NEED_TARGET = ['lebu', 'bingliang', 'shandian', 'shunshou', 'guohe', 'juedou', 'huogong'];

/* ---------- 成本 / 阈值（全部 soft，可被 context 覆写） ---------- */
const BASE_COST = 1.2;
const LAST_CARD_PREMIUM = 1.4;
const LOW_HAND_PREMIUM = 0.6;
const DEFAULT_THRESHOLD = 0.2;
const RESOLVE_CONFIDENCE_MIN = 0.55;

/* ================= 通用读取工具（宿主 API 容错，绝不抛错） ================= */

function _cardId(card, player) {
	try {
		if (!card) return null;
		try {
			const n = get.name(card, player);
			if (typeof n === 'string' && n) return n;
		} catch (e) { _swallow(e); }
		if (typeof card === 'string') return card;
		if (typeof card.name === 'string' && card.name) return card.name;
		if (typeof card.id === 'string' && card.id) return card.id;
		if (card.viewAs) return (typeof card.viewAs === 'string') ? card.viewAs : (card.viewAs.name || null);
	} catch (e) { _swallow(e); }
	return null;
}

function _parentOf(ev) {
	try {
		if (!ev) return null;
		if (typeof ev.getParent === 'function') return ev.getParent() || null;
		return ev.parent || ev._parent || null;
	} catch (e) { _swallow(e); return null; }
}

/* 读取一个事件节点上的卡牌事实（多形态兼容，不假设单一字段） */
function _readEvent(ev, player) {
	try {
		if (!ev) return null;
		const trig = ev._trigger || ev.trigger || null;
		const card = ev.card || (trig && trig.card) || null;
		const source = ev.player || ev.source || (trig && (trig.player || trig.source)) || null;
		let targets = ev.targets || (trig && trig.targets) || null;
		let target = ev.target || (trig && trig.target) || null;
		if (!target && Array.isArray(targets) && targets.length) target = targets[0];
		if (!targets && target) targets = [target];
		return { card: card, source: source, target: target, targets: targets, name: ev.name || null };
	} catch (e) { _swallow(e); return null; }
}

function _hpOf(p) {
	try {
		if (!p) return 0;
		if (typeof p.hp === 'number') return p.hp;
		return 0;
	} catch (e) { return 0; }
}

function _handOf(p) {
	try {
		if (!p) return 0;
		if (typeof p.countCards === 'function') return p.countCards('h') || 0;
		if (Array.isArray(p.hand)) return p.hand.length;
		if (typeof p.handCount === 'number') return p.handCount;
	} catch (e) { _swallow(e); }
	return 0;
}

function _judgeCardsOf(p) {
	try {
		if (!p) return [];
		if (typeof p.getCards === 'function') return p.getCards('j') || [];
		if (Array.isArray(p.judging)) return p.judging;
		if (Array.isArray(p.judgeCards)) return p.judgeCards;
	} catch (e) { _swallow(e); }
	return [];
}

function _equipCardsOf(p) {
	try {
		if (!p) return [];
		if (typeof p.getCards === 'function') return p.getCards('e') || [];
		if (Array.isArray(p.equips)) return p.equips;
		if (Array.isArray(p.equipCards)) return p.equipCards;
	} catch (e) { _swallow(e); }
	return [];
}

/* 统一敌我读取：+1 友 / -1 敌 / 0 中性（自己视为友） */
function _rel(player, p, context) {
	try {
		if (!p) return 0;
		if (p === player) return 1;
		if (context && typeof context.relationOf === 'function') {
			const r = context.relationOf(player, p);
			if (r === 1 || r === -1 || r === 0) return r;
		}
	} catch (e) { _swallow(e); }
	try { return dispositionOf(player, p); } catch (e) { return 0; }
}

/* 关键装备名（唯一权威名单；命中则单件价值显著提高） */
const KEY_EQUIPS = [
	'bagua', 'renwang', 'tengjia', 'baiyin',
	'zhuge', 'qinglong', 'qinggang', 'qilin', 'zhuque', 'guanshi', 'cixiong', 'hanbing',
];

/* 单件装备的基础价值（用于顺/拆评估；未知牌不强行建模，仅用名称启发） */
function _equipValueOf(card) {
	try {
		const id = _cardId(card, null);
		if (id && KEY_EQUIPS.indexOf(id) >= 0) return 3.5;
		return 1.2;
	} catch (e) { _swallow(e); }
	return 1.2;
}

/* ================= 顺/拆：一次只操作一张牌，按行动方最优合法选择估值 =================
 * 只读取公开装备/判定区 + 手牌数量；绝不读取对手隐藏手牌内容。
 * 返回值仍是“原锦囊生效对决策者的价值”：正=对我方有利，负=对我方有害。
 */

function _targetRemovalValue(tgtRel, baseValue) {
	if (tgtRel > 0) return -baseValue;
	if (tgtRel < 0) return baseValue;
	return 0;
}

function _sourceGainValue(srcRel) {
	if (srcRel > 0) return 1.2;
	if (srcRel < 0) return -1.2;
	return 0;
}

function _removalOptions(tgt, tgtRel, srcRel, isSteal) {
	const out = [];
	try {
		const gain = isSteal ? _sourceGainValue(srcRel) : 0;
		const h = _handOf(tgt);
		if (h > 0) {
			/* 手牌身份不可见，只按“可失去一张未知手牌”的期望价值估计。 */
			let handValue = 0.9;
			if (_hpOf(tgt) <= 1) handValue += 2.5;
			out.push(_targetRemovalValue(tgtRel, handValue) + gain);
		}

		const eq = _equipCardsOf(tgt);
		for (let i = 0; i < eq.length; i++) {
			out.push(_targetRemovalValue(tgtRel, _equipValueOf(eq[i])) + gain);
		}

		/* 判定区是公开信息。移除负面延时状态会帮助其持有者。 */
		const js = _judgeCardsOf(tgt);
		for (let i = 0; i < js.length; i++) {
			const id = _cardId(js[i], null);
			let v = 0;
			if (id && HARMFUL_JUDGE.indexOf(id) >= 0) {
				if (tgtRel > 0) v = 2.0;
				else if (tgtRel < 0) v = -2.0;
			}
			out.push(v + gain);
		}
	} catch (e) { _swallow(e); }
	return out;
}

function _selectRemovalOutcome(options, srcRel) {
	if (!options || !options.length) return 0;
	/* 行动方是敌人：假设其选择对我方最不利的合法牌；
	 * 行动方是队友：假设其选择对我方最有利的合法牌；
	 * 中性行动方：不替其猜极端策略，取平均。 */
	if (srcRel < 0) return Math.min.apply(Math, options);
	if (srcRel > 0) return Math.max.apply(Math, options);
	return options.reduce(function (a, b) { return a + b; }, 0) / options.length;
}

function _destroyValue(player, ctx, context, isSteal) {
	try {
		const tgt = ctx && ctx.target;
		if (!tgt) return 0;
		const tgtRel = _rel(player, tgt, context);
		const srcRel = ctx.source ? _rel(player, ctx.source, context) : 0;
		const options = _removalOptions(tgt, tgtRel, srcRel, !!isSteal);
		const v = _selectRemovalOutcome(options, srcRel);
		return Math.round(v * 100) / 100;
	} catch (e) { _swallow(e); return 0; }
}

/* ================= ① Wuxie Context Resolver ================= */

function _finalizeContext(ctx, extraConfidence) {
	const spellId = ctx.originalSpellId || null;
	const targets = Array.isArray(ctx.targets) ? ctx.targets.filter(Boolean) : [];
	/* ★ 闪电属延时锦囊，无独立受害目标：判定区持有者就是受害者。 */
	let target = ctx.target || null;
	if (!target && targets.length === 1) target = targets[0];
	if (!target && spellId === 'shandian' && ctx.source) target = ctx.source;
	const needsTarget = !!spellId && TRICKS_NEED_TARGET.indexOf(spellId) >= 0;
	const isAoe = !!spellId && AOE_TRICKS.indexOf(spellId) >= 0;

	let confidence = 0;
	if (spellId) confidence += 0.55;
	if (ctx.source) confidence += 0.2;
	if (target || targets.length) confidence += 0.25;
	if (typeof extraConfidence === 'number') confidence = Math.max(confidence, extraConfidence);

	const depth = (typeof ctx.chainDepth === 'number' && ctx.chainDepth >= 0) ? ctx.chainDepth : 0;
	const currentlyNegated = (typeof ctx.currentlyNegated === 'boolean')
		? ctx.currentlyNegated
		: (depth % 2 === 1);

	const resolved = !!spellId && (!needsTarget || !!target) && confidence >= RESOLVE_CONFIDENCE_MIN;
	return {
		resolved: resolved,
		originalSpellId: spellId,
		source: ctx.source || null,
		target: target,
		targets: targets,
		currentCardId: ctx.currentCardId || null,
		chainDepth: depth,
		currentlyNegated: currentlyNegated,
		hostState: (typeof ctx.hostState === 'number') ? ctx.hostState : null,
		inWuxieChain: !!ctx.inWuxieChain,
		needsTarget: needsTarget,
		isAoe: isAoe,
		path: ctx.path || [],
		confidence: Math.round(confidence * 100) / 100,
	};
}

/**
 * 解析当前无名杀 _wuxie → chooseToUse({type:'wuxie', info_map, state}) 的官方上下文。
 * info_map/state 是宿主已经解析好的权威事实；反无懈时 info_map._source 指向原始锦囊。
 * 返回 null 表示这不是宿主 wuxie request，由旧事件链 resolver 继续处理。
 */
export function resolveWuxieHostContext(player, request, context) {
	context = context || {};
	try {
		if (!request || typeof request !== 'object') return null;
		const map = context.infoMap || context.info_map || request.info_map || request.infoMap || null;
		if (!map || typeof map !== 'object') return null;

		const currentCardId = _cardId(map.card, player);
		const root = (map._source && typeof map._source === 'object') ? map._source : map;
		const originalSpellId = _cardId(root.card, player);
		if (!originalSpellId || originalSpellId === 'wuxie') return _finalizeContext({
			originalSpellId: null,
			path: ['<host-wuxie-unresolved>'],
		});

		const hostStateRaw = (typeof context.hostState === 'number')
			? context.hostState
			: ((typeof request.state === 'number') ? request.state
				: ((typeof map.state === 'number') ? map.state : null));
		const hostState = hostStateRaw === null ? null : (hostStateRaw >= 0 ? 1 : -1);
		const source = root.player || root.source || null;
		let target = root.target || null;
		const targets = Array.isArray(root.targets) ? root.targets.filter(Boolean) : (target ? [target] : []);
		if (!target && root.isJudge && root.target) target = root.target;

		return _finalizeContext({
			originalSpellId: originalSpellId,
			source: source,
			target: target,
			targets: targets,
			currentCardId: currentCardId || originalSpellId,
			chainDepth: (typeof context.chainDepth === 'number') ? context.chainDepth : 0,
			currentlyNegated: hostState === null ? undefined : hostState < 0,
			hostState: hostState,
			inWuxieChain: !!map._source || currentCardId === 'wuxie',
			path: ['<host-info_map>', originalSpellId],
		}, 0.99);
	} catch (e) {
		_swallow(e);
		return _finalizeContext({ originalSpellId: null, path: ['<host-wuxie-error>'] });
	}
}

/**
 * 解析无懈事件上下文：回溯原始锦囊 / 来源 / 受害目标 / 无懈链层数。
 * 纯读取，不修改任何游戏对象。无法可靠解析时返回 resolved=false（fail-open）。
 * @param {*} player 决策者
 * @param {*} event  当前 chooseToRespond 事件（_status.event）
 * @param {Object} [context] 允许调用方直接注入已确证事实（测试 / 已解析场景）
 * @returns {Object} { resolved, originalSpellId, source, target, chainDepth, currentlyNegated, confidence, ... }
 */
export function resolveWuxieContext(player, event, context) {
	context = context || {};
	try {
		/* 1) 调用方已确证事实优先（测试 fixture / 上层解析结果）。 */
		if (context.originalSpellId || context.spellId) {
			return _finalizeContext({
				originalSpellId: context.originalSpellId || context.spellId,
				source: context.source || null,
				target: context.target || null,
				targets: context.targets || null,
				currentCardId: context.currentCardId || null,
				chainDepth: (typeof context.chainDepth === 'number') ? context.chainDepth : 0,
				currentlyNegated: (typeof context.currentlyNegated === 'boolean') ? context.currentlyNegated : undefined,
				hostState: (typeof context.hostState === 'number') ? context.hostState : null,
				inWuxieChain: !!context.inWuxieChain,
				path: ['<context>'],
			}, 0.99);
		}

		/* 2) 当前宿主官方 wuxie request 优先于 parent-chain 猜测。 */
		const hostCtx = resolveWuxieHostContext(player, context.hostRequest || event, context);
		if (hostCtx) return hostCtx;

		const ctx = { originalSpellId: null, source: null, target: null, targets: null, currentCardId: null, chainDepth: 0, path: [] };
		const seenCards = new Set();
		const seenEvents = new Set();
		let cur = event;
		let hops = 0;

		while (cur && hops < 16 && !seenEvents.has(cur)) {
			seenEvents.add(cur);
			const info = _readEvent(cur, player);
			if (info && info.card && !seenCards.has(info.card)) {
				seenCards.add(info.card);
				const id = _cardId(info.card, player);
				if (id) {
					ctx.path.push(id);
					if (id === 'wuxie') {
						/* 已在链中的无懈（反无懈链层数） */
						ctx.chainDepth++;
					} else if (!ctx.originalSpellId) {
						ctx.originalSpellId = id;
						if (info.source) ctx.source = info.source;
						if (info.target) ctx.target = info.target;
						ctx.currentCardId = id;
					}
				}
			}
			/* 补全来源/目标：原始锦囊事件本身可能不带 target，取链条上最近的同卡事件 */
			if (ctx.originalSpellId && (!ctx.source || !ctx.target) && info) {
				if (!ctx.source && info.source) ctx.source = info.source;
				if (!ctx.target && info.target) ctx.target = info.target;
			}
			cur = _parentOf(cur);
			hops++;
		}
		return _finalizeContext(ctx);
	} catch (e) {
		_swallow(e);
		return _finalizeContext({ originalSpellId: null, chainDepth: 0, path: [] });
	}
}

/* ================= ② Trick Effect Evaluator =================
 * 返回「原始锦囊最终生效」对决策者的价值：
 *   正 = 生效对我方有利（不应无懈）；负 = 生效对我方有害（应无懈）。
 */

function _delayedValue(player, id, tgtRel, tgt, context) {
	const isLebu = (id === 'lebu');
	const isShandian = (id === 'shandian');   /* 闪电：3 点雷电伤害，命中即重创/致命 */
	const h = _handOf(tgt);
	if (tgt === player) {
		/* 自己判定区中延时：高负收益 */
		if (isShandian) return -5.0;
		const scale = isLebu ? (1 + Math.min(h, 4) * 0.12) : (1 + (h <= 1 ? 0.5 : 0));
		return -(isLebu ? 6.0 : 5.0) * scale;
	}
	if (tgtRel > 0) {
		/* 队友判定区中延时：高负收益，随目标价值缩放 */
		if (isShandian) return -5.0;
		const scale = isLebu ? (1 + Math.min(h, 4) * 0.15) : (1 + (h <= 1 ? 0.5 : 0));
		return -(isLebu ? 5.0 : 4.5) * scale;
	}
	if (tgtRel < 0) {
		/* 敌人判定区中延时：对我方有利 → 不无懈 */
		if (isShandian) return 3.5;
		return isLebu ? 3.5 : 3.0;
	}
	/* 中性：不推定敌友，保守近零，不足以触发无懈 */
	return 0;
}

function _aoeValue(player, ctx, context) {
	try {
		const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
		if (targets.length) {
			let total = 0;
			for (const t of targets) {
				if (!t) continue;
				const rel = _rel(player, t, context);
				let magnitude = (t === player) ? 3.8 : 2.8;
				if (_hpOf(t) <= 1) magnitude += 1.2;
				if (t === player || rel > 0) total -= magnitude;
				else if (rel < 0) total += 2.2;
			}
			return Math.round(total * 100) / 100;
		}
		const srcRel = ctx.source ? _rel(player, ctx.source, context) : 0;
		if (srcRel < 0) return -3.5;
		if (srcRel > 0) return 2.0;
		return 0;
	} catch (e) { _swallow(e); return 0; }
}

function _singleDamageValue(player, tgtRel, tgt) {
	if (tgt === player) return -4.5;
	if (tgtRel > 0) return -3.5;
	if (tgtRel < 0) return 2.5;
	return 0;
}

function _beneficialValue(player, ctx, context) {
	try {
		const targets = Array.isArray(ctx.targets) ? ctx.targets : [];
		if (targets.length > 1) {
			let total = 0;
			for (const t of targets) {
				const rel = _rel(player, t, context);
				if (t === player || rel > 0) total += 1.2;
				else if (rel < 0) total -= 1.2;
			}
			return Math.round(total * 100) / 100;
		}
		const srcRel = ctx.source ? _rel(player, ctx.source, context) : 0;
		if (srcRel < 0) return -0.8;
		if (srcRel > 0) return 1.5;
		return 0;
	} catch (e) { _swallow(e); return 0; }
}

/**
 * 评估原始锦囊「最终生效」对决策者的价值（关系感知）。
 * @returns {number} 正=对我方有利；负=对我方有害；0=中性/不相关
 */
export function evaluateTrickEffect(player, ctx, context) {
	context = context || {};
	try {
		if (!ctx || !ctx.originalSpellId) return 0;
		const id = ctx.originalSpellId;
		const tgt = ctx.target;
		const tgtRel = tgt ? _rel(player, tgt, context) : 0;

		if (DELAYED_TRICKS.indexOf(id) >= 0) return _delayedValue(player, id, tgtRel, tgt, context);
		if (id === 'shunshou') return _destroyValue(player, ctx, context, true);
		if (id === 'guohe') return _destroyValue(player, ctx, context, false);
		if (AOE_TRICKS.indexOf(id) >= 0) return _aoeValue(player, ctx, context);
		if (SINGLE_DAMAGE_TRICKS.indexOf(id) >= 0) return _singleDamageValue(player, tgtRel, tgt);
		if (BENEFICIAL_TRICKS.indexOf(id) >= 0) return _beneficialValue(player, ctx, context);
		return 0;
	} catch (e) {
		_swallow(e);
		return 0;
	}
}

/* ================= ③ Wuxie Resource Cost =================
 * 无懈资源成本只进入 score，绝不作为 hard veto。
 */

function _wuxieCount(player, context) {
	try {
		if (context && typeof context.wuxieCount === 'number') return context.wuxieCount;
		if (player && typeof player.countCards === 'function') {
			return player.countCards('h', function (c) { return _cardId(c, player) === 'wuxie'; }) || 0;
		}
	} catch (e) { _swallow(e); }
	return 1;
}

/**
 * 估算打出一张无懈的机会成本（soft）。
 * 成本可高可低，但任何情况下都不得阻止使用（不返回 Infinity / 不返回 veto）。
 * @returns {number}
 */
export function estimateWuxieResourceCost(player, context, ctx) {
	context = context || {};
	try {
		let cost = BASE_COST;
		const count = _wuxieCount(player, context);
		if (count <= 1) cost += LAST_CARD_PREMIUM;         /* 最后一张：提高成本，不是禁止 */
		const hand = _handOf(player);
		if (hand <= 2) cost += LOW_HAND_PREMIUM;
		if (ctx && (ctx.inWuxieChain || ctx.chainDepth > 0)) cost -= 0.3; /* 反无懈场景略降（宿主 state/info_map 优先） */
		return Math.round(Math.max(0, cost) * 1000) / 1000;
	} catch (e) {
		_swallow(e);
		return BASE_COST;
	}
}

/* ================= ④ Final Wuxie Policy ================= */

function _nameOf(p) {
	try {
		if (!p) return null;
		if (p === null) return null;
		return p.name || p.name1 || p.name2 || (p.playerid !== undefined ? ('#' + p.playerid) : null);
	} catch (e) { return null; }
}

function _recordDiagnostics(res) {
	try {
		if (!_status || typeof _status !== 'object') return;
		_status.djsc_lastWuxie = {
			originalSpellId: res.originalSpellId,
			source: _nameOf(res.source),
			target: _nameOf(res.target),
			chainDepth: res.chainDepth,
			hostState: res.hostState,
			inWuxieChain: res.inWuxieChain,
			effectValue: res.effectValue,
			resourceCost: res.resourceCost,
			score: res.score,
			use: res.use,
			confidence: res.confidence,
			reason: res.reason,
		};
	} catch (e) { _swallow(e); }
}

function _emptyResult() {
	return {
		resolved: false, use: null, score: 0, effectValue: 0, resourceCost: 0,
		originalSpellId: null, source: null, target: null, targets: [], chainDepth: 0,
		hostState: null, inWuxieChain: false,
		finalStateIfPass: 'unknown', finalStateIfUse: 'unknown',
		confidence: 0, reason: 'context-unresolved',
	};
}

/**
 * 无懈最终策略主入口。
 * @param {*} player 决策者
 * @param {*} event  当前 chooseToRespond 事件
 * @param {Object} [context] { originalSpellId, source, target, chainDepth, wuxieCount,
 *                             relationOf, threshold, recastValue... 以及成本覆写 }
 * @returns {{resolved:boolean, use:(boolean|null), score:number, effectValue:number,
 *            resourceCost:number, originalSpellId:string|null, source:*, target:*,
 *            chainDepth:number, finalStateIfPass:string, finalStateIfUse:string,
 *            confidence:number, reason:string}}
 */
export function evaluateWuxie(player, event, context) {
	context = context || {};
	try {
		const ctx = resolveWuxieContext(player, event, context);

		if (!ctx.resolved) {
			const r = _emptyResult();
			r.chainDepth = ctx.chainDepth;
			r.confidence = ctx.confidence;
			r.originalSpellId = ctx.originalSpellId;
			r.source = ctx.source;
			r.target = ctx.target;
			r.targets = ctx.targets || [];
			r.hostState = ctx.hostState;
			r.inWuxieChain = !!ctx.inWuxieChain;
			_recordDiagnostics(r);
			return r;
		}

		const effectValue = evaluateTrickEffect(player, ctx, context);
		const resourceCost = estimateWuxieResourceCost(player, context, ctx);
		const currentlyNegated = !!ctx.currentlyNegated;

		/* parity：不打 → 维持当前状态；打 → 翻转（原锦囊 resolve/negate 互换） */
		const finalStateIfPass = currentlyNegated ? 'negate' : 'resolve';
		const finalStateIfUse = currentlyNegated ? 'resolve' : 'negate';

		/* ΔU = 打无懈后世界 − 不打后世界 */
		const effectDiff = currentlyNegated ? effectValue : -effectValue;
		const threshold = (typeof context.threshold === 'number') ? context.threshold : DEFAULT_THRESHOLD;
		const score = Math.round((effectDiff - resourceCost) * 1000) / 1000;
		const use = score > threshold;

		const chainTag = ctx.inWuxieChain
			? (ctx.hostState === null ? '@chain' : ('@state' + ctx.hostState))
			: (ctx.chainDepth > 0 ? ('@chain' + ctx.chainDepth) : '');
		const reason = use
			? ('use-wuxie:' + ctx.originalSpellId + chainTag)
			: ('hold-wuxie:' + ctx.originalSpellId + chainTag + '(score=' + score + ')');

		const res = {
			resolved: true,
			use: use,
			score: score,
			effectValue: effectValue,
			resourceCost: resourceCost,
			originalSpellId: ctx.originalSpellId,
			source: ctx.source,
			target: ctx.target,
			targets: ctx.targets || [],
			chainDepth: ctx.chainDepth,
			hostState: ctx.hostState,
			inWuxieChain: ctx.inWuxieChain,
			finalStateIfPass: finalStateIfPass,
			finalStateIfUse: finalStateIfUse,
			confidence: ctx.confidence,
			reason: reason,
		};
		_recordDiagnostics(res);
		return res;
	} catch (e) {
		_swallow(e);
		return _emptyResult();
	}
}

/* 便捷：仅取是否使用（null=无法判断 → 交回原生 AI） */
export function shouldUseWuxie(player, event, context) {
	try {
		const r = evaluateWuxie(player, event, context);
		return r.resolved ? !!r.use : null;
	} catch (e) { _swallow(e); return null; }
}

/* ★ 指令 04：对外暴露判定区延时控制的敌我方向语义。
 * turnStrategicState 复用本函数，禁止另写第二套判定区语义。 */
export { _delayedValue as delayedControlValue };

export default {
	resolveWuxieHostContext, resolveWuxieContext, evaluateTrickEffect,
	estimateWuxieResourceCost, evaluateWuxie, shouldUseWuxie,
	delayedControlValue: _delayedValue,
};