/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Turn-level Strategic Transition Ledger · V2 =================
 * 目的：避免同一回合内自己制造战略状态后又立即破坏，或刚移除某状态又重新建立。
 *
 * 核心约束：
 *   1) 具体卡牌只由 gameProfile.strategicEffects 映射成通用 operation/state；
 *   2) engine 先记录 pending action 的动作前公开状态，下一次决策时用真实公开状态差分确认；
 *   3) 被无懈/未生效的 create-state 不产生假 commitment；
 *   4) remove-target-card 只有真的移除了战略状态才写 REMOVE 记录；
 *   5) CREATE→REMOVE 与 REMOVE→CREATE 都只做 soft opportunity-cost penalty，不 hard-ban；
 *   6) self-created / reversal 必须匹配 actor + target + stateKey；
 *   7) phaseBegin 显式开启新 epoch；同角色额外回合也会清空上一回合 ledger。
 */

import { game, get, _status } from '../../foundation/adapt/host.js';
import '../../foundation/adapt/gameProfile.js';
import { strategicEffectOf } from '../../foundation/adapt/terms.js';
import { dispositionOf } from '../relations/relations.js';
import { delayedControlValue } from '../response/wuxieEvaluator.js';

function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') {
			window.__DJSC.swallow(e);
		}
	} catch (_) {}
}

const STRATEGIC_WEIGHT = 1.2;
const REAPPLY_WEIGHT = 1.2;
const REMOVAL_CHOICE_WEIGHT = 1.6;
const SELF_COMMITMENT_WEIGHT = 0.8;
const TARGET_ALTERNATIVE_DISCOUNT = 0.2;

/* ================= ① 通用战略状态 ================= */

function _cardName(card, player) {
	try {
		if (!card) return null;
		try {
			if (get && typeof get.name === 'function') {
				const n = get.name(card, player);
				if (typeof n === 'string' && n) return n;
			}
		} catch (e) { _swallow(e); }
		if (typeof card === 'string') return card;
		if (typeof card.name === 'string' && card.name) return card.name;
		if (card.viewAs) {
			if (typeof card.viewAs === 'string') return card.viewAs;
			if (typeof card.viewAs.name === 'string') return card.viewAs.name;
		}
	} catch (e) { _swallow(e); }
	return null;
}

function _effectOf(cardId) {
	try { return cardId ? strategicEffectOf(cardId) : null; }
	catch (e) { _swallow(e); return null; }
}

function _stateOf(cardId) {
	try {
		const e = _effectOf(cardId);
		if (!e || e.operation !== 'create-state' || !e.state) return null;
		return Object.assign({}, e.state);
	} catch (e) { _swallow(e); return null; }
}

function _stateKey(state) {
	if (!state) return '';
	return String(state.family || '') + '|' + String(state.dimension || '') + '|' + String(state.zone || '');
}

function _judgeCardsOf(player) {
	try {
		if (!player) return [];
		if (typeof player.getCards === 'function') {
			const j = player.getCards('j');
			if (Array.isArray(j)) return j;
		}
		if (Array.isArray(player.judges)) return player.judges;
	} catch (e) { _swallow(e); }
	return [];
}

function _cardsOf(player, zone) {
	try {
		if (!player || typeof player.getCards !== 'function') return [];
		const a = player.getCards(zone);
		return Array.isArray(a) ? a : [];
	} catch (e) { _swallow(e); return []; }
}

export function getJudgeCardNames(player) {
	try { return _judgeCardsOf(player).map(c => _cardName(c, player)).filter(Boolean); }
	catch (e) { _swallow(e); return []; }
}

export function strategicStateIdsIn(player) {
	try {
		return getJudgeCardNames(player).filter(function (id) {
			const st = _stateOf(id);
			return !!(st && (!st.zone || st.zone === 'j'));
		});
	} catch (e) { _swallow(e); return []; }
}

export function delayedControlIdsIn(player) { return strategicStateIdsIn(player); }
export function hasDelayedControl(player) { return strategicStateIdsIn(player).length > 0; }

