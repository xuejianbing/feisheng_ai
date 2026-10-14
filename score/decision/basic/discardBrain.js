/*
 * ============================================================
 * 无名AI · 弃牌基本决策引擎（discardBrain）
 * ------------------------------------------------------------
 * 职责：对「弃牌阶段留/弃」给出统一决策标准，
 *       与 cardPlayBrain / skillPlayBrain 同法：
 *       分类 → 否决(不可弃) → 保留优先级 → 弃牌顺序 → 中文理由。
 *
 * 原则（官方人机基础出牌逻辑）：
 *   1. 留牌优先序：桃/无懈(唯一)>闪(血低)>杀(连弩/咆哮)>酒(配杀)>锦囊>废牌
 *   2. 濒死保护：血≤1 时防御牌不可弃
 *   3. 已明知的牌：被敌方已知 → 相对不值 → 优先弃
 *   4. 保留数量固定，弃价值最低者
 *
 * 本模块为纯函数，事实通过 ctx 注入（每张牌一个 keepScore 估算），可单测。
 * ============================================================
 */

/* ---------- 分类（手牌价值梯队） ---------- */
export function classifyHand(id, me) {
	me = me || {};
	const hp = me.hp !== undefined ? me.hp : 3;
	const maxHp = me.maxHp || 3;
	const lowHp = hp <= 1;
	const wxCount = me.wuxieCount || 1;
	const shaCount = me.shaCount || 0;
	const hasZhuge = !!me.hasZhuge;
	const hasPaoxiao = !!me.hasPaoxiao;

	switch (id) {
		case 'tao':
			return hpRatioTier(hp, maxHp);   // 桃：血越低越保
		case 'wuxie':
			return wxCount <= 1 ? 95 : (wxCount === 2 ? 70 : 45);  // 唯一无懈极保
		case 'shan':
			if (lowHp) return 98;
			if (hp <= 2) return 85;
			if (hasZhuge) return 78;   // 敌人可能连弩
			return 62;
		case 'sha':
			if ((shaCount === 1 && (hasZhuge || hasPaoxiao))) return 80;  // 唯一杀+连弩/咆哮 → 保
			if (shaCount <= 1) return 58;
			return 45;
		case 'jiu':
			if (lowHp) return 90;              // 濒死自救
			if (shaCount >= 1 && hasZhuge) return 72;  // 连弩酒杀
			if (shaCount >= 1) return 55;
			return 30;
		case 'lebu':
		case 'bingliang':
		case 'nanman':
		case 'wanjian':
		case 'juedou':
		case 'shunshou':
		case 'guohe':
		case 'wuzhong':
		case 'taoyuan':
			return 40;   // 常规锦囊
		default:
			return 20;   // 废牌/普通牌
	}
}
function hpRatioTier(hp, maxHp) {
	const r = hp / Math.max(1, maxHp);
	if (r <= 0.3) return 98;
	if (r <= 0.5) return 85;
	if (r <= 0.7) return 70;
	return 55;
}

/* ---------- 否决硬规则：某些牌绝对不能弃 ---------- */
export function vetoDiscard(cardId, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const tier = ctx.tier !== undefined ? ctx.tier : classifyHand(cardId, me);
	/* 濒死保护：防御牌不可弃 */
	if ((me.hp || 3) <= 1 && (cardId === 'shan' || cardId === 'tao' || cardId === 'wuxie' || cardId === 'jiu')) {
		return { veto: true, reason: '濒死，防御牌不可弃' };
	}
	/* 高保留值(≥90) → 不可弃 */
	if (tier >= 90) {
		return { veto: true, reason: '关键牌(' + tier + '分)，坚决保留' };
	}
	return { veto: false, reason: '' };
}

/* ---------- 弃牌选择：返回建议丢弃的顺序（低保留值优先） ---------- */
export function choseToDiscard(cardIds, ctx) {
	ctx = ctx || {};
	const list = [];
	(cardIds || []).forEach(function (id) {
		const tier = classifyHand(id, ctx.me);
		const v = vetoDiscard(id, { me: ctx.me, tier: tier });
		list.push({ id: id, tier: tier, keep: tier, veto: v.veto, reason: v.veto ? v.reason : '' });
	});
	/* 按保留值降序 → 反序即为丢弃顺序 */
	list.sort(function (a, b) { return a.tier - b.tier; });   // 低分在前优先弃
	return list;
}

/* ---------- 汇总决策 ---------- */
export function decideDiscard(cardId, ctx) {
	ctx = ctx || {};
	const tier = classifyHand(cardId, ctx.me);
	const v = vetoDiscard(cardId, { me: ctx.me, tier: tier });
	if (v.veto) {
		return { card: cardId, keepScore: tier, veto: true, vetoReason: v.reason, discard: false, reason: '保留：' + v.reason };
	}
	const discard = tier < 40;   // 低价值默认弃
	return {
		card: cardId, keepScore: tier, veto: false, vetoReason: '',
		discard: discard, reason: discard ? '价值低、可弃' : '价值适中、保留',
	};
}