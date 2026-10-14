/*
 * ============================================
 * 版权所有，侵权必究
 * 通用卡牌博弈AI决策引擎 · 内核模块
 * ============================================
 */

/* ================= 专业级扩展点注册表（Extension Points） =================
 *
 * 【用途】
 * 让「未来可做到专业级」的每个方向都有明确落点：
 * 接入时只需写一个实现函数 + 调一次 register()，内核无需改动。
 *
 * 【八类扩展点】
 *   scorer        评分模块   —— 自定义加/减分规则
 *   featureBlock  特征块     —— 向 130 维契约追加特征（须同步登记维度）
 *   guardRule     护栏规则   —— 合法性红线，返回非空即否决动作
 *   strategy      对局策略   —— 攻/防/辅助等宏观策略，产出乘数
 *   modelBackend  模型后端   —— 本地/远程/集成模型的统一入口
 *   metric        评估指标   —— 胜率/收益/命中率等评估量
 *   host          宿主适配   —— 接入其它游戏运行时的注入点
 *   gameProfile   游戏档案   —— 语义牌表/阶段/阵营/胜负
 *
 * 【未注册时的行为】内核一律走内置默认实现，因此注册表可以为空。
 *
 * 【注册示例】
 *   __DJSC.extPoints.register('metric', 'myWinRate', function (trace) {
 *       return trace && trace.win ? 1 : 0;
 *   }, { label: '我的胜率' });
 */

export const POINTS = {
	SCORER: 'scorer',
	FEATURE_BLOCK: 'featureBlock',
	GUARD_RULE: 'guardRule',
	STRATEGY: 'strategy',
	MODEL_BACKEND: 'modelBackend',
	METRIC: 'metric',
	HOST: 'host',
	GAME_PROFILE: 'gameProfile',
};

/* 各扩展点的契约与「专业级目标数量」（用于就绪度评估） */
export const POINT_SPEC = {
	scorer: { label: '评分模块', expect: 12, contract: ['id:string', 'fn(cand,ctx)=>number'], desc: '对候选动作做加减分，返回分值增量' },
	featureBlock: { label: '特征块', expect: 8, contract: ['id:string', 'dims:number', 'fn(state,ctx)=>number[]'], desc: '向 130 维契约追加特征块，须同步登记维度' },
	guardRule: { label: '护栏规则', expect: 7, contract: ['id:string', 'fn(action,ctx)=>null|{block,reason}'], desc: '合法性红线，返回非空即否决' },
	strategy: { label: '对局策略', expect: 4, contract: ['id:string', 'fn(ctx)=>object'], desc: '攻/防/辅助等宏观策略，产出乘数' },
	modelBackend: { label: '模型后端', expect: 1, contract: ['id:string', 'predict(features)=>number[]'], desc: '本地/远程/集成模型统一入口' },
	metric: { label: '评估指标', expect: 6, contract: ['id:string', 'fn(trace)=>number'], desc: '胜率/收益/命中率等评估量' },
	host: { label: '宿主适配', expect: 1, contract: ['install(host)'], desc: '接入其它游戏运行时的注入点' },
	gameProfile: { label: '游戏档案', expect: 1, contract: ['setProfile(p)'], desc: '语义牌表/阶段/阵营/胜负条件' },
};

/* ---------- 内部注册表 ---------- */
const _reg = {};
Object.keys(POINT_SPEC).forEach(function (p) { _reg[p] = {}; });

/**
 * 注册一个扩展实现
 * @param {string} point 扩展点（见 POINTS）
 * @param {string} id 唯一标识
 * @param {Function} impl 实现
 * @param {object} [meta] 元信息（label / builtin / dims / note …）
 */
export function register(point, id, impl, meta) {
	try {
		if (!_reg[point]) return { ok: false, reason: '未知扩展点: ' + point };
		if (!id || typeof id !== 'string') return { ok: false, reason: 'id 必须是非空字符串' };
		if (typeof impl !== 'function') return { ok: false, reason: '实现必须是函数' };
		_reg[point][id] = { id: id, impl: impl, meta: meta || {}, ts: Date.now() };
		return { ok: true, point: point, id: id, count: Object.keys(_reg[point]).length };
	} catch (e) {
		return { ok: false, reason: String(e) };
	}
}

/** 注销一个扩展实现 */
export function unregister(point, id) {
	try {
		if (!_reg[point] || !_reg[point][id]) return false;
		delete _reg[point][id];
		return true;
	} catch (e) { return false; }
}

/** 取实现函数；未注册返回 null */
export function getImpl(point, id) {
	try {
		const e = _reg[point] && _reg[point][id];
		return e ? e.impl : null;
	} catch (e) { return null; }
}

/** 取某扩展点下全部条目 */
export function list(point) {
	try {
		const g = _reg[point] || {};
		return Object.keys(g).map(function (k) {
			return { id: g[k].id, meta: g[k].meta, ts: g[k].ts };
		});
	} catch (e) { return []; }
}

/** 是否存在某扩展点实现 */
export function has(point, id) { return !!getImpl(point, id); }

