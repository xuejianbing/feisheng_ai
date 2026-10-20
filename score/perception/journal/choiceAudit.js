/* 有界的响应/子选择事实记录。失败不影响游戏，不保留手牌内容或宿主对象到档案。 */
import { get } from '../../foundation/adapt/host.js?v=41a';
import { playerKey } from '../../foundation/adapt/playerIdentity.js?v=41a';
let recorder = null, sessionOf = () => null, generation = 0, sequence = 0;
let session = null, count = 0, attempted = 0, dropped = 0, ids = new WeakMap(), writes = new Map();
export function installChoiceAudit(record, currentSession = () => null) {
 const owner = ++generation;
 recorder = record; sessionOf = currentSession; session = null; count = 0; attempted = 0; dropped = 0; ids = new WeakMap(); writes = new Map();
 return () => { if (owner === generation) { recorder = null; generation++; ids = new WeakMap(); } };
}
function syncSession() {
 const next = sessionOf();
 if (next !== session) { session = next; count = 0; attempted = 0; dropped = 0; ids = new WeakMap(); writes = new Map(); }
 return next;
}
export function choiceAuditStats() { try { if(recorder)syncSession(); } catch (_) {} return {recorded:count,attempted,dropped,limit:512}; }
export function choiceAuditId(object) {
 if (!object || typeof object !== 'object') return null;
 if (!ids.has(object)) ids.set(object,'choice_'+(++sequence));
 return ids.get(object);
}
export function findAuditUseEvent(event) {
 const seen = new Set();
 for (let i=0;event && i<16 && !seen.has(event);i++) {
  seen.add(event);
  if (event.name === 'useCard') return event;
  try { event = event.parent || event.getParent?.(); } catch (_) { return null; }
 }
 return null;
}
export function beginChoiceAudit(enabled, actor, event, domain, parentEvent = null) {
 try {
  if (!enabled || !recorder || !event || typeof event!=='object' || get.mode?.() !== 'doudizhu') return null;
  const tokenSession = syncSession(), owner = generation;
  const requestId = choiceAuditId(event), root = findAuditUseEvent(event) || findAuditUseEvent(parentEvent);
  const budgetKey=playerKey(actor)+'/'+requestId+'/'+domain;
  return {record(phase, facts) {
   try {
    if (owner !== generation || tokenSession !== syncSession()) return;
    const terminal=phase.endsWith('-returned')||phase==='host-use-created';
    if (attempted >= 512 || (writes.get(budgetKey)||0) >= (terminal?6:5)) { dropped++; return; }
    attempted++;
    writes.set(budgetKey,(writes.get(budgetKey)||0)+1);
    const result = recorder({...facts,schema:'choice-audit-v1',requestId,rootActionId:choiceAuditId(root),sessionId:tokenSession,
     actorId:playerKey(actor),domain,phase,trainingEligible:false});
    if (result !== null && result !== false) count++; else dropped++;
   } catch (_) { dropped++; }
  }};
 } catch (_) { return null; }
}
