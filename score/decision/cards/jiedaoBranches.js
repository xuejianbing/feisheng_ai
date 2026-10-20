// Public equipment valuation shared by proactive pair estimates and actual responses.
import {get} from '../../foundation/adapt/host.js?v=41a';
export const boundedJiedaoValue=n=>Math.max(-24,Math.min(24,n));
export function jiedaoTransferValue(source,holder,viewer,relationOf){
 const equipped=(holder.getCards('e')||[]).filter(c=>get.subtypes(c)?.includes('equip1'));
 if(!equipped.length)return null;
 // Match native Jiedao's transfer branch; protected equipment is never gained.
 const weapons=typeof holder.getGainableCards==='function'?
  holder.getGainableCards(source,'e',c=>get.subtypes(c)?.includes('equip1')).filter(c=>equipped.includes(c)):equipped;
 if(!weapons.length)return 0;
 if(holder.hasSkillTag?.('loseEquip'))return null;
 const from=viewer===holder?1:relationOf(viewer,holder),to=viewer===source?1:relationOf(viewer,source);
 let value=0;
 for(const w of weapons){const loss=get.value(w,holder),gain=get.value(w,source);
  if(!Number.isFinite(loss)||!Number.isFinite(gain))return null;
  value-=from*loss;value+=to*gain*.6;
 }
 return boundedJiedaoValue(value);
}
