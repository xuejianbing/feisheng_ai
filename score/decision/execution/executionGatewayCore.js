/*
 * 无名AI · Execution Gateway Core
 *
 * 纯执行状态机：不直接依赖无名杀宿主。
 * production wrapper 注入 config / circuit / transaction / host state，
 * 测试可使用最小 fake 依赖验证执行契约。
 */

export const EXECUTION_KINDS = Object.freeze({
	USE: 'use',
	RESPOND: 'respond',
	DISCARD: 'discard',
	COMPARE: 'compare',
	SKILL: 'skill',
	END: 'end',
	OBSERVE: 'observe',
});

const OVERRIDE_CONFIG = Object.freeze({
	use: 'override_use',
	respond: 'override_respond',
	discard: 'override_discard',
	compare: 'override_compare',
});

const DEGRADE_WINDOW = 5000;

export function createExecutionGatewayCore(deps) {
	deps = deps || {};
	const config = typeof deps.config === 'function' ? deps.config : function (_key, fallback) { return fallback; };
	const circuitTripped = typeof deps.isTripped === 'function' ? deps.isTripped : function () { return false; };
	const circuitTrip = typeof deps.trip === 'function' ? deps.trip : function () {};
	const getGameMe = typeof deps.getGameMe === 'function' ? deps.getGameMe : function () { return null; };
	const getDecisionWindow = typeof deps.getDecisionWindow === 'function' ? deps.getDecisionWindow : () => null;
	const getCurrentPhase = typeof deps.getCurrentPhase === 'function' ? deps.getCurrentPhase : function () { return null; };
	const stageTransaction = typeof deps.stageTransaction === 'function' ? deps.stageTransaction : function () { return null; };
	const commitTransaction = typeof deps.commitTransaction === 'function' ? deps.commitTransaction : function () { return { ok: false, reason: 'no-transaction-adapter' }; };
	const cancelTransaction = typeof deps.cancelTransaction === 'function' ? deps.cancelTransaction : function () { return false; };
	const peekTransaction = typeof deps.peekTransaction === 'function' ? deps.peekTransaction : function () { return null; };

	let degraded = {
		use: new WeakMap(),
		respond: new WeakMap(),
		discard: new WeakMap(),
		compare: new WeakMap(),
	};

	const stats = {
		total: 0,
		allowed: 0,
		blocked: 0,
		hostCalls: 0,
		hostErrors: 0,
		fallbacks: 0,
		staged: 0,
		committed: 0,
		cancelled: 0,
		byKind: {},
	};

	function bucket(kind) {
		const k = String(kind || 'unknown');
		if (!stats.byKind[k]) {
			stats.byKind[k] = {
				allowed: 0, blocked: 0, hostCalls: 0, hostErrors: 0,
				fallbacks: 0, staged: 0, committed: 0, cancelled: 0,
			};
		}
		return stats.byKind[k];
	}

	function inc(kind, key) {
		try {
			if (Object.prototype.hasOwnProperty.call(stats, key) && typeof stats[key] === 'number') stats[key]++;
			const b = bucket(kind);
			if (Object.prototype.hasOwnProperty.call(b, key)) b[key]++;
		} catch (_) {}
	}

	function playerBlocked(player) {
		if (!player) return 'missing-player';
		if (player === getGameMe()) return 'local-human';
		try {
			if (player.isOnline2 && player.isOnline2()) return 'online-player';
		} catch (_) {}
		return null;
	}

	function isDegraded(kind, player) {
		try {
			const map = degraded[kind];
			if (!map || !player) return false;
			const ts = map.get(player);
			if (!ts) return false;
			if (Date.now() - ts > DEGRADE_WINDOW) {
				map.delete(player);
				return false;
			}
			return true;
		} catch (_) { return false; }
	}

	function markExecutionFailure(kind, player, reason, severity) {
		kind = String(kind || 'global');
		try {
			const map = degraded[kind];
			if (map && player) map.set(player, Date.now());
		} catch (_) {}
		try { circuitTrip(kind, reason || 'execution failure', severity || 'fatal'); } catch (_) {}
		inc(kind, 'hostErrors');
	}

	function clearExecutionDegrade(kind) {
		try {
			if (kind && degraded[kind]) {
				degraded[kind] = new WeakMap();
				return;
			}
			for (const k of Object.keys(degraded)) degraded[k] = new WeakMap();
		} catch (_) {}
	}

	function executionEligibility(kind, player, event, options) {
		options = options || {};
		kind = String(kind || '');
		stats.total++;

		const deny = function (reason) {
			inc(kind, 'blocked');
			return { ok: false, reason };
		};

		const playerReason = playerBlocked(player);
		if (playerReason) return deny(playerReason);
		if (!event && options.allowMissingEvent !== true) return deny('missing-event');

		if (options.requireHardOverride !== false) {
			if (config('hardOverride', true) === false) return deny('hard-override-off');
			const configKey = OVERRIDE_CONFIG[kind];
			if (configKey && config(configKey, true) === false) return deny(configKey + '-off');
		}

		if (options.checkCircuit !== false && circuitTripped(kind)) return deny('circuit-tripped');
		if (isDegraded(kind, player)) return deny('degraded');
		if (options.sentinel && event && event[options.sentinel]) return deny('already-overridden');

		if (options.requireCurrentPhase) {
			try {
				const currentPhase = getCurrentPhase();
				if (currentPhase && currentPhase !== player) return deny('outside-current-phase');
			} catch (_) {}
		}

		if (typeof options.extraGuard === 'function') {
			try {
				const r = options.extraGuard(player, event);
				if (r === false) return deny('extra-guard');
				if (typeof r === 'string' && r) return deny(r);
			} catch (_) {
				return deny('extra-guard-error');
			}
		}

		inc(kind, 'allowed');
		return { ok: true, reason: 'allowed' };
	}

	function isExecutionLayerEnabled(kind) {
		try {
			if (config('hardOverride', true) === false) return false;
			const key = OVERRIDE_CONFIG[kind];
			if (key && config(key, true) === false) return false;
			if (circuitTripped(kind)) return false;
			return true;
		} catch (_) { return false; }
	}

	function markExecutionSentinel(event, sentinel) {
		try {
			if (event && sentinel) event[sentinel] = true;
			return true;
		} catch (_) { return false; }
	}

	function clearExecutionSentinel(event, sentinel) {
		try {
			if (event && sentinel) delete event[sentinel];
			return true;
		} catch (_) { return false; }
	}

	function invokeHost(options) {
		options = options || {};
		const kind = String(options.kind || 'unknown');
		const player = options.player || null;
		const orig = options.orig;
		const thisArg = options.thisArg || player;
		const args = Array.isArray(options.args) ? options.args : [];
		let cleanup = null;

		if (typeof orig !== 'function') {
			return { ok: false, reason: 'missing-host-function', result: null };
		}

		try {
			if (typeof options.prepare === 'function') cleanup = options.prepare() || null;
			inc(kind, 'hostCalls');
			const result = orig.apply(thisArg, args);
			if (typeof options.onSuccess === 'function') {
				try { options.onSuccess(result); } catch (_) {}
			}
			if (options.cleanupOnSuccess === true && typeof cleanup === 'function') {
				try { cleanup(); } catch (_) {}
				cleanup = null;
			}
			return { ok: true, result, reason: 'host-ok' };
		} catch (error) {
			if (typeof cleanup === 'function') {
				try { cleanup(); } catch (_) {}
				cleanup = null;
			}
			markExecutionFailure(kind, player,
				(typeof options.failureReason === 'function' ? options.failureReason(error) : options.failureReason) ||
				('host call failed: ' + (error && error.message ? error.message : error)),
				options.severity || 'fatal');

			/* 关键安全规则：同一个宿主事件最多调用一次。
			 * 原函数抛错时无法证明它“完全没有产生副作用”，因此绝不在当前事件重入 orig。
			 * degrade/circuit 会让后续事件退回原生路径，这才是安全 fallback。 */
			inc(kind, 'fallbacks');
			return {
				ok: false,
				fallback: true,
				degraded: true,
				result: options.fallbackValue === undefined ? null : options.fallbackValue,
				error: error,
				reason: 'degraded-next-call',
			};
		}
	}

	function invokeObservedHost(options) {
		options = options || {};
		const orig = options.orig;
		if (typeof orig !== 'function') return { ok: false, result: null, reason: 'missing-host-function' };
		try {
			inc(EXECUTION_KINDS.OBSERVE, 'hostCalls');
			const result = orig.apply(options.thisArg, Array.isArray(options.args) ? options.args : []);
			return { ok: true, result, reason: 'host-ok' };
		} catch (error) {
			inc(EXECUTION_KINDS.OBSERVE, 'hostErrors');
			return { ok: false, result: null, error, reason: 'host-error' };
		}
	}

	function stageExecutionDecision(player, decision, kind) {
		try {
			const tx = decision && decision.__djscTransaction;
			if (!tx) return null;
			const previous = peekTransaction(player);
			const staged = stageTransaction(player, tx, { window: getDecisionWindow(player, false) });
			if (staged && (!previous || previous.id !== staged.id)) inc(kind || (tx.expected && tx.expected.type) || 'unknown', 'staged');
			return staged;
		} catch (_) { return null; }
	}

	function commitExecution(player, actual) {
		try {
			const result = commitTransaction(player, actual, { window: getDecisionWindow(player, true) });
			if (result && result.ok) inc((actual && actual.type) || 'unknown', 'committed');
			return result;
		} catch (error) {
			return { ok: false, reason: 'commit-exception', error };
		}
	}

	function cancelExecution(player, reason, kind) {
		try {
			const ok = cancelTransaction(player, reason);
			if (ok) inc(kind || 'unknown', 'cancelled');
			return ok;
		} catch (_) { return false; }
	}

	function pendingExecution(player) {
		try { return peekTransaction(player); } catch (_) { return null; }
	}

	function executionGatewayStats() {
		try {
			return JSON.parse(JSON.stringify(stats));
		} catch (_) {
			return { ...stats, byKind: { ...stats.byKind } };
		}
	}

	function resetExecutionGateway() {
		stats.total = 0;
		stats.allowed = 0;
		stats.blocked = 0;
		stats.hostCalls = 0;
		stats.hostErrors = 0;
		stats.fallbacks = 0;
		stats.staged = 0;
		stats.committed = 0;
		stats.cancelled = 0;
		stats.byKind = {};
		clearExecutionDegrade();
	}

	return {
		executionEligibility,
		isExecutionLayerEnabled,
		markExecutionFailure,
		clearExecutionDegrade,
		markExecutionSentinel,
		clearExecutionSentinel,
		invokeHost,
		invokeObservedHost,
		stageExecutionDecision,
		commitExecution,
		cancelExecution,
		pendingExecution,
		executionGatewayStats,
		resetExecutionGateway,
	};
}
