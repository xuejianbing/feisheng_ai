import assert from 'node:assert/strict';
// Fixed inputs only. Tested human uses/results are produced by browser clicks
// through native chooseToUse. Observers forward calls and do not alter AI scores.
export async function runManualIntentScenes(page){
 await page.evaluate(async()=>{
  const {game,lib,get,_status}=realHost,base='/extension/无名AI/score/decision/';
  const me=game.me,[ally,lord]=game.players.filter(p=>p!==me);
  for(const p of game.players)p.clearSkills(true);
  me.identity=ally.identity='fan';lord.identity='zhu';game.zhu=lord;
  for(const [p,role] of [[me,'me'],[ally,'ally'],[lord,'lord']]){p.identityShown=true;p.setIdentity(p.identity);p.dataset.manualRole=role;p.maxHp=4;p.hp=4;p.update();}
  lib.config.extension_无名AI_tacticalDiagnostics=true;
  // This isolated fixture explicitly allows the human to cancel their own card.
  lib.config.wuxie_self=false;
  const tactical=await import(base+'strategy/tacticalOptimization.js?v=41a');
  const engine=await import(base+'engine/engine.js?v=41a');
  const soft=await import(base+'safety/aiOverride.js?v=41a');
  const response=await import(base+'cardplay/responseAI.js?v=41a');
  const use=await import(base+'override/use.js?v=41a');
  tactical.captureTacticalSettings();tactical.installTacticalOptimization();engine.installHooks();soft.installAIOverride();response.installResponseAI();use.installUseOverride();
  const audit=await import('/extension/无名AI/score/perception/journal/choiceAudit.js?v=41a');
  window.manualHarness={me,ally,lord,traces:[],uses:[],responses:[],scene:null,done:false,error:null};
  audit.installChoiceAudit(data=>{manualHarness.traces.push(data);},()=> 'manual-fixed-scenes');
  // The legacy bridge exposes its already computed decision on the real request.
  const nativeChoose=lib.element.Player.prototype.chooseToUse;
  lib.element.Player.prototype.chooseToUse=function(...args){
   const e=nativeChoose.apply(this,args),d=args[0]?.__djsc_wuxie_host_bridge?.decision;
   if(d)manualHarness.traces.push({domain:'response',phase:'legacy-evaluated',actorId:this.playerid,
    resolved:d.resolved,use:d.use,hostState:d.hostState,playerIntentRespected:d.playerIntentRespected,cooperativeIntent:d.cooperativeIntent,
    originalSpellId:d.originalSpellId,reason:d.reason,effectValue:d.effectValue,resourceCost:d.resourceCost});
   return e;
  };
  lib.skill._manualUseObserver={charlotte:true,forced:true,silent:true,popup:false,trigger:{global:['useCard','respond']},filter:(e,p)=>p===game.me,
   content:async(e,t)=>{(t.name==='respond'?manualHarness.responses:manualHarness.uses).push({card:get.name(t.card),actor:t.player.dataset.manualRole,targets:(t.targets||[]).map(p=>p.dataset.manualRole)});}};
  game.addGlobalSkill('_manualUseObserver');
  manualHarness.run=async(name,player,content)=>{const e=game.createEvent(name,false);e.player=player;e.setContent(content);await game.loop(e);};
  manualHarness.setup=async(spec)=>{
   _status.auto=true;
   await manualHarness.run('manualFixtureSetup',me,async()=>{
    for(const p of game.players){const cards=p.getCards('hej');if(cards.length)await p.discard(cards);if(p.isLinked())await p.link(false);p.hp=4;p.update();}
    const give=async(p,names)=>{if(names.length)await p.gain(names.map((name,i)=>game.createCard(name,i%2?'heart':'diamond',7+i)),'gain2');};
    await give(me,spec.hand);await give(ally,['wuxie',...(spec.defense?[spec.defense]:[])]);await give(lord,spec.lordHand||[]);
    if(spec.lion){await ally.equip(game.createCard('baiyin'));ally.hp=2;ally.update();}
    for(const p of game.players)for(const c of p.getCards('he'))c.dataset.manualCard=c.name;
   });
   lib.config.extension_无名AI_tacticalWuxie=spec.optimized!==false;tactical.captureTacticalSettings();
   manualHarness.scene=spec.id;manualHarness.spec=spec;manualHarness.traces=[];manualHarness.uses=[];manualHarness.responses=[];manualHarness.done=false;manualHarness.error=null;
   if(_status.auto)realHost.ui.click.auto();_status.currentPhase=spec.hostile?lord:me;
  };
  manualHarness.start=()=>{
   const hostile=manualHarness.spec.hostile,p=hostile?lord:me;
   manualHarness.run('phaseUse',p,async()=>{
    if(hostile)await p.chooseToUse({type:'phase',forced:true,filterCard:c=>get.name(c)==='huogong',filterTarget:(c,p,t)=>t===me});
    else await p.chooseToUse({type:'phase'});
   }).then(()=>{manualHarness.done=true;}).catch(error=>{manualHarness.error=error.stack||String(error);});
  };
 });
 const scenes=[];
 const specs=[
  {id:'manual-self-fire',card:'huogong',hand:['huogong','sha'],targets:['me']},
  {id:'manual-self-fire-legacy',card:'huogong',hand:['huogong','sha'],targets:['me'],optimized:false},
  {id:'manual-friendly-duel',card:'juedou',hand:['juedou'],targets:['ally']},
  {id:'manual-link-pair',card:'tiesuo',hand:['tiesuo'],targets:['me','ally']},
  {id:'manual-remove-lion',card:'guohe',hand:['guohe'],targets:['ally'],lion:true},
  {id:'manual-friendly-duel-cancelled',card:'juedou',hand:['juedou','wuxie'],targets:['ally'],cancel:true},
  {id:'manual-enemy-duel-counter',card:'juedou',hand:['juedou'],targets:['lord'],lordHand:['wuxie'],counter:true},
  {id:'manual-nanman',card:'nanman',hand:['nanman'],targets:[],defense:'sha'},
  {id:'manual-wanjian',card:'wanjian',hand:['wanjian'],targets:[],defense:'shan'},
  {id:'hostile-fire-control',hand:['sha'],lordHand:['huogong','sha'],hostile:true},
 ];
 const confirm=async()=>{const ok=page.locator('.control').getByText('确定',{exact:true});if(await ok.isVisible())await ok.click();};
 for(const spec of specs){
  await page.evaluate(spec=>manualHarness.setup(spec),spec);await page.evaluate(()=>manualHarness.start());
  if(!spec.hostile){
   await page.waitForFunction(()=>realHost._status.event?.name==='chooseToUse'&&realHost._status.paused,{},{timeout:15000});
   await page.locator(`[data-manual-card="${spec.card}"].selectable`).click();
   for(const role of spec.targets)await page.locator(`[data-manual-role="${role}"].selectable`).click();
   await confirm();
  }
  if(spec.cancel){
   await page.waitForFunction(()=>realHost._status.event?.type==='wuxie'&&realHost._status.event?.player===realHost.game.me&&realHost._status.paused,{},{timeout:15000});
   await page.locator('[data-manual-card="wuxie"].selectable').click();await confirm();
  }
  if(spec.card==='huogong'){
   await page.waitForFunction(()=>manualHarness.done||manualHarness.error||realHost._status.event?.name==='chooseToDiscard',{},{timeout:15000});
   if(!await page.evaluate(()=>manualHarness.done)){await page.locator('[data-manual-card="sha"].selectable').click();await confirm();}
  }
  if(spec.lion){
   await page.waitForFunction(()=>realHost._status.paused&&realHost.ui.dialogs.some(d=>(d.buttons||[]).some(b=>realHost.get.name(b.link)==='baiyin')),{},{timeout:15000});
   // Native dialog uses a button linked to the public equipment; mark that DOM
   // node for a genuine browser click rather than selecting a result in code.
   await page.evaluate(()=>{for(const d of realHost.ui.dialogs)for(const b of d.buttons||[])if(realHost.get.name(b.link)==='baiyin')b.dataset.manualButton='lion';});
   await page.locator('[data-manual-button="lion"].selectable').click();await confirm();
  }
  await page.waitForFunction(()=>manualHarness.done||manualHarness.error,{},{timeout:15000});
  const scene=await page.evaluate(()=>{
   const {me,ally,lord}=manualHarness;
   return {name:manualHarness.scene,optimized:manualHarness.spec.optimized!==false,auto:realHost._status.auto,
    actors:{me:me.playerid,ally:ally.playerid,lord:lord.playerid},hp:{me:me.hp,ally:ally.hp,lord:lord.hp},
    allyWuxie:ally.countCards('h','wuxie'),lordWuxie:lord.countCards('h','wuxie'),linked:{me:me.isLinked(),ally:ally.isLinked()},
    allyArmor:ally.getEquip(2)?.name||null,uses:manualHarness.uses,responses:manualHarness.responses,traces:manualHarness.traces,error:manualHarness.error};
  });
  console.error('[manual scene]',JSON.stringify({name:scene.name,hp:scene.hp,allyWuxie:scene.allyWuxie,uses:scene.uses}));
  assert.equal(scene.error,null);assert.equal(scene.auto,false);
  const decisions=scene.traces.filter(t=>t.domain==='response'&&t.actorId===scene.actors.ally);
  const wx=scene.uses.filter(e=>e.card==='wuxie');
  if(spec.counter){
   assert.deepEqual(wx.map(e=>e.actor),['lord','ally']);assert.equal(scene.hp.lord,3);assert.equal(scene.allyWuxie,0);
   assert(decisions.some(t=>t.hostState===-1&&t.use===true));
  }else if(spec.hostile){
   assert.equal(scene.hp.me,4);assert.equal(scene.allyWuxie,0);assert.deepEqual(wx.map(e=>e.actor),['ally']);
   assert(decisions.some(t=>t.use===true&&!t.playerIntentRespected));
  }else{
   assert.equal(scene.allyWuxie,1);
   assert(decisions.some(t=>t.playerIntentRespected&&t.use===false));
   assert.deepEqual(wx.map(e=>e.actor),spec.cancel?['me']:[]);
   if(spec.card==='huogong')assert.equal(scene.hp.me,3);
   if(spec.card==='juedou')assert.equal(scene.hp.ally,spec.cancel?4:3);
   if(spec.cancel)assert(decisions.some(t=>t.hostState===-1&&t.playerIntentRespected&&t.use===false));
   if(spec.defense){assert.equal(scene.hp.ally,4);assert.equal(scene.hp.lord,3);assert(scene.responses.some(r=>r.actor==='ally'&&r.card===spec.defense));}
   if(spec.card==='tiesuo')assert.deepEqual(scene.linked,{me:true,ally:true});
   if(spec.lion){assert.equal(scene.allyArmor,null);assert.equal(scene.hp.ally,3);}
  }
  scenes.push(scene);
 }
 return {hostVersion:await page.evaluate(()=>realHost.lib.version),setup:'正常斗地主初始化后安排公开身份、手牌及装备，清理武将技能；原生Player/GameEvent、牌内容与AI评分不由测试替换；9个人工点击场景及1个指定敌方进攻对照',settings:{wuxie_self:false,tacticalDiagnostics:true,localAuto:false},scenes};
}
