/* 回合说明只展示已观测事实，不把没有分析的动作补造成 AI 建议。 */
import { isSystemSkillLog, splitSkillLog } from './skillLog.js?v=5e5';
export function buildTurnSummaryLines(turn, events, translate = x => String(x)) {
 const tr = value => { try { return translate(String(value || '?')); } catch (_) { return String(value || '?'); } };
 const target = value => Array.isArray(value) ? value.map(target).join('、') : value ? tr(value) : '';
 const oldSystemEvents = events.filter(e => e.kind === 'action' && e.data && e.data.type === 'skill' && isSystemSkillLog(e.data.skill));
 const actionCount = Math.max(0, turn.actions - oldSystemEvents.length);
 const lines = ['[无名AI·回合汇总] ' + tr(turn.player) + '｜第' + turn.round + '轮' + (turn.partial ? '（回合中断或对局结束）' : ''),
  '观测动作 ' + actionCount + ' 次｜引擎分析 ' + turn.decisions + ' 条'];
 const actions = events.filter(e => e.kind === 'action' && !oldSystemEvents.includes(e)), decisions = events.filter(e => e.kind === 'decision');
 if (actions.length) {
  lines.push('具体动作：');
  actions.forEach((e, i) => {
   const d = e.data || {}, label = { useCard: '使用', recast: '重铸', respond: '响应打出', skill: '发动技能' }[d.type] || d.type || '动作';
   const skill = d.type === 'skill' ? splitSkillLog(d.skill).actionSkills : d.skill;
   const name = target(d.card || skill || '?'), to = target(d.target);
   lines.push((i + 1) + '. ' + label + '【' + name + '】' + (to ? ' → ' + to : ''));
  });
 }
 if (decisions.length) {
  lines.push('具体分析（已匹配提交的建议）：');
  decisions.forEach((e, i) => {
   const w = e.data && e.data.winner || {}, to = target(w.target);
   const name = w.type === 'end' ? '结束出牌' : tr(w.id || w.type);
   lines.push((i + 1) + '. ' + name + (to ? ' → ' + to : '') + '｜评分 ' + (Number.isFinite(Number(w.score)) ? Number(w.score).toFixed(2) : '未知'));
   if (w.reason) lines.push('   原因：' + String(w.reason).replace(/[A-Za-z_][A-Za-z0-9_]*|\d{6,}/g, tr));
  });
 }
 if (actions.length < actionCount || decisions.length < turn.decisions) lines.push('部分明细未进入统一档案；数量以上方观测统计为准。');
 if (!turn.decisions) lines.push(actionCount ? '这些动作没有匹配提交的引擎分析，可能来自其他决策路径。' : '本回合未观测到出牌、响应或游戏技能日志。');
 return lines;
}
