// node tools/test-suggestion-fusion.mjs [--examples DIR]
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const stub={lib:{config:{},skill:{},card:{list:[]}},game:{players:[],dead:[]},get:{mode:()=> 'doudizhu',name:c=>c?.name,attitude:(a,b)=>a.identity===b.identity?5:-5},_status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const {applyCommonUtilitySuggestions,applyDirectionUtility,establishUtilityReference}=await import('../score/decision/utility/remainingUtility.js?v=41a');
const {commonSuggestionFusionFor}=await import('../score/decision/utility/suggestionFusion.js?v=41a');
const {compareActionCandidates,setCandidatePriority,PRIORITY_TIER}=await import('../score/decision/state/actionCandidate.js?v=41a');
const {utilityParity}=await import('../score/decision/utility/utilityPipeline.js?v=41a');
const {getModeStrategy}=await import('../score/decision/strategy/modeStrategy.js?v=41a');
const {actionValue}=await import('../score/decision/relations/relations.js?v=41a');
const {applyClassicPredictions}=await import('../score/model/train/classicRuntime.js?v=41a');
const {applyResourceMaximizeBonus,resourceMaximize}=await import('../score/decision/strategy/resourceMaximize.js?v=41a');
const {FEATURE_DIM}=await import('../score/model/features/features.js?v=41a');
const mode=await import('../score/foundation/runtime/modeContext.js?v=41a');
const player=(id,identity)=>({playerid:id,identity,hp:3,maxHp:4,countCards:()=>4,getSkills:()=>[]});
const me=player('farmer','fan'),friend=player('ally','fan'),enemy=player('landlord','zhu');
stub.game.players=[me,friend,enemy];stub.game.me=me;
const candidate=(score=4,id='sha',target=enemy)=>({type:'card',id,targetObj:target,score});
const stage=(source,delta,reasonKey)=>({source,dimension:'team',reasonKey,run:rows=>rows.forEach(a=>{a.score+=delta;})});
const productionMode={source:'modeStrategy',dimension:'team',run:rows=>rows.forEach(a=>{a.score+=getModeStrategy().decisionBoost(me,a);})};
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
function apply(rows,stages,options={}){return applyCommonUtilitySuggestions(rows,stages,{fusion:'reasoned',audit:true,...options});}
let passed=0;const examples=[];
function check(name,fn){fn();passed++;console.log('PASS '+name);}
function example(name,base,stages){const before=candidate(base),after=candidate(base);apply([before],stages,{fusion:'legacy'});apply([after],stages);examples.push({scenario:name,base,legacy:before.score,fused:after.score,audit:after.commonUtilityAudit,synthetic:true});return after;}
check('实际地主农民偏好与历史经验都进入比较，受统一幅度限制',()=>{
 const a=example('role-and-experience',4,[productionMode,stage('sharedKnowledge',.8)]);close(a.score,5);
 const dim=a.commonUtilityAudit.dimensions[0];assert.equal(dim.aggregation,'reason-groups');assert.equal(dim.suggestions.length,2);
 assert(dim.suggestions.every(s=>s.selected));close(dim.suggestions.reduce((sum,s)=>sum+s.appliedDelta,0),dim.appliedDelta);
});
check('零分候选仍可表达专项偏好',()=>{
 const a=example('zero-baseline',0,[productionMode]);close(a.score,.35);assert.equal(a.commonUtilityAudit.dimensions[0].suggestions[0].status,'included-in-aggregate');
});
check('同一理由多个估计不重复堆分',()=>{
 const a=example('duplicate-reason',4,[stage('one',.2,'focus'),stage('two',.4,'focus')]);close(a.score,4.4);
 assert.equal(a.commonUtilityAudit.dimensions[0].suggestions[0].status,'not-selected-same-reason');
});
check('同一来源重复提交只运行一次，整条聚合重复调用也不加第二遍',()=>{
 let calls=0;const s={...stage('one',.2,'focus'),run:rows=>{calls++;rows.forEach(a=>a.score+=.2);}};const a=candidate();apply([a],[s,s]);apply([a],[s]);assert.equal(calls,1);close(a.score,4.2);
});
check('未声明理由的陌生模块保持互斥，不默认无限相加',()=>{
 const a=candidate();apply([a],[stage('unknown-a',.2),stage('unknown-b',.4)]);close(a.score,4.4);
});
check('不同理由可以相互抵消，正负贡献均有记录',()=>{
 const a=candidate(0);apply([a],[stage('one',.4,'focus'),stage('two',-.3,'risk')]);close(a.score,.1);
 assert(a.commonUtilityAudit.dimensions[0].suggestions.every(s=>s.selected));
});
check('相同理由同时存在正负证据也保留，不只取有利判断',()=>{
 const a=candidate();apply([a],[stage('one',.4,'focus'),stage('two',-.3,'focus')]);close(a.score,4.1);
});
check('多数小建议与极端值也不能突破维度预算',()=>{
 for(const base of [0,.1,4,-4,100]){const a=candidate(base);apply([a],Array.from({length:20},(_,i)=>stage('s'+i,1000,'r'+i)));assert(a.score-base<=1.500000001);assert(a.score-base<=Math.max(.5,Math.abs(base)*.25)+1e-9);}
});
check('较强负收益不会被几条专项建议变成正收益',()=>{
 const a=candidate(-4);apply([a],[productionMode,stage('sharedKnowledge',.8)]);assert(a.score<0);
});
check('使用共同原始基准，不因模块执行顺序产生倍率链',()=>{
 const stages=[stage('one',.2,'first'),stage('two',.3,'second')];const a=candidate(),b=candidate();establishUtilityReference(a);establishUtilityReference(b);
 apply([a],stages);apply([b],stages.slice().reverse());close(a.score,b.score);assert.equal(a.utilityBaseScore,4);
});
check('只能给分，不能通过建议偷偷改目标或policy',()=>{
 const a=candidate();a.policy={eligible:false,priorityTier:'normal'};apply([a],[{source:'one',dimension:'team',reasonKey:'focus',run:rows=>rows.forEach(r=>{r.score+=.3;r.targetObj=friend;r.policy.eligible=true;})}]);assert.equal(a.targetObj,enemy);assert.equal(a.policy.eligible,false);
});
check('明确的方向收益上限在融合之后仍生效',()=>{
 const a=candidate(0,'sha',friend);apply([a],[stage('one',1,'boost')]);applyDirectionUtility(me,a,actionValue);assert.equal(a.score,-8);
});
check('救命/斩杀优先级不会被普通候选的专项加分跨越',()=>{
 const normal=candidate(4),critical=candidate(1,'tao',me);setCandidatePriority(critical,PRIORITY_TIER.CRITICAL,90,'救命');apply([normal,critical],[stage('one',.4,'boost')]);assert.equal([normal,critical].sort(compareActionCandidates)[0],critical);
});
check('融合不代替模型选择，模型仍能在同优先级候选中调整结果',()=>{
 const a=candidate(4),b=candidate(4.9,'guohe');const stages=[{source:'modeStrategy',dimension:'team',run:rows=>rows.forEach(r=>{if(r.id==='sha')r.score+=.35;})},
 {source:'sharedKnowledge',dimension:'team',run:rows=>rows.forEach(r=>{if(r.id==='sha')r.score+=.8;})}];apply([a,b],stages);
 a._feat=new Array(FEATURE_DIM).fill(0);b._feat=new Array(FEATURE_DIM).fill(1);assert.equal([a,b].sort(compareActionCandidates)[0],a);
 const result=applyClassicPredictions([a,b],f=>({value:f[0]}),'fixture-model');assert.equal(result.participatesInSelection,true);assert.equal([a,b].sort(compareActionCandidates)[0],b);
});
check('关闭专项增强或其它模式保持旧聚合行为',()=>{
 for(const c of [{mode:'identity',group:'identity',enabled:true},{mode:'doudizhu',group:'doudizhu-special',enabled:false},{mode:'doudizhu',group:'doudizhu-classic',enabled:false}]){
  assert.equal(commonSuggestionFusionFor(c),'legacy');const a=candidate(0);apply([a],[stage('one',.35)],{fusion:commonSuggestionFusionFor(c)});assert.equal(a.score,0);
 }
 assert.equal(commonSuggestionFusionFor({mode:'doudizhu',group:'doudizhu-classic',enabled:true}),'reasoned');
});
check('本局捕获的开关与三种斗地主模式都正确选择融合路径',()=>{
 for(const submode of ['normal','kaihei','huanle']){stub._status.mode=submode;mode.beginModeContext(submode);assert.equal(commonSuggestionFusionFor(mode.modeSampleMeta(me)),'reasoned');mode.closeModeContext();}
 stub._status.mode='normal';stub.lib.config['extension_无名AI_classicDoudizhu']=false;mode.beginModeContext('off');assert.equal(commonSuggestionFusionFor(mode.modeSampleMeta(me)),'legacy');mode.closeModeContext();delete stub.lib.config['extension_无名AI_classicDoudizhu'];
});
check('开启或关闭诊断不影响修复后的结果，收益账本守恒',()=>{
 const a=candidate(),b=candidate();apply([a],[productionMode,stage('sharedKnowledge',.8)]);apply([b],[productionMode,stage('sharedKnowledge',.8)],{audit:false});close(a.score,b.score);assert.equal(utilityParity(a).ok,true);assert.equal(utilityParity(b).ok,true);assert.equal(b.commonUtilityAudit,undefined);
});
check('非枚举基准标记传到真实资源模块，避免斩杀收益重复计分',()=>{
 me.getCards=zone=>zone==='h'?[{name:'sha'}]:[];enemy.hp=1;
 try{assert.equal(resourceMaximize(me).topLine.type,'kill');const migrated=candidate(4),unmigrated=candidate(4);establishUtilityReference(migrated);
 const resourceStage={source:'resourceMaximize',dimension:'resource',run:rows=>applyResourceMaximizeBonus(me,rows)};
 apply([migrated],[resourceStage]);apply([unmigrated],[resourceStage]);assert.equal(migrated.score,4);assert(unmigrated.score>4);
 assert.equal(migrated.commonUtilityAudit.dimensions[0].suggestions[0].status,'no-suggestion');
 }finally{delete me.getCards;enemy.hp=3;}
});
check('单模块失败只回退该建议，不影响其它来源',()=>{
 const a=candidate(0);apply([a],[{source:'broken',dimension:'team',run(){throw Error('fixture');}},productionMode]);close(a.score,.35);assert.deepEqual(a.commonUtilityAudit.failedSources,['broken']);
});
const arg=process.argv.indexOf('--examples');if(arg>=0){const dir=resolve(process.argv[arg+1]);mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'融合修复对照.json'),JSON.stringify({provenance:'synthetic-host-stub',trainingEligible:false,examples},null,2)+'\n');writeFileSync(resolve(dir,'融合修复对照.txt'),'合成验证，非真实对局。\n'+examples.map(e=>`${e.scenario}：基础 ${e.base}；旧聚合 ${e.legacy}；修复后 ${e.fused}`).join('\n')+'\n');}
console.log(`Suggestion fusion tests: ${passed} passed, 0 failed`);
