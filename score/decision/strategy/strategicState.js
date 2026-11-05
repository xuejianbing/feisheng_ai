/*
 * 无名AI · Strategic Intent lifecycle
 *
 * 同一回合保持战略稳定；只有关键公开状态变化时才刷新。
 */
import { _status } from '../../foundation/adapt/host.js';
import { resolveStrategicIntent, objectiveFingerprint } from './objective.js';
import { shouldRefreshStrategicState, makeStrategicStateRecord } from './strategicStateCore.js';

let _state = new WeakMap();

function turnKey(player) {
	try {
		const round = (_status && _status.roundNumber) || 0;
		const current = _status && _status.currentPhase;
		const currentKey = current && (current.name1 || current.name || current.playerid || '?');
		const playerKey = player && (player.name1 || player.name || player.playerid || '?');
		return round + '|' + currentKey + '|' + playerKey;
	} catch (_) { return '0|?|?'; }
}

export function getStrategicState(player, options) {
	options = options || {};
	if (!player) return null;
	const fresh = resolveStrategicIntent(player);
	const fingerprint = objectiveFingerprint(fresh && fresh.context);
	const tKey = turnKey(player);
	const old = _state.get(player);

	if (!shouldRefreshStrategicState(old, tKey, fingerprint, options.force === true)) return old;

	const state = makeStrategicStateRecord(old, tKey, fingerprint, fresh);
	_state.set(player, state);
	return state;
}

export function strategicStateSnapshot(player) {
	const s = player ? _state.get(player) : null;
	if (!s) return null;
	return {
		turnKey: s.turnKey,
		victory: Array.isArray(s.victory) ? s.victory.slice() : [],
		roleObjective: s.roleObjective,
		intent: s.intent ? Object.assign({}, s.intent, {
			reasons: Array.isArray(s.intent.reasons) ? s.intent.reasons.slice() : [],
		}) : null,
	};
}

export function resetStrategicState(player) {
	if (player) {
		try { _state.delete(player); } catch (_) {}
		return;
	}
	_state = new WeakMap();
}
