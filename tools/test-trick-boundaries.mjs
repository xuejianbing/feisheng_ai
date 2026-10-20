import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,role='fan'){Object.assign(this,{playerid:id,identity:role,hp:3,maxHp:4,hand:[],equip:[],skills:[]});}
 getCards(z){if(z==='e')return this.equip;if(z==='he'||z==='hes')return [...this.hand,...this.equip];return this.hand;}
 countCards(z){return this.getCards(z).length;}hasSkill(id){return this.skills.includes(id);}getSkills(){return this.skills;}hasSkillTag(){return false;}isOnline2(){return false;}
}
const human=new Player('human'),ally=new Player('ally'),enemy=new Player('enemy','zhu');
const stub={lib:{config:{},skill:{},card:{},filter:{cardEnabled:()=>true,cardEnabled2:c=>!c.locked,cardRespondable:c=>!c.locked,targetEnabled:()=>true,targetInRange:()=>true}},game:{me:human,players:[human,ally,enemy],dead:[]},get:{mode:()=> 'doudizhu',name:c=>c?.name,value:c=>c.value??4,attitude:(a,b)=>a.identity===b.identity?5:-5,damageEffect:()=>-2,subtypes:c=>c.subtypes||[],effect:()=>4,recoverEffect:()=>2},_status:{mode:'normal'},ui:{selected:{cards:[],targets:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const intent=await import('../score/decision/state/cooperativeTrickIntent.js?v=41a');
const materials=await import('../score/decision/response/responseMaterials.js?v=41a');
const {evaluateWuxie}=await import('../score/decision/response/wuxieEvaluator.js?v=41a');
tactical.captureTacticalSettings();let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
function use(id,targets=[ally,enemy],source=human){const choice={name:'chooseToUse',type:'phase',player:source,parent:{name:'phaseUse',player:source}};const root={name:'useCard',player:source,card:{name:id},targets,parent:choice};intent.observeCooperativeTrickUse(root,source,choice);return root;}
function ctx(root,target=ally,scope='target'){return {originalSpellId:root.card.name,source:root.player,target,targets:root.targets,effectScope:scope,card:root.card,responseEvent:root};}
check('5 玩家手动决斗队友接入同一实际用牌意图',()=>{const root=use('juedou',[ally]);assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)).kind,'manual-friendly-duel');const r=evaluateWuxie(ally,null,ctx(root));assert(r.playerIntentRespected);assert.equal(r.use,false);intent.finishCooperativeTrickUse(root);});
check('5 玩家AOE只在当前响应者有合法防御且无致命风险时减小干预',()=>{for(const [id,defense] of [['nanman','sha'],['wanjian','shan']]){ally.hand=[{name:defense}];const root=use(id);assert(intent.cooperativeTrickIntent(ally,ctx(root)));assert.equal(evaluateWuxie(ally,null,ctx(root)).use,false);intent.finishCooperativeTrickUse(root);}});
check('5 群体取消、濒死队友、缺防御和强命均不享受AOE豁免',()=>{
 ally.hand=[{name:'sha'}];const root=use('nanman');assert.equal(intent.cooperativeTrickIntent(ally,ctx(root,ally,'all')),null);
 ally.hp=1;assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)),null);ally.hp=3;
 ally.hand=[];assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)),null);
 ally.hand=[{name:'sha'}];root.directHit=[ally];assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)),null);intent.finishCooperativeTrickUse(root);
});
check('5 不把来源意图授予别的队友目标或强制技能',()=>{
 ally.hand=[{name:'sha'}];const root=use('nanman',[ally]);assert.equal(intent.cooperativeTrickIntent(ally,ctx(root,enemy)),null);intent.finishCooperativeTrickUse(root);
 const forced=use('juedou',[ally]);intent.finishCooperativeTrickUse(forced);forced.forced=true;intent.observeCooperativeTrickUse(forced,human,forced.parent);assert.equal(intent.cooperativeTrickIntent(ally,ctx(forced)),null);
});
check('5 多杀要求不复用同一张防御材料',()=>{ally.hand=[{name:'sha'}];const root=use('nanman');root.shaRequired=2;assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)),null);ally.hand.push({name:'sha'});assert(intent.cooperativeTrickIntent(ally,ctx(root)));intent.finishCooperativeTrickUse(root);});
const {evaluateJiedaoResponse,installJiedaoResponseBridge}=await import('../score/decision/response/jiedaoResponse.js?v=41a');
function borrowEvent(){const root={name:'jiedao',player:human,target:ally,addedTarget:enemy,card:{name:'jiedao'}};return {name:'chooseToUse',player:ally,parent:root,sourcex:enemy,respondTo:[human,root.card],filterCard:c=>c.name==='sha'};}
check('6 武圣与龙胆静态转化的材料成本进入实际借刀响应',()=>{
 const red={name:'shan',color:'red',value:4};ally.hand=[red];ally.equip=[{name:'zhuge',subtypes:['equip1']}];ally.skills=['wusheng'];
 stub.lib.skill.wusheng={enable:['chooseToUse','chooseToRespond'],viewAs:{name:'sha'},filterCard:c=>c.color==='red',selectCard:1};
 const e=borrowEvent();assert.equal(evaluateJiedaoResponse(ally,e,'wusheng').resolved,true);e.skill='wusheng';assert.equal(evaluateJiedaoResponse(ally,e,red).resolved,true);
 stub.lib.skill.longdan={enable:['chooseToUse','chooseToRespond'],viewAs:'sha',filterCard:c=>c.name==='shan',selectCard:1};ally.skills=['longdan'];assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'longdan').resolved,true);
});
check('6 丈八式静态双材料不会遗漏消耗，也不会使用非本人材料',()=>{
 const a={name:'shan',value:2},b={name:'tao',value:6};ally.hand=[a,b];ally.skills=['spear'];
 stub.lib.skill.spear={enable:'chooseToUse',viewAs:{name:'sha'},selectCard:2,filterCard:()=>true};
 const e=borrowEvent(),r=evaluateJiedaoResponse(ally,e,'spear');assert(r.resolved);assert.equal(r.shaValue,2);
 ally.hand.pop();assert.equal(evaluateJiedaoResponse(ally,e,'spear').resolved,false);ally.hand=[a,b];
});
check('6 丈八布尔选牌与龙胆分组对象筛选遵循宿主静态声明',()=>{
 ally.hand=[{name:'shan',value:2},{name:'tao',value:3}];ally.skills=['spear'];
 stub.lib.skill.spear.filterCard=true;assert(evaluateJiedaoResponse(ally,borrowEvent(),'spear').resolved);
 ally.skills=['longdan'];stub.lib.skill.longdan={group:['longdan_sha']};
 stub.lib.skill.longdan_sha={enable:'chooseToUse',viewAs:{name:'sha'},filterCard:{name:'shan'}};
 stub.game.expandSkills=skills=>[...skills,...skills.flatMap(s=>stub.lib.skill[s]?.group||[])];
 stub.get.filter=filter=>c=>Object.entries(filter).every(([key,value])=>c[key]===value);
 try{assert(evaluateJiedaoResponse(ally,borrowEvent(),'longdan_sha').resolved);assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'longdan').resolved,false);}
 finally{delete stub.game.expandSkills;delete stub.get.filter;}
});
check('6 禁用、次数限制、动态转化和复杂选牌回退，异常技能不影响实体响应',()=>{
 ally.skills=['broken','dynamic','limited'];ally.hand=[{name:'sha'}];
 stub.lib.skill.broken={enable:'chooseToUse',viewAs:'sha',filterCard:()=>{throw Error('skill');}};
 stub.lib.skill.dynamic={enable:'chooseToUse',viewAs:()=>({name:'sha'}),filterCard:()=>true};
 stub.lib.skill.limited={enable:'chooseToUse',viewAs:'sha',usable:1,filterCard:()=>true};
 assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'dynamic').resolved,false);assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'limited').resolved,false);assert(evaluateJiedaoResponse(ally,borrowEvent()).resolved);
 ally.skills=['wusheng'];ally.hand=[{name:'shan',color:'red',locked:true}];assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'wusheng').resolved,false);
});
check('6 AOE防御识别合法转化，不能让同一材料供应两次响应',()=>{
 ally.skills=['wusheng'];ally.hand=[{name:'shan',color:'red'}];const root=use('nanman');assert(materials.canSupplyTrickResponse(ally,'sha',ctx(root)));
 root.shaRequired=2;assert.equal(materials.canSupplyTrickResponse(ally,'sha',ctx(root)),false);intent.finishCooperativeTrickUse(root);
});
check('6 未建模失装收益不会被伪装成精确交武器收益',()=>{
 ally.hand=[{name:'sha'}];ally.skills=[];ally.hasSkillTag=tag=>tag==='loseEquip';assert.equal(evaluateJiedaoResponse(ally,borrowEvent()).resolved,false);delete ally.hasSkillTag;
});
const {refinedWuxieEffect}=await import('../score/decision/response/wuxieOptimization.js?v=41a');
const {delayedStateImpact}=await import('../score/decision/strategy/delayedOptimization.js?v=41a');
check('6 原生禁止获得的武器不计入交武器损失或收益',()=>{
 ally.skills=[];ally.hand=[{name:'sha'}];ally.getGainableCards=()=>[];
 try{const r=evaluateJiedaoResponse(ally,borrowEvent());assert(r.resolved);assert.equal(r.transferValue,0);}
 finally{delete ally.getGainableCards;}
});
check('7 桃园使用实际宿主回复效果，满血和禁止回复不捏造收益',()=>{
 const root=use('taoyuan'),c=ctx(root);ally.hp=2;assert.equal(refinedWuxieEffect(ally,c).value,6);
 const saved=stub.get.recoverEffect;stub.get.recoverEffect=()=>0;assert.equal(refinedWuxieEffect(ally,c).value,0);
 stub.get.recoverEffect=()=>-2;assert.equal(refinedWuxieEffect(ally,c).value,-6);
 ally.hp=4;ally.maxHp=4;assert.equal(refinedWuxieEffect(ally,c).value,0);ally.hp=3;stub.get.recoverEffect=saved;
});
check('7 无中使用宿主实际效果而非低手牌固定奖励',()=>{
 const saved=stub.get.effect;const root=use('wuzhong',[human]);
 stub.get.effect=()=>0;assert.equal(refinedWuxieEffect(ally,ctx(root,human)).value,0);
 stub.get.effect=()=>2;assert.equal(refinedWuxieEffect(ally,ctx(root,human)).value,6);stub.get.effect=saved;
});
check('7 五谷只读取当前真实公开牌池，之前选走的牌不计入收益',()=>{
 const root=use('wugu'),a={name:'tao',value:9},b={name:'sha',value:2};root.preResult=7;
 stub.ui.dialogs=[{videoId:7,buttons:[{link:a},{link:b}]}];
 assert.equal(refinedWuxieEffect(ally,ctx(root)).value,4.5);
 stub.ui.dialogs[0].buttons.shift();assert.equal(refinedWuxieEffect(ally,ctx(root)).value,1);
 assert.equal(refinedWuxieEffect(ally,ctx(root,enemy)).value,-1);
});
check('7 五谷牌池未知、旧事件不匹配、群体顺序不明时回退，不偷看牌堆',()=>{
 const root=use('wugu');assert.equal(refinedWuxieEffect(ally,ctx(root)),null);
 root.preResult=99;assert.equal(refinedWuxieEffect(ally,ctx(root)),null);
 assert.equal(refinedWuxieEffect(ally,ctx(root,ally,'all')),null);
});
check('7 兵乐无懈与主动打法使用同一公开状态损失，已跳过阶段不再重复计损失',()=>{
 for(const name of ['lebu','bingliang']){const root=use(name),plan=delayedStateImpact(human,ally,name);assert.equal(refinedWuxieEffect(ally,ctx(root)).value,-plan.utility*3);}
 ally.skipList=['phaseDraw'];const root=use('bingliang');assert.equal(refinedWuxieEffect(ally,ctx(root)).value,0);delete ally.skipList;
});
check('7 宿主回复效果异常时回退，而非改用固定回血奖励',()=>{
 const saved=stub.get.recoverEffect;stub.get.recoverEffect=()=>{throw Error('host');};ally.hp=2;
 assert.equal(refinedWuxieEffect(ally,ctx(use('taoyuan'))),null);stub.get.recoverEffect=saved;ally.hp=3;
});
check('5 公开的加伤字段会取消可能致命的AOE意图豁免',()=>{
 ally.hand=[{name:'sha'}];ally.skills=[];const root=use('nanman');root.customArgs={[ally.playerid]:{extraDamage:2}};
 assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)),null);intent.finishCooperativeTrickUse(root);
});
check('6 原生viewAsFilter未返回false时允许，兼容武圣的实际接口',()=>{
 ally.skills=['wusheng'];ally.hand=[{name:'shan',color:'red'}];
 stub.lib.skill.wusheng.viewAsFilter=p=>{if(!p.hand.length)return false;};
 assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'wusheng').resolved,true);
 stub.lib.skill.wusheng.viewAsFilter=()=>false;assert.equal(evaluateJiedaoResponse(ally,borrowEvent(),'wusheng').resolved,false);
 delete stub.lib.skill.wusheng.viewAsFilter;
});
check('6 宿主转化技能递归选材料仍使用当前借刀分支，关闭卸载及普通窗口回退',()=>{
 const red={name:'shan',color:'red',value:4};ally.hand=[red];ally.skills=['wusheng'];
 const e=borrowEvent();e.skill='wusheng';stub._status.event=e;
 Player.prototype.chooseToUse=function(){return e;};stub.lib.element={Player};
 stub.ai.basic={chooseCard(check){return check(red);}};
 const native=stub.ai.basic.chooseCard,remove=installJiedaoResponseBridge();
 try{
  assert(stub.ai.basic.chooseCard(()=>-9)>0);
  stub.lib.config.extension_无名AI_responseAI=false;assert.equal(stub.ai.basic.chooseCard(()=>-9),-9);delete stub.lib.config.extension_无名AI_responseAI;
  e.parent.name='ordinary';assert.equal(stub.ai.basic.chooseCard(()=>-9),-9);e.parent.name='jiedao';
  const prior=stub.game.me;stub.game.me=ally;assert.equal(stub.ai.basic.chooseCard(()=>-9),-9);stub.game.me=prior;
  remove();assert.equal(stub.ai.basic.chooseCard,native);assert.equal(stub.ai.basic.chooseCard(()=>-9),-9);
 }finally{remove();delete stub._status.event;}
});
check('后续第二项 多次响应的可行材料组合贯通玩家AOE意图与无懈',()=>{
 const savedSkills=ally.skills,savedHand=ally.hand;
 try{for(const [id,defense,field] of [['nanman','sha','shaRequired'],['wanjian','shan','shanRequired']]){
  ally.hand=['a','b','c','d'].map(name=>({name}));ally.skills=['_pack_ab','_pack_ac','_pack_bd'];
  for(const [skill,names]of Object.entries({_pack_ab:['a','b'],_pack_ac:['a','c'],_pack_bd:['b','d']}))stub.lib.skill[skill]={enable:'chooseToRespond',viewAs:{name:defense},selectCard:2,filterCard:c=>names.includes(c.name)};
  const root=use(id);root[field]=2;
  try{
   assert(intent.cooperativeTrickIntent(ally,ctx(root)));
   const r=evaluateWuxie(ally,null,ctx(root));assert(r.playerIntentRespected);assert.equal(r.use,false);
   ally.hand[2].locked=true;assert.equal(intent.cooperativeTrickIntent(ally,ctx(root)),null);
  }finally{intent.finishCooperativeTrickUse(root);}
 }}finally{ally.skills=savedSkills;ally.hand=savedHand;for(const skill of ['_pack_ab','_pack_ac','_pack_bd'])delete stub.lib.skill[skill];}
});
console.log(`Trick boundary tests: ${n} passed, 0 failed`);
