/*
 * ============================================================
 * 无名AI · 基本出牌决策引擎（cardPlayBrain）
 * ------------------------------------------------------------
 * 作用：把「什么牌基本的标准和判断」固化为一套清晰、可维护的
 *       决策规则，替代 bestAction 里散落堆叠的加分。所有基础
 *       出牌（增益/控制/输出/响应/装备 五类）都走同一套标准。
 *
 * 原则（来自官方人机基础出牌逻辑 + 小杀加权顺序，已核实）：
 *   1. 集火判定：无标记时优先击杀敌方血量最低单位（补刀 > 一切）
 *   2. 装备摸到立刻装，不留手牌
 *   3. 锦囊优先级：纯收益牌(无中/五谷)最高；乐/兵贴关键威胁敌；
 *      拆/顺优先拿敌关键装备/判定区；南蛮/万箭在有队友风险时宁可不放
 *   4. 防御牌按需用：非保命不闪、闪留给酒杀/属性杀；濒死优先出酒/桃
 *   5. 无懈默认只挡针对自己/关键队友的锦囊
 *   6. 收益≤0 不主动出；明显坑队友/喂局的牌直接否决
 *
 * 本模块为纯函数，不读任何游戏全局；所有事实通过 ctx 注入，
 * 可脱离游戏在 Node 下单独单元测试。
 * 身份信念加权：依赖注入 ctx.hi.identityBiasOf（身份感知），非 identity 局返回 0（零回归）。
 * ============================================================
 */

/* ---------- 五类分派 ---------- */
const CAT = {
	gain:      new Set(['wuzhong', 'wugu', 'taoyuan', 'qicai']),          // 增益发育
	control:   new Set(['lebu', 'bingliang', 'shandian', 'guohe', 'shunshou', 'jiedao', 'tiesuo', 'guagu']), // 限制控制
	output:    new Set(['sha', 'huosha', 'leisha', 'juedou', 'nanman', 'wanjian', 'huogong', 'zhujin', 'wushuangyi']), // 输出
	respond:   new Set(['shan', 'tao', 'jiu', 'wuxie']),                 // 响应（不主动出）
	equip:     new Set(['zhuge', 'fangtian', 'qinggang', 'guding', 'guanshi', 'hanbing', 'qilin', 'zhangba', 'cixiong', 'zhuque', 'yiyang', 'qinglong', 'renwang', 'bagua', 'tengjia', 'baiyin', 'dilu', 'jueying', 'chitu', 'dawan', 'zixin', 'hualiu', 'zhuahuang', 'muniu']), // 装备
};

export function classifyCard(id) {
	if (CAT.gain.has(id))    return 'gain';
	if (CAT.control.has(id)) return 'control';
	if (CAT.output.has(id))  return 'output';
	if (CAT.respond.has(id)) return 'respond';
	if (CAT.equip.has(id))   return 'equip';
	return 'other';
}

/* 装备槽位：武器/防具/马，用于立刻装备决策 */
const EQUIP_SLOT = { 'muniu': 'def' };
export function equipKind(id) {
	if (CAT.equip.has(id)) return true;
	return false;
}

/* ---------- 否决硬规则 ----------
 * 返回 { veto, reason }。veto=true 表示该牌在当前局势下不该主动出。
 */
