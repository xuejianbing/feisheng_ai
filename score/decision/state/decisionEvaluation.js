// Scope only internal evaluation callbacks; never reuse a partial decision.
let evaluating = 0;
export function isDecisionEvaluating() { return evaluating > 0; }
export function withDecisionEvaluation(fn) {
 evaluating++;
 try { return fn(); } finally { evaluating--; }
}
