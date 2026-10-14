/*
 * ============================================================
 * 无名AI · 判定基本决策引擎（judgeBrain）
 * ------------------------------------------------------------
 * 职责：对「判定区牌 / 改判 / 拆判定」给出统一决策标准，
 *       与 cardPlayBrain / skillPlayBrain 同法：
 *       分类 → 硬否决 → 优先级 → 目标 → 中文理由。
 *
 * 判定区三类：
 *   - 乐不思蜀(lebu)：出牌阶段前判定，红桃=通过
 *   - 兵粮寸断(bingliang)：摸牌前判定，非梅花=通过
 *   - 闪电(shandian)：判定阶段判定，黑桃2-9=3点雷电伤害，否则弃置
 *
 * 原则（官方人机）：
 *   1. 乐/兵贴关键威胁（手满/即将行动/高威胁）
 *   2. 闪电：只留给高血/有改判者；自己低血必拆
 *   3. 改判：能救自己/关键队友判定时高优
 * ============================================================
 */

/* ---------- 分类 ---------- */
export function classifyJudge(id) {
	if (id === 'lebu') return '乐';
	if (id === 'bingliang') return '兵';
	if (id === 'shandian') return '闪电';
	return 'other';
}

/* ---------- 是否该在当前局势使用（否决硬规则） ---------- */
export function vetoJudge(id, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const t = ctx.target || {};
	/* ① 乐/兵贴队友 → 否决 */
	if ((id === 'lebu' || id === 'bingliang') && t.isAlly) {
		return { veto: true, reason: '贴队友' + classifyJudge(id) + '（应贴敌人）' };
	}
	/* ② 闪电：无改判 + 血不安全 → 否决 */
	if (id === 'shandian') {
		if (!(ctx.hasRejudge && (me.hp || 0) >= 3)) {
			return { veto: true, reason: '闪电高风险，无改判/血不安全不放' };
		}
	}
	return { veto: false, reason: '' };
}

/* ---------- 判定牌优先级（越高越该贴/保留） ---------- */
export function judgePriority(id, ctx) {
	ctx = ctx || {};
	const t = ctx.target || {};
	const me = ctx.me || {};
	switch (classifyJudge(id)) {
		case '乐':
			/* 高威胁/手满/即将行动 → 高优 */
			return (t.handCount >= 4 || !!t.nextToAct || (t.threat || 0) >= 2) ? 88 : 30;
		case '兵':
			/* 限制摸牌，适合针对靠摸牌吃饭的敌 */
			return (t.threat || 0) >= 2 ? 82 : 28;
		case '闪电':
			/* 让高血敌背锅/自己有改判 → 可用 */
			if (ctx.hasRejudge && (me.hp || 0) >= 3) return 60;
			if ((t.hp >= 4)) return 55;   // 高血敌扛得起
			return 25;
		default:
			return 40;
	}
}

/* ---------- 判定目标选择 ---------- */
export function judgeTarget(id, ctx) {
	ctx = ctx || {};
	const targets = ctx.targets || [];
	if (!targets.length) return { index: -1, reason: '无可选目标' };
	let bi = -1, bs = -Infinity;
	targets.forEach(function (t, i) {
		if (t.isAlly) return;   // 贴敌人
		let s = (t.threat || 0);
		if (classifyJudge(id) === '乐') s += (t.handCount >= 4 ? 3 : 0) + (t.nextToAct ? 2 : 0);
		if (classifyJudge(id) === '闪电') s += (t.hp >= 4 ? 2 : 0);
		if (s > bs) { bs = s; bi = i; }
	});
	if (bi < 0) return { index: -1, reason: '无可贴敌人' };
	return { index: bi, reason: '敌方威胁/条件最佳' };
}

/* ---------- 改判价值（是否值得用改判技救判定） ---------- */
export function rejudgeValue(id, ctx) {
	// id: 被改的判定牌
	ctx = ctx || {};
	const me = ctx.me || {};
	const self = ctx.selfJudge;   // 是否是我/我方的判定
	const key = classifyJudge(id);
	/* 乐/兵：自己/关键队友必救 */
	if ((key === '乐' || key === '兵') && self !== false) {
		if (me.hp !== undefined && me.hp <= 2) return 92;
		return 78;
	}
	/* 闪电：救关键队友/自己 */
	if (key === '闪电') {
		if (self && (me.hp || 3) <= 2) return 90;
		if (self === false && ctx.keyAlly) return 80;
		return 40;
	}
	return 30;
}

/* ---------- 汇总决策 ---------- */
export function decideJudge(id, ctx) {
	ctx = ctx || {};
	const v = vetoJudge(id, ctx);
	if (v.veto) {
		return { card: id, category: classifyJudge(id), veto: true, vetoReason: v.reason, priority: 0, targetIndex: -1, reason: '否决：' + v.reason };
	}
	const p = judgePriority(id, ctx);
	const tk = judgeTarget(id, ctx);
	return { card: id, category: classifyJudge(id), veto: false, vetoReason: '', priority: p, targetIndex: tk.index, reason: tk.reason };
}