export function vetoCard(id, ctx, tgt) {
	ctx = ctx || {};
	const cat = classifyCard(id);
	const t = ctx.targetLocked === true ? (tgt || null) : (tgt || bestTargetOf(ctx));
	const isAlly = t ? !!t.isAlly : null;

	/* ① 延时/控制打在队友身上 → 否决（解判定除外，由 target 解） */
	if ((id === 'lebu' || id === 'bingliang' || id === 'shandian') && isAlly) {
		return { veto: true, reason: '贴队友' + (id === 'lebu' ? '乐' : id === 'bingliang' ? '兵' : '闪电') + '（应贴敌人）' };
	}
	/* ② 拆/顺队友非判定区 → 不主动（队友自己有更合适的人去处理） */
	if ((id === 'guohe' || id === 'shunshou') && isAlly) {
		if (!(t && t.isJudge)) return { veto: true, reason: '对队友拆/顺（除非解判定区）' };
	}
	/* ③ 输出牌（单点/点杀）打队友 → 否决（含属性杀/决斗/诛杀） */
	if (cat === 'output' && isAlly && id !== 'huogong') {
		return { veto: true, reason: '输出牌打队友' };
	}
	/* ④ 闪电默认否决：高风险，除非有改判且血量安全 */
	if (id === 'shandian') {
		if (!(ctx.hasRejudge && (ctx.me && (ctx.me.hp || 0) >= 3))) {
			return { veto: true, reason: '闪电高风险，无改判/血量不安全不放' };
		}
	}
	/* ⑤ 属性杀/杀 打藤甲队友要再三确认（输出类已拦，这里针对打藤甲敌人也会被火杀打到队友） */
	/* ⑥ 无中生有/五谷 永不正收益为负，不否决（纯正收益） */
	return { veto: false, reason: '' };
}

/* ---------- 基础优先级（越高先出，0-100） ----------
 * 反映五类出牌的先后标准：纯收益 > 补刀 > 及时防御 > 控制 > 输出 > 装备即时
 */
export function basePriority(id, ctx, targetOverride) {
	ctx = ctx || {};
	const cat = classifyCard(id);
	const t = ctx.targetLocked === true ? (targetOverride || null) : (targetOverride || bestTargetOf(ctx));
	switch (cat) {
		case 'gain': {
			if (id === 'wuzhong' || id === 'wugu') return 100;                 // 纯收益神牌
			if (id === 'taoyuan') return (allyLowHpCount(ctx) > 0) ? 92 : 45;  // 有残血队友才高
			return 80;
		}
		case 'equip': {
			// 官方：摸到装备立刻装。武器/防具优先，马次之
			if (id === 'zhuge' || id === 'fangtian' || id === 'qinggang' || id === 'qinglong') return 88;
			if (id === 'renwang' || id === 'bagua' || id === 'baiyin') return 86;
			if (id === 'tengjia') return ctx.enemyHasFire ? 50 : 85;           // 藤甲怕火
			return 78;
		}
		case 'control': {
			if (id === 'lebu')    return goodControlTarget(ctx, t) ? 88 : 30;
			if (id === 'bingliang') return goodControlTarget(ctx, t) ? 82 : 30;
			if (id === 'shunshou') return goodControlTarget(ctx, t) ? 84 : 40;
			if (id === 'guohe')     return goodControlTarget(ctx, t) ? 84 : 40;
			/* ★ 指令 02：tiesuo 不再有专用优先级——铁索的最终「使用/重铸」由
			 * tiesuoEvaluator 唯一决定，本模块只保留 control 分类（默认 60）。 */
			if (id === 'jiedao')    return (t && t.hasSha) ? 55 : 20;
			return 60;
		}
		case 'output': {
			if (id === 'sha' || id === 'huosha' || id === 'leisha') {
				// 能补刀/目标低血/大概率无闪 → 大幅提高
				if (t && canKill(ctx, t)) return 99;                              // 补刀硬规则
				const hit = t ? (1 - (t.shanProb || 0.5)) : 0.5;
				const lowHp = t ? ((t.hp || 3) <= 1) : false;
				return lowHp ? 74 : (hit > 0.6 ? 66 : 42);
			}
			if (id === 'juedou') {
				// 目标杀少 且 自己杀多 → 才打
				if (t) {
					const selfSha = handCountOf(ctx, 'sha');
					const tgtSha = t.shaCount || 0;
					if (selfSha > tgtSha) return 68;
					return 22;
				}
				return 55;
			}
			if (id === 'zhujin') return (t && (t.hp || 3) <= 1) ? 80 : 45;     // 必中伤害，优先补刀
			if (id === 'huogong') return canFireGui(ctx, t) ? 52 : 12;            // 能弃同花色且目标可算明牌才用
			if (id === 'nanman' || id === 'wanjian') {
				const resp = id === 'nanman' ? 'sha' : 'shan';
				const net = aoeNet(ctx, resp);
				if (net >= 2) return 74;                                       // 敌方缺对应牌且不坑队友
				if (net >= 1) return 60;
				return 28;                                                     // 会坑队友/收益低 → 低优先
			}
			return 50;
		}
		case 'respond':
			return 0;                                                          // 出牌阶段不主动出闪/桃/酒/无懈
		default:
			return 40;
	}
}

