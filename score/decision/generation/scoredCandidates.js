/* 职责：枚举、去重并按原顺序收集技能、卡牌、装备和结束候选。
 * 基础评分由 scoring 中对应模块返回；本模块不持有估值缓存。 */
import { _buildCardDecisionContext } from '../rules/basicRules.js';
import { buildSkillCandidate } from '../scoring/skillCandidateScore.js';
import { buildCardCandidate } from '../scoring/cardCandidateScore.js';
import { buildEquipCandidate } from '../scoring/equipCandidateScore.js';
export function generateScoredCandidates(context) {
    const { me, acts, hand, sit } = context;
    (me.skills || []).forEach(function (sid) {
        const candidate = buildSkillCandidate(context, sid);
        if (candidate) acts.push(candidate);
    });
    const seen = {};
    const cardDecisionCtx = _buildCardDecisionContext(me);
    hand.forEach(function (id) {
        if (seen[id]) return; seen[id] = 1;
        const candidate = buildCardCandidate(context, id, cardDecisionCtx);
        if (candidate) acts.push(candidate);
    });
    try {
        me.getCards("h").forEach(function (c) {
            const candidate = buildEquipCandidate(context, c);
            if (candidate) acts.push(candidate);
        });
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    acts.push({ type: "end", id: "end", score: 0, reason: "结束回合（保留" + hand.length + "张，" + sit.mode + "）" });
}
