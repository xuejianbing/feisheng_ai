import {lib,get,_status} from '../../../foundation/adapt/host.js?v=5e5';
import {readModeContext} from '../../../foundation/runtime/modeContext.js?v=5e5';
const originals=new Map(),pending=[];
function parentFor(event){try{return event?.getParent?.()||event?.parent||null;}catch(_){return null;}}
function eligible(){const c=readModeContext();return c.enabled?c:null;}
function rank(id){try{const n=get.rank?.(id,true);return Number.isFinite(n)?n:null;}catch(_){return null;}}
function setupParent(event){let p=parentFor(event);for(let i=0;p&&i<5;i++,p=parentFor(p)){if(p.name==='chooseCharacter')return p;}return null;}
export function chooseLandlordAdvice(pool,rate=rank){const values=(pool||[]).map(rate).filter(Number.isFinite);if(!values.length)return null;return Math.max(...values)>=7?'叫地主':'不叫';}
function record(c,actor,kind,data){pending.push({schema:'classic-setup-advice-v1',mode:c.mode,submode:c.submode,ruleKey:c.ruleKey,actorId:actor.playerid||null,kind,...data,executionState:'suggested',trainingEligible:false,at:Date.now()});if(pending.length>128)pending.shift();}
export function takeClassicSetupAdvice(sessionId){return pending.splice(0).map(r=>({...r,sessionId}));}
export function installClassicChoiceHooks(){
 const proto=lib.element?.Player?.prototype;if(!proto)return false;
 for(const method of ['chooseControl','chooseButton']){
  if(originals.has(method)||typeof proto[method]!=='function')continue;
  const original=proto[method];
  const wrapper=function(...args){const event=original.apply(this,args),actor=this,parent=setupParent(event);
   if(!parent||!event||typeof event.set!=='function')return event;const c=eligible();if(!c)return event;
   const pool=parent.map?.[actor.playerid]||actor._characterChoice;
   if(!Array.isArray(pool)||!pool.length)return event;
   if(method==='chooseControl'){
    const controls=event.controls||args.flat().filter(x=>typeof x==='string');
    if(c.submode!=='huanle'||!controls.includes('叫地主')||!controls.includes('不叫'))return event;
    const advice=chooseLandlordAdvice(pool);if(!advice)return event;
    record(c,actor,'叫地主',{advice,candidates:pool.slice()});
    // 宿主在创建事件后 set('ai',...)；替换这次事件的 AI，不改人类选择。
    const set=event.set;event.set=function(key,value){return set.call(this,key,key==='ai'?()=>advice:value);};set.call(event,'ai',()=>advice);
   }else{
    const ai=button=>{const id=button?.link;if(typeof id!=='string'||!pool.includes(id))return -Infinity;return rank(id)??0;};
    record(c,actor,'选将',{candidates:pool.slice(),basis:'宿主武将强度排序',adviceOnly:true});
    const set=event.set;event.set=function(key,value){return set.call(this,key,key==='ai'?ai:value);};set.call(event,'ai',ai);
   }
   return event;
  };
  originals.set(method,{proto,original,wrapper});proto[method]=wrapper;
 }
 return originals.size>0;
}
export function uninstallClassicChoiceHooks(){for(const [method,row] of originals){if(row.proto[method]===row.wrapper)row.proto[method]=row.original;}originals.clear();pending.length=0;}