/* ---------- 目标选择 ----------
 * 从候选目标里挑最适合该牌的一个，返回 { index, score, reason }
 */
export function pickTarget(id, ctx) {
	ctx = ctx || {};
	const cat = classifyCard(id);
	const targets = ctx.targets || [];
	if (!targets.length) return { index: -1, score: 0, reason: '无可选目标' };

	/* 纯收益/装备/响应 → 目标是自己，无外部目标需求 */
	if (cat === 'gain' || cat === 'equip' || cat === 'respond') {
		return { index: -1, score: 0, reason: '作用于自己' };
	}

	let bestI = -1, bestS = -Infinity, bestR = '';
	const _hi = ctx.hi && typeof ctx.hi.identityBiasOf === 'function' ? ctx.hi : null;   /* ★ 深度连接：身份信念加权源（非 identity 局恒 0） */
	targets.forEach(function (t, i) {
		if (t.isAlly && !isAllyUsable(id)) return;   // 多数牌只打敌
		let s = 0;
		/* ★ 深度连接：信念加权直接作用于目标分——高置信疑似敌人优先集火，疑似队友避伤 */
		if (_hi && !t.isAlly && !isAllyUsable(id)) {
			s += _hi.identityBiasOf(ctx.me, t, 0.5);
		}
		// 正收益权重：低血(优先收割)、威胁高、装备价值高
		const lowHp = t.hp !== undefined ? (t.hp <= 1 ? 3 : (t.hp <= 2 ? 2 : 0)) : 0;
		const threat = t.threat || 0;
		const equip = t.equipVal || 0;
		const shanProb = t.shanProb || 0.5;
		const shaProb = t.shaProb || 0.5;

		if (id === 'sha' || id === 'huosha' || id === 'leisha') {
			s = lowHp * 4 + (1 - shanProb) * 2 + threat * 0.5 - equip * 0.3;
		} else if (id === 'juedou') {
			s = (t.shaCount === 0 ? 4 : (t.shaCount === 1 ? 2 : 0)) + lowHp * 2 + threat * 0.3;
		} else if (id === 'zhujin' || id === 'huogong') {
			s = lowHp * 3 + threat * 0.5;
		} else if (id === 'lebu' || id === 'bingliang') {
			s = (t.nextToAct ? 4 : 0) + (t.handCount >= 4 ? 2 : 0) + threat * 0.8;  // 即将行动/手满/高威胁 → 贴
		} else if (id === 'guohe' || id === 'shunshou') {
			s = equip * 2 + (t.isJudge ? 3 : 0) + lowHp;                             // 拆关键装备/判定优先
		} else if (id === 'nanman' || id === 'wanjian') {
			const resp = id === 'nanman' ? 'sha' : 'shan';
			const cnt = id === 'nanman' ? (t.shaCount || 0) : (t.shanProb !== undefined ? Math.round(t.shanProb * 3) : 1);
			s = (cnt === 0 ? 3 : 0) + (lowHp >= 2 ? 2 : 0);
		} else if (id === 'jiedao') {
			s = (t.hasSha ? 3 : 0) + (t.hasWeapon ? 2 : 0) + threat * 0.5;
		} else {
			s = lowHp + threat * 0.5 + equip * 0.5;
		}
		if (s > bestS) { bestS = s; bestI = i; bestR = '目标加分' + Math.round(s * 10) / 10; }
	});
	if (bestI < 0) return { index: -1, score: 0, reason: '没有合适目标（不打）' };
	return { index: bestI, score: bestS, reason: bestR };
}

