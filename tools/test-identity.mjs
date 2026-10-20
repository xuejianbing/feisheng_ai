#!/usr/bin/env node
// 运行真实生产模块；只替换无名杀宿主。
import assert from 'node:assert/strict';
import { register } from 'node:module';
const stub = {lib:{config:{mode_config:{identity:{}}}},game:{players:[],dead:[]},get:{mode:()=> 'identity',name:c=>c?.name,itemtype:p=>p?.playerid?'player':'card'},_status:{mode:'normal',roundNumber:1},ui:{},ai:{}};
stub.game.writeFile=()=>{};
globalThis.__NONAME_STUB=stub;
globalThis.window={__DJSC:{}};
Object.assign(globalThis,stub);
register('./noname-stub-loader.mjs',import.meta.url);
const id=await import('../score/perception/observer/identity.js?v=41a');
const obs=await import('../score/perception/observer/observer.js?v=41a');
let passed=0,failed=0;
function check(name,fn){try{fn();console.log('PASS '+name);passed++;}catch(e){console.error('FAIL '+name+'\n'+e.message);failed++;}}
function player(key,role,shown=false){return {playerid:key,name:'同名武将',identity:role,identityShown:shown,hp:4,maxHp:4,alive:true,countCards:()=>0,getCards:()=>[],getSkills:()=>[]};}
function setup(roles=['zhu','zhong','fan','nei']){
 const ps=roles.map((r,i)=>player('p'+i,r,i===0));
 stub.game.players=ps;stub.game.dead=[];stub.game.zhu=ps[0];stub.game.me=ps[1];
 stub.get.identityList=()=>roles.slice();stub.get.mode=()=> 'identity';stub._status.mode='normal';
 id.resetBelief();obs.resetObs();return ps;
}
check('忠臣对公开主公是队友',()=>{const [z,l]=setup();assert.equal(id.isLikelyAlly(l,z),true);});
check('主忠双向/反反/公开敌人/自身关系',()=>{const [z,l,f,n]=setup();l.identityShown=f.identityShown=true;assert.equal(id.isLikelyAlly(z,l),true);assert.equal(id.isLikelyEnemy(f,z),true);assert.equal(id.isLikelyEnemy(z,f),true);assert.equal(id.isLikelyAlly(l,l),false);assert.equal(id.isLikelyAlly(n,z),false);});
check('超额公开身份关闭配额硬推断，保留公开事实',()=>{const [z,l,f,n]=setup();l.identityShown=true;f.identity='zhong';f.identityShown=true;const slots=id.remainingRoleSlots(z);assert.equal(slots.constrainable,false);assert(slots.reasonCodes.includes('rule-inventory-inconsistent'));assert.equal(id.hardIdentityOf(z,n).role,null);assert.equal(id.hardIdentityOf(z,f).role,'zhong');});
check('缺失可靠规则不能套经验公式',()=>{setup();delete stub.get.identityList;assert.equal(id.roleInventory().constrainable,false);});
check('特殊子模式与双内显式降级',()=>{setup();stub._status.mode='zhong';assert.equal(id.roleInventory().constrainable,false);setup(['zhu','nei','nei','fan']);assert.equal(id.roleInventory().constrainable,false);});
check('不读取隐藏身份，包括探测明忠',()=>{const [z,l,f,n]=setup();Object.defineProperty(f,'identity',{get(){throw Error('hidden identity read');}});const v=id.identityView(l,f);assert.equal(v.hardRole,null);assert.equal(Object.values(v.probabilities).reduce((s,x)=>s+x,0),1);assert.equal(v.calibrated,false);assert.equal(id.identityView(z,n).targetId,'p3');});
check('观察者自身私有身份只影响自身视角',()=>{const [z,l,f]=setup();assert.equal(id.identityView(l,l).source,'self');assert.equal(id.identityView(l,l).hardRole,'zhong');assert.equal(id.identityView(z,l).hardRole,null);assert.equal(id.identityView(f,l).probabilities.fan,0);});
check('主公视图含四身份完整 one-hot',()=>{const [z,l]=setup();assert.deepEqual(id.identityView(l,z).probabilities,{zhu:1,zhong:0,fan:0,nei:0});});
check('视图诊断声明实际消费的新证据组数',()=>{const [z,l,f]=setup();assert.equal(id.identityView(l,f).diagnostics.evidenceGroups,0);});
check('同名实体视图隔离',()=>{const [z,l,f]=setup();assert.notEqual(id.identityView(z,l).targetId,id.identityView(z,f).targetId);});
check('同回合公开身份、扩展死亡事实与规则变更立即刷新',()=>{const [z,l,f]=setup();const before=id.identityView(z,l);l.identityShown=true;const after=id.identityView(z,l);assert(after.publicRevision>before.publicRevision);assert.equal(after.hardRole,'zhong');f.__djsc_revealedRole='fan';assert.equal(id.identityView(z,f).hardRole,'fan');stub.get.identityList=()=>['zhu','fan','fan','nei'];assert.equal(id.remainingRoleSlots(z).constrainable,false);assert.notEqual(id.identityView(z,l).ruleVersion,after.ruleVersion);});
check('私有身份版本与重开局不命中旧缓存',()=>{const [z,l,f]=setup();const before=id.identityView(l,f);l.identity='nei';assert.notDeepEqual(id.identityView(l,f).probabilities,before.probabilities);const session=id.identityView(z,f).sessionId;f.__djsc_revealedRole='fan';id.resetBelief();assert.notEqual(id.identityView(z,f).sessionId,session);assert.equal(f.__djsc_revealedRole,undefined);});
const {extractFeatures}=await import('../score/model/features/features.js?v=41a');
const panel=await import('../score/view/dashboard/identityVisual.js?v=41a');
const relations=await import('../score/decision/relations/relations.js?v=41a');
check('死亡公开事实不依赖 identityShown，来源和知晓程度一致',()=>{const [z,l,f]=setup();f.hp=0;stub.game.players=stub.game.players.filter(p=>p!==f);stub.game.dead=[f];f.__djsc_revealedRole='fan';const exposure=relations.exposureOf(l,f);assert.equal(exposure.shown,true);assert.equal(exposure.known,1);assert.equal(exposure.source,'dead_id');f.identityShown=true;assert.equal(relations.exposureOf(l,f).source,'dead_id');});
check('公开主公与存活明置角色保留准确来源',()=>{const [z,l,f]=setup();assert.equal(relations.exposureOf(l,z).source,'shown_lord');f.identityShown=true;const exposure=relations.exposureOf(l,f);assert.equal(exposure.source,'shown_id');assert.equal(exposure.known,1);});
check('濒死未公开身份不能据血量获得死亡公开来源',()=>{const [z,l,f]=setup();f.hp=0;const exposure=relations.exposureOf(l,f);assert.equal(exposure.shown,false);assert.notEqual(exposure.source,'dead_id');assert(exposure.known<1);});
check('特征不受隐藏目标真值替换影响',()=>{const [z,l,f]=setup();const a=Array.from(extractFeatures(l,{type:'card',id:'sha'},{bestT:f}));f.identity='zhong';const b=Array.from(extractFeatures(l,{type:'card',id:'sha'},{bestT:f}));assert.deepEqual(a,b);assert.deepEqual(b.slice(130),[0,0,0,0]);});
check('特征提取不访问隐藏身份 getter 或目标手牌内容',()=>{const [z,l,f]=setup();let identityReads=0,handReads=0;Object.defineProperty(f,'identity',{get(){identityReads++;throw Error('hidden identity');}});f.getCards=zone=>{if(zone==='h'){handReads++;throw Error('hidden hand');}return [];};extractFeatures(l,{type:'card',id:'sha'},{bestT:f});assert.equal(identityReads,0);assert.equal(handReads,0);});
check('合法自身与公开目标特征保留',()=>{const [z,l]=setup();const f=extractFeatures(l,{type:'card',id:'tao'},{bestT:z});assert.equal(f[13],127);assert.deepEqual(Array.from(f.slice(130)),[127,0,0,0]);});
check('面板统一使用观察者视图、不使用宿主态度',()=>{const [z,l,f]=setup();let calls=0;stub.get.attitude=()=>{calls++;return -10;};const a=panel.inferIdentity(f,l);f.identity='zhong';const b=panel.inferIdentity(f,l);assert.deepEqual(a,b);assert.equal(calls,0);assert.equal(a.calibrated,false);assert.equal(a.weightLabel,'推断权重');});
check('关系缓存键跟踪精确版本，非仅舍入最大值',()=>{const [z,l,f]=setup();obs.observeAttack(f,z,1);const before=relations.relationStateKey(l);obs.observeAttack(f,z,0.00001);assert.notEqual(relations.relationStateKey(l),before);});
check('身份旧模型暂停，其他模式兼容声明明确',()=>{setup();const status=id.identityModelCompatibility();assert.equal(status.allowed,false);assert.equal(status.sampleAllowed,false);assert.equal(status.reason,'identity-feature-schema-migration');stub.get.mode=()=> 'doudizhu';assert.equal(id.identityModelCompatibility().allowed,true);assert.equal(id.identityModelCompatibility().compatibility,'legacy-public-role');});
const training=await import('../score/model/train/trainExport.js?v=41a');
const champion=await import('../score/decision/strategy/championStrategy.js?v=41a');
check('身份场低层采样入口拒绝旧语义混入',()=>{setup();const before=training.bufferSize();assert.equal(training.pushSample(new Int8Array(134),0,{action:'card',id:'sha'}),false);assert.equal(training.bufferSize(),before);assert(training.getSampleDiagnostics().rejected['card:identity-feature-schema-migration']>0);});
check('身份场冠军路径明确暂停',()=>{setup();const acts=[{type:'card',id:'sha',score:5},{type:'end',id:'end',score:0}];const result=champion.applyChampionRule(acts,acts[0],1,{championMode:'active'});assert.equal(result.replaced,false);assert.equal(result.evidence.status,'paused');assert.equal(result.evidence.reason,'identity-feature-schema-migration');});
const diagnostics=await import('../score/perception/observer/identityDiagnostics.js?v=41a');
check('宿主回退实际计数，不猴补丁替换宿主',()=>{const [z,l,f]=setup();diagnostics.resetIdentityAudit();stub.get.effect=()=>9;const original=stub.get.effect;assert.equal(diagnostics.identityHostEffect(f,{name:'sha'},l,l),9);assert.equal(stub.get.effect,original);assert.equal(diagnostics.identityAuditStats().total,1);assert.equal(diagnostics.identityAuditStats().reasonCode,'host-semantics-fallback');});
const evidence=await import('../score/perception/observer/identityEvidence.js?v=41a').catch(()=>({}));
function event(over={}){return {eventId:'e1',rootActionId:'r1',actorId:'p2',targetIds:['p0'],decisionIndex:1,publicStateRef:'s1',actionKind:'damage',agency:'chosen',publicTargetRoles:{p0:'zhu'},actualPublicDeltas:{damage:1},...over};}
check('公开事件不可变，eventId 幂等，rootActionId 合并',()=>{evidence.resetIdentityEvidence('test');const raw=event();assert.equal(evidence.recordIdentityEvent(raw),true);raw.actualPublicDeltas.damage=99;assert.equal(evidence.recordIdentityEvent(raw),false);evidence.recordIdentityEvent(event({eventId:'e2',actionKind:'useCard',actualPublicDeltas:{},cardId:'sha'}));evidence.recordIdentityEvent(event({eventId:'e3',actionKind:'die',actualPublicDeltas:{died:true}}));const report=evidence.identityEvidenceReport();assert.equal(report.events.length,3);assert.equal(report.evidence.length,1);assert.equal(report.events[0].actualPublicDeltas.damage,1);assert(Object.isFrozen(report.events[0].actualPublicDeltas));assert.equal(report.stats.duplicates,1);});
check('拆主公兵乐是帮助，拆装备是伤害，仅按牌名无法判断',()=>{evidence.resetIdentityEvidence('test');evidence.recordIdentityEvent(event({cardId:'guohe',actionKind:'remove',actualPublicDeltas:{removedNegativeJudges:1}}));assert.equal(evidence.identityEvidenceReport().evidence[0].semantics,'benefit');evidence.recordIdentityEvent(event({eventId:'e2',rootActionId:'r2',cardId:'shunshou',actionKind:'remove',actualPublicDeltas:{removedEquipment:1}}));assert.equal(evidence.identityEvidenceReport().evidence[1].semantics,'harm');evidence.recordIdentityEvent(event({eventId:'e3',rootActionId:'r3',cardId:'guohe',actionKind:'useCard',actualPublicDeltas:{}}));assert.equal(evidence.identityEvidenceReport().events[2].semantics,'unknown');});
check('强制、AOE 波及、自救不成为主动身份倾向证据',()=>{evidence.resetIdentityEvidence('test');for(const [i,agency] of ['forced','collateral','unknown'].entries())evidence.recordIdentityEvent(event({eventId:'e'+i,rootActionId:'r'+i,agency}));evidence.recordIdentityEvent(event({eventId:'save',rootActionId:'save',actorId:'p0',actionKind:'recover',actualPublicDeltas:{healing:1}}));assert.equal(evidence.identityEvidenceReport().evidence.length,0);assert.equal(evidence.identityEvidenceReport().events.length,4);});
check('内奸救主保留事实，不因救援锁成忠臣',()=>{evidence.resetIdentityEvidence('test');evidence.recordIdentityEvent(event({actionKind:'recover',actualPublicDeltas:{healing:1}}));const report=evidence.identityEvidenceReport();assert.equal(report.evidence[0].semantics,'benefit');assert.equal(report.events[0].publicTargetRoles.p0,'zhu');assert.equal(report.events[0].actorRole,undefined);});
check('无懈只有最终实际保护关系明晰才能算帮助，反无懈未知',()=>{evidence.resetIdentityEvidence('test');evidence.recordIdentityEvent(event({actionKind:'wuxie',actualPublicDeltas:{finalCancelled:false,preventedHarm:0}}));assert.equal(evidence.identityEvidenceReport().evidence.length,0);evidence.recordIdentityEvent(event({eventId:'e2',rootActionId:'r2',actionKind:'wuxie',actualPublicDeltas:{finalCancelled:true,preventedHarm:1,protectedId:'p0',effectiveActorId:'p2'}}));assert.equal(evidence.identityEvidenceReport().evidence[0].semantics,'benefit');});
check('公开角色后续变化不回写历史，未知机会不造负证据',()=>{evidence.resetIdentityEvidence('test');const e=event({publicTargetRoles:{p0:null}});evidence.recordIdentityEvent(e);e.publicTargetRoles.p0='fan';const r=evidence.identityEvidenceReport();assert.equal(r.events[0].publicTargetRoles.p0,null);assert.equal(r.events[0].opportunity,'unknown');assert.equal(r.events[0].publicStateRef,'s1');});
check('首批旧观察不再因拆顺牌名记敌意',()=>{const [z,l,f]=setup();obs.observeCardUse(f,{name:'guohe'},z);assert.equal(obs.attackBy(f,z),0);obs.observeCardUse(f,{name:'shunshou'},z);assert.equal(obs.attackBy(f,z),0);});
const hostEvidence=await import('../score/perception/observer/identityEvidenceHost.js?v=41a').catch(()=>({}));
check('宿主完成事件记录友方伤害，酒杀/死亡同根且不启动 thenable',()=>{const [z,l]=setup();let thenCalls=0;const collector=hostEvidence.createIdentityEvidenceCollector();const phase={name:'phaseUse',player:l};const root={name:'useCard',player:l,card:{name:'sha'},targets:[z],parent:phase,then(){thenCalls++;}};collector.beginUse(root,l,root.card,[z],phase);const damage={name:'damage',source:l,player:z,num:2,parent:root};collector.complete(damage,'damage');collector.complete(damage,'damage');collector.complete({name:'die',source:l,player:z,parent:damage},'die');collector.complete(root,'useCard');const report=evidence.identityEvidenceReport();assert.equal(thenCalls,0);assert.equal(report.events.filter(e=>e.actionKind==='damage').length,1);assert.equal(report.evidence.length,1);assert.equal(report.events[0].actualPublicDeltas.damage,2);assert(report.events.every(e=>e.rootActionId===report.events[0].rootActionId));});
check('宿主拆除比较公开判定/装备快照，不偷看手牌',()=>{const [z,l]=setup();const collector=hostEvidence.createIdentityEvidenceCollector();let judges=[{name:'lebu'}];z.getCards=zone=>{if(zone==='h')throw Error('hidden hand');return zone==='j'?judges:[];};const phase={name:'phaseUse',player:l};const root={name:'useCard',player:l,card:{name:'guohe'},targets:[z],parent:phase};collector.beginUse(root,l,root.card,[z],phase);judges=[];collector.complete(root,'useCard');assert.equal(evidence.identityEvidenceReport().evidence[0].semantics,'benefit');});
check('旧局宿主完成回调不可写入新局账本',()=>{const [z,l]=setup();const collector=hostEvidence.createIdentityEvidenceCollector();const root={name:'useCard',player:l,card:{name:'sha'},targets:[z],parent:{name:'phaseUse',player:l}};collector.beginUse(root,l,root.card,[z],root.parent);obs.resetObs();collector.complete({name:'damage',source:l,player:z,num:1,parent:root},'damage');assert.equal(evidence.identityEvidenceReport().events.length,0);});
check('死亡身份只在确认死亡后公开，不能在创建 die 事件时提前泄露',()=>{const [z,l,f]=setup();const collector=hostEvidence.createIdentityEvidenceCollector();collector.complete({name:'die',source:l,player:f},'die');assert.equal(f.__djsc_revealedRole,undefined);stub.game.players=stub.game.players.filter(p=>p!==f);stub.game.dead=[f];collector.complete({name:'die',source:l,player:f},'die');assert.equal(id.identityView(z,f).hardRole,'fan');});
check('未支持明忠模式不能泄露暗主公或推断其隐藏身份',()=>{const [z,l,f]=setup();stub._status.mode='zhong';z.identityShown=false;const v=id.identityView(l,z);assert.equal(v.hardRole,null);assert.equal(v.probabilities.zhu,.25);});
check('未支持明忠模式的关系暴露状态也不能公开暗主公',()=>{const [z,l]=setup();stub._status.mode='zhong';z.identityShown=false;assert.equal(relations.exposureOf(l,z).shown,false);});
check('正常生命周期的视图和账本使用同一会话号',()=>{const [z,l]=setup();assert.equal(id.identityView(l,z).sessionId,evidence.identityEvidenceReport().sessionId);id.resetBelief();assert.equal(id.identityView(l,z).sessionId,evidence.identityEvidenceReport().sessionId);});
check('真实 chooseToUse(type=phase) 出牌链产生单组主动证据',()=>{const [z,l]=setup();const collector=hostEvidence.createIdentityEvidenceCollector();const phase={name:'phaseUse',player:l};const choice={name:'chooseToUse',type:'phase',player:l,parent:phase};const root={name:'useCard',card:{name:'sha'},player:l,targets:[z],parent:choice};collector.beginUse(root,l,root.card,root.targets,choice);collector.complete({name:'damage',source:l,player:z,num:1,parent:root},'damage');assert.equal(evidence.identityEvidenceReport().events[0].agency,'chosen');assert.equal(evidence.identityEvidenceReport().evidence.length,1);});
check('真实濒死 chooseToUse(type=dying) 自愿救主产生帮助证据',()=>{const [z,l]=setup();const collector=hostEvidence.createIdentityEvidenceCollector();const choice={name:'chooseToUse',type:'dying',player:l,dying:z,parent:{name:'_save',player:l}};const root={name:'useCard',card:{name:'tao'},player:l,targets:[z],parent:choice};collector.beginUse(root,l,root.card,root.targets,choice);collector.complete({name:'recover',source:l,player:z,num:1,parent:root},'recover');assert.equal(evidence.identityEvidenceReport().evidence[0]?.semantics,'benefit');});
check('技能控制下的 chooseToUse 不能借 phaseUse 祖先伪装主动选择',()=>{const [z,l]=setup();const collector=hostEvidence.createIdentityEvidenceCollector();const phase={name:'phaseUse',player:l};const choice={name:'chooseToUse',type:'phase',player:l,parent:{name:'jiedao',player:l,parent:phase}};const root={name:'useCard',card:{name:'sha'},player:l,targets:[z],parent:choice};collector.beginUse(root,l,root.card,root.targets,choice);collector.complete({name:'damage',source:l,player:z,num:1,parent:root},'damage');assert.equal(evidence.identityEvidenceReport().evidence.length,0);});
check('非身份模式保留旧目标特征语义，不将变更输入交给旧权重',()=>{for(const mode of ['versus','boss','single']){const [z,l,f]=setup();stub.get.mode=()=>mode;for(const [role,expected] of [['zhu',[127,0,0,0]],['zhong',[0,127,0,0]],['fan',[0,0,127,0]]]){f.identity=role;assert.deepEqual(Array.from(extractFeatures(l,{type:'card',id:'sha'},{bestT:f}).slice(130)),expected,mode+'/'+role);}assert.equal(id.identityModelCompatibility().featureSchema,'legacy-134');}});
setup();
const engine=await import('../score/decision/engine/engine.js?v=41a');
check('真实生产模型入口在身份场返回暂停原因',()=>{const result=engine.safeModelPredict(new Int8Array(134));assert.equal(result.action,'skip');assert.equal(result.ready,false);assert.equal(result.reason,'identity-feature-schema-migration');});
check('真实引擎包装器与全局完成技能贯通并可卸载',()=>{
 const [z,l]=setup();
 class HostPlayer {useCard(card,cards,targets){return {name:'useCard',player:this,card,targets,parent:stub._status.event};}}
 stub.lib.element={Player:HostPlayer};stub.lib.skill={};stub.game.addGlobalSkill=()=>{};stub.game.removeGlobalSkill=()=>{};
 const actor=Object.assign(new HostPlayer(),l);stub.game.players[1]=actor;stub.game.me=actor;
 const original=HostPlayer.prototype.useCard;
 const choice={name:'chooseToUse',type:'phase',player:actor,parent:{name:'phaseUse',player:actor}};
 stub._status.event=choice;
 try {
  engine.installHooks();
  const root=actor.useCard({name:'sha'},[],[z]);
  const damage={name:'damage',source:actor,player:z,num:1,parent:root};
  const hook=stub.lib.skill._djsc_identityEvidence;
  assert(hook.trigger.global.includes('damageEnd'));
  assert.equal(hook.filter(damage,z),true);
  hook.content({},damage);
  assert.equal(evidence.identityEvidenceReport().evidence.length,1);
  assert.equal(evidence.identityEvidenceReport().events[0].agency,'chosen');
 } finally {engine.uninstallHooks();delete stub._status.event;}
 assert.equal(HostPlayer.prototype.useCard,original);
 assert.equal(stub.lib.skill._djsc_identityEvidence,undefined);
});
console.log(`Identity tests: ${passed} passed, ${failed} failed`);
// trainExport 的生产保存重试有长寿命定时器；测试断言完成即可退出。
process.exit(failed?1:0);
