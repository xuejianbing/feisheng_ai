/*
 * 无名AI · Utility Explain
 */

const LABELS = Object.freeze({
	offense: '进攻',
	control: '控制',
	resource: '资源',
	survival: '生存',
	team: '团队',
	tempo: '节奏',
	future: '后续',
	synergy: '协同',
	risk: '风险',
	resourceCost: '资源成本',
	opportunityCost: '机会成本',
	uncertainty: '不确定性',
	legacyResidual: '未迁移通用层',
});

function n(v) {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
}

function signed(v) {
	const x = Math.round(n(v) * 100) / 100;
	return (x > 0 ? '+' : '') + x.toFixed(2);
}

export function utilityDimensionLines(snapshot, limit) {
	if (!snapshot) return [];
	const dims = snapshot.dimensions || {};
	return Object.keys(dims)
		.map(function (key) { return { key, value: n(dims[key]) }; })
		.filter(function (x) { return Math.abs(x.value) >= 0.005; })
		.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); })
		.slice(0, Math.max(1, Number(limit) || 8))
		.map(function (x) { return (LABELS[x.key] || x.key) + ' ' + signed(x.value); });
}

export function utilitySummaryText(snapshot) {
	if (!snapshot) return '';
	const parts = utilityDimensionLines(snapshot, 5);
	const parity = Math.abs(n(snapshot.residual)) <= 0.011 ? '对账✓' : '残差' + signed(snapshot.residual);
	return 'legacyBase ' + signed(snapshot.legacyBase) +
		(parts.length ? '｜' + parts.join('｜') : '') +
		'｜shadow ' + signed(snapshot.shadowUtility) +
		'｜' + parity;
}
