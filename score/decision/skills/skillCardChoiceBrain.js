/*
 * ============================================================
 * 无名AI · 技能选牌通用策略（skillCardChoiceBrain）
 * ------------------------------------------------------------
 * 目标：处理主动技能中的“选自己的牌”阶段，但不写任何技能 ID 特判。
 *
 * 语义分三类：
 *   cost    —— 技能把自己的牌当成本/交换材料（loseCard/selfDiscard/selfLose）
 *   give    —— 技能明确把牌交给他人（giveCard）
 *   unknown —— 无法可靠判断，保持原生 AI，仅做极小机会成本 tie-break
 *
 * cost 模式复用 discardBrain 的保留价值：
 *   保命牌/唯一无懈强保留；冗余杀、无用酒、普通低价值牌更适合作为成本。
 * ============================================================
 */
import { classifyHand, vetoDiscard } from '../basic/discardBrain.js';

function n(v) {
	const x = Number(v);
	return Number.isFinite(x) ? x : 0;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function classifySkillCardSelection(profile, ctx) {
	try {
		ctx = ctx || {};
		const tags = (profile && profile.tags) || {};
		const info = (ctx.skillInfo && typeof ctx.skillInfo === 'object') ? ctx.skillInfo : null;
		const give = Math.max(0, n(tags.giveCard));
		const cost =
			Math.max(0, n(tags.loseCard))
			+ Math.abs(Math.min(0, n(tags.selfDiscard)))
			+ Math.abs(Math.min(0, n(tags.selfLose)));

		/* giveCard 是强语义：明确“把牌给别人”时不能按弃牌成本处理。 */
		if (give > 0.15) return 'give';

		/* 宿主主动技的声明本身是更直接的规则证据：
		 * - filterCard 存在，且未关闭默认 discard/lose → 所选牌是成本/转化材料；
		 * - discard:false / lose:false 常用于“给牌、展示、移动”等非弃置语义，不能猜。
		 * viewAs 技能也属于“拿自己的牌作材料”，因此默认落入 cost。 */
		if (info && info.filterCard) {
			if (info.discard !== false && info.lose !== false) return 'cost';
			if (info.discard === false || info.lose === false) {
				return cost > 0.15 ? 'cost' : 'unknown';
			}
		}

		if (cost > 0.15) return 'cost';
		return 'unknown';
	} catch (e) { return 'unknown'; }
}

function _duplicateAdjustment(cardId, me) {
	me = me || {};
	try {
		if (cardId === 'sha') {
			const c = n(me.shaCount);
			if (c >= 3) return 0.8;
			if (c === 2) return 0.35;
		}
		if (cardId === 'shan') {
			const c = n(me.shanCount);
			const hp = n(me.hp) || 3;
			if (c >= 3 && hp >= 3) return 0.6;
			if (c >= 2 && hp >= 3) return 0.25;
		}
		if (cardId === 'wuxie') {
			const c = n(me.wuxieCount);
			if (c >= 3) return 0.55;
			if (c === 2) return 0.2;
		}
		if (cardId === 'jiu') {
			const c = n(me.jiuCount);
			if (c >= 2 && n(me.shaCount) === 0 && n(me.hp) >= 2) return 0.55;
		}
	} catch (e) {}
	return 0;
}

export function skillCardSelectionAdjustment(cardId, profile, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const value = Number(ctx.cardValue);
	const hasValue = Number.isFinite(value);
	const semantic = classifySkillCardSelection(profile, ctx);

	/* give / unknown：不凭“低价值”推出“应该给/应该选”。
	 * 只保留 Stage 3 原有的极小机会成本 tie-break。 */
	if (semantic !== 'cost') {
		const tiny = hasValue ? clamp(-value * 0.02, -0.2, 0.2) : 0;
		return {
			semantic,
			adjustment: tiny,
			keepScore: null,
			veto: false,
			reason: semantic === 'give'
				? '给牌语义：不套弃牌策略，仅保留极小机会成本'
				: '选牌语义未知：保持原生AI，仅保留极小机会成本',
		};
	}

	const keep = classifyHand(cardId, me);
	const veto = vetoDiscard(cardId, { me, tier: keep });

	/* cost/exchange：
	 * - keep 50 附近为中性；
	 * - 低保留牌得到正调整，高保留牌得到负调整；
	 * - get.value 只作为第二证据；
	 * - 冗余基础牌再轻微加成。
	 *
	 * 调整总体有限（正常范围约 -3~+2.5），避免覆盖宿主技能自身 ai。
	 */
	let adj = clamp((50 - keep) / 20, -2.4, 1.5);
	if (hasValue) adj += clamp((5 - value) * 0.12, -0.6, 0.6);
	adj += _duplicateAdjustment(cardId, me);

	if (veto.veto) {
		/* 不是绝对 -Infinity：若宿主硬性要求必须选，仍允许其在所有负分候选中选择。
		 * 但足够强地把保命牌排到最后。 */
		adj = Math.min(adj, -6);
	}

	return {
		semantic,
		adjustment: clamp(adj, -6, 2.5),
		keepScore: keep,
		veto: !!veto.veto,
		reason: veto.veto
			? ('成本选牌：强保留 ' + cardId + '（' + keep + '）')
			: ('成本选牌：保留值 ' + keep + '，低价值/冗余优先作为成本'),
	};
}
