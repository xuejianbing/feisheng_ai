/*
 * 无名AI · Decision Quality Baseline
 *
 * 只负责质量观测、聚合与解释，不参与候选生成、评分、排序或执行。
 * #36 的原则：先建立可测量基线，再在后续 PR 改策略。
 */

function finite(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function targetText(target) {
	if (Array.isArray(target)) return target.map(targetText).filter(Boolean).join('+');
	if (target && typeof target === 'object') {
		return String(target.name1 || target.name || target.playerid || target.id || '?');
	}
	if (target == null || target === '') return '';
	return String(target);
}

export function qualityCandidateKey(candidate) {
	if (!candidate) return 'unknown';
	return [
		String(candidate.type || 'card'),
		String(candidate.id || ''),
		targetText(candidate.target),
	].join('|');
}

export function topCandidateSnapshot(entry, limit) {
	const cap = Math.max(1, Math.min(10, Number(limit) || 3));
	if (!entry || !entry.winner) return [];

	const out = [];
	const seen = new Set();
	const push = function (candidate, source) {
		if (!candidate || out.length >= cap) return;
		const key = qualityCandidateKey(candidate);
		if (seen.has(key)) return;
		seen.add(key);
		const policy = candidate.policy && typeof candidate.policy === 'object' ? candidate.policy : {};
		out.push({
			rank: out.length + 1,
			source: source,
			type: candidate.type || 'card',
			id: candidate.id || '',
			target: targetText(candidate.target),
			score: finite(candidate.score, 0),
			reason: String(candidate.reason || ''),
			eligible: policy.eligible !== false,
			priorityTier: policy.priorityTier || 'normal',
			priorityValue: finite(policy.priorityValue, 0),
			priorityReason: String(policy.priorityReason || ''),
			strategicAlignment: candidate.strategicAlignment && typeof candidate.strategicAlignment === 'object'
				? Object.assign({}, candidate.strategicAlignment)
				: null,
			characterAlignment: candidate.characterAlignment && typeof candidate.characterAlignment === 'object'
				? Object.assign({}, candidate.characterAlignment)
				: null,
			utility: candidate.utility && typeof candidate.utility === 'object'
				? JSON.parse(JSON.stringify(candidate.utility))
				: null,
		});
	};

	push(entry.winner, 'winner');
	for (const c of (Array.isArray(entry.candidates) ? entry.candidates : [])) push(c, 'candidate');
	return out;
}

export function explainTopCandidates(entry, limit) {
	return topCandidateSnapshot(entry, limit).map(function (c) {
		const target = c.target ? '→' + c.target : '';
		const priority = c.priorityTier !== 'normal'
			? ' [' + c.priorityTier + ':' + c.priorityValue + (c.priorityReason ? ' ' + c.priorityReason : '') + ']'
			: '';
		const reason = c.reason ? '｜' + c.reason : '';
		return c.rank + '. ' + c.id + target + '｜' + c.score.toFixed(2) + priority + reason;
	});
}

export function aggregateQualityBaseline(suiteResults, catalog, audit) {
	const suites = Array.isArray(suiteResults) ? suiteResults : [];
	const defs = Array.isArray(catalog) ? catalog : [];
	const dimensions = {};
	let total = 0;
	let passed = 0;
	let failed = 0;

	for (const suite of suites) {
		const def = defs.find(function (d) { return d && d.id === suite.id; }) || {};
		const cases = Array.isArray(suite.cases) ? suite.cases : [];
		total += cases.length;
		for (const item of cases) {
			if (item && item.ok) passed++;
			else failed++;
		}
		for (const dim of (def.dimensions || [])) {
			if (!dimensions[dim]) dimensions[dim] = { cases: 0, passed: 0, failed: 0, suites: 0 };
			dimensions[dim].suites++;
			dimensions[dim].cases += cases.length;
			for (const item of cases) {
				if (item && item.ok) dimensions[dim].passed++;
				else dimensions[dim].failed++;
			}
		}
	}

	for (const key of Object.keys(dimensions)) {
		const d = dimensions[key];
		d.rate = d.cases ? Math.round((d.passed / d.cases) * 10000) / 100 : 0;
	}
	return {
		suites: suites.length,
		cases: total,
		passed: passed,
		failed: failed,
		verifiedRate: total ? Math.round((passed / total) * 10000) / 100 : 0,
		dimensions: dimensions,
		hiddenInfo: {
			knownDebt: audit && Array.isArray(audit.known) ? audit.known.length : 0,
			newFindings: audit && Array.isArray(audit.unexpected) ? audit.unexpected.length : 0,
			resolvedDebt: audit && Array.isArray(audit.resolved) ? audit.resolved.length : 0,
		},
	};
}

export function formatQualityBaseline(report) {
	report = report || {};
	const lines = [];
	lines.push('AI Decision Quality Baseline');
	lines.push('verified cases: ' + (report.passed || 0) + '/' + (report.cases || 0) +
		' (' + finite(report.verifiedRate, 0).toFixed(2) + '%)');
	const dims = report.dimensions || {};
	for (const key of Object.keys(dims).sort()) {
		const d = dims[key];
		lines.push('- ' + key + ': ' + d.passed + '/' + d.cases + ' (' + finite(d.rate, 0).toFixed(2) + '%)');
	}
	const hidden = report.hiddenInfo || {};
	lines.push('hidden-info debt: known=' + (hidden.knownDebt || 0) +
		', new=' + (hidden.newFindings || 0) +
		', resolved=' + (hidden.resolvedDebt || 0));
	lines.push('NOTE: verifiedRate is regression coverage, not an overall AI strength score.');
	return lines.join('\n');
}
