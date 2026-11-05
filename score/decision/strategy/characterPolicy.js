/*
 * 无名AI · Character Policy Adapter
 *
 * 复用现有 skillTagsOf / skillProfileOf，自动生成本体与扩展武将画像。
 */
import { get } from '../../foundation/adapt/host.js';
import { skillTagsOf, skillProfileOf } from '../skills/skills.js';
import { applyRelativeUtilityDelta, ensureCandidatePolicy } from '../state/actionCandidate.js';
import {
	buildCharacterPolicyCore,
	characterCardAffinity,
	characterSkillAffinity,
	characterFuelKeepBonus as coreFuelKeepBonus,
} from './characterPolicyCore.js';

const CACHE = new Map();
const MAX_CACHE = 512;

function heroIdOf(me) {
	try { return String(me && (me.name1 || me.name || me.playerid) || ''); } catch (_) { return ''; }
}

function skillIdsOf(me) {
	try {
		return Array.from(new Set((me && Array.isArray(me.skills) ? me.skills : []).filter(Boolean))).sort();
	} catch (_) { return []; }
}

function signalOf(sid) {
	try {
		const profile = skillProfileOf(sid);
		const tags = skillTagsOf(sid);
		return {
			id: sid,
			tags: tags || {},
			phases: profile && profile.timing && Array.isArray(profile.timing.allPhases)
				? profile.timing.allPhases.slice()
				: (tags && Array.isArray(tags.__phases) ? tags.__phases.slice() : []),
			primary: profile && profile.classify ? profile.classify.primary : null,
		};
	} catch (_) {
		return { id: sid, tags: {}, phases: [], primary: null };
	}
}

function staticPolicy(me) {
	const heroId = heroIdOf(me);
	const skills = skillIdsOf(me);
	const key = heroId + '|' + skills.join(',');
	if (CACHE.has(key)) return CACHE.get(key);
	const policy = buildCharacterPolicyCore({
		heroId,
		signals: skills.map(signalOf),
	});
	if (CACHE.size >= MAX_CACHE) CACHE.clear();
	CACHE.set(key, policy);
	return policy;
}

export function characterPolicyOf(me) {
	const base = staticPolicy(me);
	const hp = Number(me && me.hp) || 0;
	const maxHp = Math.max(1, Number(me && me.maxHp) || hp || 1);
	return Object.assign({}, base, {
		hpRatio: hp / maxHp,
		handCount: (() => { try { return me && me.countCards ? me.countCards('h') : 0; } catch (_) { return 0; } })(),
	});
}

export function characterPolicySnapshot(policy) {
	if (!policy) return null;
	return {
		heroId: policy.heroId || '',
		archetype: policy.archetype ? {
			primary: policy.archetype.primary,
			secondary: Array.isArray(policy.archetype.secondary) ? policy.archetype.secondary.slice() : [],
			confidence: policy.archetype.confidence,
		} : null,
		dimensions: Object.assign({}, policy.dimensions || {}),
		resource: Object.assign({}, policy.resource || {}),
		reasons: Array.isArray(policy.reasons) ? policy.reasons.slice() : [],
	};
}

function candidateSignal(candidate) {
	if (!candidate || candidate.type !== 'skill' || !candidate.id) return null;
	return signalOf(candidate.id);
}

export function applyCharacterPolicyToCandidates(me, candidates, policy) {
	const p = policy || characterPolicyOf(me);
	for (const candidate of (Array.isArray(candidates) ? candidates : [])) {
		if (!candidate) continue;
		ensureCandidatePolicy(candidate);
		const before = Number(candidate.score) || 0;
		let a = { delta: 0, reason: '' };

		if (candidate.type === 'skill') {
			a = characterSkillAffinity(p, candidateSignal(candidate), p.hpRatio);
		} else if (candidate.type === 'card' || candidate.type === 'equip') {
			a = characterCardAffinity(p, candidate.id);
		}

		if (a.delta) candidate.score = applyRelativeUtilityDelta(before, a.delta);
		candidate.characterAlignment = {
			heroId: p.heroId || '',
			archetype: p.archetype && p.archetype.primary || 'HYBRID',
			delta: Math.round((Number(a.delta) || 0) * 1000) / 1000,
			reason: a.reason || '',
			before,
			after: Number(candidate.score) || 0,
		};
	}
	return candidates;
}

export function characterFuelKeepBonus(me, card) {
	try {
		const p = characterPolicyOf(me);
		const id = typeof card === 'string'
			? card
			: ((get && get.name) ? get.name(card, me) : (card && card.name)) || '';
		return coreFuelKeepBonus(p, id);
	} catch (_) {
		return { value: 0, reason: '' };
	}
}

export function resetCharacterPolicyCache() {
	CACHE.clear();
}
