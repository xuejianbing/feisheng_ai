// node tools/test-removal-cooperation.mjs — 拆顺/借刀实际意图、公开收益和归因边界。
import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,identity='fan'){this.playerid=id;this.identity=identity;this.hp=3;this.maxHp=4;this.hand=[{name:'wuxie'},{name:'sha'},{name:'shan'},{name:'tao'}];this.equip=[];this.judge=[];}
 getCards(z){return z==='h'?this.hand:z==='e'?this.equip:z==='j'?this.judge:[];}
 countCards(z,filter){const c=this.getCards(z);return filter?c.filter(filter).length:c.length;}
 isOnline2(){return false;}hasSkill(){return false;}hasSkillTag(){return false;}chooseToUse(r){return r;}
}
const human=new Player('human'),ally=new Player('ally'),enemy=new Player('enemy','zhu');
let recovery=2;
const stub={lib:{config:{},skill:{},card:{},filter:{canBeDiscarded:c=>!c.protected,canBeGained:c=>!c.protected},element:{Player}},
 game:{me:human,players:[human,ally,enemy],dead:[]},get:{mode:()=> 'doudizhu',name:c=>c?.name,attitude:(a,b)=>a.identity===b.identity?5:-5,value:()=>4,recoverEffect:()=>recovery},_status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const {captureTacticalSettings}=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {evaluateWuxie,evaluateTrickEffect}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
const {installWuxieOptimization}=await import('../score/decision/response/wuxieOptimization.js?v=41a');
captureTacticalSettings();
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
function use(id='guohe',source=human,target=ally,event=null,card=null){
 const phase={name:'phaseUse',player:source};const choice=event||{name:'chooseToUse',type:'phase',player:source,parent:phase};
 const root={name:'useCard',player:source,card:card||{name:id},targets:[target],parent:choice};intent.observeCooperativeTrickUse(root,source,choice);return root;
}
function req(root,state=1){const original={card:root.card,player:root.player,target:root.targets[0],targets:root.targets};return {type:'wuxie',state,info_map:state<0?{card:{name:'wuxie'},_source:original}:original,ai1:()=>0};}
function context(id='guohe',source=enemy,target=human){return {originalSpellId:id,source,target,targets:[target],effectScope:'target',card:{name:id}};}
check('玩家主动拆顺队友资源，队友不按失牌直接打断',()=>{
 ally.hp=1;ally.equip=[{name:'bagua'}];
 for(const id of ['guohe','shunshou']){const root=use(id);const r=evaluateWuxie(ally,req(root));assert(r.cooperativeIntent);assert.equal(r.use,false);intent.finishCooperativeTrickUse(root);const ordinary=evaluateWuxie(ally,req(root));assert.equal(ordinary.playerIntentRespected,false);assert(ordinary.effectValue<0);if(id==='guohe')assert.equal(ordinary.use,true);}
 ally.hp=3;ally.equip=[];
});
check('无懈桥接按实际手动拆顺意图评分',()=>{
 ally.hp=1;const root=use(),remove=installWuxieOptimization(evaluateWuxie);try{const request=req(root);ally.chooseToUse(request);assert.equal(request.ai1(ally.hand[0]),0);}finally{remove();intent.finishCooperativeTrickUse(root);ally.hp=3;}
});
check('无收益证明时不为玩家资源转移强出反无懈',()=>{
 const root=use('shunshou');assert.equal(evaluateWuxie(ally,req(root,-1)).use,false);intent.finishCooperativeTrickUse(root);
});
check('已确认玩家借刀计划放行，但明确记录没有数值收益模型',()=>{
 const root=use('jiedao');root.targets.push(enemy);const r=evaluateWuxie(ally,req(root));assert.equal(r.resolved,true);assert.equal(r.use,false);assert.equal(r.effectBasis,'intent-only');assert.equal(r.effectValue,0);assert.equal(r.cooperativeIntent.kind,'manual-borrow-plan');
 assert.equal(evaluateWuxie(ally,req(root,-1)).use,false);intent.finishCooperativeTrickUse(root);
});
check('借刀实际响应桥接不会重新掉回另一套原生判断',()=>{
 const root=use('jiedao'),remove=installWuxieOptimization(evaluateWuxie);try{const r=req(root);ally.chooseToUse(r);assert.equal(r.__djscWuxieOptimized,true);assert.equal(r.ai1(ally.hand[0]),0);}finally{remove();intent.finishCooperativeTrickUse(root);}
});
check('敌方或无法归属的借刀仍交回宿主，不捏造第二目标收益',()=>{
 const root=use('jiedao',enemy);assert.equal(evaluateWuxie(ally,req(root)).resolved,false);intent.finishCooperativeTrickUse(root);
 const unknown={type:'wuxie',state:1,info_map:{card:{name:'jiedao'},player:human,target:ally}};assert.equal(evaluateWuxie(ally,unknown).resolved,false);
});
check('强制技能内部伪装成phase窗口也没有玩家权限',()=>{
 ally.hp=1;
 const phase={name:'phaseUse',player:human},skill={name:'useSkill',player:human,parent:phase};
 const choice={name:'chooseToUse',type:'phase',player:human,parent:skill};const root=use('guohe',human,ally,choice);
 assert.equal(evaluateWuxie(ally,req(root)).cooperativeIntent,null);assert.equal(evaluateWuxie(ally,req(root)).use,true);intent.finishCooperativeTrickUse(root);ally.hp=3;
});
check('没有真实phaseUse祖先不认定为主动操作',()=>{
 const choice={name:'chooseToUse',type:'phase',player:human};const root=use('guohe',human,ally,choice);assert.equal(evaluateWuxie(ally,req(root)).cooperativeIntent,null);intent.finishCooperativeTrickUse(root);
});
check('同牌再次使用时，旧祖先事件不能借用新意图',()=>{
 const shared={name:'guohe'},old=use('guohe',human,ally,null,shared);intent.finishCooperativeTrickUse(old);const current=use('guohe',human,ally,null,shared);
 const result=evaluateWuxie(ally,req(old),{damageEvent:{name:'wuxie',parent:old}});assert.equal(result.cooperativeIntent,null);assert(evaluateWuxie(ally,req(current)).cooperativeIntent);intent.finishCooperativeTrickUse(current);
});
check('实际用牌者与传入来源不一致时拒绝绑定',()=>{
 const choice={name:'chooseToUse',type:'phase',player:human,parent:{name:'phaseUse',player:human}};
 const root={name:'useCard',player:enemy,card:{name:'guohe'},targets:[ally]};assert.equal(intent.observeCooperativeTrickUse(root,human,choice),null);
});
check('明确祖先的来源不符时不能退回同牌对象的旧凭据',()=>{
 const root=use();const other={name:'useCard',player:enemy,card:root.card,targets:[ally]};
 const r=evaluateWuxie(ally,req(root),{damageEvent:other});assert.equal(r.cooperativeIntent,null);intent.finishCooperativeTrickUse(root);
});
check('受保护的公开装备和判定不计入可拆收益',()=>{
 human.hand=[];human.equip=[{name:'bagua',protected:true}];human.judge=[{name:'lebu',protected:true}];assert.equal(evaluateTrickEffect(ally,context()),0);assert.equal(evaluateTrickEffect(ally,context('shunshou')),0);human.equip=[];human.judge=[];
});
check('公共合法性计数为零时不臆测能拿未知手牌',()=>{
 human.countCards=()=>4;human.countDiscardableCards=()=>0;human.countGainableCards=()=>0;
 const original=human.getCards;human.getCards=z=>{if(z==='h')throw Error('hidden hand');return [];};
 try{assert.equal(evaluateTrickEffect(ally,context()),0);assert.equal(evaluateTrickEffect(ally,context('shunshou')),0);}finally{human.getCards=original;delete human.countCards;delete human.countDiscardableCards;delete human.countGainableCards;}
});
check('白银狮子失去回复不再一律当作拆队友好装备',()=>{
 human.hand=[];human.equip=[{name:'baiyin'}];human.hp=1;recovery=2;const r=evaluateWuxie(ally,null,context());assert(r.effectValue>0);assert.equal(r.use,false);
 human.hp=4;assert(evaluateTrickEffect(ally,context())<0);human.hp=3;human.equip=[];
});
check('帮助敌方回复的失装备操作也按响应者视角计入',()=>{
 enemy.hand=[];enemy.equip=[{name:'baiyin'}];enemy.hp=1;recovery=-3;assert(evaluateTrickEffect(ally,context('guohe',human,enemy))<0);enemy.hp=3;enemy.equip=[];recovery=2;
});
check('宿主不提供回复语义时保留装备损失，不伪造回血',()=>{
 human.equip=[{name:'baiyin'}];const original=stub.get.recoverEffect;stub.get.recoverEffect=()=>{throw Error('unsupported');};try{assert(evaluateTrickEffect(ally,context())<0);}finally{stub.get.recoverEffect=original;human.equip=[];}
});
check('新旧无懈路径都理解玩家拆顺配合',()=>{
 for(const enabled of [false,true]){stub.lib.config['extension_无名AI_tacticalWuxie']=enabled;captureTacticalSettings();const root=use('guohe');assert.equal(evaluateWuxie(ally,req(root)).playerIntentRespected,true);intent.finishCooperativeTrickUse(root);}
});
console.log(`Removal cooperation tests: ${passed} passed, 0 failed`);
