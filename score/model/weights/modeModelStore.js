import {readModeModels,writeModeModel} from './modeModelDB.js?v=5e5';
import {safeGet,safeSet,safeRemove} from '../../foundation/storage/storage.js?v=5e5';
import {MODEL_SCHEMA,createIsolatedModelSession} from './weights.js?v=5e5';
const KEY='djsc_classic_doudizhu_model_v1';
const fields={W1:16640,B1:128,W2:8192,B2:64,W3:384,B3:6,W4:64,B4:1,W_proj1:16640,W_proj2:8192};
export function encodeModeSnapshot(s){const out={};for(const [k,v] of Object.entries(s||{}))out[k]=ArrayBuffer.isView(v)?Array.from(v):v;return out;}
export function decodeModeSnapshot(raw){
 if(!raw||raw.META?.version!==MODEL_SCHEMA.version||!Number.isFinite(raw.META.trained)||raw.META.trained<0||!Number.isFinite(raw.META.accuracy)||typeof raw.META.ready!=='boolean'||!Number.isInteger(raw.adamT)||raw.adamT<0)return null;
 if(raw.parameterFormat!==undefined&&raw.parameterFormat!=='float32-v1')return null;
 const floating=raw.parameterFormat==='float32-v1',s={META:{...raw.META},adamT:raw.adamT,...(floating?{parameterFormat:raw.parameterFormat}:{})};
 for(const [k,n] of Object.entries(fields)){
  if(!Array.isArray(raw[k])||raw[k].length!==n||raw[k].some(v=>(!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||(!floating&&!Number.isInteger(v)))||v<(k.startsWith('B')?-32768:-128)||v>(k.startsWith('B')?32767:127)))return null;
  s[k]=floating?new Float32Array(raw[k]):k.startsWith('B')?new Int16Array(raw[k]):new Int8Array(raw[k]);
  for(const prefix of ['m','v']){const values=raw[prefix+k];if(!Array.isArray(values)||values.length!==n||values.some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||(prefix==='v'&&v<0)))return null;s[prefix+k]=new Float32Array(values);}
 }
 return s;
}
let cached=null;
function validRecord(value){return value?.schema==='classic-candidate-v1'&&value.featureDim===MODEL_SCHEMA.featureDim&&value.modelVersion===MODEL_SCHEMA.version&&typeof value.id==='string'&&Array.isArray(value.ruleKeys)&&value.ruleKeys.length>0&&value.ruleKeys.every(k=>typeof k==='string')&&typeof value.networkProfile?.useResidual==='boolean'&&decodeModeSnapshot(value.snapshot);}
export function loadClassicCandidate(){
 if(cached)return cached;
 try{const value=JSON.parse(safeGet(KEY)||'null');if(validRecord(value))cached=value;}catch(_){}
 return cached;
}
export function saveClassicCandidate(record){
 const next={...record,schema:'classic-candidate-v1',featureDim:MODEL_SCHEMA.featureDim,modelVersion:MODEL_SCHEMA.version,snapshot:encodeModeSnapshot(record.snapshot)};
 if(!validRecord(next))return {ok:false,err:'候选模型或规则元数据不完整'};
 try{if(safeSet(KEY,JSON.stringify(next))===false)return {ok:false,err:'候选保存失败；稳定模型未改变'};cached=next;revision++;return {ok:true,id:next.id};}catch(e){return {ok:false,err:String(e)};}
}
export function classicCandidateInfo(){const c=loadClassicCandidate();return c?{id:c.id,createdAt:c.createdAt,state:c.report?.quality?(c.report.quality.ok?'离线通过，可启用试用':'离线未通过，不能启用'):'待离线质量检查',report:c.report,ruleKeys:c.ruleKeys}:null;}
export function createClassicCandidateSession(){const c=loadClassicCandidate();return c?createIsolatedModelSession(decodeModeSnapshot(c.snapshot),c.networkProfile||{}):null;}

