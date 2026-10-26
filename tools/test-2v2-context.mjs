// node tools/test-2v2-context.mjs — 公开规则、座次、阶段和生产关系链回归。
import assert from 'node:assert/strict';
import {register} from 'node:module';
const local={versus_mode:'two',replace_character_two:false,replace_handcard_two:true,
 olfeiyang_four:true,two_assign:false,two_phaseswap:false,double_character:false};
let mode='versus',attitude=-5;
const diagnostics=[];
const stub={lib:{config:{},configOL:{versus_mode:'2v2',replace_handcard:false,olfeiyang_four:false},card:{list:[]}},
 game:{players:[],dead:[]},get:{mode:()=>mode,config:key=>local[key],attitude:()=>attitude},
 _status:{mode:'two',roundNumber:1},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;
globalThis.window={__DJSC:{swallow:e=>diagnostics.push(e.message)}};
register('./noname-stub-loader.mjs',import.meta.url);
const runtime=await import('../score/foundation/runtime/versusContext.js?v=41a');
const context=await import('../score/foundation/runtime/modeContext.js?v=41a');
const {resolveVersusState}=await import('../score/decision/modes/versus/context.js?v=41a');
const phase=await import('../score/decision/state/gamePhase.js?v=41a');
const relations=await import('../score/decision/relations/relations.js?v=41a');
const {isEnemy}=await import('../score/decision/strategy/modeStrategy.js?v=41a');
const {isEndgame}=await import('../score/decision/tuning/endgameOpt.js?v=41a');
const {multiTurnPlan}=await import('../score/decision/strategy/multiTurnOpt.js?v=41a');
const {MODE_SPECIALTIES}=await import('../score/decision/modes/modeRegistry.js?v=41a');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function reset(sides=[false,true,true,false],first=0){
 mode='versus';Object.assign(stub._status,{mode:'two',connectMode:false,roundNumber:1});
 delete stub._status.brawl;delete stub._status.replacetwo;
 local.replace_character_two=false;
 const ps=sides.map((side,i)=>({playerid:'p'+i,side,hp:3,maxHp:4,name:'same-name',alive:true}));
 ps.forEach((p,i)=>{p.nextSeat=ps[(i+1)%4];p.next=p.nextSeat;});
 stub.game.players=ps.slice();stub.game.dead=[];stub.game.me=ps[0];
 stub._status.firstAct=ps[first];stub._status.currentPhase=ps[first];return ps;
}
function liveRing(ps){ps.forEach((p,i)=>p.next=ps[(i+1)%ps.length]);}
function kill(p){p.alive=false;stub.game.players=stub.game.players.filter(x=>x!==p);stub.game.dead.push(p);liveRing(stub.game.players);}
check('严格作用域：本地、联机、乱斗和其他子模式',()=>{
 reset();assert.equal(runtime.readVersusMode().is2v2,true);
 stub._status.mode='2v2';assert.equal(runtime.readVersusMode().is2v2,true);
 for(const submode of ['standard','three','3v3','four','4v4','siguo','guandu']){
  stub._status.mode=submode;assert.equal(runtime.readVersusMode().is2v2,false);
 }
 stub._status.mode='two';stub._status.brawl={submode:'two'};
 assert.equal(runtime.readVersusMode().is2v2,false);
 assert.notEqual(context.readModeContext().group,'versus-2v2');
 delete stub._status.brawl;mode='identity';assert.equal(runtime.readVersusState(),null);
});
check('选将前本地配置与联机配置兜底，运行时子模式优先',()=>{
 reset();delete stub._status.mode;
 assert.equal(context.readModeContext().submode,'two');
 stub._status.connectMode=true;
 assert.equal(context.readModeContext().submode,'2v2');
 stub._status.mode='four';assert.equal(context.readModeContext().submode,'four');
});
check('本地与联机规则使用正确配置键，不混用本地设置',()=>{
 reset();let c=context.readModeContext();
 assert.equal(c.group,'versus-2v2');assert.equal(c.rules.fourthSeatExtraCard,true);
 assert.equal(c.rules.fourthSeatFeiyang,true);assert.equal(c.rules.reserve,false);
 stub._status.connectMode=true;stub._status.mode='2v2';c=context.readModeContext();
 assert.equal(c.rules.connect,true);assert.equal(c.rules.fourthSeatExtraCard,false);
 assert.equal(c.rules.fourthSeatFeiyang,false);assert.equal(c.rules.reserve,false);
 assert.equal(c.rules.assignTeammate,false);
});
check('规则键覆盖替补、保护、飞扬、代选、代行动和牌堆',()=>{
 reset();const base=context.readModeContext().ruleKey;
 for(const key of ['replace_character_two','replace_handcard_two','olfeiyang_four','two_assign','two_phaseswap']){
  const original=local[key];local[key]=!original;
  assert.notEqual(context.readModeContext().ruleKey,base);local[key]=original;
 }
 stub.lib.card.list=[['spade',7,'sha']];assert.notEqual(context.readModeContext().ruleKey,base);
 stub.lib.card.list=[];assert.equal(context.readModeContext().ruleKey,base);
});
check('未读取的配置保留 unknown，不能默认为关闭',()=>{
 reset();delete local.replace_character_two;
 assert.equal(context.readModeContext().rules.reserve,'unknown');
 kill(stub.game.players[1]);assert.notEqual(phase.getGamePhase().phase,'endgame');
 local.replace_character_two=false;
});
check('宿主公开替补标记优先于菜单，但不泄漏到联机规则',()=>{
 reset();stub._status.replacetwo=true;
 assert.equal(runtime.readVersusRules().reserve,true);
 assert.equal(context.readModeContext().rules.reserve,true);
 kill(stub.game.players[1]);assert.equal(phase.getGamePhase().phase,'early');
 stub._status.connectMode=true;stub._status.mode='2v2';
 assert.equal(runtime.readVersusRules().reserve,false);
});
check('座次从首动及宿主座次环读取，不依赖数组顺序或武将名',()=>{
 const ps=reset(undefined,2);stub.game.players=[ps[1],ps[0],ps[3],ps[2]];
 const s=runtime.readVersusState();
 assert.deepEqual(s.seatOrder,['p2','p3','p0','p1']);assert.equal(s.seatReady,true);
 assert.deepEqual(s.normalTurnOrder,['p2','p3','p0','p1']);assert.equal(s.nextNormalActorId,'p3');
 assert.deepEqual(s.allyIds,['p0','p3']);assert.deepEqual(s.enemyIds,['p1','p2']);
});
check('四座轮换与队伍互换均保持准确人数及首动座次',()=>{
 for(const sides of [[false,true,true,false],[true,false,false,true],[0,1,0,1]])for(let first=0;first<4;first++){
  reset(sides,first);const s=runtime.readVersusState();
  assert.equal(s.seatOrder[0],'p'+first);assert.equal(s.structure,'2v2');assert.equal(s.teamsReady,true);
  assert.equal(s.allyIds.length,2);assert.equal(s.enemyIds.length,2);
 }
});
check('死亡后保留首动座次，存活行动环立即更新',()=>{
 const ps=reset();kill(ps[1]);stub._status.currentPhase=ps[0];
 const s=runtime.readVersusState();
 assert.deepEqual(s.seatOrder,['p0','p1','p2','p3']);
 assert.deepEqual(s.normalTurnOrder,['p0','p2','p3']);assert.equal(s.structure,'2v1');
 assert.equal(s.nextNormalActorId,'p2');assert.equal(s.reduced,true);
});
check('己方减员、单挑和复活无需等下一轮刷新',()=>{
 const ps=reset();kill(ps[3]);assert.equal(runtime.readVersusState().structure,'1v2');
 kill(ps[1]);assert.equal(runtime.readVersusState().structure,'1v1');
 ps[3].alive=true;stub.game.dead=stub.game.dead.filter(p=>p!==ps[3]);stub.game.players.push(ps[3]);
 liveRing([ps[0],ps[2],ps[3]]);
 assert.equal(runtime.readVersusState().structure,'2v1');
});
check('同回合换位、回合插入更换当前行动者立即反映',()=>{
 const ps=reset();const before=relations.relationStateKey(ps[0]);
 const order=[ps[0],ps[2],ps[1],ps[3]];
 order.forEach((p,i)=>{p.nextSeat=order[(i+1)%4];p.next=p.nextSeat;});
 stub._status.currentPhase=ps[3];
 const s=runtime.readVersusState();
 assert.deepEqual(s.seatOrder,['p0','p2','p1','p3']);assert.equal(s.currentActorId,'p3');
 assert.equal(s.nextNormalActorId,'p0');assert.notEqual(relations.relationStateKey(ps[0]),before);
 assert.equal(s.nextActorId,undefined); // 不宣称知道技能插队后的真实下一行动者。
});
check('缺失 / 损坏座次环不凭数组顺序猜测',()=>{
 const ps=reset();delete ps[1].nextSeat;
 let s=runtime.readVersusState();assert.deepEqual(s.seatOrder,[]);assert.equal(s.seatReady,false);
 delete ps[2].next;s=runtime.readVersusState();assert.deepEqual(s.normalTurnOrder,[]);
 assert(s.issues.includes('normal-turn-ring-incomplete'));
});
check('未建队和异常 roster 只给诊断，不伪造队伍',()=>{
 reset();delete stub.game.players[1].side;
 assert.equal(runtime.readVersusState().teamsReady,false);
 assert.equal(runtime.readVersusState().structure,null);
 const s=resolveVersusState({players:[{id:'a',side:false},{id:'a',side:true}]});
 assert(s.issues.includes('player-id-incomplete'));assert.equal(s.teamsReady,false);
});
check('快照不读取手牌、身份、替补武将和武将名',()=>{
 const ps=reset();
 for(const p of ps)for(const key of ['identity','name','name1','handcards','replacetwo'])
  Object.defineProperty(p,key,{get(){throw Error('非法私有字段 '+key);},configurable:true});
 const s=runtime.readVersusState();assert.equal(s.teamsReady,true);
 assert.equal(relations.exposureOf(ps[0],ps[1]).known,1);
 assert.equal(relations.campRelationOf(ps[0],ps[1]),'opposite');
});
check('生产关系链以 side 为准，不被态度、同势力或内奸标记覆盖',()=>{
 const [me,enemy,,ally]=reset();
 me.identity='nei';assert.equal(relations.isIndependent(me,me),false);enemy.group=ally.group='wei';enemy.isFriend=()=>true;ally.isFriend=()=>false;
 attitude=-5;
 assert.equal(relations.campRelationOf(me,ally),'same');assert.equal(relations.isAllyOf(me,ally),true);
 assert.equal(relations.isEnemyOf(me,ally),false);assert.equal(isEnemy(me,ally),false);
 attitude=5;
 assert.equal(relations.campRelationOf(me,enemy),'opposite');assert.equal(relations.isEnemyOf(me,enemy),true);
 assert.equal(isEnemy(me,enemy),true);
 delete ally.side;assert.equal(relations.campRelationOf(me,ally),'unknown');
 assert.equal(relations.dispositionOf(me,ally),0);assert.equal(isEnemy(me,ally),false);
});
check('2v2 开局、发展、后期按轮次区分，实际残局模块不提前生效',()=>{
 const ps=reset();
 for(const [round,expected] of [[1,'early'],[3,'early'],[4,'mid'],[8,'late']]){
  stub._status.roundNumber=round;assert.equal(phase.getGamePhase().phase,expected);
  assert.equal(isEndgame(ps[0]),false);assert.notEqual(multiTurnPlan(ps[0]).strategy,'endgame');
 }
});
check('普通 2v1、1v2、1v1 减员进入实际残局路径',()=>{
 for(const deadIds of [[1],[3],[1,3]]){
  const ps=reset();deadIds.forEach(i=>kill(ps[i]));
  assert.equal(phase.getGamePhase().phase,'endgame');assert.equal(isEndgame(ps[0]),true);
  assert.equal(multiTurnPlan(ps[0]).strategy,'endgame');
 }
});
check('替补首次减员不判最终残局，不读取未公开替补名单',()=>{
 const ps=reset();local.replace_character_two=true;kill(ps[1]);
 assert.equal(runtime.readVersusState().reserve,true);assert.equal(phase.getGamePhase().phase,'early');
});
check('其他模式与四人残局保持原阶段语义',()=>{
 reset();for(const other of ['identity','doudizhu','guozhan']){
  mode=other;assert.equal(phase.getGamePhase().phase,'endgame');
 }
 mode='versus';stub._status.mode='four';assert.equal(phase.getGamePhase().phase,'endgame');
});
check('选将前读取无会话标记，正式开局不启用任何专项训练',()=>{
 reset();const setup=context.readModeContext();assert.equal(setup.lifecycle,'setup');
 for(const key of ['enabled','collect'])assert.equal(setup[key],false);
 const active=context.beginModeContext('2v2-A');
 assert.equal(active.lifecycle,'active');assert.equal(active.sessionId,'2v2-A');
 for(const key of ['enabled','collect','playerDemonstrations','specialistEnabled','autoUpdate'])assert.equal(active[key],false);
 assert.equal(active.specialistVersion,null);assert.equal(active.modelStorage,null);
 assert.equal(context.classicEnabled(),false);
});
check('会话中局势实时刷新；元数据以当前行动玩家为观察者',()=>{
 const ps=reset();context.beginModeContext('2v2-live');kill(ps[1]);
 assert.equal(context.modeContext().versusState.structure,'2v1');
 const sample=context.modeSampleMeta(ps[2]);assert.equal(sample.role,'team-member');
 assert.equal(sample.versusState.structure,'1v2');assert.equal(sample.captured,true);
 const external=context.modeContext();external.versusState.allyIds.length=0;
 assert.equal(context.modeContext().versusState.allyIds.length,2);
});
check('结束冻结局势；新会话清除上局快照',()=>{
 reset();context.beginModeContext('old');context.closeModeContext();
 const ended=context.modeContext();assert.equal(ended.lifecycle,'closed');assert.equal(context.modeSessionActive(),false);
 const ps=reset(undefined,2);kill(ps[1]);
 assert.deepEqual(context.modeContext().versusState,ended.versusState);
 const fresh=context.beginModeContext('new');assert.equal(fresh.sessionId,'new');
 assert.equal(fresh.versusState.firstActorId,'p2');assert.equal(fresh.versusState.structure,'2v1');
 context.closeModeContext();
});
check('斗地主上下文与角色契约保持原行为',()=>{
 reset();mode='doudizhu';stub._status.mode='normal';
 const c=context.beginModeContext('classic');
 assert.equal(c.group,'doudizhu-classic');assert.equal(c.enabled,true);assert.equal(c.collect,true);
 assert.equal(c.versusState,undefined);assert.equal(context.modeSampleMeta({identity:'fan'}).role,'farmer');
 context.closeModeContext();
});
check('专项登记明确处于上下文验证，模型未就绪',()=>{
 const entry=MODE_SPECIALTIES.find(x=>x.id==='versus-2v2');
 assert.deepEqual(entry.submodes,['two','2v2']);assert.equal(entry.status,'context-validation');
});
assert.deepEqual(diagnostics,[],'生产调用不应吞掉异常');
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 rules, seats and phase context');
