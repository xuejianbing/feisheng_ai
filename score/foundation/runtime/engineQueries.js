/* 引擎只读查询入口。
 * 引擎拥有实际数据；本模块只转交查询，不保存快照、不安装钩子、不导入业务模块。
 * 健康检查和战报通过这里读取，避免反向加载整个引擎。
 * 尚未连接时返回“未安装/无记录”，只用于加载前展示，不代表引擎已就绪。
 */
let readers = null;
const emptyRound = {};
const emptyScores = [];
const emptyDecisions = [];

/** 完整校验后一次连接；使用函数而不是数据副本，重置对局后仍读取最新记录。 */
export function connectEngineQueries(source) {
    const keys = ['getInstalled', 'getRound', 'getScoreLog', 'getDecisionLog'];
    for (const key of keys) {
        if (!source || typeof source[key] !== 'function') {
            throw new TypeError('引擎查询缺少函数：' + key);
        }
    }
    readers = Object.fromEntries(keys.map(key => [key, source[key]]));
}

// 返回格式和对象身份沿用引擎旧接口；“只读”是调用约定，不对旧对象冻结或复制。
export function getInstalled() { return readers ? readers.getInstalled() : false; }
export function getRound() { return readers ? readers.getRound() : emptyRound; }
export function getScoreLog() { return readers ? readers.getScoreLog() : emptyScores; }
export function getDecisionLog() { return readers ? readers.getDecisionLog() : emptyDecisions; }
