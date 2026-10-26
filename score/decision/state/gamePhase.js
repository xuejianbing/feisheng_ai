/*
 * 统一游戏阶段判定。
 * 2v2 完整四人局按轮次判定，普通减员才进入残局；其他模式保持既有人数优先规则。
 */
import { game, _status } from '../../foundation/adapt/host.js?v=41a';
import {readVersusMode, readVersusState} from '../../foundation/runtime/versusContext.js?v=41a';

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
	const versusMode = readVersusMode();
	if (versusMode.is2v2) {
		const state = readVersusState(game.me, versusMode);
		// 普通 2v2 减员才进入残局；替补或规则未明时不推断最终减员。
		const endgame = state.teamsReady && state.reduced && state.reserve === false;
		const phase = endgame ? GAME_PHASE.ENDGAME : round <= 3 ? GAME_PHASE.EARLY
			: round >= 8 ? GAME_PHASE.LATE : GAME_PHASE.MID;
		return {phase, stage:phase, alive, round, structure:state.structure, reserve:state.reserve};
	}

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
