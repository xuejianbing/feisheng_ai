import assert from 'node:assert/strict';
// Real mode startup and native card resolution. Only public fixture state is arranged.
export async function runCrossModeResponseScenes(page,expectedMode){
 const report=await page.evaluate(async()=>{
  const {game,lib,get,_status}=realHost,base='/extension/无名AI/score/';
  const tactical=await import(base+'decision/strategy/tacticalOptimization.js?v=41a');
  const policy=await import(base+'decision/strategy/cooperationPolicy.js?v=41a');
  const strip=await import(base+'decision/strategy/friendlyStripPlan.js?v=41a');
  const pairs=await import(base+'decision/cards/jiedaoEvaluator.js?v=41a');
  const relations=await import(base+'decision/relations/relations.js?v=41a');
  const {evaluateWuxie}=await import(base+'decision/response/wuxieEvaluator.js?v=41a');
  const {installWuxieOptimization}=await import(base+'decision/response/wuxieOptimization.js?v=41a');
  const use=await import(base+'decision/override/use.js?v=41a');
  const [actor,ally,enemy]=game.players;
  for(const p of game.players)p.clearSkills(true);
  if(get.mode()==='guozhan')for(const p of game.players){p.$showCharacter(2,false);p.clearSkills(true);}
  for(const p of game.players){
   p.maxHp=p.hp=4;p.identityShown=true;
   if(get.mode()==='identity'){p.identity=p===enemy?'zhu':'fan';game.zhu=enemy;p.setIdentity(p.identity);}
   if(get.mode()==='guozhan'){p.group=p.identity=p===actor||p===ally?'wei':'shu';p.setIdentity(p.identity);}
   if(get.mode()==='versus')p.side=p===actor||p===ally;
   p.update();
  }
  lib.config.extension_无名AI_hardOverride=true;lib.config.extension_无名AI_override_respond=true;
  tactical.captureTacticalSettings();tactical.installTacticalOptimization();
  const run=async(name,p,fn)=>{const e=game.createEvent(name,false);e.player=p;e.setContent(fn);await game.loop(e);};
  const clean=async()=>{for(const p of game.players){const cards=p.getCards('hej');if(cards.length)await p.discard(cards);p.hp=4;p.update();}};
  const scenes=[];
  scenes.push({name:'policy-scope',enabled:policy.cooperationPolicyEnabled(),stripUndefined:strip.friendlyStripPlan(actor,{name:'guohe'},ally)===undefined,
   borrowedPairResolved:pairs.bestJiedaoPair(actor).resolved,allyRelation:relations.dispositionOf(actor,ally)});
  await run('crossModeFixture',actor,async()=>{await clean();await ally.gain(game.createCard('wuxie'),'gain2');});
  for(const optimized of [true,false]){
   lib.config.extension_无名AI_tacticalWuxie=optimized;tactical.captureTacticalSettings();
   const original=lib.element.Player.prototype.chooseToUse;
   let remove;if(optimized)remove=installWuxieOptimization(evaluateWuxie);else{use.installUseOverride();remove=()=>use.uninstallUseOverride();}
   try{
    const request={type:'wuxie',state:1,info_map:{card:{name:'huogong'},player:enemy,target:ally,targets:[ally]},ai1:()=>-9};
    const event=ally.chooseToUse(request),card=ally.getCards('h','wuxie')[0],before=event.ai1(card);
    event.finish();const after=event.ai1(card);remove();
    scenes.push({name:optimized?'optimized-window-expiry':'legacy-window-expiry',distinctHostEvent:event!==request,before,after,prototypeRestored:lib.element.Player.prototype.chooseToUse===original,
     auxiliaryReleased:!lib.element.Player.prototype.__djsc_orig_chooseCard&&!lib.element.Player.prototype.__djsc_orig_chooseBool&&!lib.element.Player.prototype.__djsc_orig_chooseTarget});
   }finally{remove();}
  }
  lib.config.extension_无名AI_tacticalWuxie=true;tactical.captureTacticalSettings();
  const response=await import(base+'decision/cardplay/responseAI.js?v=41a');response.installResponseAI();
  await run('phaseUse',enemy,async()=>{
   await clean();await ally.gain(game.createCard('sha','spade',2),'gain2');
   const before=enemy.hp;await enemy.useCard(game.createCard('juedou','spade',12),ally);
   scenes.push({name:'duel-low-sha',enemyHpLost:before-enemy.hp,allyHp:ally.hp});
  });
  await run('phaseUse',actor,async()=>{
   await clean();await ally.addJudge(game.createCard('lebu'));await ally.equip(game.createCard('bagua'));
   await actor.gain(game.createCard('guohe'),'gain2');
   const plan=tactical.stripPlan(actor,{name:'guohe'},ally,true);
   await actor.useCard(actor.getCards('h','guohe')[0],ally);
   scenes.push({name:'legacy-judge-rescue',plan:plan?.kind,remainingJudges:ally.getCards('j').map(c=>c.name),armor:ally.getEquip(2)?.name||null});
  });
  response.uninstallResponseAI();
  return {hostVersion:lib.version,mode:get.mode(),submode:_status.mode||null,players:game.players.length,scenes};
 });
 assert.equal(report.mode,expectedMode);assert(report.players>=3);
 const [scope,optimized,legacy,duel,rescue]=report.scenes;
 assert.equal(scope.enabled,false);assert.equal(scope.stripUndefined,true);assert.equal(scope.borrowedPairResolved,false);assert.equal(scope.allyRelation,1);
 for(const scene of [optimized,legacy]){assert.equal(scene.distinctHostEvent,true);assert(scene.before>0);assert.equal(scene.after,-9);assert.equal(scene.prototypeRestored,true);assert.equal(scene.auxiliaryReleased,true);}
 assert.equal(duel.enemyHpLost,1);assert.equal(duel.allyHp,4);
 assert.equal(rescue.plan,'rescue');assert.deepEqual(rescue.remainingJudges,[]);assert.equal(rescue.armor,'bagua');
 return report;
}
