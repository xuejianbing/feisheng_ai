/* 保留 evaluator 准许的使用选项及独立重铸选项，不恢复低于使用门槛的动作。 */
export function tiesuoCandidateOptions(result, canRecast) {
 const options = [];
 if (result?.bestAction?.type === 'use' && result.bestAction.targets?.length) {
  options.push({ recast: false, targets: result.bestAction.targets.slice(), utility: result.bestAction.delta });
 }
 if (canRecast && Number.isFinite(result?.recastValue)) {
  options.push({ recast: true, targets: [], utility: result.recastValue });
 }
 return options;
}
