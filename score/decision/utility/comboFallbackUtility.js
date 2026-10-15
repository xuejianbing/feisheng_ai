import { isCandidateEligible, candidateTargetValue } from '../state/actionCandidate.js?v=41a';
import { applyOwnedUtility } from './utilityPipeline.js?v=41a';

export function plannerOwnsSequence(plan) {
	return !!(plan?.best && (plan.isKill || (Array.isArray(plan.best.steps) && plan.best.steps.length > 1)));
}

const selfSetup = a => a.type === 'equip' || ['jiu', 'wuzhong'].includes(a.id);
const overlaps = (a, b) => {
	if (selfSetup(a) || selfSetup(b)) return true;
	const target = candidateTargetValue(a), other = candidateTargetValue(b);
	if (target == null || other == null) return true; // 酒、装备等自身准备动作。
	const aa = Array.isArray(target) ? target : [target], bb = Array.isArray(other) ? other : [other];
	return aa.some(x => bb.includes(x));
};

/* Planner拥有有效序列时，只记命中的链，不给动作再加未来收益。
 * 无有效序列才使用旧连招信息作有界提示，多个链取最大，不连乘。
 * 后续步骤必须有当前eligible候选支撑；本层不造动作、不提policy优先级。 */
export function applyComboFallbackUtility(me, candidates, { plan, detect, scoreChain, priorityChain, enabled = true, weight = 1 } = {}) {
	if (!enabled) return false;
	const list = (candidates || []).filter(a => a && isCandidateEligible(a));
	const cached = new Map(), owns = plannerOwnsSequence(plan);
	let changed = false;
	for (const candidate of list) {
		if (!['card', 'equip'].includes(candidate.type) || candidate.utilityVector?.ownedSources?.includes('comboFallback')) continue;
		const targets = selfSetup(candidate) ? [...new Set(list.filter(a => a.targetObj && a.targetObj !== me).map(a => a.targetObj))] : [candidate.targetObj || null];
		if (!targets.length) targets.push(null);
		const hits = [];
		for (const target of targets) {
			if (!cached.has(target)) {
				let detected = [];
				try { detected = detect(me, target); } catch (_) {}
				cached.set(target, Array.isArray(detected) ? detected : []);
			}
			for (const chain of cached.get(target)) {
				if (!chain || !Array.isArray(chain.setup) || !Array.isArray(chain.follow)) continue;
				if (!chain.setup.includes(candidate.id) && !chain.follow.includes(candidate.id)) continue;
				if (!chain.follow.some(id => list.some(a => a.id === id && ['card','equip'].includes(a.type) && overlaps(candidate, a) && (!target || !a.targetObj || a.targetObj === target)))) continue;
				hits.push({ chain, target });
			}
		}
		const chains = hits.map(h => h.chain);
		candidate.comboChainIds = [...new Set(chains.map(c => c.id).filter(Boolean))];
		let strongest = 0;
		if (!owns && candidate.id !== 'tiesuo' && candidate.score > 0) for (const { chain, target } of hits) {
			const setup = (chain.setup || []).includes(candidate.id);
			let raw = 0;
			try { raw = setup ? priorityChain(chain) * 0.05 : scoreChain(me, chain, target) * 0.03; } catch (_) {}
			if (Number.isFinite(raw)) strongest = Math.max(strongest, raw);
		}
		const multiplier = Number.isFinite(weight) ? Math.max(0, weight) : 1;
		const delta = Math.min(1.5, Math.max(0, candidate.score) * Math.min(0.3, strongest * multiplier));
		applyOwnedUtility(candidate, 'comboFallback', [{ dimension: 'synergy', delta,
			note: owns ? 'Planner拥有连续方案，连招不再重复加分' : '连招备用提示取最大值，封顶30%/1.5',
			details: { plannerOwnsSequence: owns, chainCount: chains.length, strongest, weight: multiplier, mode: owns ? 'planner' : 'fallback' } }]);
		if (delta > 0) changed = true;
	}
	return changed;
}
