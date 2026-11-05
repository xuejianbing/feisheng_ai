/*
 * ============================================================
 * 无名AI · 技能基本决策引擎（skillPlayBrain）
 * ------------------------------------------------------------
 * 职责：在既有 skillTagsOf / skillProfileOf（源码扫描注解）之上，
 *       套一层统一、可维护的「技能发起决策标准」，与 cardPlayBrain 同法：
 *       分类 → 硬否决 → 优先级 → 目标 → 中文理由。
 *
 * 为什么需要这一层：
 *   现有 skillProfileOf 的 timing.condition 恒为 null（B Point 时间，
 *   低血/已受伤等时机判断从未真正生效）；且大量技能只有一个编译期
 *   静态分，缺乏「此刻该不该发」「对谁发」的运行时裁决。
 *   本模块在决策时刻用 ctx 注入实时局势补上这部分，并对明显错误的
 *   触发（负收益/自伤/坑队友/时机不符）做硬否决。
 *
 * 纯函数：不读游戏全局，profile 与 ctx 由调用方传入，可单测。
 * 身份信念加权：依赖注入 hi.identityBiasOf（身份感知），非 identity 局返回 0（零回归）。
 * ============================================================
 */

/* ---------- 技能分类（运行时微调静态分类） ---------- */
export function classifySkill(profile, ctx) {
	ctx = ctx || {};
	const multi = profile && profile.profit && profile.profit.multi;
	const tags = (profile && profile.tags) || {};
	// 静态分类优先
	if (profile && profile.classify) {
		const c = profile.classify;
		if (c && typeof c === 'object' && c.label) return c.label;
		if (typeof c === 'string') return c;
	}
	// 运行时按标签推算
	const atk = (tags.damage || 0) + (tags.aoe || 0) * 1.5 + (tags.atk || 0);
	const def = (tags.def || 0) + (tags.recover || 0) * 1.5 + (tags.addShan || 0);
	const ctrl = (tags.ctrl || 0) + (tags.discardEnemy || 0) + (tags.loseEnemy || 0) + (tags.turnOver || 0) * 1.5;
	const draw = (tags.draw || 0) + (tags.gain || 0) + (tags.guanxing || 0);
	const aux = (tags.aux || 0) + (tags.giveCard || 0) + (tags.jiji || 0) + (tags.saveAlly || 0);
	const best = Math.max(atk, def, ctrl, draw, aux);
	if (best <= 0) return 'passive';
	if (best === atk) return 'attack';
	if (best === def) return 'defense';
	if (best === ctrl) return 'control';
	if (best === draw) return 'draw';
	return 'aux';
}

/* ---------- 否决硬规则 ----------
 * 返回 { veto, reason }。veto=true 表示该技能此刻不该发动。
 */
export function vetoSkill(sid, profile, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const final_ = profileNet(profile);
	const cost = profileCost(profile);
	const tags = (profile && profile.tags) || {};
	const cat = classifySkill(profile, ctx);

	/* ① 明确亏本的技能：net 明显为负且当前无挽救时机 → 不发动 */
	if (final_ <= -1.5 && !hasUpside(ctx)) {
		return { veto: true, reason: '技能净收益为负（静分 ' + final_ + '）' };
	}
	/* ② 自杀/重自伤：cost 大且自己处于不利（高血开技纯亏） */
	const selfHarm = Math.abs(tags.loseMaxHp || 0) + Math.abs(tags.costHp || 0) + Math.abs(tags.selfDiscard || 0);
	if (selfHarm > 1.2 && (me.hp !== undefined && me.hp >= me.maxHp) && final_ < 3) {
		return { veto: true, reason: '自伤/丢牌换收益，满血开收益不值' };
	}
	/* ③ 时机不符：需要低血的技能，满血时基本不发 */
	if (timingCondition(profile) === '低血') {
		if ((me.hp / Math.max(1, me.maxHp)) > 0.7) {
			return { veto: true, reason: '低血时机技能，当前血线不满足' };
		}
	}
	/* ④ 对队友造成负面/翻面队友的主动技（非解场），运行时从 targets 顶层判断 */
	if (cat === 'control' && ctx.targets) {
		/* 敌我系统：仅真敌(isEnemy)可作控制目标；中性(身份未明)不算可控敌 → 避免盲控 */
		const enemies = ctx.targets.filter(function (t) { return t && t.isEnemy; });
		if (!enemies.length) return { veto: true, reason: '控制技无可控真敌' };
	}
	return { veto: false, reason: '' };
}
function hasUpside(ctx) { return !!ctx.upside || (ctx.me && (ctx.me.hp || 0) <= 1); }

