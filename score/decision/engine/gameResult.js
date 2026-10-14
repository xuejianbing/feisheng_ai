/* 宿主明确结果是唯一来源；不从积分、存活或未知阵营推断胜负。 */
export function hostGameResult(result, onlineResult, online = false) {
 const value = online ? onlineResult : result;
 if (value === true || value === '战斗胜利') return 'win';
 if (value === false || value === '战斗失败') return 'lose';
 if (value === '平局' || value === 'draw' || result === '平局' || result === 'draw') return 'draw';
 return 'unknown';
}
export function binaryGameResult(verdict) { return verdict === 'win' ? true : verdict === 'lose' ? false : null; }
export function gameResultLabel(verdict) { return {win:'胜利',lose:'失败',draw:'平局',unknown:'未知'}[verdict] || '未知'; }
