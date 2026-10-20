/* Only the responding player's own material pool is inspected. */
import {hasDisjointResponseMaterials} from './responseMaterialPacking.js?v=41a';
import {lib,game,get} from '../../foundation/adapt/host.js?v=41a';
function ownCards(player,position='hs'){
 if(typeof position!=='string'||/[^hes]/.test(position))return [];
 return [...new Set([...position].flatMap(z=>player.getCards(z)||[]))];
}
function combinations(pool,n,limit=128){
 const out=[];
 const walk=(from,chosen)=>{if(out.length>=limit)return;if(chosen.length===n){out.push(chosen);return;}
  for(let i=from;i<pool.length;i++)walk(i+1,[...chosen,pool[i]]);
 };walk(0,[]);return out;
}
export function responseMaterialOptions(player,id,{event=null,use=false,target=null,material=null}={}){
 try{
  const enabled=(card,parts)=>{
   if(parts.some(c=>lib.filter.cardEnabled2&&!lib.filter.cardEnabled2(c,player,event)))return false;
   if(use){if(lib.filter.cardEnabled&&!lib.filter.cardEnabled(card,player))return false;
    if(target&&lib.filter.targetEnabled&&!lib.filter.targetEnabled(card,player,target))return false;
    if(target&&lib.filter.targetInRange&&!lib.filter.targetInRange(card,player,target))return false;
   }else if(typeof lib.filter.cardRespondable!=='function'||!lib.filter.cardRespondable(card,player,event))return false;
   return true;
  };
  const options=ownCards(player).filter(c=>get.name(c,player)===id&&enabled(c,[c])).map(card=>({card,cards:[card],skill:null}));
  let skills=[...(player.getSkills?.('invisible')||[])];
  if(typeof game.expandSkills==='function')skills=game.expandSkills(skills);
  if(typeof game.filterSkills==='function')skills=game.filterSkills(skills,player);
  for(const skill of new Set(skills)){
   try{
   const info=lib.skill?.[skill],view=info?.viewAs;
   const name=typeof view==='string'?view:view?.name;
   if(name!==id||typeof view==='function'||info.usable||info.round||info.limited||info.juexingji||info.cost)continue;
   const mode=use?'chooseToUse':'chooseToRespond',enable=info.enable;
   if(enable!==mode&&!(Array.isArray(enable)&&enable.includes(mode)))continue;
   if(typeof info.viewAsFilter==='function'&&info.viewAsFilter(player)===false)continue;
   if(info.filter){if(event?.name!==mode||!info.filter(event,player))continue;}
   const count=info.selectCard??1,n=Array.isArray(count)&&count[0]===count[1]?count[0]:count;
   if(!Number.isInteger(n)||n<1||n>2||/selected\s*[.[]/.test(String(info.filterCard)))continue;
   const filter=info.filterCard===true?()=>true:typeof info.filterCard==='function'?info.filterCard:
    info.filterCard&&typeof info.filterCard==='object'&&typeof get.filter==='function'?get.filter(info.filterCard):null;
   if(!filter)continue;
   const pool=ownCards(player,info.position||'h').filter(c=>filter(c,player,event));
   for(const parts of combinations(pool,n)){
    const card={...(typeof view==='object'?view:{}),name:id,isCard:true,cards:parts,skill};
    if(enabled(card,parts))options.push({card,cards:parts,skill});
   }
   }catch(_){continue;}
  }
  if(!material)return options;
  if(typeof material==='string')return options.filter(o=>o.skill===material);
  return options.filter(o=>o.card===material||o.skill&&
   ((event?.skill===o.skill&&o.cards.includes(material))||
    (material?.skill===o.skill&&Array.isArray(material.cards)&&material.cards.length===o.cards.length&&o.cards.every(c=>material.cards.includes(c)))));
 }catch(_){return [];}
}
export function canSupplyTrickResponse(player,id,ctx){
 try{
  const events=[];let e=ctx.responseEvent,seen=new Set();
  while(e&&!seen.has(e)&&seen.size<16){seen.add(e);events.push(e);if(e.name==='useCard')break;e=e.parent||e.getParent?.();}
  if(events.some(e=>e.directHit===true||e.directHit?.includes?.(player)||e.directHit?.has?.(player)))return false;
  if(ctx.source?.hasSkillTag?.('directHit_ai',true,{target:player,card:ctx.card}))return false;
  const field=id==='shan'?'shanRequired':'shaRequired';
  const required=Math.max(1,...events.flatMap(e=>[Number(e[field])||1,Number(e.customArgs?.[player.playerid]?.[field])||1]));
  const options=responseMaterialOptions(player,id,{event:ctx.responseEvent});
  return hasDisjointResponseMaterials(options,required);
 }catch(_){}
 return false;
}

export function knownTrickDamage(player,ctx){
 let base=1,extra=0,event=ctx.responseEvent,seen=new Set();
 while(event&&!seen.has(event)&&seen.size<16){
  seen.add(event);base=Math.max(base,Number(event.baseDamage)||1);
  const args=event.customArgs?.[player.playerid];
  base=Math.max(base,Number(args?.baseDamage)||1);
  extra=Math.max(extra,Number(args?.extraDamage)||0,Number(event.extraDamage)||0);
  if(event.name==='useCard')break;event=event.parent||event.getParent?.();
 }
 return base+Math.max(0,extra);
}
