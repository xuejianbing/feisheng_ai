// node tools/test-2v2-friendly-fire.mjs — 模式建议、真实方向护栏与AOE独占收益的集成回归。
import assert from 'node:assert/strict';
import {register} from 'node:module';
let checks=0;
const diagnostics=[];
const stub={lib:{config:{},configOL:{}},game:{players:[],dead:[]},get:{mode:()=> 'versus',config:key=>key==='versus_mode'?'two':false,
 attitude:()=>{throw Error('2v2不应通过态度猜队伍');}},_status:{mode:'two'},ui:{selected:{cards:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{swallow:e=>diagnostics.push(e.message)}};
register('./noname-stub-loader.mjs',import.meta.url);
const {MODE_STRATEGIES}=await import('../score/decision/strategy/modeStrategy.js?v=41a');
const strategy=MODE_STRATEGIES.versus;
const {applyCommonUtilitySuggestions,applyDirectionUtility,establishUtilityReference}=await import('../score/decision/utility/remainingUtility.js?v=41a');
const {actionValue}=await import('../score/decision/relations/relations.js?v=41a');
const {createAreaUtilitySeed}=await import('../score/decision/utility/areaUtility.js?v=41a');
const {adoptAttackUtilitySeed}=await import('../score/decision/utility/attackExpectedUtility.js?v=41a');
const {utilityParity}=await import('../score/decision/utility/utilityPipeline.js?v=41a');
function check(label,fn){fn();checks++;console.log('PASS '+label);}
function reset(submode='two',side=false){
 stub._status.mode=submode;stub._status.connectMode=submode==='2v2';delete stub._status.brawl;stub.lib.config={};
 const players=[side,!side,!side,side].map((team,i)=>({playerid:'p'+i,side:team,hp:3,alive:true,getCards(){throw Error('不得读取手牌');}}));
 players.forEach((p,i)=>p.next=p.nextSeat=players[(i+1)%4]);stub.game.players=players;stub.game.dead=[];stub.game.me=players[0];stub._status.currentPhase=players[0];return players;
}
const action=(id,target,score=4)=>establishUtilityReference({type:'card',id,targetObj:target,target:target?.playerid,score});
function suggestions(me,rows){return applyCommonUtilitySuggestions(rows,[{source:'modeStrategy',dimension:'team',run:shadows=>{
 for(const candidate of shadows)candidate.score+=strategy.decisionBoost(me,candidate);
}}]);}
check('普通2v2伤友模式偏好为零，不按敌方数量/血线回赠动作分',()=>{
 for(const mode of ['two','2v2'])for(const side of [false,true,0,1]){
  const [me,b,c,ally]=reset(mode,side);b.side=c.side=side===0?1:side===1?0:!side;
  for(const hp of [1,2,3,4,8]){ally.hp=hp;for(const enemies of [[b,c],[b],[]]){stub.game.players=[me,ally,...enemies];assert.equal(strategy.decisionBoost(me,action('sha',ally)),0);}}
 }
});
check('已公开队伍不再读取identity/identityShown参与伤友算式',()=>{
 const [me,,,ally]=reset();for(const key of ['identity','identityShown'])Object.defineProperty(ally,key,{get(){throw Error('不读取身份标记');}});
 for(const id of ['sha','juedou','huogong','huosha','leisha'])assert.equal(strategy.decisionBoost(me,action(id,ally)),0);
});
check('模式建议与方向护栏串联后，普通伤友动作仍被压到原有负上限',()=>{
 const [me,,,ally]=reset();for(const base of [0,1,4,20]){
  const candidate=action('sha',ally,base);suggestions(me,[candidate]);assert.equal(candidate.score,base);
  applyDirectionUtility(me,candidate,actionValue);assert.equal(candidate.score,-8);assert.equal(utilityParity(candidate).ok,true);
 }
});
check('已低于友伤上限的候选不再叠加固定惩罚',()=>{
 const [me,,,ally]=reset();const candidate=action('juedou',ally,-12);suggestions(me,[candidate]);applyDirectionUtility(me,candidate,actionValue);
 assert.equal(candidate.score,-12);assert.equal(utilityParity(candidate).ok,true);
});
check('方向来源只结算一次，重复调用不能反复扣分',()=>{
 const [me,,,ally]=reset();const candidate=action('sha',ally,4);suggestions(me,[candidate]);applyDirectionUtility(me,candidate,actionValue);
 const count=candidate.utilityVector.contributions.length;assert.equal(applyDirectionUtility(me,candidate,actionValue),false);
 assert.equal(candidate.score,-8);assert.equal(candidate.utilityVector.contributions.length,count);
 assert.equal(candidate.utilityVector.ownedSources.filter(id=>id==='actionDirectionGuard').length,1);
});
check('合法自伤路径不再被当作打队友额外扣分，也不获得新奖励',()=>{
 const [me]=reset();const candidate=action('huogong',me,2);suggestions(me,[candidate]);applyDirectionUtility(me,candidate,actionValue);
 assert.equal(candidate.score,2);assert.equal(strategy.decisionBoost(me,candidate),0);assert.equal(utilityParity(candidate).ok,true);
});
check('此层不凭卖血技能名或宿主正effect授予伤友豁免，原有护栏继续生效',()=>{
 const [me,,,ally]=reset();ally.hasSkill=()=>true;stub.get.effect=()=>100;
 const candidate=action('huogong',ally,8);assert.equal(strategy.decisionBoost(me,candidate),0);
 applyDirectionUtility(me,candidate,actionValue);assert.equal(candidate.score,-8);delete stub.get.effect;
});
check('无目标群体牌沿用areaExpectedValue，不再叠加一份友伤模式分',()=>{
 const [me]=reset();for(const allyImpact of [0,1.6,3.6]){
  const seed=createAreaUtilitySeed({enemyImpact:2,allyImpact,enemyHit:2,allyHit:1},1);
  const candidate=action('nanman',null,seed.score);adoptAttackUtilitySeed(candidate,seed,{roundingOnly:true});
  suggestions(me,[candidate]);applyDirectionUtility(me,candidate,actionValue);
  assert.equal(candidate.score,2*(2-allyImpact));assert.equal(utilityParity(candidate).ok,true);
  assert.equal(candidate.utilityVector.ownedSources.filter(id=>id==='areaExpectedValue').length,1);
 }
});
check('模式建议不读取他人的隐藏手牌、技能或装备以伪造额外损失',()=>{
 const [me,,,ally]=reset();for(const p of stub.game.players){p.getSkills=p.getEquip=()=>{throw Error('该层无需装备/技能评估');};}
 assert.equal(strategy.decisionBoost(me,action('sha',ally)),0);
});
check('攻击敌方及桃/无懈友方原有偏好保持',()=>{
 const [me,enemy,,ally]=reset();assert.equal(strategy.decisionBoost(me,action('sha',enemy)),.4);
 for(const id of ['tao','wuxie'])assert.equal(strategy.decisionBoost(me,action(id,ally)),.5);
 assert.equal(strategy.decisionBoost(me,action('tao',enemy)),0);
});
check('缺失side或目标不明不推导敌方奖励',()=>{
 const [me,,,ally]=reset();delete ally.side;assert.equal(strategy.decisionBoost(me,action('sha',ally)),0);
 assert.equal(strategy.decisionBoost(me,{type:'card',id:'sha',target:'absent'}),0);
});
check('旧公式退出属于正确性修复，关闭策略优化也不重新启用',()=>{
 const [me,,,ally]=reset();stub.lib.config.extension_无名AI_tacticalOptimization=false;
 assert.equal(strategy.decisionBoost(me,action('sha',ally)),0);
});
check('其他对决保留旧公式，包括有/无敌方与身份标记两分支',()=>{
 for(const submode of ['three','3v3','four','4v4','siguo']){
  const [me,b,c,ally]=reset(submode);
  me.side=ally.side='red';b.side=c.side='blue';
  for(const mark of [{},{identityShown:true},{identity:'friend'}]){
   delete ally.identity;delete ally.identityShown;Object.assign(ally,mark);
   assert.equal(strategy.decisionBoost(me,action('sha',ally)),-1);
   stub.game.players=[me,ally];assert.equal(strategy.decisionBoost(me,action('sha',ally)),-2);stub.game.players=[me,b,c,ally];
  }
  // v4.4.0 旧代码将 false side 视为无侧标识，不按同队处理；不能将 2v2 修复扩散到此处。
  const [falseMe,,,falseAlly]=reset(submode,false);
  assert.equal(strategy.decisionBoost(falseMe,action('sha',falseAlly)),.4);
 }
});
check('自定义乱斗不借普通2v2标识改变兼容行为',()=>{
 const [me,,,ally]=reset();stub._status.brawl={};assert.equal(strategy.decisionBoost(me,action('sha',ally)),.4);
});
check('非伤害卡和技能候选不受旧友伤公式修复影响',()=>{
 const [me,,,ally]=reset();for(const id of ['tiesuo','guohe','lebu'])assert.equal(strategy.decisionBoost(me,action(id,ally)),0);
 assert.equal(strategy.decisionBoost(me,{type:'skill',id:'sha',targetObj:ally}),0);
});
assert.equal(diagnostics.filter(text=>!text.includes('missing public player.side')).length,0,'不得吞掉意外异常');
console.log(`${checks} checks passed (host stubs; real games remain unverified)`);
console.log('PASS [weique][2026-10-20] 2v2 friendly-fire scoring ownership');
