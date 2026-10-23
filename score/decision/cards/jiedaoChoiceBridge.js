/* Native sequential selection stays authoritative; only AI scores share the pair evaluator. */
import {lib,game,get,ui,_status} from '../../foundation/adapt/host.js?v=41a';
import {bestJiedaoPair,hostJiedaoTargetDecision,jiedaoPolicyEnabled} from './jiedaoEvaluator.js?v=41a';
import {cooperativeTrickEpoch} from '../state/cooperativeTrickIntent.js?v=41a';
import {tacticalSettingsSnapshot} from '../strategy/tacticalOptimization.js?v=41a';
function normalWindow(event,p){
 try{
 if(event?.name!=='chooseToUse'||event.player!==p||event.type!=='phase'||event.forced)return false;
 const seen=new Set();let parent=event.parent||event.getParent?.();
 while(parent&&!seen.has(parent)&&seen.size<16){
  seen.add(parent);
  if(parent.name==='phaseUse')return parent.player===p;
  if(parent.name!=='chooseToUse'||parent.player!==p||parent.type!=='phase'||parent.forced)return false;
  parent=parent.parent||parent.getParent?.();
 }
 return false;
 }catch(_){return false;}
}
export function installJiedaoChoiceBridge(){
 const proto=lib.element?.Player?.prototype,original=proto?.chooseToUse;
 if(typeof original!=='function')return ()=>{};
 let active=true;
 const wrapped=function(...args){
  const p=this,result=original.apply(this,args),epoch=cooperativeTrickEpoch();
  if(!result||typeof result!=='object'||!jiedaoPolicyEnabled())return result;
  const native1=result.ai1,native2=result.ai2;
  const enabled=()=>active&&jiedaoPolicyEnabled()&&epoch===cooperativeTrickEpoch()&&!result.finished&&tacticalSettingsSnapshot().enabled&&
   !(p===game.me&&!_status.auto)&&!p.isOnline2?.()&&normalWindow(result,p);
  result.ai1=function(item,...rest){
   if(enabled()&&typeof item==='object'&&get.name(item,p)==='jiedao'){
    const r=bestJiedaoPair(p,{card:item});
    if(r.resolved){
     if(!r.use)return -1;
     const native=typeof native1==='function'?native1.call(this,item,...rest):get.order?.(item,p);
     return Math.max(Number.isFinite(native)?native:0,Math.min(12,r.score));
    }
   }
   return typeof native1==='function'?native1.call(this,item,...rest):get.order?.(item,p);
  };
  result.ai2=function(target,...rest){
   const selected=ui.selected?.cards;
   const card=selected?.length===1?selected[0]:null;
   if(enabled()&&card&&get.name(card,p)==='jiedao'){
    const r=hostJiedaoTargetDecision(p,target,card);
    if(r)return r.allowed?Math.max(.01,Math.min(12,r.score)):-1;
   }
   return typeof native2==='function'?native2.call(this,target,...rest):get.effect?.(target,card,p,p);
  };
  return result;
 };
 proto.chooseToUse=wrapped;
 return ()=>{active=false;if(proto.chooseToUse===wrapped)proto.chooseToUse=original;};
}
