import assert from 'node:assert/strict';
import {register} from 'node:module';
globalThis.__NONAME_STUB={lib:{config:{}},get:{mode:()=> 'doudizhu'},game:{},_status:{mode:'normal'}};globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {applyComboFallbackUtility}=await import('../score/decision/utility/comboFallbackUtility.js?v=41a');
const {applyOptimizationEvidence,applyContextUtility}=await import('../score/decision/utility/contextUtility.js?v=41a');
const {applyDeepValueEvidence}=await import('../score/decision/utility/areaUtility.js?v=41a');
const {makeActionCandidate}=await import('../score/decision/state/actionCandidate.js?v=41a');
const target={playerid:'enemy'},holder={playerid:'holder'},other={playerid:'other'},me={playerid:'me'};
const chain={id:'tiesuo_fire',setup:['tiesuo'],follow:['huogong']};
const card=(id,score=4,t=target)=>makeActionCandidate({type:'card',id,score,targetObj:t});
const opts={detect:()=>[chain],priorityChain:()=>100,scoreChain:()=>100};
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
check('8 宿主完整估分和深度估值只记录，不再加入已存在的基础收益',()=>{
 const a=card('huogong');applyOptimizationEvidence(a,{score:100,weight:4});applyDeepValueEvidence(a,{cardValue:100,targetValue:100});assert.equal(a.score,4);
});
check('8 Planner已拥有连续方案时，连招不再加第二份未来收益',()=>{
 const a=card('huogong'),tie=card('tiesuo');applyComboFallbackUtility(me,[a,tie],{...opts,plan:{best:{steps:[{id:'tiesuo'},{id:'huogong'}]}}});assert.equal(a.score,4);assert.equal(tie.score,4);
});
check('8 铁索专用基础估值不再叠加连招奖励，其他未来提示仍有界',()=>{
 const a=card('huogong'),tie=card('tiesuo');applyComboFallbackUtility(me,[a,tie],opts);assert.equal(tie.score,4);assert(a.score<=5.2);assert(a.score>4);
 const once=a.score;applyComboFallbackUtility(me,[a,tie],opts);assert.equal(a.score,once);
});
check('8 多个连招取最大值，不把同一候选多次相乘',()=>{
 const a=card('huogong'),tie=card('tiesuo');applyComboFallbackUtility(me,[a,tie],{...opts,detect:()=>[chain,{...chain,id:'another-name'}]});assert.equal(a.score,5.2);
});
check('8 没有合法后续候选或被policy否决时不制造未来收益',()=>{
 const a=card('tiesuo');assert.equal(applyComboFallbackUtility(me,[a],opts),false);assert.equal(a.score,4);
 const fire=card('huogong');fire.policy.eligible=false;applyComboFallbackUtility(me,[a,fire],opts);assert.equal(a.score,4);
});
check('8 借刀连招后续跟随被杀者，不误把持刀队友当成后续杀目标',()=>{
 const a=makeActionCandidate({type:'card',id:'jiedao',score:4,targetObj:holder,targetList:[holder,target],jiedaoPair:{use:true,holder,victim:target}}),sha=card('sha');
 const borrow={id:'tao_lengjia',setup:['jiedao'],follow:['sha']};
 applyComboFallbackUtility(me,[a,sha],{...opts,detect:(_,t)=>t===target?[borrow]:[]});assert(a.score>4);assert(a.score<=5.2);
 const wrong={...a,score:4,utilityVector:undefined};applyComboFallbackUtility(me,[wrong,card('sha',4,other)],{...opts,detect:()=>[borrow]});assert.equal(wrong.score,4);
});
check('8 多轮上下文建议使用一次有界修正，不重复写入同一来源',()=>{
 const a=card('sha');applyContextUtility(a,'future','future',{multiTurn:5,forecast:5});const once=a.score;assert(once<=5);applyContextUtility(a,'future','future',{multiTurn:5});assert.equal(a.score,once);
});
console.log(`Utility boundary tests: ${n} passed, 0 failed`);