function _relOf(player, target, context) {
	try {
		if (context && typeof context.relationOf === 'function') return context.relationOf(player, target);
	} catch (e) { _swallow(e); }
	try { return dispositionOf(player, target); } catch (e) { _swallow(e); return 0; }
}

function _rawStateValueOf(player, target, cardId, context) {
	try {
		const state = _stateOf(cardId);
		if (!state) return 0;
		if (context && typeof context.stateValueOf === 'function') {
			const injected = context.stateValueOf(player, target, cardId, state);
			if (typeof injected === 'number' && isFinite(injected)) return injected;
		}
		if (state.zone === 'j') {
			const rel = _relOf(player, target, context);
			const v = delayedControlValue(player, cardId, rel, target, context);
			if (typeof v === 'number' && isFinite(v)) return v;
		}
	} catch (e) { _swallow(e); }
	return 0;
}

function _stateValueOf(player, target, cardId, context) {
	return Math.round(_rawStateValueOf(player, target, cardId, context) * STRATEGIC_WEIGHT * 1000) / 1000;
}

function _refKey(p) {
	try {
		if (!p) return '';
		return String(p.playerid || p.name || p.name1 || p.name2 || '');
	} catch (e) { return ''; }
}

function _resolveTarget(t) {
	try {
		if (!t) return null;
		if (typeof t === 'object') return t;
		for (const p of (game.players || [])) {
			if (p && (p.playerid === t || p.name === t || p.name1 === t || p.name2 === t)) return p;
		}
	} catch (e) { _swallow(e); }
	return null;
}

function _stateEntriesIn(player, observer, context) {
	const out = [];
	try {
		for (const card of _judgeCardsOf(player)) {
			const id = _cardName(card, player);
			const st = _stateOf(id);
			if (!id || !st || (st.zone && st.zone !== 'j')) continue;
			out.push({
				cardId: id,
				state: st,
				stateKey: _stateKey(st),
				strategicValue: _stateValueOf(observer, player, id, context),
			});
		}
	} catch (e) { _swallow(e); }
	return out;
}

function _countByState(entries) {
	const out = {};
	for (const e of (entries || [])) {
		if (!e || !e.stateKey) continue;
		out[e.stateKey] = (out[e.stateKey] || 0) + 1;
	}
	return out;
}

/* ================= ② Turn epoch + confirmed ledger + pending diff ================= */

let _records = [];
let _pending = [];
let _turnEpoch = 0;
let _turnOwnerKey = '';

function _currentPhaseActor() {
	try { return (_status && _status.currentPhase) || null; } catch (e) { return null; }
}

/** phaseBegin 显式调用。即使同一个角色获得额外回合，也会创建新 epoch。 */
export function beginStrategicTurn(actor) {
	_turnEpoch++;
	_turnOwnerKey = _refKey(actor || _currentPhaseActor());
	_records = [];
	_pending = [];
	return _turnEpoch;
}

function _ensureTurn() {
	const cp = _currentPhaseActor();
	const key = _refKey(cp);
	if (_turnEpoch === 0) {
		beginStrategicTurn(cp);
		return;
	}
	/* 兼容没有安装 phaseBegin hook 的环境：currentPhase 换人时自动失效。 */
	if (key && key !== _turnOwnerKey) beginStrategicTurn(cp);
}

export function clearTurnState() {
	_turnEpoch++;
	_turnOwnerKey = _refKey(_currentPhaseActor());
	_records = [];
	_pending = [];
}

export function getStrategicTurnEpoch() {
	_ensureTurn();
	return _turnEpoch;
}

function _recordMatchesActor(rec, actor) {
	if (!rec || !actor) return false;
	return rec.actorRef === actor || (!!rec.actorKey && rec.actorKey === _refKey(actor));
}

function _recordMatchesTarget(rec, target) {
	if (!rec || !target) return false;
	return rec.targetRef === target || (!!rec.targetKey && rec.targetKey === _refKey(target));
}

