/* 保守信用账本：局部资源成本可确认；伤害等外部收益不按比例猜贡献。 */
export function buildActionCreditLedger(group) {
 const groupId=(group?.sessionId||'')+':'+(Array.isArray(group?.transactionIds)?group.transactionIds:[]).join('+');
 const empty={schema:'action-credit-ledger-v1',groupId,policy:'cost-only-no-hit-v1',status:'unresolved',allocations:[],unallocatedReward:null,conservationError:null,eligible:false};
 if(group?.schema!=='delayed-action-group-v1'||group.kind!=='wine-to-sha'||group.status!=='observed'||!Number.isFinite(group.groupReward))return empty;
 const observations=group.observations||[];
 if(!group.sessionId||!group.actorId||!Array.isArray(observations)||!Array.isArray(group.transactionIds)||observations.some(o=>!o||!Array.isArray(o.deltas))||
  observations.length<2||observations.length>17||observations.length!==group.transactionIds.length||new Set(group.transactionIds).size!==observations.length)return empty;
 if(!Number.isFinite(group.wineAmount)||group.wineAmount<=0||group.consumerId!==group.transactionIds.at(-1)||
  JSON.stringify(group.preparationIds)!==JSON.stringify(group.transactionIds.slice(0,-1))||
  observations.some(o=>!Number.isFinite(o.immediateReward))||Math.abs(observations.reduce((sum,o)=>sum+o.immediateReward,0)-group.groupReward)>1e-9)return empty;
 let costOnly=true;
 const allocations=observations.map((o,i)=>{
  const actor=o.deltas?.find(d=>d.playerId===group.actorId);
  if(o.transactionId!==group.transactionIds[i]||o.status!=='partial'||!actor||actor.camp!==1||!Number.isFinite(actor.hand)||actor.hand>0)costOnly=false;
  if(!Array.isArray(o.deltas)||o.deltas.some(d=>Object.entries(d).some(([k,v])=> !['playerId','camp'].includes(k)&&
   !(d.playerId===group.actorId&&['hand','wine'].includes(k))&&v!==0)))costOnly=false;
  const localCost=actor&&Number.isFinite(actor.hand)?Math.min(0,actor.hand*1.5):0;
  return {transactionId:o.transactionId,type:o.type,id:o.id,target:o.target||null,localCost,reward:localCost};
 });
 const localTotal=allocations.reduce((sum,a)=>sum+a.localCost,0),residual=group.groupReward-localTotal;
 const wines=observations.map(o=>o.deltas?.find(d=>d.playerId===group.actorId)?.wine);
 const eligibility=costOnly&&Math.abs(residual)<1e-9&&wines.slice(0,-1).every(v=>Number.isFinite(v)&&v>0)&&
  wines.at(-1)===-group.wineAmount&&wines.slice(0,-1).reduce((sum,v)=>sum+v,0)===group.wineAmount&&group.consumerEvidence?.noHitConfirmed===true&&
  allocations.every((a,i)=>a.type==='card'&&a.id===(i===allocations.length-1?'sha':'jiu'));
 return {...empty,status:eligibility?'allocated-cost-only':'local-costs-only',allocations,
  unallocatedReward:residual,conservationError:group.groupReward-(localTotal+residual),eligible:eligibility};
}
