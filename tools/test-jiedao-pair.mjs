import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,identity='fan'){Object.assign(this,{playerid:id,identity,hp:3,maxHp:4,alive:true,handCount:4,equip:[],hand:[]});}
 getCards(z){if(z==='e')return this.equip;if(this!==actor)throw Error('hidden hand');return this.hand;}
 countCards(){return this.handCount;}hasSkill(){return false;}hasSkillTag(){return false;}isOnline2(){return false;}
 addSkill(){}removeSkill(){}
 chooseToUse(){return {name:'chooseToUse',player:this,type:'phase',parent:stub._status.event,ai1:()=>77,ai2:()=>66,set(k,v){this[k]=v;return this;}};}
}
const actor=new Player('actor'),ally=new Player('ally'),enemy=new Player('enemy','zhu'),enemy2=new Player('enemy2','zhu');
const weapon={name:'zhuge',subtypes:['equip1'],value:4};ally.equip=[weapon];enemy.equip=[weapon];
const trick={name:'jiedao'},sha={name:'sha'};actor.hand=[trick];
let legal=true,effect=12;
const info={singleCard:true,filterTarget:(c,p,h)=>h!==p&&h.equip.length>0&&!h.locked,filterAddedTarget:(c,p,v,h)=>legal&&h!==v&&v!==p&&!v.locked};
const stub={lib:{config:{},skill:{},card:{jiedao:info},filter:{cardEnabled:()=>true,cardUsable:()=>true,targetEnabled:()=>true},element:{Player}},game:{players:[actor,ally,enemy,enemy2],dead:[],me:enemy2},get:{mode:()=> 'doudizhu',name:c=>c?.name,subtypes:c=>c.subtypes||[],value:c=>c.value??4,attitude:(a,b)=>a.identity===b.identity?5:-5,effect:()=>effect,order:()=>3},_status:{mode:'normal'},ui:{selected:{cards:[],targets:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {installResponseAI,uninstallResponseAI}=await import('../score/decision/cardplay/responseAI.js?v=41a');
const pair=await import('../score/decision/cards/jiedaoEvaluator.js?v=41a');
const {installJiedaoChoiceBridge}=await import('../score/decision/cards/jiedaoChoiceBridge.js?v=41a');
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {makeActionCandidate,candidateTargetValue,sameCandidateAction,hasConsistentBoundTarget}=await import('../score/decision/state/actionCandidate.js?v=41a');
const {applyDirectionUtility}=await import('../score/decision/utility/remainingUtility.js?v=41a');
const {actionValue}=await import('../score/decision/relations/relations.js?v=41a');
const {vetoCard}=await import('../score/decision/cardplay/cardPlayBrain.js?v=41a');
const {jiedaoBonus,jiedaoTiming}=await import('../score/decision/timing/jiedaoTiming.js?v=41a');
const {jiedaoTransferValue}=await import('../score/decision/cards/jiedaoBranches.js?v=41a');
const {dispositionOf}=await import('../score/decision/relations/relations.js?v=41a');
const {guardCheck}=await import('../score/model/net/modelGuard.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
tactical.captureTacticalSettings();
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
check('合法双目标包含持刀队友，且不读任何他人隐藏手牌',()=>{const r=pair.evaluateJiedaoPair(actor,ally,enemy,trick);assert(r.use);assert.equal(r.holder,ally);assert.equal(r.victim,enemy);assert(pair.enumerateJiedaoPairs(actor).length>0);});
check('原生距离与第二目标禁选先于收益',()=>{legal=false;assert.equal(pair.evaluateJiedaoPair(actor,ally,enemy).use,false);legal=true;enemy.locked=true;assert.equal(pair.evaluateJiedaoPair(actor,ally,enemy).use,false);delete enemy.locked;});
check('无武器、自己持刀、同一人和友方被杀者均不能成为主动计划',()=>{for(const [h,v] of [[enemy2,enemy],[actor,enemy],[ally,ally],[enemy,ally],[enemy,actor]])assert.equal(pair.evaluateJiedaoPair(actor,h,v).use,false);});
check('死亡或离场使原计划失效',()=>{ally.alive=false;assert.equal(pair.evaluateJiedaoPair(actor,ally,enemy).use,false);ally.alive=true;const saved=stub.game.players;stub.game.players=saved.filter(p=>p!==enemy);assert.equal(pair.evaluateJiedaoPair(actor,ally,enemy).use,false);stub.game.players=saved;});
check('身份未明的持刀者和被杀者均保守拒绝',()=>{const original=stub.get.attitude;stub.get.attitude=()=>0;assert.equal(pair.evaluateJiedaoPair(actor,ally,enemy).use,false);stub.get.attitude=original;});
check('效果为负时不能因残血被杀者获得虚假的必杀奖励',()=>{effect=-20;enemy.hp=1;assert.equal(pair.evaluateJiedaoPair(actor,ally,enemy).use,false);effect=12;enemy.hp=3;});
check('出杀与交武器分别估计，未知手牌不被当成必定有杀',()=>{const r=pair.evaluateJiedaoPair(actor,ally,enemy);assert(r.shaChance>0&&r.shaChance<1);assert.equal(r.effectBasis,'public-branch-estimate');assert.equal(r.transferValue,jiedaoTransferValue(actor,ally,actor,dispositionOf));ally.handCount=0;const noSha=pair.evaluateJiedaoPair(actor,ally,enemy);assert.equal(noSha.shaChance,0);assert.equal(noSha.use,false);ally.handCount=4;});
check('无杀的敌方持刀者仍可能有交武器收益',()=>{enemy.handCount=0;const r=pair.evaluateJiedaoPair(actor,enemy,enemy2);assert(r.use);assert.equal(r.score,r.transferValue);enemy.handCount=4;});
check('固定持刀者的第二阶段不挪用另一个持刀者的好计划',()=>{const first=pair.hostJiedaoTargetDecision(actor,ally,trick,[]);assert(first.allowed);const second=pair.hostJiedaoTargetDecision(actor,enemy,trick,[ally]);assert(second.allowed);assert.equal(second.holder,ally);assert.equal(pair.hostJiedaoTargetDecision(actor,ally,trick,[ally]).allowed,false);});
check('动作身份与诊断同时保留两个目标和顺序',()=>{const r=pair.evaluateJiedaoPair(actor,ally,enemy);const a=makeActionCandidate({id:'jiedao',type:'card',score:r.score,targetObj:ally,targetList:[ally,enemy],jiedaoPair:r});assert.deepEqual(candidateTargetValue(a),['ally','enemy']);assert(hasConsistentBoundTarget(a));assert(!sameCandidateAction(a,{...a,targetList:[ally,enemy2]}));assert(!sameCandidateAction(a,{...a,targetList:[enemy,ally]}));});
check('有效友方持刀组合不被关系守卫压负，伪造组合不能获得豁免',()=>{const r=pair.evaluateJiedaoPair(actor,ally,enemy);const a=makeActionCandidate({id:'jiedao',type:'card',score:4,targetObj:ally,targetList:[ally,enemy],jiedaoPair:r});applyDirectionUtility(actor,a,actionValue);assert.equal(a.score,4);const b={...a,targetList:[enemy,ally]};applyDirectionUtility(actor,b,actionValue);assert(b.score<0);});
check('基本出牌规则消费组合结果，时机不再重复增加收益',()=>{const r=pair.evaluateJiedaoPair(actor,ally,enemy);assert.equal(vetoCard('jiedao',{jiedaoPlan:r},{isAlly:true}).veto,false);assert.equal(jiedaoBonus(actor,{id:'jiedao',target:ally,pair:r}),1);assert.equal(jiedaoTiming(actor,ally,enemy).victim,enemy);});
check('宿主窗口的第一目标和第二目标评分使用同一个持刀者约束',()=>{stub._status.event={name:'phaseUse',player:actor};const remove=installJiedaoChoiceBridge();try{const e=actor.chooseToUse();assert(e.ai1(trick)>0);assert.equal(e.ai1(sha),77);stub.ui.selected.cards=[trick];assert(e.ai2(ally)>0);stub.ui.selected.targets=[ally];assert(e.ai2(enemy)>0);assert(e.ai2(ally)<0);assert.deepEqual(stub.ui.selected.targets,[ally]);}finally{remove();stub.ui.selected={cards:[],targets:[]};}});
check('选择时重新校验距离与武器，不强制写入目标或结果',()=>{stub._status.event={name:'phaseUse',player:actor};const remove=installJiedaoChoiceBridge();try{const e=actor.chooseToUse();stub.ui.selected={cards:[trick],targets:[ally]};legal=false;assert(e.ai2(enemy)<0);assert.equal(e.result,undefined);legal=true;ally.equip=[];assert(e.ai2(enemy)<0);ally.equip=[weapon];}finally{remove();stub.ui.selected={cards:[],targets:[]};}});
check('手动、联机及嵌套借刀响应窗口保持原评分',()=>{const remove=installJiedaoChoiceBridge();try{stub._status.event={name:'phaseUse',player:actor};const saved=stub.game.me;stub.game.me=actor;assert.equal(actor.chooseToUse().ai1(trick),77);stub.game.me=saved;actor.isOnline2=()=>true;assert.equal(actor.chooseToUse().ai1(trick),77);delete actor.isOnline2;stub._status.event={name:'jiedao',player:actor};assert.equal(actor.chooseToUse().ai1(trick),77);}finally{remove();}});
check('总开关关闭、换局和卸载后旧回调回退原生',()=>{stub._status.event={name:'phaseUse',player:actor};const remove=installJiedaoChoiceBridge();try{const e=actor.chooseToUse();stub.lib.config.extension_无名AI_tacticalOptimization=false;tactical.captureTacticalSettings();assert.equal(e.ai1(trick),77);delete stub.lib.config.extension_无名AI_tacticalOptimization;tactical.captureTacticalSettings();const fresh=actor.chooseToUse();assert(fresh.ai1(trick)>0);intent.resetCooperativeTrickIntents();assert.equal(fresh.ai1(trick),77);remove();assert.equal(e.ai1(trick),77);}finally{remove();}});
check('未知宿主形态、异常或不确定效果交回原生',()=>{const saved=info.filterAddedTarget;delete info.filterAddedTarget;assert.equal(pair.bestJiedaoPair(actor).resolved,false);info.filterAddedTarget=saved;const original=stub.get.effect;stub.get.effect=()=>{throw Error('unsupported');};assert.equal(pair.bestJiedaoPair(actor).resolved,false);stub.get.effect=original;});
check('最后模型护栏认可完整友方持刀计划，但不放过伪造或失效组合',()=>{
 const r=pair.evaluateJiedaoPair(actor,ally,enemy),a=makeActionCandidate({id:'jiedao',type:'card',score:4,targetObj:ally,targetList:[ally,enemy],jiedaoPair:r});
 assert.equal(guardCheck(actor,a,{}).ok,true);
 assert.equal(guardCheck(actor,{...a,jiedaoPair:null},{}).ok,false);
 legal=false;assert.equal(guardCheck(actor,a,{}).ok,false);legal=true;
});
check('合法计划保留模型和原生给出的出牌顺序，不用专项原始分覆盖它',()=>{
 stub._status.event={name:'phaseUse',player:actor};const remove=installJiedaoChoiceBridge();
 try{assert.equal(actor.chooseToUse().ai1(trick),77);}finally{remove();}
});
check('实际安装卸载流程接通主动桥，且不干扰后续响应桥',()=>{
 stub._status.event={name:'phaseUse',player:actor};const original=Player.prototype.chooseToUse;
 installResponseAI();try{const e=actor.chooseToUse();stub.ui.selected={cards:[trick],targets:[ally]};assert(e.ai2(ally)<0);}
 finally{uninstallResponseAI();stub.ui.selected={cards:[],targets:[]};}
 assert.equal(Player.prototype.chooseToUse,original);
});
check('合法借刀组合不能绕过已验证的forced击杀职责',()=>{
 const r=pair.evaluateJiedaoPair(actor,ally,enemy),a=makeActionCandidate({id:'jiedao',type:'card',score:4,targetObj:ally,targetList:[ally,enemy],jiedaoPair:r});
 const kill=makeActionCandidate({id:'sha',type:'card',score:3,targetObj:enemy,policy:{priorityTier:'forced',priorityReason:'验证击杀'}});
 const g=guardCheck(actor,a,{killAvailable:kill});assert.equal(g.ok,false);assert.equal(g.fallback,kill);
});
const {hostJiedaoPlan}=await import('../js/content/optimization.js?v=41a');
check('旧身份局卡牌优化入口消费同一计划，避免再按他人隐藏杀判断',()=>{
 const r=hostJiedaoPlan(actor,ally);assert(r.use);assert.equal(r.holder,ally);
 stub.ui.selected={cards:[sha],targets:[enemy]};assert.equal(hostJiedaoPlan(actor,ally,true).holder,ally);
 stub.ui.selected={cards:[trick],targets:[enemy]};assert.equal(hostJiedaoPlan(actor,ally,true).holder,enemy);
 stub.ui.selected={cards:[],targets:[]};
});
console.log(`Jiedao pair tests: ${count} passed, 0 failed`);
