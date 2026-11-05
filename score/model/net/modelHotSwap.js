/*
 * ============================================
 * // 著者: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 模型热更新（兼容外壳） =================
 * ★ A/B 唯一状态机现位于 model/state/modelLifecycle.js；net/modelState.js 同为兼容入口。
 *   本文件仅保留原模块路径、导出签名与 window.__DJSC.hotSwap 挂载，
 *   全部实现委托 modelLifecycle.js；不在本兼容文件创建候选槽。
 *   流程：攒够样本 → 训练出候选 → A/B 分组实战 → 胜率超过旧模型晋升，否则丢弃。
 */
import {
    triggerHotTrain, hotGameStart, hotRecordABScore,
    hotSwapStats, resetHotSwap,
    forcePromote as _msForcePromote, forceDiscard as _msForceDiscard,
    MIN_SAMPLES, MIN_AB_GAMES,
} from '../state/modelLifecycle.js';

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
