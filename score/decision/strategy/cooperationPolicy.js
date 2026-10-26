// Scope only the cooperation policies added for classic Doudizhu. Generic repairs
// and pre-existing tactical optimizations retain their own settings and scope.
import {CLASSIC_SUBMODES,readModeScope,classicEnabled} from '../../foundation/runtime/modeContext.js?v=41a';
export function cooperationPolicyEnabled(){
 try{
  const {mode,submode}=readModeScope();
  return mode==='doudizhu'&&CLASSIC_SUBMODES.includes(submode)&&classicEnabled()===true;
 }catch(_){return false;}
}
