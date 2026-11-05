/* 职责：将延迟副作用绑定到既有决策事务。
 * 这里只创建事务并附在返回值上；stage/宿主确认/commit 仍由原执行网关负责。
 * 每个副作用独立隔离异常，不因一个观察模块失败阻断后续记录。 */
import { createDecisionTransaction } from '../state/decisionTransaction.js';
import { postCheckBefore } from '../analysis/postCheck.js';

/* 两个真实宿主入口共用：执行前只拍一次快照，必须携带同一事务编号。 */
export function captureExecutionSnapshot(player, tx) {
    const pc = tx && tx.meta && tx.meta.postCheck;
    if (!pc) return null;
    if (!tx.meta.postCheckKey) {
        tx.meta.postCheckKey = postCheckBefore(player, pc.action, pc.target, pc.isEnemy, tx.id);
    }
    return tx.meta.postCheckKey;
}
export function attachDecisionEffects(result, expected, effects, options) {
    const tx = createDecisionTransaction(expected, function (actual, txInfo) {
        for (let i = 0; i < effects.length; i++) {
            const effect = effects[i];
            try { effect.fn(actual, txInfo); }
            catch (eFx) {
                if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFx);
            }
        }
    }, options);
    Object.defineProperty(result, '__djscTransaction', {
        value: tx, enumerable: false, configurable: false, writable: false,
    });
    return tx;
}
