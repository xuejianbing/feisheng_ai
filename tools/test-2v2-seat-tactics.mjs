// node tools/test-2v2-seat-tactics.mjs — 14/23 座次机会、生产评分及拆顺选牌桥。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus',effect=1,checks=0;
const diagnostics=[];
class Player {
 constructor(id,side){Object.assign(this,{playerid:id,name:'same',side,hp:3,maxHp:4,alive:true,range:1,hand:[],armor:null,skipped:false});}
 getCards(zone){if(zone==='h'){assert.equal(this,stub._status.currentPhase,'不得读取其他玩家手牌');return this.hand;}return zone==='e'&&this.armor?[this.armor]:[];}
 countCards(zone){return zone==='h'?this.hand.length:zone==='e'&&this.armor?1:0;}
 getEquip(slot){return slot===2?this.armor:null;}
 getAttackRange(){return this.range;}
 inRange(target){return distance(this,target)<=this.range;}
 canUse(card,target){return !card.disabled&&card.usable!==false&&target.alive!==false&&(card.name==='sha'?this.inRange(target):card.name==='shunshou'?distance(this,target)<=1:true);}
 isTurnedOver(){return this.skipped;}
 hasSkillTag(tag){return this.tags?.includes(tag)||false;}
}
function distance(a,b){const ps=stub.game.players;const x=Math.abs(ps.indexOf(a)-ps.indexOf(b));return Math.min(x,ps.length-x);}
const stub={lib:{config:{},configOL:{},skill:{},card:{guohe:{ai:{button:()=>1}},shunshou:{ai:{button:()=>1}}},
 filter:{cardEnabled:c=>!c.disabled,cardUsable:c=>c.usable!==false,targetEnabled2:(_c,_p,t)=>!t.immune,
 canBeDiscarded:c=>!c.locked,canBeGained:c=>!c.locked}},
 game:{players:[],dead:[]},get:{mode:()=>mode,config:k=>k==='versus_mode'?'two':false,name:c=>c?.name,
 distance,value:c=>c.value??5,effect:()=>effect,position:c=>c.position,event:()=>stub._status.event},
 _status:{mode:'two',roundNumber:1},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{swallow:e=>diagnostics.push(e.message)}};