/* ---------- 优先级（0-100，越高越该先发） ---------- */
export function skillPriority(sid, profile, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const final_ = profileNet(profile);
	const tags = (profile && profile.tags) || {};
	const cat = classifySkill(profile, ctx);

	let p = 40;
	// 静分引导
	p += clamp(final_ * 5, -20, 40);

	// 运行时时机加成（修复：skillProfileOf 的 timing.condition 恒 null 的缺口）
	const hpRatio = (me.hp !== undefined && me.maxHp) ? (me.hp / me.maxHp) : 1;
	const tCond = timingCondition(profile);
	const econCtx = ctx.econ || {};
	if (tCond === '低血' || (econCtx.lowHp && hpRatio < 0.4)) p += 18;
	if (econCtx.damaged || (tCond === '已受伤' && (me.hp || 0) < (me.maxHp || 3))) p += 8;
	if (tCond === '濒死' || tCond === 'dying') {
		const hasDying = ctx.dyingAlly || ctx.dyingMe;
		p += hasDying ? 28 : -25;
	}
	// 濒死自救：桃/酒类救援技，绝对优先
	if ((tags.tao || tags.jiu || tags.saveAlly) && (ctx.dyingAlly || ctx.dyingMe)) p = Math.max(p, 95);

	// 目标价值加权
	if (ctx.targets) {
		const enemies = ctx.targets.filter(function (t) { return t && !t.isAlly; });
		if (cat === 'attack' || cat === 'control') {
			let bestT = 0;
			enemies.forEach(function (t) { bestT = Math.max(bestT, (t.threat || 0)); });
			if (bestT >= 3) p += 6;
		}
		if (cat === 'defense' || cat === 'aux') {
			const allies = ctx.targets.filter(function (t) { return t && t.isAlly && (t.hp || 3) <= 1; });
			if (allies.length) p += 10;
		}
	}
	// 残局收割加成
	if (cat === 'attack' && ctx.stage === 'endgame') p += 8;
	// 风险压制：高风险/判定类在残局慎发
	if ((tags.judge || tags.compare) && ctx.stage === 'endgame') p -= 8;

	return clamp(Math.round(p), 0, 100);
}

