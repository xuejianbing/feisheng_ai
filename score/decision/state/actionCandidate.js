/*
 * 统一动作候选契约：
 * - runtime score 始终保持 float utility，不在排序链中做 Int8 非线性量化。
 * - targetObj 与 target 必须描述同一个实际执行目标。
 * - 模型/持久化需要 Int8 时，在各自边界显式转换。
 */

export function runtimeScore(raw) {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	return Math.round(n * 100) / 100;
}

/* 相对收益增量契约：
 * delta=0 为中性；正值必须提高 utility，负值必须降低 utility。
 * 使用 |score| 作为变化基数，避免负分在普通倍率下出现方向反转。 */
export function applyRelativeUtilityDelta(score, delta) {
	const base = Number(score);
	const shift = Number(delta);
	if (!Number.isFinite(base)) return 0;
	if (!Number.isFinite(shift) || shift === 0 || base === 0) return base;
	return base + Math.abs(base) * shift;
}

export function targetKey(target) {
	if (!target) return null;
	return target.name1 || target.name || target.playerid || null;
}

export function candidateTargetValue(candidate) {
	if (!candidate) return null;
	if (candidate.targetObj) return targetKey(candidate.targetObj);
	const t = candidate.target;
	if (Array.isArray(t)) return t.map(function (x) { return (x && typeof x === 'object') ? targetKey(x) : x; }).filter(Boolean);
	if (t && typeof t === 'object') return targetKey(t);
	return t == null ? null : t;
}

export function makeActionCandidate(spec) {
	const out = Object.assign({}, spec || {});
	out.score = runtimeScore(out.score);
	ensureCandidatePolicy(out);
	if (out.targetObj) {
		const key = targetKey(out.targetObj);
		if (key) out.target = key;
	}
	if (out.target == null) out.target = null;
	return out;
}

export function hasConsistentBoundTarget(candidate) {
	if (!candidate || !candidate.targetObj) return candidate ? candidate.target == null : false;
	return targetKey(candidate.targetObj) === candidate.target;
}

function _sameTargetValue(a, b) {
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}
	return a === b;
}

/* 动作身份必须包含 type + id + 绑定目标。仅 id 相同不能视为同一个候选。 */
export function sameCandidateAction(a, b) {
	if (!a || !b) return false;
	if ((a.type || 'card') !== (b.type || 'card')) return false;
	if (a.id !== b.id) return false;
	return _sameTargetValue(candidateTargetValue(a), candidateTargetValue(b));
}


export const PRIORITY_TIER = Object.freeze({
	NORMAL: 'normal',
	CRITICAL: 'critical',
	FORCED: 'forced',
});

const _TIER_RANK = Object.freeze({
	normal: 0,
	critical: 1,
	forced: 2,
});

export function ensureCandidatePolicy(candidate) {
	if (!candidate) return null;
	const src = candidate.policy && typeof candidate.policy === 'object' ? candidate.policy : {};
	candidate.policy = {
		eligible: src.eligible !== false,
		veto: src.veto === true,
		vetoReason: src.vetoReason || '',
		priorityTier: _TIER_RANK[src.priorityTier] !== undefined ? src.priorityTier : PRIORITY_TIER.NORMAL,
		priorityValue: Number.isFinite(Number(src.priorityValue)) ? Number(src.priorityValue) : 0,
		priorityReason: src.priorityReason || '',
	};
	if (candidate.policy.veto) candidate.policy.eligible = false;
	return candidate.policy;
}

export function vetoCandidate(candidate, reason) {
	const p = ensureCandidatePolicy(candidate);
	if (!p) return candidate;
	p.eligible = false;
	p.veto = true;
	p.vetoReason = reason || p.vetoReason || '策略否决';
	return candidate;
}

export function setCandidatePriority(candidate, tier, value, reason) {
	const p = ensureCandidatePolicy(candidate);
	if (!p) return candidate;
	if (_TIER_RANK[tier] === undefined) tier = PRIORITY_TIER.NORMAL;
	p.priorityTier = tier;
	p.priorityValue = Number.isFinite(Number(value)) ? Number(value) : 0;
	p.priorityReason = reason || '';
	return candidate;
}

export function isCandidateEligible(candidate) {
	return !!(candidate && ensureCandidatePolicy(candidate).eligible !== false);
}

export function candidatePriorityRank(candidate) {
	const p = ensureCandidatePolicy(candidate);
	return p ? (_TIER_RANK[p.priorityTier] || 0) : 0;
}

/* 复核层的权限边界：
 * - normal 仍是 utility-first，因此同为 normal 即属于同一复核带；
 * - critical / forced 必须同时保持 priorityValue，不能由模型层跨策略优先级改判。 */
export function sameCandidatePolicyBand(a, b) {
	if (!isCandidateEligible(a) || !isCandidateEligible(b)) return false;
	const ar = candidatePriorityRank(a), br = candidatePriorityRank(b);
	if (ar !== br) return false;
	if (ar === 0) return true;
	const ap = ensureCandidatePolicy(a), bp = ensureCandidatePolicy(b);
	return ap.priorityValue === bp.priorityValue;
}

/* 排序契约：policy 只决定“能不能选 / 哪一层优先”，score 始终只代表真实 utility。 */
export function compareActionCandidates(a, b) {
	const ae = isCandidateEligible(a), be = isCandidateEligible(b);
	if (ae !== be) return ae ? -1 : 1;
	if (!ae && !be) return (Number(b && b.score) || 0) - (Number(a && a.score) || 0);

	const ar = candidatePriorityRank(a), br = candidatePriorityRank(b);
	if (ar !== br) return br - ar;

	const ap = ensureCandidatePolicy(a), bp = ensureCandidatePolicy(b);
	/* normal 层仍以真实 utility 为主，priorityValue 只作同分 tie-break；
	 * critical/forced 层才由显式策略优先级先裁定。 */
	if (ar === 0) {
		const utilityGap = (Number(b && b.score) || 0) - (Number(a && a.score) || 0);
		if (utilityGap !== 0) return utilityGap;
		return bp.priorityValue - ap.priorityValue;
	}
	if (ap.priorityValue !== bp.priorityValue) return bp.priorityValue - ap.priorityValue;
	return (Number(b && b.score) || 0) - (Number(a && a.score) || 0);
}


export function candidatePolicySnapshot(candidate) {
	const p = ensureCandidatePolicy(candidate);
	if (!p) return null;
	return {
		eligible: p.eligible,
		veto: p.veto,
		vetoReason: p.vetoReason,
		priorityTier: p.priorityTier,
		priorityValue: p.priorityValue,
		priorityReason: p.priorityReason,
	};
}
