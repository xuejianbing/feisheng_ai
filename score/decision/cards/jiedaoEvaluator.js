/* Ordered borrowed-sword plan: holder first, victim second. Public estimates only. */
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';
import {lib,game,get,ui} from '../../foundation/adapt/host.js?v=41a';
import {dispositionOf} from '../relations/relations.js?v=41a';
import {identityHostEffect} from '../../perception/observer/identityDiagnostics.js?v=41a';
import {jiedaoTransferValue,boundedJiedaoValue} from './jiedaoBranches.js?v=41a';
let evaluating=false;
export function hasWeapon(p){
 try{return (p?.getCards('e')||[]).some(c=>get.subtypes(c)?.includes('equip1'));}catch(_){return false;}
}
function live(p){return !!p&&game.players?.includes(p)&&p.alive!==false&&p.isIn?.()!==false;}
export function supportedJiedaoShape(){
 const c=lib.card?.jiedao;
 return c?.singleCard===true&&typeof c.filterTarget==='function'&&typeof c.filterAddedTarget==='function';
}
export function evaluateJiedaoPair(me,holder,victim,card={name:'jiedao'}){
 const no=(reason,resolved=true)=>({resolved,use:false,score:0,holder,victim,reason});
 if(!supportedJiedaoShape())return no('unsupported-host-shape',false);
 if(evaluating)return no('reentrant-effect',false);
 evaluating=true;
 try{
  if(!live(me)||!live(holder)||!live(victim)||holder===me||holder===victim||victim===me||!hasWeapon(holder))return no('invalid-pair');
  const relation=dispositionOf(me,holder);
  if(!relation||dispositionOf(me,victim)>=0)return no('unknown-holder-or-nonenemy-victim');
  const info=lib.card.jiedao;
  if(lib.filter.cardEnabled&&!lib.filter.cardEnabled(card,me))return no('card-disabled');
  if(lib.filter.cardUsable&&!lib.filter.cardUsable(card,me))return no('card-unusable');
  if(lib.filter.targetEnabled&&!lib.filter.targetEnabled(card,me,holder))return no('holder-disabled');
  if(!info.filterTarget(card,me,holder)||!info.filterAddedTarget(card,me,victim,holder))return no('native-pair-filter');
  const effect=identityHostEffect(victim,{name:'sha',isCard:true},holder,me);
  const transfer=jiedaoTransferValue(me,holder,me,dispositionOf);
  if(!Number.isFinite(effect)||transfer===null)return no('unknown-branch-effect',false);
  // Chance of actual Sha execution, not a claim about hidden hand contents or willingness.
  const count=holder.countCards?.('h');
  if(!Number.isFinite(count)||count<0)return no('unknown-public-hand-count',false);
  const shaChance=Math.min(.65,1-Math.pow(.8,count));
  const shaValue=boundedJiedaoValue(effect-(relation>0?1:0));
  const score=boundedJiedaoValue(shaChance*shaValue+(1-shaChance)*transfer);
  return {resolved:true,use:score>0,score,holder,victim,shaValue,transferValue:transfer,shaChance,
   effectBasis:'public-branch-estimate',reason:relation>0?'借友刀的公开分支估计':'借敌刀的公开分支估计'};
 }catch(_){return no('pair-evaluation-failed',false);}finally{evaluating=false;}
}
export function enumerateJiedaoPairs(me,{holder=null,card={name:'jiedao'}}={}){
 const pairs=[];
 let incomplete=false;
 for(const h of holder?[holder]:(game.players||[])){
  if(h===me||!hasWeapon(h))continue;
  for(const v of game.players||[]){const r=evaluateJiedaoPair(me,h,v,card);if(!r.resolved)incomplete=true;if(r.resolved&&r.use)pairs.push(r);}
 }
 Object.defineProperty(pairs,'incomplete',{value:incomplete});
 return pairs.sort((a,b)=>b.score-a.score);
}
export function bestJiedaoPair(me,options={}){
 if(evaluating||!supportedJiedaoShape())return {resolved:false,use:false,score:0,reason:'unsupported-host-shape'};
 const pairs=enumerateJiedaoPairs(me,options);
 return pairs.length?{...pairs[0],pairs:pairs.slice(0,5).map(p=>({holder:p.holder.playerid,victim:p.victim.playerid,score:p.score}))}:
  {resolved:!pairs.incomplete,use:false,score:0,reason:pairs.incomplete?'unknown-branch-effect':'no-positive-legal-pair'};
}
// The selected holder constrains the second stage. Never choose a fresh holder for it.
export function hostJiedaoTargetDecision(me,target,card,selected=ui.selected?.targets||[]){
 if(!supportedJiedaoShape())return null;
 const holder=selected[0];
 const r=holder?evaluateJiedaoPair(me,holder,target,card):bestJiedaoPair(me,{holder:target,card});
 return r.resolved?{allowed:!!r.use,score:r.score,holder:r.holder,victim:r.victim}:null;
}
export default {hasWeapon,evaluateJiedaoPair,enumerateJiedaoPairs,bestJiedaoPair};

// A pair exemption needs the actual ordered candidate, not a free-standing metadata flag.
export function evaluateBoundJiedaoCandidate(me,a){
 const p=a?.jiedaoPair,t=a?.targetList;
 if(a?.id!=='jiedao'||!p?.use||t?.length!==2||a.targetObj!==p.holder||t[0]!==p.holder||t[1]!==p.victim||
  !Array.isArray(a.target)||a.target.length!==2||a.target[0]!==playerKey(p.holder)||a.target[1]!==playerKey(p.victim))return null;
 return evaluateJiedaoPair(me,p.holder,p.victim);
}
