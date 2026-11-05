/*
 * 无名AI · Character Policy Core
 *
 * 把一组技能语义聚合为“这个武将通常应该怎样玩”。
 * 纯函数，不读取宿主状态，不按武将名字写死规则。
 */

export const CHARACTER_ARCHETYPE = Object.freeze({
	ASSAULT: 'ASSAULT',
	BURST: 'BURST',
	CONTROL: 'CONTROL',
	SUPPORT: 'SUPPORT',
	SUSTAIN: 'SUSTAIN',
	RESOURCE: 'RESOURCE',
	CONVERSION: 'CONVERSION',
	SACRIFICE: 'SACRIFICE',
	HYBRID: 'HYBRID',
});

const DIM_KEYS = Object.freeze([
	'offense', 'burst', 'control', 'support', 'sustain',
	'resource', 'conversion', 'sacrifice', 'combo', 'damageBenefit',
]);

function pos(v) {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

function negMagnitude(v) {
	const n = Number(v);
	return Number.isFinite(n) && n < 0 ? -n : 0;
}

function clamp01(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

function squash(v) {
	/* 单个/多个技能的原始标签量级差异很大，用饱和函数避免大技能碾压。 */
	const x = Math.max(0, Number(v) || 0);
	return x / (x + 3);
}

function timingIncludes(signal, names) {
	const phases = signal && Array.isArray(signal.phases) ? signal.phases : [];
	for (const p of phases) if (names.indexOf(p) >= 0) return true;
	return false;
}

export function skillPolicyVector(signal) {
	const t = signal && signal.tags || {};
	const out = {
		offense:
			pos(t.damage) * 1.2 + pos(t.atk) + pos(t.burst) * 0.55 +
			pos(t.aoe) * 0.45 + pos(t.loseEnemyHp) * 0.8 + pos(t.loseEnemyMaxHp) * 0.9,
		burst:
			pos(t.burst) * 1.2 + pos(t.damage) * 0.45 + pos(t.atk) * 0.35 +
			pos(t.aoe) * 0.8 + pos(t.limit) * 0.55,
		control:
			pos(t.ctrl) * 1.1 + pos(t.discardEnemy) * 0.9 + pos(t.loseEnemy) * 0.7 +
			pos(t.turnOver) * 0.8 + pos(t.skip) * 0.9 + pos(t.judgeCard) * 0.75 +
			pos(t.compare) * 0.35 + pos(t.link) * 0.25,
		support:
			pos(t.aux) * 1.1 + pos(t.teamGain) + pos(t.teamAid) +
			pos(t.giveCard) * 0.8 + pos(t.addSkill) * 0.45 + pos(t.addTempSkill) * 0.35,
		sustain:
			pos(t.sustain) * 1.1 + pos(t.recover) * 1.2 + pos(t.def) +
			pos(t.revive) * 1.4 + pos(t.addShan) * 0.6 + pos(t.maxHp) * 0.5,
		resource:
			pos(t.draw) * 1.05 + pos(t.gain) * 1.1 + pos(t.guanxing) * 0.55 +
			pos(t.topCards) * 0.45,
		conversion:
			pos(t.viewAs) * 1.15 + pos(t.useCard) * 0.45 + pos(t.judge) * 0.25 +
			pos(t.compare) * 0.2,
		sacrifice:
			pos(t.costHp) + pos(t.loseHp) + negMagnitude(t.loseHp) +
			pos(t.selfDamage) + negMagnitude(t.selfDamage) +
			pos(t.loseMaxHp) + negMagnitude(t.loseMaxHp) +
			pos(t.selfDiscard) * 0.35 + negMagnitude(t.selfDiscard) * 0.35 +
			pos(t.selfLose) * 0.3 + negMagnitude(t.selfLose) * 0.3,
		combo:
			pos(t.viewAs) * 0.7 + pos(t.useCard) * 0.55 + pos(t.compare) * 0.45 +
			pos(t.link) * 0.4 + pos(t.teamChain) * 0.65 + pos(t.burst) * 0.35,
		damageBenefit: 0,
	};

	/* “受伤后获得明显正收益”与“主动卖血成本”分开。
	 * 前者表示可以容忍受伤，不代表无条件鼓励自残。 */
	if (timingIncludes(signal, ['damaged', 'damageAfter', 'damageBefore'])) {
		const benefit = pos(t.draw) + pos(t.gain) + pos(t.sustain) + pos(t.recover) +
			pos(t.aux) + pos(t.teamGain) + pos(t.teamAid) + pos(t.ctrl) * 0.5;
		out.damageBenefit = benefit;
	}
	return out;
}

export function aggregateCharacterDimensions(signals) {
	const raw = {};
	for (const k of DIM_KEYS) raw[k] = 0;
	for (const signal of (Array.isArray(signals) ? signals : [])) {
		const v = skillPolicyVector(signal);
		for (const k of DIM_KEYS) raw[k] += Number(v[k]) || 0;
	}
	const dims = {};
	for (const k of DIM_KEYS) dims[k] = Math.round(squash(raw[k]) * 1000) / 1000;
	return { raw, dimensions: dims };
}

function archetypeScores(d) {
	return {
		[CHARACTER_ARCHETYPE.ASSAULT]: d.offense,
		[CHARACTER_ARCHETYPE.BURST]: d.burst,
		[CHARACTER_ARCHETYPE.CONTROL]: d.control,
		[CHARACTER_ARCHETYPE.SUPPORT]: d.support,
		[CHARACTER_ARCHETYPE.SUSTAIN]: d.sustain,
		[CHARACTER_ARCHETYPE.RESOURCE]: d.resource,
		[CHARACTER_ARCHETYPE.CONVERSION]: Math.max(d.conversion, d.combo * 0.9),
		[CHARACTER_ARCHETYPE.SACRIFICE]: Math.max(d.sacrifice * 0.75, d.damageBenefit),
	};
}

export function buildCharacterPolicyCore(spec) {
	spec = spec || {};
	const signals = Array.isArray(spec.signals) ? spec.signals : [];
	const agg = aggregateCharacterDimensions(signals);
	const d = agg.dimensions;
	const scores = archetypeScores(d);
	const ranked = Object.keys(scores)
		.map(function (key) { return { key, score: Number(scores[key]) || 0 }; })
		.sort(function (a, b) { return b.score - a.score; });
	const first = ranked[0] || { key: CHARACTER_ARCHETYPE.HYBRID, score: 0 };
	const second = ranked[1] || { key: CHARACTER_ARCHETYPE.HYBRID, score: 0 };

	let primary = first.key;
	const sameFamily = (
		(first.key === CHARACTER_ARCHETYPE.ASSAULT && second.key === CHARACTER_ARCHETYPE.BURST) ||
		(first.key === CHARACTER_ARCHETYPE.BURST && second.key === CHARACTER_ARCHETYPE.ASSAULT) ||
		(first.key === CHARACTER_ARCHETYPE.SUPPORT && second.key === CHARACTER_ARCHETYPE.SUSTAIN) ||
		(first.key === CHARACTER_ARCHETYPE.SUSTAIN && second.key === CHARACTER_ARCHETYPE.SUPPORT) ||
		(first.key === CHARACTER_ARCHETYPE.RESOURCE && second.key === CHARACTER_ARCHETYPE.CONVERSION) ||
		(first.key === CHARACTER_ARCHETYPE.CONVERSION && second.key === CHARACTER_ARCHETYPE.RESOURCE)
	);
	if (first.score < 0.20 || (!sameFamily && second.score > 0 && first.score - second.score < 0.05)) {
		primary = CHARACTER_ARCHETYPE.HYBRID;
	}
	const secondary = ranked
		.filter(function (x) { return x.score >= 0.28 && x.key !== primary; })
		.slice(0, 2)
		.map(function (x) { return x.key; });

	const confidence = first.score <= 0
		? 0
		: clamp01((first.score - second.score) * 1.8 + first.score * 0.45);

	const resource = {
		attackFuel: clamp01(d.offense * 0.55 + d.burst * 0.45 + d.combo * 0.25),
		defenseFuel: clamp01(d.sustain * 0.65 + d.support * 0.2 + d.conversion * 0.15),
		healFuel: clamp01(d.sustain * 0.75 + d.support * 0.35),
		nullificationFuel: clamp01(d.control * 0.45 + d.support * 0.45 + d.sustain * 0.15),
		controlFuel: clamp01(d.control * 0.8 + d.combo * 0.15),
		flexibleHandFuel: clamp01(d.conversion * 0.7 + d.combo * 0.35),
		hpSpendTolerance: clamp01(d.sacrifice * 0.55 + d.damageBenefit * 0.65),
	};

	const style = {
		aggression: Math.round(clamp01(d.offense * 0.55 + d.burst * 0.55) * 1000) / 1000,
		teamwork: Math.round(clamp01(d.support * 0.6 + d.sustain * 0.35 + d.control * 0.15) * 1000) / 1000,
		patience: Math.round(clamp01(d.control * 0.3 + d.resource * 0.35 + d.conversion * 0.3) * 1000) / 1000,
	};

	const reasons = ranked.filter(function (x) { return x.score >= 0.28; }).slice(0, 3)
		.map(function (x) { return x.key + '=' + x.score.toFixed(2); });

	return {
		heroId: String(spec.heroId || ''),
		skillIds: signals.map(function (x) { return String(x && x.id || ''); }).filter(Boolean),
		archetype: { primary, secondary, confidence: Math.round(confidence * 1000) / 1000 },
		dimensions: d,
		resource,
		style,
		reasons,
	};
}

export function characterCardAffinity(policy, cardId) {
	const p = policy || {};
	const d = p.dimensions || {};
	const id = String(cardId || '');
	if (!id) return { delta: 0, reason: '' };

	const attack = ['sha', 'juedou', 'huogong', 'nanman', 'wanjian', 'zhujin'];
	const control = ['guohe', 'shunshou', 'lebu', 'bingliang', 'tiesuo', 'jiedao'];
	const defense = ['shan', 'tao', 'wuxie'];
	const resource = ['wuzhong', 'wugu'];

	let delta = 0, reason = '';
	if (attack.indexOf(id) >= 0) {
		delta = 0.13 * clamp01((d.offense || 0) * 0.65 + (d.burst || 0) * 0.45);
		reason = '进攻/爆发画像';
		if (id === 'sha') delta += 0.04 * clamp01(d.combo || 0);
	} else if (id === 'jiu') {
		delta = 0.13 * clamp01((d.burst || 0) * 0.75 + (d.offense || 0) * 0.35);
		reason = '爆发画像';
	} else if (control.indexOf(id) >= 0) {
		delta = 0.13 * clamp01(d.control || 0);
		reason = '控制画像';
	} else if (defense.indexOf(id) >= 0) {
		delta = 0.10 * clamp01((d.sustain || 0) * 0.7 + (d.support || 0) * 0.35);
		reason = '续航/支援画像';
	} else if (resource.indexOf(id) >= 0) {
		delta = 0.09 * clamp01((d.resource || 0) * 0.8 + (d.conversion || 0) * 0.2);
		reason = '资源画像';
	}
	return { delta: Math.min(0.18, Math.max(-0.12, delta)), reason };
}

export function characterSkillAffinity(policy, skillSignal, hpRatio) {
	const p = policy || {};
	const d = p.dimensions || {};
	const v = skillPolicyVector(skillSignal || {});
	const norm = {};
	for (const k of DIM_KEYS) norm[k] = squash(v[k]);

	const alignment =
		(norm.offense * (d.offense || 0) +
		norm.burst * (d.burst || 0) +
		norm.control * (d.control || 0) +
		norm.support * (d.support || 0) +
		norm.sustain * (d.sustain || 0) +
		norm.resource * (d.resource || 0) +
		norm.conversion * (d.conversion || 0) +
		norm.combo * (d.combo || 0)) / 8;

	let delta = Math.min(0.16, alignment * 0.22);
	let reason = alignment > 0.08 ? '核心技能与武将画像一致' : '';

	const hp = Number(hpRatio);
	const selfCost = norm.sacrifice;
	if (selfCost > 0.12) {
		if (Number.isFinite(hp) && hp <= 0.25) {
			delta -= Math.min(0.16, selfCost * 0.20);
			reason = '低血时抑制卖血/自损';
		} else {
			const tolerance = Number(p.resource && p.resource.hpSpendTolerance) || 0;
			delta += Math.min(0.10, selfCost * tolerance * 0.16);
			if (tolerance >= 0.35) reason = '卖血/受伤收益画像允许安全换血';
		}
	}
	return { delta: Math.min(0.18, Math.max(-0.16, delta)), reason };
}

export function characterFuelKeepBonus(policy, cardId) {
	const r = policy && policy.resource || {};
	const id = String(cardId || '');
	let value = 0, reason = '';
	if (id === 'sha') { value = (r.attackFuel || 0) * 0.32; reason = '进攻燃料'; }
	else if (id === 'jiu') { value = (r.attackFuel || 0) * 0.26; reason = '爆发燃料'; }
	else if (id === 'shan') { value = (r.defenseFuel || 0) * 0.28; reason = '防御燃料'; }
	else if (id === 'tao') { value = (r.healFuel || 0) * 0.34; reason = '续航燃料'; }
	else if (id === 'wuxie') { value = (r.nullificationFuel || 0) * 0.32; reason = '控制/支援燃料'; }
	else if (['guohe','shunshou','lebu','bingliang','tiesuo','jiedao'].indexOf(id) >= 0) {
		value = (r.controlFuel || 0) * 0.22; reason = '控制燃料';
	}
	return { value: Math.min(0.38, Math.max(0, value)), reason };
}
