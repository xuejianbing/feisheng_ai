import { buildActionCreditLedger } from '../../model/train/actionCredit.js?v=5e5';
/* 酒→杀执行证据；成本账本与未知的因果收益分开。 */
export function createDelayedOutcomeTracker({ key, onResult, limit = 64 }) {
 let generation = 0;
 let completed = new WeakSet();
 const pending = new Map();
 const wine = actor => Math.max(0, Number(actor.storage?.jiu) || 0);
 function phaseOf(event) {
  const seen = new Set();
  while (event && !seen.has(event) && seen.size < 128) {
   if (event.name === 'phase') return event;
   seen.add(event);
   event = event.parent || (typeof event.getParent === 'function' ? event.getParent() : null);
  }
  return null;
 }
 function publish(actor, chain, reason, consumer = null, outcome = null, consumerEvidence = null) {
  pending.delete(actor);
  const parts = [...chain.parts, ...(consumer ? [{ tx: consumer, outcome }] : [])];
  const camps = new Map();
  const reliable = !reason && new Set(parts.map(p => p.tx?.id)).size === parts.length && parts.every((p,i) => p.tx?.trainingSessionId === chain.sessionId &&
   p.outcome?.transactionId === p.tx.id && p.outcome.actorId === key(actor) &&
   p.outcome?.status === 'partial' && p.outcome.reason === 'delayed-effect-unattributed' &&
   Number.isFinite(p.outcome.immediateReward) && Array.isArray(p.outcome.deltas) && p.outcome.deltas.every(d => {
    if (d.judging || d.linked || d.turned || d.wine && d.playerId !== key(actor)) return false;
    if (camps.has(d.playerId) && camps.get(d.playerId) !== d.camp) return false;
    camps.set(d.playerId,d.camp); return true;
   }) && (i < chain.parts.length || p.outcome.deltas.find(d => d.playerId === key(actor))?.wine === -chain.amount));
  const result={ schema: 'delayed-action-group-v1', kind: 'wine-to-sha', actorId: key(actor), sessionId: chain.sessionId,
   transactionIds: parts.map(p => p.tx?.id).filter(Boolean),
   preparationIds: chain.parts.map(p => p.tx.id), consumerId: consumer?.id || null,
   wineAmount: chain.amount, status: reliable ? 'observed' : 'unresolved',
   reason: reason || (reliable ? null : 'incomplete-group-observation'),
   groupReward: reliable ? parts.reduce((sum,p) => sum + p.outcome.immediateReward,0) : null,
   attribution: 'host-jiu_add-and-phase', scope: 'preparation-and-consumption-windows',
   creditStatus: 'unallocated', trainingEligible: false,consumerEvidence,
   observations: parts.map(p => ({ transactionId: p.tx?.id || null, status: p.outcome?.status || 'unobserved',
    type:p.outcome?.type,id:p.outcome?.id,target:p.outcome?.target||null,
    immediateReward: p.outcome?.immediateReward ?? null, deltas: p.outcome?.deltas || [] })) };
  result.creditLedger=buildActionCreditLedger(result);
  if(result.creditLedger.eligible)result.creditStatus='cost-only-allocated';
  onResult(result);
 }
 function before(actor, event) {
  const amount = wine(actor), phase = phaseOf(event), chain = pending.get(actor);
  if (chain && (amount !== chain.amount || phase !== chain.phase)) {
   publish(actor,chain,phase !== chain.phase ? 'phase-changed' : 'wine-state-changed');
  }
  return { actor, amount, phase, generation };
 }
 function complete(snapshot, root, tx, outcome) {
  if (!snapshot || snapshot.generation !== generation || !root || completed.has(root)) return false;
  completed.add(root);
  const {actor, amount, phase} = snapshot, after = wine(actor), chain = pending.get(actor);
  if (root.finished !== true || root.name !== 'useCard' || root.player !== actor) {
   if (chain) publish(actor,chain,'event-incomplete');
   return false;
  }
  if (!phase || phaseOf(root) !== phase) {
   if (chain) publish(actor,chain,'event-phase-mismatch');
   return false;
  }
  const card = root.card?.name;
  const committed = tx?.state === 'committed' && tx.trainingSessionId && tx.expected.type === 'card' && tx.expected.id === card;
  if (card === 'jiu' && after > amount) {
   // 不接入此前来源未知的酒；必须是同一真实回合、同一会话、完整观测的自身酒增量。
   const delta = outcome?.deltas?.find(d => d.playerId === key(actor));
   const valid = committed && phase && root.targets?.length === 1 && root.targets[0] === actor &&
    delta?.wine === after - amount && !chain?.parts.some(p => p.tx.id === tx.id) &&
    (amount === 0 || chain?.amount === amount && chain.sessionId === tx.trainingSessionId);
   if (!valid) { if (chain) publish(actor,chain,'untracked-preparation'); return false; }
   const next = chain || { phase, sessionId: tx.trainingSessionId, amount: 0, parts: [] };
   if (next.parts.length >= 16) { publish(actor,next,'preparation-limit'); return false; }
   next.parts.push({tx:{id:tx.id,trainingSessionId:tx.trainingSessionId},outcome}); next.amount = after;
   pending.set(actor,next);
   if (pending.size > limit) { const [oldActor,old] = pending.entries().next().value; publish(oldActor,old,'tracking-limit'); }
   return true;
  }
  if (!chain) return false;
  if (card === 'sha' && amount > 0 && root.jiu === true) {
   const nodes=[],seen=new Set(),queue=[root];
   while(queue.length&&seen.size<512){const e=queue.shift();if(!e||seen.has(e))continue;seen.add(e);nodes.push(e);queue.push(...(e.childEvents||[]));}
   const targets=[...new Set(root.targets||[])];
   const effects=nodes.filter(e=>e.name==='sha'&&e.card===root.card&&e.player===actor&&targets.includes(e.target));
   const noHitConfirmed=!queue.length&&targets.length>0&&effects.length===targets.length&&targets.every(t=>effects.filter(e=>e.target===t).length===1)&&
    effects.every(e=>e.finished===true&&e.result?.bool===false)&&!nodes.some(e=>['damage','loseHp'].includes(e.name));
   const valid = root.jiu_add === amount && amount === chain.amount && after === 0 && phase === chain.phase;
   publish(actor,chain,!valid ? 'wine-consumption-mismatch' : !committed ? 'untracked-consumer' :
    tx.trainingSessionId !== chain.sessionId ? 'session-mismatch' : null, committed ? tx : null,outcome,{noHitConfirmed,targetIds:targets.map(key)});
   return valid && !!committed;
  }
  if (after !== amount) publish(actor,chain,'wine-state-changed');
  return false;
 }
 return { before, complete,
  expire(phase) { for (const [actor,chain] of [...pending]) if (chain.phase === phase) publish(actor,chain,'phase-ended-without-confirmed-consumption'); },
  reset() { generation++; pending.clear(); completed = new WeakSet(); },
 };
}
