/* 职责：决策记录、回放快照与诊断输出；统一持有日志及输出去重状态。
 * 写入仍由真实 Commit 延迟回调触发，不触发第二次规划。 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { identityOfFor as _identityOfFor, hardIdentityOf as _hardIdentityOf } from '../../perception/observer/identity.js';
import { cfg } from '../../foundation/config/util.js';
import { log } from '../../foundation/diag/logger.js';
import { isEnemy } from '../strategy/modeStrategy.js';
import { strategicStateSnapshot } from '../strategy/strategicState.js';
import { characterPolicyOf, characterPolicySnapshot } from '../strategy/characterPolicy.js';
import { utilityPipelineSnapshot } from '../utility/utilityPipeline.js';
import { isEndgame } from '../tuning/endgameOpt.js';
import { candidateTargetValue, candidatePolicySnapshot } from '../state/actionCandidate.js';
import { buildDecisionTraceLines } from '../engine/decisionTrace.js';
import { recordDecisionContext } from '../../model/features/autoFeature.js';
const DECISION_LOG = [];
const DECISION_LOG_MAX = 20;

/* ★ 正确获取当前轮次（修复轮次总是0的问题） */
function _getRoundNumber() {
	try {
		if (_status && typeof _status.roundNumber === "number") return _status.roundNumber;
		if (typeof game === "object" && typeof game.roundNumber === "number") return game.roundNumber;
		if (typeof game === "object" && typeof game.round === "number") return game.round;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return 0;
}

let _lastDecisionTraceKey = '';
let _lastDecisionTraceTs = 0;

function _decisionSnapshotCandidate(c, conf) {
	if (!c) return null;
	return {
		type: c.type,
		id: c.id,
		target: candidateTargetValue(c),
		score: c.score,
		reason: (c.reason || "").slice(0, 120),
		_feat: c._feat || null,
		_conf: (conf && conf.maxProb) ? conf.maxProb : (typeof c._conf === 'number' ? c._conf : 0.3),
		strategicAlignment: c.strategicAlignment ? Object.assign({}, c.strategicAlignment) : null,
		characterAlignment: c.characterAlignment ? Object.assign({}, c.characterAlignment) : null,
		utility: utilityPipelineSnapshot(c),
		policy: candidatePolicySnapshot(c),
	};
}

function recordDecision(me, layers, candidates, winner, conf) {
	try {
		const entry = {
			ts: Date.now(),
			round: _getRoundNumber(),
			player: (me && (me.name || me.name1)) || "?",
			layers: layers,
			candidates: (candidates || []).slice(0, 8).map(function (c) {
				return _decisionSnapshotCandidate(c, null);
			}).filter(Boolean),
			winner: _decisionSnapshotCandidate(winner, conf),
			elapsedMs: null,
			phaseMs: null,
		};
		DECISION_LOG.push(entry);
		while (DECISION_LOG.length > DECISION_LOG_MAX) DECISION_LOG.shift();
		return entry;
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
		return null;
	}
}

function _emitDecisionTrace(entry) {
	try {
		const mode = String(cfg('testDecisionLog', '摘要') || '摘要');
		if (mode === '关闭') return;
		if (!entry || !entry.winner) return;

		const target = Array.isArray(entry.winner.target)
			? entry.winner.target.join('+')
			: String(entry.winner.target || '');
		const key = [entry.round, entry.player, entry.winner.type, entry.winner.id, target].join('|');
		const now = Date.now();
		if (key === _lastDecisionTraceKey && now - _lastDecisionTraceTs < 500) return;
		_lastDecisionTraceKey = key;
		_lastDecisionTraceTs = now;

		const translate = function (id) {
			try { return (lib.translate && lib.translate[id]) || id; } catch (e) { return id; }
		};
		const lines = buildDecisionTraceLines(entry, mode, translate);
		for (const line of lines) {
			try { game.log(line); } catch (e) {
				try { console.log(line); } catch (_) {}
			}
		}
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
	}
}

function _finalizeDecisionRecord(me, candidates, winner, elapsedMs, phaseMs) {
	try {
		const player = (me && (me.name || me.name1)) || "?";
		const round = _getRoundNumber();
		let entry = DECISION_LOG.length ? DECISION_LOG[DECISION_LOG.length - 1] : null;
		if (!entry || entry.player !== player || entry.round !== round) {
			entry = recordDecision(me, {}, candidates, winner, null);
		}
		if (!entry) return null;

		entry.elapsedMs = Math.max(0, Math.round(Number(elapsedMs) || 0));
		entry.phaseMs = phaseMs && typeof phaseMs === 'object' ? Object.assign({}, phaseMs) : null;
		entry.strategy = strategicStateSnapshot(me);
		entry.characterPolicy = characterPolicySnapshot(characterPolicyOf(me));
		entry.candidates = (candidates || []).slice(0, 8).map(function (c) {
			return _decisionSnapshotCandidate(c, null);
		}).filter(Boolean);
		const oldConf = entry.winner && typeof entry.winner._conf === 'number' ? entry.winner._conf : 0.3;
		entry.winner = _decisionSnapshotCandidate(winner, { maxProb: oldConf });
		_emitDecisionTrace(entry);
		return entry;
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
		return null;
	}
}

/* ★ 自动特征发现的场景上下文构造器：把"本次决策"的关键事实折叠成布尔特征。
 * 供 recordDecisionContext 使用（autoFeature 面板所需样本）。失败返回 null（零回归）。 */
function _autofeatCtx(me, best, bestT) {
	try {
		if (!me || !best) return null;
		const tgtRole = bestT ? _identityOfFor(me, bestT) : 'unknown';
		const tgtHard = bestT ? _hardIdentityOf(me, bestT) : { role: null };
		const ctx = {
			cardType: best.type === 'card' ? best.id : null,
			cardSuit: null,
			targetIsAlly: best.isEnemy === false,
			targetIsEnemy: best.isEnemy === true,
			myLowHp: (me.hp || 0) <= 2,
			myHighHp: (me.hp || 0) >= 4,
			myFewHand: me.countCards ? me.countCards('h') <= 2 : false,
			myManyHand: me.countCards ? me.countCards('h') >= 5 : false,
			tgtLowHp: !!(bestT && bestT.hp && bestT.hp <= 1),
			tgtHighHp: !!(bestT && bestT.hp && bestT.hp >= 4),
			tgtFewHand: !!(bestT && bestT.countCards && bestT.countCards('h') <= 1),
			myIdentity: me.identity || null,
			tgtIdentity: tgtRole && tgtRole !== 'unknown' ? tgtRole : null,
			tgtIdentityKnown: !!(tgtHard && tgtHard.role),
			myHasSha: me.countCards ? me.countCards('hs', 'sha') > 0 : false,
			myHasTao: me.countCards ? me.countCards('hs', 'tao') > 0 : false,
			isEndgame: (game.players || []).filter(function (p) { return p && p.alive !== false; }).length <= 3,
			distNear: bestT ? (get.distance ? (get.distance(me, bestT) <= 1) : null) : null,
		};
		if (best.type === 'card' && bestT && me.getCards) {
			const hand = me.getCards('h') || [];
			for (let i = 0; i < hand.length; i++) {
				if (hand[i] && best.id === (hand[i].name || best.id)) {
					try { ctx.cardSuit = hand[i].suit; ctx.cardLowNum = (hand[i].number || 9) <= 5; ctx.cardHighNum = (hand[i].number || 9) >= 11; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					break;
				}
			}
		}
		ctx.myHasSkill = me.skills && me.skills.length > 0;
		return ctx;
	} catch (e) { return null; }
}

/* ================= AI 性格三维解析（含身份基线修正） ================= */
export function getDecisionLog() { return DECISION_LOG; }
export function clearDecisionLog() { try { DECISION_LOG.length = 0; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
/* ★ 供 aiOverride 等模块写入决策日志（去重后调用） */
export function appendDecision(entry) {
	try {
		if (!entry || typeof entry !== 'object') return;
		DECISION_LOG.push(entry);
		while (DECISION_LOG.length > DECISION_LOG_MAX) DECISION_LOG.shift();
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export { DECISION_LOG, _getRoundNumber, _decisionSnapshotCandidate, recordDecision, _emitDecisionTrace, _finalizeDecisionRecord, _autofeatCtx };
