/*
 * ============================================================
 * 无名AI · 响应基本决策引擎（respondBrain）
 * ------------------------------------------------------------
 * 职责：对「响应牌」（闪 / 桃 / 酒 / 无懈）给出统一决策标准，
 *       与 cardPlayBrain / skillPlayBrain 同法：
 *       分类 → 硬否决 → 优先级 → 目标 → 中文理由。
 *
 * 原则（来自官方人机基础出牌逻辑）：
 *   1. 闪：非保命不闪；被酒杀/属性杀(藤甲)才闪；敌人手多要留闪
 *   2. 桃：濒死必救(自己/主公/关键队友)；非濒死视血线与手牌价值
 *   3. 酒：濒死自救优先；配合杀(连弩/咆哮)次之；非濒死不乱喝
 *   4. 无懈：只挡针对自己/关键队友的锦囊；乐/兵/闪电必挡；手牌多才敢挡无关锦囊
 *
 * 本模块为纯函数：不读游戏全局，事实通过 ctx 注入，可单测。
 * ============================================================
 */

/* ---------- 响应分类 ---------- */
export function classifyRespond(id) {
	if (id === 'shan') return '闪';
	if (id === 'tao') return '桃';
	if (id === 'jiu') return '酒';
	if (id === 'wuxie') return '无懈';
	return 'other';
}

/* ---------- 否决硬规则（不该打出的情况） ----------
 * @param id     响应牌名
 * @param ctx    局势 { me, event }（event: 针对谁的什么牌）
 */
export function vetoRespond(id, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const ev = ctx.event || {};
	const cat = classifyRespond(id);

	/* ① 闪：打不到/闪了没意义 */
	if (cat === '闪') {
		// 闪不掉(非杀/万箭) → 不用闪
		const src = ev.source || '';
		const card = ev.card || '';
		if (src && src !== 'sha' && src !== 'wanjian' && src !== 'leisha' && src !== 'huosha') {
			return { veto: true, reason: '非杀类来源(' + src + ')，闪无意义' };
		}
		// 自己血量安全 + 手牌价值高 → 留闪（敌人多手时）
		if (me.hp >= 3 && ev.keepShan) {
			return { veto: true, reason: '血线安全，闪留作关键挡' };
		}
	}
	/* ② 桃：非濒死 + 满血 → 不主动出 */
	if (cat === '桃') {
		const dying = ev.dying || ctx.dying;
		if (!dying && me.hp !== undefined && me.hp >= (me.maxHp || me.hp)) {
			return { veto: true, reason: '无人濒死且自己满血，桃不浪费' };
		}
		// 濒死但救的目标对自己敌意(不应救) → 否决
		if (dying && ev.dyingTarget && ev.dyingTarget.isAlly === false && !ev.mustSave) {
			return { veto: true, reason: '濒死目标为敌人，不救' };
		}
	}
	/* ③ 酒：非濒死自救 + 无杀可用/无连弩 → 不喝 */
	if (cat === '酒') {
		const dying = ev.dying || ctx.dying;
		const mySha = me.shaCount || 0;
		const hasZhuge = !!me.hasZhuge;
		if (!dying && mySha <= 0 && !hasZhuge) {
			return { veto: true, reason: '无杀配合，酒喝了浪费' };
		}
	}
	/* ④ 无懈：最终政策唯一来自 wuxieEvaluator，经 ctx.event.wuxieUse 注入。
	 *   true  = evaluator 判定该出无懈 → 不否决；
	 *   false = evaluator 判定该保留 → 否决（block）；
	 *   null/undefined = 上下文无法解析 → fail-open，不否决（交回原生 AI）。
	 *   本模块不再维护 harmful/critical 名单，也不再用「最后一张无懈」硬否决。 */
	if (cat === '无懈') {
		if (ev.wuxieUse === false) return { veto: true, reason: 'evaluator 判定保留无懈' };
		return { veto: false, reason: ev.wuxieUse === true ? 'evaluator 判定出无懈' : '无懈上下文待定，交回原生' };
	}
	return { veto: false, reason: '' };
}

/* ---------- 响应优先级（0-100，越高越该出） ---------- */
export function respondPriority(id, ctx) {
	ctx = ctx || {};
	const me = ctx.me || {};
	const ev = ctx.event || {};
	const cat = classifyRespond(id);
	const dying = ev.dying || ctx.dying;

	switch (cat) {
		case '桃': {
			if (dying) {
				// 濒死目标优先级：自己>主公>关键队友
				const t = ev.dyingTarget || {};
				if (t.isMe) return 100;
				if (t.isLord || (t.threat || 0) >= 2) return 96;
				if (t.isAlly) return 90;
				return 40;  // 敌人濒死不主动救
			}
			// 非濒死：自己血低才用
			const ratio = (me.hp || 3) / Math.max(1, me.maxHp || 3);
			if (ratio <= 0.4) return 70;
			if (ratio <= 0.6) return 45;
			return 20;
		}
		case '酒': {
			if (dying && ev.dyingIsMe) return 98;         // 濒死自救
			if (me.hasZhuge && (me.shaCount || 0) >= 1) return 75;  // 连弩酒杀
			if ((me.shaCount || 0) >= 2) return 60;       // 杀多可酒
			return 20;
		}
		case '闪': {
			// 被杀且闪能保命 → 高优
			const hp = me.hp || 3;
			const hitIsFatal = ev.fatal || (hp <= 1);
			if (hitIsFatal) return 88;
			// 酒杀/属性杀(自己可能藤甲) → 高优
			if (ev.strong || ev.elemental) return 78;
			// 普通杀 → 看血线与后续
			if (hp <= 2) return 55;
			return 35;   // 血多可留
		}
		case '无懈': {
			const key = ev.keyTrick;
			if (key === 'lebu' || key === 'bingliang') return 92;   // 乐/兵必挡
			if (key === 'shandian') return 85;                       // 闪电
			if (key === 'nanman' || key === 'wanjian' || key === 'juedou') return 80;
			// 针对自己/关键队友
			const t = ev.target || {};
			if (t.isMe || t.isLord || t.isAlly || (t.threat || 0) >= 2) return 78;
			return 30;   // 无关锦囊可留
		}
		default:
			return 0;
	}
}

/* ---------- 目标/使用对象推荐 ---------- */
export function respondTarget(id, ctx) {
	ctx = ctx || {};
	const ev = ctx.event || {};
	if (id === 'tao' || id === 'jiu') {
		const dying = ev.dyingTarget || (ctx.targets && ctx.targets[0]) || null;
		if (dying && !dying.isAlly) return { index: -1, reason: '只救己方濒死' };
		return { index: 0, reason: '濒死/自己' };
	}
	return { index: -1, reason: '响应类无主动目标' };
}

/* ---------- 汇总决策 ---------- */
export function decideRespond(id, ctx) {
	ctx = ctx || {};
	const v = vetoRespond(id, ctx);
	if (v.veto) {
		return {
			card: id, category: classifyRespond(id),
			veto: true, vetoReason: v.reason,
			priority: 0, targetIndex: -1, reason: '否决：' + v.reason,
		};
	}
	const p = respondPriority(id, ctx);
	const tk = respondTarget(id, ctx);
	return {
		card: id, category: classifyRespond(id),
		veto: false, vetoReason: '',
		priority: p, targetIndex: tk.index,
		reason: tk.reason,
	};
}
