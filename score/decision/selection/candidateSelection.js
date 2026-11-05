/* 职责归属：动作选择；实现仅在本模块维护，旧路径转发到这里。 */
/* 候选选择模块：统一初选和规划后候选归并。
 * 不执行游戏动作、不记录样本、不访问宿主状态。
 * 排序与归并原地更新 acts，候选对象身份保持不变，供后续仲裁与回放复用。
 */
import { makeActionCandidate, ensureCandidatePolicy, isCandidateEligible,
    compareActionCandidates, candidatePriorityRank, sameCandidateAction } from '../state/actionCandidate.js';

/** 初选：优先职责层级，其次收益；普通候选非正收益时保留结束回合。 */
export function selectInitialCandidate(acts) {
    acts.sort(compareActionCandidates);
    const endAction = acts.filter(function (a) { return a.type === 'end'; })[0] ||
        makeActionCandidate({ type: 'end', id: 'end', score: 0, reason: '结束回合' });
    ensureCandidatePolicy(endAction);
    const eligibleActs = acts.filter(isCandidateEligible);
    const top = eligibleActs[0] || endAction;
    const best = (candidatePriorityRank(top) > 0 || top.score > 0) ? top : endAction;
    return { endAction, eligibleActs, best };
}

/** 规划后归并：同一动作复用已有候选对象，防止两个对象参与后续仲裁。 */
export function mergePlannedCandidate(acts, refined) {
    const canonical = acts.find(function (a) {
        return a && isCandidateEligible(a) && sameCandidateAction(a, refined);
    }) || null;
    let best;
    if (canonical && canonical !== refined) {
        Object.assign(canonical, refined);
        best = canonical;
    } else {
        best = refined;
        if (!acts.some(function (a) { return a === refined; })) acts.push(refined);
    }
    acts.sort(compareActionCandidates);
    return { best, eligibleActs: acts.filter(isCandidateEligible) };
}
