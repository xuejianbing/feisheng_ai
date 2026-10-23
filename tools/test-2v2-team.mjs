// node tools/test-2v2-team.mjs — 纯函数与真实 VERSUS_STRATEGY 的宿主桩回归。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus', configMode='two', attitudeCalls=0;
const diagnostics=[];
const stub={lib:{config:{},configOL:{}},game:{players:[],dead:[]},get:{
 mode:()=>mode, config:key=>key==='versus_mode'?configMode:undefined,
 attitude:()=>{attitudeCalls++;return 5;},
},_status:{mode:'two'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;
globalThis.window={__DJSC:{swallow:(error)=>diagnostics.push(error.message)}};
register('./noname-stub-loader.mjs',import.meta.url);
const {hasKnownSide,sameTeamBySide,isVersus2v2}=await import('../score/decision/modes/versus/team.js?v=41a');
const {MODE_STRATEGIES,getModeStrategy}=await import('../score/decision/strategy/modeStrategy.js?v=41a');
const strategy=MODE_STRATEGIES.versus;
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
const player=(id,side)=>({playerid:id,side,hp:3,alive:true});
function setup(ownSide,otherSide){
 const me=player('me',ownSide),ally=player('ally',ownSide),enemy=player('enemy',otherSide);
 stub.game.me=me;stub.game.players=[me,ally,enemy];return {me,ally,enemy};
}
const act=(id,target)=>({type:'card',id,target:target.playerid});
check('本地欢乐和联机严格识别',()=>{
 assert.equal(isVersus2v2('versus','two'),true);
 assert.equal(isVersus2v2('versus','2v2'),true);
 for(const submode of ['standard','three','3v3','four','4v4','1v1','guandu','jiange','siguo','unknown','',undefined])
  assert.equal(isVersus2v2('versus',submode),false);
 for(const other of ['identity','doudizhu','connect','unknown',undefined])
  for(const submode of ['two','2v2'])assert.equal(isVersus2v2(other,submode),false);
});
check('false true 0 1 均有效；缺失 null 空串无效',()=>{
 for(const side of [false,true,0,1])assert.equal(hasKnownSide({side}),true);
 for(const p of [null,undefined,{}, {side:undefined},{side:null},{side:''}])assert.equal(hasKnownSide(p),false);
});
check('严格队伍比较及异常输入三态',()=>{
 for(const side of [false,true,0,1])assert.equal(sameTeamBySide({side},{side}),true);
 for(const [a,b] of [[true,false],[0,1],[false,0],[true,1],[0,'0']])assert.equal(sameTeamBySide({side:a},{side:b}),false);
 for(const p of [null,undefined,{}, {side:null},{side:''}]){
  assert.equal(sameTeamBySide(p,{side:false}),null);
  assert.equal(sameTeamBySide({side:false},p),null);
  assert.equal(sameTeamBySide(p,p),null);
 }
});
for(const submode of ['two','2v2']){
 stub._status.mode=submode;
 for(const [own,other] of [[false,true],[true,false],[0,1],[1,0]]){
  check(`${submode} 己方=${own}：阵营、队友保护、治疗、攻击奖励`,()=>{
   const {me,ally,enemy}=setup(own,other);
   ally.identity='marked'; // 合法 side 不应被身份兜底覆盖。
   assert.equal(strategy.getCamp(ally),String(own));
   assert.equal(strategy.isSameCamp(me,ally),true);
   assert.equal(strategy.isSameCamp(me,enemy),false);
   assert.equal(strategy.decisionBoost(me,act('sha',ally)),0);
   assert.equal(strategy.decisionBoost(me,act('tao',ally)),.5);
   assert.equal(strategy.decisionBoost(me,act('wuxie',ally)),.5);
   assert.equal(strategy.decisionBoost(me,act('sha',enemy)),.4);
   assert.equal(strategy.decisionBoost(me,act('tao',enemy)),0);
  });
 }
 check(`${submode} 异常 side 不调用态度或读取身份猜测队伍`,()=>{
  const {me,ally}=setup(false,true);
  for(const invalid of [undefined,null,'']){
   ally.side=invalid;
   Object.defineProperty(ally,'identity',{configurable:true,get(){throw Error('不应读取身份');}});
   const before=attitudeCalls;
   assert.equal(strategy.isSameCamp(me,ally),false);
   for(const id of ['sha','tao','wuxie'])assert.equal(strategy.decisionBoost(me,act(id,ally)),0);
   assert.equal(attitudeCalls,before);
   delete ally.identity;
  }
  ally.side=false;delete me.side;
  assert.equal(strategy.decisionBoost(me,act('sha',ally)),0);
  assert.equal(strategy.decisionBoost({},act('sha',{playerid:'absent'})),0);
  assert(diagnostics.some(s=>s.includes('missing public player.side')));
 });
}
check('其他对决旧敌方集合不漏 false/0；不纳入异常字段或已死亡玩家',()=>{
 stub._status.mode='3v3';
 for(const [own,other] of [[true,false],[1,0]]){
  const {me,ally,enemy}=setup(own,other);
  assert.equal(strategy.decisionBoost(me,act('sha',ally)),-1);
  enemy.alive=false;
  stub.game.players.push(player('invalid',undefined),player('empty',''),player('null',null));
  assert.equal(strategy.decisionBoost(me,act('sha',ally)),-2);
  enemy.alive=true;
  assert.equal(strategy.decisionBoost(me,act('sha',ally)),-1);
 }
 stub._status.mode='two';
});
check('普通2v2退出旧友伤公式，不随身份标记或敌方人数返回奖励',()=>{
 const {me,ally}=setup(true,false);
 for(const patch of [{},{identityShown:true},{identity:'friend'}]){
  delete ally.identity;delete ally.identityShown;Object.assign(ally,patch);
  assert.equal(strategy.decisionBoost(me,act('sha',ally)),0);
  stub.game.players=[me,ally];
  assert.equal(strategy.decisionBoost(me,act('sha',ally)),0);
  stub.game.players.push(player('enemy',false));
 }
});
check('2v2 异常边界支持本地和联机配置兜底，运行时模式优先',()=>{
 const {me,ally}=setup(false,true);delete ally.side;
 stub._status.mode=undefined;stub._status.connectMode=false;configMode='two';
 let before=attitudeCalls;
 assert.equal(strategy.isSameCamp(me,ally),false);assert.equal(attitudeCalls,before);
 stub._status.connectMode=true;stub.lib.configOL.versus_mode='2v2';
 assert.equal(strategy.isSameCamp(me,ally),false);assert.equal(attitudeCalls,before);
 stub._status.mode='3v3';
 assert.equal(strategy.isSameCamp(me,ally),true);assert.equal(attitudeCalls,before+1);
 stub._status.connectMode=false;
});
check('其他 versus 子模式保留缺失 side 的态度兼容路径',()=>{
 const {me,ally}=setup(true,false);delete ally.side;
 for(const submode of ['standard','three','3v3','four','4v4','siguo']){
  stub._status.mode=submode;
  assert.equal(strategy.isSameCamp(me,ally),true);
 }
 assert.equal(strategy.getCamp({identity:'legacy'}),'legacy');
 assert.equal(strategy.getCamp(me),'true');
});
check('未启用专项模型或改动其他模式路由',()=>{
 for(const other of ['doudizhu','identity','guozhan','single']){
  mode=other;stub._status.mode='two';
  assert.equal(getModeStrategy(),MODE_STRATEGIES[other]);
 }
 mode='versus';assert.equal(getModeStrategy(),strategy);
 assert.equal(strategy.useIdentityInference,false);
 assert.equal(strategy.useNeiZhuAI,false);
});
assert.equal(diagnostics.filter(s=>!s.includes('missing public player.side')).length,0,
 '生产模块不应静默吞掉意外异常');
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 team and mode detection');
