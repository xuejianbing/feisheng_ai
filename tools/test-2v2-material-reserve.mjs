// node tools/test-2v2-material-reserve.mjs — 实际技能check材料阶段与明确主动付费窗口。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus',viewer,checks=0,capturedCheck;
class Player {
 constructor(id,side){Object.assign(this,{playerid:id,side,hp:3,maxHp:4,alive:true,hand:[],skills:[]});}
 getCards(zone){if(zone==='h'){assert.equal(this,viewer,'只能读取当前行动者手牌');return this.hand;}return [];}
 hasSkillTag(){return false;}isOnline2(){return false;}isTurnedOver(){return false;}inRange(){return true;}
}
const stub={lib:{config:{},configOL:{},element:{Player},skill:{},card:{},filter:{targetEnabled2:()=>true}},
 game:{players:[],dead:[],writeFile(){},addGlobalSkill(){},removeGlobalSkill(){}},
 get:{mode:()=>mode,config:k=>k==='versus_mode'?'two':false,name:c=>c?.name,attitude:(a,b)=>a.side===b.side?5:-5},
 _status:{mode:'two',roundNumber:1},ui:{selected:{cards:[]}},ai:{basic:{chooseCard(check){
  const event=stub._status.event;
  // 宿主选中技能后换成 info.check 再递归 chooseCard；重要的是递归入口也需接通。
  if(event.autoSkill&&!event.skill){event.skill=event.autoSkill;return this.chooseCard(stub.lib.skill[event.skill].check);}
  capturedCheck=check;
  return (event.pool||viewer.hand).map(card=>({card,score:check.call(this,card,event.pool||viewer.hand)}));
 }}}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const {versusMaterialReserve,materialReserveContext,installMaterialReserveBridge}=await import('../score/decision/modes/versus/materialReserve.js?v=41a');
const {resetCooperativeTrickIntents}=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {applyCardConsumptionUtility}=await import('../score/decision/utility/cardConsumptionUtility.js?v=41a');
const {versusDiscardPremium}=await import('../score/decision/modes/versus/resourceReserveRuntime.js?v=41a');
const {installJiedaoResponseBridge}=await import('../score/decision/response/jiedaoResponse.js?v=41a');
function check(label,fn){fn();checks++;console.log('PASS '+label);}
function reset(actor=0){
 mode='versus';stub.lib.config={};stub.ui.selected.cards=[];Object.assign(stub._status,{mode:'two',connectMode:false,auto:false});delete stub._status.brawl;
 const ps=[false,true,true,false].map((side,i)=>new Player('p'+i,side));ps.forEach((p,i)=>p.next=p.nextSeat=ps[(i+1)%4]);
 stub.game.players=ps;stub.game.dead=[];stub.game.me=ps[(actor+1)%4];viewer=ps[actor];stub._status.currentPhase=viewer;stub._status.firstAct=ps[0];
 viewer.hand=['tao','shan','wuxie','sha'].map(name=>({name}));
 stub.lib.skill.convert={enable:['chooseToUse','chooseToRespond'],viewAs:{name:'sha'},filterCard:()=>true,check:()=>4};
 stub.lib.skill.exchange={enable:'phaseUse',filterCard:true,discard:true,check:()=>4};
 stub._status.event={name:'chooseToUse',type:'phase',player:viewer,skill:'convert',parent:{name:'phaseUse',player:viewer}};
 return ps;
}
function score(card,base=4){const result=stub.ai.basic.chooseCard(()=>base);return result.find(row=>row.card===card).score;}
function withBridge(fn){const remove=installMaterialReserveBridge();try{fn();}finally{remove();}}
check('14队最后桃转杀材料进入实际AI check，同分时更愿使用普通材料',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 assert(materialReserveContext(me,stub._status.event),'合法2v2主动转化技能应该进入材料窗口');
 assert.equal(versusMaterialReserve(me,me.hand[0]).premium,2,'最后桃的材料保留压力');
 withBridge(()=>{assert.equal(score(me.hand[0]),2);assert.equal(score(me.hand[3]),4);});
});
check('23队队友紧接行动，不因其低血量给最后桃虚构行动前威胁',()=>{
 const [,me,ally]=reset(1);ally.hp=1;withBridge(()=>assert.equal(score(me.hand[0]),4));
});
check('低血时最后闪和无懈作为材料均补保留压力，非关键牌不受影响',()=>{
 const [me]=reset();me.hp=2;withBridge(()=>{assert.equal(score(me.hand[1]),2);assert.equal(score(me.hand[2]),2);assert.equal(score(me.hand[3]),4);});
});
check('主动非转化技能如制衡式选弃牌，也使用同一额外保留判断',()=>{
 const [me,,,ally]=reset();ally.hp=1;stub._status.event.skill='exchange';
 withBridge(()=>assert.equal(score(me.hand[0]),2));
});
check('动态选牌过滤和不同数量由宿主管理，不执行或改写filterCard',()=>{
 const [me,,,ally]=reset();ally.hp=1;const filter=()=>{throw Error('不能由软评分再调用原生过滤');};
 stub.lib.skill.convert.filterCard=filter;stub.lib.skill.convert.selectCard=[1,Infinity];
 withBridge(()=>assert.equal(score(me.hand[0]),2));assert.equal(stub.lib.skill.convert.filterCard,filter);
});
check('宿主递归换成skill.check后仍接通材料评分',()=>{
 const [me,,,ally]=reset();ally.hp=1;delete stub._status.event.skill;stub._status.event.autoSkill='convert';
 withBridge(()=>{const rows=stub.ai.basic.chooseCard(()=>100);assert.equal(rows[0].score,2);assert.equal(rows[3].score,4);});
});
check('一血时桃转杀应保留，桃/其他材料转为当前自疗则不被阻挡',()=>{
 const [me]=reset();me.hp=1;withBridge(()=>{
  assert.equal(score(me.hand[0]),2);stub.lib.skill.convert.viewAs={name:'tao'};
  assert.equal(score(me.hand[0]),4);assert.equal(score(me.hand[1]),4);
 });
});
check('一血时青囊式回复技能不因保留最后闪而被软评分挡住',()=>{
 const [me]=reset();me.hp=1;stub._status.event.skill='exchange';stub.lib.skill.exchange.ai={tag:{recover:1}};
 withBridge(()=>assert.equal(score(me.hand[1],1),1));
 stub.lib.skill.exchange.ai.tag.recover=()=>{throw Error('不额外执行动态回复标签');};
 withBridge(()=>assert.equal(score(me.hand[1],1),1));delete stub.lib.skill.exchange.ai;
});
check('响应、濒死、无懈与借刀响应都不新增这笔主动材料保留成本',()=>{
 const [me,,,ally]=reset();ally.hp=1;me.hp=2;
 const phase={name:'phaseUse',player:me};
 for(const event of [{name:'chooseToRespond',skill:'convert',parent:phase},
  {name:'chooseToUse',type:'respond',skill:'convert',parent:phase},
  {name:'chooseToUse',type:'dying',skill:'convert',parent:{name:'_save',dying:ally,parent:phase}},
  {name:'chooseToUse',type:'wuxie',skill:'convert',parent:phase},
  {name:'chooseToUse',type:'phase',skill:'convert',parent:{name:'jiedao',parent:phase}}]){
  stub._status.event={...event,player:me};withBridge(()=>assert.equal(score(me.hand[0]),4));
 }
});
check('强制技能/伪装成phase的内部用牌不借祖先phaseUse接管',()=>{
 const [me,,,ally]=reset();ally.hp=1;stub._status.event.forced=true;withBridge(()=>assert.equal(score(me.hand[0]),4));
 delete stub._status.event.forced;stub._status.event.parent={name:'useSkill',skill:'other',player:me,parent:{name:'phaseUse',player:me}};
 withBridge(()=>assert.equal(score(me.hand[0]),4));
});
check('明确主动技能的chooseToDiscard付费纳入软排序，强制完成不翻转正分',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 stub._status.event={name:'chooseToDiscard',player:me,forced:true,parent:{name:'exchange',player:me,parent:{name:'useSkill',skill:'exchange',player:me,parent:{name:'phaseUse',player:me}}}};
 withBridge(()=>{assert.equal(score(me.hand[0],1),.5);assert.equal(score(me.hand[0],8),6);});
});
check('明确标记消耗的chooseCard覆盖，单纯展示/选择不当成付费',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 stub._status.event={name:'chooseCard',player:me,parent:{name:'exchange',player:me,parent:{name:'phaseUse',player:me}}};
 withBridge(()=>{assert.equal(score(me.hand[0]),4);stub._status.event.lose=true;assert.equal(score(me.hand[0]),2);});
});
check('普通用牌与普通弃牌不进入材料桥，不叠加普通用牌/弃牌已有成本',()=>{
 const [me,,,ally]=reset();ally.hp=1;delete stub._status.event.skill;
 const candidate={type:'card',id:'tao',score:4};const estimate=applyCardConsumptionUtility(me,candidate,{card:me.hand[0],weight:.5});
 withBridge(()=>assert.equal(score(me.hand[0]),4));assert.equal(candidate.score,4-estimate.cost);
 stub._status.event={name:'chooseToDiscard',player:me,parent:{name:'phaseDiscard',player:me}};
 assert.equal(versusDiscardPremium(me,me.hand[0],stub._status.event),2);
 withBridge(()=>assert.equal(score(me.hand[0]),4));
});
check('两张同类牌尚有一张可留时不保护；选掉另一张后动态保护最后材料',()=>{
 const [me,,,ally]=reset();ally.hp=1;const second={name:'tao'};me.hand.push(second);
 withBridge(()=>{assert.equal(score(me.hand[0]),4);stub.ui.selected.cards=[me.hand[0]];assert.equal(score(second),2);});
});
check('多张同类牌全部已选的最终复核只扣一份，不对每张都当最后一张',()=>{
 const [me,,,ally]=reset();ally.hp=1;const second={name:'tao'};me.hand.push(second);stub.ui.selected.cards=[me.hand[0],second];
 withBridge(()=>{assert.equal(score(me.hand[0]),4);assert.equal(score(second),2);});
});
check('混合多材料分别保护最后的不同关键资源，不改变选牌集合',()=>{
 const [me]=reset();me.hp=2;const selected=[...me.hand.slice(0,3)];stub.ui.selected.cards=selected;
 withBridge(()=>{for(const card of selected)assert.equal(score(card),2);});assert.deepEqual(stub.ui.selected.cards,selected);
});
check('取消选择、手牌/血量变化后立即重读，不缓存旧的材料压力',()=>{
 const [me,,,ally]=reset();ally.hp=1;const second={name:'tao'};me.hand.push(second);stub.ui.selected.cards=[second];
 withBridge(()=>{assert.equal(score(me.hand[0]),2);stub.ui.selected.cards=[];assert.equal(score(me.hand[0]),4);me.hand.pop();ally.hp=4;assert.equal(score(me.hand[0]),4);});
});
check('强收益技能仍可消耗关键牌，软保留不是不可选标记',()=>{
 const [me,,,ally]=reset();ally.hp=1;withBridge(()=>assert.equal(score(me.hand[0],10),8));
 assert.equal(typeof stub._status.event.filterCard,'undefined');
});
check('动态viewAs与明确不消耗的展示技能保留宿主回退',()=>{
 const [me,,,ally]=reset();ally.hp=1;stub.lib.skill.convert.viewAs=()=>{throw Error('不尝试执行动态转化');};
 withBridge(()=>assert.equal(score(me.hand[0]),4));
 stub._status.event.skill='exchange';Object.assign(stub.lib.skill.exchange,{discard:false,lose:false});
 withBridge(()=>assert.equal(score(me.hand[0]),4));delete stub.lib.skill.exchange.discard;delete stub.lib.skill.exchange.lose;
});
check('宿主已确定用途的静态backup继承sourceSkill主动入口，实际材料可保留',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 stub.lib.skill.menu={enable:'chooseToUse',chooseButton:{}};
 stub.lib.skill.menu_backup={sourceSkill:'menu',viewAs:{name:'sha'},filterCard:true};stub._status.event.skill='menu_backup';
 withBridge(()=>assert.equal(score(me.hand[0]),2));
 stub.lib.skill.menu_backup.viewAs={name:'tao'};me.hp=1;withBridge(()=>assert.equal(score(me.hand[1]),4));
});
check('未知或循环sourceSkill不猜主动用途，也不陷入递归',()=>{
 const [me,,,ally]=reset();ally.hp=1;stub._status.event.skill='unknown_backup';
 stub.lib.skill.unknown_backup={sourceSkill:'absent',viewAs:{name:'sha'},filterCard:true};withBridge(()=>assert.equal(score(me.hand[0]),4));
 stub.lib.skill.unknown_backup.sourceSkill='cycle';stub.lib.skill.cycle={sourceSkill:'unknown_backup'};withBridge(()=>assert.equal(score(me.hand[0]),4));
});
check('触发技能、火攻弃牌和他人回合强制弃牌不伪装成主动技能付费',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 for(const root of [{name:'huogong',player:me},{name:'useCard',player:me},{name:'reactive',player:me}]){
  stub.lib.skill.reactive={enable:'phaseUse',trigger:{player:'damageEnd'}};
  stub._status.event={name:'chooseToDiscard',player:me,parent:{...root,parent:{name:'phaseUse',player:me}}};
  withBridge(()=>assert.equal(score(me.hand[0]),4));
 }
 stub._status.currentPhase=ally;withBridge(()=>assert.equal(score(me.hand[0]),4));
});
check('本机手动、远端玩家保持原check，托管AI可使用软保留',()=>{
 const [me,,,ally]=reset();ally.hp=1;stub.game.me=me;
 withBridge(()=>{assert.equal(score(me.hand[0]),4);stub._status.auto=true;assert.equal(score(me.hand[0]),2);me.isOnline2=()=>true;assert.equal(score(me.hand[0]),4);});
});
check('其他模式、乱斗和优化关闭完全回退',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 withBridge(()=>{
  for(const other of ['doudizhu','identity','versus']){mode=other;stub._status.mode=other==='versus'?'3v3':'two';assert.equal(score(me.hand[0]),4);}
  mode='versus';stub._status.mode='two';stub._status.brawl={};assert.equal(score(me.hand[0]),4);delete stub._status.brawl;
  stub.lib.config.extension_无名AI_tacticalOptimization=false;assert.equal(score(me.hand[0]),4);
 });
});
check('联机标识与false/0队伍使用相同公开队伍规则',()=>{
 const [me,,,ally]=reset();stub._status.mode='2v2';stub._status.connectMode=true;for(const p of stub.game.players)p.side=p.side?1:0;ally.hp=1;
 withBridge(()=>assert.equal(score(me.hand[0]),2));
});
check('他人手牌、他人材料与不在本人手中的虚拟对象不能获得材料判断',()=>{
 const [me,enemy,,ally]=reset();ally.hp=1;enemy.getCards=ally.getCards=()=>{throw Error('隐藏手牌');};
 assert.equal(versusMaterialReserve(me,{name:'tao'}).premium,0);withBridge(()=>assert.equal(score(me.hand[0]),2));
});
check('嵌套安装不重复扣同一材料；卸载不覆盖后装包装器',()=>{
 const [me,,,ally]=reset();ally.hp=1;const original=stub.ai.basic.chooseCard,remove1=installMaterialReserveBridge(),remove2=installMaterialReserveBridge();
 try{assert.equal(score(me.hand[0]),2);remove1();assert.equal(score(me.hand[0]),2);}finally{remove2();}
 // 外层卸载先恢复失效内层；失效包装保留原分，不会再扣。
 assert.equal(score(me.hand[0]),4);stub.ai.basic.chooseCard=original;
});
check('换局、结束、事件切换和卸载使旧评分闭包失效',()=>{
 const [me,,,ally]=reset();ally.hp=1;const original=stub.ai.basic.chooseCard,remove=installMaterialReserveBridge();
 let old;try{
  score(me.hand[0]);old=capturedCheck;assert.equal(old(me.hand[0]),2);
  stub._status.event.finished=true;assert.equal(old(me.hand[0]),4);delete stub._status.event.finished;
  resetCooperativeTrickIntents();assert.equal(old(me.hand[0]),4);
  score(me.hand[0]);old=capturedCheck;stub._status.event={...stub._status.event};assert.equal(old(me.hand[0]),4);
  score(me.hand[0]);old=capturedCheck;
 }finally{remove();}
 assert.equal(old(me.hand[0]),4);assert.equal(stub.ai.basic.chooseCard,original);
});
check('非有限原分、非函数check、未知材料和接口异常保留原生回退',()=>{
 const [me,,,ally]=reset();ally.hp=1;withBridge(()=>{
  assert(Number.isNaN(score(me.hand[0],NaN)));assert.equal(score(me.hand[0],Infinity),Infinity);
  assert.throws(()=>stub.ai.basic.chooseCard(null),TypeError);
  me.getCards=()=>{throw Error('own hand unavailable');};assert.equal(score(me.hand[0]),4);
 });
});
check('软桥保留原check的this、其他参数及宿主返回结果形态',()=>{
 const [me,,,ally]=reset();ally.hp=1;withBridge(()=>{
  const rows=stub.ai.basic.chooseCard(function(card,pool){assert.equal(this,stub.ai.basic);assert.equal(pool,me.hand);return 4;});
  assert.equal(rows.length,me.hand.length);assert.equal(rows[0].card,me.hand[0]);assert.equal(rows[0].score,2);
 });
});
check('与现有借刀材料桥叠放时，普通主动材料仍生效、借刀响应仍由原桥处理',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 Player.prototype.chooseToUse=function(){return {};};
 const removeResponse=installJiedaoResponseBridge(),removeMaterial=installMaterialReserveBridge();
 try{assert.equal(score(me.hand[0]),2);}finally{removeMaterial();removeResponse();}
});
const engine=await import('../score/decision/engine/engine.js?v=41a');
check('实际引擎安装/卸载连接材料桥，不修改全局skill.check',()=>{
 const [me,,,ally]=reset();ally.hp=1;const original=stub.ai.basic.chooseCard,skillCheck=stub.lib.skill.convert.check;
 try{engine.installHooks();assert.equal(score(me.hand[0]),2);assert.equal(stub.lib.skill.convert.check,skillCheck);}
 finally{engine.uninstallHooks();}
 assert.equal(stub.ai.basic.chooseCard,original);assert.equal(score(me.hand[0]),4);
});
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 skill material and payment reserve');
process.exit(0);
