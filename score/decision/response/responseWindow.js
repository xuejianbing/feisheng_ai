/* Lifetime of an AI response callback. The host copies a request into a new
 * GameEvent, so both the request and the actual returned window must expire. */
import {game,_status} from '../../foundation/adapt/host.js?v=41a';
import {readModeScope} from '../../foundation/runtime/modeContext.js?v=41a';
import {cooperativeTrickEpoch} from '../state/cooperativeTrickIntent.js?v=41a';
export function responseWindow(player,request){
 const epoch=cooperativeTrickEpoch(),scope=readModeScope();
 let window=request,invalid=null,bound=false;
 const invalidate=reason=>(invalid=invalid||reason);
 return {
  bind(event){if(bound&&window!==event){invalidate('host-window-reused');return;}bound=true;window=event;if(!event||typeof event!=='object')invalidate('missing-host-window');},
  event(){return window;},
  invalidate,
  reason(){
   if(invalid)return invalid;
   try{
    const now=readModeScope();
    if(epoch!==cooperativeTrickEpoch())return invalidate('game-epoch-changed');
    if(scope.mode!==now.mode||scope.submode!==now.submode)return invalidate('mode-changed');
    if(!window||request?.finished||request?.cancelled||window.finished||window.cancelled)return invalidate('request-ended');
    if(window.player&&window.player!==player)return invalidate('response-actor-changed');
    if(player?.alive===false||player?.isIn?.()===false||player?.isDead?.())return invalidate('responder-left');
    if(player===game.me&&!_status.auto||player?.isOnline2?.())return 'human-controlled';
    return null;
   }catch(_){return invalidate('response-window-unavailable');}
  }
 };
}
