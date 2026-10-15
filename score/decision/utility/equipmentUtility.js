import { makeActionCandidate, runtimeScore } from '../state/actionCandidate.js?v=41a';
import { applyOwnedUtility } from './utilityPipeline.js?v=41a';

/* 装备替换的单一评分入口。host/evaluate显式传入，沿用economy的价值和拆除风险。
 * ids也包含不值得替换的装备：不能回流普通卡牌路径绕过替换成本。 */
export function buildEquipmentUtilityCandidates(me, { get, lib, evaluate, tempo, safety }) {
	const ids = new Set(), candidates = [], byId = new Map();
	const hand = me.getCards('h') || [];
	for (const card of hand) {
		let id, slot;
		try {
			id = card && card.name;
			slot = get.subtype ? get.subtype(card) : lib.card?.[id]?.subtype;
			if (!id || !/^equip\d+$/.test(slot || '')) continue;
		} catch (_) { continue; }
		ids.add(id);
		try {
			const oldCard = (me.getCards('e', c => (get.subtype ? get.subtype(c) : lib.card?.[c.name]?.subtype) === slot) || [])[0] || null;
			const cost = evaluate(me, card, oldCard);
			if (!cost || ![cost.net, cost.newValue, cost.oldValue, cost.stripPressure, tempo, safety].every(Number.isFinite)) continue;
			if (cost.net <= 0) continue;
			const scale = 2 * tempo * safety;
			const gain = cost.newValue * scale, replacement = -cost.oldValue * scale;
			// net包含economy内部舍入，差额保持其原有总分，不能再额外减一次拆除成本。
			const risk = (cost.net - cost.newValue + cost.oldValue) * scale;
			const score = runtimeScore(cost.net * scale);
			const candidate = makeActionCandidate({ type: 'equip', id, score: 0,
				reason: '装备' + id + '（价值' + cost.newValue + '>' + cost.oldValue + '，拆风险' + Math.round(cost.stripPressure * 100) + '%）' });
			applyOwnedUtility(candidate, 'equipReplacement', [
				{ dimension: 'resource', delta: gain, note: '新装备价值（含节奏/安全倍率）' },
				{ dimension: 'resourceCost', delta: replacement, note: '替换原装备成本' },
				{ dimension: 'risk', delta: risk, note: '拆除风险与economy净值舍入' },
				{ dimension: 'legacyResidual', delta: score - (gain + replacement + risk), note: '运行分数舍入' },
			]);
			candidate.score = score;
			const prior = byId.get(id);
			if (!prior || candidate.score > prior.score) byId.set(id, candidate);
		} catch (_) { /* 单张异常不阻断其它候选。 */ }
	}
	for (const candidate of byId.values()) candidates.push(candidate);
	return { ids, candidates };
}
