// 4.4 回归：chooseToUse 护栏必须与「决策是否成功 / 生命周期是否绑上」解耦。
// 症状：4.4 把 installAIUseTargetGuard 排在 stageExecutionDecision 之后、且整段搬进
// bindChoiceLifecycle 的 setup，任何早退或绑不上都会让宿主原生 AI 重新自由选目标，
// 表现为身份局「拆顺打队友」「不救判定区」复发且无日志。
import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,identity='fan'){Object.assign(this,{playerid:id,identity,identityShown:true,group:identity==='fan'?'wei':'wu',side:identity==='fan',hp:3,maxHp:4,hand:[],equip:[],judge:[],alive:true});}
 getCards(z){return z==='h'||z==='hs'?this.hand:z==='e'?this.equip:z==='j'?this.judge:[];}
 countCards(z,filter){const c=this.getCards(z);return typeof filter==='function'?c.filter(filter).length:c.length;}
 hasSkill(){return false;}hasSkillTag(){return false;}isOnline2(){return false;}canUse(){return true;}getEquip(){return null;}
 // 宿主事件：故意不带 pushHandler / after，模拟「bindChoiceLifecycle 绑不上」的宿主。
 chooseToUse(){return {name:'chooseToUse',type:'phase',player:this,parent:stub._status.event,filterCard:()=>true,filterTarget:()=>true};}
}
const human=new Player('human'),ally=new Player('ally'),enemy=new Player('enemy','zhu');
human.hand=[{name:'sha',value:4}];ally.hand=[{name:'shan',value:2}];enemy.hand=[{name:'sha',value:4}];
const stub={lib:{config:{},card:{guohe:{},shunshou:{},sha:{}},skill:{},element:{Player},filter:{cardEnabled:()=>true,cardEnabled2:()=>true,cardUsable:()=>true,targetEnabled:()=>true,targetInRange:()=>true,canBeDiscarded:()=>true}},
 game:{me:human,players:[human,ally,enemy],dead:[],roundNumber:1,writeFile:()=>{}},
 get:{mode:()=>'identity',name:c=>c?.name,value:c=>c?.value??4,subtypes:c=>c?.subtypes||[],attitude:(a,b)=>a.group===b.group?4:-4,effect:()=>12,damageEffect:()=>-2,recoverEffect:()=>2,identityList:()=>['zhu','zhong','fan','nei']},
 _status:{mode:'normal',auto:true},ui:{selected:{cards:[],targets:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};Object.assign(globalThis,stub);
register('./noname-stub-loader.mjs',import.meta.url);
const {installUseOverride,uninstallUseOverride}=await import('../score/decision/override/use.js?v=41a');
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};

const before=ally.chooseToUse();
installUseOverride();
try{
 check('生命期绑不上也装护栏：filterTarget 必须被包装（不再是原函数）',()=>{
  const ev=ally.chooseToUse();
  assert.notEqual(ev.filterTarget,before.filterTarget);
  assert.equal(typeof ev.filterTarget,'function');
 });
 check('护栏语义在离线宿主上也生效：身份局盟友不可被拆/顺',()=>{
  const ev=ally.chooseToUse();
  const guohe={name:'guohe',value:6};
  assert.equal(ev.filterTarget(guohe,ally,ally),true,'自己永远合法');
  assert.equal(ev.filterTarget(guohe,ally,human),false,'盟友应被拦');
  assert.equal(ev.filterTarget(guohe,ally,enemy),true,'敌人应放行');
 });
}finally{uninstallUseOverride();}
console.log(`Use guard wiring tests: ${n} passed, 0 failed`);
process.exit(0);
