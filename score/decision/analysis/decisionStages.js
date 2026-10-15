import { candidateTargetValue, candidatePolicySnapshot, sameCandidateAction } from '../state/actionCandidate.js?v=41a';
import { utilityPipelineSnapshot } from '../utility/utilityPipeline.js?v=41a';

export function decisionActionSnapshot(candidate) {
 if (!candidate) return null;
 if(candidate.schema==='action-snapshot-v1')return serializable(candidate);
 const utility = utilityPipelineSnapshot(candidate);
 const preference = (candidate.utilityVector?.contributions || utility?.contributions || []).filter(c => ['championPreference','classicModelPreference'].includes(c.source)).reduce((n,c) => n+c.delta,0);
 return {schema:'action-snapshot-v1',type:candidate.type||'card',id:candidate.id||null,target:candidateTargetValue(candidate),recast:!!candidate.recast,
  score:Number.isFinite(candidate.score)?candidate.score:null,coreUtility:Number.isFinite(candidate.score)?Math.round((candidate.score-preference)*10000)/10000:null,
  learnedPreference:preference,policy:candidatePolicySnapshot(candidate)};
}
function serializable(value) { return JSON.parse(JSON.stringify(value, (_,v)=>typeof v==='number'&&!Number.isFinite(v)?null:v)); }
export function createDecisionStages(initial) {
 const stages=[];
 function record(stage,before,after,evidence={}) {
  if(stages.length>=8)return;
  try { stages.push(serializable({stage,before:decisionActionSnapshot(before),after:decisionActionSnapshot(after),changed:!sameCandidateAction(before,after),evidence})); }
  catch(error){stages.push({stage,error:String(error.message||error),changed:null});}
 }
 record('evaluation',null,initial,{domain:'core-utility-and-policy'});
 return {record,snapshot(final,actual=null,transaction=null){return serializable({schema:'decision-stages-v1',stages,final:decisionActionSnapshot(final),executionState:transaction?.state||'suggested',transactionId:transaction?.id||null,actorId:transaction?.trainingActorId||null,sessionId:transaction?.trainingSessionId||null,actual});}};
}
export function planAdoption(plan,final) {
 const first=plan?.best?.action;
 return {status:!first?'no-plan':sameCandidateAction(first,final)?'selected-first-step':'suggestion-only',first:decisionActionSnapshot(first),final:decisionActionSnapshot(final)};
}
