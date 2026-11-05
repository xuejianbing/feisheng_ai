/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 无懈可击时机（evaluator wrapper） =================
 * ★ 指令 03：本模块不再是第二套「出/不出无懈」最终政策。
 *   所有判断统一委托 wuxieEvaluator.evaluateWuxie；本文件仅保留为轻量 wrapper，
 *   供旧的打分路径（engine.js 的 wuxieBonus 打分乘子）消费。
 *
 * 契约：
 *   - 缺少上下文（无 spellId）→ 不构成最终政策，wuxieBonus 返回中性/保留分；
 *   - 上下文可解析 → 结论与 evaluator 完全一致；
 *   - 绝不 hard veto，绝不维护第二套 critical/shamful 名单。
 */
import { evaluateWuxie } from '../response/wuxieEvaluator.js';

/**
 * 无懈使用时机建议（委托唯一权威 evaluator）。
 * @param {*} me       决策者
 * @param {*} target   原始锦囊的受害目标（可为 null）
 * @param {string} spellId 原始锦囊 id
 * @returns {{use:boolean, reason:string}}
 */
export function wuxieTiming(me, target, spellId) {
	try {
		if (!me || !spellId) return { resolved: false, use: null, reason: '缺少上下文，交回原生' };
		const r = evaluateWuxie(me, null, { originalSpellId: spellId, target: target || null });
		if (!r.resolved) return { resolved: false, use: null, reason: '上下文待定：' + r.reason };
		return { resolved: true, use: !!r.use, reason: r.reason };
	} catch (e) {
		return { resolved: false, use: null, reason: '出错，交回原生' };
	}
}

/* ★ 无懈可击使用评分加成（只影响打分，不构成最终政策）。
 * unresolved 必须结构化 fail-open，禁止再靠中文 reason 文本判断。 */
export function wuxieBonus(me, act) {
	try {
		if (!act || act.id !== 'wuxie') return 1.0;

		const timing = wuxieTiming(me, act.target, act.spellId);
		if (!timing.resolved) return 1.0;
		if (timing.use) return 1.5;
		return 0.5;   /* resolved 且建议保留 → 打分提示留牌 */
	} catch (e) {
		return 1.0;
	}
}