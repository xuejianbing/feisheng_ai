/* 身份规则关系与合法可见事实；隐藏目标的 identity 不得用于探测其是否公开。 */
import {lib,game,get,_status} from '../../foundation/adapt/host.js?v=41a';
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';

export const IDENTITY_ROLES = Object.freeze(['zhu','zhong','fan','nei']);
export const IDENTITY_RULE_VERSION = 'standard-identity-facts-v1';
let sessionSequence = 0, publicRevision = 0, publicKey = '';
let sessionId = 'identity-session-0';

export function normalizeIdentityRole(role) {
    return role === 'mingzhong' ? 'zhong' : IDENTITY_ROLES.includes(role) ? role : null;
}
export function identityMode() {
    try { return get.mode?.() || 'unknown'; } catch (_) { return 'unknown'; }
}
export function identityPlayers() {
    const seen = new Set();
    return (game.players || []).concat(game.dead || []).filter(p => {
        const key = playerKey(p);
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
    });
}
export function identityRuleCapabilities() {
    const mode = identityMode();
    const submode = typeof _status.mode === 'string' ? _status.mode : '';
    const standard = mode === 'identity' && ['', 'normal', 'identity'].includes(submode);
    return {version:IDENTITY_RULE_VERSION, mode, submode, standard,
        supports:{normal:standard,doubleNei:false,mingzhong:false,changingIdentity:false},
        reasonCodes:standard ? [] : ['identity-rule-unsupported']};
}
export function publicIdentityRole(player) {
    if (!player) return null;
    // 斗地主身份在规则上全员公开，保留其旧特征语义。
    if (identityMode()==='doudizhu') return normalizeIdentityRole(player.identity);
    // 明忠模式的 game.zhu 可能是暗主公，不能无条件公开。
    if (identityRuleCapabilities().standard && player === game.zhu) return 'zhu';
    const revealed = normalizeIdentityRole(player.__djsc_revealedRole);
    if (revealed) return revealed;
    if (!player.identityShown) return null;
    return normalizeIdentityRole(player.identity);
}
export function selfIdentityRole(observer) {
    if (!observer) return null;
    return normalizeIdentityRole(observer.identity);
}
export function identityRoleInventory() {
    const capabilities = identityRuleCapabilities();
    const out = {counts:{zhu:0,zhong:0,fan:0,nei:0},total:0,source:'none',constrainable:false,
        capabilities,reasonCodes:capabilities.reasonCodes.slice()};
    if (!capabilities.standard) return out;
    const total = identityPlayers().length;
    let list;
    try { list = get.identityList?.(total); if (Array.isArray(list)) out.source = 'host_identityList'; } catch (_) {}
    if (!Array.isArray(list)) {
        list = lib.config?.mode_config?.identity?.identity?.[total-2];
        if (Array.isArray(list)) out.source = 'mode_config';
    }
    if (!Array.isArray(list)) { out.reasonCodes.push('identity-rule-inventory-unavailable'); return out; }
    let invalid = false;
    for (const raw of list) {
        const role = normalizeIdentityRole(raw);
        if (!role || raw === 'mingzhong') { invalid = true; continue; }
        out.counts[role]++; out.total++;
    }
    // 首批仅声明标准单内；不把自定义多内规则套成单内。
    out.constrainable = !invalid && total >= 2 && out.total === total && out.counts.zhu === 1 && out.counts.nei <= 1;
    if (!out.constrainable) out.reasonCodes.push('identity-rule-unsupported');
    return out;
}
export function remainingIdentitySlots(observer) {
    const inv = identityRoleInventory(), counts = {...inv.counts};
    let unknownCount = 0;
    const reasonCodes = inv.reasonCodes.slice();
    const players = identityPlayers();
    let consistent = !observer || players.includes(observer);
    for (const p of players) {
        const pub = publicIdentityRole(p), own = p === observer ? selfIdentityRole(observer) : null;
        if (pub && own && pub !== own) consistent = false;
        const role = own || pub;
        if (role) counts[role]--; else unknownCount++;
    }
    if (IDENTITY_ROLES.some(r => counts[r] < 0) || IDENTITY_ROLES.reduce((s,r)=>s+counts[r],0) !== unknownCount) consistent = false;
    if (inv.constrainable && !consistent) reasonCodes.push('rule-inventory-inconsistent');
    return {counts,source:inv.source,constrainable:inv.constrainable && consistent,unknownCount,reasonCodes};
}
export function identityFactsState(observer, context = {}) {
    const inv = identityRoleInventory();
    const fingerprint = identityPlayers().map(p => [playerKey(p),p.alive !== false,publicIdentityRole(p)]).sort((a,b)=>a[0].localeCompare(b[0]));
    const next = JSON.stringify(fingerprint);
    if (next !== publicKey) { publicKey = next; publicRevision++; }
    return {sessionId:context.sessionId || sessionId,observerId:playerKey(observer),publicRevision,
        privateVersion:JSON.stringify([selfIdentityRole(observer),context.privateRevision ?? 0]),
        ruleVersion:IDENTITY_RULE_VERSION + ':' + JSON.stringify([inv.counts,inv.source,inv.constrainable,inv.capabilities])};
}
export function resetIdentityFacts() {
    sessionId = 'identity-session-' + (++sessionSequence);
    publicRevision = 0; publicKey = '';
    for (const p of identityPlayers()) delete p.__djsc_revealedRole;
}

export function identityCampRelation(ownRole, targetRole) {
    const camp = role => role === 'zhu' || role === 'zhong' || role === 'mingzhong' ? 'loyal' : role === 'fan' ? 'rebel' : null;
    const a = camp(ownRole), b = camp(targetRole);
    if (!a || !b) return 0;
    return a === b ? 1 : -1;
}
