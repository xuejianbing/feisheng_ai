/*
 * 统一游戏阶段判定。
 * 人数残局优先于轮次阶段，避免同一局面在不同模块中同时被解释为 early / late / endgame。
 */
import { game, _status } from '../../foundation/adapt/host.js';

export const GAME_PHASE = Object.freeze({
	EARLY: 'early',
	MID: 'mid',
	LATE: 'late',
	ENDGAME: 'endgame',
});

export function countAlivePlayers() {
	try {
		return (game.players || []).filter(function (p) {
			return p && p.alive !== false;
		}).length;
	} catch (e) {
		return 0;
	}
}

export function currentRoundNumber() {
	try {
		if (_status && typeof _status.roundNumber === 'number') return _status.roundNumber;
		if (game && typeof game.roundNumber === 'number') return game.roundNumber;
	} catch (e) {}
	return 1;
}

export function getGamePhase() {
	const alive = Math.max(0, countAlivePlayers());
	const round = Math.max(1, currentRoundNumber());

	let phase = GAME_PHASE.MID;
	/* 人数残局是局面事实，优先于“第几轮”。 */
	if (alive > 0 && alive <= 4) phase = GAME_PHASE.ENDGAME;
	else if (round <= 3) phase = GAME_PHASE.EARLY;
	else if (round >= 8) phase = GAME_PHASE.LATE;

	return { phase: phase, stage: phase, alive: alive, round: round };
}

export function isEndgamePhase() {
	return getGamePhase().phase === GAME_PHASE.ENDGAME;
}
