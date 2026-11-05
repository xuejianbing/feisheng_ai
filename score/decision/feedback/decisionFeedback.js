/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';

/* ================= 决策积分引擎 · 决策维度反馈闭环 =================
 * - target:  对目标采取行动后的长期结果
 * - tempo:   某阶段的长期结果
 * - play:    实际使用某类牌后的长期结果
 * - keep:    预留给未来真正的“保留行为”反馈，不再由 used-card 数据伪造
 */
const KEY = '无名AI_decisionFeedback';
const VERSION = 2;
const DECAY = 0.7;
const MIN_SAMPLES = 5;
const RATIO_MIN = 0.7;
const RATIO_MAX = 1.4;
const KINDS = ['target', 'tempo', 'play', 'keep'];

function _emptyState() {
	return { v: VERSION, target: {}, tempo: {}, play: {}, keep: {} };
}

let FB = _emptyState();
let _loaded = false;
let _pending = { target: [], tempo: [], play: [], keep: [] };

function _normalizeKindMap(v) {
	return v && typeof v === 'object' ? v : {};
}

function _migrate(raw) {
	if (!raw || typeof raw !== 'object') return _emptyState();

	if (raw.v === VERSION) {
		return {
			v: VERSION,
			target: _normalizeKindMap(raw.target),
			tempo: _normalizeKindMap(raw.tempo),
			play: _normalizeKindMap(raw.play),
			keep: _normalizeKindMap(raw.keep),
		};
	}

	if (raw.v === 1) {
		/* v1 的 keep 来源是 REC.cards（已使用的牌），真实语义属于 play。 */
		return {
			v: VERSION,
			target: _normalizeKindMap(raw.target),
			tempo: _normalizeKindMap(raw.tempo),
			play: Object.assign({}, _normalizeKindMap(raw.keep), _normalizeKindMap(raw.play)),
			keep: {},
		};
	}

	return _emptyState();
}

export function loadDecisionFeedback() {
	try {
		if (_loaded) return;
		const raw = _lsGet(KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			FB = _migrate(parsed);
			if (!parsed || parsed.v !== VERSION) {
				_lsSet(KEY, JSON.stringify(FB));
			}
		}
		_loaded = true;
	} catch (e) {
		FB = _emptyState();
		_loaded = true;
	}
}

export function saveDecisionFeedback() {
	try { _lsSet(KEY, JSON.stringify(FB)); } catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
	}
}

function _record(kind, key, win) {
	try {
		if (KINDS.indexOf(kind) < 0 || !key) return;
		_pending[kind].push({ key: String(key), win: win ? 1 : 0, ts: Date.now() });
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
	}
}

export const recordTargetOutcome = function (targetKey, win) { _record('target', targetKey, win); };
export const recordTempoOutcome  = function (stage, win) { _record('tempo', stage, win); };
export const recordPlayOutcome   = function (cardId, win) { _record('play', cardId, win); };
export const recordKeepOutcome   = function (cardId, win) { _record('keep', cardId, win); };

function _flushKind(kind) {
	try {
		const arr = _pending[kind];
		if (!arr.length) return 0;
		const byKey = {};
		for (const it of arr) {
			if (!byKey[it.key]) byKey[it.key] = { win: 0, total: 0 };
			byKey[it.key].win += it.win;
			byKey[it.key].total++;
		}
		let updated = 0;
		for (const k in byKey) {
			const s = byKey[k];
			const wr = s.win / s.total;
			const rawRatio = 1.0 + (wr - 0.5) * 0.8;
			const ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, rawRatio));
			if (!FB[kind]) FB[kind] = {};
			const f = FB[kind][k] || { ratio: 1.0, samples: 0, lastUpdate: 0 };
			if (f.samples < 1) f.ratio = ratio;
			else f.ratio = f.ratio * DECAY + ratio * (1 - DECAY);
			f.ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, f.ratio));
			f.samples += s.total;
			f.lastUpdate = Date.now();
			FB[kind][k] = f;
			updated++;
		}
		_pending[kind] = [];
		return updated;
	} catch (e) {
		_pending[kind] = [];
		return 0;
	}
}

export function flushDecisionFeedback() {
	try {
		let n = 0;
		for (const kind of KINDS) n += _flushKind(kind);
		if (n > 0) saveDecisionFeedback();
		return n;
	} catch (e) {
		return 0;
	}
}

export function getDecisionBonus(kind, key) {
	try {
		loadDecisionFeedback();
		if (KINDS.indexOf(kind) < 0 || !key) return 1.0;
		const f = FB[kind] && FB[kind][String(key)];
		if (!f || f.samples < MIN_SAMPLES) return 1.0;
		return f.ratio;
	} catch (e) {
		return 1.0;
	}
}

/* 人工标记：与 engine 消费的维度保持同名。 */
export function markOutcome(kind, key, good, ratio) {
	try {
		loadDecisionFeedback();
		if (KINDS.indexOf(kind) < 0 || !key) return false;
		const k = String(key);
		if (!FB[kind]) FB[kind] = {};
		const f = FB[kind][k] || { ratio: 1.0, samples: 0, lastUpdate: 0 };
		const target = (typeof ratio === 'number') ? ratio : (good ? RATIO_MAX : RATIO_MIN);
		f.ratio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, target));
		f.samples = Math.max(f.samples + 1, MIN_SAMPLES);
		f.marked = (f.marked || 0) + 1;
		f.lastUpdate = Date.now();
		FB[kind][k] = f;
		saveDecisionFeedback();
		return true;
	} catch (e) {
		return false;
	}
}

export function getDecisionFeedbackStats() {
	try {
		loadDecisionFeedback();
		const out = [];
		KINDS.forEach(function (kind) {
			for (const k in (FB[kind] || {})) {
				const f = FB[kind][k];
				out.push({
					kind: kind,
					key: k,
					ratio: Math.round(f.ratio * 100) / 100,
					samples: f.samples,
					active: f.samples >= MIN_SAMPLES && Math.abs(f.ratio - 1) >= 0.08,
				});
			}
		});
		out.sort(function (a, b) { return Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1); });
		return out;
	} catch (e) {
		return [];
	}
}

export function resetDecisionFeedback() {
	try {
		FB = _emptyState();
		_pending = { target: [], tempo: [], play: [], keep: [] };
		_loaded = true;
		_lsRemove(KEY);
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
	}
}