/** 专业级就绪度：各扩展点已注册数 vs 目标数 */
export function readiness() {
	const rows = [];
	let done = 0;
	let total = 0;
	Object.keys(POINT_SPEC).forEach(function (p) {
		const spec = POINT_SPEC[p];
		const n = Object.keys(_reg[p] || {}).length;
		total += spec.expect;
		done += Math.min(n, spec.expect);
		rows.push({
			point: p, label: spec.label, desc: spec.desc,
			contract: spec.contract, registered: n, expect: spec.expect, open: Math.max(0, spec.expect - n),
		});
	});
	return {
		rows: rows,
		registered: done,
		expect: total,
		percent: total ? Math.round((done / total) * 100) : 0,
	};
}

/* ---------- 内置实现（证明机制可用，同时也是真实可用的指标） ---------- */

register(POINTS.METRIC, 'sampleCount', function () {
	try { return (window.__DJSC.trainBufferSize && window.__DJSC.trainBufferSize()) || 0; } catch (e) { return 0; }
}, { label: '训练样本数', builtin: true });

register(POINTS.METRIC, 'championCount', function () {
	try {
		const c = window.__DJSC.champion && window.__DJSC.champion.getChampions
			? window.__DJSC.champion.getChampions() : null;
		if (!c) return 0;
		let n = 0;
		Object.keys(c).forEach(function (k) { n += (c[k] && c[k].length) || 0; });
		return n;
	} catch (e) { return 0; }
}, { label: '冠军决策点', builtin: true });

/* ★ 补实现 · 只读评估指标（read-only，不改对局行为；内核预留消费）
 * 供就绪度评估与「专业级就绪度」报告展示真实的运行态指标。 */
register(POINTS.METRIC, 'winRate', function (trace) {
	try {
		/* trace 显式传入优先；否则取策略进化当前最优的胜率 */
		if (trace && (trace.win !== undefined)) return trace.win ? 1 : 0;
		const cur = window.__DJSC.evolution && window.__DJSC.evolution.current
			? window.__DJSC.evolution.current() : null;
		if (cur && cur.games) return cur.wins / cur.games;
		const st = window.__DJSC.shared && window.__DJSC.shared.stats
			? window.__DJSC.shared.stats() : null;
		if (st && st.total) return (st.wins || 0) / st.total;
		return null;
	} catch (e) { return null; }
}, { label: '胜率（进化/知识库）', builtin: true });

register(POINTS.METRIC, 'avgGain', function () {
	try {
		const st = window.__DJSC.postCheck && window.__DJSC.postCheck.stats
			? window.__DJSC.postCheck.stats() : null;
		if (st && typeof st.avgGain === 'number') return st.avgGain;
		return null;
	} catch (e) { return null; }
}, { label: '决策后检测平均收益', builtin: true });

register(POINTS.METRIC, 'positiveRate', function () {
	try {
		const st = window.__DJSC.postCheck && window.__DJSC.postCheck.stats
			? window.__DJSC.postCheck.stats() : null;
		if (st && st.totalChecks) return st.positive / st.totalChecks;
		return null;
	} catch (e) { return null; }
}, { label: '决策正收益占比', builtin: true });

register(POINTS.METRIC, 'sharedKnowHow', function () {
	try {
		const st = window.__DJSC.shared && window.__DJSC.shared.stats
			? window.__DJSC.shared.stats() : null;
		if (!st) return 0;
		return (st.fingerprints || 0) + (st.adopts || 0) + (st.contributes || 0);
	} catch (e) { return 0; }
}, { label: '公共知识库沉淀条目', builtin: true });

register(POINTS.METRIC, 'evolutionProgress', function () {
	try {
		const st = window.__DJSC.evolution && window.__DJSC.evolution.stats
			? window.__DJSC.evolution.stats() : null;
		if (!st) return 0;
		return (st.generation || 0) + (st.population || 0);
	} catch (e) { return 0; }
}, { label: '策略进化进度', builtin: true });

/* ★ 补实现 · 对局策略（行为中立：默认全部乘数=1，不改变内核决策）
 * 内核按 id 选用；未选用时返回空即走内置默认，因此安全。 */
const _neutralStrategy = function (mult) {
	return function () { return { attack: mult.attack, defense: mult.defense, support: mult.support, economy: mult.economy }; };
};
register(POINTS.STRATEGY, 'balanced', _neutralStrategy({ attack: 1, defense: 1, support: 1, economy: 1 }), { label: '平衡策略', builtin: true });
register(POINTS.STRATEGY, 'aggressive', _neutralStrategy({ attack: 1.2, defense: 0.9, support: 1, economy: 1 }), { label: '进攻策略', builtin: true });
register(POINTS.STRATEGY, 'defensive', _neutralStrategy({ attack: 0.9, defense: 1.2, support: 1, economy: 1 }), { label: '防守策略', builtin: true });
register(POINTS.STRATEGY, 'support', _neutralStrategy({ attack: 0.9, defense: 1, support: 1.2, economy: 1 }), { label: '辅助策略', builtin: true });

/* ★ 补实现 · 模型后端（委托本地模型，未就绪时返回均匀分布，行为中立） */
register(POINTS.MODEL_BACKEND, 'local', function (features) {
	try {
		const fn = window.__DJSC.predict;
		if (typeof fn === 'function') {
			const p = fn(features);
			if (Array.isArray(p) && p.length) return p;
		}
		/* 回退：均匀分布（不偏置任何标签） */
		return [1, 1, 1, 1, 1, 1].map(function () { return 1 / 6; });
	} catch (e) { return [1, 1, 1, 1, 1, 1].map(function () { return 1 / 6; }); }
}, { label: '本地模型后端', builtin: true });
