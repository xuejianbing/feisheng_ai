/* 职责：连接既有模型公开接口；不创建模型状态或候选槽。 */
import { mountChampionLearningInterface } from './championLearningInterface.js';
/* 挂到全局方便控制台调试 */
export function mountModelStateInterface(functions) {
    if (typeof window === 'undefined') return;
    const { getState, getGamesSince, forceTrain, forcePromote, forceDiscard, onGameEnd, hotGameStart, hotRecordABScore, hotSwapStats, resetHotSwap, triggerHotTrain, recommend } = functions;
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.modelState = {
        getState, getGamesSince,
        forceTrain, forcePromote, forceDiscard,
        onGameEnd,
        /* ★ §8：合并后的 A/B 接口也在 modelState 命名空间下可见（hotSwap 外壳同步挂载） */
        hotGameStart, hotRecordABScore, hotSwapStats, resetHotSwap, triggerHotTrain,
    };
    window.__DJSC.forceTrain = forceTrain;
    window.__DJSC.forcePromote = forcePromote;
    window.__DJSC.forceDiscard = forceDiscard;
    window.__DJSC.getState = getState;
    window.__DJSC.getGamesSince = getGamesSince;
    window.__DJSC.recommend = recommend;  /* ★ 动态推荐：训练弹窗 & 模型状态面板共用 */
    mountChampionLearningInterface();
}
