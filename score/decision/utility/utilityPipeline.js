/*
 * 无名AI · Unified Utility Pipeline
 *
 * 生产代码通过 trackUtilityStage() 包住现有评分层。
 * 它只观察 before/after 并写 Utility Vector，不改变 callback 返回值和 candidate.score。
 */
import {
	ensureUtilityVector,
	recordUtilityContribution,
	syncUtilityVector,
	utilitySnapshot,
} from './utilityVector.js';

export function initializeUtilityPipeline(candidates) {
	for (const candidate of (Array.isArray(candidates) ? candidates : [])) ensureUtilityVector(candidate);
	return candidates;
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
