/* 主观体验评价随当局档案保存；独立于真实胜负和动作训练标签。 */
import { safeGet, safeSet } from '../../foundation/storage/storage.js?v=41a';
const KEY = '无名AI_playerFeedback';
export const feedbackLabels = ['完全不会玩，低级错误频发', '决策明显错误', '经常选错目标或时机', '偶尔犯傻', '基本能打，但有小问题', '中规中矩', '决策比较合理', '思路清晰', '像会玩的玩家', '有配合意识', '像高手'];
function readHistory() {
 let data;
 try { data = JSON.parse(safeGet(KEY) || '{}'); } catch (_) {}
 data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
 return { games: Number.isSafeInteger(data.games) && data.games >= 0 ? data.games : 0,
  skipped: Number.isSafeInteger(data.skipped) && data.skipped >= 0 ? data.skipped : 0,
  scores: Array.isArray(data.scores) ? data.scores.slice(-20) : [], lastMatchId: data.lastMatchId };
}
function saveHistory(data) { try { return safeSet(KEY, JSON.stringify(data)) !== false; } catch (_) { return false; } }
export function preparePlayerFeedback(match, enabled = true) {
 if (!match || match.experienceFeedback) return;
 const data = readHistory();
 if (data.lastMatchId !== match.matchId) data.games++;
 data.lastMatchId = match.matchId;
 match.experienceFeedback = { games: data.games, state: !enabled ? 'disabled' : data.games % 5 === 0 ? 'pending' : 'notDue', source: 'humanExperience' };
 saveHistory(data);
}
export function submitPlayerFeedback(match, score, note = '') {
 const feedback = match && match.experienceFeedback;
 if (!feedback || feedback.state !== 'pending') throw new Error('本局没有待填写的体验反馈');
 if (score !== null && (!Number.isInteger(score) || score < -5 || score > 5)) throw new Error('评分须为 -5 到 +5 的整数');
 const data = readHistory();
 Object.assign(feedback, { state: score === null ? 'skipped' : 'rated', score, note: String(note).trim().slice(0, 2000), time: Date.now() });
 if (score === null) data.skipped++;
 else {
  data.scores = data.scores.filter(x => x && x.matchId !== match.matchId);
  data.scores.push({ matchId: match.matchId, games: feedback.games, score, note: feedback.note, verdict: match.summary && match.summary.verdict || 'unknown', time: feedback.time });
  data.scores = data.scores.slice(-20);
 }
 return { historySaved: saveHistory(data) };
}
