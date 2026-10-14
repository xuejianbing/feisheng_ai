/*
 * 无名AI · Utility Vector
 *
 * #39 第一阶段采用双轨：
 * - candidate.score为正式排序分，未迁移路径保留legacy；
 * - 已迁移来源通过applyOwnedUtility形成实际分数，保留来源独占记录；
 * - utilityVector 记录可解释的语义贡献；
 * - 候选生成前已经形成的复杂专项分暂记为 legacyBase；
 * - 统一后处理层逐步迁移到明确维度。
 */

export const UTILITY_DIMENSIONS = Object.freeze([
	'offense',
	'control',
	'resource',
	'survival',
	'team',
	'tempo',
	'future',
	'synergy',
	'risk',
	'resourceCost',
	'opportunityCost',
	'uncertainty',
	'legacyResidual',
]);

const COST_DIMENSIONS = new Set([
	'risk', 'resourceCost', 'opportunityCost', 'uncertainty',
]);

function finite(v, fallback) {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function round(v) {
	return Math.round(finite(v, 0) * 10000) / 10000;
}

function blankDimensions() {
	const out = {};
	for (const k of UTILITY_DIMENSIONS) out[k] = 0;
	return out;
}

export function ensureUtilityVector(candidate) {
	if (!candidate || typeof candidate !== 'object') return null;
	if (candidate.utilityVector && candidate.utilityVector.schemaVersion === 1) return candidate.utilityVector;
	const base = finite(candidate.score, 0);
	const vector = {
		schemaVersion: 1,
		legacyBase: round(base),
		dimensions: blankDimensions(),
		contributions: [],
		trackedDelta: 0,
		shadowUtility: round(base),
		canonicalScore: round(base),
		residual: 0,
		trackedStages: 0,
		ownedSources: [],
	};
	try {
		Object.defineProperty(candidate, 'utilityVector', {
			value: vector,
			writable: true,
			configurable: true,
			enumerable: false,
		});
	} catch (_) {
		candidate.utilityVector = vector;
	}
	return vector;
}

export function recordUtilityContribution(candidate, spec) {
	const vector = ensureUtilityVector(candidate);
	if (!vector) return null;
	spec = spec || {};
	const dimension = UTILITY_DIMENSIONS.indexOf(spec.dimension) >= 0
		? spec.dimension : 'legacyResidual';
	const before = finite(spec.before, candidate.score);
	const after = finite(spec.after, candidate.score);
	const delta = round(after - before);
	if (!delta && !spec.includeZero) return vector;

	vector.dimensions[dimension] = round((vector.dimensions[dimension] || 0) + delta);
	const contribution = {
		source: String(spec.source || 'unknown'),
		dimension,
		delta,
		before: round(before),
		after: round(after),
		note: String(spec.note || ''),
	};
	// 仅保存可序列化的标量，不保留宿主对象；供后续检查读取数值来源。
	if (spec.details && typeof spec.details === 'object') {
		contribution.details = Object.fromEntries(Object.entries(spec.details).filter(([, value]) =>
			typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))));
	}
	vector.contributions.push(contribution);
	vector.trackedDelta = round(vector.trackedDelta + delta);
	vector.trackedStages++;
	syncUtilityVector(candidate);
	return vector;
}

export function syncUtilityVector(candidate) {
	const vector = ensureUtilityVector(candidate);
	if (!vector) return null;
	const canonical = finite(candidate.score, 0);
	const classified = UTILITY_DIMENSIONS.reduce(function (sum, key) {
		return sum + finite(vector.dimensions[key], 0);
	}, 0);
	const shadow = finite(vector.legacyBase, 0) + classified;
	vector.shadowUtility = round(shadow);
	vector.canonicalScore = round(canonical);
	vector.residual = round(canonical - shadow);
	return vector;
}

export function utilitySnapshot(candidate) {
	const v = syncUtilityVector(candidate);
	if (!v) return null;
	return {
		schemaVersion: v.schemaVersion,
		legacyBase: v.legacyBase,
		dimensions: Object.assign({}, v.dimensions),
		contributionCount: v.contributions.length,
		contributionsTruncated: v.contributions.length > 96,
		contributions: v.contributions.slice(0, 96).map(function (c) { return c.details ? { ...c, details: { ...c.details } } : { ...c }; }),
		trackedDelta: v.trackedDelta,
		shadowUtility: v.shadowUtility,
		canonicalScore: v.canonicalScore,
		residual: v.residual,
		trackedStages: v.trackedStages,
		ownedSources: (v.ownedSources || []).slice(),
	};
}

export function utilityCostSummary(candidate) {
	const v = ensureUtilityVector(candidate);
	const out = { gains: 0, costs: 0 };
	if (!v) return out;
	for (const key of UTILITY_DIMENSIONS) {
		const value = finite(v.dimensions[key], 0);
		if (COST_DIMENSIONS.has(key)) {
			if (value < 0) out.costs += -value;
			else out.gains += value;
		} else if (value >= 0) out.gains += value;
		else out.costs += -value;
	}
	out.gains = round(out.gains);
	out.costs = round(out.costs);
	return out;
}
