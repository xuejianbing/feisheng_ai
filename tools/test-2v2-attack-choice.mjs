// node tools/test-2v2-lethal.mjs — 实体攻击、防御/救援不确定性与实际优先级规则。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus',viewer,checks=0;
class Player {
 constructor(id,side){Object.assign(this,{playerid:id,side,hp:3,maxHp:4,hujia:0,alive:true,hand:[],publicHand:0,equip:{},skills:[],tags:[],awakenedSkills:[]});}
 getCards(zone){if(zone==='h'){assert.equal(this,viewer,'不能读取其他玩家隐藏手牌');return this.hand;}return zone==='e'?Object.values(this.equip):[];}
 countCards(zone,filter){assert.equal(filter,undefined,'只允许公开手牌总数');return zone==='h'?this.publicHand:0;}
 getEquip(slot){return this.equip[slot];}getSkills(){return this.skills;}hasSkill(id){return this.skills.includes(id);}hasSkillTag(tag){return this.tags.includes(tag);}
 isAlive(){return this.alive;}canUse(card,target){return !card.blocked&&!target.outOfRange&&target.alive;}isTurnedOver(){return false;}
}
const stub={lib:{config:{},configOL:{},skill:{},card:{},filter:{cardEnabled:c=>!c.disabled,cardUsable:c=>!c.exhausted}},
 game:{players:[],dead:[]},get:{mode:()=>mode,config:key=>key==='versus_mode'?'two':false,name:c=>c?.name,color:c=>c.color,
 effect:target=>target.effect??1,attitude:(a,b)=>a.side===b.side?5:-5},_status:{mode:'two',roundNumber:1},ui:{selected:{cards:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {attackChoiceValue,installAttackChoiceBridge}=await import('../score/decision/modes/versus/attackChoiceBridge.js?v=41a');
const {resetCooperativeTrickIntents}=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
stub.get.select=value=>typeof value==='number'?[value,value]:typeof value==='function'?value():value;
stub.get.info=()=>({selectTarget:1});
stub.get.nature=c=>c.modifiedNature??c.nature;
let selected,callback,receiver,argsSeen;
const nativeCard=function(check,...args){callback=check;receiver=this;argsSeen=args;const scored=viewer.hand.map(c=>[c,check.call(this,c)]);selected=scored.sort((a,b)=>b[1]-a[1])[0];return selected;};
const nativeTarget=function(check){callback=check;return stub.game.players.slice(1,3).map(t=>[t,check(t)]).sort((a,b)=>b[1]-a[1])[0];};
stub.ai.basic={chooseCard:nativeCard,chooseTarget:nativeTarget};
function reset(){
 mode='versus';Object.assign(stub._status,{mode:'two',connectMode:false,auto:true});delete stub._status.brawl;
 const ps=[false,true,true,false].map((s,i)=>new Player('p'+i,s));viewer=ps[0];viewer.hand=[{name:'sha',color:'black'},{name:'sha',color:'red'}];
 stub.game.players=ps;stub.game.me=viewer;stub._status.currentPhase=viewer;
 stub.ui.selected={cards:[],targets:[]};
 stub._status.event={name:'chooseToUse',type:'phase',player:viewer,selectCard:[1,1],filterCard:c=>!c.filtered,filterTarget:(_c,_p,t)=>t!==ps[2]&&!t.filtered,parent:{name:'phaseUse',player:viewer}};
 return ps;
}
function check(name,fn){fn();checks++;console.log('PASS '+name);}
const cleanup=installAttackChoiceBridge();
check('仁王盾实际选择红杀，黑杀不能借红杀伤害评分',()=>{
 const [me,target]=reset();target.equip[2]={name:'renwang'};target.hp=1;
 const result=stub.ai.basic.chooseCard(()=>5);assert.equal(result[0],me.hand[1]);assert.equal(attackChoiceValue(me,me.hand[0]),0);
});
check('藤甲优先实际火杀，支持宿主公开属性修改',()=>{
 const [me,target]=reset();target.equip[2]={name:'tengjia'};me.hand[1].modifiedNature='fire';
 assert.equal(stub.ai.basic.chooseCard(()=>5)[0],me.hand[1]);assert(attackChoiceValue(me,me.hand[1])>0);
});
check('实际目标以已选实体牌重算，不能借另一张红杀',()=>{
 const [me,a,b]=reset();a.equip[2]={name:'renwang'};a.hp=1;b.hp=2;
 stub._status.event.filterTarget=()=>true;stub.ui.selected.cards=[me.hand[0]];
 assert.equal(stub.ai.basic.chooseTarget(()=>5)[0],b);
 stub.ui.selected.cards=[me.hand[1]];assert.equal(stub.ai.basic.chooseTarget(()=>5)[0],a);
});
check('防具、距离与目标合法性变化实时复核',()=>{
 const [me,a,b]=reset();stub._status.event.filterTarget=()=>true;stub.ui.selected.cards=[me.hand[0]];
 a.hp=1;b.hp=2;assert.equal(stub.ai.basic.chooseTarget(()=>5)[0],a);
 a.equip[2]={name:'renwang'};assert.equal(stub.ai.basic.chooseTarget(()=>5)[0],b);
 a.equip={};a.outOfRange=true;assert.equal(attackChoiceValue(me,me.hand[0],stub._status.event,a),null);
 a.outOfRange=false;a.filtered=true;stub._status.event.filterTarget=(_c,_p,t)=>!t.filtered;
 assert.equal(attackChoiceValue(me,me.hand[0],stub._status.event,a),null);
});
check('卡牌离手或宿主筛选失败时不保留旧估值',()=>{
 const [me]=reset();const c=me.hand[1];c.filtered=true;assert.equal(attackChoiceValue(me,c),null);
 c.filtered=false;me.hand.pop();assert.equal(attackChoiceValue(me,c),null);
});
check('普通决斗逐实体使用同一评估',()=>{
 const [me]=reset();me.hand=[{name:'juedou'}];assert(Number.isFinite(attackChoiceValue(me,me.hand[0])));
});
check('原生负分、零分、非有限分与this参数保持',()=>{
 reset();const token={};stub.ai.basic.chooseCard.call(token,()=>-7,'extra');assert.equal(selected[1],-7);assert.equal(receiver,token);assert.deepEqual(argsSeen,['extra']);
 stub.ai.basic.chooseCard(()=>0);assert.equal(selected[1],0);stub.ai.basic.chooseCard(()=>NaN);assert(Number.isNaN(selected[1]));
});
check('转化技能材料与虚拟牌保留宿主评分',()=>{
 const [me]=reset();stub._status.event.skill='wusheng';assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 delete stub._status.event.skill;assert.equal(attackChoiceValue(me,{name:'sha',cards:[me.hand[0]]}),null);
});
check('多张牌与多目标需求保持宿主评分',()=>{
 reset();stub._status.event.selectCard=[2,2];assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 stub._status.event.selectCard=[1,1];stub._status.event.selectTarget=[1,2];assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
});
check('响应、强制用牌及技能插入窗口不接管',()=>{
 reset();stub._status.event.type='respond';assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 stub._status.event.type='phase';stub._status.event.forced=true;assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 stub._status.event.forced=false;stub._status.event.parent={name:'useSkill',player:viewer};assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
});
check('手动玩家、远端玩家与其他模式保持原生',()=>{
 reset();stub._status.auto=false;assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 stub._status.auto=true;viewer.isOnline2=()=>true;assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 viewer.isOnline2=()=>false;mode='identity';assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
});
check('完成、换事件与局次变化后旧评分回退',()=>{
 reset();stub.ai.basic.chooseCard(()=>9);const old=callback;stub._status.event.finished=true;assert.equal(old(viewer.hand[0]),9);
 reset();stub.ai.basic.chooseCard(()=>9);const changed=callback;reset();assert.equal(changed(viewer.hand[0]),9);
 stub.ai.basic.chooseCard(()=>9);const epoch=callback;resetCooperativeTrickIntents();assert.equal(epoch(viewer.hand[0]),9);
});
check('评估异常保持原生评分，后续可恢复',()=>{
 const [me,target]=reset();const native=target.getEquip;target.getEquip=()=>{throw Error('probe');};assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 target.getEquip=native;assert(Number.isFinite(attackChoiceValue(me,me.hand[1])));
});
check('宿主默认目标范围按当前实体牌及修正检查，多目标技能回退',()=>{
 const [me]=reset();stub.lib.filter.selectTarget=()=>{throw Error('must not read selected card');};
 stub._status.event.selectTarget=stub.lib.filter.selectTarget;
 assert(Number.isFinite(attackChoiceValue(me,me.hand[1])));
 stub.game.checkMod=(_c,_p,range)=>{range[1]=2;};assert.equal(attackChoiceValue(me,me.hand[1]),null);
 delete stub.game.checkMod;
});
check('异常选择范围和未确认自定义目标函数不接管',()=>{
 reset();stub._status.event.selectCard=()=>{throw Error('range unavailable');};assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
 stub._status.event.selectCard=[1,1];stub._status.event.selectTarget=()=>[1,1];assert.equal(stub.ai.basic.chooseCard(()=>9)[1],9);
});
check('嵌套安装不重复包装同一check，卸载恢复原方法',()=>{
 reset();const second=installAttackChoiceBridge();stub.ai.basic.chooseCard(()=>5);second();cleanup();
 assert.equal(stub.ai.basic.chooseCard,nativeCard);assert.equal(stub.ai.basic.chooseTarget,nativeTarget);
 assert.equal(callback(viewer.hand[0]),5);
});
stub.lib.element={Player};stub.game.writeFile=()=>{};stub.game.addGlobalSkill=()=>{};stub.game.removeGlobalSkill=()=>{};
const engine=await import('../score/decision/engine/engine.js?v=41a');
check('真实引擎安装卸载接通实体选牌和目标桥',()=>{
 const [me,target]=reset();target.equip[2]={name:'renwang'};
 try {engine.installHooks();assert.equal(stub.ai.basic.chooseCard(()=>5)[0],me.hand[1]);}
 finally {engine.uninstallHooks();}
 assert.equal(stub.ai.basic.chooseCard,nativeCard);assert.equal(stub.ai.basic.chooseTarget,nativeTarget);
});
console.log(`2v2 attack choice: ${checks} passed`);
process.exit(0);
