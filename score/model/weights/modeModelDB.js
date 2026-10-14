/* 大模型与活动/回滚版本独立入库；确认事务完成才报告保存成功。 */
const DB='djsc_mode_models_v1',STORE='models',TIMEOUT=8000;
let connection=null,opening=null;
async function openDB(){
 if(typeof indexedDB==='undefined')return null;
 if(connection)return connection;
 if(opening)return opening;
 opening=new Promise((resolve,reject)=>{
  let abandoned=false,request;
  const timer=setTimeout(()=>{abandoned=true;reject(Error('专项模型数据库打开超时'));},TIMEOUT);
  const fail=e=>{abandoned=true;clearTimeout(timer);reject(e||Error('专项模型数据库不可用'));};
  try{request=indexedDB.open(DB,1);}catch(e){fail(e);return;}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'});};
  request.onerror=()=>fail(request.error);request.onblocked=()=>fail(Error('专项模型数据库被旧窗口占用'));
  request.onsuccess=()=>{const db=request.result;if(abandoned){db.close();return;}clearTimeout(timer);connection=db;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
 });
 try{return await opening;}finally{opening=null;}
}
async function transaction(mode,operation){
 const db=await openDB();if(!db)return {unavailable:true};
 return new Promise((resolve,reject)=>{
  let tx,value,finished=false;
  const fail=e=>{if(finished)return;finished=true;clearTimeout(timer);try{tx?.abort();}catch(_){}connection=null;try{db.close();}catch(_){}reject(e||Error('专项模型数据库事务失败'));};
  const timer=setTimeout(()=>fail(Error('专项模型数据库事务超时')),TIMEOUT);
  try{
   tx=db.transaction(STORE,mode);
   const request=operation(tx.objectStore(STORE));
   request.onsuccess=()=>{value=request.result;};
   tx.oncomplete=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve({ok:true,value});};
   tx.onerror=tx.onabort=()=>fail(tx.error||request.error);
  }catch(e){fail(e);}
 });
}
export async function readModeModels(){const result=await transaction('readonly',store=>store.getAll());return result.unavailable?result:{...result,rows:result.value||[]};}
export async function writeModeModel(key,value){return transaction('readwrite',store=>store.put({key,value}));}
