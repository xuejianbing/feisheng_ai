// Real production bridges; native request -> distinct returned GameEvent like Player.chooseToUse.
import assert from 'node:assert/strict';
import {register} from 'node:module';
let nativeLifecycle=false;
class ChoiceEvent{
 constructor(name){this.name=name;this.after=[];this.handlers=[];}
 pushHandler(fn){this.handlers.push(fn);}
 setContent(fn){this.content=fn;}
 begin(){for(const fn of this.handlers)fn(this,{state:'begin'});}
}
class Player{
 constructor(id,identity='fan'){Object.assign(this,{playerid:id,identity,hp:3,maxHp:4,hand:[],equip:[]});}
 getCards(z){return z==='e'?this.equip:this.hand;}countCards(z){return this.getCards(z).length;}
 hasSkill(){return false;}hasSkillTag(){return false;}getSkills(){return this.skills||[];}isOnline2(){return false;}
 chooseCard(){return {};}chooseBool(){return {};}chooseTarget(){return {};}
 chooseToUse(params){if(failHost)throw Error('native-host-error');const fields={name:'chooseToUse',player:this,parent:stub._status.event,...params};return nativeLifecycle?Object.assign(new ChoiceEvent('chooseToUse'),fields):fields;}
}
const human=new Player('human'),bot=new Player('bot'),enemy=new Player('enemy','zhu');
const wx={name:'wuxie'},sha={name:'sha'},red={name:'shan',color:'red'};bot.hand=[wx,sha,red];bot.equip=[{name:'zhuge',subtypes:['equip1'],value:4}];
let mode='doudizhu',damage=-2,failHost=false;
const stub={lib:{config:{},element:{Player,GameEvent:ChoiceEvent},card:{huogong:{},jiedao:{}},skill:{},filter:{cardEnabled:()=>true,cardEnabled2:()=>true,cardUsable:()=>true,targetEnabled:()=>true,targetInRange:()=>true}},game:{me:human,players:[human,bot,enemy],dead:[],log(){},writeFile(){}},get:{mode:()=>mode,name:c=>c?.name,value:()=>4,subtypes:c=>c.subtypes||[],attitude:(a,b)=>a.identity===b.identity?5:-5,damageEffect:()=>damage,effect:()=>12},_status:{mode:'normal'},ui:{selected:{cards:[],targets:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {evaluateWuxie}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
const {installWuxieOptimization}=await import('../score/decision/response/wuxieOptimization.js?v=41a');
const use=await import('../score/decision/override/use.js?v=41a');
const {installJiedaoResponseBridge}=await import('../score/decision/response/jiedaoResponse.js?v=41a');
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
function reset(optimized){
 stub.lib.config.extension_无名AI_tacticalWuxie=optimized;delete stub.lib.config.extension_无名AI_responseAI;
 delete stub.lib.config.extension_无名AI_hardOverride;delete stub.lib.config.extension_无名AI_override_respond;
 mode='doudizhu';stub._status.mode='normal';stub._status.auto=false;stub.game.me=human;bot.alive=true;delete bot.isIn;delete bot.isOnline2;damage=-2;failHost=false;tactical.captureTacticalSettings();
}
function install(optimized){if(optimized)return installWuxieOptimization(evaluateWuxie);use.installUseOverride();return ()=>use.uninstallUseOverride();}
function req(){return {type:'wuxie',state:1,info_map:{card:{name:'huogong'},player:enemy,target:human,targets:[human]},ai1(){return -9;}};}
for(const optimized of [true,false]){
 for(const [name,mutate] of [
  ['关闭响应AI',()=>stub.lib.config.extension_无名AI_responseAI=false],
  ['实际GameEvent结束',(_,event)=>event.finished=true],
  ['实际GameEvent取消',(_,event)=>event.cancelled=true],
  ['原请求结束',request=>request.finished=true],
  ['托管转手动',()=>stub.game.me=bot],
  ['转为远端控制',()=>bot.isOnline2=()=>true],
  ['响应者离场',()=>bot.isIn=()=>false],
  ['换局',()=>intent.resetCooperativeTrickIntents()],
  ['切换模式',()=>mode='identity'],
  ['切换子模式',()=>stub._status.mode='kaihei'],
  ['卸载',(_,__,cleanup)=>cleanup()],
  ['专项开关切换到另一条响应路径',()=>{stub.lib.config.extension_无名AI_tacticalWuxie=!optimized;tactical.captureTacticalSettings();}],
 ])check(`${optimized?'优化':'旧版'}无懈：${name}后旧回调回退原生`,()=>{
  reset(optimized);const cleanup=install(optimized);
  try{const request=req(),event=bot.chooseToUse(request);assert.notEqual(event,request);assert(event.ai1(wx)>0);mutate(request,event,cleanup);assert.equal(event.ai1(wx),-9);}
  finally{cleanup();}
 });
 check(`${optimized?'优化':'旧版'}无懈：原生回调保留this、全部参数和异常`,()=>{
  reset(optimized);const cleanup=install(optimized);let calls=0;
  try{const request=req(),receiver={tag:'receiver'};request.ai1=function(...args){calls++;assert.equal(this,receiver);assert.deepEqual(args,[wx,'extra']);throw Error('native-score-error');};
   const event=bot.chooseToUse(request);event.finished=true;
   assert.throws(()=>event.ai1.call(receiver,wx,'extra'),/native-score-error/);assert.equal(calls,1);
  }finally{cleanup();}
 });
 check(`${optimized?'优化':'旧版'}无懈：每次评分复核收益，不保存旧的出牌结论`,()=>{
  reset(optimized);const cleanup=install(optimized);
  try{const event=bot.chooseToUse(req());assert(event.ai1(wx)>0);damage=2;assert.equal(event.ai1(wx),0);}finally{cleanup();}
 });
 check(`${optimized?'优化':'旧版'}无懈：读取实际返回窗口的反无懈状态`,()=>{
  reset(optimized);const cleanup=install(optimized);
  try{const request=req(),event=bot.chooseToUse(request);assert(event.ai1(wx)>0);event.state=-1;assert.equal(request.state,1);assert.equal(event.ai1(wx),0);}finally{cleanup();}
 });
 check(`${optimized?'优化':'旧版'}无懈：卸载不覆盖后安装的包装器，重装不复活旧回调`,()=>{
  reset(optimized);const original=Player.prototype.chooseToUse,cleanup=install(optimized),ours=Player.prototype.chooseToUse;
  const event=bot.chooseToUse(req()),later=function(...args){return ours.apply(this,args);};Player.prototype.chooseToUse=later;
  cleanup();assert.equal(Player.prototype.chooseToUse,later);assert.equal(event.ai1(wx),-9);
  const removeAgain=install(optimized);try{assert.equal(event.ai1(wx),-9);assert(bot.chooseToUse(req()).ai1(wx)>0);}finally{removeAgain();Player.prototype.chooseToUse=original;}
 });
 check(`${optimized?'优化':'旧版'}无懈：创建宿主窗口失败后不能遗留有效的优化回调`,()=>{
  reset(optimized);const cleanup=install(optimized),request=req();failHost=true;
  try{assert.throws(()=>bot.chooseToUse(request),/native-host-error/);assert.equal(request.ai1(wx),-9);}finally{failHost=false;cleanup();}
 });
}
check('卸载完成辅助桥清理，不引用已经删除的DEGRADED',()=>{
 reset(false);const proto=Player.prototype,original=[proto.chooseCard,proto.chooseBool,proto.chooseTarget];
 const cleanup=install(false);assert(proto.__djsc_orig_chooseCard);assert(proto.__djsc_orig_chooseBool);assert(proto.__djsc_orig_chooseTarget);cleanup();
 assert.deepEqual([proto.chooseCard,proto.chooseBool,proto.chooseTarget],original);
 assert(!proto.__djsc_orig_chooseCard&&!proto.__djsc_orig_chooseBool&&!proto.__djsc_orig_chooseTarget);
});
check('旧版无懈同时遵守执行网关的响应接管开关',()=>{
 reset(false);const cleanup=install(false);try{const event=bot.chooseToUse(req());assert(event.ai1(wx)>0);stub.lib.config.extension_无名AI_override_respond=false;assert.equal(event.ai1(wx),-9);}finally{cleanup();}
});
for(const [name,mutate] of [
 ['换局',()=>intent.resetCooperativeTrickIntents()],['结束',event=>event.finished=true],['模式切换',()=>mode='identity'],
 ['响应关闭',()=>stub.lib.config.extension_无名AI_responseAI=false],['手动接管',()=>stub.game.me=bot],['卸载',(_,cleanup)=>cleanup()]
])check(`借刀转化技能的已捕获材料回调在${name}后回退`,()=>{
 reset(true);bot.skills=['wusheng'];stub.lib.skill.wusheng={enable:'chooseToUse',viewAs:{name:'sha'},filterCard:c=>c.color==='red',selectCard:1};
 const root={name:'jiedao',player:human,target:bot,addedTarget:enemy,card:{name:'jiedao'}};
 const event={name:'chooseToUse',player:bot,parent:root,sourcex:enemy,skill:'wusheng',filterCard:()=>true};stub._status.event=event;
 let saved;stub.ai.basic={chooseCard(score){saved=score;return score(red);}};
 const cleanup=installJiedaoResponseBridge();try{assert(stub.ai.basic.chooseCard(()=>-9)>0);mutate(event,cleanup);assert.equal(saved(red),-9);}finally{cleanup();bot.skills=[];delete stub._status.event;}
});
check('合并后的普通选择在事件开始时安装限制，保留宿主后设过滤器，卸载立即恢复',()=>{
 reset(false);nativeLifecycle=true;const cleanup=install(false);
 try{
  const initial=()=>true,afterSet=()=>true;
  const event=bot.chooseToUse({type:'dying',dying:enemy,filterCard:initial});
  assert.equal(event.filterCard,initial);assert(event.__djscChoiceTrace);
  event.filterCard=afterSet;event.begin();assert.notEqual(event.filterCard,afterSet);
  assert.equal(event.filterCard({name:'tao'},bot,event),false);assert.equal(event.filterCard(sha,bot,event),true);
  cleanup();assert.equal(event.filterCard,afterSet);assert.equal(event.__djsc_tao_guard,undefined);
 }finally{cleanup();nativeLifecycle=false;}
});
check('合并后的普通选择在开始前卸载，不再应用旧限制',()=>{
 reset(false);nativeLifecycle=true;const cleanup=install(false);
 try{const native=()=>true,event=bot.chooseToUse({type:'dying',dying:enemy,filterCard:native});cleanup();event.begin();assert.equal(event.filterCard,native);assert.equal(event.filterCard({name:'tao'},bot,event),true);}
 finally{cleanup();nativeLifecycle=false;}
});
check('重新安装后，上一轮创建的普通选择不会借用新一轮权限',()=>{
 reset(false);nativeLifecycle=true;const cleanup=install(false);let again;
 try{const native=()=>true,event=bot.chooseToUse({type:'dying',dying:enemy,filterCard:native});cleanup();again=install(false);event.begin();assert.equal(event.filterCard,native);}
 finally{again?.();cleanup();nativeLifecycle=false;}
});
console.log(`Response lifecycle tests: ${passed} passed, 0 failed`);
process.exit(0);
