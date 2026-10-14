import {buildDoudizhuDiagnostics} from './doudizhuDiagnostics.js?v=5e5';
/* 对局事实档案：与有界界面日志独立；不评分，不改变训练标签。 */
export function createMatchArchive({ maxEvents = 20000, maxChars = 16000000, onLateOutcome = () => {} } = {}) {
 let current = null, seq = 0, turn = 0, chars = 0;
 const authorized = new Map(), seenOutcomes = new Set();
 const copy = value => JSON.parse(JSON.stringify(value, (_, item) => ArrayBuffer.isView(item) ? Array.from(item) : item));
 function start(meta = {}) {
  seq = 0; turn = 0; chars = 0;
  current = { schemaVersion: 1, matchId: 'match_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), startedAt: Date.now(), meta: copy(meta), events: [], dropped: 0, replay: null, endedAt: null };
  const retained=[...new Set([...authorized.values()].map(x=>x.match.matchId))].slice(-4);
  for(const [id,owner] of authorized)if(!retained.includes(owner.match.matchId))authorized.delete(id);
  for(const token of seenOutcomes)if(!retained.some(id=>token.startsWith(id+':')))seenOutcomes.delete(token);
 }
 function append(match, kind, data, context = {}) {
  if (!match) return null;
  try {
   const event = { eventId: (match.events.at(-1)?.eventId || 0) + 1, matchId: match.matchId, turnId: turn, ts: Date.now(), kind, ...copy(context), data: copy(data) };
   const size = JSON.stringify(event).length;
   if (match.events.length >= maxEvents || (match === current ? chars : JSON.stringify(match.events).length) + size > maxChars) { match.dropped++; return null; }
   if (match === current) chars += size;
   match.events.push(event); return event.eventId;
  } catch (_) { match.dropped++; return null; }
 }
 function record(kind,data,context={}) { return current && !current.endedAt ? append(current,kind,data,context) : null; }
 function authorizeOutcome(transactionId,actorId,context={}) {
  if (!current || current.endedAt || !transactionId || !actorId) return false;
  if (authorized.has(transactionId)) return false;
  authorized.set(transactionId,{match:current,actorId,turnId:turn,context:copy(context)});
  if (authorized.size > maxEvents) authorized.delete(authorized.keys().next().value);
  return true;
 }
 function recordOutcome(kind,data,context={}) {
  if (!['actionOutcome','actionCredit','delayedActionOutcome','delayedEvidence'].includes(kind)) return null;
  const ids = ['actionOutcome','actionCredit'].includes(kind) ? [data.transactionId] : data.transactionIds;
  if(kind==='actionCredit'&&(data.status!=='observed'||data.creditAllocation?.policy!=='cost-only-no-hit-v1'))return null;
  if (!Array.isArray(ids) || !ids.length) return null;
  const owner = authorized.get(ids[0]);
  if (!owner || ids.some(id => { const other=authorized.get(id);return !other || other.match !== owner.match || other.actorId !== data.actorId; })) return null;
  if(kind==='delayedEvidence'&&(!data.evidenceId||data.trainingEligible!==false))return null;
  const token=owner.match.matchId+':'+kind+':'+ids.join(',')+(kind==='delayedEvidence'?':'+data.evidenceId:'');
  if (seenOutcomes.has(token)) return null;
  const evidenceContext=kind==='delayedEvidence'?{...owner.context,...context,preparationTurnId:owner.turnId,preparationRound:owner.context.round,
   turnId:owner.match===current?turn:owner.turnId,playerId:owner.actorId}:{...context,...owner.context,turnId:owner.turnId,playerId:owner.actorId};
  const result=append(owner.match,kind,data,evidenceContext);
  if (result !== null) seenOutcomes.add(token);
  if (owner.match.endedAt) { try { onLateOutcome(copy(owner.match)); } catch (_) {} }
  return result;
 }
 return {
  start, record, authorizeOutcome, recordOutcome, matchId() { return current?.matchId || null; },
  turnEvents(player, playerId) {
   return current ? copy(current.events.filter(e => e.turnId === turn && (playerId ? e.playerId === playerId : e.player === player) && (e.kind === 'action' || e.kind === 'decision'))) : [];
  },
  beginTurn(data, context) { turn++; record('turnBegin', data, context); },
  finishTurn(data, context) { record('turnSummary', data, context); },
  settle(summary, replay = null) {
   if (!current) return null;
   if (!current.endedAt) {
    record('settlement', summary);
    current.summary = copy(summary); current.replay = replay ? copy(replay) : null; current.endedAt = Date.now();
   }
   return copy(current);
  },
  snapshot() { return current ? copy(current) : null; },
  reset() { current = null; authorized.clear(); seenOutcomes.clear(); },
 };
}

export function matchFiles(match, translate = x => String(x)) {
 const result = match.summary && match.summary.verdict || 'unknown';
 const label = { win: '胜利', lose: '失败', draw: '平局', unknown: '未知' }[result] || '未知';
 const name = id => { try { return translate(id); } catch (_) { return String(id); } };
 const rows = ['无名AI 对局档案 ' + match.matchId, '本人结果：' + label,
  '事件数：' + match.events.length + '；缺失记录：' + match.dropped,
  '录像索引为观测时的位置提示，不保证与动作完成帧精确对应。', ''];
 const feedback = match.experienceFeedback;
 if (feedback) rows.push('体验反馈：' + ({pending:'待填写',notDue:'本局未邀请',disabled:'已关闭',skipped:'已跳过',rated:'已评分'}[feedback.state] || feedback.state) + (feedback.state === 'rated' ? '；分数：' + feedback.score : ''), '体验备注：' + (feedback.note || '无'), '');
 for (const e of match.events) {
  rows.push('#' + e.eventId + ' 回合' + e.turnId + ' 第' + (e.round || 0) + '轮 ' + name(e.player || '') + ' [' + e.kind + ']');
  if (e.kind === 'decision') {
   const w = e.data.winner || {};
   rows.push('推荐：' + name(w.id || w.type || '?') + '；评分：' + w.score, '原因：' + (w.reason || '无'));
   rows.push('实际执行：' + JSON.stringify(e.data.actual || null));
  } else rows.push(JSON.stringify(e.data));
 }
 const summary = { ...match, events: undefined, replay: undefined, recording: { events: match.events.length, dropped: match.dropped, complete: match.dropped === 0 },
  replayAvailable: !!match.replay, trainingNote: '观测事实供筛选；包含的评分和胜负不代表每步动作正确，不直接作为已验证训练标签。' };
 const files = { '对局摘要.json': JSON.stringify(summary, null, 2), '事件记录.jsonl': match.events.map(x => JSON.stringify(x)).join('\n'), '阅读版日志.txt': rows.join('\n'), '人工标记.json': JSON.stringify({matchId:match.matchId, annotations: match.annotations || []},null,2) };
 if(match.meta?.modeContext?.mode==='doudizhu'||match.events.some(e=>e.data?.modeContext?.mode==='doudizhu')){
  const diag=buildDoudizhuDiagnostics(match);
  files['斗地主决策对账.json']=JSON.stringify(diag,null,2);
  const action=a=>!a?'无记录':a.type==='end'?'结束回合':(a.recast?'重铸':a.type==='skill'?'发动技能':'使用')+'【'+name(a.id||a.type||'?')+'】'+(a.target?' → '+(Array.isArray(a.target)?a.target:[a.target]).map(name).join('、'):'');
  const statuses={'committed':'已执行','execution-mismatch':'执行不一致','suggestion-only':'仅有建议','missing-decision-record':'缺少决策记录'};
  const lines=['斗地主决策对账 · '+match.matchId,'建议 '+diag.summary.transactions+' 条；执行 '+diag.summary.committed+' 条；差异 '+diag.summary.mismatched+' 条；仅建议 '+diag.summary.suggestionOnly+' 条',diag.note,'记录完整：'+(diag.recordingComplete?'是':'否'),''];
  for(const r of diag.rows){
   lines.push('玩家 '+r.actorId+'｜事务 '+r.transactionId+'｜'+statuses[r.status], '建议：'+action(r.selected),'实际：'+action(r.actual));
   for(const stage of r.stageChanges)lines.push('阶段 '+stage.stage+'：'+action(stage.before)+' → '+action(stage.after));
   lines.push('收益状态：'+r.rewardStatus+(r.outcome?.reward!=null?'；即时收益：'+r.outcome.reward:''),...(r.reviewReasons.length?r.reviewReasons.map(x=>'需核对：'+x):[]),'');
  }
  files['斗地主决策对账.txt']=lines.join('\n');
 }
 if (match.replay && match.replay.encoded) files['对局录像.txt'] = match.replay.encoded;
 return files;
}
