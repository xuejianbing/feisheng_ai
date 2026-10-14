/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 动态换算系统（单一货币） =================
 * 设计原则：
 *   「货币只有一种」—— 所有收益最终都统一折算进同一种货币（toMoney 刻度）。
 *   各业务维度（牌/效果/技能/风险/节奏/心理…）不再是独立的"隐形货币"，
 *   而是拥有各自的「动态汇率」，经本中枢兑换成唯一货币后再记账/决策。
 *
 *   fxDims : 维度 → { base: 基准价(业务原始刻度), ref 锚定美元 }，ref 表示该维度
 *             相对"1 标准收益点"的等量关系。
 *   动态系数：随对局阶段/局势/身份浮动（phase k, tempo, identity）。
 */

/* ===== 面向单一货币的维度基准价表 =====
 * rate.business → 该维度的业务原始值（如牌价值 VAL_CARD.use）
 * rate.money   → 该维度 1 个业务刻度对应的「货币等量」基准（0 表示该业务值即货币）
 */
const FX_DIMS = {
	/* 牌型价值：业务值=VAL_CARD.use，1 业务刻度 ≈ 1 货币 */
	card:      { business: 1, money: 1.0 },
	/* 效果价值：业务值=VAL_EFFECT，1 刻度 ≈ 1 货币 */
	effect:    { business: 1, money: 1.0 },
	/* 技能八维分：业务值=skillRules 的 base/final（±15 clamp），1 刻度相对压缩 */
	skill:     { business: 1, money: 0.9 },
	/* 血量：1 点体力置换收益的价值锚（参考 sellHpValue） */
	hp:        { business: 1, money: 2.0 },
	/* 手牌/牌数差：拆 1 张牌的手解放价值 */
	cardCount: { business: 1, money: 1.2 },
	/* 风险定价：让"赌一把"的评分在兑换成可靠货币时打折 */
	risk:      { business: 1, money: 0, clamp: [0, 0.94] },
	/* 心理/情绪加成：引入对局时的超额收益期望 */
	psych:     { business: 1, money: 0 },
	/* 节奏（先手/晚愁）：不构成独立收益，只作为总乘数 */
	tempo:     { business: 1, money: 0 },
};

/* 汇率动态系数：phase → 各维度微调（阶段置信度） */
const FX_PHASE_COEF = {
	early:  { card: 1.00, skill: 0.95, hp: 1.10 },   /* 前期：血量更值钱，技能收益把握低 */
	middle: { card: 1.00, skill: 1.00, hp: 1.00 },
	late:   { card: 1.05, skill: 1.05, hp: 0.90 },   /* 后期：牌与技能最关键，血量趋平 */
	endgame:{ card: 1.10, skill: 1.10, hp: 0.85 },   /* 终局：抓决定胜负的行动 */
};

const _num = function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; };

/* 归一化汇率：得到维度当前「1 业务刻度 → 货币」的动态汇率（含 clamp） */
export function fxRate(dim, ctx) {
	try {
		const d = FX_DIMS[dim];
		if (!d) return 1;
		let rate = d.money;
		if (ctx && ctx.phase) {
			const pc = FX_PHASE_COEF[ctx.phase];
			if (pc && pc[dim] !== undefined) rate *= pc[dim];
		}
		if (d.clamp) {
			const lo = d.clamp[0], hi = d.clamp[1];
			if (rate < lo) rate = lo;
			if (rate > hi) rate = hi;
		}
		return rate;
	} catch (e) { return 1; }
}

/* 统一兑换：把"维度业务值"折算成"货币等量"，再交给 toMoney 封顶。
 * 返回 { money, rate } 便于审计。 */
export function fxToMoney(dim, business, ctx) {
	try {
		const rate = fxRate(dim, ctx);
		const money = _num(business) * rate;
		return { money, rate };
	} catch (e) { return { money: _num(business), rate: 1 }; }
}

/* 维度中文标鉴（便于面板/审计展示） */
export const FX_DIM_LABELS = {
	card: '牌型价值', effect: '效果价值', skill: '技能收益',
	hp: '体力置换', cardCount: '手牌解放', risk: '风险定价',
	psych: '心理加成', tempo: '节奏',
};

/* 快照：当前各维度汇率（面板展示用） */
export function fxSnapshot(ctx) {
	const out = {};
	for (const k in FX_DIMS) {
		const r = fxRate(k, ctx || {});
		const d = FX_DIMS[k];
		out[k] = { label: FX_DIM_LABELS[k] || k, rate: Math.round(r * 100) / 100, base: d.money };
	}
	return out;
}