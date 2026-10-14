/* 决策/提交共享真实出牌选择窗口；响应和其他动作不借用祖先出牌建议。 */
export function playChoiceWindow(event, player, execution = false) {
 const seen = new Set(); let actionRoot = null;
 while (event && !seen.has(event) && seen.size < 64) {
  seen.add(event);
  if (event.name === 'respond' || event.name === 'chooseToRespond') return null;
  if (['useCard', 'useSkill', 'recast'].includes(event.name)) {
   if (!execution || event.player && event.player !== player || actionRoot) return null;
   actionRoot = event;
  }
  if (event.name === 'chooseToUse') return event.player === player && event.type === 'phase' ? event : null;
  event = event.parent || (typeof event.getParent === 'function' ? event.getParent() : null);
 }
 return null;
}
