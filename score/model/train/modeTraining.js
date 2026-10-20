import {playerDemonstrationSummary} from './playerDemonstration.js?v=41a';
import {classicRuntimeSummary} from './classicRuntime.js?v=41a';
import {game,lib} from '../../foundation/adapt/host.js?v=41a';
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';
import {dirOf,downloadText} from '../../foundation/storage/storagePaths.js?v=41a';
import {getSamples} from './trainExport.js?v=41a';
import {selectClassicDataset,splitClassicByGame,sampleLabel} from './modeDataset.js?v=41a';
import {createIsolatedModelSession} from '../weights/weights.js?v=41a';
import {saveClassicCandidateDurable,retryClassicModelRestore,modeModelsReady,classicModelStorageStatus,classicCandidateInfo,createClassicCandidateSession,createClassicActiveSession,loadClassicCandidate,loadClassicActive,classicActiveInfo,promoteClassicCandidateDurable,rollbackClassicActiveDurable} from '../weights/modeModelStore.js?v=41a';
import {modeContext,modeSessionActive} from '../../foundation/runtime/modeContext.js?v=41a';
import {cfg} from '../../foundation/config/util.js?v=41a';
import {writeTrainingSnapshot} from './trainingExportFile.js?v=41a';
let busy=false,progress={phase:'未训练'},lastReport=null;
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
export function classicTrainingStatus(){const data=selectClassicDataset(getSamples()),qualified=new Set(data.samples.map(s=>JSON.stringify([s.m.sessionId,s.m.actorId,s.m.transactionId]))),context=modeContext();return {storage:classicModelStorageStatus(),busy,progress:{...progress},candidate:classicCandidateInfo(),active:classicActiveInfo(),lastReport,context,runtime:classicRuntimeSummary(context.sessionId),data:data.stats,demonstrations:playerDemonstrationSummary(getSamples(),qualified)};}
async function evaluate(session,rows){let correct=0,error=0,missing=0;const groups={};
 let visited=0;for(const s of rows){if(++visited%32===0)await pause();const p=session.predict(s.f),key=s.m.modeContext.submode+'/'+s.m.modeContext.role,g=groups[key]||(groups[key]={count:0,correct:0,valueError:0});if(!p||!Number.isFinite(p.value)||p.logits.some(v=>!Number.isFinite(v))){missing++;continue;}
  const predicted=p.logits.indexOf(Math.max(...p.logits)),hit=predicted===sampleLabel(s)?1:0,sq=(p.value-s.value_target)**2;correct+=hit;error+=sq;g.count++;g.correct+=hit;g.valueError+=sq;
 }
 return {count:rows.length,missing,accuracy:rows.length?correct/rows.length:0,valueMSE:rows.length?error/rows.length:0,groups};
}
export async function trainClassicCandidate(){
 if(!classicModelStorageStatus().ready)await modeModelsReady;
 if(busy)return {ok:false,err:'专项训练正在进行'};
 if(modeSessionActive())return {ok:false,err:'请在对局结束后训练；当前对局继续使用稳定能力'};
 const dataset=selectClassicDataset(getSamples()),split=splitClassicByGame(dataset.samples);
 if(dataset.stats.accepted<4500||dataset.stats.sessions<150||split.training.length<3000||split.validation.length<450)return {ok:false,err:'需至少 4500 条有效事务、150 局；训练集≥3000，整局留出验证集≥450（PR5e：门槛×15）',stats:dataset.stats};
 busy=true;const start=Date.now();let trained=0;
 try{
  const networkProfile={useResidual:!!cfg('useResidual',false)};
  const baseline=createIsolatedModelSession(null,networkProfile),candidate=createIsolatedModelSession(null,{...networkProfile,floatTraining:true}),lr=Math.max(.00001,Math.min(.002,Number(cfg('classicLearningRate',.0005))||.0005));
  // 固定整局划分；不先在验证样本上做额外 mini-batch。
  for(let epoch=0;epoch<5;epoch++){const ordered=shuffleTrainingRows(split.training,epoch+1);for(let i=0;i<ordered.length;i+=32){
   const batch=ordered.slice(i,i+32).map(s=>({f:s.f,label:sampleLabel(s),value_target:s.value_target}));
   trained+=candidate.trainBatch(batch,lr*(1-.15*epoch));progress={phase:'训练候选',epoch:epoch+1,epochs:5,trained};await pause();
  }}
  progress={phase:'整局留出验证',trained};await pause();
  const baselineResult=await evaluate(baseline,split.validation),candidateResult=await evaluate(candidate,split.validation);
  if(candidateResult.missing||baselineResult.missing)throw Error('验证推理失败，未保存候选');
  const report={dataset:dataset.stats,training:split.training.length,validation:split.validation.length,holdoutSessions:split.holdoutSessions,
   baseline:baselineResult,candidate:candidateResult,quality:compareClassicMetrics(candidateResult,baselineResult),trainingMethod:{schema:'classic-float-batch-v1',parameterFormat:'float32-v1',batchSize:32,epochs:5,learningRate:lr,optimizerSteps:candidate.snapshot().adamT,holdoutUsedForTraining:false},trained,ms:Date.now()-start,datasetSignature:datasetSignature(dataset.samples),realGameAcceptance:false,note:'离线标签与价值误差，不是胜率；尚未启用专项模型'};
  const result=await saveClassicCandidateDurable({id:'DDZ-'+Date.now(),createdAt:Date.now(),snapshot:candidate.snapshot(),networkProfile,ruleKeys:[...new Set(dataset.samples.map(s=>s.m.modeContext.ruleKey))],report});
  if(!result.ok)throw Error(result.err);lastReport=report;progress={phase:report.quality.ok?'候选离线通过，可启用试用':'候选已保存，离线未通过',trained};return {...result,report,note:report.quality.ok?'保存成功，离线分组检查通过；启用后下一局参与选择，仍需实战核对。':'保存成功，但离线指标退步或分组样本不足；不能启用，继续使用原运行版本。'};
 }catch(e){progress={phase:'失败',reason:String(e.message||e)};return {ok:false,err:String(e.message||e)};}finally{busy=false;}
}
export async function validateClassicCandidate(){
 if(!classicModelStorageStatus().ready)await modeModelsReady;
 if(busy)return {ok:false,err:'请等待训练结束'};
 const storage=classicModelStorageStatus();if(storage.backend==='unavailable')return {ok:false,err:'模型恢复失败：'+storage.error};
  const info=classicCandidateInfo();if(!info)return {ok:false,err:'暂无专项候选'};
 const dataset=selectClassicDataset(getSamples()),holdout=new Set(info.report?.holdoutSessions||[]),rows=dataset.samples.filter(s=>holdout.has(s.m.sessionId)&&info.ruleKeys.includes(s.m.modeContext.ruleKey));
 if(!rows.length)return {ok:false,err:'原留出验证局的数据不在本地，请重新采集或导入原专项数据'};
 busy=true;try{const result=await evaluate(createClassicCandidateSession(),rows),baseline=await evaluate(createIsolatedModelSession(null,loadClassicCandidate().networkProfile),rows),quality=compareClassicMetrics(result,baseline),signature=datasetSignature(dataset.samples);if(signature!==info.report?.datasetSignature){quality.ok=false;quality.regressions.push('训练后有效样本或标签发生变化，需重新训练');}if(rows.length<30){quality.ok=false;quality.regressions.push('整局留出样本不足 30 条');}return {ok:!result.missing&&!baseline.missing,result,baseline,quality,datasetSignature:signature,note:quality.ok?'留出局质量检查通过；可尝试启用，启用时还会检查当前试用版。离线通过不代表胜率改善。':'留出局质量检查未通过；候选不能启用，保留原运行版本。'};}finally{busy=false;}
}
export async function exportClassicData(){const dataset=selectClassicDataset(getSamples());const payload={schema:'classic-doudizhu-export-v1',createdAt:Date.now(),stats:dataset.stats,samples:dataset.samples,candidate:classicCandidateInfo(),active:classicActiveInfo()};return writeTrainingSnapshot(game,downloadText,dirOf('modes/doudizhu-classic/datasets'),'常规斗地主_'+Date.now()+'.json',JSON.stringify(payload,null,2));}
let shadowSession=null,shadowId=null;
export function classicCandidateShadow(best,acts,context){
 const base={domain:'classic-candidate-shadow',executionState:'suggested',changesSelection:false};
 try{
  if(!context.enabled||context.group!=='doudizhu-classic')return {...base,status:'not-enabled'};
  if(cfg('classicCandidateShadow',false)!==true)return {...base,status:'disabled'};
  const storage=classicModelStorageStatus();if(!storage.ready)return {...base,status:'storage-loading'};if(storage.backend==='unavailable')return {...base,status:'storage-error',reason:storage.error};
  const info=classicCandidateInfo();if(!info)return {...base,status:'no-candidate'};
  if(!info.ruleKeys.includes(context.ruleKey))return {...base,status:'rule-not-covered',candidateId:info.id};
  if(shadowId!==info.id){shadowSession=createClassicCandidateSession();shadowId=info.id;}
  const rows=[];
  const addCandidate=a=>{
   if(!a||a._feat?.length!==130)return false;
   const features=a._feat;
   for(let i=0;i<features.length;i++)if(!Number.isFinite(features[i]))return false;
   rows.push(a);return rows.length>=3;
  };
  addCandidate(best);
  for(const a of acts||[]){if(rows.length>=3)break;if(a!==best)addCandidate(a);}
  const predictions=rows.map(a=>{const p=shadowSession.predict(a._feat);return {type:a.type,id:a.id,target:typeof a.target==='string'?a.target:playerKey(a.target)||null,value:p?.value??null,label:p?p.logits.indexOf(Math.max(...p.logits)):null};});
  return {...base,status:'shadow',candidateId:info.id,actualSuggestion:{type:best?.type,id:best?.id},classicPreference:best?.classicPreference||null,predictions,note:'预测记录不改变评分，不是实际收益或训练标签'};
 }catch(e){return {...base,status:'error',reason:String(e.message||e)};}
}

