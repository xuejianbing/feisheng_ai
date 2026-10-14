/*
 * 决策边际统一定义。
 *
 * 运行时 utility 可以因评分系统演进而整体缩放；任何“是否接近 / 是否值得改判”的门槛
 * 都不得直接依赖绝对 score 差值。这里统一使用：
 *
 *   margin = |a - b| / max(1, |a| + |b|)
 *
 * 因此 8 vs 6 与 80 vs 60 得到相同的决策强度。
 */

export const DECISION_MARGIN = Object.freeze({
	CLOSE: 0.12,
	CLEAR: 0.30,
	PLANNER_REPLACE: 0.10,
});

function finiteNumber(x) {
	const n = Number(x);
	return Number.isFinite(n) ? n : 0;
}

export function absoluteGap(a, b) {
	return Math.abs(finiteNumber(a) - finiteNumber(b));
}

export function normalizedMargin(a, b) {
	const x = finiteNumber(a);
	const y = finiteNumber(b);
	return absoluteGap(x, y) / Math.max(1, Math.abs(x) + Math.abs(y));
}

export function signedNormalizedImprovement(current, proposed) {
	const a = finiteNumber(current);
	const b = finiteNumber(proposed);
	return (b - a) / Math.max(1, Math.abs(a) + Math.abs(b));
}

export function isCloseDecision(a, b, limit) {
	const lim = Number.isFinite(Number(limit)) ? Number(limit) : DECISION_MARGIN.CLOSE;
	return normalizedMargin(a, b) <= lim;
}

export function candidateSpread(candidates) {
	const vals = (Array.isArray(candidates) ? candidates : [])
		.map(function (c) { return c && finiteNumber(c.score); })
		.filter(function (n) { return Number.isFinite(n); });
	if (!vals.length) return { min: 0, max: 0, absolute: 0, normalized: 0 };
	let min = vals[0], max = vals[0];
	for (let i = 1; i < vals.length; i++) {
		if (vals[i] < min) min = vals[i];
		if (vals[i] > max) max = vals[i];
	}
	return {
		min: min,
		max: max,
		absolute: max - min,
		normalized: normalizedMargin(max, min),
	};
}
