import {loadClassicActive,createClassicActiveSession} from '../weights/modeModelStore.js?v=5e5';
import {isCandidateEligible,sameCandidatePolicyBand,compareActionCandidates,candidateTargetValue} from '../../decision/state/actionCandidate.js?v=5e5';
import {applyOwnedUtility} from '../../decision/utility/utilityPipeline.js?v=5e5';
let cachedId=null,session=null;
let runtime=null;
export function classicRuntimeSummary(sessionId){return runtime?.sessionId===sessionId?{...runtime}:{attempts:0,participated:0,changed:0,lastStatus:'not-run',modelId:null};}
export function applyClassicPredictions(acts,predict,modelId){
 const eligible=acts.filter(isCandidateEligible).sort(compareActionCandidates),reference=eligible[0];
 if(!reference)return {status:'no-candidates',modelId};
 const rows=eligible.filter(a=>a.type!=='end'&&sameCandidatePolicyBand(a,reference)&&a._feat?.length===130&&Array.from(a._feat).every(Number.isFinite)).slice(0,12);
 if(!rows.includes(reference)||rows.length<2)return {status:'insufficient-candidates',modelId};
 // 所有推理先通过校验再计分，异常不得留下部分改分。
 const predictions=rows.map(a=>({a,value:predict(a._feat)?.value}));
 if(predictions.some(p=>!Number.isFinite(p.value)||Math.abs(p.value)>1))throw Error('专项价值预测无效');
 const base=predictions[0].value;
 const evidence=predictions.map(({a,value})=>({type:a.type,id:a.id,target:candidateTargetValue(a),recast:!!a.recast,value,delta:Math.max(-.5,Math.min(.5,(value-base)*.5))}));
 predictions.forEach(({a},i)=>{const p=evidence[i];applyOwnedUtility(a,'classicModelPreference',[{dimension:'future',delta:p.delta,note:'专项实际收益模型：相对公共首选，影响封顶±0.5',details:{modelId,value:p.value,referenceValue:base,cap:.5}}]);a.classicModel={modelId,value:p.value,delta:p.delta};});
 return {status:'active',modelId,predictions:evidence,cap:.5,participatesInSelection:true,changesSelection:acts.filter(isCandidateEligible).sort(compareActionCandidates)[0]!==reference,note:'收益预测参与实际比较，不是确认收益或训练标签'};
}
export function applyClassicModel(acts,context,prepareFeatures){
 const result=applyModel(acts,context,prepareFeatures);
 if(context.sessionId){
  if(runtime?.sessionId!==context.sessionId)runtime={sessionId:context.sessionId,attempts:0,participated:0,changed:0};
  runtime.attempts++;if(result.participatesInSelection)runtime.participated++;if(result.changesSelection)runtime.changed++;
  runtime.lastStatus=result.status;runtime.modelId=result.modelId||context.specialistVersion||null;runtime.reason=result.reason||null;
 }
 return result;
}
function applyModel(acts,context,prepareFeatures){
 try{
  if(!['landlord','farmer'].includes(context.role))return {status:'unknown-role'};
  if(!context.enabled||!context.specialistEnabled||context.group!=='doudizhu-classic')return {status:'disabled'};
  if(context.modelStorage?.ready===false)return {status:'storage-loading'};
  if(context.modelStorage?.backend==='unavailable')return {status:'storage-error',reason:context.modelStorage.error};
  const model=loadClassicActive(context.specialistVersion);if(!model)return {status:'no-active-model'};
  if(context.specialistVersion!==model.id)return {status:'version-not-pinned',modelId:model.id};
  if(!model.ruleKeys.includes(context.ruleKey))return {status:'rule-not-covered',modelId:model.id};
  if(typeof prepareFeatures==='function'){
   const eligible=acts.filter(isCandidateEligible).sort(compareActionCandidates),reference=eligible[0],start=performance.now();
   for(const a of eligible.filter(a=>a.type!=='end'&&sameCandidatePolicyBand(a,reference)).slice(0,12)){
    if(performance.now()-start>8)break;
    if(!a._feat)a._feat=Array.from(prepareFeatures(a));
   }
  }
  if(cachedId!==model.id){session=createClassicActiveSession(model);cachedId=model.id;}
  return applyClassicPredictions(acts,f=>session.predict(f),model.id);
 }catch(e){return {status:'fallback',reason:String(e.message||e),note:'保留公共引擎评分'};}
}