/* ---------- 汇总决策 ---------- */
export function decideCard(id, ctx, targetIndex) {
	ctx = ctx || {};
	let tgt = null;
	if (targetIndex >= 0 && ctx.targets && ctx.targets[targetIndex]) tgt = ctx.targets[targetIndex];
	const v = vetoCard(id, ctx, tgt);
	if (v.veto) {
		return {
			card: id, category: classifyCard(id),
			veto: true, vetoReason: v.reason,
			priority: 0, targetIndex: targetIndex, reason: '否决：' + v.reason,
		};
	}
	const p = basePriority(id, ctx, tgt);
	const locked = ctx.targetLocked === true;
	const tk = locked
		? { index: (typeof targetIndex === 'number' ? targetIndex : -1), score: 0, reason: tgt ? '沿用候选已绑定目标' : '无外部目标' }
		: pickTarget(id, ctx);
	return {
		card: id, category: classifyCard(id),
		veto: false, vetoReason: '',
		priority: p, targetIndex: tk.index,
		reason: tk.reason,
	};
}

/* ================= 内部工具（纯函数） ================= */

function bestTargetOf(ctx) { if (!ctx.targets || !ctx.targets.length) return null; return ctx.targets[bestIndex(ctx)]; }
function bestIndex(ctx) {
	if (!ctx.targets || !ctx.targets.length) return -1;
	let bi = -1, bs = -Infinity;
	ctx.targets.forEach(function (t, i) { if ((t.threat || 0) > bs) { bs = t.threat || 0; bi = i; } });
	return bi >= 0 ? bi : 0;
}
function handCountOf(ctx, which) {
	if (!ctx.me || !which) return 0;
	if (ctx.me[which] !== undefined) return ctx.me[which];
	return 0;
}
function allyLowHpCount(ctx) {
	let n = 0;
	(ctx.targets || []).forEach(function (t) { if (t.isAlly && (t.hp || 3) <= 1) n++; });
	return n;
}
function goodControlTarget(ctx, targetOverride) {
	// 控制牌：需要有威胁/即将行动/手满的目标才值得贴
	const t = targetOverride || bestTargetOf(ctx);
	if (!t || t.isAlly) return false;
	return (t.handCount >= 4) || !!t.nextToAct || (t.threat || 0) >= 2;
}
function canKill(ctx, targetOverride) {
	const targets = targetOverride ? [targetOverride] : (ctx.targetLocked === true ? [] : (ctx.targets || []));
	for (let i = 0; i < targets.length; i++) {
		const t = targets[i];
		if (!t || t.isAlly) continue;
		if ((t.hp || 3) <= 1 && (1 - (t.shanProb || 0.5)) >= 0.5) return true;
	}
	return false;
}
function canFireGui(ctx, targetOverride) {
	// 火攻：能弃同花色且目标有明牌/高血才用
	let suit = false;
	if (ctx.me && ctx.me.hasSuit) suit = true;
	const t = targetOverride || bestTargetOf(ctx);
	if (!t || t.isAlly) return false;
	return suit && !t.tengjia;   // 打藤甲无效
}
function aoeNet(ctx, respCard) {
	// 正=敌方受害更大；负=坑队友
	let net = 0;
	const targets = ctx.targets || [];
	for (let i = 0; i < targets.length; i++) {
		const t = targets[i];
		if (t.isAlly) net -= wByHp(t.hp, 3);
		else net += wByHp(t.hp, 2);
	}
	// 自己若有对应牌先动用（能无伤时更敢放）
	if (ctx.me && handCountOfResp(ctx, respCard) > 0) net += 1;
	return net;
}
function wByHp(hp, cap) { const h = (hp === undefined) ? 3 : hp; if (h <= 1) return cap; return 1; }
function handCountOfResp(ctx, resp) {
	if (ctx.me && ctx.me[resp] !== undefined) return ctx.me[resp];
	return 0;
}
function isAllyUsable(id) { return id === 'taoyuan' || id === 'jiu' || id === 'tao' || id === 'tiesuo' || id === 'shunshou' || id === 'guohe'; }