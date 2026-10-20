/* 显式理由归组的有界启发式融合；不是独立概率或精确收益的相加。 */
export const COMMON_SUGGESTION_REASONS = Object.freeze({
 modeStrategy:'mode-role-preference',
 sharedKnowledge:'learned-action-preference',
 campSkillProgress:'skill-progress',
 resourceMaximize:'resource-plan',
 lossMinimize:'loss-prevention',
 characterPolicy:'character-affinity',
});

export function commonSuggestionFusionFor(context) {
 return context?.mode==='doudizhu'&&context.group==='doudizhu-classic'&&context.enabled===true?'reasoned':'legacy';
}

export function suggestionLimit(base) {
 // 给零分/低分候选保留表达偏好的空间；仍有绝对上限，不能替代policy。
 return Math.min(1.5, Math.max(0.5, Math.abs(base) * 0.25));
}

export function fuseSuggestions(proposals, limit) {
 const groups=new Map();
 for(const p of proposals) {
  const key=typeof p.reasonKey==='string'&&p.reasonKey ? p.reasonKey : 'unclassified';
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(p);
 }
 const selected=new Set(), reasons=[];
 let requestedDelta=0;
 for(const [reasonKey,list] of groups) {
  let positive=null,negative=null;
  for(const p of list){
   if(p.delta>0&&(!positive||p.delta>positive.delta))positive=p;
   if(p.delta<0&&(!negative||p.delta<negative.delta))negative=p;
  }
  if(positive)selected.add(positive);
  if(negative)selected.add(negative);
  const delta=(positive?.delta||0)+(negative?.delta||0);
  requestedDelta+=delta;
  reasons.push({reasonKey,delta,positiveSource:positive?.source||null,negativeSource:negative?.source||null});
 }
 const delta=Math.max(-limit,Math.min(limit,requestedDelta));
 const limited=Math.abs(requestedDelta)>limit;
 const scale=limited?limit/Math.abs(requestedDelta):1;
 return {delta,requestedDelta,limit,reasons,suggestions:proposals.map(p=>({...p,
  selected:selected.has(p),appliedDelta:selected.has(p)?p.delta*scale:0,
  status:p.delta===0?'no-suggestion':!selected.has(p)?'not-selected-same-reason':limited?'limited':'included-in-aggregate'}))};
}