/* ---------- 目标推荐 ---------- */
export function skillTarget(sid, profile, ctx) {
	ctx = ctx || {};
	const cats = (profile && profile.tags && profile.tags.__targets) || profileTargetCats(profile);
	const cat = classifySkill(profile, ctx);
	const targets = ctx.targets || [];
	const declaredRange = Array.isArray(ctx.selectTargetRange) ? ctx.selectTargetRange : null;
	const declaredMin = declaredRange ? Math.max(0, Number(declaredRange[0]) || 0) : null;
	const declaredMax = declaredRange
		? (declaredRange[1] === Infinity ? Infinity : Math.max(declaredMin, Number(declaredRange[1]) || declaredMin))
		: null;
	const declaredFixed = !!declaredRange && declaredMax !== Infinity && declaredMin === declaredMax;
	/* [0,N] 的 0 不是“没找到目标”，而是宿主明确允许不选目标。
	 * 可变 0..N 的“选0还是选更多”属于技能语义，通用层不得擅自决定；
	 * 固定 [0,0] 则可确证为无需目标。 */
	if (declaredRange && declaredMin === 0) {
		return {
			index: -1,
			reason: declaredFixed
				? '固定零目标：宿主明确无需选择目标'
				: '可选零目标区间：0或更多目标交回宿主',
			targetIndexes: [],
			targetRangeResolved: declaredFixed,
			targetDecisionResolved: declaredFixed,
			targetRequired: false,
		};
	}
	if (!targets.length) return { index: -1, reason: '无目标', targetDecisionResolved: true, targetRequired: true };
	// ★ 多目标：luanji/yehan/fencheng/shenfen/qinyin 等 `__targets:['multi']` 技能
	//   此前无分支 → 落到 {index:-1,'灵活'}，目标从没选出来（熊乱/辉逝类同病）。
	//   这里按技能方向挑选"首要真敌/真友"作主目标，并把全部可作用目标索引一并返回，
	//   供 engine 写回 a.targetList 使多目标 act 的收益方向守卫能逐目标判定。
	const catsArr = Array.isArray(cats) ? cats : [];
	const isMulti = catsArr.indexOf('all') >= 0
		|| catsArr.indexOf('multi') >= 0
		|| (catsArr.length >= 2 && catsArr.indexOf('self') < 0);
	if (isMulti) {
		const intent = profile && profile.targets && profile.targets.intent;
		/* mixed 多目标技能通常包含不同角色/不同效果槽位，不能把所有目标按一个方向全选。 */
		if (intent === 'mixed') return { index: -1, reason: '多目标效果混合，交回专属/原生AI', targetIndexes: [] };

		const offensive = intent === 'offense'
			|| (intent !== 'support' && (cat === 'attack' || cat === 'control'
				|| (cats && cats.indexOf('enemy') >= 0 && cats.indexOf('ally') < 0)));
		const ranked = [];
		targets.forEach(function (t, i) {
			const ok = offensive ? (t.isEnemy === true) : (t.isAlly === true);
			if (!ok) return;
			const dying = (t.hp !== undefined && t.hp <= 0) ? 6 : 0;
			const low = (t.hp !== undefined && t.hp <= 1) ? 3 : 0;
			let score = offensive ? ((t.threat || 0) + low) : (dying + low + (t.threat || 0) * 0.3);
			if (ctx.hi && typeof ctx.hi.identityBiasOf === 'function') {
				score += ctx.hi.identityBiasOf(ctx.me, t.pp, 0.6);
			}
			ranked.push({ i: i, score: score });
		});
		ranked.sort(function (a, b) { return b.score - a.score; });
		if (!ranked.length) return { index: -1, reason: '多目标技能暂无' + (offensive ? '真敌' : '真友'), targetIndexes: [] };

		/* 宿主 selectTarget 是数量硬约束：不能再把所有同方向角色都塞进 targetList。
		 * 动态 selectTarget 无法静态确定时，只提供主目标并 fail-open 给宿主补齐组合。 */
		const range = declaredRange;
		if (!range) {
			return {
				index: ranked[0].i,
				reason: '多目标数量动态：仅推荐主目标，组合交回宿主',
				targetIndexes: [ranked[0].i],
				targetRangeResolved: false,
			};
		}
		const min = declaredMin;
		const max = declaredMax;
		if (ranked.length < min) {
			return { index: -1, reason: '合法目标不足最小数量' + min, targetIndexes: [], targetRangeResolved: true };
		}
		const fixed = max !== Infinity && min === max;
		/* 固定 N 才完整规划 N；可变 [min,max] 只给最小必要组合，额外目标留给宿主。
		 * min=0 已在前面作为“目标可省略”语义 fail-open，不会走到这里。 */
		const want = fixed ? min : min;
		const take = Math.min(ranked.length, max === Infinity ? want : Math.min(want, max));
		const chosen = ranked.slice(0, take).map(function (x) { return x.i; });
		return {
			index: chosen.length ? chosen[0] : -1,
			reason: fixed
				? ('多目标：按收益排序选择' + chosen.length + '个' + (offensive ? '敌方' : '友方') + '目标')
				: ('多目标区间：推荐最小必要' + chosen.length + '个目标，额外选择交回宿主'),
			targetIndexes: chosen,
			targetRangeResolved: fixed,
		};
	}
	// 自身技
	if (cat === 'passive' || cat === 'draw' || (cats && cats.length === 1 && cats[0] === 'self')) {
		return { index: -1, reason: '作用于自己' };
	}
	// 敌方技：选威胁/低血最高
	if (cat === 'attack' || cat === 'control' || (cats && cats.indexOf('enemy') >= 0)) {
		let bi = -1, bs = -Infinity;
		targets.forEach(function (t, i) {
			if (t.isEnemy === false) return;   /* 敌我系统：仅 attitude 真敌；中性(内/身份未明)不作为技能目标 */
			const low = (t.hp !== undefined && t.hp <= 2) ? 2 : 0;
			let s = (t.threat || 0) + low;
			/* ★ 深度连接：身份信念加权（hi.identityBiasOf，非 identity 局恒 0） */
			if (ctx.hi && typeof ctx.hi.identityBiasOf === 'function') {
				s += ctx.hi.identityBiasOf(ctx.me, t, 0.6);
			}
			if (s > bs) { bs = s; bi = i; }
		});
		if (bi < 0) return { index: -1, reason: '没有敌方目标' };
		return { index: bi, reason: '敌方威胁/低血最高' };
	}
	// 己方技：优先主公/濒死
	if (cat === 'defense' || cat === 'aux') {
		let bi = -1, bs = -Infinity;
		targets.forEach(function (t, i) {
			if (!t.isAlly) return;
			const dying = (t.hp !== undefined && t.hp <= 0) ? 5 : 0;
			const low = (t.hp !== undefined && t.hp <= 1) ? 3 : 0;
			const s = dying + low + ((t.threat || 0) * 0.3);
			if (s > bs) { bs = s; bi = i; }
		});
		if (bi < 0) return { index: -1, reason: '没有已方目标' };
		return { index: bi, reason: '优先主公/濒死队友' };
	}
	return { index: -1, reason: '灵活' };
}

