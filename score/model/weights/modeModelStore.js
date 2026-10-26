import {readModeModels,writeModeModel} from './modeModelDB.js?v=41a';
import {safeGet,safeSet,safeRemove} from '../../foundation/storage/storage.js?v=41a';
import {MODEL_SCHEMA,createIsolatedModelSession} from './weights.js?v=41a';
import {_stableStringify as canonical} from '../train/cloudSampleState.js?v=41a';
const KEY='djsc_classic_doudizhu_model_v1';
const [input,hidden1,hidden2,outputs]=MODEL_SCHEMA.dims;
const fields={W1:input*hidden1,B1:hidden1,W2:hidden1*hidden2,B2:hidden2,W3:hidden2*outputs,B3:outputs,W4:hidden2,B4:1,W_proj1:input*hidden1,W_proj2:hidden1*hidden2};
export function encodeModeSnapshot(s){const out={};for(const [k,v] of Object.entries(s||{}))out[k]=ArrayBuffer.isView(v)?Array.from(v):v;return out;}
function snapshotError(raw){
 if(raw?.META?.version!==MODEL_SCHEMA.version)return 'snapshot.META.version：期望 '+MODEL_SCHEMA.version+'，实际 '+String(raw?.META?.version);
 if(!Number.isFinite(raw.META.trained)||raw.META.trained<0||!Number.isFinite(raw.META.accuracy)||typeof raw.META.ready!=='boolean'||!Number.isInteger(raw.adamT)||raw.adamT<0)return 'snapshot.META/adamT：训练元数据无效';
 if(raw.parameterFormat!==undefined&&raw.parameterFormat!=='float32-v1')return 'snapshot.parameterFormat：不支持 '+String(raw.parameterFormat);
 const floating=raw.parameterFormat==='float32-v1';
 for(const [k,n] of Object.entries(fields)){
  for(const prefix of ['','m','v']){
   const key=prefix+k,values=raw[key];
   if(!Array.isArray(values)||values.length!==n)return key+'：期望长度 '+n+'，实际长度 '+String(values?.length??'缺失')+'（需参数数组）';
   if(values.some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||(prefix==='v'&&v<0)||(!prefix&&((!floating&&!Number.isInteger(v))||v<(k.startsWith('B')?-32768:-128)||v>(k.startsWith('B')?32767:127)))))return key+'：参数包含非有限值、越界值或不兼容数值类型';
  }
 }
 return null;
}
export function decodeModeSnapshot(raw){
 if(snapshotError(raw))return null;
 const floating=raw.parameterFormat==='float32-v1',s={META:{...raw.META},adamT:raw.adamT,...(floating?{parameterFormat:raw.parameterFormat}:{})};
 for(const k of Object.keys(fields)){
  s[k]=floating?new Float32Array(raw[k]):k.startsWith('B')?new Int16Array(raw[k]):new Int8Array(raw[k]);
  for(const prefix of ['m','v'])s[prefix+k]=new Float32Array(raw[prefix+k]);
 }
 return s;
}
let cached=null;
function recordError(value){
 if(value?.schema!=='classic-candidate-v1')return 'record.schema：期望 classic-candidate-v1';
 if(value.featureDim!==MODEL_SCHEMA.featureDim)return 'record.featureDim：期望 '+MODEL_SCHEMA.featureDim+'，实际 '+String(value.featureDim);
 if(value.modelVersion!==MODEL_SCHEMA.version)return 'record.modelVersion：期望 '+MODEL_SCHEMA.version+'，实际 '+String(value.modelVersion);
 if(typeof value.id!=='string'||!Array.isArray(value.ruleKeys)||!value.ruleKeys.length||!value.ruleKeys.every(k=>typeof k==='string')||typeof value.networkProfile?.useResidual!=='boolean')return '候选模型或规则元数据不完整';
 return snapshotError(value.snapshot);
}
function validRecord(value){return !recordError(value);}
export function loadClassicCandidate(){
 if(cached)return cached;
 try{const value=JSON.parse(safeGet(KEY)||'null');if(validRecord(value))cached=value;}catch(_){}
 return cached;
}
export function saveClassicCandidate(record){
 const next={...record,schema:'classic-candidate-v1',featureDim:MODEL_SCHEMA.featureDim,modelVersion:MODEL_SCHEMA.version,snapshot:encodeModeSnapshot(record.snapshot)};
 const error=recordError(next);if(error)return {ok:false,err:error};
 try{if(safeSet(KEY,JSON.stringify(next))===false)return {ok:false,err:'候选保存失败；稳定模型未改变'};cached=next;revision++;return {ok:true,id:next.id};}catch(e){return {ok:false,err:String(e)};}
}
export function classicCandidateInfo(){const c=loadClassicCandidate();return c?{id:c.id,createdAt:c.createdAt,state:c.report?.quality?(c.report.quality.ok?'离线通过，可启用试用':'离线未通过，不能启用'):'待离线质量检查',report:c.report,ruleKeys:c.ruleKeys}:null;}
export function createClassicCandidateSession(){const c=loadClassicCandidate();return c&&!recordError(c)?createIsolatedModelSession(decodeModeSnapshot(c.snapshot),c.networkProfile||{}):null;}
// One inference-only copy per validation, not repeated JSON of optimizer moments.
// Reference ownership detects every save/restore, including equal-ID replacements;
// exact array comparison also detects mutations through the legacy mutable reader.
export function captureClassicCandidateBinding(){
 const candidate=loadClassicCandidate();
 const changed=()=>({ok:false,code:'E_CANDIDATE_CHANGED',err:'通过评估的候选模型已被替换或修改，未切换版本'});
 if(!candidate||recordError(candidate))return changed;
 const metadata=c=>canonical({id:c.id,schema:c.schema,featureDim:c.featureDim,modelVersion:c.modelVersion,profile:c.networkProfile,rules:c.ruleKeys,format:c.snapshot?.parameterFormat,meta:c.snapshot?.META});
 const before=metadata(candidate),parameters=Object.fromEntries(Object.keys(fields).map(k=>[k,new Float64Array(candidate.snapshot[k])]));
 return ()=>{
  const current=loadClassicCandidate();if(current!==candidate||metadata(current)!==before)return changed();
  for(const k of Object.keys(fields)){const a=current.snapshot?.[k],b=parameters[k];if(!a||a.length!==b.length)return changed();for(let i=0;i<b.length;i++)if(a[i]!==b[i])return changed();}
  return {ok:true};
 };
}

