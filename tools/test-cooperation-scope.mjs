// Production entry points across modes: preserve native callbacks, old rescue and guard behavior.
import assert from 'node:assert/strict';
import {register} from 'node:module';
const native1=()=>77,native2=()=>66;
class Player{
 constructor(id,identity='fan'){Object.assign(this,{playerid:id,identity,identityShown:true,group:identity==='fan'?'wei':'wu',side:identity==='fan',hp:2,maxHp:4,hand:[],equip:[],judge:[],alive:true});}
 getCards(z){return z==='h'||z==='hs'?this.hand:z==='e'?this.equip:z==='j'?this.judge:[];}
 countCards(z,filter){const cards=this.getCards(z);return typeof filter==='function'?cards.filter(filter).length:cards.length;}
 hasSkill(){return false;}hasSkillTag(){return false;}isOnline2(){return false;}canUse(){return true;}getEquip(){return null;}
 chooseToUse(){return {name:'chooseToUse',type:'phase',player:this,parent:stub._status.event,ai1:native1,ai2:native2};}
}
const human=new Player('human'),bot=new Player('bot'),enemy=new Player('enemy','zhu');
const sha={name:'sha',value:4},trick={name:'jiedao'},weapon={name:'zhuge',subtypes:['equip1'],value:4},lion={name:'baiyin',value:4};
human.hand=[sha,{name:'shan'},{name:'tao'},{name:'huogong'}];bot.hand=[sha,{name:'wuxie'}];bot.equip=[weapon];human.equip=[weapon,lion];
let mode='doudizhu';
const stub={lib:{config:{},card:{huogong:{},jiedao:{singleCard:true,filterTarget:()=>true,filterAddedTarget:()=>true}},skill:{},element:{Player},filter:{cardEnabled:()=>true,cardEnabled2:()=>true,cardUsable:()=>true,targetEnabled:()=>true,targetInRange:()=>true,canBeDiscarded:()=>true}},
 game:{me:human,players:[human,bot,enemy],dead:[]},get:{mode:()=>mode,name:c=>c?.name,value:c=>c.value??4,subtypes:c=>c.subtypes||[],attitude:(a,b)=>a.identity===b.identity?5:-5,effect:()=>12,damageEffect:()=>-2,recoverEffect:()=>2},_status:{mode:'normal'},ui:{selected:{cards:[],targets:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {cooperationPolicyEnabled}=await import('../score/decision/strategy/cooperationPolicy.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {friendlyStripPlan}=await import('../score/decision/strategy/friendlyStripPlan.js?v=41a');
const pair=await import('../score/decision/cards/jiedaoEvaluator.js?v=41a');
const {installJiedaoChoiceBridge}=await import('../score/decision/cards/jiedaoChoiceBridge.js?v=41a');
const {evaluateJiedaoResponse,installJiedaoResponseBridge}=await import('../score/decision/response/jiedaoResponse.js?v=41a');
const {evaluateWuxie}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
const {makeActionCandidate}=await import('../score/decision/state/actionCandidate.js?v=41a');
const {guardCheck}=await import('../score/model/net/modelGuard.js?v=41a');
const {actionValue}=await import('../score/decision/relations/relations.js?v=41a');
const {hostJiedaoPlan}=await import('../js/content/optimization.js?v=41a');
const {commonSuggestionFusionFor}=await import('../score/decision/utility/suggestionFusion.js?v=41a');
const {readModeContext,readModeScope}=await import('../score/foundation/runtime/modeContext.js?v=41a');
function scope(m,sub='normal',enabled=true){mode=m;stub._status.mode=sub;stub.lib.config.extension_无名AI_classicDoudizhu=enabled;tactical.captureTacticalSettings();}
function manual(){const choice={name:'chooseToUse',type:'phase',player:human,parent:{name:'phaseUse',player:human}};const root={name:'useCard',player:human,card:{name:'huogong'},targets:[human],parent:choice};intent.observeCooperativeTrickUse(root,human,choice);return root;}
const ctx=root=>({source:human,target:human,targets:[human],card:root.card,originalSpellId:'huogong',effectScope:'target'});
const request=root=>({type:'wuxie',state:1,info_map:{player:human,target:human,targets:[human],card:root.card}});
function response(){const root={name:'jiedao',player:human,target:bot,addedTarget:enemy,card:trick};return {name:'chooseToUse',player:bot,sourcex:enemy,parent:root,filterCard:()=>true,filterTarget:()=>true};}
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
for(const sub of ['normal','kaihei','huanle'])check(`经典斗地主 ${sub}：意图、拆顺、借刀与模型护栏使用同一范围`,()=>{
 scope('doudizhu',sub);assert(cooperationPolicyEnabled());assert.equal(commonSuggestionFusionFor(readModeContext()),'reasoned');
 const root=manual();assert(intent.cooperativeTrickIntent(bot,ctx(root)));assert.equal(evaluateWuxie(bot,request(root)).use,false);
 assert.equal(friendlyStripPlan(bot,{name:'guohe'},human).kind,'lion-recovery');
 const plan=pair.evaluateJiedaoPair(bot,human,enemy,trick);assert(plan.use);assert(hostJiedaoPlan(bot,human).use);
 const a=makeActionCandidate({id:'jiedao',type:'card',score:4,targetObj:human,targetList:[human,enemy],jiedaoPair:plan});assert.equal(guardCheck(bot,a,{}).ok,true);
 assert.equal(evaluateJiedaoResponse(bot,response()).resolved,true);
});
for(const [m,sub,enabled] of [['identity','normal',true],['guozhan','normal',true],['versus','two',true],['single','normal',true],['unknown','normal',true],['doudizhu','binglin',true],['doudizhu','online',true],['doudizhu','future',true],['doudizhu','unknown',true],['doudizhu','normal',false]])check(`${m}/${sub}/专项=${enabled}：新增策略退出，旧救援和原生评分保留`,()=>{
 scope(m,sub,enabled);assert.equal(cooperationPolicyEnabled(),false);assert.equal(commonSuggestionFusionFor(readModeContext()),'legacy');
 const root=manual();assert.equal(intent.cooperativeTrickIntent(bot,ctx(root)),null);assert.equal(intent.trickUseEvidence(ctx(root)).state,'unknown');
 assert.equal(evaluateWuxie(bot,request(root)).playerIntentRespected,false);
 assert.equal(evaluateWuxie(bot,request(root)).resolved,true); // No Doudizhu unknown-intent rule outside its scope.
 assert.equal(friendlyStripPlan(bot,{name:'guohe'},human),undefined);assert.equal(actionValue(bot,{id:'guohe',targetObj:human,base:4}),-8);
 human.judge=[{name:'lebu'}];assert.equal(tactical.stripPlan(bot,{name:'guohe'},human,true).kind,'rescue');human.judge=[];
 assert.equal(tactical.stripPlan(bot,{name:'guohe'},human,true),null);
 const removal=makeActionCandidate({id:'guohe',type:'card',score:4,targetObj:human});
 assert.equal(guardCheck(bot,removal,{}).ok,false);
 human.judge=[{name:'legacy-delayed'}];assert.equal(guardCheck(bot,removal,{}).ok,true);human.judge=[];
 assert.equal(pair.bestJiedaoPair(bot).resolved,false);assert.equal(pair.hostJiedaoTargetDecision(bot,human,trick),null);assert.equal(hostJiedaoPlan(bot,human),null);
 const forged=makeActionCandidate({id:'jiedao',type:'card',score:4,targetObj:human,targetList:[human,enemy],jiedaoPair:{use:true,holder:human,victim:enemy}});assert.equal(guardCheck(bot,forged,{}).ok,false);
 const e=response();assert.equal(evaluateJiedaoResponse(bot,e).resolved,false);
 for(const install of [installJiedaoChoiceBridge,installJiedaoResponseBridge]){
  const remove=install();try{stub._status.event=install===installJiedaoChoiceBridge?{name:'phaseUse',player:bot}:e.parent;
   const r=bot.chooseToUse();assert.equal(r.ai1,native1);assert.equal(r.ai2,native2);assert.equal(r.ai1(sha),77);assert.equal(r.ai2(enemy),66);assert.equal(r.result,undefined);
  }finally{remove();}
 }
});
check('已生成的借刀回调在切换到范围外模式后回退原生',()=>{
 scope('doudizhu');stub._status.event={name:'phaseUse',player:bot};
 const remove=installJiedaoChoiceBridge();try{const r=bot.chooseToUse();stub.ui.selected={cards:[trick],targets:[human]};assert(r.ai2(enemy)>0);mode='identity';assert.equal(r.ai1(trick),77);assert.equal(r.ai2(enemy),66);}finally{remove();stub.ui.selected={cards:[],targets:[]};}
 scope('doudizhu');const e=response();stub._status.event=e.parent;const removeResponse=installJiedaoResponseBridge();
 try{const r=bot.chooseToUse();assert.notEqual(r.ai1(sha),77);mode='guozhan';assert.equal(r.ai1(sha),77);assert.equal(r.ai2(enemy),66);}finally{removeResponse();}
});
check('总开关关闭同时撤回借刀评分、响应和护栏权限',()=>{
 scope('doudizhu');stub.lib.config.extension_无名AI_tacticalOptimization=false;tactical.captureTacticalSettings();
 try{assert.equal(pair.bestJiedaoPair(bot).resolved,false);assert.equal(evaluateJiedaoResponse(bot,response()).resolved,false);assert.equal(friendlyStripPlan(bot,{name:'guohe'},human),undefined);}finally{delete stub.lib.config.extension_无名AI_tacticalOptimization;tactical.captureTacticalSettings();}
});
check('统一模式读取支持离线和联机配置，不从其他模式借用 normal 子模式',()=>{
 scope('doudizhu');delete stub._status.mode;stub.get.config=k=>k==='doudizhu_mode'?'kaihei':undefined;assert.equal(readModeScope().submode,'kaihei');assert(cooperationPolicyEnabled());
 stub._status.connectMode=true;stub.lib.configOL={doudizhu_mode:'binglin'};assert.equal(readModeScope().submode,'binglin');assert.equal(cooperationPolicyEnabled(),false);
 mode='identity';stub.lib.configOL.doudizhu_mode='normal';assert.equal(readModeScope().submode,'unknown');assert.equal(cooperationPolicyEnabled(),false);
 delete stub._status.connectMode;delete stub.lib.configOL;delete stub.get.config;
});
console.log(`Cooperation scope tests: ${n} passed, 0 failed`);
process.exit(0);