function _appendRecord(actor, target, operation, cardId, state, strategicValue, sourceAction) {
	const rec = {
		operation: operation,
		actorRef: actor || null,
		actorKey: _refKey(actor),
		targetRef: target || null,
		targetKey: _refKey(target),
		cardId: cardId || null,
		state: state ? Object.assign({}, state) : null,
		stateKey: _stateKey(state),
		stateType: state && state.family ? state.family : 'state',
		zone: state && state.zone ? state.zone : null,
		strategicValue: Number(strategicValue) || 0,
		sourceAction: sourceAction || null,
		turnEpoch: _turnEpoch,
	};
	_records.push(rec);
	if (_records.length > 64) _records.shift();
	return rec;
}

/** 兼容旧接口：直接写“已经确认生效”的 CREATE 记录。engine V2 不调用这个接口。 */
export function recordStateCreation(actor, target, cardId, opts) {
	_ensureTurn();
	opts = opts || {};
	try {
		target = _resolveTarget(target);
		const st = _stateOf(cardId);
		if (!actor || !target || target.alive === false || !st) return null;
		const v = typeof opts.strategicValue === 'number'
			? opts.strategicValue
			: _stateValueOf(actor, target, cardId, opts);
		return _appendRecord(actor, target, 'create-state', cardId, st, v, opts.action || opts.strat || null);
	} catch (e) { _swallow(e); return null; }
}

export function recordControlState(actor, target, cardId, opts) {
	return recordStateCreation(actor, target, cardId, opts);
}

export function recordStrategicStateFromAction(actor, action, target) {
	action = action || {};
	return recordStateCreation(actor, target || action.target, action.rule || action.id || action.cardId, {
		action: action.strat || action.rule || null,
	});
}

export function recordSelfCreatedControl(actor, action, target) {
	return recordStrategicStateFromAction(actor, action, target);
}

/**
 * engine 在实际使用战略动作前调用：只记录动作前公开状态，不宣称动作已经生效。
 * 下一次 bestAction 开始时 reconcileStrategicTransitions() 用 before/after 差分确认。
 */
export function beginStrategicAction(actor, actionId, target, context) {
	_ensureTurn();
	try {
		const effect = _effectOf(actionId);
		target = _resolveTarget(target);
		if (!actor || !target || target.alive === false || !effect || !effect.operation) return null;
		if (effect.operation !== 'create-state' && effect.operation !== 'remove-target-card') return null;
		const pending = {
			token: 'st:' + _turnEpoch + ':' + (_pending.length + 1) + ':' + Date.now(),
			turnEpoch: _turnEpoch,
			actorRef: actor,
			actorKey: _refKey(actor),
			targetRef: target,
			targetKey: _refKey(target),
			actionId: actionId,
			operation: effect.operation,
			intendedState: effect.state ? Object.assign({}, effect.state) : null,
			intendedStateKey: effect.state ? _stateKey(effect.state) : '',
			before: _stateEntriesIn(target, actor, context),
		};
		_pending.push(pending);
		if (_pending.length > 16) _pending.shift();
		return pending.token;
	} catch (e) { _swallow(e); return null; }
}

/** 根据真实公开状态确认 pending transition；无状态差分即视为未生效/未移除战略状态。 */
export function reconcileStrategicTransitions(actor, context) {
	_ensureTurn();
	const confirmed = [];
	try {
		if (!_pending.length) return confirmed;
		const keep = [];
		for (const p of _pending) {
			if (!p || p.turnEpoch !== _turnEpoch) continue;
			if (actor && !_recordMatchesActor(p, actor)) { keep.push(p); continue; }
			const target = _resolveTarget(p.targetRef || p.targetKey);
			if (!target || target.alive === false) continue;
			const after = _stateEntriesIn(target, p.actorRef, context);
			const beforeCount = _countByState(p.before);
			const afterCount = _countByState(after);

			if (p.operation === 'create-state') {
				const key = p.intendedStateKey;
				if (key && (afterCount[key] || 0) > (beforeCount[key] || 0)) {
					const cardId = p.actionId;
					const st = p.intendedState || _stateOf(cardId);
					const v = _stateValueOf(p.actorRef, target, cardId, context);
					confirmed.push(_appendRecord(p.actorRef, target, 'create-state', cardId, st, v, p.actionId));
				}
				/* 状态没出现 = 被无懈/无效/未落区；pending 到下一决策即结案，不制造假记录。 */
				continue;
			}

			if (p.operation === 'remove-target-card') {
				const removedNeed = {};
				Object.keys(beforeCount).forEach(function (key) {
					const n = (beforeCount[key] || 0) - (afterCount[key] || 0);
					if (n > 0) removedNeed[key] = n;
				});
				for (const old of p.before) {
					if (!old || !old.stateKey || !(removedNeed[old.stateKey] > 0)) continue;
					removedNeed[old.stateKey]--;
					confirmed.push(_appendRecord(
						p.actorRef, target, 'remove-state', old.cardId, old.state,
						old.strategicValue, p.actionId
					));
				}
				continue;
			}
			keep.push(p);
		}
		_pending = keep;
	} catch (e) { _swallow(e); }
	return confirmed;
}

