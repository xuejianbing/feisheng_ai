import { hostGameResult } from './gameResult.js?v=5e5';
/* 纯观测统计：累计计数独立于有界日志，不参与评分、执行或学习。 */
export function createGameTelemetry() {
	let players, totals, turns, active, verdict;
	function reset() {
		players = new Map(); totals = { decisions: 0, scoreEvents: 0, actions: 0, completedTurns: 0 };
		turns = []; active = null; verdict = 'unknown';
	}
	function stats(player) {
		if (!players.has(player)) players.set(player, { actions: 0, decisions: 0 });
		return players.get(player);
	}
	function finishTurn(player, partial = false) {
		if (!active || (player && active.player !== player)) return null;
		const now = stats(active.player);
		const result = { player: active.name, round: active.round, actions: now.actions - active.actions,
			decisions: now.decisions - active.decisions, partial };
		if (active.player && active.player.playerid) result.playerId = active.player.playerid;
		turns.push(result); if (turns.length > 100) turns.shift();
		if (!partial) totals.completedTurns++;
		active = null; return result;
	}
	function beginTurn(player, name, round) {
		const previous = finishTurn(null, true);
		const current = stats(player);
		active = { player, name, round, actions: current.actions, decisions: current.decisions };
		return previous;
	}
	reset();
	return {
		reset, beginTurn, finishTurn,
		action(player) { totals.actions++; stats(player).actions++; },
		decision(player) { totals.decisions++; if (player) stats(player).decisions++; },
		score() { totals.scoreEvents++; },
		setResult(result, onlineResult, online = false) {
			verdict = hostGameResult(result, onlineResult, online);
		},
		snapshot() { return { ...totals, verdict, turns: turns.map(x => ({ ...x })) }; },
	};
}
