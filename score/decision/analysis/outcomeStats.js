// Read-only projection of retained decision log, never a second reward counter.
export function summarizeOutcomeRecords(records) {
    const outcomes=new Map();
    const validId=id=>typeof id==='string'&&id.trim().length>0 || typeof id==='number'&&Number.isFinite(id);
    let invalidIdentityRecords=0,invalidOutcomeRecords=0;
    for(const row of Array.isArray(records)?records:[]){const o=row?.actionOutcome;
        if(!o)continue;
        if(!validId(o.transactionId)||!validId(o.actorId)){invalidIdentityRecords++;continue;}
        if(!['observed','partial','unresolved'].includes(o.status)||o.status==='observed'&&!Number.isFinite(o.reward))invalidOutcomeRecords++;
        const key=JSON.stringify([String(o.actorId),String(o.transactionId)]);
        const signature=JSON.stringify([o.status,Number.isFinite(o.reward)?o.reward:null]);
        const previous=outcomes.get(key);
        if(previous&&previous.signature!==signature)previous.conflict=true;
        else if(!previous)outcomes.set(key,{signature,outcome:o,conflict:false});
    }
    const rows=[...outcomes.values()].filter(v=>!v.conflict).map(v=>v.outcome);
    const available=Array.isArray(records);
    const complete=available&&!invalidIdentityRecords&&!invalidOutcomeRecords&&![...outcomes.values()].some(v=>v.conflict);
    return {source:'retained-decision-log/actionOutcomes',scope:'本次运行保留日志（非历史累计）',
        completeness:!available?'unknown':invalidIdentityRecords||invalidOutcomeRecords||[...outcomes.values()].some(v=>v.conflict)?'incomplete':'retained-window',
        invalidOutcomeRecords:available?invalidOutcomeRecords:null,
        suggested:null,cancelled:null,executed:null,failed:null,finalConfirmed:null,
        conflictingTransactions:available?[...outcomes.values()].filter(v=>v.conflict).length:null,
        invalidIdentityRecords:available?invalidIdentityRecords:null,
        observed:complete?rows.filter(o=>o.status==='observed'&&Number.isFinite(o.reward)).length:null,
        partial:complete?rows.filter(o=>o.status==='partial').length:null,
        unresolved:complete?rows.filter(o=>o.status==='unresolved').length:null};
}
