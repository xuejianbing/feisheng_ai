/* Supported ordered-pair utility is already in the engine seed. */
import {game} from '../../foundation/adapt/host.js?v=41a';
import {dispositionOf} from '../relations/relations.js?v=41a';
import {hasWeapon,bestJiedaoPair,evaluateJiedaoPair} from '../cards/jiedaoEvaluator.js?v=41a';
export function jiedaoTiming(me,target,victim=null){
 return victim?evaluateJiedaoPair(me,target,victim):bestJiedaoPair(me,{holder:target});
}
export function jiedaoBonus(me,act){
 if(act?.id!=='jiedao'||act.pair?.resolved)return 1;
 // Existing fallback multiplier for switches off and unsupported host shapes.
 const holders=act.target&&hasWeapon(act.target)?[act.target]:(game.players||[]).filter(p=>p!==me&&hasWeapon(p));
 return holders.some(h=>h.alive!==false&&dispositionOf(me,h)!==0&&(game.players||[]).some(v=>v!==me&&v!==h&&v.alive!==false&&dispositionOf(me,v)<0))?1.4:.6;
}
