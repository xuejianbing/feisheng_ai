/* 公开事件账本与旁路语义。此模块不读取玩家真实身份、不产生角色权重。 */
export const IDENTITY_EVIDENCE_VERSION = 'identity-evidence-v1';
const MAX_EVENTS = 8192;
const DELTAS = ['damage','healing','removedNegativeJudges','removedEquipment','died',
    'finalCancelled','preventedHarm','protectedId','effectiveActorId'];
let sessionId = 'identity-evidence-0', sequence = 0, events = [], seen = new Set();
let stats = {duplicates:0,rejected:0,truncated:false,reasons:{}};
function reason(code) { stats.reasons[code]=(stats.reasons[code] || 0)+1; }
function classify(e) {
    const reasons = [];
    const d = e.actualPublicDeltas;
    let semantics = 'unknown';
    if (e.actionKind === 'damage' && d.damage > 0) semantics = 'harm';
    if (e.actionKind === 'recover' && d.healing > 0) semantics = 'benefit';
    if (e.actionKind === 'remove') {
        const aid = d.removedNegativeJudges > 0, harm = d.removedEquipment > 0;
        semantics = aid && harm ? 'mixed' : aid ? 'benefit' : harm ? 'harm' : 'unknown';
    }
    if (e.actionKind === 'wuxie') {
        if (d.finalCancelled === true && d.preventedHarm > 0 && d.effectiveActorId === e.actorId && e.targetIds.includes(d.protectedId)) semantics = 'benefit';
        else reasons.push('wuxie-final-protection-unknown');
    }
    if (e.agency !== 'chosen') reasons.push('agency-' + e.agency);
    if (e.targetIds.length !== 1) reasons.push('not-single-target');
    if (e.targetIds.includes(e.actorId)) reasons.push('self-action');
    if (semantics === 'unknown') reasons.push('semantics-unknown');
    return {semantics,reasonCodes:reasons,eligible:reasons.length === 0};
}
export function recordIdentityEvent(input) {
    if (!input || typeof input.eventId !== 'string' || typeof input.rootActionId !== 'string' ||
        !input.eventId || !input.rootActionId || typeof input.actorId !== 'string' || !Array.isArray(input.targetIds)) {
        stats.rejected++;reason('invalid-public-event');return false;
    }
    if (input.sessionId && input.sessionId !== sessionId) { stats.rejected++;reason('stale-session');return false; }
    if (seen.has(input.eventId)) { stats.duplicates++;return false; }
    if (events.length >= MAX_EVENTS) { stats.truncated=true;stats.rejected++;reason('event-budget-exceeded');return false; }
    const targetIds = Object.freeze([...new Set(input.targetIds.filter(x=>typeof x === 'string'))]);
    const publicTargetRoles = Object.freeze(Object.fromEntries(targetIds.map(id=>[id,
        ['zhu','zhong','fan','nei'].includes(input.publicTargetRoles?.[id]) ? input.publicTargetRoles[id] : null])));
    const actualPublicDeltas = Object.freeze(Object.fromEntries(DELTAS.filter(k=>{
        const v=input.actualPublicDeltas?.[k];
        return typeof v==='boolean' || (typeof v==='number' && Number.isFinite(v) && v>=0) ||
            (['protectedId','effectiveActorId'].includes(k) && typeof v==='string');
    }).map(k=>[k,input.actualPublicDeltas[k]])));
    const event = {sessionId,eventId:input.eventId,rootActionId:input.rootActionId,actorId:input.actorId,targetIds,
        decisionIndex:Number.isSafeInteger(input.decisionIndex)?input.decisionIndex:events.length,
        publicStateRef:typeof input.publicStateRef==='string'?input.publicStateRef:'unknown',
        actionKind:String(input.actionKind || 'unknown'),cardId:String(input.cardId || ''),actualPublicDeltas,
        agency:['chosen','forced','collateral'].includes(input.agency)?input.agency:'unknown',
        opportunity:input.opportunity==='observed'?'observed':'unknown',publicTargetRoles,evidenceVersion:IDENTITY_EVIDENCE_VERSION};
    const result = classify(event);
    result.reasonCodes.forEach(reason);
    seen.add(event.eventId);
    events.push(Object.freeze({...event,semantics:result.semantics,reasonCodes:Object.freeze(result.reasonCodes),eligible:result.eligible}));
    return true;
}
export function identityEvidenceReport() {
    const groups = new Map();
    for (const e of events) {
        if (!e.eligible) continue;
        const key = JSON.stringify([e.rootActionId,e.actorId,e.targetIds]);
        if (!groups.has(key)) groups.set(key,{rootActionId:e.rootActionId,actorId:e.actorId,targetIds:e.targetIds,
            semantics:e.semantics,eventIds:[],evidenceVersion:IDENTITY_EVIDENCE_VERSION});
        const g = groups.get(key);
        if (e.semantics !== g.semantics) g.semantics='mixed';
        g.eventIds.push(e.eventId);
    }
    return {sessionId,version:IDENTITY_EVIDENCE_VERSION,shadow:true,events:events.slice(),
        evidence:[...groups.values()].map(g=>Object.freeze({...g,eventIds:Object.freeze(g.eventIds)})),
        stats:{...stats,reasons:{...stats.reasons},eventCount:events.length,evidenceGroups:groups.size}};
}
export function identityEvidenceSession() { return sessionId; }
export function resetIdentityEvidence(nextSession) {
    sessionId=nextSession || 'identity-evidence-' + (++sequence);
    events=[];seen=new Set();stats={duplicates:0,rejected:0,truncated:false,reasons:{}};
}
