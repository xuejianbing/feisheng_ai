/* 整局数据异步写入独立 IndexedDB；事务完成后才报告成功。 */
const DB = 'djsc_match_archives_v1', STORE = 'matches';
let connection = null;
export function withArchiveTimeout(promise, ms = 8000) {
 return new Promise((resolve,reject) => {
  const timer=setTimeout(()=>reject(new Error('档案操作超时')),ms);
  Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}
async function openDB() {
 if (connection) return connection;
 if (typeof indexedDB === 'undefined') return null;
 let abandoned=false;
 connection = await withArchiveTimeout(new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'matchId'});
  request.onerror=()=>reject(request.error || new Error('档案数据库不可用'));
  request.onblocked=()=>reject(new Error('档案数据库被旧窗口占用'));
  request.onsuccess=()=>{const db=request.result;if(abandoned){db.close();return;}db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
 })).catch(error=>{abandoned=true;throw error;});
 return connection;
}
export async function putMatchArchive(match) {
 const db=await openDB(); if(!db) return false;
 await withArchiveTimeout(new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'), store=tx.objectStore(STORE);
  store.put(match);
  const keys=store.getAllKeys();keys.onsuccess=()=>{for(const key of keys.result.sort().reverse().slice(5))store.delete(key);};
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error || new Error('档案写入未完成'));
 })); return true;
}
export async function readMatchArchives() {
 const db=await openDB(); if(!db) return [];
 return withArchiveTimeout(new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readonly'), request=tx.objectStore(STORE).getAll();let rows=[];
  request.onsuccess=()=>{rows=request.result;};
  tx.oncomplete=()=>resolve(rows.sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)));
  tx.onerror=tx.onabort=()=>reject(tx.error || new Error('档案读取失败'));
 }));
}