const ACTIVE_KEY='djsc_classic_doudizhu_active_v1';
let activeState=null;
function readActiveState(){
 if(activeState)return activeState;
 try{const s=JSON.parse(safeGet(ACTIVE_KEY)||'null');if(s?.schema==='classic-active-v1'&&validRecord(s.current)&&(!s.previous||validRecord(s.previous)))activeState=s;}catch(_){}
 return activeState;
}
export function loadClassicActive(version=null){const s=readActiveState();if(!version||s?.current.id===version)return s?.current||null;return s?.previous?.id===version?s.previous:null;}
export function classicActiveInfo(){const s=readActiveState();return s?{id:s.current.id,previousId:s.previous?.id||null,ruleKeys:s.current.ruleKeys,state:'已启用试用版本',activatedAt:s.activatedAt,validation:s.current.activationValidation||null}:null;}
function writeActiveState(next){const error=activeError(next);if(error)return {ok:false,err:error};try{if(safeSet(ACTIVE_KEY,JSON.stringify(next))===false)return {ok:false,err:'专项版本保存失败；原运行版本保留'};activeState=next;revision++;return {ok:true,id:next.current.id};}catch(e){return {ok:false,err:String(e)};}}
export function promoteClassicCandidate({validation=null}={}){const candidate=loadClassicCandidate();if(!candidate)return {ok:false,err:'暂无候选'};const s=readActiveState();if(s?.current.id===candidate.id)return {ok:true,id:candidate.id};return writeActiveState({schema:'classic-active-v1',current:validation?{...candidate,activationValidation:validation}:candidate,previous:s?.current||null,activatedAt:Date.now()});}
export function rollbackClassicActive(){const s=readActiveState();if(!s?.previous)return {ok:false,err:'没有上一专项版本；可关闭专项模型回退公共引擎'};return writeActiveState({...s,current:s.previous,previous:s.current,activatedAt:Date.now()});}
export function createClassicActiveSession(record=loadClassicActive()){return record&&!recordError(record)?createIsolatedModelSession(decodeModeSnapshot(record.snapshot),record.networkProfile):null;}

