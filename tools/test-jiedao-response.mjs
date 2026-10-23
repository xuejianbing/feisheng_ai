import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,team='fan'){this.playerid=id;this.identity=team;this.hand=[];this.equip=[];this.hp=3;this.maxHp=4;this.skills=new Set();}
 getCards(z){return z==='e'?this.equip:z==='h'||z==='hs'?this.hand:[];}
 countCards(z,name){return this.getCards(z).filter(c=>!name||c.name===name).length;}
 hasSkill(){return false;}addSkill(){}removeSkill(){}isOnline2(){return false;}
 chooseToUse(){return {name:'chooseToUse',player:this,parent:stub._status.event,ai1:()=>77,ai2:()=>66,set(k,v){this[k]=v;return this;}};}
}
const human=new Player('human'),holder=new Player('holder'),victim=new Player('victim','zhu');
const sha={name:'sha',value:4},weapon={name:'zhuge',value:6,subtypes:['equip1']};holder.hand=[sha];holder.equip=[weapon];
let effect=5,legal=true;
const stub={lib:{config:{},skill:{},card:{},filter:{cardEnabled:()=>true,targetEnabled:()=>legal,targetInRange:()=>legal},element:{Player}},game:{me:human,players:[human,holder,victim],dead:[]},get:{mode:()=> 'doudizhu',name:c=>c?.name,value:c=>c.value??4,subtypes:c=>c.subtypes||[],attitude:(a,b)=>a.identity===b.identity?5:-5,effect:()=>effect,order:()=>3},_status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {resolveJiedaoResponse,evaluateJiedaoResponse,installJiedaoResponseBridge}=await import('../score/decision/response/jiedaoResponse.js?v=41a');
const {installResponseAI,uninstallResponseAI}=await import('../score/decision/cardplay/responseAI.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {captureTacticalSettings}=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
captureTacticalSettings();
function scenario(source=human,target=victim){const card={name:'jiedao'},use={name:'useCard',player:source,card,targets:[holder],parent:{name:'chooseToUse',type:'phase',player:source,parent:{name:'phaseUse',player:source}}};const root={name:'jiedao',player:source,target:holder,targets:[holder],addedTarget:target,card,parent:use};const event={name:'chooseToUse',player:holder,parent:root,sourcex:target,respondTo:[source,card],filterCard:()=>true};return {event,root,use};}
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
check('真实addedTarget/sourcex优先，targets[0]持刀者不冒充被杀者',()=>{const {event}=scenario();assert.equal(resolveJiedaoResponse(holder,event).victim,victim);assert.equal(evaluateJiedaoResponse(holder,event).action,'sha');});
check('来源、持刀者或目标明确冲突时不猜上下文',()=>{
 for(const mutate of [s=>s.event.sourcex=human,s=>s.root.target=human,s=>s.event.respondTo[0]=victim,s=>s.event.player=human]){const s=scenario();mutate(s);assert.equal(evaluateJiedaoResponse(holder,s.event).resolved,false);}
 const s=scenario();delete s.root.addedTarget;delete s.event.sourcex;assert.equal(resolveJiedaoResponse(holder,s.event),null);
});
check('普通杀、决斗和被杀者后续响应不借用外层借刀',()=>{const s=scenario();for(const name of ['useCard','juedou','chooseToRespond'])assert.equal(resolveJiedaoResponse(holder,{name,parent:s.event}),null);assert.equal(resolveJiedaoResponse(holder,{name:'chooseToUse',player:holder}),null);});
check('负面杀效果与武器转移分开比较，伤友不再只看血量',()=>{
 const s=scenario(human,human);effect=-8;assert.equal(evaluateJiedaoResponse(holder,s.event).action,'transfer');effect=5;assert.equal(evaluateJiedaoResponse(holder,s.event).action,'sha');
});
check('交敌人武器和转给队友采用响应者自身视角',()=>{const friendly=evaluateJiedaoResponse(holder,scenario().event);const hostile=evaluateJiedaoResponse(holder,scenario(victim,human).event);assert(friendly.transferValue>hostile.transferValue);});
check('具体杀的成本、属性效果和不可用牌分别评估',()=>{
 const expensive={name:'sha',value:50,nature:'fire'};holder.hand.push(expensive);const s=scenario();assert.equal(evaluateJiedaoResponse(holder,s.event,expensive).action,'transfer');assert.equal(evaluateJiedaoResponse(holder,s.event,sha).action,'sha');
 legal=false;assert.equal(evaluateJiedaoResponse(holder,s.event,sha).resolved,false);legal=true;holder.hand.pop();
});
check('不读取他人手牌；没有实体杀不宣称技能也不能供杀',()=>{
 const saved=human.getCards;human.getCards=z=>{if(z==='h'||z==='hs')throw Error('hidden hand');return [];};
 try{assert(evaluateJiedaoResponse(holder,scenario().event).resolved);}finally{human.getCards=saved;}
 holder.hand=[];assert.equal(evaluateJiedaoResponse(holder,scenario().event).resolved,false);holder.hand=[sha];
});
check('技能名、未知转化及已离手材料回退宿主',()=>{
 const e=scenario().event;assert.equal(evaluateJiedaoResponse(holder,e,'wusheng').resolved,false);
 assert.equal(evaluateJiedaoResponse(holder,e,{name:'sha',cards:[{name:'shan'}]}).resolved,false);
 assert.equal(evaluateJiedaoResponse(holder,e,{name:'sha'}).resolved,false);
});
check('宿主effect异常、非有限值和重入不破坏选择',()=>{
 const original=stub.get.effect;stub.get.effect=()=>{throw Error('host');};assert.equal(evaluateJiedaoResponse(holder,scenario().event).resolved,false);
 stub.get.effect=()=>NaN;assert.equal(evaluateJiedaoResponse(holder,scenario().event).resolved,false);
 stub.get.effect=()=>{assert.equal(evaluateJiedaoResponse(holder,scenario().event).reason,'reentrant-effect');return 5;};assert(evaluateJiedaoResponse(holder,scenario().event).resolved);stub.get.effect=original;
});
check('实际宿主返回窗口在后续set完成后使用同一分支打分',()=>{
 const {root}=scenario();stub._status.event=root;const before=Player.prototype.chooseToUse,remove=installJiedaoResponseBridge();
 try{const e=holder.chooseToUse().set('sourcex',victim).set('respondTo',[human,root.card]);assert(e.ai1(sha)>0);assert(e.ai2(victim)>0);assert.equal(e.ai2(human),66);effect=-8;assert(e.ai1(sha)<0);assert(e.ai2(victim)<0);effect=5;
 remove();assert.equal(Player.prototype.chooseToUse,before);assert.equal(e.ai1(sha),77);
 }finally{remove();}
});
check('新窗口与每次评分读取当前装备和材料，不沿用旧计划',()=>{
 const {root}=scenario();stub._status.event=root;const remove=installJiedaoResponseBridge();try{const e=holder.chooseToUse();holder.equip=[];assert.equal(e.ai1(sha),77);holder.equip=[weapon];root.finished=true;assert.equal(e.ai1(sha),77);}finally{remove();}
});
check('本地手动、远端人类、响应开关关闭均保留原AI回调',()=>{
 const s=scenario();stub._status.event=s.root;const remove=installJiedaoResponseBridge();
 try{const prev=stub.game.me;stub.game.me=holder;const local=holder.chooseToUse();assert.equal(local.ai1(sha),77);stub.game.me=prev;
 holder.isOnline2=()=>true;assert.equal(holder.chooseToUse().ai1(sha),77);delete holder.isOnline2;
 const e=holder.chooseToUse();stub.lib.config.extension_无名AI_responseAI=false;assert.equal(e.ai1(sha),77);delete stub.lib.config.extension_无名AI_responseAI;
 }finally{remove();}
});
check('确认的人类借刀意图贯通实际分支，通用留杀不再二次否决',()=>{
 const s=scenario();intent.observeCooperativeTrickUse(s.use,human,s.use.parent);stub._status.event=s.event;
 assert.equal(evaluateJiedaoResponse(holder,s.event).playerIntentRespected,true);
 installResponseAI();try{holder.hp=4;const tags=stub.lib.skill._djsc_responseAI.ai.skillTagFilter;assert.equal(tags(holder,'respondSha',sha),undefined);
 effect=-8;assert.equal(tags(holder,'respondSha',sha),false);effect=5;
 }finally{uninstallResponseAI();intent.finishCooperativeTrickUse(s.use);}
});
check('卸载与多层chooseToUse包装后旧闭包失效，且不覆盖后装包装器',()=>{
 const s=scenario();stub._status.event=s.root;const before=Player.prototype.chooseToUse,remove=installJiedaoResponseBridge(),ours=Player.prototype.chooseToUse;
 const later=function(...args){return ours.apply(this,args);};Player.prototype.chooseToUse=later;const e=holder.chooseToUse();remove();assert.equal(Player.prototype.chooseToUse,later);assert.equal(e.ai1(sha),77);Player.prototype.chooseToUse=before;
});
check('选定的杀与目标评分一致；换局后旧响应回调失效',()=>{
 const s=scenario();stub._status.event=s.root;const remove=installJiedaoResponseBridge();
 const expensive={name:'sha',value:50};holder.hand.push(expensive);
 try{const e=holder.chooseToUse();stub.ui.selected={cards:[expensive]};assert(e.ai2(victim)<0);stub.ui.selected.cards=[];assert(e.ai2(victim)>0);
 intent.resetCooperativeTrickIntents();assert.equal(e.ai1(sha),77);assert.equal(e.ai2(victim),66);
 }finally{holder.hand.pop();stub.ui.selected={cards:[]};remove();}
});
check('自定义禁牌禁目标保留；宿主后设AI优先',()=>{
 const s=scenario();s.event.filterCard=()=>false;assert.equal(evaluateJiedaoResponse(holder,s.event).resolved,false);
 s.event.filterCard=()=>true;s.event.filterTarget=()=>false;assert.equal(evaluateJiedaoResponse(holder,s.event).resolved,false);
 stub._status.event=s.root;const remove=installJiedaoResponseBridge();try{const e=holder.chooseToUse().set('ai1',()=>123);assert.equal(e.ai1(sha),123);}finally{remove();}
});
check('不为保贵武器攻击濒死队友；宿主认可正收益的受伤配合仍可选',()=>{
 const s=scenario(victim,human),hp=human.hp,value=weapon.value;human.hp=1;weapon.value=50;effect=-1;
 try{const r=evaluateJiedaoResponse(holder,s.event);assert.equal(r.action,'transfer');assert.equal(r.reason,'avoid-harmful-lethal-to-ally');
 effect=5;assert.equal(evaluateJiedaoResponse(holder,s.event).action,'sha');}
 finally{human.hp=hp;weapon.value=value;effect=5;}
});
console.log(`Jiedao response tests: ${count} passed, 0 failed`);