const ACTIVE_KEY='djsc_classic_doudizhu_active_v1';
let activeState=null;
function readActiveState(){
 if(activeState)return activeState;
 try{const s=JSON.parse(safeGet(ACTIVE_KEY)||'null');if(s?.schema==='classic-active-v1'&&validRecord(s.current)&&(!s.previous||validRecord(s.previous)))activeState=s;}catch(_){}
 return activeState;
}
export function loadClassicActive(version=null){const s=readActiveState();if(!version||s?.current.id===version)return s?.current||null;return s?.previous?.id===version?s.previous:null;}
export function classicActiveInfo(){const s=readActiveState();return s?{id:s.current.id,previousId:s.previous?.id||null,ruleKeys:s.current.ruleKeys,state:'已启用试用版本',activatedAt:s.activatedAt,validation:s.current.activationValidation||null}:null;}
function writeActiveState(next){try{if(safeSet(ACTIVE_KEY,JSON.stringify(next))===false)return {ok:false,err:'专项版本保存失败；原运行版本保留'};activeState=next;revision++;return {ok:true,id:next.current.id};}catch(e){return {ok:false,err:String(e)};}}
export function promoteClassicCandidate({validation=null}={}){const candidate=loadClassicCandidate();if(!candidate)return {ok:false,err:'暂无候选'};const s=readActiveState();if(s?.current.id===candidate.id)return {ok:true,id:candidate.id};return writeActiveState({schema:'classic-active-v1',current:validation?{...candidate,activationValidation:validation}:candidate,previous:s?.current||null,activatedAt:Date.now()});}
export function rollbackClassicActive(){const s=readActiveState();if(!s?.previous)return {ok:false,err:'没有上一专项版本；可关闭专项模型回退公共引擎'};return writeActiveState({...s,current:s.previous,previous:s.current,activatedAt:Date.now()});}
export function createClassicActiveSession(record=loadClassicActive()){return record?createIsolatedModelSession(decodeModeSnapshot(record.snapshot),record.networkProfile):null;}

// 保持读取为同步缓存；新保存路径使用事务完成后确认的异步存储。
let revision=0,writeQueue=Promise.resolve(),storageStatus={ready:false,backend:'loading',error:null};
const validActive=s=>s?.schema==='classic-active-v1'&&validRecord(s.current)&&(!s.previous||validRecord(s.previous));
async function restoreModeModels(){
 storageStatus={...storageStatus,ready:false,error:null};
 const initial=revision;
 try{
  const restored=await readModeModels();
  if(initial===revision&&!restored.unavailable){
   const candidate=restored.rows.find(r=>r.key==='candidate')?.value,active=restored.rows.find(r=>r.key==='active')?.value;
   if(validRecord(candidate))cached=candidate;
   if(validActive(active))activeState=active;
  }
  storageStatus={ready:true,backend:restored.unavailable?'localStorage':'IndexedDB',error:null,records:restored.rows?.length||0,invalidKeys:(restored.rows||[]).filter(r=>r.key==='candidate'?!validRecord(r.value):r.key==='active'?!validActive(r.value):false).map(r=>r.key)};
 }catch(e){storageStatus={ready:true,backend:'unavailable',error:String(e.message||e)};}
 return {...storageStatus};
}
export const modeModelsReady=restoreModeModels();
export async function retryClassicModelRestore(){await modeModelsReady;return enqueue(restoreModeModels);}
export function classicModelStorageStatus(){return {...storageStatus,origin:typeof location==='undefined'?null:location.origin};}
function enqueue(task){const result=writeQueue.then(task);writeQueue=result.catch(()=>{});return result;}
async function persist(key,legacyKey,value){
 if(storageStatus.backend==='unavailable')return {ok:false,err:'专项模型数据库恢复失败，请刷新后重试；未改写原版本。原因：'+storageStatus.error};
 try{
  const result=await writeModeModel(key,value);
  if(result.unavailable){
   if(!safeSet(legacyKey,JSON.stringify(value)))throw Error('浏览器小容量存储写入失败，可能容量不足或访问被禁用');
   storageStatus={ready:true,backend:'localStorage',error:null};
  }else{storageStatus={ready:true,backend:'IndexedDB',error:null};safeRemove(legacyKey);}
  revision++;return {ok:true};
 }catch(e){storageStatus={...storageStatus,error:String(e.message||e)};return {ok:false,err:'专项模型保存失败：'+storageStatus.error+'；原运行版本与训练样本保留'};}
}
export async function saveClassicCandidateDurable(record){
 await modeModelsReady;
 return enqueue(async()=>{
  const next={...record,schema:'classic-candidate-v1',featureDim:MODEL_SCHEMA.featureDim,modelVersion:MODEL_SCHEMA.version,snapshot:encodeModeSnapshot(record.snapshot)};
  if(!validRecord(next))return {ok:false,err:'候选模型或规则元数据不完整'};
  const result=await persist('candidate',KEY,next);if(!result.ok)return result;
  cached=next;return {ok:true,id:next.id,storage:storageStatus.backend};
 });
}
export async function promoteClassicCandidateDurable({validation=null}={}){
 await modeModelsReady;
 return enqueue(async()=>{
  const candidate=loadClassicCandidate();if(!candidate)return {ok:false,err:'暂无候选'};
  const prior=readActiveState();if(prior?.current.id===candidate.id)return {ok:true,id:candidate.id};
  const next={schema:'classic-active-v1',current:validation?{...candidate,activationValidation:validation}:candidate,previous:prior?.current||null,activatedAt:Date.now()};
  const result=await persist('active',ACTIVE_KEY,next);if(!result.ok)return result;
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
