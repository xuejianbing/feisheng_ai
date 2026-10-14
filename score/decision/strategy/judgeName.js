// A delayed trick may be represented by a different physical card.
export function effectiveJudgeName(card){
 const virtual=card?.viewAs;
 return (typeof virtual==='string'?virtual:virtual?.name)||card?.name||'';
}
