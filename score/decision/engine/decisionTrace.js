import { utilitySummaryText, utilityDimensionLines } from '../utility/utilityExplain.js?v=5e5';

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
	const target = targetDisplayText(candidate.target, translate);
	return target ? id + '→' + target : id;
}

// 调试代号只在显示层翻译；未知代号保留原文，便于排查新策略。
const DISPLAY_LABELS = {
	FOCUS_LANDLORD: '击败地主', REMOVE_FARMERS: '击败农民',
	LORD_SURVIVAL: '保护主公', REMOVE_CONFIRMED_REBEL: '清除已确认反贼',
	FINAL_DUEL: '准备单挑', BALANCE_FIELD: '平衡局势',
	CONCEAL_AND_SURVIVE: '隐藏身份并生存', SELF_SURVIVAL: '优先生存',
	GENERAL_ADVANTAGE: '扩大优势', PRESERVE_INFORMATION: '保留信息', LORD_FINISH: '击败主公',
	SURVIVE: '保命', PROTECT: '保护', FINISH: '斩杀', FOCUS: '集火',
	CONTROL: '控制', DISRUPT: '干扰', DEVELOP: '积累资源', SETUP: '铺垫',
	BURST: '爆发', PRESERVE: '保留资源', BALANCE: '平衡', CONCEAL: '隐藏', PASS: '结束出牌',
	ASSAULT: '进攻型', SUPPORT: '辅助型', SUSTAIN: '续航型', RESOURCE: '资源型',
	CONVERSION: '转化型', SACRIFICE: '牺牲型', HYBRID: '综合型',
};

function displayLabel(value) {
	return DISPLAY_LABELS[value] || String(value || '');
}

function targetDisplayText(target, translate) {
	if (Array.isArray(target)) return target.map(x => targetDisplayText(x, translate)).filter(Boolean).join('、');
	const raw = decisionTargetText(target);
	return raw ? translated(raw, translate) : '';
}

function readableReason(reason, translate) {
	return String(reason || '').replace(/[A-Za-z_][A-Za-z0-9_]*|\d{6,}/g, id => translated(id, translate))
		.replace(/目标分/g, '目标评分').replace(/EV(?=\d)/g, '预期收益 ')
		.replace(/边际/g, '增量收益').replace(/规划值/g, '连招规划评分');
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

function strategyText(strategy, translate) {
	if (!strategy || !strategy.intent) return '';
	const role = displayLabel(strategy.roleObjective);
	const intent = displayLabel(strategy.intent.type);
	const target = targetDisplayText(strategy.intent.target, translate);
	const urgency = strategy.intent.urgency === 'critical' ? '⚠' : '';
	let out = [role, intent].filter(Boolean).join('/');
	if (target) out += '→' + target;
	if (urgency) out += urgency;
	return out;
}

function characterText(policy) {
	if (!policy || !policy.archetype) return '';
	const primary = displayLabel(policy.archetype.primary);
	const secondary = Array.isArray(policy.archetype.secondary)
		? policy.archetype.secondary.filter(Boolean).slice(0, 2) : [];
	let out = primary;
	if (secondary.length) out += '(' + secondary.map(displayLabel).join('/') + ')';
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

	const player = translated(entry.player || '未知', translate);
	const round = Number(entry.round) || 0;
	const winner = entry.winner;
	const alternatives = distinctAlternatives(entry);
	const next = alternatives[0] || null;
	const latency = latencyText(entry.elapsedMs);
	const finalText = decisionActionText(winner, translate);
	const nextText = next ? decisionActionText(next, translate) : '无';
	const reason = compactReason(readableReason(winner.reason, translate), traceMode === '详细' ? 600 : 300);

	if (traceMode !== '详细') {
		const lines = [
			'[无名AI·决策分析] ' + player + '｜第' + round + '轮｜耗时 ' + latency,
			'推荐动作：' + finalText + '｜综合评分 ' + scoreText(winner.score),
		];
		if (next) {
			const gap = finiteNumber(winner.score, 0) - finiteNumber(next.score, 0);
			lines.push('备选动作：' + nextText + '｜评分 ' + scoreText(next.score) +
				'｜推荐高出 ' + scoreText(gap) + ' 分');
		}
		const strategy = strategyText(entry.strategy, translate);
		if (strategy) lines.push('当前策略：' + strategy);
		const character = characterText(entry.characterPolicy);
		if (character) lines.push('武将打法：' + character);
		if (reason) lines.push('推荐原因：' + reason);
		return lines;
	}

	const lines = [
		'[无名AI·决策详细] ' + player + '｜第' + round + '轮｜' + latency,
		'推荐动作：' + finalText + '｜分数 ' + scoreText(winner.score),
	];
	const strategy = strategyText(entry.strategy, translate);
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

	const plan = layers.plan;
	if (plan && Array.isArray(plan.steps) && plan.steps.length) {
		const route = plan.steps.map(function (step) { return translated(step, translate); }).join(' → ');
		let planLine = '规划：' + route + '｜规划值 ' + scoreText(plan.total) +
			'｜未来 ' + scoreText(plan.futureScore);
		if (plan.plannerVersion) planLine += '｜' + String(plan.plannerVersion);
		if (plan.intent && plan.intent.type) {
			planLine += '｜意图=' + displayLabel(plan.intent.type);
			const intentTarget = targetDisplayText(plan.intent.target, translate);
			if (intentTarget) planLine += '→' + intentTarget;
		}
		lines.push(planLine);
		const deps = Array.isArray(plan.dependencies) ? plan.dependencies.filter(Boolean).slice(0, 3) : [];
		if (deps.length) {
			lines.push('规划依赖：' + deps.map(function (d) {
				const edge = [translated(d.from, translate), translated(d.to, translate)].filter(Boolean).join('→');
				return (edge ? edge + ' ' : '') + compactReason(d.reason || d.kind, 72);
			}).join('；'));
		}
	}

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
