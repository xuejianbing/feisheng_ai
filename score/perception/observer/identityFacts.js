/* 身份规则关系与合法可见事实；隐藏目标的 identity 不得用于探测其是否公开。 */
import {lib,game,get,_status} from '../../foundation/adapt/host.js?v=41a';
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';

export const IDENTITY_ROLES = Object.freeze(['zhu','zhong','fan','nei']);
export const IDENTITY_RULE_VERSION = 'standard-identity-facts-v1';
let sessionSequence = 0, publicRevision = 0, publicKey = '';
let sessionId = 'identity-session-0';
/* 缓存槽（identityRoleInventory / identityFactsState 的亚字符串） */
let _invCacheKey = '', _invCache = null;
let _ruleVerKey = '', _ruleVerVal = '';
let _privVerKey = '', _privVerVal = '';

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
    /* ★ 缓存：本函数每次决策被调用十余次（identityFactsState → identityView 链），
     *   但输入只取决于 模式/子模式/玩家总数 + 宿主角色清单，与具体行动无关。
     *   键里带上清单签名，宿主换规则或删接口时不会命中旧结果。 */
    let total = 0;
    try { total = identityPlayers().length; } catch (_t) { total = 0; }
    let list = null, fromHost = false, listSig = 'nil';
    try {
        if (typeof get.identityList === 'function') {
            const hostList = get.identityList(total);
            if (Array.isArray(hostList)) { list = hostList; fromHost = true; listSig = hostList.join(','); }
        }
        if (!list) {
            const cfgList = lib.config?.mode_config?.identity?.identity?.[total - 2];
            if (Array.isArray(cfgList)) { list = cfgList; listSig = 'cfg:' + cfgList.join(','); }
        }
    } catch (_l) { list = null; listSig = 'err'; }
    const cacheKey = identityMode() + '|' + (typeof _status.mode === 'string' ? _status.mode : '') + '|' + total + '|' + listSig;
    if (_invCache && _invCacheKey === cacheKey) return _invCache;
    _invCacheKey = cacheKey; _invCache = null;   /* 先置空，异常时不返回旧值 */

    const capabilities = identityRuleCapabilities();
    const out = {counts:{zhu:0,zhong:0,fan:0,nei:0},total:0,source:'none',constrainable:false,
        capabilities,reasonCodes:capabilities.reasonCodes.slice()};
    if (capabilities.standard) {
        if (!list) {
            out.reasonCodes.push('identity-rule-inventory-unavailable');
        } else {
            out.source = fromHost ? 'host_identityList' : 'mode_config';
            let invalid = false;
            for (const raw of list) {
                const role = normalizeIdentityRole(raw);
                if (!role || raw === 'mingzhong') { invalid = true; continue; }
                out.counts[role]++; out.total++;
            }
            // 首批仅声明标准单内；不把自定义多内规则套成单内。
            out.constrainable = !invalid && total >= 2 && out.total === total && out.counts.zhu === 1 && out.counts.nei <= 1;
            if (!out.constrainable) out.reasonCodes.push('identity-rule-unsupported');
        }
    }
    _invCache = out;
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
    /* ★ 性能：原实现每次调用做 ① localeCompare 排序（ICU collation，逐对极慢）
     *   ② 两处 JSON.stringify（每次新建长字符串）。身份局一次决策会调用 10+ 次，
     *   仅这一段就占 context 阶段的相当比重。改为 ASCII 直比 + 字符串拼接，
     *   产出的「公开事实指纹」语义不变（只用于检测变化并递增 publicRevision）。 */
    const parts = [];
    const players = identityPlayers();
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        parts.push(playerKey(p) + (p.alive !== false ? '1' : '0') + (publicIdentityRole(p) || '-'));
    }
    parts.sort();
    const next = parts.join(';');
    if (next !== publicKey) { publicKey = next; publicRevision++; }

    /* privateVersion：只依赖「自身身份 + 调用方传入的私有修订号」 */
    const selfRole = selfIdentityRole(observer);
    const privRev = context.privateRevision ?? 0;
    const pvKey = selfRole + '|' + privRev;
    if (_privVerKey !== pvKey) { _privVerKey = pvKey; _privVerVal = JSON.stringify([selfRole, privRev]); }

    /* ruleVersion：只依赖角色清单（inv 已被缓存，同一对象复用时不重算） */
    const rvKey = inv.source + '|' + inv.counts.zhu + ',' + inv.counts.zhong + ',' + inv.counts.fan + ',' + inv.counts.nei + '|' + inv.constrainable;
    if (_ruleVerKey !== rvKey) { _ruleVerKey = rvKey; _ruleVerVal = IDENTITY_RULE_VERSION + ':' + JSON.stringify([inv.counts, inv.source, inv.constrainable, inv.capabilities]); }

    return {sessionId:context.sessionId || sessionId,observerId:playerKey(observer),publicRevision,
        privateVersion:_privVerVal,
        ruleVersion:_ruleVerVal};
}
export function resetIdentityFacts() {
    sessionId = 'identity-session-' + (++sessionSequence);
    publicRevision = 0; publicKey = '';
    _invCacheKey = ''; _invCache = null; _ruleVerKey = ''; _privVerKey = '';
    for (const p of identityPlayers()) delete p.__djsc_revealedRole;
}

export function identityCampRelation(ownRole, targetRole) {
    const camp = role => role === 'zhu' || role === 'zhong' || role === 'mingzhong' ? 'loyal' : role === 'fan' ? 'rebel' : null;
    const a = camp(ownRole), b = camp(targetRole);
    if (!a || !b) return 0;
    return a === b ? 1 : -1;
}