/* ---------- 汇总决策 ---------- */
export function decideSkill(sid, profile, ctx) {
	ctx = ctx || {};
	const v = vetoSkill(sid, profile, ctx);
	if (v.veto) {
		return {
			skill: sid, category: classifySkill(profile, ctx),
			veto: true, vetoReason: v.reason,
			priority: 0, targetIndex: -1, reason: '否决：' + v.reason,
		};
	}
	const p = skillPriority(sid, profile, ctx);
	const tk = skillTarget(sid, profile, ctx);
	return {
		skill: sid, category: classifySkill(profile, ctx),
		veto: false, vetoReason: '',
		priority: p, targetIndex: tk.index,
		targetIndexes: tk.targetIndexes || (tk.index >= 0 ? [tk.index] : []),
		targetRangeResolved: tk.targetRangeResolved !== false,
		targetDecisionResolved: tk.targetDecisionResolved !== false,
		targetRequired: tk.targetRequired !== false,
		reason: tk.reason,
	};
}

/* ================= 内部工具 ================= */
function profileNet(profile) {
	try {
		const m = profile.profit && profile.profit.multi;
		if (m && typeof m.final === 'number') return m.final;
		if (profile.profit && typeof profile.profit.base === 'number') return profile.profit.base;
		return 0;
	} catch (e) { return 0; }
}
function profileCost(profile) {
	try { const c = profile.profit && profile.profit.cost; return c ? (c.net || 0) : 0; } catch (e) { return 0; }
}
function timingCondition(profile) {
	// 现有 profile.timing 为静态提示，这里回退到标签里界定的"低血/已受伤/dying"
	try {
		if (profile.timing && profile.timing.condition) return profile.timing.condition;
		const tags = profile.tags || {};
		if (tags.kongcheng > 0) return '低血';
		if (tags.fankui > 0) return '已受伤';
		if (tags.qingnang > 0 || tags.huaituo > 0) return '低血';
		return null;
	} catch (e) { return null; }
}
function profileTargetCats(profile) {
	try { return (profile.tags && profile.tags.__targets) || []; } catch (e) { return []; }
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }