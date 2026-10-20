/* 仅对账已有事实；未执行建议、负即时收益均不等于错误标签。 */
const copy=x=>JSON.parse(JSON.stringify(x));
function actionKey(a){if(!a)return null;const targets=(Array.isArray(a.target)?a.target:a.target?[a.target]:[]).map(String).sort();return JSON.stringify([a.type==='equip'?'card':a.type,a.id,!!a.recast,targets]);}
export function publicDecisionContext(actor,players,key){
 const state=p=>({playerId:key(p),character:p.name1||p.name||null,identity:p.identity||'unknown',hp:p.hp,maxHp:p.maxHp,handCount:p.countCards?.('h')??null,linked:typeof p.isLinked==='function'?p.isLinked():!!p.linked,equipment:(p.getCards?.('e')||[]).map(c=>c.name),judging:(p.getCards?.('j')||[]).map(c=>c.name)});
 return {actorId:key(actor),players:(players||[]).slice(0,16).map(state),actorHand:(actor.getCards?.('h')||[]).slice(0,80).map(c=>({id:c.name,nature:c.nature||null})),informationPolicy:'own-hand-and-public-state'};
}
export function buildDoudizhuDiagnostics(match){
 const map=new Map();
 for(const e of match.events||[]){const d=e.data||{},id=d.transactionId;if(e.matchId&&e.matchId!==match.matchId||e.playerId&&d.actorId&&e.playerId!==d.actorId)continue;if(!id||!['decisionSuggestion','decision','executionMismatch','actionOutcome','actionCredit'].includes(e.kind))continue;
  const key=JSON.stringify([e.matchId||match.matchId,e.playerId||d.actorId||'',id]);let row=map.get(key);if(!row){row={transactionId:id,actorId:e.playerId||d.actorId||null,suggestion:null,commit:null,mismatch:null,outcome:null};map.set(key,row);}
  if(e.kind==='decisionSuggestion')row.suggestion={eventId:e.eventId,...d};
  if(e.kind==='decision')row.commit={eventId:e.eventId,...d};
  if(e.kind==='executionMismatch')row.mismatch={eventId:e.eventId,...d};
  if(['actionOutcome','actionCredit'].includes(e.kind))row.outcome={eventId:e.eventId,...d};
 }
 const rows=[];
 for(const r of map.values()){
  const context=r.suggestion?.modeContext||r.commit?.modeContext||match.meta?.modeContext;
  if(context?.mode!=='doudizhu')continue;
  const stages=r.commit?.decisionStages||r.suggestion?.decisionStages,selected=r.commit?.winner||r.suggestion?.winner;
  const audit=stages?.evaluationAudit||null;
  const actual=r.mismatch?.actual||r.commit?.actual||null;
  const status=r.mismatch?'execution-mismatch':r.commit?'committed':r.outcome?'missing-decision-record':'suggestion-only';
  const different=actual&&selected?(selected.recast===undefined&&actual.recast===true?null:actionKey(actual)!==actionKey(selected)):null;
  rows.push({...r,modeContext:context,status,selected,actual,executionDiffers:different,
   evaluationAudit:audit,auditAvailability:audit?(audit.detailed?'detailed':'summary'):'unavailable',
   stageSummary:(stages?.stages||[]).map(s=>({stage:s.stage,changed:s.changed??null,status:s.evidence?.status||null,reason:s.evidence?.reason||null,error:s.error||s.evidence?.error||null})),
   stageChanges:(stages?.stages||[]).filter(s=>s.changed===true&&s.before&&s.after).map(s=>({stage:s.stage,before:s.before,after:s.after,evidence:s.evidence})),
   rewardStatus:r.outcome?.status||'unobserved',reviewReasons:[...(r.mismatch?['建议与实际执行不一致']:[]),...(r.outcome?.status==='unresolved'?['动作收益未能确认']:[]),...(r.outcome?.status==='observed'&&r.outcome.reward<0?['即时净收益为负，需结合后续动作核对']:[])]});
 }
 const choices=new Map();
 for(const e of match.events||[]) {
  const d=e.data||{};
  if(e.kind!=='choiceAudit'||!d.requestId||e.matchId&&e.matchId!==match.matchId||e.playerId&&e.playerId!==d.actorId||
   match.meta?.modeContext?.sessionId&&d.sessionId!==match.meta.modeContext.sessionId)continue;
  const key=JSON.stringify([d.sessionId,d.actorId,d.domain,d.requestId]);
  if(!choices.has(key))choices.set(key,{requestId:d.requestId,actorId:d.actorId,domain:d.domain,rootActionId:d.rootActionId||null,events:[],executionConfirmed:false});
  choices.get(key).events.push({eventId:e.eventId,...d});
 }
 return {schema:'doudizhu-diagnostics-v1',matchId:match.matchId,recordingComplete:match.dropped===0,
  choiceRecording:match.choiceAuditStats||{recorded:null,dropped:null,note:'未记录容量统计，不能推断响应链完整'},
  summary:{transactions:rows.length,committed:rows.filter(r=>r.status==='committed').length,mismatched:rows.filter(r=>r.status==='execution-mismatch').length,suggestionOnly:rows.filter(r=>r.status==='suggestion-only').length,observed:rows.filter(r=>r.rewardStatus==='observed').length,choiceRequests:choices.size},
  rows:copy(rows),choices:copy([...choices.values()]),trainingEligible:false,
  note:'仅关联同局、同玩家、同事务/请求；对账提示不是错误定论或训练标签。旧档案或关闭详细诊断时无法复原完整链路；子选择返回与宿主用牌调用均不等于效果最终生效。'};
}
