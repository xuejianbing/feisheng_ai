/* TTL only bounds reuse after actor, world state, game epoch and exact choice all match. */
export function decisionCacheMatches(entry,{actor,key,window,epoch,now=Date.now(),ttl}){
 if(!entry?.ba||!actor||!key||!window||window.finished||entry.actor!==actor||entry.key!==key||entry.window!==window||entry.epoch!==epoch)return false;
 const age=now-entry.t;
 if(!Number.isFinite(age)||age<0||!(age<ttl))return false;
 const tx=entry.ba.__djscTransaction;
 return !tx||tx.domain!=='play'||tx.choiceWindow===window;
}
