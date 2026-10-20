/* Benefit evaluation uses native recovery/effect semantics or the actual public Wugu dialog. */
import {get,ui} from '../../foundation/adapt/host.js?v=41a';
import {identityHostEffect} from '../../perception/observer/identityDiagnostics.js?v=41a';
let evaluating=false;
const clamp=v=>Math.max(-24,Math.min(24,v));
function publicWuguCards(ctx){
 const seen=new Set();let event=ctx.responseEvent,cards=null;
 while(event&&!seen.has(event)&&seen.size<24){
  seen.add(event);
  if(event.finished)return null;
  if(event.name==='useCard'&&(get.name(event.card,event.player)!=='wugu'||event.player!==ctx.source))return null;
  if(event.preResult!=null){
   const dialog=ui.dialogs?.find(d=>d.videoId===event.preResult);
   if(dialog&&Array.isArray(dialog.buttons))cards=dialog.buttons.map(b=>b.link).filter(c=>c&&typeof c==='object');
  }
  if(event.name==='useCard')return cards;
  event=event.parent||event.getParent?.();
 }
 return null;
}
export function benefitTrickEffect(viewer,ctx,relationOf){
 if(evaluating)return null;
 evaluating=true;
 try{
  const id=ctx.originalSpellId;
  const targets=ctx.effectScope==='all'?[...new Set(ctx.targets||[])]:ctx.target?[ctx.target]:id==='wuzhong'&&ctx.source?[ctx.source]:[];
  if(!targets.length)return null;
  if(id==='wugu'){
   // The live dialog already reflects earlier picks. Do not guess unseen cards or future order.
   if(ctx.effectScope!=='target'||targets.length!==1)return null;
   const cards=publicWuguCards(ctx);if(!cards)return null;if(!cards.length)return {value:0,scope:'target',basis:'public-wugu-pool'};
   const values=cards.map(c=>get.value(c,targets[0]));if(values.some(v=>!Number.isFinite(v)))return null;
   const rel=targets[0]===viewer?1:relationOf(viewer,targets[0]);
   return {value:clamp(rel*Math.max(0,...values)/2),scope:'target',basis:'public-wugu-pool'};
  }
  let value=0;
  for(const target of targets){
   if(id==='taoyuan'){
    if(!(target.hp<target.maxHp))continue;
    if(typeof get.recoverEffect!=='function')return null;
    const effect=get.recoverEffect(target,ctx.source,viewer);if(!Number.isFinite(effect))return null;
    value+=effect*3;
   }else if(id==='wuzhong'){
    const effect=identityHostEffect(target,ctx.card||{name:id},ctx.source,viewer);if(!Number.isFinite(effect))return null;
    value+=effect*3;
   }else return null;
  }
  return {value:clamp(value),scope:ctx.effectScope||'target',basis:'native-benefit-effect'};
 }catch(_){return null;}finally{evaluating=false;}
}
