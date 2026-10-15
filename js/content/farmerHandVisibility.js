import { lib, game, get } from '../shared/utils.js?v=41a';
import { cfg } from '../../score/foundation/config/util.js?v=41a';

const marker = '__djscFarmerHandVisibility';

// Restrict only the local observer's native farmer-sharing permission.
// Publicly shown cards and other players' knowledge remain under host control.
export function refreshFarmerHandVisibility() {
 for (const player of game.players || []) {
  try { player.decadeUI_updateShowCards?.(); } catch (_) {}
 }
}

export function installFarmerHandVisibility() {
 for (const id of ['doudizhu_viewHandcard', 'online_juzhong']) {
 const ai = lib.skill[id]?.ai;
 if (ai && !ai.skillTagFilter?.[marker]) {
  const original = ai.skillTagFilter;
  const owned = function (player, tag, target) {
   if (tag === 'viewHandcard' && cfg('hideFarmerTeammateHand', false) &&
    get.mode() === 'doudizhu' && player === game.me && player !== target &&
    player.identity === 'fan' && target?.identity === 'fan') return false;
   return typeof original === 'function' ? original.apply(this, arguments) : undefined;
  };
  owned[marker] = true;
  ai.skillTagFilter = owned;
 }
 }
 // Mode skills may be loaded after extension content. Async preserves the module closure.
 if (!lib.skill._djsc_farmerHandVisibility) {
  lib.skill._djsc_farmerHandVisibility = {
   charlotte: true, forced: true, popup: false, silent: true,
   trigger: { global: 'gameStart' },
   async content() {
    installFarmerHandVisibility();
    refreshFarmerHandVisibility();
   },
  };
  game.addGlobalSkill('_djsc_farmerHandVisibility');
 }
}
