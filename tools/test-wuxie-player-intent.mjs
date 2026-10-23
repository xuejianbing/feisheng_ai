// node tools/test-wuxie-player-intent.mjs — 真实 evaluator 与 chooseToUse 桥接。
import assert from 'node:assert/strict';
import { register } from 'node:module';
const hand = [{name:'wuxie'}, {name:'sha'}, {name:'shan'}, {name:'tao'}];
class Player {
 constructor(id) { this.playerid=id; this.hp=3; this.maxHp=4; }
 getCards(pos) { return pos==='h' ? hand : []; }
 countCards(pos,filter) { const cards=this.getCards(pos); return filter ? cards.filter(filter).length : cards.length; }
 hasSkill() { return false; }
 hasSkillTag() { return false; }
 chooseToUse(request) { return request; }
 isOnline2() { return false; }
}
const human=new Player('human'), ally=new Player('ally'), enemy=new Player('enemy');
let damage=-1;
const stub={lib:{config:{},card:{huogong:{},juedou:{}},element:{Player},filter:{}},
 game:{players:[human,ally,enemy],dead:[],me:human},
 get:{mode:()=> 'doudizhu',name:c=>c?.name,damageEffect:()=>damage,
 attitude:(_,target)=>target===enemy?-5:5,value:()=>4},_status:{mode:'normal'},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;
globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const {captureTacticalSettings}=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {evaluateWuxie}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const {installWuxieOptimization}=await import('../score/decision/response/wuxieOptimization.js?v=41a');
captureTacticalSettings();
const cleanup=installWuxieOptimization(evaluateWuxie);
let passed=0;
function check(name,fn) { fn(); passed++; console.log('PASS '+name); }
function request(source=human,target=source,state=1,name='huogong',evidence='manual') {
 const root={name:'useCard',card:{name},player:source,target,targets:[target]};
 if(source===target&&evidence!=='unknown'){
  const choice={name:'chooseToUse',type:evidence==='manual'?'phase':'respond',player:source,parent:{name:'phaseUse',player:source}};
  intent.observeCooperativeTrickUse(root,source,choice);
 }
 return {type:'wuxie',state,info_map:state<0?{card:{name:'wuxie'},player:enemy,_source:root}:root,ai1:()=>0};
}
try {
 for (const optimized of [true,false]) {
  stub.lib.config['extension_无名AI_tacticalWuxie']=optimized;
  captureTacticalSettings();
  check(`玩家自火攻不被队友无懈（优化=${optimized}）`,()=>{
   const r=evaluateWuxie(ally,request());
   assert.equal(r.resolved,true); assert.equal(r.use,false); assert.equal(r.playerIntentRespected,true);
  });
 }
 stub.lib.config['extension_无名AI_tacticalWuxie']=true;
 captureTacticalSettings();
 check('真实响应桥接保留玩家自火攻',()=>{
  const req=request(); ally.chooseToUse(req);
  assert.equal(req.__djscWuxieOptimized,true); assert.equal(req.ai1(hand[0]),0);
  assert.equal(stub._status.djsc_lastWuxie.playerIntentRespected,true);
 });
 check('残血玩家的主动自火攻仍尊重意图',()=>{
  human.hp=1;
  try { assert.equal(evaluateWuxie(ally,request()).use,false); }
  finally { human.hp=3; }
 });
 check('托管自火攻维持原收益判断',()=>{
  stub._status.auto=true;
  try { const r=evaluateWuxie(ally,request()); assert.equal(r.use,true); assert.equal(r.playerIntentRespected,false); }
  finally { stub._status.auto=false; }
 });
 check('其他 AI 自火攻维持原判断',()=>{
  assert.equal(evaluateWuxie(ally,request(new Player('bot'))).use,true);
 });
 check('联机人类队友自火攻也保留',()=>{
  const remote=new Player('remote'); remote.isOnline2=()=>true;
  assert.equal(evaluateWuxie(ally,request(remote)).use,false);
 });
 check('敌方火攻玩家仍会保护',()=>{
  const r=evaluateWuxie(ally,request(enemy,human));
  assert.equal(r.use,true); assert.equal(r.playerIntentRespected,false);
 });
 check('玩家火攻其他队友仍按实际收益保护',()=>{
  assert.equal(evaluateWuxie(ally,request(human,ally)).use,true);
 });
 check('敌人自伤不获得玩家队友意图优先',()=>{
  enemy.isOnline2=()=>true;
  try { assert.equal(evaluateWuxie(ally,request(enemy)).playerIntentRespected,false); }
  finally { delete enemy.isOnline2; }
 });
 check('玩家自伤未知收益不强出反无懈',()=>{
  assert.equal(evaluateWuxie(ally,request(human,human,-1)).use,false);
 });
 check('明确正收益自火攻仍可反无懈恢复，真实桥接一致',()=>{
  damage=1;
  try {
   const req=request(human,human,-1),r=evaluateWuxie(ally,req);
   assert.equal(r.use,true); assert.equal(r.finalStateIfUse,'resolve');
   ally.chooseToUse(req); assert(req.ai1(hand[0])>0);
  } finally { damage=-1; }
 });
 check('延时判定不算玩家主动自伤',()=>{
  const r=evaluateWuxie(ally,request(human,human,1,'lebu'));
  assert.equal(r.playerIntentRespected,false); assert.equal(r.use,true);
 });
 check('多目标结算不套用单目标自伤优先',()=>{
  const req=request(); req.info_map.multitarget=true; req.info_map.targets.push(ally);
  assert.equal(evaluateWuxie(ally,req).playerIntentRespected,false);
 });
 check('缺少凭据时真实桥接保留原生回调和返回值',()=>{
  const req=request(human,human,1,'huogong','unknown');
  const native=function(item){assert.equal(this,req);return item===hand[0]?37:-12;};req.ai1=native;
  const r=evaluateWuxie(ally,req);assert.equal(r.resolved,false);assert.equal(r.use,null);
  assert.equal(r.reason,'player-self-damage-intent-unverified');
  ally.chooseToUse(req);assert.equal(req.ai1,native);assert.equal(req.ai1(hand[0]),37);
  assert.equal(req.__djscWuxieOptimized,undefined);
 });
 check('确认的强制自伤按收益处理，而不是当作未知放弃判断',()=>{
  const r=evaluateWuxie(ally,request(human,human,1,'huogong','nonmanual'));
  assert.equal(r.resolved,true);assert.equal(r.use,true);assert.equal(r.playerIntentRespected,false);
 });
 check('已结束或换局凭据不再保护自伤，实际回调回退原生',()=>{
  for(const ended of ['finished','reset','finish']){
   const req=request(),root=intent.trickUseEvidence({source:human,target:human,card:req.info_map.card,originalSpellId:'huogong'}).record.root;
   if(ended==='finished')root.finished=true;else if(ended==='reset')intent.resetCooperativeTrickIntents();else intent.finishCooperativeTrickUse(root);
   const native=()=>29;req.ai1=native;ally.chooseToUse(req);
   assert.equal(req.ai1,native);assert.equal(evaluateWuxie(ally,req).resolved,false);
  }
 });
 check('出牌后切换托管仍保留已捕获的手动意图',()=>{
  const req=request();stub._status.auto=true;
  try{const r=evaluateWuxie(ally,req);assert.equal(r.resolved,true);assert.equal(r.playerIntentRespected,true);assert.equal(r.use,false);}finally{stub._status.auto=false;}
 });
 check('联机托管或疯狂角色不能取得人类主动权限',()=>{
  const remote=new Player('remote');remote.isOnline2=()=>true;
  for(const kind of ['auto','mad']){
   remote.isAuto=kind==='auto';remote.isMad=()=>kind==='mad';
   const r=evaluateWuxie(ally,request(remote));assert.equal(r.resolved,true);assert.equal(r.playerIntentRespected,false);assert.equal(r.use,true);
  }
 });
 check('已安装的材料评分回调在凭据失效后调用原生',()=>{
  const req=request();req.ai1=()=>43;ally.chooseToUse(req);assert.equal(req.ai1(hand[0]),0);
  intent.resetCooperativeTrickIntents();assert.equal(req.ai1(hand[0]),43);
 });
 console.log(`${passed} checks passed`);
} finally { cleanup(); }
