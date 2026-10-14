/*
 * ============================================
 * // 著者: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 模型热更新（兼容外壳） =================
 * ★ §8 重构：A/B 状态机已并入 modelState.js（单一真相源，消除双状态机重复真相）。
 *   本文件仅保留原模块路径、导出签名与 window.__DJSC.hotSwap 挂载，
 *   全部实现委托 modelState.js；新代码请直接引用 modelState.js。
 *   流程：攒够样本 → 训练出候选 → A/B 分组实战 → 胜率超过旧模型晋升，否则丢弃。
 */
import {
    triggerHotTrain, hotGameStart, hotRecordABScore,
    hotSwapStats, resetHotSwap,
    forcePromote as _msForcePromote, forceDiscard as _msForceDiscard,
    MIN_SAMPLES, MIN_AB_GAMES,
} from './modelState.js?v=5e5';

export { triggerHotTrain, hotGameStart, hotRecordABScore, hotSwapStats, resetHotSwap };

/* ★ 历史契约：hotSwap 的 promote/discard 返回 boolean（modelState 侧包装为 {ok,msg}） */
export function forcePromote() { const r = _msForcePromote(); return !!(r && r.ok); }
export function forceDiscard() { const r = _msForceDiscard(); return !!(r && r.ok); }

if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.hotSwap = {
        trigger: triggerHotTrain,
        recordScore: hotRecordABScore,
        gameStart: hotGameStart,  /* ★ P1-16：开局分组钩子 */
        promote: forcePromote,
        discard: forceDiscard,
        stats: hotSwapStats,
        reset: resetHotSwap,
        MIN_SAMPLES: MIN_SAMPLES,
        MIN_AB_GAMES: MIN_AB_GAMES,
    };
}
