// node tools/test-trick-cooperation.mjs — 实际宿主事件意图、统一铁索评估和响应运输。
import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,role='fan'){this.playerid=id;this.identity=role;this.hp=3;this.maxHp=4;this.linked=false;this.hand=[{name:'wuxie'},{name:'sha'},{name:'shan'},{name:'tao'}];}
 isLinked(){return this.linked;} getCards(zone){return zone==='h'?this.hand:[];}
 countCards(zone,filter){const h=this.getCards(zone);return filter?h.filter(filter).length:h.length;}
 hasSkill(){return false;}hasSkillTag(){return false;}isOnline2(){return false;}canUse(){return true;}chooseToUse(r){return r;}
}
const human=new Player('human'),ally=new Player('ally'),enemy=new Player('enemy','zhu');
let damage=-1;
const stub={lib:{config:{},skill:{},card:{tiesuo:{},huogong:{}},element:{Player},filter:{}},game:{me:human,players:[human,ally,enemy],dead:[]},
 get:{mode:()=> 'doudizhu',name:c=>c?.name,value:()=>4,attitude:(a,b)=>a.identity===b.identity?5:-5,damageEffect:()=>damage},_status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {evaluateWuxie}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
const {installWuxieOptimization,tiesuoWuxieEffect}=await import('../score/decision/response/wuxieOptimization.js?v=41a');
const tie=await import('../score/decision/cards/tiesuoEvaluator.js?v=41a');
tactical.captureTacticalSettings();
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
function use(source=human,target=ally,id='huogong',manual=true){
 const phase={name:'phaseUse',player:source};const choice={name:'chooseToUse',type:manual?'phase':'respond',player:source,parent:phase};
 const root={name:'useCard',player:source,card:{name:id},targets:[target],parent:choice};intent.observeCooperativeTrickUse(root,source,choice);return root;
}
function req(root,state=1,target=root.targets[0]){const map={card:root.card,player:root.player,target,targets:root.targets};return {type:'wuxie',state,info_map:state<0?{card:{name:'wuxie'},player:enemy,_source:map}:map,ai1:()=>0};}
check('实际手动火攻队友优先放行，区别于无凭据的伤害',()=>{
 const root=use();const result=evaluateWuxie(ally,req(root));assert.equal(result.use,false);assert.equal(result.cooperativeIntent.kind,'manual-friendly-fire');
 intent.finishCooperativeTrickUse(root);assert.equal(evaluateWuxie(ally,req(root)).use,true);
});
check('真实无懈桥接消费同一玩家意图',()=>{const root=use(),remove=installWuxieOptimization(evaluateWuxie);try{const r=req(root);ally.chooseToUse(r);assert.equal(r.ai1(ally.hand[0]),0);}finally{remove();intent.finishCooperativeTrickUse(root);}});
check('反无懈不因未知负收益的玩家意图额外浪费牌',()=>{const root=use();assert.equal(evaluateWuxie(ally,req(root,-1)).use,false);intent.finishCooperativeTrickUse(root);});
check('明确正收益的配合仍可以反无懈恢复',()=>{const root=use();damage=1;try{assert.equal(evaluateWuxie(ally,req(root,-1)).use,true);}finally{damage=-1;intent.finishCooperativeTrickUse(root);}});
check('控制状态改变不会改写这次操作捕获的手动事实',()=>{const root=use();stub._status.auto=true;try{assert.equal(evaluateWuxie(ally,req(root)).use,false);}finally{stub._status.auto=false;intent.finishCooperativeTrickUse(root);}});
check('托管操作不取得玩家配合权限',()=>{stub._status.auto=true;const root=use();stub._status.auto=false;assert.equal(evaluateWuxie(ally,req(root)).use,true);intent.finishCooperativeTrickUse(root);});
check('强制技能或响应不冒充主动操作',()=>{
 for(const manual of [false,true]){const phase={name:'phaseUse',player:human};const event=manual?{name:'jiedao',parent:{name:'chooseToUse',type:'phase',player:human,parent:phase}}:{name:'chooseToUse',type:'respond',player:human,parent:phase};
 const root={name:'useCard',card:{name:'huogong'},player:human,targets:[ally]};intent.observeCooperativeTrickUse(root,human,event);assert.equal(evaluateWuxie(ally,req(root)).use,true);intent.finishCooperativeTrickUse(root);}
});
check('已确认的强制自火攻也不会沿用旧手动自伤豁免',()=>{
 const root=use(human,human,'huogong',false);assert.equal(evaluateWuxie(ally,req(root)).playerIntentRespected,false);assert.equal(evaluateWuxie(ally,req(root)).use,true);intent.finishCooperativeTrickUse(root);
});
check('敌方操作不会取得友方配合权限',()=>{enemy.isOnline2=()=>true;const root=use(enemy,ally);try{assert.equal(evaluateWuxie(ally,req(root)).use,true);}finally{delete enemy.isOnline2;intent.finishCooperativeTrickUse(root);}});
check('联机人类主动配合可识别',()=>{const remote=new Player('remote');remote.isOnline2=()=>true;const root=use(remote,ally);assert.equal(evaluateWuxie(ally,req(root)).use,false);intent.finishCooperativeTrickUse(root);});
check('不是同张实际用牌的上下文不能借用意图',()=>{const root=use();const r=req(root);r.info_map.card={name:'huogong'};assert.equal(evaluateWuxie(ally,r).use,true);intent.finishCooperativeTrickUse(root);});
check('虚拟牌被复制时只凭同一宿主祖先事件补关联',()=>{
 const root=use();const r=req(root);r.info_map.card={name:'huogong'};
 const result=evaluateWuxie(ally,r,{damageEvent:{name:'wuxie',parent:root}});assert.equal(result.cooperativeIntent.kind,'manual-friendly-fire');assert.equal(result.use,false);intent.finishCooperativeTrickUse(root);
});
check('目标改变不借用旧目标的配合权限',()=>{const root=use(human,human);const r=evaluateWuxie(ally,req(root,1,ally));assert.equal(r.cooperativeIntent,null);assert.equal(r.use,true);intent.finishCooperativeTrickUse(root);});
check('新局、卸载重置及事件结束不能沿用旧意图',()=>{for(const mode of ['reset','finished']){const root=use();if(mode==='reset')intent.resetCooperativeTrickIntents();else root.finished=true;assert.equal(evaluateWuxie(ally,req(root)).use,true);intent.finishCooperativeTrickUse(root);}});
check('铁索解除队友横置，响应不再按伤害保护而取消',()=>{
 ally.linked=true;const root=use(enemy,ally,'tiesuo',false);const r=evaluateWuxie(ally,req(root));assert.equal(r.resolved,true);assert(r.effectValue>0);assert.equal(r.use,false);intent.finishCooperativeTrickUse(root);ally.linked=false;
});
check('敌方将友方连入敌方传导时可保护，反无懈方向相反',()=>{
 human.linked=enemy.linked=true;const root=use(enemy,ally,'tiesuo',false);assert.equal(evaluateWuxie(ally,req(root)).use,true);assert.equal(evaluateWuxie(ally,req(root,-1)).use,false);intent.finishCooperativeTrickUse(root);human.linked=enemy.linked=false;
});
check('玩家主动连自己或队友优先尊重，仍使用铁索状态收益',()=>{
 enemy.linked=true;for(const target of [human,ally]){const root=use(human,target,'tiesuo');const r=evaluateWuxie(ally,req(root));assert.equal(r.cooperativeIntent.kind,'manual-link-plan');assert.equal(r.use,false);intent.finishCooperativeTrickUse(root);}enemy.linked=false;
});
check('玩家混合铁索的多目标结算也识别同一个实际计划',()=>{
 const root=use(human,human,'tiesuo');root.targets.push(enemy);const choice=root.parent;intent.observeCooperativeTrickUse(root,human,choice);
 const r=req(root);r.info_map.multitarget=true;const result=evaluateWuxie(ally,r);assert.equal(result.cooperativeIntent.kind,'manual-link-plan');assert.equal(result.use,false);intent.finishCooperativeTrickUse(root);
});
check('识别配合只使用响应者的身份视角',()=>{
 const root=use();const called=[];const ctx={card:root.card,source:human,target:ally,targets:[ally],effectScope:'target',originalSpellId:'huogong'};
 const r=intent.cooperativeTrickIntent(ally,ctx,(viewer,target)=>{called.push(viewer);assert.equal(viewer,ally);return 1;});assert(r);assert(called.length>0);intent.finishCooperativeTrickUse(root);
});
check('出牌与无懈复用同一个铁索状态差分，不修改真实横置',()=>{
 ally.linked=true;const card={name:'tiesuo'},ctx={originalSpellId:'tiesuo',card,source:human,target:ally,targets:[ally],effectScope:'target'};
 const before=tie.getCurrentLinkedSet(stub.game.players),action={beforeLinked:before,targets:[ally]};const delta=tie.scoreTiesuoAction(ally,action,{classicDoudizhu:true});
 assert.equal(tiesuoWuxieEffect(ally,ctx).value,delta*3);assert.equal(ally.linked,true);ally.linked=false;
});
check('多目标铁索整体算一次，不把孤立状态的目标分数相加',()=>{
 const ctx={originalSpellId:'tiesuo',card:{name:'tiesuo'},source:enemy,targets:[human,ally],effectScope:'all'};
 const delta=tie.scoreTiesuoAction(ally,{beforeLinked:new Set(),targets:[human,ally]},{classicDoudizhu:true});assert.equal(tiesuoWuxieEffect(ally,ctx).value,delta*3);
});
check('目标运输消费 evaluator 的同一选择，未选目标不再自行放行',()=>{
 human.linked=ally.linked=true;const card={name:'tiesuo'},decision=tie.hostTiesuoDecision(human,stub.game.players);
 for(const p of stub.game.players)assert.equal(tie.hostTiesuoAllowsTarget(human,p,card,stub.game.players),decision.use&&decision.targets.includes(p));
 human.canUse=()=>false;try{assert.equal(tie.hostTiesuoAllowsTarget(human,ally,card,stub.game.players),false);}finally{delete human.canUse;human.linked=ally.linked=false;}
});
check('关闭铁索专项时响应回退宿主，目标运输不接管',()=>{
 stub.lib.config['extension_无名AI_tacticalTiesuo']=false;tactical.captureTacticalSettings();const root=use(enemy,ally,'tiesuo',false);
 try{assert.equal(evaluateWuxie(ally,req(root)).resolved,false);assert.equal(tie.hostTiesuoAllowsTarget(human,ally,{name:'tiesuo'},stub.game.players),null);}finally{intent.finishCooperativeTrickUse(root);delete stub.lib.config['extension_无名AI_tacticalTiesuo'];tactical.captureTacticalSettings();}
});
check('合作意图不读取任何目标隐藏手牌',()=>{
 const root=use();const original=human.getCards;human.getCards=()=>{throw Error('hidden hand');};try{assert.equal(evaluateWuxie(ally,req(root)).use,false);}finally{human.getCards=original;intent.finishCooperativeTrickUse(root);}
});
stub.game.writeFile=()=>{};stub.game.addGlobalSkill=()=>{};stub.game.removeGlobalSkill=()=>{};
stub.get.itemtype=p=>p?.playerid?'player':'card';
stub.lib.config['extension_无名AI_playerDemonstrations']=false;
Player.prototype.useCard=function(card,targets){return {name:'useCard',player:this,card,targets,parent:stub._status.event};};
const engine=await import('../score/decision/engine/engine.js?v=41a');
check('真实引擎useCard包装捕获手动意图，卸载后凭据失效',()=>{
 const original=Player.prototype.useCard;
 stub._status.event={name:'chooseToUse',type:'phase',player:human,parent:{name:'phaseUse',player:human}};
 let root;
 try{engine.installHooks();root=human.useCard({name:'huogong'},[ally]);const r=evaluateWuxie(ally,req(root));assert.equal(r.cooperativeIntent.kind,'manual-friendly-fire');assert.equal(r.use,false);}
 finally{engine.uninstallHooks();delete stub._status.event;}
 assert.equal(Player.prototype.useCard,original);assert.equal(evaluateWuxie(ally,req(root)).cooperativeIntent,null);
});
console.log(`Trick cooperation tests: ${passed} passed, 0 failed`);

// 宿主存储模块可能保留重试定时器，断言完成后退出。
process.exit(0);
