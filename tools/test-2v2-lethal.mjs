// node tools/test-2v2-lethal.mjs — 实体攻击、防御/救援不确定性与实际优先级规则。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let mode='versus',viewer,checks=0;
class Player {
 constructor(id,side){Object.assign(this,{playerid:id,side,hp:3,maxHp:4,hujia:0,alive:true,hand:[],publicHand:0,equip:{},skills:[],tags:[],awakenedSkills:[]});}
 getCards(zone){if(zone==='h'){assert.equal(this,viewer,'不能读取其他玩家隐藏手牌');return this.hand;}return zone==='e'?Object.values(this.equip):[];}
 countCards(zone,filter){assert.equal(filter,undefined,'只允许公开手牌总数');return zone==='h'?this.publicHand:0;}
 getEquip(slot){return this.equip[slot];}getSkills(){return this.skills;}hasSkill(id){return this.skills.includes(id);}hasSkillTag(tag){return this.tags.includes(tag);}
 isAlive(){return this.alive;}canUse(card,target){return !card.blocked&&!target.outOfRange&&target.alive;}isTurnedOver(){return false;}
}
const stub={lib:{config:{},configOL:{},skill:{},card:{},filter:{cardEnabled:c=>!c.disabled,cardUsable:c=>!c.exhausted}},
 game:{players:[],dead:[]},get:{mode:()=>mode,config:key=>key==='versus_mode'?'two':false,name:c=>c?.name,color:c=>c.color,
 effect:target=>target.effect??1,attitude:(a,b)=>a.side===b.side?5:-5},_status:{mode:'two',roundNumber:1},ui:{selected:{cards:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {evaluateVersusAttack,evaluateVersusAttackForId}=await import('../score/decision/modes/versus/lethal.js?v=41a');
const {evaluateAttackExpectedValue,createAttackUtilitySeed}=await import('../score/decision/utility/attackExpectedUtility.js?v=41a');
const {utilityParity}=await import('../score/decision/utility/utilityPipeline.js?v=41a');
const {basePriority,pickTarget,decideCard}=await import('../score/decision/cardplay/cardPlayBrain.js?v=41a');
const {buildObjectiveContext}=await import('../score/decision/strategy/objective.js?v=41a');
const {resolveStrategicIntentCore}=await import('../score/decision/strategy/objectiveCore.js?v=41a');
const {applyStrategicIntentToCandidates}=await import('../score/decision/strategy/intentAlignment.js?v=41a');
const {makeActionCandidate,candidatePriorityRank}=await import('../score/decision/state/actionCandidate.js?v=41a');
const {captureTacticalSettings}=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {delayCardOrder}=await import('../score/decision/strategy/delayedOptimization.js?v=41a');
function reset(){
 mode='versus';stub.lib.config={};Object.assign(stub._status,{mode:'two',connectMode:false});delete stub._status.brawl;
 const ps=[false,true,true,false].map((side,i)=>new Player('p'+i,side));ps.forEach((p,i)=>p.next=p.nextSeat=ps[(i+1)%4]);
 stub.game.players=ps;stub.game.dead=[];viewer=ps[0];stub.game.me=viewer;stub._status.currentPhase=viewer;stub._status.firstAct=viewer;
 viewer.hand=[{name:'sha',color:'red'},{name:'juedou'}];stub._status.event={name:'phaseUse',player:viewer};return ps;
}
function plan(me,target,id='sha'){return evaluateVersusAttack(me,me.hand.find(c=>c.name===id),target);}
function ctx(me,targets){return {me:{sha:1},targets:targets.map(pp=>({pp,hp:pp.hp,isAlly:pp.side===me.side,isEnemy:pp.side!==me.side,shanProb:0})),attackStrategy:(id,t)=>evaluateVersusAttackForId(me,id,t.pp)};}
function check(label,fn){fn();checks++;console.log('PASS '+label);}
check('一血空手只是斩杀机会，不能成为确定死亡',()=>{
 const [me,target]=reset();target.hp=1;const r=plan(me,target);assert(r.legal);assert(r.killProbability>0&&r.killProbability<1);assert.equal(r.certain,false);assert.equal(r.lethal.dyingProbability,1);
});
check('两血可能没闪但只有普通一伤，不虚构斩杀收益',()=>{
 const [me,target]=reset();target.hp=2;const r=plan(me,target);assert.equal(r.killProbability,0);assert.equal(r.lethal.dyingProbability,0);assert.equal(r.evaluation.offense,3);
});
check('响应概率仅计算一次，0响应概率不被||默认值替换',()=>{
 const [me,target]=reset();target.hp=1;const noCards=plan(me,target);assert.equal(noCards.evaluation.hitProbability,1);
 target.publicHand=4;const cards=plan(me,target);assert(cards.evaluation.hitProbability<1);assert(cards.killProbability<noCards.killProbability);
 assert(Math.abs(cards.evaluation.offense-(cards.evaluation.hitProbability*3+6*cards.killProbability))<1e-9);
});
check('护甲吸收一伤后，一血目标仍有受击收益但没有掉血斩杀',()=>{
 const [me,target]=reset();target.hp=1;target.hujia=1;const r=plan(me,target);assert.equal(r.killProbability,0);assert.equal(r.lethal.hpDamage,0);assert.equal(r.evaluation.offense,2);
});
check('仁王黑杀与藤甲普通杀不会获得击杀收益，红杀/火杀分别识别',()=>{
 const [me,target]=reset();target.hp=1;target.equip[2]={name:'renwang'};me.hand[0].color='black';assert.equal(plan(me,target).killProbability,0);
 me.hand[0].color='red';assert(plan(me,target).killProbability>0);target.equip[2]={name:'tengjia'};assert.equal(plan(me,target).killProbability,0);
 me.hand[0].nature='fire';assert(plan(me,target).killProbability>0);
});
check('八卦/八阵响应与青釭忽略防具贯通同一命中估计',()=>{
 const [me,target]=reset();target.hp=1;const base=plan(me,target);target.equip[2]={name:'bagua'};const armor=plan(me,target);assert(armor.evaluation.hitProbability<base.evaluation.hitProbability);
 me.equip[1]={name:'qinggang'};assert.equal(plan(me,target).evaluation.hitProbability,base.evaluation.hitProbability);
 delete me.equip[1];delete target.equip[2];target.skills=['bazhen'];assert(plan(me,target).evaluation.hitProbability<base.evaluation.hitProbability);
});
check('已生效酒伤害可进入斩杀线，手中尚未使用的酒不能预支',()=>{
 const [me,target]=reset();target.hp=2;me.hand.push({name:'jiu'});assert.equal(plan(me,target).killProbability,0);
 me.skills=['jiu'];me.storage={jiu:1};assert(plan(me,target).killProbability>0);
 target.equip[2]={name:'baiyin'};assert.equal(plan(me,target).killProbability,0);me.equip[1]={name:'qinggang'};assert(plan(me,target).killProbability>0);
});
check('藤甲火伤和古锭空手加伤是当前公开伤害，不预支尚未装备的武器',()=>{
 const [me,target]=reset();target.hp=2;target.equip[2]={name:'tengjia'};me.hand[0].nature='fire';assert(plan(me,target).killProbability>0);
 me.equip[1]={name:'qinggang'};assert.equal(plan(me,target).killProbability,0);delete me.equip[1];delete target.equip[2];delete me.hand[0].nature;
 me.hand.push({name:'guding'});assert.equal(plan(me,target).killProbability,0);me.equip[1]={name:'guding'};assert(plan(me,target).killProbability>0);
 target.publicHand=1;assert.equal(plan(me,target).killProbability,0);
});
check('目标或其队友有公开手牌时保留桃/酒救援机会，不读具体牌',()=>{
 const [me,target,rescuer]=reset();target.hp=1;const noRescue=plan(me,target);rescuer.publicHand=4;const allyRescue=plan(me,target);
 assert(allyRescue.lethal.rescueProbability>0);assert(allyRescue.killProbability<noRescue.killProbability);
 rescuer.publicHand=0;target.publicHand=4;assert(plan(me,target).lethal.rescueProbability>0);
});
check('不能把己方桃当成会救敌方，也不能把已死亡救援者算进库存',()=>{
 const [me,target,rescuer]=reset();target.hp=1;const base=plan(me,target).killProbability;me.hand.push({name:'tao'});assert.equal(plan(me,target).killProbability,base);
 rescuer.publicHand=4;rescuer.alive=false;assert.equal(plan(me,target).killProbability,base);
});
check('公开救援/不屈涅槃式静态声明保留不确定性，不执行私有材料筛选',()=>{
 const [me,target,rescuer]=reset();target.hp=1;const base=plan(me,target).killProbability;
 target.skills=['survive'];stub.lib.skill.survive={ai:{save:true,skillTagFilter(){throw Error('不能探测私有材料');}}};
 assert(plan(me,target).killProbability<base);assert.equal(plan(me,target).lethal.publicSave,true);
 target.awakenedSkills=['survive'];assert.equal(plan(me,target).killProbability,base);target.skills=[];
 rescuer.skills=['survive'];assert(plan(me,target).killProbability<base);
});
check('救援/响应张数接口缺失不是零手牌',()=>{
 const [me,target,rescuer]=reset();target.hp=1;target.countCards=()=>undefined;rescuer.countCards=()=>undefined;
 const r=plan(me,target);assert.equal(r.lethal.rescueUnknown,true);assert(r.evaluation.hitProbability<1);assert(r.lethal.rescueProbability>0);
});
check('原生不可用、次数耗尽、距离不够、友方与异常side均不制造可杀目标',()=>{
 const [me,target,,ally]=reset();target.hp=1;
 for(const flag of ['blocked','disabled','exhausted']){me.hand[0][flag]=true;assert.equal(plan(me,target).legal,false);delete me.hand[0][flag];}
 target.outOfRange=true;assert.equal(plan(me,target).legal,false);target.outOfRange=false;
 assert.equal(plan(me,ally).legal,false);delete target.side;assert.equal(plan(me,target).legal,false);
});
check('原生无效/负效果、伤害免疫和属性免疫不会推高斩杀',()=>{
 const [me,target]=reset();target.hp=1;for(const effect of [0,-1]){target.effect=effect;assert.equal(plan(me,target).killProbability,0);}delete target.effect;
 target.tags=['nodamage'];assert.equal(plan(me,target).killProbability,0);target.tags=['nofire'];me.hand[0].nature=['fire'];assert.equal(plan(me,target).killProbability,0);
 target.tags=[];target.equip[2]={name:'tengjia'};me.hand[0].nature=[];assert.equal(plan(me,target).killProbability,0);
});
check('未知宿主效果和未知仁王颜色保持折减，不乐观假定全额命中',()=>{
 const [me,target]=reset();target.hp=1;const effect=stub.get.effect;delete stub.get.effect;const r=plan(me,target);assert(r.evaluation.hitProbability<1);stub.get.effect=effect;
 target.equip[2]={name:'renwang'};delete me.hand[0].color;assert(plan(me,target).evaluation.hitProbability<1);
});
check('宿主接口异常保守返回，异常结束后不会留下重入锁',()=>{
 const [me,target]=reset();target.hp=1;const original=stub.get.effect;stub.get.effect=()=>{throw Error('host effect');};
 assert.equal(plan(me,target).resolved,false);stub.get.effect=original;assert(plan(me,target).killProbability>0);
 const name=stub.get.name;stub.get.name=()=>{throw Error('host name');};assert.equal(plan(me,target).resolved,false);stub.get.name=name;
 assert(plan(me,target).killProbability>0);
});
check('实体评估异常不能变成已确认零收益，逐卡目标回退既有公开启发式',()=>{
 const [me,target]=reset();target.hp=1;
 const native=target.getEquip;target.getEquip=()=>{throw Error('host armor');};
 try {
  assert.equal(plan(me,target).resolved,false);
  const grouped=evaluateVersusAttackForId(me,'sha',target);
  assert.equal(grouped.resolved,false,'实体评估不确定时，牌名聚合也应保留未决状态');
  const enhanced=ctx(me,[target]);
  const fallback=ctx(me,[target]);delete fallback.attackStrategy;
  assert.equal(pickTarget('sha',enhanced).index,pickTarget('sha',fallback).index);
 }finally{target.getEquip=native;}
});
check('决斗同样区分进入濒死和获救，并保留杀响应消耗/失败自伤',()=>{
 const [me,target,rescuer]=reset();target.hp=1;const base=plan(me,target,'juedou');rescuer.publicHand=4;const rescue=plan(me,target,'juedou');assert(rescue.killProbability<base.killProbability);
 target.publicHand=4;me.hand=me.hand.filter(c=>c.name!=='sha');const risk=plan(me,target,'juedou');assert(risk.evaluation.risk<0);assert(risk.evaluation.resourceCost<=0);
});
check('决斗考虑敌方无懈机会，被抵消不算成决斗失败自伤',()=>{
 const [me,target,rescuer]=reset();target.hp=1;const plain=plan(me,target,'juedou');rescuer.publicHand=4;
 const guarded=plan(me,target,'juedou');assert(guarded.lethal.resolutionProbability<1);assert(guarded.lethal.dyingProbability<plain.lethal.dyingProbability);
 assert.equal(Math.abs(guarded.evaluation.risk),0);
});
check('原有伤害反击风险保留，不因替换斩杀估值而漏掉',()=>{
 const [me,target]=reset();target.hp=1;const plain=plan(me,target);target.skills=['ganglie'];const revenge=plan(me,target);
 assert(revenge.evaluation.risk<plain.evaluation.risk);assert(revenge.evaluation.score<plain.evaluation.score);
});
check('收益账本只保留一个攻击来源，击杀机会不再次乘命中率',()=>{
 const [me,target,rescuer]=reset();target.hp=1;target.publicHand=3;rescuer.publicHand=3;const r=plan(me,target),seed=createAttackUtilitySeed(r.evaluation,1.2);
 assert.equal(utilityParity(seed).ok,true);assert.deepEqual(seed.utilityVector.ownedSources,['attackExpectedValue']);assert.equal(seed.utilityVector.contributions[0].details.lethalCertain,false);
 assert.equal(seed.utilityVector.contributions[0].details.killProbability,r.killProbability);
});
check('一血目标不因旧补刀规则直接升99优先级，普通得分仍可选择进攻',()=>{
 const [me,target]=reset();target.hp=1;const c=ctx(me,[target]);c.targetLocked=true;
 assert(basePriority('sha',c,c.targets[0])<99);assert.equal(decideCard('sha',c,0).veto,false);
 const legacy={...c};delete legacy.attackStrategy;assert.equal(basePriority('sha',legacy,legacy.targets[0]),99);
});
check('逐卡选目标排除够不到的一血敌人，可选择能伤害的另一名敌人',()=>{
 const [me,target,other]=reset();target.hp=1;target.outOfRange=true;other.hp=3;const c=ctx(me,[target,other]);assert.equal(pickTarget('sha',c).index,1);
 target.outOfRange=false;target.equip[2]={name:'tengjia'};assert.equal(pickTarget('sha',c).index,1);
});
check('无对应实体攻击牌时，不因目标一血生成虚拟斩杀机会',()=>{
 const [me,target]=reset();target.hp=1;me.hand=[];assert.equal(evaluateVersusAttackForId(me,'sha',target).legal,false);
 assert.equal(evaluateVersusAttack(me,{name:'sha'},target).legal,false);
});
check('牌名分组只表达现有实体牌机会，保留未绑定具体材料事实',()=>{
 const [me,target]=reset();target.hp=1;me.hand.push({name:'sha',color:'black'});const r=evaluateVersusAttackForId(me,'sha',target);assert(r.materialUnbound);assert.equal(r.certain,false);
});
check('战略层一血FINISH也不再绕回critical，其他对决保持原策略',()=>{
 const [me,target]=reset();target.hp=1;const context=buildObjectiveContext(me);assert.equal(context.versus2v2,true);
 const state=resolveStrategicIntentCore(context);assert.equal(state.intent.priorityTier,'normal');
 const candidate=makeActionCandidate({type:'card',id:'sha',score:2,targetObj:target});applyStrategicIntentToCandidates([candidate],state);assert.equal(candidatePriorityRank(candidate),0);
 stub._status.mode='3v3';const legacy=resolveStrategicIntentCore(buildObjectiveContext(me));assert.equal(legacy.intent.priorityTier,'critical');
});
check('关闭增强不重新启用错误的必杀标签，换边和联机标识不改结论',()=>{
 const [me,target]=reset();target.hp=1;stub.lib.config.extension_无名AI_tacticalOptimization=false;
 for(const submode of ['two','2v2']){stub._status.mode=submode;stub._status.connectMode=submode==='2v2';for(const p of stub.game.players)p.side=p.side?1:0;assert.equal(plan(me,target).certain,false);}
});
check('同回合换防具、护甲、救援者公开手牌和血线后立即刷新',()=>{
 const [me,target,rescuer]=reset();target.hp=1;const base=plan(me,target).killProbability;target.equip[2]={name:'tengjia'};assert.equal(plan(me,target).killProbability,0);delete target.equip[2];
 rescuer.publicHand=4;assert(plan(me,target).killProbability<base);rescuer.publicHand=0;target.hp=2;assert.equal(plan(me,target).killProbability,0);
});
check('其他模式和乱斗不接入2v2估计，公共攻击纯函数默认数值保持',()=>{
 const [me,target]=reset();target.hp=1;
 for(const other of ['doudizhu','identity']){mode=other;assert.equal(plan(me,target),null);}mode='versus';stub._status.brawl={};assert.equal(plan(me,target),null);
 const raw=evaluateAttackExpectedValue('sha',{targetHp:1,shanProbability:0});assert.equal(raw.score,9);assert.equal(raw.killProbability,undefined);
});
check('兵乐顺序不再因一血空手就降到2，仍按控制收益判断',()=>{
 const [me,target]=reset();target.hp=1;me.hand.push({name:'lebu'});stub.get.value=()=>3;
 stub.lib.filter.cardEnabled=()=>true;stub.lib.filter.cardUsable=()=>true;target.countCards=()=>0;
 captureTacticalSettings();const order=delayCardOrder(me,{name:'lebu'},5);assert(order>2);
});
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 lethal opportunity and priority ownership');
process.exit(0);
