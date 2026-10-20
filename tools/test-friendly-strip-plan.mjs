import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,identity='fan'){this.playerid=id;this.identity=identity;this.hp=2;this.maxHp=4;this.hand=[];this.equip=[];this.judge=[];}
 getCards(z){return z==='h'?this.hand:z==='e'?this.equip:z==='j'?this.judge:[];}
 countCards(z){return this.getCards(z).length;}hasSkill(){return false;}hasSkillTag(){return false;}
 canUse(){return true;}getEquip(){return null;}
}
const p=new Player('actor'),ally=new Player('ally'),enemy=new Player('enemy','zhu');
let recovery=2,current;
const stub={lib:{config:{},card:{guohe:{ai:{button:()=>5}},shunshou:{ai:{button:()=>5}}},skill:{},filter:{cardEnabled:()=>true,cardUsable:()=>true,canBeDiscarded:c=>!c.lockDiscard,canBeGained:c=>!c.lockGain},element:{Player}},game:{players:[p,ally,enemy],me:enemy,dead:[],addGlobalSkill(){}},get:{mode:()=> 'doudizhu',name:c=>c?.name,value:c=>c.value??4,recoverEffect:()=>recovery,attitude:(a,b)=>a.identity===b.identity?5:-5,position:c=>c.zone,event:()=>current,effect:()=>1},_status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {friendlyStripPlan}=await import('../score/decision/strategy/friendlyStripPlan.js?v=41a');
const {actionValue,directionScore}=await import('../score/decision/relations/relations.js?v=41a');
const {vetoCard,pickTarget}=await import('../score/decision/cardplay/cardPlayBrain.js?v=41a');
tactical.captureTacticalSettings();tactical.installTacticalOptimization();
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
const lion={name:'baiyin',zone:'e'},good={name:'bagua',zone:'e'};ally.equip=[lion,good];
const card={name:'guohe'};p.hand=[card];
const target={pp:ally,isAlly:true,isJudge:false,hp:ally.hp,equipVal:10};
const strategy=(id,t)=>tactical.stripPlan(p,{name:id},t.pp);
check('目标评分、基本否决、方向评分与具体选牌承认同一白银计划',()=>{
 for(const name of ['guohe','shunshou']){
  const plan=tactical.stripPlan(p,{name},ally);assert.equal(plan.kind,'lion-recovery');assert.equal(plan.card,lion);
  assert.equal(vetoCard(name,{stripStrategy:strategy},target).veto,false);
  assert.equal(pickTarget(name,{targets:[target],stripStrategy:strategy}).index,0);
  const action={id:name,targetObj:ally,base:4};assert.equal(actionValue(p,action),4);assert.equal(directionScore(p,action,ally),1);
  current={player:p,target:ally};assert(stub.lib.card[name].ai.button({link:lion})>stub.lib.card[name].ai.button({link:good}));
 }
});
check('没有回血收益、满血或装备损失更大均不主动拆队友',()=>{
 for(const [hp,r,cost] of [[4,2,4],[2,0,4],[2,-1,4],[2,2,8],[2,NaN,4]]){
  ally.hp=hp;recovery=r;lion.value=cost;assert.equal(strategy('guohe',target),null);
  assert.equal(vetoCard('guohe',{stripStrategy:strategy},target).veto,true);
  assert.equal(pickTarget('guohe',{targets:[target],stripStrategy:strategy}).index,-1);
  assert.equal(actionValue(p,{id:'guohe',targetObj:ally,base:4}),-8);
 }ally.hp=2;recovery=2;delete lion.value;
});
check('拆和拿分别校验宿主合法性，不借用另一张锦囊权限',()=>{
 lion.lockDiscard=true;assert.equal(strategy('guohe',target),null);assert(strategy('shunshou',target));delete lion.lockDiscard;
 lion.lockGain=true;assert(strategy('guohe',target));assert.equal(strategy('shunshou',target),null);delete lion.lockGain;
});
check('优先合法兵乐救援并准确选择viewAs判定牌',()=>{
 const judge={name:'sha',viewAs:'lebu',zone:'j'};ally.judge=[judge];
 assert.equal(strategy('guohe',target).card,judge);current={player:p,target:ally};assert(stub.lib.card.guohe.ai.button({link:judge})>stub.lib.card.guohe.ai.button({link:lion}));
 judge.lockDiscard=true;assert.equal(strategy('guohe',target).card,lion);ally.judge=[];
});
check('选牌时重新复核当前状态，不携带旧事件或旧装备计划',()=>{
 current={player:p,target:ally};assert.equal(stub.lib.card.guohe.ai.button({link:lion}),30);
 ally.equip=[good];assert.equal(stub.lib.card.guohe.ai.button({link:lion}),5);
 ally.equip=[lion];ally.hp=4;assert.equal(stub.lib.card.guohe.ai.button({link:lion}),5);ally.hp=2;
});
check('不读队友和敌方隐藏手牌',()=>{
 const original=ally.getCards;ally.getCards=z=>{if(z==='h')throw Error('hidden');return original.call(ally,z);};
 try{assert(strategy('guohe',target));}finally{ally.getCards=original;}
});
check('宿主回复异常安全放弃计划',()=>{
 const original=stub.get.recoverEffect;stub.get.recoverEffect=()=>{throw Error('unsupported');};try{assert.equal(strategy('guohe',target),null);}finally{stub.get.recoverEffect=original;}
});
check('救判定与拆顺专项开关独立生效，设置下局捕获',()=>{
 const judge={name:'bingliang',zone:'j'};ally.judge=[judge];
 stub.lib.config.extension_无名AI_tacticalJudgeRescue=false;assert.equal(strategy('guohe',target).kind,'rescue');tactical.captureTacticalSettings();assert.equal(strategy('guohe',target).kind,'lion-recovery');
 stub.lib.config.extension_无名AI_tacticalStrip=false;tactical.captureTacticalSettings();assert.equal(strategy('guohe',target),undefined);
 assert.equal(vetoCard('guohe',{stripStrategy:strategy},{...target,isJudge:true}).veto,false);
 stub.lib.config.extension_无名AI_tacticalJudgeRescue=true;tactical.captureTacticalSettings();assert.equal(strategy('guohe',target).kind,'rescue');
 ally.judge=[];stub.lib.config.extension_无名AI_tacticalStrip=true;tactical.captureTacticalSettings();
});
check('总开关关闭回退原规则，不新增白银通行证',()=>{
 stub.lib.config.extension_无名AI_tacticalOptimization=false;tactical.captureTacticalSettings();assert.equal(friendlyStripPlan(p,card,ally),undefined);assert.equal(actionValue(p,{id:'guohe',targetObj:ally,base:4}),-8);
 delete stub.lib.config.extension_无名AI_tacticalOptimization;tactical.captureTacticalSettings();
});
check('宿主不允许目标时不生成可执行计划',()=>{
 const original=p.canUse;p.canUse=()=>false;try{assert.equal(strategy('guohe',target),null);}finally{p.canUse=original;}
});
check('禁判定能力不误封白银回复，保护判定牌不作为救援凭据',()=>{
 const judge={name:'lebu',zone:'j',lockDiscard:true};ally.judge=[judge];assert.equal(strategy('guohe',target).kind,'lion-recovery');
 ally.hasSkillTag=tag=>tag==='nojudge';judge.lockDiscard=false;assert.equal(strategy('guohe',target).kind,'lion-recovery');
 ally.judge=[];delete ally.hasSkillTag;
});
check('有明确低风险斩杀时不把拆队友抬到前面，结算选牌仍识别计划',()=>{
 const saved=p.hand;p.hand=[card,{name:'sha'}];enemy.hp=1;
 try{assert.equal(strategy('guohe',target),null);assert.equal(tactical.stripPlan(p,card,ally,true).kind,'lion-recovery');}
 finally{p.hand=saved;enemy.hp=2;}
});
check('已安装宿主effect入口消费相同计划',()=>{
 const plan=strategy('guohe',target),effect=stub.lib.skill._djsc_tacticalOptimization.ai.effect.player(card,p,ally);
 assert.deepEqual(effect,[1,plan.score/5,1,0]);
});
const {guardCheck}=await import('../score/model/net/modelGuard.js?v=41a');
check('最终模型护栏也消费白银净收益计划，不再按友方非判定一律拦截',()=>{
 const action={id:'guohe',type:'card',target:'ally',targetObj:ally,score:4};
 assert.equal(guardCheck(p,action,{}).ok,true);
 ally.hp=4;assert.equal(guardCheck(p,action,{}).ok,false);ally.hp=2;
 lion.lockDiscard=true;assert.equal(guardCheck(p,action,{}).ok,false);delete lion.lockDiscard;
});
check('最终护栏的兵乐救援与原生公开判定区保持一致',()=>{
 const judge={name:'lebu',zone:'j'};ally.judge=[judge];ally.equip=[];
 const action={id:'shunshou',type:'card',target:'ally',targetObj:ally,score:4};
 assert.equal(guardCheck(p,action,{}).ok,true);judge.lockGain=true;assert.equal(guardCheck(p,action,{}).ok,false);
 ally.judge=[];ally.equip=[lion];
});
console.log(`Friendly strip tests: ${n} passed, 0 failed`);
