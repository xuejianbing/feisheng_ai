/* 显式宿主语义边界：保留原效果规则，同时记录尚未完成身份语义分解的实际调用。 */
import {get} from '../../foundation/adapt/host.js?v=41a';
import {identityMode} from './identityFacts.js?v=41a';
import {playerKey} from '../../foundation/adapt/playerIdentity.js?v=41a';
let counts = Object.create(null), observers = Object.create(null);
function callHost(method,args,observer) {
    if (identityMode() === 'identity') {
        counts[method] = (counts[method] || 0) + 1;
        const key = playerKey(observer) || 'unknown';
        observers[key] = (observers[key] || 0) + 1;
    }
    return get[method](...args);
}
export function identityHostEffect(...args) { return callHost('effect',args,args[3]); }
export function identityHostDamageEffect(...args) { return callHost('damageEffect',args,args[2]); }
export function identityHostAttitude(...args) { return callHost('attitude',args,args[0]); }
export function identityAuditStats() {
    return {reasonCode:'host-semantics-fallback',total:Object.values(counts).reduce((s,n)=>s+n,0),
        calls:{...counts},observers:{...observers},fullyObserverAware:false};
}
export function resetIdentityAudit() { counts=Object.create(null);observers=Object.create(null); }