register('./noname-stub-loader.mjs',import.meta.url);
const tactics=await import('../score/decision/modes/versus/seatTacticsRuntime.js?v=41a');
const pure=await import('../score/decision/modes/versus/seatTactics.js?v=41a');
const team=await import('../score/perception/team/team.js?v=41a');
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {tempoFactor}=await import('../score/decision/threat/threat.js?v=41a');
const {multiTurnPlan,multiTurnBonus}=await import('../score/decision/strategy/multiTurnOpt.js?v=41a');
const {utilityParity}=await import('../score/decision/utility/utilityPipeline.js?v=41a');
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function reset(acting=0,sides=[false,true,true,false]){
 mode='versus';effect=1;stub.lib.config={};Object.assign(stub._status,{mode:'two',roundNumber:1,connectMode:false});
 delete stub._status.brawl;
 const ps=sides.map((side,i)=>new Player('p'+(i+1),side));
 ps.forEach((p,i)=>p.next=p.nextSeat=ps[(i+1)%4]);
 stub.game.players=ps;stub.game.dead=[];stub.game.me=ps[acting];stub._status.firstAct=ps[0];
 stub._status.currentPhase=ps[acting];stub._status.event={name:'phaseUse',player:ps[acting]};
 ps[acting].hand=['sha','guohe','shunshou','lebu','bingliang','juedou'].map(name=>({name}));
 tactical.captureTacticalSettings();return ps;
}
const action=(id,target,score=2)=>({type:'card',id,target:target.playerid,targetObj:target,score});
check('14队一号位：队友行动前有两个敌方回合',()=>{
 const [me,b,c,ally]=reset();ally.hp=1;const plan=tactics.readSeatTactics(me);
 assert.deepEqual(plan.enemiesBeforeAlly,[b.playerid,c.playerid]);
 assert.deepEqual(plan.threatsBeforeAlly,[c.playerid]); // 二号位当前距离2，不虚称能杀到四号。
 assert.equal(plan.consecutive,false);assert.equal(plan.allyInDanger,true);
 assert.equal(team.teamPlan(me).protect.ally,ally);
});
check('23队二号位：三号紧接行动，能辨认接力目标',()=>{
 const [a,me,ally,d]=reset(1);const plan=tactics.readSeatTactics(me);
 assert.equal(plan.consecutive,true);assert.deepEqual(plan.enemiesBeforeAlly,[]);
 assert.deepEqual(plan.followupIds,[d.playerid]);assert.deepEqual(plan.focusIds,[]);
 assert.equal(team.focusTarget(me),null); // 没有共同攻击距离，不凭空强制集火。
});
check('四号接下一轮一号的机会，与二号接三号一致',()=>{
 const [ally,b,c,me]=reset(3);const plan=tactics.readSeatTactics(me);
 assert.equal(plan.consecutive,true);assert.equal(plan.allyId,ally.playerid);
 assert.deepEqual(plan.followupIds,[b.playerid]);
});
check('转化成13队排列时按实际行动环判断，不套14/23标签',()=>{
 const [me,b,ally]=reset(0,[false,true,false,true]);ally.hp=1;
 const plan=tactics.readSeatTactics(me);assert.equal(plan.consecutive,false);
 assert.deepEqual(plan.enemiesBeforeAlly,[b.playerid]);
});
check('座次机会不读取队友/敌方隐藏手牌或身份',()=>{
 const [a,me,ally,d]=reset(1);
 for(const p of [a,ally,d]){
  p.getCards=zone=>{if(zone==='h')throw Error('隐藏手牌');return [];};
  Object.defineProperty(p,'identity',{get(){throw Error('身份');}});
 }
 assert.equal(tactics.readSeatTactics(me).consecutive,true);
 assert.equal(team.teamPlan(me).seatTactics.consecutive,true);
});
check('合法过河拆四号防具，接力桥不要求自己有杀',()=>{
 const [,me,,target]=reset(1);me.hand=me.hand.filter(c=>c.name==='guohe');
 target.armor={name:'bagua',position:'e',value:5};
 const plan=tactical.stripPlan(me,me.hand[0],target);
 assert.equal(plan.kind,'relay-armor');assert.equal(plan.card,target.armor);
 assert.equal(plan.score/5,.2);assert.equal(tactical.extraCardOrder(me,me.hand[0],5),5);
});
check('同一防具计划贯通真实拆顺按钮选择',()=>{
 const [,me,,target]=reset(1);target.armor={name:'bagua',position:'e',value:5};
 tactical.installStripButtonBridges();
 stub._status.event={name:'choosePlayerCard',player:me,target,parent:{name:'phaseUse',player:me}};
 assert.equal(stub.lib.card.guohe.ai.button({link:target.armor}),30);
 assert.equal(stub.lib.card.guohe.ai.button({link:{name:'other',position:'e'}}),-1);
 target.armor=null;assert.equal(stub.lib.card.guohe.ai.button({link:{position:'e'}}),1);
});
check('距离2的顺手不能借接力绕过合法性',()=>{
 const [,me,,target]=reset(1);target.armor={name:'bagua',position:'e',value:5};
 assert.equal(tactical.stripPlan(me,{name:'shunshou'},target),null);
});
check('队友打不到、翻面、免杀、锁定防具或失装收益时不强拆',()=>{
 for(const kind of ['range','turned','immune','locked','loseEquip','unequip','baiyin']){
  const [,me,ally,target]=reset(1);me.hand=[{name:'guohe'}];target.armor={name:'bagua',position:'e',value:5};
  if(kind==='range')ally.range=0;if(kind==='turned')ally.skipped=true;if(kind==='immune')target.immune=true;
  if(kind==='locked')target.armor.locked=true;if(kind==='loseEquip')target.tags=['loseEquip'];
  if(kind==='unequip')ally.tags=['unequip'];if(kind==='baiyin'){target.armor.name='baiyin';target.hp=2;}
  assert.equal(tactical.stripPlan(me,me.hand[0],target),null,kind);
 }
});
check('非连续队友和关闭拆顺开关不进入接力拆防具',()=>{
 const [me,,target]=reset();me.hand=[{name:'guohe'}];target.armor={name:'bagua',value:5};
 assert.equal(tactical.stripPlan(me,me.hand[0],target),null);
 const ps=reset(1);ps[1].hand=[{name:'guohe'}];ps[3].armor={name:'bagua',value:5};
 stub.lib.config['extension_无名AI_tacticalStrip']=false;tactical.captureTacticalSettings();
 assert.equal(tactical.stripPlan(ps[1],ps[1].hand[0],ps[3]),null);
});
check('危险队友前的可达敌人控制有小幅时序偏好',()=>{
 const [me,b,c,ally]=reset();ally.hp=1;
 const preferred=action('lebu',c),other=action('lebu',b);
 tactics.applyVersusSeatPreferences(me,[preferred,other]);
 assert.equal(preferred.score,2.15);assert.equal(other.score,2);
 assert.equal(preferred.utilityVector.ownedSources.filter(s=>s==='versusSeatTempo').length,1);
 assert.equal(utilityParity(preferred).ok,true);
 tactics.applyVersusSeatPreferences(me,[preferred]);assert.equal(preferred.score,2.15);
});
check('共同可达的连续行动只加机会分，不重复加残血/击杀收益',()=>{
 const [target,me,ally]=reset(1);ally.range=2;target.hp=1;
 const attack=action('sha',target);tactics.applyVersusSeatPreferences(me,[attack]);assert.equal(attack.score,2.15);
 const healthy=action('sha',target);target.hp=4;tactics.applyVersusSeatPreferences(me,[healthy]);assert.equal(healthy.score,2.15);
 const strip=action('guohe',target);tactics.applyVersusSeatPreferences(me,[strip]);assert.equal(strip.score,2);
});
check('非正收益、不可用卡牌、友方、AOE、结束回合、受禁候选不被抬分',()=>{
 const [target,me,ally]=reset(1);ally.range=2;
 const rows=[action('sha',target,-1),action('sha',target,0),action('sha',ally),action('nanman',target),
  {type:'end',id:'end',score:0}, {...action('sha',target),policy:{eligible:false}},
  {...action('sha',target),targetResolved:false},
  {...action('sha',target),target:['p1','p4'],targetList:[target,stub.game.players[3]]}];
 const scores=rows.map(a=>a.score);tactics.applyVersusSeatPreferences(me,rows);assert.deepEqual(rows.map(a=>a.score),scores);
 effect=-1;let a=action('sha',target);tactics.applyVersusSeatPreferences(me,[a]);assert.equal(a.score,2);
 effect=1;for(const key of ['disabled','usable']){
  const slash=me.hand.find(c=>c.name==='sha');slash[key]=key==='disabled'?true:false;
  a=action('sha',target);tactics.applyVersusSeatPreferences(me,[a]);assert.equal(a.score,2);delete slash[key];
 }
});
check('同回合血线、距离、死亡变化刷新团队计划',()=>{
 const [me,,enemy,ally]=reset();ally.hp=1;assert(team.teamPlan(me).protect);
 ally.hp=4;assert.equal(team.teamPlan(me).protect,null);
 ally.hp=1;enemy.range=0;assert.equal(team.teamPlan(me).protect,null);
 enemy.range=1;enemy.alive=false;stub.game.players=stub.game.players.filter(p=>p!==enemy);stub.game.dead=[enemy];
 stub.game.players.forEach((p,i,a)=>p.next=a[(i+1)%a.length]);
 assert.deepEqual(team.teamPlan(me).seatTactics.threatsBeforeAlly,['p2']); // 减员缩短距离，剩余敌人现在能到达队友。
});
check('额外回合或换位后按当前常规环重读，旧接力不缓存',()=>{
 const [,me,ally,target]=reset(1);assert.equal(tactics.readSeatTactics(me).consecutive,true);
 const order=[me,target,ally,stub.game.players[0]];order.forEach((p,i)=>p.next=order[(i+1)%4]);
 assert.equal(tactics.readSeatTactics(me).consecutive,false);
 stub._status.currentPhase=ally;assert.equal(tactics.readSeatTactics(me),null);
});
check('响应窗口和出牌阶段之外不追加座次评分或接力强选',()=>{
 const [target,me,ally]=reset(1);ally.range=2;target.armor={name:'bagua',value:5};
 for(const event of [{name:'chooseToRespond',parent:{name:'phaseUse',player:me}},{name:'chooseToUse',type:'respond',parent:{name:'phaseUse',player:me}},{name:'phaseDraw',player:me}]){
  stub._status.event=event;const a=action('sha',target);tactics.applyVersusSeatPreferences(me,[a]);assert.equal(a.score,2);
  assert.equal(tactics.relayArmorPlan(me,{name:'guohe'},target),null);
 }
});
check('2v2开局去掉通用攒牌倍率，公共模式保持原行为',()=>{
 const [me]=reset();const tempo=tempoFactor();
 for(const key of ['atkMul','keepMul','burstMul'])assert.equal(tempo[key],1);
 assert.equal(multiTurnPlan(me).strategy,'early_versus');assert.equal(multiTurnBonus(me,{id:'juedou'}),1);
 assert.equal(multiTurnBonus(me,{id:'wugu'}),1);
 mode='identity';stub.game.players.push(new Player('extra',false));
 assert.equal(tempoFactor().atkMul,.9);assert.equal(multiTurnBonus(me,{id:'juedou'}),.7);
});
check('严格模式与开关隔离，异常座次没有新偏好',()=>{
 const [target,me]=reset(1);
 for(const submode of ['four','3v3','standard']){stub._status.mode=submode;assert.equal(tactics.readSeatTactics(me),null);}
 stub._status.mode='two';stub._status.brawl={submode:'two'};assert.equal(tactics.readSeatTactics(me),null);
 delete stub._status.brawl;stub.lib.config['extension_无名AI_tacticalOptimization']=false;
 assert.equal(tactics.readSeatTactics(me),null);const a=action('sha',target);tactics.applyVersusSeatPreferences(me,[a]);assert.equal(a.score,2);
 delete stub.lib.config['extension_无名AI_tacticalOptimization'];delete me.next;
 assert.equal(tactics.readSeatTactics(me),null);
});
check('换边、联机和座次轮换使用相同机会规则',()=>{
 for(const sides of [[false,true,true,false],[true,false,false,true],[0,1,1,0]]){
  const ps=reset(1,sides);stub._status.connectMode=true;stub._status.mode='2v2';
  assert.equal(tactics.readSeatTactics(ps[1]).consecutive,true);
  const order=[ps[3],ps[0],ps[1],ps[2]];order.forEach((p,i)=>p.next=p.nextSeat=order[(i+1)%4]);
  assert.equal(tactics.readSeatTactics(ps[1]).allyId,ps[2].playerid);
 }
});
check('可达性未知时不乐观假定；队友濒死不虚报接力',()=>{
 const [target,me,ally]=reset(1);ally.inRange=undefined;ally.getAttackRange=undefined;
 assert.equal(tactics.publicAttackReach(ally,target),false);
 assert.deepEqual(tactics.readSeatTactics(me).followupIds,[]);
 ally.hp=0;assert.equal(tactics.readSeatTactics(me).consecutive,false);
});
check('拆顺接力沿用已有开关、子选择更新和原生效果方向',()=>{
 const [,me,ally,target]=reset(1);me.hand=[{name:'guohe'}];target.armor={name:'bagua',value:5};
 effect=-1;assert.equal(tactical.stripPlan(me,me.hand[0],target),null);
 effect=1;assert.equal(tactical.stripPlan(me,me.hand[0],target).kind,'relay-armor');
 ally.skipped=true;assert.equal(tactical.stripPlan(me,me.hand[0],target),null);
});
check('纯偏好封顶且不叠加两类理由',()=>{
 const p={allyInDanger:true,threatsBeforeAlly:['e','x','y'],consecutive:true,focusIds:['e']};
 assert.equal(pure.seatActionPreference(p,{id:'lebu',targetId:'e',positive:true,legal:true}).delta,.3);
 assert.equal(pure.seatActionPreference(p,{id:'sha',targetId:'e',positive:true,legal:true}).delta,.15);
});
assert.deepEqual(diagnostics,[],'不得吞掉生产调用异常');
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 seat-aware cooperation');
