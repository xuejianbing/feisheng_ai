// node tools/test-2v2-resource-reserve.mjs — 留牌、统一成本、实际弃牌/响应桥及救援事实。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus',viewer=null,checks=0;
const errors=[];
class GameEvent {
 constructor(name,player=null,manager={}){Object.assign(this,{name,player,manager,after:[],handlers:[],ai:()=>-3});}
 pushHandler(handler){this.handlers.push(handler);}
 setContent(content){this.content=content;}
 begin(){for(const handler of this.handlers)handler(this,{state:'begin'});}
}
class Player {
 constructor(id,side){Object.assign(this,{playerid:id,name:'same',side,hp:3,maxHp:4,alive:true,hand:[],range:1,skills:[]});}
 getCards(zone){if(zone==='h'||zone==='hs'){assert.equal(this,viewer,'不能读取其他玩家隐藏手牌');return this.hand;}return [];}
 countCards(zone,filter){const cards=zone==='h'||zone==='hs'?this.hand:[];return typeof filter==='function'?cards.filter(filter).length:typeof filter==='string'?cards.filter(c=>c.name===filter).length:cards.length;}
 getAttackRange(){return this.range;}inRange(other){const n=stub.game.players.length,d=Math.abs(stub.game.players.indexOf(this)-stub.game.players.indexOf(other));return Math.min(d,n-d)<=this.range;}
 getEquip(){return null;}hasSkill(){return false;}hasSkillTag(){return false;}isTurnedOver(){return false;}isOnline2(){return false;}
 addSkill(id){this.skills.push(id);}removeSkill(id){this.skills=this.skills.filter(s=>s!==id);}
 // Host constructor returns an event; the native engine asks its ai only after begin.
 chooseToDiscard(){
  const event=new GameEvent('chooseToDiscard',this);
  event.parent=stub._status.event;
  return event;
 }
 chooseToRespond(){
  const event=new GameEvent('chooseToRespond',this);
  event.parent=stub._status.event;
  event.filterCard=event.parent.filterCard;
  return event;
 }
}
const stub={lib:{config:{},configOL:{},element:{Player,GameEvent},skill:{},card:{},filter:{targetEnabled2:()=>true}},
 game:{players:[],dead:[]},get:{mode:()=>mode,config:k=>k==='versus_mode'?'two':false,name:c=>c?.name,
 value:()=>3,subtypes:()=>[],suit:c=>c.suit||'heart',type:()=> 'basic',tag:()=>0,attitude:(a,b)=>a.side===b.side?5:-5},
 _status:{mode:'two',roundNumber:1},ui:{selected:{cards:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{swallow:e=>errors.push(e.message)}};
register('./noname-stub-loader.mjs',import.meta.url);
const reserve=await import('../score/decision/modes/versus/resourceReserveRuntime.js?v=41a');
const {resourceReserve}=await import('../score/decision/modes/versus/resourceReserve.js?v=41a');
const consumption=await import('../score/decision/utility/cardConsumptionUtility.js?v=41a');
const discard=await import('../score/decision/override/discard.js?v=41a');
const respond=await import('../score/decision/override/respond.js?v=41a');
const response=await import('../score/decision/cardplay/responseAI.js?v=41a');
const {evaluateTaoRescue}=await import('../score/decision/safety/rescuePolicy.js?v=41a');
const {estimateWuxieResourceCost}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function reset(acting=0){
 mode='versus';stub.lib.config={};Object.assign(stub._status,{mode:'two',roundNumber:1,connectMode:false});
 delete stub._status.brawl;delete stub._status.replacetwo;stub.ui.selected.cards=[];
 const ps=[false,true,true,false].map((side,i)=>new Player('p'+i,side));
 ps.forEach((p,i)=>p.next=p.nextSeat=ps[(i+1)%4]);stub.game.players=ps;stub.game.dead=[];
 stub.game.me=ps[(acting+1)%4];viewer=ps[acting];stub._status.currentPhase=viewer;stub._status.firstAct=ps[0];
 stub._status.event={name:'phaseUse',player:viewer};viewer.hand=['tao','shan','wuxie','sha','guohe'].map(name=>({name}));return ps;
}
function cost(me,id,extra={}){
 return consumption.evaluateCardConsumptionCost(me,{type:'card',id,score:2},
  {card:me.hand.find(c=>c.name===id),weight:.5,econ:{handCount:5,hpRatio:.75},...extra});
}
check('14队一号最后桃根据四号行动前的危险保留',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 const r=reserve.readResourceReserve(me,me.hand[0]);assert.equal(r.factor,1.4);assert.equal(r.discardPremium,2);
 const estimate=cost(me,'tao');assert.equal(estimate.selectedEstimate,'versus-reserve');
 assert.equal(estimate.cost,estimate.reserveCost);assert.equal(estimate.reserveCost,estimate.baseCost*1.4);
});
check('23队二号队友立即行动，不凭低血量额外假定行动前危险',()=>{
 const [,me,ally]=reset(1);ally.hp=1;
 assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
});
check('最后闪只根据自己防守需要，不冒充可救队友',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 assert.equal(reserve.readResourceReserve(me,me.hand[1]).factor,1);
 me.hp=2;assert.equal(reserve.readResourceReserve(me,me.hand[1]).factor,1.4);
});
check('无懈在队伍危险时保留，但不改变现有响应成本算法',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 assert.equal(reserve.readResourceReserve(me,me.hand[2]).factor,1.4);
 const before=estimateWuxieResourceCost(me,{});
 stub.lib.config['extension_无名AI_tacticalOptimization']=false;
 assert.equal(estimateWuxieResourceCost(me,{}),before);
});
check('多张资源、队友健康、敌人够不到时不新增保留成本',()=>{
 const [me,b,c,ally]=reset();ally.hp=1;me.hand.push({name:'tao'});
 assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 me.hand.pop();ally.hp=4;assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 ally.hp=1;b.range=c.range=0;assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
});
check('自己一血时不为留桃增加自疗成本；强收益自疗仍有机会',()=>{
 const [me,,,ally]=reset();ally.hp=1;me.hp=1;
 assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 assert.equal(cost(me,'tao').reserveCost,0);
 assert.equal(response._shouldSaveTao(me,me),false);
});
check('濒死与响应窗口不新增主动留牌成本',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 for(const event of [{name:'chooseToUse',type:'dying',dying:ally,parent:{name:'phaseUse',player:me}},{name:'chooseToRespond'}, {name:'phaseDraw',player:me}]){
  stub._status.event=event;assert.equal(cost(me,'tao').reserveCost,0);
 }
});
check('保留与基础、预测成本取max，消耗来源只扣一次',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 const a={type:'card',id:'tao',score:4};const estimate=consumption.applyCardConsumptionUtility(me,a,{card:me.hand[0],weight:.5,forecastRetention:3});
 assert.equal(estimate.cost,Math.max(estimate.baseCost,estimate.retentionCost,estimate.forecastCost,estimate.reserveCost));
 assert.equal(a.score,4-estimate.cost);const after=a.score;
 assert.equal(consumption.applyCardConsumptionUtility(me,a,{}).applied,false);assert.equal(a.score,after);
});
check('成本权重为零不制造额外2v2成本，未知卡不虚构资源',()=>{
 const [me,,,ally]=reset();ally.hp=1;assert.equal(cost(me,'tao',{weight:0}).reserveCost,0);
 assert.equal(reserve.readResourceReserve(me,{name:'tao'}).factor,1);
 assert.equal(cost(me,'sha').reserveCost,0);
});
check('弃牌阶段是软保留，响应/技能成本不套用该弃牌偏好',()=>{
 const [me,,,ally]=reset();ally.hp=1;const card=me.hand[0];
 const ev={name:'phaseDiscard',player:me};assert.equal(reserve.versusDiscardPremium(me,card,ev),2);
 assert.equal(reserve.versusDiscardPremium(me,card,{name:'skill',player:me}),0);
 assert.equal(reserve.versusDiscardPremium(me,card,{name:'phaseDiscard',player:ally}),0);
});
check('多张同类牌在连续弃选后保护剩余最后一张',()=>{
 const [me,,,ally]=reset();ally.hp=1;const second={name:'tao'};me.hand.push(second);
 const ev={name:'phaseDiscard',player:me};assert.equal(reserve.versusDiscardPremium(me,second,ev),0);
 stub.ui.selected.cards=[me.hand[0]];assert.equal(reserve.versusDiscardPremium(me,second,ev),2);
 assert.equal(reserve.versusDiscardPremium(me,me.hand[0],ev),0);
});
check('真实弃牌接管消费同一保留偏好，不新增不可弃规则',()=>{
 const [me,,,ally]=reset();ally.hp=1;discard.installDiscardOverride();
 try{
  stub._status.event={name:'phaseDiscard',player:me,ai:{}};
  const choice=me.chooseToDiscard();stub._status.event=choice;choice.begin();
  const score=choice.ai(me.hand[0]);
  assert(Number.isFinite(score));
  stub.lib.config['extension_无名AI_tacticalOptimization']=false;
  stub._status.event={name:'phaseDiscard',player:me,ai:{}};
  const native=me.chooseToDiscard();stub._status.event=native;native.begin();
  const base=native.ai(me.hand[0]);
  assert.equal(score,base-2);
  assert.equal(choice.after.length,1,'运行时应登记原生完成后的清理回调');
 }finally{discard.uninstallDiscardOverride();}
});
check('同回合手牌、队友血量、距离变化立即更新，不读其隐藏手牌',()=>{
 const [me,b,c,ally]=reset();ally.hp=1;
 for(const p of [b,c,ally])p.getCards=()=>{throw Error('hidden hand');};
 assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1.4);
 ally.hp=4;assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 ally.hp=1;c.range=0;assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 c.range=1;me.hand.push({name:'tao'});assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
});
check('需要两桃但只有一桃，不据此断言救不活或拒救',()=>{
 const [me,,,ally]=reset();ally.hp=-1;
 const r=evaluateTaoRescue(me,ally);assert.equal(r.allow,true);
 assert.equal(r.rescueFacts.requiredHealing,2);assert.equal(r.rescueFacts.ownPhysicalTaoCount,1);
 assert.equal(r.rescueFacts.ordinaryTaoShortfall,1);
});
check('队友受到我方伤害后仍能救，同名武将也不误用伤害日志',()=>{
 const [me,,,ally]=reset();ally.hp=0;
 window.__DJSC._djscKnockdownLog=[{t:ally.name,s:me.name,ts:Date.now()}];
 assert.equal(respond._keepTao(me,ally),false);
 assert.equal(response._shouldSaveTao(me,ally,{dyingTarget:ally}),false);
 delete window.__DJSC._djscKnockdownLog;
});
check('敌方濒死仍拒救，自己濒死仍允许，目标不匹配仍拒绝',()=>{
 const [me,enemy,,ally]=reset();enemy.hp=0;me.hp=0;ally.hp=0;
 assert.equal(evaluateTaoRescue(me,enemy).allow,false);assert.equal(respond._keepTao(me,enemy),true);
 assert.equal(evaluateTaoRescue(me,me).allow,true);
 assert.equal(evaluateTaoRescue(me,ally,{dyingTarget:enemy}).allow,false);
});
check('真实救援事件解析父链，不从普通受伤角色猜目标',()=>{
 const [me,,,ally]=reset();ally.hp=0;
 assert.equal(reserve.dyingTargetForEvent({name:'chooseToUse',parent:{name:'_save',dying:ally}}),ally);
 assert.equal(reserve.dyingTargetForEvent({name:'chooseToUse',parent:{name:'dying',player:ally}}),ally);
 assert.equal(reserve.dyingTargetForEvent({name:'damage',target:ally}),null);
 assert.equal(reserve.dyingTargetForEvent({dying:[ally]}),null);
});
check('真实响应接管：队友救援与自救不被brain目标识别挡住',()=>{
 const [me,enemy,,ally]=reset();respond.installRespondOverride();
 try{
  for(const target of [ally,me,enemy]){
   target.hp=0;
   stub._status.event={name:'chooseToRespond',parent:{name:'_save',dying:target},filterCard:c=>c.name==='tao'};
   const choice=me.chooseToRespond(me.hand[0]);choice.begin();
   assert.equal(choice.filterCard(me.hand[0],me,choice),target!==enemy);
   target.hp=3;
  }
 }finally{respond.uninstallRespondOverride();}
});
check('低血和高血的当前合法闪响应不再被留闪逻辑一刀切过滤',()=>{
 const [me,enemy]=reset();respond.installRespondOverride();
 try{
  for(const hp of [1,3]){
   me.hp=hp;stub._status.event={name:'chooseToRespond',parent:{_trigger:{card:{name:'sha'},target:me,player:enemy}},filterCard:c=>c.name==='shan'};
   const choice=me.chooseToRespond(me.hand[1]);choice.begin();
   assert.equal(choice.filterCard(me.hand[1],me,choice),true);
  }
 }finally{respond.uninstallRespondOverride();}
});
check('被动响应标签不屏蔽出闪，主动自疗不重复套固定留桃惩罚',()=>{
 const [me]=reset();response.installResponseAI();
 try{
  me.hp=1;assert.notEqual(stub.lib.skill._djsc_responseAI.ai.skillTagFilter(me,'respondShan'),false);
  me.hp=3;assert.equal(response._shouldSaveTao(me,me),false);
 }finally{response.uninstallResponseAI();}
});
check('其他模式保留旧策略，乱斗、开关、缺失队伍不进入新留牌',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 mode='doudizhu';assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 assert.equal(cost(me,'tao').reserveCost,0);assert.equal(response._shouldSaveTao(me,me),true);
 mode='versus';stub._status.brawl={submode:'two'};assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
 delete stub._status.brawl;delete ally.side;assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1);
});
check('联机、换边与资源不足不会改变公开队伍规则',()=>{
 const [me,enemy,,ally]=reset();stub._status.mode='2v2';stub._status.connectMode=true;
 for(const p of stub.game.players)p.side=!p.side;ally.hp=1;
 assert.equal(reserve.readResourceReserve(me,me.hand[0]).factor,1.4);
 ally.hp=-2;me.hand=me.hand.filter(c=>c.name!=='tao');
 assert.equal(evaluateTaoRescue(me,ally).allow,true);
 assert.equal(evaluateTaoRescue(me,ally).rescueFacts.requiredHealing,3);
 assert.equal(evaluateTaoRescue(me,enemy).allow,false);
});
check('原生合法性过滤仍可拒绝禁桃，修复不强迫使用受禁牌',()=>{
 const [me,,,ally]=reset();ally.hp=0;respond.installRespondOverride();
 try{
  stub._status.event={name:'chooseToRespond',dying:ally,filterCard:()=>false};
  const choice=me.chooseToRespond(me.hand[0]);choice.begin();
  assert.equal(choice.filterCard(me.hand[0],me,choice),false);
 }finally{respond.uninstallRespondOverride();}
});
check('纯函数保留偏好有界，不把无牌或多牌当最后一张',()=>{
 for(const count of [0,2,3])assert.equal(resourceReserve({id:'tao',count,selfHp:3,allyHp:1,allyThreats:2}).factor,1);
 const r=resourceReserve({id:'tao',count:1,selfHp:3,allyHp:1,allyThreats:2});
 assert.equal(r.factor,1.4);assert.equal(r.discardPremium,2);
});
assert.deepEqual(errors,[],'生产测试不得静默吞错');
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 resource reserve and rescue');
