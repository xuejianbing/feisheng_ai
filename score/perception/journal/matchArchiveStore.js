import { runtimePerformance } from '../../foundation/diag/performanceCore.js?v=5e5';
import { safeGet, safeSet } from '../../foundation/storage/storage.js?v=5e5';
import { game } from '../../foundation/adapt/host.js?v=5e5';
import { DATA_DIR, downloadText } from '../../foundation/storage/storagePaths.js?v=5e5';
import { matchFiles } from './matchArchive.js?v=5e5';
import { putMatchArchive, readMatchArchives, withArchiveTimeout } from './matchArchiveDB.js?v=5e5';
const LEGACY_KEY='djsc_match_archive_v1', INDEX_KEY='djsc_match_archive_index_v2';
let latest=null, status='尚未归档', cache=[], loading=null, queue=Promise.resolve();
export function listMatchArchives(){return cache.slice();}
export function currentMatchArchive(){return latest;}
export function matchArchiveStatus(){return status;}
function remember(match,promote=true){cache=promote?[match,...cache.filter(x=>x.matchId!==match.matchId)].slice(0,5):cache.map(x=>x.matchId===match.matchId?match:x);}
export async function loadMatchArchives(){
 if(loading)return loading;
 loading=(async()=>{
  let rows=[];
  try{rows=await readMatchArchives();}catch(e){status='档案数据库读取失败：'+String(e.message||e);}
  // 旧版大对象只迁移一次读取；保留原数据，不覆盖它。
  if(!rows.length){try{const old=JSON.parse(safeGet(LEGACY_KEY)||'[]');if(Array.isArray(old))rows=old.slice(0,5);}catch(_) {}}
  if(!rows.length){
   try{
    const index=JSON.parse(safeGet(INDEX_KEY)||'[]');
    if(Array.isArray(index)&&game.promises&&game.promises.readFileAsText){
     for(const entry of index){if(!/^match_[a-zA-Z0-9_]+$/.test(entry.matchId))continue;
      try{const raw=await withArchiveTimeout(game.promises.readFileAsText(DATA_DIR+'/matches/'+entry.matchId+'/档案.json'));rows.push(JSON.parse(raw));}catch(_){}
     }
    }
   }catch(_){}
  }
  cache=[...cache,...rows].filter((x,i,all)=>x&&Array.isArray(x.events)&&all.findIndex(y=>y&&y.matchId===x.matchId)===i).slice(0,5);
  return listMatchArchives();
 })();return loading;
}
export function saveMatchArchive(match,translate,{promote=true}={}){
 const existing=cache.find(x=>x.matchId===match.matchId);
 if(existing && (existing.outcomeRevision||0)>(match.outcomeRevision||0)) {
  match={...match,events:existing.events,dropped:existing.dropped,outcomeRevision:existing.outcomeRevision};
 }
 if(promote || latest?.matchId===match.matchId)latest=match;
 remember(match,promote); if(latest===match)status='正在异步保存档案';
 // 同一档案的人工标记和结算保存依次完成，避免旧写入覆盖新评价。
 const queuedAt=typeof performance!=='undefined'?performance.now():Date.now();
 const task=queue.catch(()=>{}).then(async()=>{
  runtimePerformance.record('archive.queueWait',(typeof performance!=='undefined'?performance.now():Date.now())-queuedAt,'async-wall');
  const timing=runtimePerformance.start('archive.save',{detached:true});
  try {
  await loadMatchArchives(); let saved=false, dbError='';
  try{saved=await putMatchArchive(match);}catch(e){dbError=String(e.message||e);}
  const result=await writeMatchFolder(match,translate);
  const index=cache.map(x=>({matchId:x.matchId,startedAt:x.startedAt,verdict:x.summary&&x.summary.verdict}));
  safeSet(INDEX_KEY,JSON.stringify(index)); // 仅写小索引；整局事件、录像不写 localStorage。
  if(latest===match)status=(saved?'已异步保存到本机档案数据库（最近5局）':'数据库未保存'+(dbError?'：'+dbError:''))+
   (result.ok?'；文件已保存：'+result.path:'；文件未保存'+(result.error?'：'+result.error:''))+
   (!saved&&!result.ok?'；本局仍在内存中，请手动导出后再关闭游戏':'');
  return {saved,...result};
  } finally { runtimePerformance.end(timing); }
 });queue=task;return task;
}
export function updateMatchArchiveOutcomes(snapshot,translate){
 const existing=cache.find(x=>x.matchId===snapshot.matchId);
 if(!existing)return Promise.resolve({saved:false,ok:false,error:'原档案未保留，未写入其它对局'});
 const match={...existing,events:snapshot.events,dropped:snapshot.dropped,outcomeRevision:(existing.outcomeRevision||0)+1};
 return saveMatchArchive(match,translate,{promote:false});
}
export async function writeMatchFolder(match,translate){
 const api=game&&game.promises;
 if(!api||typeof api.writeFile!=='function'||typeof api.ensureDirectory!=='function')return {ok:false};
 try{
  if(!/^match_[a-zA-Z0-9_]+$/.test(match.matchId))throw new Error('无效对局编号');
  const path=DATA_DIR+'/matches/'+match.matchId+'/';
  await withArchiveTimeout(api.ensureDirectory([path]));
  const files=matchFiles(match,translate);files['档案.json']=JSON.stringify(match);
  for(const [name,content]of Object.entries(files))await withArchiveTimeout(api.writeFile(content,path,name));
  return {ok:true,path};
 }catch(e){return {ok:false,error:String(e.message||e)};}
}
export async function exportMatchArchive(match,translate){
 const result=await writeMatchFolder(match,translate);if(result.ok)return '已导出：'+result.path;
 const files=matchFiles(match,translate);
 if(!downloadText(match.matchId+'_对局档案.json',JSON.stringify({schemaVersion:1,match,files},null,2)))throw new Error('文件写入和浏览器下载均不可用');
 return '已触发对局档案下载，包内包含 TXT、JSONL 和可用的原始录像；请确认下载完成。';
}

export function updateClassicEffects(matchId,update,translate){
 const existing=cache.find(x=>x.matchId===matchId);
 if(!existing)return Promise.resolve({ok:false,error:'原档案未保留，未写入其它对局'});
 return saveMatchArchive({...existing,classicEffects:{...existing.classicEffects,update}},translate,{promote:false});
}
