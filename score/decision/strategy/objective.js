/*
 * 无名AI · Unified Objective Adapter
 *
 * 只把宿主公开事实、observer-specific identity posterior 与行动者自身信息
 * 转换成 objectiveCore 所需的纯上下文。
 */
import { game } from '../../foundation/adapt/host.js';
import { getModeStrategy } from './modeStrategy.js';
import { hardIdentityOf, beliefOfFor, confidenceOfFor } from '../../perception/observer/identity.js';
import { evaluateSpyStance } from './identityStance.js';
import { dispositionOf } from '../relations/relations.js';
import { classifyIdentityRisk, resolveStrategicIntentCore } from './objectiveCore.js';

function keyOf(p) {
	try { return p && (p.name1 || p.name || p.playerid || p.id) || null; } catch (_) { return null; }
}

function normalizeSelfRole(me, mode) {
	try {
		if (mode === 'identity' || mode === 'connect') {
			if (me === game.zhu) return 'zhu';
			const id = String(me.identity || 'unknown');
			return id === 'mingzhong' ? 'zhong' : id;
		}
		const strategy = getModeStrategy();
		if (mode === 'doudizhu' && strategy && strategy.getCamp) return strategy.getCamp(me);
		if (strategy && strategy.getCamp) return strategy.getCamp(me);
	} catch (_) {}
	return 'unknown';
}

function safeCount(p, zone) {
	try { return p && p.countCards ? Number(p.countCards(zone)) || 0 : 0; } catch (_) { return 0; }
}

function publicThreat(p) {
	/* 手牌数量与装备数量是公开信息；不读取对手具体手牌内容。 */
	return safeCount(p, 'h') * 0.25 + safeCount(p, 'e') * 0.45 + Math.max(0, Number(p && p.hp) || 0) * 0.1;
}

export function buildObjectiveContext(me) {
	const strategy = getModeStrategy();
	const mode = strategy && strategy.name ? String(strategy.name) : 'generic';
	const selfRole = normalizeSelfRole(me, mode);
	const alive = (game.players || []).filter(function (p) { return p && p.alive !== false; });
	const lord = game.zhu || null;

	const targets = alive.filter(function (p) { return p && p !== me; }).map(function (p) {
		let hardRole = null, belief = null, confidence = 0, relation = 'neutral';
		try {
			if (mode === 'identity' || mode === 'connect') {
				if (p === lord) hardRole = 'zhu';
				else hardRole = (hardIdentityOf(me, p) || {}).role || null;
				belief = beliefOfFor(me, p);
				confidence = confidenceOfFor(me, p);
			} else if (strategy && strategy.getCamp) {
				hardRole = strategy.getCamp(p);
			}
		} catch (_) {}
		try {
			const d = dispositionOf(me, p);
			relation = d < 0 ? 'enemy' : (d > 0 ? 'ally' : 'neutral');
		} catch (_) {}
		const snapshot = {
			key: keyOf(p),
			alive: p.alive !== false,
			hp: Number(p.hp) || 0,
			maxHp: Number(p.maxHp) || Math.max(1, Number(p.hp) || 1),
			hardRole,
			role: hardRole,
			belief,
			confidence,
			isLord: p === lord,
			publicThreat: publicThreat(p),
			relation,
		};
		snapshot.identityRisk = classifyIdentityRisk(selfRole, snapshot);
		return snapshot;
	});

	let spyDominantSide = 'balanced';
	if ((mode === 'identity' || mode === 'connect') && selfRole === 'nei') {
		try { spyDominantSide = evaluateSpyStance(me).dominantSide || 'balanced'; } catch (_) {}
	}

	return {
		mode,
		selfRole,
		selfKey: keyOf(me),
		selfHp: Number(me && me.hp) || 0,
		selfMaxHp: Number(me && me.maxHp) || Math.max(1, Number(me && me.hp) || 1),
		lordKey: keyOf(lord),
		lordHp: Number(lord && lord.hp),
		lordMaxHp: Number(lord && lord.maxHp),
		aliveCount: alive.length,
		ownAttackReady: (() => { try { return me && me.countCards ? me.countCards('hs', 'sha') > 0 : false; } catch (_) { return false; } })(),
		ownHasSha: (() => { try { return me && me.countCards ? me.countCards('hs', 'sha') > 0 : false; } catch (_) { return false; } })(),
		ownHasTao: (() => { try { return me.countCards('hs', 'tao') > 0; } catch (_) { return false; } })(),
		spyDominantSide,
		targets,
	};
}

export function resolveStrategicIntent(me) {
	const ctx = buildObjectiveContext(me);
	/* “可发动进攻”只看行动者自己具体手牌，属于合法私有信息。 */
	ctx.ownAttackReady = !!ctx.ownHasSha;
	return Object.assign({ context: ctx }, resolveStrategicIntentCore(ctx));
}

export function objectiveFingerprint(ctx) {
	if (!ctx) return '';
	const hpBucket = function (hp) {
		const n = Number(hp);
		if (!Number.isFinite(n)) return '?';
		if (n <= 1) return 'critical';
		if (n <= 2) return 'low';
		return 'stable';
	};
	const targetState = (ctx.targets || []).map(function (t) {
		const conf = Math.floor((Number(t.confidence) || 0) * 4) / 4;
		return [t.key, t.alive !== false ? 1 : 0, hpBucket(t.hp), t.hardRole || '',
			t.identityRisk || '', conf].join(':');
	}).sort().join(',');
	return [
		ctx.mode, ctx.selfRole, ctx.selfKey, hpBucket(ctx.selfHp), hpBucket(ctx.lordHp),
		ctx.aliveCount, ctx.ownAttackReady ? 1 : 0, ctx.spyDominantSide || '', targetState,
	].join('|');
}
