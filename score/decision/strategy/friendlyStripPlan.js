// Public-state plan shared by relation guards and tactical scoring. No relation dependency.
import {lib,game,get} from '../../foundation/adapt/host.js?v=41a';
import {effectiveJudgeName} from './judgeName.js?v=41a';
let settings={enabled:false};
export function configureFriendlyStrip(settingsForGame){settings={...settingsForGame};}
export function selectableStrip(p,t,card,name){
 try{const filter=name==='shunshou'?lib.filter.canBeGained:lib.filter.canBeDiscarded;
 return !!card&&(!filter||filter(card,p,t));}catch(_){return false;}
}
// Caller establishes ally relation. undefined = legacy policy; null = no supported benefit.
export function friendlyStripPlan(p,card,t){
 if(!settings.enabled)return undefined;
 try{
  const name=get.name(card,p);
  if(!p||!t||p===t||!['guohe','shunshou'].includes(name))return null;
  // An optimization switch off preserves native judge rescue. Lightning has no new benefit model.
  const fallback=!settings.rescue||(t.getCards('j')||[]).some(c=>effectiveJudgeName(c)==='shandian')?undefined:null;
  if(settings.rescue&&!t.hasSkillTag?.('nojudge')){
   const judges=(t.getCards('j')||[]).filter(c=>['lebu','bingliang'].includes(effectiveJudgeName(c))&&selectableStrip(p,t,c,name));
   const upcoming=(game.players.indexOf(t)-game.players.indexOf(p)+game.players.length)%game.players.length||1;
   const selfManage=t.hasSkill?.('qiaobian')||t.hasSkill?.('guanxing');
   const urgency=c=>5+(effectiveJudgeName(c)==='lebu'?Math.min(4,t.countCards('h')):Math.max(1,4-t.countCards('h')))+2/upcoming-(selfManage?3:0);
   judges.sort((a,b)=>urgency(b)-urgency(a));
   if(judges.length)return {kind:'rescue',card:judges[0],score:urgency(judges[0])};
  }
  if(!settings.strip||!(t.hp<t.maxHp)||typeof get.recoverEffect!=='function')return fallback;
  const lion=(t.getCards('e')||[]).find(c=>get.name(c,t)==='baiyin'&&selectableStrip(p,t,c,name));
  if(!lion)return fallback;
  const recovery=get.recoverEffect(t,p,p),cost=get.value(lion,t);
  if(!Number.isFinite(recovery)||!Number.isFinite(cost)||recovery<=0)return fallback;
  const benefit=Math.min(12,recovery*3)-Math.max(0,cost);
  return benefit>0?{kind:'lion-recovery',card:lion,score:Math.min(9,benefit),recovery,cost}:fallback;
 }catch(_){return null;}
}
