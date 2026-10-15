/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · AI 协作广播 =================
 * 目的：让同阵营 AI 知道彼此的攻击意图，形成集火。
 * 通过 _status.djsc_broadcast 共享（每回合清空）。
 * 不依赖任何业务模块，叶子级。
 */
import { game, _status } from '../../foundation/adapt/host.js?v=41a';
import { getModeStrategy, isSameCamp } from '../../decision/strategy/modeStrategy.js?v=41a';
import { playerKey, resolvePlayerByKey } from '../../foundation/adapt/playerIdentity.js?v=41a';

const MAX_AGE = 3000;
const MAX_ENTRIES = 30;

function _ensure() {
	try {
		if (!_status.djsc_broadcast) _status.djsc_broadcast = [];
		if (!Array.isArray(_status.djsc_broadcast)) _status.djsc_broadcast = [];
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return _status.djsc_broadcast;
}

function _canonicalTargetKey(target) {
	try {
		if (!target) return null;
		if (typeof target === 'object') return playerKey(target);
		const resolved = resolvePlayerByKey(target, game.players || []);
		return resolved ? playerKey(resolved) : null;
	} catch (e) { return null; }
}

export function broadcastIntent(from, target, cardId, score) {
	try {
		const fromKey = playerKey(from);
		const targetKey = _canonicalTargetKey(target);
		if (!fromKey || !targetKey) return;
		const arr = _ensure();
		let fromCamp = 'unknown';
		try { fromCamp = getModeStrategy().getCamp(from); } catch (eC) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eC); }
		arr.push({
			from: fromKey,
			fromIdentity: from.identity || '',
			fromCamp: fromCamp,
			target: targetKey,
			card: cardId || '',
			score: score || 0,
			ts: Date.now(),
		});
		while (arr.length > MAX_ENTRIES) arr.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function readIntents(me, target) {
	try {
		const meKey = playerKey(me);
		const targetKey = _canonicalTargetKey(target);
		if (!meKey || !targetKey) return [];
		const arr = _ensure();
		const now = Date.now();
		let myCamp = 'unknown';
		try { myCamp = getModeStrategy().getCamp(me); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return arr.filter(function (e) {
			if (now - e.ts > MAX_AGE) return false;
			if (e.from === meKey) return false;
			if (e.target !== targetKey) return false;
			let eCamp = e.fromCamp;
			if (!eCamp) {
				try { eCamp = _campOf(e.fromIdentity); } catch (err) { eCamp = 'unknown'; }
			}
			return eCamp === myCamp;
		});
	} catch (e) { return []; }
}

export function focusBonus(me, target) {
	try {
		const targetKey = _canonicalTargetKey(target);
		if (!targetKey) return 1.0;
		const intents = readIntents(me, targetKey);
		if (!intents.length) return 1.0;
		let bonus = Math.min(0.6, intents.length * 0.15);
		const avgScore = intents.reduce(function (sum, e) { return sum + (e.score || 0); }, 0) / intents.length;
		if (avgScore >= 8) bonus += 0.2;
		else if (avgScore >= 5) bonus += 0.1;
		try {
			const targetObj = resolvePlayerByKey(targetKey, game.players || []);
			if (targetObj && targetObj.hp !== undefined && targetObj.hp <= 1) bonus += 0.3;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		return 1.0 + bonus;
	} catch (e) { return 1.0; }
}

function _camp(p) {
	try {
		const id = (p && p.identity) || '';
		return _campOf(id);
	} catch (e) { return 'unknown'; }
}
function _campOf(id) {
	if (id === 'zhu' || id === 'zhong' || id === 'mingzhong') return 'loyal';
	if (id === 'fan') return 'rebel';
	if (id === 'nei') return 'nei';
	return 'unknown';
}

let _hooked = false;
let _origCheck = null;   /* ★ Stage H：保存 game.check 原函数供卸载还原 */
export function installBroadcastHooks() {
	if (_hooked) return;
	try {
		const orig = game.check;
		if (typeof orig !== 'function') return;
		_origCheck = orig;
		game.check = function () {
			try { _ensure().length = 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			return orig.apply(this, arguments);
		};
		_hooked = true;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ Stage H：卸载广播钩子（还原 game.check），供 engine.uninstallHooks 调用 */
export function uninstallBroadcastHooks() {
	try {
		if (_hooked && _origCheck) {
			game.check = _origCheck;
		}
		_hooked = false;
		_origCheck = null;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 面板/调试用：当前广播快照 */
export function snapshotBroadcast() {
	try {
		return _ensure().slice();
	} catch (e) { return []; }
}

/* 手动清空（面板按钮用） */
export function clearBroadcast() {
	try { _ensure().length = 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
