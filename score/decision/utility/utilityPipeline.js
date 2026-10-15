/*
 * 无名AI · Unified Utility Pipeline
 *
 * 生产代码通过 trackUtilityStage() 包住现有评分层。
 * track只观察before/after；已迁移信号通过applyOwnedUtility独占写入实际分数。
 */
import {
	ensureUtilityVector,
	recordUtilityContribution,
	syncUtilityVector,
	utilitySnapshot,
} from './utilityVector.js?v=41a';

export function initializeUtilityPipeline(candidates) {
	for (const candidate of (Array.isArray(candidates) ? candidates : [])) ensureUtilityVector(candidate);
	return candidates;
}

/* 已迁移的信号由账本写入实际分数，同一候选的同一来源只能结算一次。
 * 先完整校验再修改；不能把非法项当零，留下半份收益或已占用的来源。 */
export function applyOwnedUtility(candidate, source, terms) {
	if (!candidate || typeof candidate !== 'object' || typeof source !== 'string' || !source) throw new TypeError('Invalid utility owner');
	if (!Array.isArray(terms) || terms.some(t => !t || typeof t.delta !== 'number' || !Number.isFinite(t.delta))) throw new TypeError('Invalid utility terms');
	const before = Number(candidate.score);
	let total = before;
	if (!Number.isFinite(before)) throw new TypeError('Invalid utility score');
	for (const term of terms) {
		total += term.delta;
		if (!Number.isFinite(total)) throw new TypeError('Invalid utility score');
	}
	const vector = ensureUtilityVector(candidate);
	const owners = vector.ownedSources || (vector.ownedSources = []);
	if (owners.includes(source)) return false;
	owners.push(source);
	for (const term of terms) {
		const start = candidate.score;
		candidate.score += term.delta;
		recordUtilityContribution(candidate, { source, dimension: term.dimension, before: start, after: candidate.score, note: term.note, details: term.details, includeZero: true });
	}
	syncUtilityVector(candidate);
	return true;
}

function scoreMap(candidates) {
	const map = new Map();
	for (const candidate of (Array.isArray(candidates) ? candidates : [])) {
		if (!candidate || typeof candidate !== 'object') continue;
		map.set(candidate, Number(candidate.score) || 0);
	}
	return map;
}

export function trackUtilityStage(candidates, source, dimension, callback, note) {
	const list = Array.isArray(candidates) ? candidates : [];
	initializeUtilityPipeline(list);
	const before = scoreMap(list);
	let result;
	try {
		result = typeof callback === 'function' ? callback() : undefined;
	} finally {
		for (const candidate of list) {
			if (!candidate || !before.has(candidate)) continue;
			recordUtilityContribution(candidate, {
				source,
				dimension,
				before: before.get(candidate),
				after: Number(candidate.score) || 0,
				note,
			});
		}
	}
	return result;
}

export function finalizeUtilityPipeline(candidates) {
	for (const candidate of (Array.isArray(candidates) ? candidates : [])) syncUtilityVector(candidate);
	return candidates;
}

export function utilityPipelineSnapshot(candidate) {
	return utilitySnapshot(candidate);
}

export function utilityParity(candidate, tolerance) {
	const v = syncUtilityVector(candidate);
	if (!v) return { ok: true, diff: 0 };
	const limit = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : 0.011;
	const diff = Math.abs(Number(v.residual) || 0);
	return { ok: diff <= limit, diff, shadow: v.shadowUtility, canonical: v.canonicalScore };
}
