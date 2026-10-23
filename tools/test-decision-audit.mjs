// node tools/test-decision-audit.mjs [--examples DIR]
// 真实生产模块的只读观测、响应桥接与归档导出；宿主桩不证明游戏内收益。
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const hand=[{name:'wuxie'},{name:'sha'},{name:'shan'},{name:'tao'}];
class Player {
 constructor(id,role='fan'){this.playerid=id;this.identity=role;this.hp=3;this.maxHp=4;}
 getCards(zone){return zone==='h'?hand:[];}
 countCards(zone,filter){const cards=this.getCards(zone);return filter?cards.filter(filter).length:cards.length;}
 hasSkill(){return false;} hasSkillTag(){return false;} isOnline2(){return false;}
 canUse(){return true;} getEquip(){return null;} getSkills(){return [];}
 chooseToUse(req){return req;}
}
const human=new Player('human'),ally=new Player('ally'),enemy=new Player('enemy','zhu');
let damageCalls=0;
const stub={lib:{config:{},card:{list:[],huogong:{},lebu:{ai:{result:{target:()=>-4}}}},skill:{},filter:{cardEnabled:()=>true,cardUsable:()=>true},element:{Player}},
 game:{players:[human,ally,enemy],dead:[],me:human,addGlobalSkill(){}},
 get:{mode:()=> 'doudizhu',config:()=>undefined,name:c=>c?.name,value:()=>4,damageEffect:()=>{damageCalls++;return -1;},attitude:(_,t)=>t===enemy?-5:5},
 _status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const utility=await import('../score/decision/utility/remainingUtility.js?v=41a');
const {createEvaluationAudit}=await import('../score/decision/analysis/decisionAudit.js?v=41a');
const {createDecisionStages}=await import('../score/decision/analysis/decisionStages.js?v=41a');
const choices=await import('../score/perception/journal/choiceAudit.js?v=41a');
const {createMatchArchive,matchFiles}=await import('../score/perception/journal/matchArchive.js?v=41a');
const {buildDoudizhuDiagnostics}=await import('../score/perception/journal/doudizhuDiagnostics.js?v=41a');
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {installWuxieOptimization}=await import('../score/decision/response/wuxieOptimization.js?v=41a');
const {evaluateWuxie}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const mode=await import('../score/foundation/runtime/modeContext.js?v=41a');
const {getModeStrategy}=await import('../score/decision/strategy/modeStrategy.js?v=41a');
const delayed=await import('../score/decision/strategy/delayedOptimization.js?v=41a');
const {applyTiesuoRecastTiming}=await import('../score/decision/cards/tiesuoRecast.js?v=41a');
const {applyClassicModel}=await import('../score/model/train/classicRuntime.js?v=41a');
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const examples=[];
function suggestions(shared=.8){return [
 {source:'modeStrategy',dimension:'team',run:rows=>rows.forEach(a=>a.score+=getModeStrategy().decisionBoost(ally,a))},
 {source:'sharedKnowledge',dimension:'team',run:rows=>rows.forEach(a=>a.score+=shared)},
];}
function candidate(score=4,id='sha',target=enemy){return {type:'card',id,targetObj:target,score,policy:{eligible:true,priorityTier:'normal'}};}
function fixture(name,score=4,shared=.8){
 const a=candidate(score),audit=createEvaluationAudit({enabled:true,detailed:true,settings:{fixture:true},control:'ai'});
 audit.record('beforeCommonSuggestions',[a]);utility.applyCommonUtilitySuggestions([a],suggestions(shared),{audit:true});audit.record('afterCommonSuggestions',[a]);
 const stages=createDecisionStages(a,audit.snapshot([a],a));stages.record('classicModel',a,a,{status:'no-active-model'});
 const record={kind:'decisionSuggestion',playerId:'ally',data:{transactionId:name,actorId:'ally',modeContext:{mode:'doudizhu',sessionId:'s'},winner:{type:'card',id:'sha',target:'enemy'},decisionStages:stages.snapshot(a)}};
 examples.push(record);return a;
}
await check('开启对账不改变分数、目标和policy',()=>{
 for(const base of [0,.1,4,-4])for(const shared of [0,.8,-.4]){
  const a=candidate(base),b=candidate(base);utility.applyCommonUtilitySuggestions([a],suggestions(shared));utility.applyCommonUtilitySuggestions([b],suggestions(shared),{audit:true});
  assert.equal(a.score,b.score);assert.equal(a.targetObj,b.targetObj);assert.deepEqual(a.policy,b.policy);assert.deepEqual(a.utilityVector,b.utilityVector);
 }
});
await check('独立记录未采用的专项建议及聚合胜出者',()=>{
 const a=fixture('same-dimension');assert.equal(a.score,4.8);const dim=a.commonUtilityAudit.dimensions[0];
 assert.equal(dim.suggestions[0].status,'not-selected-same-dimension');assert.equal(dim.positiveSource,'sharedKnowledge');assert.match(dim.suggestions[0].reason,/地主/);
});
await check('零分上限归零可解释，非开关未运行',()=>{
 const a=fixture('zero-cap',0,0);const suggestion=a.commonUtilityAudit.dimensions[0].suggestions[0];
 assert.equal(a.score,0);assert.equal(suggestion.delta,.35);assert.equal(suggestion.status,'limited');
});
await check('首选不变但加分有效仍留有证据',()=>{
 const a=fixture('score-only',4,0);assert.equal(a.score,4.35);assert.equal(a.commonUtilityAudit.dimensions[0].suggestions[0].status,'included-in-aggregate');
});
await check('审计快照不写policy或收益账本，不调用宿主估值',()=>{
 const a=candidate();delete a.policy;const before=damageCalls;
 const audit=createEvaluationAudit({enabled:true,detailed:true});audit.record('before',[a]);const r=audit.snapshot([a],a);
 assert.equal(a.policy,undefined);assert.equal(a.utilityVector,undefined);assert.equal(damageCalls,before);assert.equal(r.independentModelChoice,false);
});
await check('详细关闭仍保留设置摘要，不记录候选细节',()=>{
 const a=candidate(),audit=createEvaluationAudit({enabled:true,settings:{enabled:true}});audit.record('before',[a]);const r=audit.snapshot([a],a);
 assert.deepEqual(r.stages,[]);assert.deepEqual(r.candidates,[]);assert.equal(r.settings.enabled,true);
});
await check('候选和早期阶段有界，最终候选优先保留',()=>{
 const rows=Array.from({length:40},(_,i)=>candidate(i,'card'+i));const audit=createEvaluationAudit({enabled:true,detailed:true});
 for(let i=0;i<20;i++)audit.record('stage'+i,rows);const r=audit.snapshot(rows,rows.at(-1));
 assert.equal(r.stages.length,6);assert.equal(r.candidates.length,8);assert.equal(r.candidates[0].action.id,'card39');
});
await check('模块故障不会因对账改变原有隔离行为',()=>{
 const a=candidate();utility.applyCommonUtilitySuggestions([a],[{source:'broken',dimension:'team',run(){throw Error('fixture');}}],{audit:true});
 assert.equal(a.score,4);assert.deepEqual(a.commonUtilityAudit.failedSources,['broken']);
});
await check('本局生效设置与菜单后续更改可区分',()=>{
 tactical.captureTacticalSettings();stub.lib.config['extension_无名AI_tacticalFire']=false;
 assert.equal(tactical.tacticalSettingsSnapshot().fire,true);tactical.captureTacticalSettings();assert.equal(tactical.tacticalSettingsSnapshot().fire,false);
 delete stub.lib.config['extension_无名AI_tacticalFire'];tactical.captureTacticalSettings();
});
await check('三种斗地主模式与下一局切换保留',()=>{
 for(const submode of ['normal','kaihei','huanle']){stub._status.mode=submode;assert.equal(getModeStrategy().decisionBoost(ally,candidate()),.35);}
 stub._status.mode='normal';mode.beginModeContext('s');stub.lib.config['extension_无名AI_classicDoudizhu']=false;assert.equal(mode.classicEnabled(),true);mode.closeModeContext();assert.equal(mode.classicEnabled(),false);delete stub.lib.config['extension_无名AI_classicDoudizhu'];
});
await check('贴兵贴乐桥接保留飞扬自身判定信号',()=>{
 tactical.captureTacticalSettings();delayed.installDelayedBridges();assert.equal(stub.lib.card.lebu.ai.result.target(ally,ally),-4);
});
await check('铁索提前重铸不抢斩杀或已开始的酒杀',()=>{
 const saved=hand.slice();hand.push({name:'tiesuo'});ally.canRecast=()=>true;
 const recast=()=>({type:'card',id:'tiesuo',recast:true,score:2});
 try{let r=recast();applyTiesuoRecastTiming(ally,[r,{type:'card',id:'sha',rule:'kill',score:3}]);assert.equal(r.policy.priorityTier,'normal');
 ally.hasSkill=name=>name==='jiu';r=recast();applyTiesuoRecastTiming(ally,[r,{type:'card',id:'sha',score:3}]);assert.equal(r.policy.priorityTier,'normal');
 ally.hasSkill=()=>false;r=recast();applyTiesuoRecastTiming(ally,[r,{type:'card',id:'sha',score:3}]);assert.equal(r.policy.priorityTier,'critical');
 }finally{hand.splice(0,hand.length,...saved);delete ally.canRecast;delete ally.hasSkill;}
});
await check('队友兵乐救援仍能形成真实拆顺计划',()=>{
 stub.lib.filter.canBeDiscarded=()=>true;stub.lib.filter.canBeGained=()=>true;
 const judge={name:'lebu'};const friend=new Player('friend');friend.getCards=zone=>zone==='j'?[judge]:zone==='h'?hand:[];
 const plan=tactical.stripPlan(ally,{name:'guohe'},friend);assert.equal(plan.kind,'rescue');assert.equal(plan.card,judge);
});
await check('缺少宿主回复语义时不臆造白银狮子配合',()=>{
 const lion={name:'baiyin'};const friend=new Player('lion-friend');friend.getCards=zone=>zone==='e'?[lion]:zone==='h'?hand:[];
 assert.equal(tactical.stripPlan(ally,{name:'guohe'},friend),null);
});
await check('拆距离马后攻击的计划仍能进入选牌',()=>{
 stub.get.effect=()=>1;const mount={name:'hualiu'};enemy.getEquip=slot=>slot===3?mount:null;
 try{const p=tactical.stripPlan(ally,{name:'guohe'},enemy);assert.equal(p.kind,'mount');assert.equal(p.card,mount);}
 finally{delete enemy.getEquip;}
});
await check('古锭刀酒杀顺序模块实际返回建议',()=>{
 enemy.countCards=()=>0;ally.getEquip=()=>null;stub.get.effect=()=>1;
 try{assert.equal(tactical.weaponOrder(ally,{name:'guding'},1),15);ally.getEquip=()=>({name:'guding'});assert.equal(tactical.weaponOrder(ally,{name:'jiu'},1),14);assert.equal(tactical.extraCardOrder(ally,{name:'jiu'},1),14);}
 finally{delete enemy.countCards;delete ally.getEquip;}
});
await check('连弩与多张有效杀仍有实际顺序加成',()=>{
 hand.push({name:'sha'});try{assert.equal(tactical.extraCardOrder(ally,{name:'zhuge'},1),15);}finally{hand.pop();}
});
await check('专项模型关闭与无匹配版本有不同回退状态',()=>{
 const c={role:'farmer',enabled:true,group:'doudizhu-classic'};
 assert.equal(applyClassicModel([],{...c,specialistEnabled:false}).status,'disabled');assert.equal(applyClassicModel([],{...c,specialistEnabled:true}).status,'no-active-model');
});
let session='s';const events=[];
let cleanup=choices.installChoiceAudit(e=>{events.push(e);return events.length;},()=>session);
await check('详细诊断关闭时不输出响应记录',()=>{
 assert.equal(choices.beginChoiceAudit(false,ally,{},'response'),null);assert.equal(events.length,0);
});
await check('相同宿主事件稳定关联，重复评分有界且保留最终返回',()=>{
 const root={name:'useCard'},event={parent:root};
 for(let i=0;i<30;i++)choices.beginChoiceAudit(true,ally,event,'fire-selection').record('discard-scored',{aiScore:i});
 choices.beginChoiceAudit(true,ally,event,'fire-selection').record('discard-returned',{bool:true});
 assert.equal(events.length,6);assert.equal(events.at(-1).phase,'discard-returned');assert.equal(new Set(events.map(e=>e.rootActionId)).size,1);
});
await check('旧局异步返回不写入新局',()=>{
 const token=choices.beginChoiceAudit(true,ally,{},'fire-selection');session='s2';const before=events.length;token.record('discard-returned',{bool:true});assert.equal(events.length,before);
});
await check('卸载和重新安装后的旧闭包不能写档案',()=>{
 const token=choices.beginChoiceAudit(true,ally,{},'response');cleanup();cleanup=choices.installChoiceAudit(e=>{events.push(e);return 1;},()=>session);
 const before=events.length;token.record('evaluated',{});assert.equal(events.length,before);
});
await check('每局总量限制和缺失统计明确',()=>{
 for(let i=0;i<600;i++)choices.beginChoiceAudit(true,ally,{},'response').record('evaluated',{});
 assert.equal(choices.choiceAuditStats().recorded,512);assert(choices.choiceAuditStats().dropped>=88);
});
cleanup();
await check('档案拒收或抛错时仍有界，且不向游戏抛出诊断异常',()=>{
 let calls=0;const stop=choices.installChoiceAudit(()=>{calls++;throw Error('archive unavailable');},()=>session);
 try{for(let i=0;i<600;i++)choices.beginChoiceAudit(true,ally,{},'response').record('evaluated',{});
 assert.equal(calls,512);assert.equal(choices.choiceAuditStats().recorded,0);assert.equal(choices.choiceAuditStats().dropped,600);
 }finally{stop();}
});
session='s';const responseEvents=[];
cleanup=choices.installChoiceAudit(e=>{responseEvents.push(e);return 1;},()=>session);
await check('真实无懈桥接有记录但没有额外估值或调用旧ai1',()=>{
 stub.lib.config['extension_无名AI_tacticalDiagnostics']=true;tactical.captureTacticalSettings();
 const remove=installWuxieOptimization(evaluateWuxie);
 const choice={name:'chooseToUse',type:'phase',player:human,parent:{name:'phaseUse',player:human}};
 const root={name:'useCard',card:{name:'huogong'},player:human,targets:[human],parent:choice};
 intent.observeCooperativeTrickUse(root,human,choice);
 const req={type:'wuxie',parent:root,state:1,info_map:{card:root.card,player:human,target:human},ai1:()=>{throw Error('extra native scoring');}};
 try{const before=damageCalls;ally.chooseToUse(req);assert.equal(req.ai1(hand[0]),0);assert.equal(damageCalls-before,2);
 assert.equal(responseEvents[0].phase,'evaluated');assert.equal(responseEvents[1].phase,'material-scored');assert.equal(responseEvents[1].executionState,'suggested');}
 finally{remove();intent.finishCooperativeTrickUse(root);}
});
await check('responseAI关闭可以记录未运行原因',()=>{
 stub.lib.config['extension_无名AI_responseAI']=false;const remove=installWuxieOptimization(evaluateWuxie);
 try{ally.chooseToUse({type:'wuxie'});assert.equal(responseEvents.at(-1).reason,'response-off');}finally{remove();delete stub.lib.config['extension_无名AI_responseAI'];}
});
await check('火攻弃牌沿用宿主结果，记录返回不增加估值',async()=>{
 const result={bool:false,cards:[]};let hostCalls=0;
 stub.get.suit=()=> 'heart';
 stub.lib.card.huogong.content=async(e,t,p)=>{hostCalls++;return e.chooseToDiscard(e,p,enemy);};
 ally.chooseToDiscard=()=>({set(key,value){if(key==='ai')this.ai=value;return this;},async forResult(){this.ai(hand[1]);return result;}});
 tactical.installTacticalOptimization();
 const before=damageCalls;
 try{const returned=await stub.lib.card.huogong.content({name:'useCard',target:enemy,cards2:[{suit:'heart'}]},null,ally);
 assert.equal(returned,result);assert.equal(hostCalls,1);assert.equal(damageCalls-before,1);
 const record=responseEvents.find(e=>e.phase==='discard-returned');assert.equal(record.bool,false);assert.equal(record.executionState,'selection-returned');
 }finally{delete ally.chooseToDiscard;}
});
await check('拆顺评分记录不读取隐藏手牌名称，且不改变原评分',()=>{
 const secret={};Object.defineProperty(secret,'name',{get(){throw Error('hidden name read');}});
 const event={player:ally,target:enemy};stub.get.event=()=>event;stub.get.position=()=> 'h';enemy.countCards=()=>1;
 stub.lib.card.guohe={ai:{button:()=>7}};tactical.installStripButtonBridges();
 try{const score=stub.lib.card.guohe.ai.button({link:secret});assert.equal(score,30);
 const record=responseEvents.find(e=>e.domain==='strip-selection');assert.equal(record.planKind,'hand');assert.equal(record.selectionConfirmed,false);
 assert.equal(record.cardId,'guohe');assert.equal(record.aiScore,30);
 }finally{delete enemy.countCards;}
});
cleanup();
await check('旧档案显示未知，而非伪造模块未运行',()=>{
 const r=buildDoudizhuDiagnostics({matchId:'m',dropped:0,meta:{modeContext:{mode:'doudizhu'}},events:[{kind:'decision',playerId:'ally',data:{transactionId:'old',actorId:'ally',winner:{id:'sha'}}}]});
 assert.equal(r.rows[0].auditAvailability,'unavailable');assert.equal(r.choiceRecording.recorded,null);
});
const fixtureMatch={matchId:'audit-fixture',dropped:0,meta:{modeContext:{mode:'doudizhu',sessionId:'s'}},events:examples.map((e,i)=>({...e,eventId:i+1}))};
await check('真实导出包含设置、被压制建议、模型未参与状态',()=>{
 const files=matchFiles(fixtureMatch);assert.match(files['斗地主决策对账.txt'],/同维度未采用/);assert.match(files['斗地主决策对账.txt'],/受幅度上限限制/);assert.match(files['斗地主决策对账.txt'],/no-active-model/);
 assert.equal(JSON.parse(files['斗地主决策对账.json']).trainingEligible,false);
});
await check('跨局跨玩家记录不串联，响应评分不冒充执行',()=>{
 const valid={kind:'choiceAudit',matchId:'m',playerId:'ally',data:{schema:'choice-audit-v1',sessionId:'s',actorId:'ally',requestId:'r',domain:'response',phase:'material-scored',use:true}};
 const match={matchId:'m',dropped:0,meta:{modeContext:{mode:'doudizhu',sessionId:'s'}},events:[valid,{...valid,matchId:'other'},{...valid,playerId:'enemy'},{...valid,data:{...valid.data,sessionId:'old'}}]};
 const r=buildDoudizhuDiagnostics(match);assert.equal(r.choices.length,1);assert.equal(r.choices[0].events.length,1);assert.equal(r.choices[0].executionConfirmed,false);
});
await check('首选改变保留阶段归因，分数变化不冒充动作改变',()=>{
 const a=candidate(),b=candidate(5,'tao',ally),stages=createDecisionStages(a);stages.record('planner',a,b,{status:'selected-first-step'});stages.record('champion',b,{...b,score:6},{status:'active'});
 const r=stages.snapshot(b);assert.equal(r.stages[1].changed,true);assert.equal(r.stages[2].changed,false);
});
const exampleArg=process.argv.indexOf('--examples');
if(exampleArg>=0){const dir=resolve(process.argv[exampleArg+1]);mkdirSync(dir,{recursive:true});for(const [name,content] of Object.entries(matchFiles(fixtureMatch)))if(name.startsWith('斗地主'))writeFileSync(resolve(dir,name),name.endsWith('.txt')?'合成宿主桩示例；非真实对局，不用于训练标签。\n'+content+'\n':JSON.stringify({...JSON.parse(content),demonstrationOnly:true,provenance:'synthetic-host-stub'},null,2)+'\n');}
console.log(`Decision audit tests: ${passed} passed, 0 failed`);
