/* 主动候选只来自当前玩家真实的出牌选择窗口；触发技能仍由宿主触发。
 * ★ fix10：chooseButton 技能（需要选目标的绝大多数主动技）恢复候选资格——
 *   旧版「button-dependent-cost 一刀切拒绝」导致 skill 学习采样断崖（skill:card 从 0.86 跌到 0.02，
 *   AI 3 天几乎不主动用需要选目标的技能）。执行层 logSkill 事务只校验技能 id、目标从宿主 args 提取，
 *   chooseButton 子事件由宿主原生 AI 决策，链路安全。
 *   仍拒绝：选牌数/组合依赖的技能（selection-dependent-count / combination-dependent-filter），
 *   这类代价无法静态确证，AI 可能反复选不够牌。
 * ★ fix10：候选漏斗诊断计数（getSkillCandDiag），随批次上报到服务端，便于远程观测断层。 */
const _candDiag = { calls: 0, noChoiceWindow: 0, noFilterEnable: 0, enumSkills: 0, noEnable: 0, filterEnableRej: 0, costRej: {}, costPass: 0, passed: 0 };
function _diagBump(k, sub) {
	try {
		if (sub) { _candDiag[k] = _candDiag[k] || {}; _candDiag[k][sub] = (_candDiag[k][sub] || 0) + 1; }
		else _candDiag[k] = (_candDiag[k] || 0) + 1;
	} catch (eD) {}
}
export function getSkillCandDiag() {
	try { return JSON.parse(JSON.stringify(_candDiag)); } catch (eD) { return { calls: _candDiag.calls }; }
}

export function activePlaySkills(player, event, lib, game, get) {
 _diagBump('calls');
 const seen = new Set();
 let choice = null;
 while (event && !seen.has(event) && seen.size < 64) {
  seen.add(event);
  if (event.name === 'chooseToRespond' || event.name === 'respond' || event.name === 'useCard' || event.name === 'useSkill' || event.name === 'recast') { _diagBump('noChoiceWindow'); return []; }
  if (event.name === 'chooseToUse') {
   if (event.player !== player || event.type !== 'phase') { _diagBump('noChoiceWindow'); return []; }
   choice = event; break;
  }
  event = event.parent || (typeof event.getParent === 'function' ? event.getParent() : null);
 }
 if (!choice || typeof lib?.filter?.filterEnable !== 'function') { _diagBump(choice ? 'noFilterEnable' : 'noChoiceWindow'); return []; }
 let skills = (typeof player.getSkills === 'function' ? player.getSkills(false) : player.skills || []).slice();
 if (typeof game?.expandSkills === 'function') skills = game.expandSkills(skills) || skills;
 const uniq = [...new Set(skills)];
 _candDiag.enumSkills += uniq.length;
 return uniq.filter(id => {
  if (lib.skill?.[id]?.__djscTransport) return false;
  if (!lib.skill?.[id]?.enable) { _diagBump('noEnable'); return false; }
  try {
   if (lib.filter.filterEnable(choice, player, id) !== true) { _diagBump('filterEnableRej'); return false; }
  } catch (_) { _diagBump('filterEnableRej'); return false; }
  const cost = skillCardCost({ ...lib.skill[id], id }, player, choice, lib, get);
  if (!cost.eligible) { _diagBump('costRej', cost.reason || cost.status || 'unknown'); return false; }
  if (cost.status === 'unverified-button') _diagBump('costPass');
  _diagBump('passed');
  return true;
 });
}

/* 只对可静态确证的真实选牌代价建主动候选。未知的动态组合继续交宿主选择。
 * ★ fix10：chooseButton（选目标按钮）不再拒绝——目标选择交给宿主子事件 AI，
 *   执行层已支持从 logSkill args 提取 targets。仅保留「选牌代价不可确证」的拒绝。 */
export function skillCardCost(info, player, event, lib, get = {}) {
 const unknown = reason => ({ eligible: false, status: 'unverified', reason });
 try {
  if (info.chooseButton) return { eligible: true, status: 'unverified-button', required: 0 };
  const selecting = info.filterCard != null && info.filterCard !== false || info.selectCard != null;
  if (!selecting) return { eligible: true, status: 'no-card-cost', required: 0 };
  const selector = info.selectCard == null ? 1 : info.selectCard;
  if (typeof selector === 'function' && /selected\s*\.|selected\s*\[/.test(String(selector))) return unknown('selection-dependent-count');
  const range = typeof selector === 'function' ? selector.call(info, event, player) : selector;
  const minimum = Array.isArray(range) ? range[0] : range;
  if (!Number.isInteger(minimum) || minimum < -1) return unknown('dynamic-card-count');
  const cards = player.getCards?.(info.position || 'h');
  if (!Array.isArray(cards)) return unknown('card-zone-unavailable');
  const required = minimum === -1 ? 0 : minimum;
  if (cards.length < required) return { eligible: false, status: 'impossible', reason: 'insufficient-zone-cards', required, available: cards.length };
  if (info.complexCard && typeof info.filterCard === 'function' || typeof info.filterCard === 'function' && /selected\s*\.|selected\s*\[/.test(String(info.filterCard))) return unknown('combination-dependent-filter');
  let filter = info.filterCard;
  if (filter && typeof filter === 'object') {
   if (typeof get.filter !== 'function') return unknown('structured-card-filter');
   filter = get.filter(filter);
  }
  if (filter != null && typeof filter !== 'function' && typeof filter !== 'boolean') return unknown('dynamic-card-filter');
  const usable = cards.filter(card => {
   if (typeof filter === 'function' && !filter(card, player, event)) return false;
   if (filter === false && required > 0) return false;
   if (info.discard !== false && info.lose !== false && typeof lib?.filter?.cardDiscardable === 'function' && !lib.filter.cardDiscardable(card, player, info.id)) return false;
   return true;
  });
  return { eligible: usable.length >= required, status: usable.length >= required ? 'available' : 'impossible', reason: usable.length >= required ? null : 'insufficient-filtered-cards', required, available: usable.length };
 } catch (_) { return unknown('cost-filter-error'); }
}
