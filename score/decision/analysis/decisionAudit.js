/* 只观测已有结果，不调用评估器、模型或宿主选择。 */
import { compareActionCandidates, isCandidateEligible } from '../state/actionCandidate.js?v=41a';
import { decisionActionSnapshot } from './decisionStages.js?v=41a';

export function auditLeadingAction(candidates) {
 const rows = (candidates || []).map(c=>({...c,policy:c.policy?{...c.policy}:undefined}));
 const top = rows.filter(isCandidateEligible).sort(compareActionCandidates)[0];
 return auditActionSnapshot(top);
}
function auditActionSnapshot(candidate) {
 if (!candidate) return null;
 const clone = {...candidate,policy:candidate.policy?{...candidate.policy}:undefined};
 if (candidate.utilityVector) clone.utilityVector = JSON.parse(JSON.stringify(candidate.utilityVector));
 return decisionActionSnapshot(clone);
}

export function createEvaluationAudit({ enabled = false, detailed = false, settings = {}, control = 'unknown' } = {}) {
 const stages = [];
 return {
  record(stage, candidates) {
   if (!enabled || !detailed || stages.length >= 6) return;
   try { stages.push({ stage, selected: auditLeadingAction(candidates) }); } catch (_) {}
  },
  snapshot(candidates, final) {
   if (!enabled) return null;
   try {
    const rows = detailed ? [final, ...(candidates || [])].filter(Boolean) : [];
    const seen = new Set(), evidence = [];
    for (const candidate of rows) {
     if (evidence.length >= 8) break;
     const action = auditActionSnapshot(candidate), key = JSON.stringify([action.type,action.id,action.target,action.recast]);
     if (seen.has(key)) continue;
     seen.add(key);
     evidence.push({action, commonSuggestions:candidate.commonUtilityAudit || null});
    }
    return JSON.parse(JSON.stringify({schema:'evaluation-audit-v1',detailed,control,settings,stages,candidates:evidence,
     candidateLimit:8,baseline:'existing-core-evaluation',independentModelChoice:false,
     note:'仅观测实际经过的阶段；未记录不等于未运行；不提供未运行模块的反事实结果。'}));
   } catch (_) { return null; }
  },
 };
}