function shuffleTrainingRows(rows,seed){const out=rows.slice();let state=seed;for(let i=out.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
function datasetSignature(rows){let h=2166136261;const text=JSON.stringify(rows.map(s=>[s.m.sessionId,s.m.actorId,s.m.transactionId,s.m.modeContext?.ruleKey,s.m.modeContext?.submode,s.m.modeContext?.role,s.r,s.value_target,s.f]));for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
export function compareClassicMetrics(candidate,baseline){
 const regressions=[];
 if(!candidate||!baseline||candidate.missing||baseline.missing||!(baseline.count>0)||candidate.count!==baseline.count||!Object.keys(baseline.groups||{}).length)return {ok:false,regressions:['缺少完整验证预测']};
 const check=(c,b,label)=>{if(!Number.isFinite(c?.accuracy)||!Number.isFinite(c?.valueMSE)||!Number.isFinite(b?.accuracy)||!Number.isFinite(b?.valueMSE)){regressions.push(label+'指标无效');return;}if(c.accuracy+1e-9<b.accuracy)regressions.push(label+'标签准确率下降（'+(b.accuracy*100).toFixed(2)+'% → '+(c.accuracy*100).toFixed(2)+'%）');if(c.valueMSE>b.valueMSE+1e-9)regressions.push(label+'价值误差升高（'+b.valueMSE.toFixed(6)+' → '+c.valueMSE.toFixed(6)+'）');};
 check(candidate,baseline,'整体');
 for(const [key,b] of Object.entries(baseline.groups||{})){
  const c=candidate.groups?.[key],[submode,role]=key.split('/'),label=({normal:'休闲',kaihei:'开黑',huanle:'欢乐'}[submode]||submode)+'／'+({landlord:'地主',farmer:'农民'}[role]||role);if(!c||c.count!==b.count||b.count<150){  /* PR5e ×15 */regressions.push(label+'验证样本不足或不一致');continue;}
  check({accuracy:c.correct/c.count,valueMSE:c.valueError/c.count},{accuracy:b.correct/b.count,valueMSE:b.valueError/b.count},label);
 }
 return {ok:!regressions.length,regressions};
}
export async function activateClassicCandidate({enable=true}={}){
 if(!classicModelStorageStatus().ready)await modeModelsReady;
 if(busy||modeSessionActive())return {ok:false,err:'请在对局结束且训练完成后启用，下一局生效'};
 const info=classicCandidateInfo(),report=info?.report,current=loadClassicActive();if(!report||report.validation<450)return {ok:false,err:'候选缺少完整离线验证报告（验证≥450），请先训练'};
 const check=await validateClassicCandidate();if(!check.ok)return check;
 if(modeSessionActive()||busy)return {ok:false,err:'验证期间已开始新对局或训练，未切换版本'};
 if(check.datasetSignature!==report.datasetSignature)return {ok:false,err:'有效样本或标签在训练后发生变化，请重新训练'};
 const publicCheck=compareClassicMetrics(check.result,report.baseline);if(!publicCheck.ok)return {ok:false,err:'留出局指标劣于公共基线或分组证据不足，保留原版本',comparison:publicCheck};
 busy=true;
 try{
  const activationData=selectClassicDataset(getSamples()),activationHoldout=new Set(report.holdoutSessions),activationRows=activationData.samples.filter(s=>activationHoldout.has(s.m.sessionId)&&info.ruleKeys.includes(s.m.modeContext.ruleKey));
  const livePublicBaseline=await evaluate(createIsolatedModelSession(null,loadClassicCandidate().networkProfile),activationRows),livePublicCheck=compareClassicMetrics(check.result,livePublicBaseline);
  if(!livePublicCheck.ok)return {ok:false,err:'指标劣于当前公共基线，保留原版本',comparison:livePublicCheck};
  let previousComparison={status:'no-active-version'};
  if(current&&current.id!==info.id){
   const dataset=selectClassicDataset(getSamples()),holdout=new Set(report.holdoutSessions),rows=dataset.samples.filter(s=>holdout.has(s.m.sessionId)&&current.ruleKeys.includes(s.m.modeContext.ruleKey));
   if(rows.length){
    if(rows.length<30)return {ok:false,err:'与当前试用版共同适用的留出样本不足 30 条，保留原版本'};
    const candidateResult=await evaluate(createClassicCandidateSession(),rows),previousResult=await evaluate(createClassicActiveSession(current),rows),comparison=compareClassicMetrics(candidateResult,previousResult);
    previousComparison={status:comparison.ok?'passed':'regressed',modelId:current.id,candidate:candidateResult,previous:previousResult,...comparison};
    if(!comparison.ok)return {ok:false,err:'指标劣于当前试用版或角色分组证据不足，保留原版本',previousComparison};
   }else previousComparison={status:'no-shared-rule',modelId:current.id,note:'规则无交集，不能宣称优于旧版本'};
  }
  if(modeSessionActive()||classicCandidateInfo()?.id!==info.id||loadClassicActive()?.id!==current?.id||datasetSignature(selectClassicDataset(getSamples()).samples)!==report.datasetSignature)return {ok:false,err:'验证期间对局、版本或样本发生变化，未切换版本'};
  const result=await promoteClassicCandidateDurable({validation:{schema:'classic-activation-validation-v1',validatedAt:Date.now(),datasetSignature:report.datasetSignature,publicComparison:livePublicCheck,trainingBaselineComparison:publicCheck,candidate:check.result,publicBaseline:livePublicBaseline,previousComparison,realGameAcceptance:false}});if(result.ok&&enable){lib.config['extension_无名AI_classicModelEnabled']=true;game.saveExtensionConfig?.('无名AI','classicModelEnabled',true);}
  const comparisonNote=previousComparison.status==='no-shared-rule'?'公共基线分组检查通过；与旧版没有共同规则，未比较优劣。':previousComparison.status==='no-active-version'?'公共基线分组检查通过；首次启用，无旧试用版可比较。':'公共基线与当前试用版分组检查通过。';
  return {...result,previousComparison,note:result.ok?'专项版本已保存；'+comparisonNote+'下一局生效。离线通过不代表实战提升。':'保存失败，原版本保留。'};
 }finally{busy=false;}
}
export async function rollbackClassicModel(){await modeModelsReady;if(busy||modeSessionActive())return {ok:false,err:'请在对局结束后回滚，下一局生效'};busy=true;try{return await rollbackClassicActiveDurable();}finally{busy=false;}}
export async function runClassicPostGameUpdate(expectedSessionId){
 const context=modeContext();if(expectedSessionId&&context.sessionId!==expectedSessionId)return {ok:false,skipped:true,reason:'已经进入另一局，本次不自动更新'};if(modeSessionActive()||busy||!context.autoUpdate||context.group!=='doudizhu-classic'||!context.collect)return {ok:false,skipped:true,reason:'当前对局、采集或自动更新条件不满足'};
 const data=selectClassicDataset(getSamples()),prior=classicCandidateInfo();if(prior?.report?.datasetSignature===datasetSignature(data.samples))return {ok:true,skipped:true,reason:'合格样本未变化，保留当前版本'};
 const trained=await trainClassicCandidate();if(!trained.ok)return trained;
 // 新对局若已经开始，保留候选，禁止局中换版本。
 return activateClassicCandidate({enable:false});
}

export async function restoreClassicModels(){if(busy||modeSessionActive())return {ok:false,err:"请在对局结束后恢复模型，下一局生效"};busy=true;try{const storage=await retryClassicModelRestore();return {ok:!storage.error,storage,...(storage.error?{err:storage.error}:{note:"模型恢复完成；保留现有开关，下一局使用已启用版本。"})};}finally{busy=false;}}