// 保持读取为同步缓存；新保存路径使用事务完成后确认的异步存储。
let revision=0,writeQueue=Promise.resolve(),storageStatus={ready:false,backend:'loading',error:null};
const validActive=s=>s?.schema==='classic-active-v1'&&validRecord(s.current)&&(!s.previous||validRecord(s.previous));
function activeError(s){return s?.schema!=='classic-active-v1'?'active.schema：期望 classic-active-v1':recordError(s.current)||(s.previous?recordError(s.previous):null);}
async function restoreModeModels(){
 storageStatus={...storageStatus,ready:false,error:null};
 const initial=revision;
 try{
  const restored=await readModeModels();
  const rows=restored.rows||[];
  if(restored.unavailable){
   for(const [key,legacyKey] of [['candidate',KEY],['active',ACTIVE_KEY]]){
    const raw=safeGet(legacyKey);if(raw===null||raw===undefined)continue;
    try{rows.push({key,value:JSON.parse(raw)});}catch(e){rows.push({key,parseError:'存档JSON解析失败：'+String(e.message||e)});}
   }
  }
  if(initial===revision){
   const candidate=rows.find(r=>r.key==='candidate')?.value,active=rows.find(r=>r.key==='active')?.value;
   if(validRecord(candidate))cached=candidate;
   if(validActive(active))activeState=active;
  }
  const invalidRecords=rows.filter(r=>['candidate','active'].includes(r.key)).map(r=>({key:r.key,error:r.parseError||(r.key==='candidate'?recordError(r.value):activeError(r.value))})).filter(r=>r.error);
  storageStatus={ready:true,backend:restored.unavailable?'localStorage':'IndexedDB',error:invalidRecords.length?invalidRecords.map(r=>r.key+'：'+r.error).join('；'):null,records:rows.length,invalidKeys:invalidRecords.map(r=>r.key),invalidRecords};
 }catch(e){storageStatus={ready:true,backend:'unavailable',error:String(e.message||e)};}
 return {...storageStatus};
}
export const modeModelsReady=restoreModeModels();
export async function retryClassicModelRestore(){await modeModelsReady;return enqueue(restoreModeModels);}
export function classicModelStorageStatus(){return {...storageStatus,origin:typeof location==='undefined'?null:location.origin};}
function enqueue(task){const result=writeQueue.then(task);writeQueue=result.catch(()=>{});return result;}
async function persist(key,legacyKey,value,beforeWrite=null){
 const error=key==='active'?activeError(value):recordError(value);if(error)return {ok:false,err:error};
 if(storageStatus.backend==='unavailable')return {ok:false,err:'专项模型数据库恢复失败，请刷新后重试；未改写原版本。原因：'+storageStatus.error};
 try{
  const verify=()=>{if(beforeWrite){const check=beforeWrite();if(!check?.ok)throw Object.assign(Error(check?.err||'候选快照已变化'),{code:check?.code});}};
  const result=await writeModeModel(key,value,verify);
  if(result.unavailable){
   verify();
   if(!safeSet(legacyKey,JSON.stringify(value)))throw Error('浏览器小容量存储写入失败，可能容量不足或访问被禁用');
   storageStatus={ready:true,backend:'localStorage',error:null};
  }else{storageStatus={ready:true,backend:'IndexedDB',error:null};safeRemove(legacyKey);}
  revision++;return {ok:true};
 }catch(e){storageStatus={...storageStatus,error:String(e.message||e)};return {ok:false,code:e.code,err:'专项模型保存失败：'+storageStatus.error+'；原运行版本与训练样本保留'};}
}
export async function saveClassicCandidateDurable(record){
 await modeModelsReady;
 return enqueue(async()=>{
  const next={...record,schema:'classic-candidate-v1',featureDim:MODEL_SCHEMA.featureDim,modelVersion:MODEL_SCHEMA.version,snapshot:encodeModeSnapshot(record.snapshot)};
  const error=recordError(next);if(error)return {ok:false,err:error};
  const result=await persist('candidate',KEY,next);if(!result.ok)return result;
  cached=next;return {ok:true,id:next.id,storage:storageStatus.backend};
 });
}
export async function promoteClassicCandidateDurable({validation=null,beforePromote=null}={}){
 await modeModelsReady;
 return enqueue(async()=>{
  const candidate=loadClassicCandidate();if(!candidate)return {ok:false,err:'暂无候选'};
  // Recheck after queued writes/restore waits, immediately before starting persistence.
  if(beforePromote){const check=beforePromote();if(!check?.ok)return check||{ok:false,err:'候选提升前检查失败'};}
  const prior=readActiveState();if(prior?.current.id===candidate.id)return {ok:true,id:candidate.id};
  const next={schema:'classic-active-v1',current:validation?{...candidate,activationValidation:validation}:candidate,previous:prior?.current||null,activatedAt:Date.now()};
  const result=await persist('active',ACTIVE_KEY,next,beforePromote);if(!result.ok)return result;
  activeState=next;return {ok:true,id:next.current.id,storage:storageStatus.backend};
 });
}
export async function rollbackClassicActiveDurable(){
 await modeModelsReady;
 return enqueue(async()=>{
  const prior=readActiveState();if(!prior?.previous)return {ok:false,err:'没有上一专项版本；可关闭专项模型回退公共引擎'};
  const next={...prior,current:prior.previous,previous:prior.current,activatedAt:Date.now()};
  const result=await persist('active',ACTIVE_KEY,next);if(!result.ok)return result;
  activeState=next;return {ok:true,id:next.current.id,storage:storageStatus.backend};
 });
}
