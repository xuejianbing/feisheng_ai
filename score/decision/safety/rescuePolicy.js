/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 桃救援策略 · 唯一权威 =================
 * 指令 01：修复「敌方濒死误出桃」。
 * 唯一权威判定：任何想对濒死目标使用桃的路径，都必须先问 evaluateTaoRescue。
 *
 * 不变量（invariants）：
 *   self    -> allow  (自救；target===player 时 dispositionOf 返回 0，必须特判)
 *   ally    -> allow
 *   neutral -> block
 *   enemy   -> block
 *   invalid -> block  (target 缺失/非法)
 *   relation 解析失败 -> 非 self 一律 fail-closed (block)；self 仍 allow
 *
 * 「濒死」只提升紧急度，绝不反转关系方向。
 */
import { dispositionOf } from '../relations/relations.js';

/* Score 契约（方案 §Score Alignment） */
const SCORE = { self: 8, ally: 5, neutral: -3, enemy: -8, invalid: -8 };

function _decision(allow, relation, disposition, score, reason) {
    return { allow: !!allow, relation: relation, disposition: disposition, score: score, reason: reason };
}

/* 归一化 disposition：>0 -> 1，<0 -> -1，===0 -> 0 */
function _norm(d) {
    if (!Number.isFinite(d)) return null;
    if (d > 0) return 1;
    if (d < 0) return -1;
    return 0;
}

/* 解析敌我倾向：ctx 注入优先（测试 seam）→ 权威 relations → fail-closed(null)。
 * 宿主 get.attitude 不再作为默认 fallback，避免身份模式间接读取 hidden identity。 */
function _resolveDisposition(player, target, ctx) {
    const hasInjected = !!(ctx && (
        (typeof ctx.disposition === 'number') ||
        (ctx.relations && typeof ctx.relations.dispositionOf === 'function') ||
        (typeof ctx.attitude === 'function')
    ));
    /* 1) ctx.disposition 直接注入 */
    if (ctx && typeof ctx.disposition === 'number') {
        const n = _norm(ctx.disposition);
        if (n !== null) return n;
    }
    /* 2) ctx.relations.dispositionOf；未注入时用权威 dispositionOf */
    const relFn = (ctx && ctx.relations && typeof ctx.relations.dispositionOf === 'function')
        ? ctx.relations.dispositionOf
        : (hasInjected ? null : dispositionOf);
    if (relFn) {
        try {
            const n = _norm(relFn(player, target));
            if (n !== null) return n;
        } catch (e) { /* 继续回退 */ }
    }
    /* 3) 仅允许显式注入 attitude 作为测试/外部 seam；生产默认不回退宿主 attitude。 */
    const attFn = (ctx && typeof ctx.attitude === 'function') ? ctx.attitude : null;
    if (attFn) {
        try {
            const n = _norm(attFn(player, target));
            if (n !== null) return n;
        } catch (e) { /* fail-closed */ }
    }
    return null;
}

/**
 * 评估「对濒死目标 target 使用桃救援」是否允许。
 * @param {object} player 决策者
 * @param {object} target 濒死目标（若为 player 本人即自救）
 * @param {object} ctx 可选：{ disposition, relations:{dispositionOf}, attitude, dyingTarget }
 * @returns {{allow:boolean, relation:string, disposition:number, score:number, reason:string}}
 */
export function evaluateTaoRescue(player, target, ctx = {}) {
    if (!player || !target || typeof player !== 'object' || typeof target !== 'object') {
        return _decision(false, 'unknown', 0, SCORE.invalid, 'tao.dying.invalid:missing-target');
    }
    /* FR-4：自救必须特判（dispositionOf(player, player) 会返回 0） */
    if (target === player) {
        return _decision(true, 'self', 1, SCORE.self, 'tao.dying.self');
    }
    const d = _resolveDisposition(player, target, ctx);
    if (d === null) {
        return _decision(false, 'unknown', 0, SCORE.invalid, 'tao.dying.unknown:relation-failure');
    }
    if (d > 0) return _decision(true, 'ally', 1, SCORE.ally, 'tao.dying.ally');
    if (d < 0) return _decision(false, 'enemy', -1, SCORE.enemy, 'tao.dying.enemy');
    return _decision(false, 'neutral', 0, SCORE.neutral, 'tao.dying.neutral');
}

export const TAO_RESCUE_SCORE = SCORE;
export default { evaluateTaoRescue, TAO_RESCUE_SCORE };
