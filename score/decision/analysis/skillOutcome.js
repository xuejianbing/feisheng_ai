import { observeNaturalCompletion } from './naturalCompletion.js?v=41a';
/* 按真实技能根绑定；自然loop涵盖After后的队列，不启动/await宿主。 */
export function createSkillOutcomeTracker({ observer, key, bindTargets, onResult }) {
 let records = new WeakMap();
 const prepared = new Set();
 function prepare(actor,root,snapshot,skill) {
  if(!root || records.has(root) || !snapshot || root.player&&root.player!==actor ||
   !(root.name==='trigger'&&root.skill===skill || root.name===skill))return false;
  if(prepared.size>=64)return false;
  const record={actor,root,snapshot,skill,done:false,prepared:true};
  records.set(root,record);prepared.add(root);
  record.natural=observeNaturalCompletion(root,error=>{if(record.transaction)complete(root,true,error);else{records.delete(root);prepared.delete(root);}});
  if(!record.natural){records.delete(root);prepared.delete(root);return false;}
  return true;
 }
 function find(actor,skill,event) {
  const seen=new Set();
  while(event&&!seen.has(event)) {
   const record=records.get(event);
   if(record?.prepared && record.actor===actor && record.skill===skill && !record.transaction)return event;
   seen.add(event);event=event.parent || (typeof event.getParent==='function'?event.getParent():null);
  }
  return null;
 }
 const targetsOf = root => {
  const roots=[root,...(root.childEvents||[]).filter(e=>e.name===(root.skill||root.name)&&e.player===root.player)];
  const values = [...(root.__djscObservedLogTargets||[]),...roots.flatMap(r=>Array.isArray(r.targets)?r.targets:[])];
  const stages = roots.flatMap(r=>r.__djscSkillChoiceTransaction?.stages || []);
  let complete = true;
  const choices = stages.map(stage => {
   const event = stage.event;
   const selection = event ? event.finished === true ? event.result : null : stage.completed ? stage.selection : null;
   if (!selection || typeof selection !== 'object') { complete = false; return { type: stage.choiceType, complete: false }; }
   if (Array.isArray(selection.targets) && selection.bool !== false) values.push(...selection.targets);
   return { type: stage.choiceType, complete: true, bool: selection.bool,
    targets: (selection.targets || []).map(key).filter(Boolean), cardCount: (selection.cards || []).length };
  });
  const ids = [...new Set(values.map(key).filter(Boolean))].sort();
  return { target: ids.length > 1 ? ids : ids[0] || null, complete, choices };
 };
 function begin(actor, root, snapshot, transaction) {
  try {
   const existing=root&&records.get(root);
   if (!root || root.player !== actor || transaction?.state !== 'committed' || existing?.transaction ||
    (existing?.prepared ? existing.skill!==transaction.expected.id : root.name!=='useSkill'||root.skill!==transaction.expected.id))return false;
   const record = existing || { actor, snapshot, skill:root.skill, done: false };
   record.transaction=transaction;
   snapshot=record.snapshot;
   record.finish = observer.observe(snapshot,root,transaction,result => {
    onResult({ ...result, sessionId: transaction.trainingSessionId, choices: record.choices || [],
     scope: record.natural ? 'host-event-and-after-queue' : result.scope,
     status: record.failure || record.choicesComplete === false || result.terminal && !record.done ? 'unresolved' : result.status,
     reward: record.failure || record.choicesComplete === false || result.terminal && !record.done ? null : result.reward,
     reason: record.failure ? 'host-event-error' : record.choicesComplete === false || result.terminal && !record.done ? 'skill-choice-incomplete' : result.reason });
   });
   if (!record.finish) return false;
   records.set(root,record);
   if(!existing)record.natural=observeNaturalCompletion(root,error=>complete(root,true,error));
   return true;
  } catch (_) { return false; }
 }
 function complete(root,natural=false,failure=null) {
  try {
   const record = root && records.get(root);
   if (!record || !record.transaction || record.done || !failure&&root.finished !== true || root.player !== record.actor ||
    record.skill !== record.transaction.expected.id || record.natural&&!natural) return false;
   record.done = true; records.delete(root);prepared.delete(root);
   record.failure=!!failure;
   const actual = targetsOf(root); record.choices = actual.choices; record.choicesComplete = actual.complete;
   if(!natural && (root.after?.length || root.next?.length))record.choicesComplete=false;
   const bound = bindTargets(record.transaction, actual.target);
   if (!bound) record.choicesComplete = false;
   record.transaction.actual.target = actual.target;
   record.finish(); return true;
  } catch (_) { return false; }
 }
 return { prepare, find, begin, complete, reset() { records = new WeakMap(); prepared.clear(); } };
}
