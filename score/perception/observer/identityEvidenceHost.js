/* 跟随宿主自然 After/End 事件采集；绝不调用 then/start/forResult 来启动事件。 */
import {game} from '../../foundation/adapt/host.js?v=41a';
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';
import {identityMode,publicIdentityRole,identityFactsState,identityRuleCapabilities,normalizeIdentityRole} from './identityFacts.js?v=41a';
import {recordIdentityEvent,identityEvidenceSession} from './identityEvidence.js?v=41a';
import {effectiveJudgeName} from '../../decision/strategy/judgeName.js?v=41a';

function parentOf(e) {
    if (!e) return null;
    if (e.parent && typeof e.parent === 'object') return e.parent;
    try { const p=e.getParent?.();return p && p!==e ? p : null; } catch (_) { return null; }
}
function useRoot(e) {
    for (let depth=0;e && depth<32;depth++,e=parentOf(e)) if (e.name==='useCard') return e;
    return null;
}
function publicCards(p,zone) {
    try { const cards=p.getCards?.(zone);return Array.isArray(cards)?cards.slice():[]; } catch (_) { return []; }
}
function judgeName(card) { try { return effectiveJudgeName(card) || card.name; } catch (_) { return card.name; } }
export function createIdentityEvidenceCollector() {
    const roots=new WeakMap(), ids=new WeakMap();
    let sequence=0;
    function eventId(e) {
        if (!ids.has(e)) ids.set(e,'public-event-' + (++sequence));
        return ids.get(e);
    }
    function beginUse(root,actor,card,targets,parent) {
        if (identityMode()!=='identity' || !root || typeof root!=='object' || !actor) return;
        if (roots.has(root)) return roots.get(root);
        const list=(Array.isArray(targets)?targets:targets?[targets]:root.targets || []).filter(p=>p && typeof p==='object' && p.hp!==undefined);
        const cardId=typeof card==='string'?card:(card?.name || root.card?.name || '');
        const phase=parent || parentOf(root);
        const phaseParent=parentOf(phase);
        const directPhase=phase?.name==='phaseUse' && phase.player===actor;
        const phaseChoice=phase?.name==='chooseToUse' && phase.player===actor && phase.type==='phase' &&
            phaseParent?.name==='phaseUse' && phaseParent.player===actor;
        const rescueChoice=phase?.name==='chooseToUse' && phase.player===actor && phase.type==='dying' &&
            cardId==='tao' && list.length===1 && phase.dying===list[0];
        const agency=root.forced || phase?.forced ? 'forced'
            : ['nanman','wanjian','taoyuan'].includes(cardId) || list.length>1 ? 'collateral'
            : (directPhase || phaseChoice || rescueChoice) && !root.skill ? 'chosen' : 'unknown';
        const meta={sessionId:identityEvidenceSession(),rootActionId:eventId(root),actorId:playerKey(actor),cardId,agency,
            targets:list,before:list.map(p=>({p,judges:publicCards(p,'j').map(c=>({card:c,name:judgeName(c)})),equips:publicCards(p,'e')}))};
        roots.set(root,meta);return meta;
    }
    function complete(e,kind) {
        if (identityMode()!=='identity' || !e || typeof e!=='object') return;
        const root=useRoot(e),meta=root && roots.get(root);
        // 先前捕获的根动作只能归属原局；迟到回调不可被重标为当前局。
        if (meta && meta.sessionId!==identityEvidenceSession()) return;
        if (kind==='die' && e.player && identityRuleCapabilities().standard && (game.dead || []).includes(e.player)) {
            e.player.__djsc_revealedRole=normalizeIdentityRole(e.player.identity);
        }
        const source=e.source || (kind==='useCard'?e.player:null);
        const actorId=playerKey(source) || meta?.actorId || 'unknown-source';
        const targets=kind==='useCard'?(meta?.targets || e.targets || []):(e.player?[e.player]:[]);
        let agency=meta?.agency || 'unknown';
        if (meta && meta.actorId!==actorId) agency='unknown';
        const actualPublicDeltas={};
        if (kind==='damage') actualPublicDeltas.damage=Number(e.num) || 0;
        else if (kind==='recover') actualPublicDeltas.healing=Number(e.num) || 0;
        else if (kind==='die') actualPublicDeltas.died=true;
        const cardId=meta?.cardId || e.card?.name || '';
        let actionKind=kind;
        if (kind==='useCard' && ['guohe','shunshou'].includes(cardId) && meta) {
            actionKind='remove';
            actualPublicDeltas.removedNegativeJudges=0;actualPublicDeltas.removedEquipment=0;
            for (const before of meta.before) {
                const judges=publicCards(before.p,'j'),equips=publicCards(before.p,'e');
                actualPublicDeltas.removedNegativeJudges+=before.judges.filter(j=>!judges.includes(j.card) && ['lebu','bingliang'].includes(j.name)).length;
                actualPublicDeltas.removedEquipment+=before.equips.filter(c=>!equips.includes(c)).length;
            }
        } else if (kind==='useCard' && cardId==='wuxie') actionKind='wuxie';
        const state=identityFactsState(null);
        return recordIdentityEvent({sessionId:meta?.sessionId || identityEvidenceSession(),eventId:eventId(e),
            rootActionId:meta?.rootActionId || eventId(root || e),actorId,targetIds:targets.map(playerKey).filter(Boolean),
            actionKind,cardId,agency,actualPublicDeltas,
            publicStateRef:state.sessionId + ':' + state.publicRevision + ':' + sequence,
            publicTargetRoles:Object.fromEntries(targets.map(p=>[playerKey(p),publicIdentityRole(p)]))});
    }
    return {beginUse,complete};
}
