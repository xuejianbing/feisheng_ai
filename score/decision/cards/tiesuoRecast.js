/* Iron Chain timing and an AI-only transport through the host's recast API. */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { playChoiceWindow } from '../execution/decisionWindow.js?v=41a';
import { tacticalEnabled } from '../strategy/tacticalOptimization.js?v=41a';
import { isCandidateEligible, candidatePriorityRank, setCandidatePriority, PRIORITY_TIER } from '../state/actionCandidate.js?v=41a';

export const TIESUO_RECAST_SKILL = '_djsc_tiesuoRecast';

function legalCard(player, card) {
 try {
  return !!card && get.name(card, player) === 'tiesuo' &&
   player.getCards('h').includes(card) && player.canRecast(card, null, true) === true;
 } catch (_) { return false; }
}

function firstCard(player) {
 try { return player.getCards('h').find(card => legalCard(player, card)) || null; }
 catch (_) { return null; }
}

function aiControlled(player) {
 try {
  return tacticalEnabled('tiesuo') && !!player && _status.currentPhase === player &&
   (player !== game.me || !!_status.auto) && !player.isOnline2?.();
 } catch (_) { return false; }
}

export function isTiesuoRecastSelection(player, card, event) {
 return aiControlled(player) && !!playChoiceWindow(event, player) &&
  (event.skill === TIESUO_RECAST_SKILL || event._backup?.skill === TIESUO_RECAST_SKILL) &&
  lib.skill[TIESUO_RECAST_SKILL]?.__djscTransport === true && legalCard(player, card);
}

/* A timing policy, not extra damage/draw utility. Critical wins and in-progress
 * wine attacks stay ahead; useful chain actions retain their existing comparison. */
export function applyTiesuoRecastTiming(player, candidates) {
 if (!tacticalEnabled('tiesuo') || !Array.isArray(candidates) || !firstCard(player)) return;
 const recast = candidates.find(a => a.type === 'card' && a.id === 'tiesuo' && a.recast &&
  isCandidateEligible(a) && a.score > 0);
 if (!recast || candidatePriorityRank(recast) > 0) return;
 const eligible = candidates.filter(isCandidateEligible);
 if (eligible.some(a => a !== recast && (a.rule === 'kill' ||
  candidatePriorityRank(a) > 0 && /击杀|救命/.test(a.policy?.priorityReason || '')))) return;
 if (eligible.some(a => a.id === 'tiesuo' && !a.recast && a.score >= recast.score)) return;
 try {
  if ((player.hasSkill?.('jiu') || Number(player.storage?.jiu) > 0) &&
   eligible.some(a => ['sha','huosha','leisha'].includes(a.id) && a.score > 0)) return;
  if (player.hp <= 1 && eligible.some(a => a.id === 'tao' && a.score > 0)) return;
 } catch (_) { return; }
 setCandidatePriority(recast, PRIORITY_TIER.CRITICAL, 90, '铁索提前换牌，摸牌后重算');
 recast.reason = (recast.reason || '重铸铁索') + '（优先换牌，摸牌后重算）';
}

/* The reader is injected by the execution layer, avoiding an engine import cycle.
 * No UI-extension flags, methods, buttons, or skills are read or changed. */
export function installTiesuoRecastBridge(readDecision) {
 if (lib.skill[TIESUO_RECAST_SKILL] || typeof readDecision !== 'function') return () => {};
 let reading = false, active = true;
 const inFlight = new WeakSet();
 const selections = new WeakMap();
 function recommendedCard(player, event) {
  if (!active || reading || !aiControlled(player)) return null;
  const choice = playChoiceWindow(event, player);
  if (!choice) return null;
  // A skill backup replaces filterCard with its own cost selector. Re-running
  // the full engine there would score a restricted window and lose the plan.
  if (choice.skill === TIESUO_RECAST_SKILL || choice._backup?.skill === TIESUO_RECAST_SKILL) {
   const selected = selections.get(choice);
   return legalCard(player, selected) ? selected : null;
  }
  const card = firstCard(player);
  if (!card) return null;
  reading = true;
  try {
   const decision = readDecision(player);
   const selected = decision?.recast === true && (decision.rule || decision.id) === 'tiesuo' ? card : null;
   if (selected) selections.set(choice, selected);
   else selections.delete(choice);
   return selected;
  } catch (_) { return null; }
  finally { reading = false; }
 }
 const skill = {
  charlotte: true, silent: true, popup: false, log: false, logv: false,
  __djscTransport: true, enable: 'phaseUse', position: 'h', selectCard: 1,
  discard: false, lose: false, delay: false,
  filter: (event, player) => !!recommendedCard(player, event),
  filterCard: (card, player) => recommendedCard(player, _status.event) === card,
  check: card => recommendedCard(_status.event?.player, _status.event) === card ? 10 : -1,
  // Async content retains the module closure across the host event compiler.
  async content(event, trigger, player) {
   if (!active || !aiControlled(player) || event.cards?.length !== 1) return;
   const card = event.cards[0];
   if (!legalCard(player, card) || inFlight.has(card)) return;
   inFlight.add(card);
   try { await player.recast(card); }
   finally { inFlight.delete(card); }
  },
  ai: { basic: { order: () => recommendedCard(_status.event?.player, _status.event) ? 30 : 0 },
   result: { player: 1 } },
 };
 lib.skill[TIESUO_RECAST_SKILL] = skill;
 game.addGlobalSkill(TIESUO_RECAST_SKILL);
 return () => {
  active = false;
  if (lib.skill[TIESUO_RECAST_SKILL] !== skill) return;
  game.removeGlobalSkill?.(TIESUO_RECAST_SKILL);
  delete lib.skill[TIESUO_RECAST_SKILL];
 };
}
