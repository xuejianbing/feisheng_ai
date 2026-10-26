// node tools/test-2v2-aoe.mjs — 实际AOE评估、唯一收益账本与宿主方向选择桥。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus',viewer,checks=0,reserve=false;
class Player {
 constructor(id,side){Object.assign(this,{playerid:id,side,hp:3,hujia:0,alive:true,hand:[],skills:[],equip:[]});}
 getCards(zone){if(zone==='h'){assert.equal(this,viewer,'不得读取其他玩家隐藏手牌');return this.hand;}return zone==='e'?this.equip:[];}
 countCards(){return 0;} // 公开张数；空手仍不表示没有转化/救援技能。
 getSkills(){return this.skills;}hasSkillTag(){return false;}hasSkill(){return false;}getEquip(){return null;}
 isAlive(){return this.alive;}canUse(card,target){return !target.blocked;}isOnline2(){return false;}
 chooseControl(...args){return {name:'chooseControl',player:this,parent:stub._status.event,ai:args.find(a=>typeof a==='function'),set(key,value){this[key]=value;return this;}};}
}
const stub={lib:{config:{},configOL:{},element:{Player},skill:{},card:{nanman:{reverseOrder:true},wanjian:{reverseOrder:true}},filter:{cardSavable:(card,p,target)=>!card.forbidden&&!target.norecover}},
 game:{players:[],dead:[]},get:{mode:()=>mode,config:key=>key==='versus_mode'?'two':key==='replace_character_two'?reserve:false,
 name:card=>card?.name,attitude:(a,b)=>a.side===b.side?5:-5,tag:()=>0},ui:{selected:{cards:[]}},_status:{mode:'two'},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const {aoeValue,aoeTiming,aoeBonus}=await import('../score/decision/timing/aoeTiming.js?v=41a');
const {createAreaUtilitySeed}=await import('../score/decision/utility/areaUtility.js?v=41a');
const {utilityParity}=await import('../score/decision/utility/utilityPipeline.js?v=41a');
const {aoeDirectionChoice,installAoeDirectionBridge}=await import('../score/decision/modes/versus/aoeDirectionBridge.js?v=41a');
const {resetCooperativeTrickIntents}=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
function check(label,fn){fn();checks++;console.log('PASS '+label);}
function reset(actor=0){
 mode='versus';reserve=false;stub.lib.config={};stub.ui.selected.cards=[];
 Object.assign(stub._status,{mode:'two',connectMode:false,auto:false});delete stub._status.brawl;delete stub._status.replacetwo;
 const players=[false,true,true,false].map((side,i)=>new Player('p'+i,side));
 players.forEach((p,i)=>{p.next=p.nextSeat=players[(i+1)%4];p.previous=players[(i+3)%4];});
 stub.game.players=players;stub.game.dead=[];viewer=players[actor];stub.game.me=players[(actor+1)%4];
 stub._status.currentPhase=viewer;stub._status.firstAct=players[0];stub._status.event={name:'phaseUse',player:viewer};
 stub.lib.card.nanman={reverseOrder:true};stub.lib.card.wanjian={reverseOrder:true};return players;
}
function parent(me,id='nanman',targets=stub.game.players.filter(p=>p!==me)){
 return {name:id+'ContentBefore',player:me,card:{name:id},targets,parent:{name:'useCard'}};
}
check('两名健康敌人对一血队友：不再仅凭掉血人数判正收益',()=>{
 const [me,,,ally]=reset();ally.hp=1;
 for(const id of ['nanman','wanjian']){const r=aoeValue(me,id);assert.equal(r.netDamage,1);assert(r.netImpact<0);assert.equal(r.teamRisk.casualtyRisk,2);assert.equal(aoeTiming(me,id).use,false);}
});
check('有可救普通桃时减少额外伤亡风险，但记录救援成本且不保证获救',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;
 const before=aoeValue(me,'nanman');me.hand=[{name:'tao'}];const after=aoeValue(me,'nanman');
 assert(after.teamRisk.casualtyRisk>0&&after.teamRisk.casualtyRisk<before.teamRisk.casualtyRisk);
 assert.equal(after.teamRisk.rescueCost,.35);assert(after.netImpact>0);assert.equal(after.teamRisk.allies[0].ordinaryRescueCovered,true);
});
check('两桃不会对同一次普通一伤虚构额外救援收益',()=>{
 const [me,,,ally]=reset();ally.hp=1;me.hand=[{name:'tao'}];const one=aoeValue(me,'nanman');me.hand.push({name:'tao'});
 assert.equal(aoeValue(me,'nanman').netImpact,one.netImpact);
});
check('禁用桃、禁救和没有可用性接口均不预支普通救援',()=>{
 const [me,,,ally]=reset();ally.hp=1;me.hand=[{name:'tao',forbidden:true}];assert.equal(aoeValue(me,'nanman').teamRisk.rescueCost,0);
 me.hand[0].forbidden=false;ally.norecover=true;assert.equal(aoeValue(me,'nanman').teamRisk.rescueCost,0);
 ally.norecover=false;const filter=stub.lib.filter.cardSavable;delete stub.lib.filter.cardSavable;
 try{assert.equal(aoeValue(me,'nanman').teamRisk.rescueCost,0);}finally{stub.lib.filter.cardSavable=filter;}
});
check('作为当前转化材料和已选材料的桃不当成后续救援库存',()=>{
 const [me,,,ally]=reset();ally.hp=1;const tao={name:'tao'};me.hand=[tao];
 assert.equal(aoeValue(me,'nanman',{card:{name:'nanman',cards:[tao]}}).teamRisk.rescueCost,0);
 stub.ui.selected.cards=[tao];assert.equal(aoeValue(me,'nanman').teamRisk.rescueCost,0);
});
check('队友两血或公开护甲可承受一伤，不增加普通濒死风险',()=>{
 const [me,,,ally]=reset();ally.hp=2;assert.equal(aoeValue(me,'nanman').teamRisk.extraImpact,0);
 ally.hp=1;ally.hujia=1;assert.equal(aoeValue(me,'nanman').teamRisk.extraImpact,0);
});
check('公开藤甲免疫与目标不可用过滤后不计算受击/救援',()=>{
 const [me,,,ally]=reset();ally.hp=1;ally.equip=[{name:'tengjia'}];
 assert.equal(aoeValue(me,'nanman').allyHit,0);assert.equal(aoeValue(me,'nanman').teamRisk.extraImpact,0);
 ally.equip=[];ally.blocked=true;assert.equal(aoeValue(me,'wanjian').teamRisk.extraImpact,0);
});
check('公开南蛮免疫技能不延伸为万箭免疫',()=>{
 const [me,,,ally]=reset();ally.hp=1;ally.skills=['juxiang'];assert.equal(aoeValue(me,'nanman').teamRisk.extraImpact,0);
 assert(aoeValue(me,'wanjian').teamRisk.extraImpact>0);
});
check('健康队友和没有队友的残局仍可使用有利群体牌',()=>{
 const [me,b,c,ally]=reset();assert(aoeValue(me,'nanman').netImpact>0);
 ally.alive=false;stub.game.dead=[ally];stub.game.players=[me,b,c];me.next=b;b.next=c;c.next=me;
 const r=aoeValue(me,'nanman');assert.equal(r.teamRisk.extraImpact,0);assert.equal(aoeTiming(me,'nanman').use,true);
});
check('友方濒死风险进入同一个AOE来源，账本与实际分数一致',()=>{
 const [me,,,ally]=reset();ally.hp=1;const r=aoeValue(me,'nanman'),seed=createAreaUtilitySeed(r,1.7);
 assert(Math.abs(seed.score-2*r.netImpact*1.7)<1e-9);assert.equal(utilityParity(seed).ok,true);
 assert.deepEqual(seed.utilityVector.ownedSources,['areaExpectedValue']);assert.equal(seed.utilityVector.contributions.length,2);
 assert.equal(seed.utilityVector.contributions[1].details.casualtyRisk,2);
});
check('一血队友受击风险随公开响应概率降低而减小',()=>{
 const [me,,,ally]=reset();ally.hp=1;const empty=aoeValue(me,'nanman');ally.countCards=()=>4;
 const withCards=aoeValue(me,'nanman');assert(withCards.teamRisk.extraImpact<empty.teamRisk.extraImpact);assert(withCards.teamRisk.extraImpact>0);
});
check('14队先敌后友方向仅作机会提示，不抵扣一血友方风险',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;const r=aoeValue(me,'nanman');
 assert.equal(r.teamRisk.directions.counterclockwise.earlyFinishPossible,true);
 assert.equal(r.teamRisk.directions.clockwise.earlyFinishPossible,false);
 assert.equal(r.teamRisk.extraImpact,r.teamRisk.directions.counterclockwise.extraImpact);
 assert.equal(aoeDirectionChoice(me,parent(me)),'逆时针');
});
check('23队反向可先结算两名敌方，方向随当前座次变化',()=>{
 const [a,me,ally,d]=reset(1);a.hp=ally.hp=d.hp=1;
 assert.equal(aoeDirectionChoice(me,parent(me,'wanjian')),'顺时针');
});
check('敌方不都在普通一伤斩杀线，不假定先打敌方就能提前结束',()=>{
 const [me,b,c,ally]=reset();b.hp=ally.hp=1;c.hp=2;
 assert.equal(aoeDirectionChoice(me,parent(me)),null);
 c.hp=1;c.hujia=1;assert.equal(aoeDirectionChoice(me,parent(me)),null);
});
check('替补开启/规则未就绪不假定本轮打倒敌方就能结束',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;reserve=true;
 assert.equal(aoeDirectionChoice(me,parent(me)),null);
 reserve=undefined;assert.equal(aoeDirectionChoice(me,parent(me)),null);
});
check('免疫、排除或不在实际目标中的敌人不虚报提前结束机会',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;c.skills=['juxiang'];
 assert.equal(aoeDirectionChoice(me,parent(me)),null);c.skills=[];
 assert.equal(aoeDirectionChoice(me,parent(me,'nanman',[b,ally])),null);
});
check('损坏座次环与自定义contentBefore不猜方向',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;b.nextSeat=b;
 assert.equal(aoeDirectionChoice(me,parent(me)),null);b.nextSeat=c;stub.lib.card.nanman.contentBefore=()=>{};
 assert.equal(aoeDirectionChoice(me,parent(me)),null);
});
check('其他模式、乱斗和关闭优化保持公共AOE评估及原方向',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;
 for(const setting of ['doudizhu','identity','brawl','disabled']){
  mode=setting==='brawl'||setting==='disabled'?'versus':setting;stub._status.brawl=setting==='brawl'?{}:undefined;
  stub.lib.config.extension_无名AI_tacticalOptimization=setting!=='disabled';
  const r=aoeValue(me,'nanman');assert.equal(r.teamRisk,null);assert.equal(r.allyImpact,r.baseAllyImpact);assert.equal(aoeDirectionChoice(me,parent(me)),null);
 }
});
check('联机2v2与false/0队伍均使用公开队伍，不读取隐藏牌',()=>{
 const [me,b,c,ally]=reset();stub._status.mode='2v2';stub._status.connectMode=true;ally.hp=1;
 for(const p of stub.game.players)p.side=p.side?1:0;
 for(const p of [b,c,ally])p.getCards=zone=>{assert.equal(zone,'e');return [];};
 assert(aoeValue(me,'nanman').teamRisk.extraImpact>0);
});
check('真实chooseControl桥只改AI回调，保留目标数组与宿主结果',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;stub._status.event=parent(me);const before=[...stub._status.event.targets];
 const original=Player.prototype.chooseControl,cleanup=installAoeDirectionBridge();
 try{const event=me.chooseControl('顺时针','逆时针',()=> '顺时针').set('choice','顺时针');assert.equal(event.ai(), '逆时针');assert.equal(event.choice,'顺时针');assert.deepEqual(event.parent.targets,before);}
 finally{cleanup();}assert.equal(Player.prototype.chooseControl,original);
});
check('人类手动选择、远端玩家、结束事件及卸载后均回退原生AI',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;stub._status.event=parent(me);
 const cleanup=installAoeDirectionBridge();let event;
 try{
  event=me.chooseControl('顺时针','逆时针',()=> 'native');stub.game.me=me;assert.equal(event.ai(),'native');
  stub._status.auto=true;assert.equal(event.ai(),'逆时针');me.isOnline2=()=>true;assert.equal(event.ai(),'native');
  me.isOnline2=()=>false;event.finished=true;assert.equal(event.ai(),'native');event.finished=false;
 }finally{cleanup();}assert.equal(event.ai(),'native');
});
check('其他同名方向菜单、其他牌与非当前回合不被AOE桥接管',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;
 assert.equal(aoeDirectionChoice(me,{...parent(me),name:'skill'}),null);
 assert.equal(aoeDirectionChoice(me,parent(me,'tiesuo')),null);stub._status.currentPhase=b;
 assert.equal(aoeDirectionChoice(me,parent(me)),null);
});
check('换局与父事件结束后旧AI回调失效',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;stub._status.event=parent(me);const cleanup=installAoeDirectionBridge();
 try{
  const event=me.chooseControl('顺时针','逆时针',()=> 'native');assert.equal(event.ai(),'逆时针');
  event.parent.finished=true;assert.equal(event.ai(),'native');event.parent.finished=false;
  resetCooperativeTrickIntents();assert.equal(event.ai(),'native');
 }finally{cleanup();}
});
check('同回合血线、桃与免疫变化立即更新，不沿用旧风险',()=>{
 const [me,,,ally]=reset();ally.hp=1;const danger=aoeValue(me,'nanman').netImpact;
 me.hand=[{name:'tao'}];assert(aoeValue(me,'nanman').netImpact>danger);
 ally.hp=3;assert.equal(aoeValue(me,'nanman').teamRisk.extraImpact,0);
 ally.hp=1;ally.equip=[{name:'tengjia'}];assert.equal(aoeValue(me,'nanman').teamRisk.extraImpact,0);
});
check('技能改变行动指针时仍按公开座次排序，不把行动环当结算顺序',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;me.next=ally;ally.next=b;b.next=c;c.next=me;
 assert.equal(aoeDirectionChoice(me,parent(me)),'逆时针');
});
check('读取己方资源异常时保留队友风险，不因异常变回乐观评估',()=>{
 const [me,,,ally]=reset();ally.hp=1;me.getCards=()=>{throw Error('own hand unavailable');};
 assert.equal(aoeValue(me,'nanman').teamRisk.casualtyRisk,2);
});
check('时机倍率只是现有接口，不额外写入第二份风险收益',()=>{
 const [me,,,ally]=reset();ally.hp=1;assert.equal(aoeBonus(me,{id:'nanman'}),.5);assert.equal(aoeBonus(me,{id:'sha'}),1);
});
stub.game.writeFile=()=>{};stub.game.addGlobalSkill=()=>{};stub.game.removeGlobalSkill=()=>{};
const engine=await import('../score/decision/engine/engine.js?v=41a');
check('实际引擎安装卸载接通方向桥，卸载后恢复原方法与旧回调',()=>{
 const [me,b,c,ally]=reset();b.hp=c.hp=ally.hp=1;const original=Player.prototype.chooseControl;let event;
 try{
  engine.installHooks();stub._status.event=parent(me);event=me.chooseControl('顺时针','逆时针',()=> 'native');
  assert.equal(event.ai(),'逆时针');
 }finally{engine.uninstallHooks();}
 assert.equal(Player.prototype.chooseControl,original);assert.equal(event.ai(),'native');
});
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 AOE risk and native direction bridge');
process.exit(0);