export function getStrategicRecords() {
	_ensureTurn();
	return _records.slice();
}
export function getControlRecords() { return getStrategicRecords(); }
export function getPendingStrategicActions() {
	_ensureTurn();
	return _pending.slice();
}

/* ================= ③ 评分：CREATE→REMOVE / REMOVE→CREATE ================= */

function _hasConfirmedCreateBy(actor, target, stateKey) {
	try {
		for (let i = _records.length - 1; i >= 0; i--) {
			const r = _records[i];
			if (!r || r.turnEpoch !== _turnEpoch || r.operation !== 'create-state') continue;
			if (!_recordMatchesActor(r, actor) || !_recordMatchesTarget(r, target)) continue;
			if (stateKey && r.stateKey !== stateKey) continue;
			const active = _countByState(_stateEntriesIn(target, actor, null));
			if ((active[r.stateKey] || 0) > 0) return true;
		}
	} catch (e) { _swallow(e); }
	return false;
}

function _countAlternativeRemovals(target) {
	try {
		let handCount = 0;
		try { handCount = target && target.countCards ? (target.countCards('h') || 0) : 0; } catch (e) {}
		let n = handCount + _cardsOf(target, 'e').length;
		for (const c of _judgeCardsOf(target)) {
			const id = _cardName(c, target);
			if (!_stateOf(id)) n++;
		}
		return n;
	} catch (e) { _swallow(e); return 0; }
}

export function evaluateDestroyPenalty(player, target, context) {
	const out = {
		penalty: 0, effectivePenalty: 0, selfCreated: false, controlValue: 0,
		ids: [], relation: 0, alternativeCount: 0, reason: '',
	};
	try {
		_ensureTurn();
		if (!player || !target || target.alive === false) return out;
		const ids = strategicStateIdsIn(target);
		if (!ids.length) return out;
		out.ids = ids;
		out.relation = _relOf(player, target, context);
		let value = 0;
		for (const id of ids) {
			const st = _stateOf(id);
			const key = _stateKey(st);
			value += _rawStateValueOf(player, target, id, context);
			if (_hasConfirmedCreateBy(player, target, key)) out.selfCreated = true;
		}
		out.controlValue = Math.round(value * 1000) / 1000;
		out.penalty = Math.round(value * STRATEGIC_WEIGHT * 1000) / 1000;
		out.alternativeCount = _countAlternativeRemovals(target);
		out.effectivePenalty = out.penalty;
		if (out.penalty > 0 && out.alternativeCount > 0) {
			out.effectivePenalty = Math.round(out.penalty * TARGET_ALTERNATIVE_DISCOUNT * 1000) / 1000;
		}
		out.reason = out.selfCreated ? 'self-created-state' : 'observed-state';
		return out;
	} catch (e) { _swallow(e); return out; }
}

