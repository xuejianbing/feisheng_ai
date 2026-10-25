import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';

export function choicePlayerBlocked(player) {
 try {
  return !player || _status.connectMode || player === game.me || !!player.isOnline2?.() ||
   (!_status.auto && !!player.isUnderControl?.());
 } catch (_) { return true; }
}

// Constructor return is only an event description. Install after the caller's
// .set(...) calls, and observe completion through the host's own after queue.
export function bindChoiceLifecycle(event, kind, setup, complete, failed) {
 if (!event || typeof event.pushHandler !== 'function' || !Array.isArray(event.after) ||
     typeof lib.element?.GameEvent !== 'function') return false;
 let started = false, cleanups = [];
 const trace = event.__djscChoiceTrace = {
  kind, suggested: false, staged: false, selected: false, executed: false,
  ended: false, reward: null, finalLabel: null, attribution: 'unconfirmed',
 };
 event.pushHandler(function (current, option) {
  if (option?.state !== 'begin' || started) return;
  started = true;
  const registerCleanup = cleanup => { if (typeof cleanup === 'function' && !cleanups.includes(cleanup)) cleanups.push(cleanup); };
  const cleanupAll = () => {
   const pending = cleanups.splice(0);
   for (let i = pending.length - 1; i >= 0; i--) { try { pending[i](); } catch (_) {} }
  };
  const observer = new lib.element.GameEvent('djscChoiceComplete', false, event.manager);
  // No player: native prevention must not skip cleanup when the actor dies,
  // goes out or is removed during the chosen action.
  observer.setContent(async function () {
   try { complete?.(event, trace); }
   catch (error) { trace.error = String(error?.message || error); failed?.(error); }
   finally { cleanupAll(); }
  });
  event.after.push(observer);
  try { registerCleanup(setup(event, trace, registerCleanup)); }
  catch (error) {
   trace.error = String(error?.message || error);
   cleanupAll();
   failed?.(error);
  }
 });
 return true;
}

export function patchChoiceField(event, key, value) {
 const original = event[key];
 event[key] = value;
 return () => { if (event[key] === value) event[key] = original; };
}

// Selection/AI checks are not executions. Only completed native descendants
// identify an action. No response/discard result is converted into a play label.
export function completeChoiceTrace(event, trace) {
 if (!event.finished) return;
 trace.selected = event.result?.bool === true;
 if (event.chooseonly || event.nouse) return;
 const names = trace.kind === 'use' ? ['useCard', 'useSkill', 'recast'] : trace.kind === 'respond' ? ['respond'] : ['lose'];
 const seen = new Set();
 function find(root) {
  if (!root || seen.has(root) || seen.size >= 512) return null;
  seen.add(root);
  const owned = trace.kind === 'discard'
   ? root === event.done?.done && root.parent === event.done && event.done?.parent === event
   : root.parent === event;
  if (root !== event && owned && root.finished && root.player === event.player && names.includes(root.name) &&
      (trace.kind !== 'discard' || root.type === 'discard')) {
   const history = root.name === 'useCard' ? 'useCard' : root.name === 'respond' ? 'respond' : root.name === 'lose' ? 'lose' : null;
   // finish() also marks skipped/cancelled events finished. Require native
   // action history; unsupported skill/recast evidence remains unconfirmed.
   if (history && event.player.getHistory?.(history)?.includes(root)) {
    if (trace.kind === 'discard') {
     const cards = event.result?.cards;
     if (cards?.length && cards.every(card => root.cards?.includes(card))) return root;
    } else {
     const chosen = event.result?.card;
     if (chosen && root.card && get.name(chosen, event.player) === get.name(root.card, event.player)) return root;
    }
   }
  }
  for (const child of root.childEvents || []) { const found = find(child); if (found) return found; }
  return null;
 }
 const action = find(event);
 if (trace.selected && action) {
  trace.executed = true;
  trace.hostAction = action.name;
  trace.attribution = 'native-event-completed';
 }
 // reward/finalLabel intentionally remain unknown. Existing outcome and game
 // result collectors alone may confirm those independent stages.
}

export function choiceStat(kind, key) {
 const stats = _status.djsc_overrideStats ||= { use: {}, respond: {}, discard: {}, compare: {}, soft: {} };
 const bucket = stats[kind] ||= {};
 bucket[key] = (bucket[key] || 0) + 1;
}
