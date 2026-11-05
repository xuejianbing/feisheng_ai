/*
 * 无名AI · 决策事务
 *
 * 目标：
 *   Evaluate 只产生“建议事务”；
 *   Commit 只在宿主真正执行与建议一致的动作时发生；
 *   Outcome 由既有效果/结算钩子继续回填。
 *
 * 该模块不依赖宿主对象，只维护每个玩家当前待提交事务。
 */

let _seq = 0;
let _pending = new WeakMap();
const _stats = {
	evaluated: 0,
	staged: 0,
	committed: 0,
	mismatched: 0,
	expired: 0,
	cancelled: 0,
	superseded: 0,
	commitErrors: 0,
};

const DEFAULT_TTL = 5000;

function _targetList(value) {
	if (value === undefined || value === null || value === '') return [];
	const arr = Array.isArray(value) ? value : [value];
	return arr.map(function (x) {
		if (x === undefined || x === null) return '';
		if (typeof x === 'string' || typeof x === 'number') return String(x);
		try {
			return String(x.playerid || x.name1 || x.name || x.name2 || '');
		} catch (e) { return ''; }
	}).filter(Boolean).sort();
}

function _sameTargets(a, b) {
	const aa = _targetList(a), bb = _targetList(b);
	if (!aa.length) return true;   // expected 未绑定目标时，只校验动作本身
	if (!bb.length || aa.length !== bb.length) return false;
	for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
	return true;
}

function _expired(tx, now) {
	return !!(tx && tx.expiresAt && now > tx.expiresAt);
}

export function createDecisionTransaction(expected, commit, options) {
	options = options || {};
	const now = Date.now();
	const tx = {
		id: 'dtx_' + now.toString(36) + '_' + (++_seq).toString(36),
		state: 'evaluated',
		createdAt: now,
		expiresAt: now + Math.max(250, Number(options.ttl) || DEFAULT_TTL),
		expected: {
			type: expected && expected.type ? String(expected.type) : '',
			id: expected && expected.id ? String(expected.id) : '',
			target: expected ? expected.target : null,
		},
		meta: options.meta || null,
		commit: typeof commit === 'function' ? commit : null,
	};
	_stats.evaluated++;
	return tx;
}

export function stageDecisionTransaction(player, tx) {
	if (!player || !tx || !tx.id) return null;
	/* 缓存命中可能返回同一个 transaction 对象。
	 * terminal transaction 绝不能重新 stage，否则同一决策可被重复学习/广播。
	 * 终态检查必须先于 TTL，避免 committed 事务过期后被改写成 expired。 */
	if (tx.state === 'committed' || tx.state === 'mismatched' ||
		tx.state === 'cancelled' || tx.state === 'expired' || tx.state === 'superseded') {
		return null;
	}
	const now = Date.now();
	if (_expired(tx, now)) {
		tx.state = 'expired';
		_stats.expired++;
		return null;
	}
	const old = _pending.get(player);
	if (old && old.id === tx.id) return old.state === 'staged' ? tx : null;
	if (old && old.state === 'staged') {
		old.state = 'superseded';
		_stats.superseded++;
	}
	tx.state = 'staged';
	tx.stagedAt = now;
	_pending.set(player, tx);
	_stats.staged++;
	return tx;
}

export function peekDecisionTransaction(player) {
	if (!player) return null;
	const tx = _pending.get(player);
	if (!tx) return null;
	if (_expired(tx, Date.now())) {
		tx.state = 'expired';
		_pending.delete(player);
		_stats.expired++;
		return null;
	}
	return tx;
}

export function cancelDecisionTransaction(player, reason) {
	const tx = peekDecisionTransaction(player);
	if (!tx) return false;
	_pending.delete(player);
	tx.state = 'cancelled';
	tx.cancelReason = reason || 'cancelled';
	_stats.cancelled++;
	return true;
}

export function commitDecisionTransaction(player, actual) {
	const tx = peekDecisionTransaction(player);
	if (!tx) return { ok: false, reason: 'no-pending' };
	const a = actual || {};
	const actualType = a.type ? String(a.type) : '';
	const actualId = a.id ? String(a.id) : '';

	/* 不同类别的宿主事件不应误伤待提交事务。
	 * 例如卡牌内部触发 logSkill 时，不能因此取消待提交的 card 事务。 */
	if (actualType && tx.expected.type && actualType !== tx.expected.type) {
		return { ok: false, reason: 'different-type', tx: tx };
	}

	const idMatch = !tx.expected.id || tx.expected.id === actualId;
	const targetMatch = _sameTargets(tx.expected.target, a.target);
	if (!idMatch || !targetMatch) {
		_pending.delete(player);
		tx.state = 'mismatched';
		tx.actual = { type: actualType, id: actualId, target: a.target || null };
		_stats.mismatched++;
		return { ok: false, reason: !idMatch ? 'id-mismatch' : 'target-mismatch', tx: tx };
	}

	_pending.delete(player);
	tx.state = 'committed';
	tx.committedAt = Date.now();
	tx.actual = { type: actualType, id: actualId, target: a.target || null };
	_stats.committed++;

	if (tx.commit) {
		try {
			tx.commit(tx.actual, tx);
		} catch (e) {
			tx.commitError = String(e && e.message ? e.message : e);
			_stats.commitErrors++;
			return { ok: false, reason: 'commit-error', tx: tx, error: e };
		}
	}
	return { ok: true, tx: tx };
}

export function decisionTransactionStats() {
	const out = {};
	for (const k in _stats) out[k] = _stats[k];
	return out;
}

export function resetDecisionTransactionStats() {
	for (const k in _stats) _stats[k] = 0;
	/* 新局/重置时同时丢弃所有未提交事务；WeakMap 无 clear，直接换实例。 */
	_pending = new WeakMap();
}