export function evaluateRemovalChoice(player, target, card, context) {
	const out = {
		adjustment: 0, stateValue: 0, selfCreated: false, cardId: null,
		stateKey: '', reason: 'not-strategic-state',
	};
	try {
		_ensureTurn();
		if (!player || !target || !card) return out;
		const id = _cardName(card, target);
		const st = _stateOf(id);
		if (!st) return out;
		const key = _stateKey(st);
		const value = _stateValueOf(player, target, id, context);
		const selfCreated = _hasConfirmedCreateBy(player, target, key);
		let adjustment = -value * REMOVAL_CHOICE_WEIGHT;
		if (selfCreated && value > 0) adjustment -= value * SELF_COMMITMENT_WEIGHT;
		out.cardId = id;
		out.stateKey = key;
		out.stateValue = value;
		out.selfCreated = selfCreated;
		out.adjustment = Math.round(adjustment * 1000) / 1000;
		out.reason = adjustment < 0 ? 'protect-beneficial-state'
			: (adjustment > 0 ? 'remove-harmful-state' : 'neutral-state');
		return out;
	} catch (e) { _swallow(e); return out; }
}

export function evaluateCreateConsistency(player, target, cardId, context) {
	const out = { penalty: 0, stateKey: '', prior: null, reason: '' };
	try {
		_ensureTurn();
		if (!player || !target || target.alive === false) return out;
		const st = _stateOf(cardId);
		if (!st) return out;
		const key = _stateKey(st);
		out.stateKey = key;

		for (let i = _records.length - 1; i >= 0; i--) {
			const r = _records[i];
			if (!r || r.turnEpoch !== _turnEpoch || r.stateKey !== key) continue;
			if (!_recordMatchesActor(r, player) || !_recordMatchesTarget(r, target)) continue;
			out.prior = r;

			if (r.operation === 'remove-state') {
				const committed = Math.abs(Number(r.strategicValue) || 0);
				out.penalty = Math.round(committed * REAPPLY_WEIGHT * 1000) / 1000;
				out.reason = out.penalty > 0 ? 'recreate-removed-state' : 'removed-state-zero-value';
				return out;
			}

			if (r.operation === 'create-state') {
				const active = _countByState(_stateEntriesIn(target, player, context));
				if ((active[key] || 0) > 0) {
					out.reason = 'state-still-active';
					return out;
				}
				/* 状态消失本身不代表“我自己反转了策略”。
				 * 只有同 actor 的 confirmed remove-state 才构成 REMOVE→CREATE reversal；
				 * 被无懈、判定自然结算、或被其他玩家移除后重新补挂不应受罚。 */
				out.reason = 'prior-create-no-longer-active';
				return out;
			}
		}
		return out;
	} catch (e) { _swallow(e); return out; }
}

/** engine 的唯一候选评分入口；具体牌名不出现在这里。 */
export function evaluateActionTransitionPenalty(player, target, actionId, context) {
	const out = { penalty: 0, operation: '', detail: null, reason: '' };
	try {
		_ensureTurn();
		const e = _effectOf(actionId);
		if (!e || !e.operation || !target) return out;
		out.operation = e.operation;
		if (e.operation === 'create-state') {
			const d = evaluateCreateConsistency(player, target, actionId, context);
			out.penalty = d.penalty || 0;
			out.detail = d; out.reason = d.reason || '';
		} else if (e.operation === 'remove-target-card') {
			const d = evaluateDestroyPenalty(player, target, context);
			out.penalty = d.effectivePenalty || 0;
			out.detail = d; out.reason = d.reason || '';
		}
		return out;
	} catch (e) { _swallow(e); return out; }
}

export function selfCreatedDestructionPenalty(player, target, context) {
	return evaluateDestroyPenalty(player, target, context).penalty;
}

export default {
	getJudgeCardNames, strategicStateIdsIn, delayedControlIdsIn, hasDelayedControl,
	beginStrategicTurn, clearTurnState, getStrategicTurnEpoch,
	beginStrategicAction, reconcileStrategicTransitions, getPendingStrategicActions,
	recordStateCreation, recordStrategicStateFromAction, recordControlState, recordSelfCreatedControl,
	getStrategicRecords, getControlRecords,
	evaluateDestroyPenalty, evaluateRemovalChoice, evaluateCreateConsistency,
	evaluateActionTransitionPenalty, selfCreatedDestructionPenalty,
};
