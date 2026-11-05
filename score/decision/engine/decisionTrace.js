import { utilitySummaryText, utilityDimensionLines } from '../utility/utilityExplain.js';

/*
 * 无名AI · 测试决策日志格式化
 *
 * 只负责把已经形成的最终决策记录转换为玩家可读文本。
 * 不参与候选生成、评分、排序或执行，保证测试可观测性不会改变 AI 行为。
 */

function finiteNumber(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

export function decisionLatencyBand(ms) {
	const value = Math.max(0, finiteNumber(ms, 0));
	if (value >= 5000) return { level: 'severe', label: '严重慢', ms: value };
	if (value >= 1000) return { level: 'slow', label: '慢', ms: value };
	return { level: 'normal', label: '正常', ms: value };
}

export function decisionTargetText(target) {
	if (Array.isArray(target)) {
		return target.map(decisionTargetText).filter(Boolean).join('+');
	}
	if (target && typeof target === 'object') {
		return String(target.name1 || target.name || target.playerid || target.id || '?');
	}
	if (target === undefined || target === null || target === '') return '';
	return String(target);
}

function translated(id, translate) {
	const raw = id === undefined || id === null || id === '' ? '?' : String(id);
	try {
		const value = typeof translate === 'function' ? translate(raw) : raw;
		return value === undefined || value === null || value === '' ? raw : String(value);
	} catch (e) {
		return raw;
	}
}

export function decisionActionText(candidate, translate) {
	if (!candidate) return '未知';
	const id = translated(candidate.id || candidate.type || '?', translate);
	const target = decisionTargetText(candidate.target);
	return target ? id + '→' + target : id;
}

function scoreText(score) {
	const n = finiteNumber(score, 0);
	return (Math.round(n * 100) / 100).toFixed(2);
}

function compactReason(reason, maxLength) {
	const text = String(reason || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	const cap = Math.max(12, Number(maxLength) || 80);
	return text.length > cap ? text.slice(0, cap - 1) + '…' : text;
}

function latencyText(ms) {
	const band = decisionLatencyBand(ms);
	const rounded = Math.round(band.ms);
	if (band.level === 'severe') return '⏱' + rounded + 'ms⚠严重慢';
	if (band.level === 'slow') return '⏱' + rounded + 'ms⚠慢';
	return '⏱' + rounded + 'ms';
}

function strategyText(strategy) {
	if (!strategy || !strategy.intent) return '';
	const role = String(strategy.roleObjective || '');
	const intent = String(strategy.intent.type || '');
	const target = decisionTargetText(strategy.intent.target);
	const urgency = strategy.intent.urgency === 'critical' ? '⚠' : '';
	let out = [role, intent].filter(Boolean).join('/');
	if (target) out += '→' + target;
	if (urgency) out += urgency;
	return out;
}

function characterText(policy) {
	if (!policy || !policy.archetype) return '';
	const primary = String(policy.archetype.primary || '');
	const secondary = Array.isArray(policy.archetype.secondary)
		? policy.archetype.secondary.filter(Boolean).slice(0, 2) : [];
	let out = primary;
	if (secondary.length) out += '(' + secondary.join('/') + ')';
	return out;
}

function distinctAlternatives(entry) {
	const winner = entry && entry.winner;
	const winnerKey = winner
		? String(winner.type || '') + '|' + String(winner.id || '') + '|' + decisionTargetText(winner.target)
		: '';
	const out = [];
	for (const c of (entry && Array.isArray(entry.candidates) ? entry.candidates : [])) {
		if (!c) continue;
		const key = String(c.type || '') + '|' + String(c.id || '') + '|' + decisionTargetText(c.target);
		if (key === winnerKey) continue;
		if (out.some(x => x.key === key)) continue;
		out.push({ key: key, candidate: c });
		if (out.length >= 3) break;
	}
	return out.map(x => x.candidate);
}

export function buildDecisionTraceLines(entry, mode, translate) {
	const traceMode = String(mode || '关闭');
	if (traceMode === '关闭' || traceMode === 'off' || traceMode === 'false') return [];
	if (!entry || !entry.winner) return [];

	const player = String(entry.player || '未知');
	const round = Number(entry.round) || 0;
	const winner = entry.winner;
	const alternatives = distinctAlternatives(entry);
	const next = alternatives[0] || null;
	const latency = latencyText(entry.elapsedMs);
	const finalText = decisionActionText(winner, translate);
	const nextText = next ? decisionActionText(next, translate) : '无';
	const reason = compactReason(winner.reason, traceMode === '详细' ? 120 : 64);

	if (traceMode !== '详细') {
		const strategy = strategyText(entry.strategy);
		const character = characterText(entry.characterPolicy);
		let summary = '[无名AI·决策] ' + player + '｜第' + round + '轮｜';
		if (strategy) summary += strategy + '｜';
		if (character) summary += '画像:' + character + '｜';
		summary += finalText + '｜' + scoreText(winner.score);
		if (next) {
			const gap = finiteNumber(winner.score, 0) - finiteNumber(next.score, 0);
			summary += '｜次选:' + nextText + ' ' + scoreText(next.score) +
				'｜差:' + (gap >= 0 ? '+' : '') + scoreText(gap);
		}
		summary += '｜' + latency;
		if (reason) summary += '｜' + reason;
		return [summary];
	}

	const lines = [
		'[无名AI·决策详细] ' + player + '｜第' + round + '轮｜' + latency,
		'最终：' + finalText + '｜分数 ' + scoreText(winner.score),
	];
	const strategy = strategyText(entry.strategy);
	if (strategy) {
		lines.push('战略：' + strategy);
		const reasons = entry.strategy && entry.strategy.intent && Array.isArray(entry.strategy.intent.reasons)
			? entry.strategy.intent.reasons.filter(Boolean).slice(0, 3) : [];
		if (reasons.length) lines.push('战略原因：' + reasons.join('；'));
	}
	const character = characterText(entry.characterPolicy);
	if (character) {
		lines.push('武将画像：' + character);
		const ca = winner && winner.characterAlignment;
		if (ca && Number(ca.delta)) {
			lines.push('画像修正：' + (ca.delta > 0 ? '+' : '') +
				(Math.round(ca.delta * 1000) / 10) + '%｜' + (ca.reason || ''));
		}
	}
	const utility = winner && winner.utility;
	if (utility) {
		lines.push('收益向量：' + utilitySummaryText(utility));
		const utilityLines = utilityDimensionLines(utility, 8);
		if (utilityLines.length) lines.push('维度：' + utilityLines.join('｜'));
	}

	const top = [winner].concat(alternatives).slice(0, 3);
	lines.push('候选：' + top.map(function (c, i) {
		return (i + 1) + '.' + decisionActionText(c, translate) + '(' + scoreText(c.score) + ')';
	}).join('  '));

	const layers = entry.layers || {};
	const signals = [];
	if (layers.tempo && layers.tempo.stage) signals.push('阶段=' + layers.tempo.stage);
	if (layers.risk && layers.risk.label) signals.push('风险=' + layers.risk.label);
	if (layers.team && layers.team.focus) signals.push('集火=' + layers.team.focus);
	if (layers.multiturn && layers.multiturn.overall) signals.push('趋势=' + layers.multiturn.overall);
	if (signals.length) lines.push('信号：' + signals.join('｜'));

	const phaseMs = entry.phaseMs && typeof entry.phaseMs === 'object' ? entry.phaseMs : null;
	if (phaseMs) {
		const rankedPhases = Object.keys(phaseMs)
			.map(function (name) { return { name: name, ms: finiteNumber(phaseMs[name], 0) }; })
			.filter(function (x) { return x.ms > 0; })
			.sort(function (a, b) { return b.ms - a.ms; })
			.slice(0, 5);
		if (rankedPhases.length) {
			lines.push('性能：' + rankedPhases.map(function (x) {
				return x.name + '=' + Math.round(x.ms) + 'ms';
			}).join('｜'));
		}
	}

	if (reason) lines.push('原因：' + reason);

	return lines;
}
