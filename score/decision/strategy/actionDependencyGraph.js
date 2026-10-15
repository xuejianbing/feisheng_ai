/*
 * 无名AI · Tactical Planner V2
 *
 * 纯规划核心：把当前合法候选组织成 2-3 步短程计划。
 * 本文件只消费通用语义（semantic / operation / state），不认识任何具体游戏牌名。
 */

import { playerKey } from '../../foundation/adapt/playerIdentity.js?v=41a';

function finite(v, fallback) {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function round(v) {
	return Math.round(finite(v, 0) * 1000) / 1000;
}

function targetValues(action) {
	if (!action) return [];
	const t = action.targetList || action.target;
	if (Array.isArray(t)) {
		return t.map(function (x) {
			if (x && typeof x === 'object') return playerKey(x) || '';
			return String(x || '');
		}).filter(Boolean);
	}
	if (t && typeof t === 'object') {
		const k = playerKey(t);
		return k ? [String(k)] : [];
	}
	return t == null || t === '' ? [] : [String(t)];
}

function targetOverlap(a, b) {
	const aa = targetValues(a), bb = targetValues(b);
	if (!aa.length || !bb.length) return false;
	for (const x of aa) if (bb.indexOf(x) >= 0) return true;
	return false;
}

function actionKey(action, index) {
	return String(action && action.type || 'card') + ':' +
		String(action && action.id || '?') + ':' + targetValues(action).join(',') + ':' + String(index);
}

function resourceKey(action) {
	if (!action) return null;
	const type = String(action.type || 'card');
	if (type !== 'card' && type !== 'equip') return null;
	const id = String(action.id || '');
	return id ? id : null;
}

function defaultDescribe(action) {
	const d = action && action.plannerSemantics;
	return d && typeof d === 'object' ? d : {};
}

function describe(action, options) {
	const fn = options && typeof options.describeAction === 'function' ? options.describeAction : defaultDescribe;
	try {
		const d = fn(action) || {};
		return {
			semantic: String(d.semantic || ''),
			operation: String(d.operation || ''),
			state: d.state && typeof d.state === 'object' ? d.state : null,
		};
	} catch (_) {
		return { semantic: '', operation: '', state: null };
	}
}

function isStrategicCandidate(action) {
	const a = action && action.strategicAlignment;
	if (a && (a.level === 'high' || a.level === 'very_high')) return true;
	const p = action && action.policy;
	return !!(p && (p.priorityTier === 'critical' || p.priorityTier === 'forced'));
}

function isSetupCandidate(action, options) {
	if (!action || action.type === 'end') return false;
	const d = describe(action, options);
	if (action.plannerEnablesRange === true || action.enables === 'attack' ||
		(Array.isArray(action.plannerEnablesTargets) && action.plannerEnablesTargets.length)) return true;
	return d.operation === 'remove-target-card' ||
		d.operation === 'amplify-next-damage' ||
		d.operation === 'create-linked-state' ||
		d.operation === 'area-pressure' ||
		d.operation === 'create-state' ||
		d.operation === 'expand-resource';
}

export function buildPlannerCandidatePool(candidates, options) {
	options = options || {};
	const input = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
	const compare = typeof options.compareCandidates === 'function'
		? options.compareCandidates
		: function (a, b) { return finite(b && b.score, 0) - finite(a && a.score, 0); };
	const isEligible = typeof options.isEligible === 'function'
		? options.isEligible
		: function () { return true; };
	const topUtilityCount = Math.max(1, Math.min(12, Number(options.topUtilityCount) || 8));
	const maxCandidates = Math.max(topUtilityCount + 1, Math.min(24, Number(options.maxCandidates) || 18));
	const sorted = input.filter(isEligible).slice().sort(compare);
	const picked = [];
	const seen = new Set();

	function add(action) {
		if (!action || seen.has(action)) return;
		seen.add(action);
		picked.push(action);
	}

	for (let i = 0; i < sorted.length && i < topUtilityCount; i++) add(sorted[i]);
	for (const action of sorted) if (action.type === 'end') add(action);

	const strategicExtras = sorted.filter(function (action) {
		return !seen.has(action) && isStrategicCandidate(action);
	});
	for (let i = 0; i < strategicExtras.length && i < 3 && picked.length < maxCandidates; i++) {
		add(strategicExtras[i]);
	}

	const setupCandidates = sorted.filter(function (action) {
		return isSetupCandidate(action, options);
	});
	for (const setup of setupCandidates) {
		const partner = sorted.find(function (action) {
			if (!action || action === setup) return false;
			return !!dependencyEdge(setup, action, options) || !!dependencyEdge(action, setup, options);
		});
		if (!partner) continue;

		const setupNeeded = seen.has(setup) ? 0 : 1;
		const partnerNeeded = seen.has(partner) ? 0 : 1;
		if (picked.length + setupNeeded + partnerNeeded > maxCandidates) continue;

		add(setup);
		add(partner);
	}

	for (const action of strategicExtras) {
		if (picked.length >= maxCandidates) break;
		add(action);
	}

	return picked.slice(0, maxCandidates);
}

function alignmentBonus(action) {
	const a = action && action.strategicAlignment;
	if (!a) return 0;
	const v = Math.max(0, Math.min(1, finite(a.value, 0)));
	if (a.level === 'very_high') return round(v * 1.25);
	if (a.level === 'high') return round(v * 0.9);
	if (a.level === 'medium') return round(v * 0.45);
	return 0;
}

function reserveAdjustment(action, intent, options) {
	if (!action) return 0;
	const d = describe(action, options);
	const type = String(intent && intent.type || '');
	const targets = targetValues(action);
	const intentTarget = intent && intent.target != null ? String(intent.target) : '';

	if ((type === 'PRESERVE' || type === 'CONCEAL') && action.type === 'end') return 1.25;
	if (type === 'PROTECT' && d.semantic === 'heal') {
		if (intentTarget && targets.indexOf(intentTarget) >= 0) return 1.5;
		return -2.5;
	}
	if ((type === 'PRESERVE' || type === 'CONCEAL') &&
		(d.semantic === 'heal' || d.semantic === 'negate')) return -1.5;
	return 0;
}

export function dependencyEdge(from, to, options) {
	if (!from || !to || from === to) return null;
	const a = describe(from, options);
	const b = describe(to, options);

	if (a.operation === 'remove-target-card' && b.semantic === 'attack' && targetOverlap(from, to)) {
		return { kind: 'weaken-defense', bonus: 2.4, reason: '先削弱目标资源，再进行单体进攻' };
	}
	if (a.operation === 'amplify-next-damage' && b.semantic === 'attack' &&
		b.state && b.state.family === 'basic-strike') {
		return { kind: 'amplify-damage', bonus: 3.2, reason: '先建立增伤状态，再执行匹配的基础攻击' };
	}
	if (a.operation === 'create-linked-state' && b.operation === 'deal-elemental-damage' && targetOverlap(from, to)) {
		return { kind: 'create-linked-state', bonus: 3.0, reason: '先建立连锁状态，再投入可传播伤害' };
	}
	if (a.operation === 'area-pressure' && b.semantic === 'attack' && b.operation !== 'area-pressure') {
		return { kind: 'area-then-finish', bonus: 1.1, reason: '先进行群体消耗，再用单体动作收束' };
	}
	if (a.operation === 'create-state' && a.state && a.state.family === 'delayed-control' &&
		b.semantic === 'attack' && targetOverlap(from, to)) {
		return { kind: 'control-then-pressure', bonus: 0.9, reason: '先施加持续压制，再集中攻击' };
	}
	if (a.operation === 'expand-resource' && to.type !== 'end') {
		return { kind: 'develop-then-act', bonus: 0.6, reason: '先扩充资源，再执行后续战术动作' };
	}
	if (b.semantic === 'attack' && b.state && b.state.family === 'basic-strike') {
		const enabledTargets = Array.isArray(from.plannerEnablesTargets) ? from.plannerEnablesTargets.map(String) : [];
		const nextTargets = targetValues(to).map(String);
		const targetEnabled = enabledTargets.length && nextTargets.some(function (x) { return enabledTargets.indexOf(x) >= 0; });
		if (from.plannerEnablesRange === true || from.enables === 'attack' || targetEnabled) {
			return { kind: 'enable-range', bonus: 2.5, reason: '先装备以满足该目标的后续攻击距离' };
		}
	}
	return null;
}

function canConsume(action, used, budget) {
	const key = resourceKey(action);
	if (!key) return true;
	if (!budget || budget[key] == null) return true;
	return (used[key] || 0) < Math.max(0, finite(budget[key], 0));
}

function consume(action, used) {
	const out = Object.assign({}, used || {});
	const key = resourceKey(action);
	if (key) out[key] = (out[key] || 0) + 1;
	return out;
}

function stepValue(action, intent, weight, options) {
	return round((alignmentBonus(action) + reserveAdjustment(action, intent, options)) * finite(weight, 1));
}

function dependencyEdgesInto(steps, next, options) {
	const out = [];
	for (const prev of (Array.isArray(steps) ? steps : [])) {
		const edge = dependencyEdge(prev, next, options);
		if (edge) {
			out.push(Object.assign({
				from: prev.id || '?',
				to: next && next.id || '?',
			}, edge));
		}
	}
	return out;
}

function fanInEligibleEdge(edge) {
	if (!edge) return false;
	return edge.kind !== 'develop-then-act';
}

function hasFanInPotential(steps, next, actions, used, budget, options) {
	for (const future of actions) {
		if (!future || future === next || steps.indexOf(future) >= 0) continue;
		const usedAfterNext = consume(next, used);
		if (!canConsume(future, usedAfterNext, budget)) continue;
		const nextEdge = dependencyEdge(next, future, options);
		if (!fanInEligibleEdge(nextEdge)) continue;
		for (const prev of steps) {
			if (fanInEligibleEdge(dependencyEdge(prev, future, options))) return true;
		}
	}
	return false;
}

function planKey(plan) {
	return plan.steps.map(function (s) { return s._plannerKey; }).join('>');
}

export function buildTacticalPlans(candidates, options) {
	options = options || {};
	const input = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
	const maxDepth = Math.max(1, Math.min(3, Number(options.maxDepth) || 3));
	const beamWidth = Math.max(2, Math.min(8, Number(options.beamWidth) || 5));
	const discount = Math.max(0.35, Math.min(0.9, finite(options.discount, 0.72)));
	const intent = options.intent || null;
	const resourceBudget = options.resourceBudget || null;

	const actions = input.map(function (action, index) {
		try {
			Object.defineProperty(action, '_plannerKey', {
				value: actionKey(action, index),
				configurable: true,
				enumerable: false,
			});
		} catch (_) {
			action._plannerKey = actionKey(action, index);
		}
		return action;
	});

	let frontier = [];
	const all = [];
	for (const action of actions) {
		if (!canConsume(action, {}, resourceBudget)) continue;
		const baseScore = finite(action.score, 0);
		const intentValue = stepValue(action, intent, 1, options);
		const plan = {
			action,
			steps: [action],
			dependencies: [],
			baseScore: round(baseScore),
			futureScore: round(intentValue),
			total: round(baseScore + intentValue),
			resourceUse: consume(action, {}),
			intentType: intent && intent.type || null,
			depth: 1,
			isKill: false,
		};
		frontier.push(plan);
		all.push(plan);
	}

	for (let depth = 2; depth <= maxDepth && frontier.length; depth++) {
		const nextFrontier = [];
		for (const plan of frontier) {
			for (const next of actions) {
				if (plan.steps.indexOf(next) >= 0) continue;
				if (!canConsume(next, plan.resourceUse, resourceBudget)) continue;

				const incoming = dependencyEdgesInto(plan.steps, next, options);
				const pendingFanIn = incoming.length === 0 &&
					hasFanInPotential(plan.steps, next, actions, plan.resourceUse, resourceBudget, options);
				if (!incoming.length && !pendingFanIn) continue;

				const weight = Math.pow(discount, depth - 1);
				const followUtility = finite(next.score, 0) * 0.18 * weight;
				const intentValue = stepValue(next, intent, weight, options);
				const edgeValue = incoming.reduce(function (sum, edge) {
					return sum + finite(edge.bonus, 0);
				}, 0) * weight;
				const futureDelta = round(followUtility + intentValue + edgeValue);
				const extended = {
					action: plan.action,
					steps: plan.steps.concat([next]),
					dependencies: plan.dependencies.concat(incoming),
					baseScore: plan.baseScore,
					futureScore: round(plan.futureScore + futureDelta),
					total: round(plan.baseScore + plan.futureScore + futureDelta),
					resourceUse: consume(next, plan.resourceUse),
					intentType: intent && intent.type || null,
					depth,
					isKill: false,
					pendingFanIn,
				};
				nextFrontier.push(extended);
				if (!pendingFanIn) all.push(extended);
			}
		}
		const completed = nextFrontier.filter(function (p) { return !p.pendingFanIn; })
			.sort(function (a, b) { return b.total - a.total; });
		const pending = nextFrontier.filter(function (p) { return p.pendingFanIn; })
			.sort(function (a, b) { return b.total - a.total; });
		const pendingReserve = depth < maxDepth ? Math.min(2, pending.length, beamWidth) : 0;
		frontier = completed.slice(0, Math.max(0, beamWidth - pendingReserve));
		const slots = beamWidth - frontier.length;
		if (slots > 0) frontier = frontier.concat(pending.slice(0, slots));
		frontier.sort(function (a, b) { return b.total - a.total; });
	}

	const unique = new Map();
	for (const p of all) {
		const key = planKey(p);
		const old = unique.get(key);
		if (!old || p.total > old.total) unique.set(key, p);
	}
	const ranked = Array.from(unique.values()).sort(function (a, b) {
		if (b.total !== a.total) return b.total - a.total;
		if (b.depth !== a.depth) return b.depth - a.depth;
		return b.baseScore - a.baseScore;
	});

	return {
		best: ranked[0] || null,
		alternatives: ranked.slice(1, 3),
		all: ranked,
		expanded: ranked.length,
		maxDepth,
	};
}

export function tacticalPlanSummary(plan) {
	if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return '';
	const route = plan.steps.map(function (s) { return String(s.id || s.type || '?'); }).join(' → ');
	const deps = (plan.dependencies || []).map(function (d) { return d.reason; }).filter(Boolean);
	return route + '｜规划值 ' + round(plan.total) + (deps.length ? '｜' + deps.join('；') : '');
}
