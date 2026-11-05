/* 对外稳定入口：内部生命周期路径调整不影响调用方。 */
export { installScoreEngine, uninstallScoreEngine, isScoreEngineEnabled,
    openScorePanel, bestAction, rulesDecide, scanReset } from './bootstrap/lifecycle.js';
