/* 只在宿主自然调用loop后观测返回。不会调用GameEvent.then/start或插入事件。 */
export function observeNaturalCompletion(root, onComplete) {
 if (!root || typeof root.loop !== 'function') return false;
 const original=root.loop;
 let called=false;
 root.loop=function(...args) {
  const finish=error=>{if(!called){called=true;try{onComplete(error);}catch(_){}}};
  let result;
  try { result=original.apply(this,args); } catch(error) { finish(error); throw error; }
  if(result && typeof result.then==='function')return result.then(value=>{finish();return value;},error=>{finish(error);throw error;});
  finish();return result;
 };
 return true;
}
