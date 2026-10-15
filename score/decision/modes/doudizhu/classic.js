import {roleOf} from '../../../foundation/runtime/modeContext.js?v=41a';
/* 替换原模式层固定偏好；公共 EV/成本及 Planner 不重复计分。 */
export function classicDecisionPreference(me,act,target,{attack=false,heal=false}={}){
 const role=roleOf(me),other=roleOf(target);let value=0;const reasons=[];
 const add=(delta,reason)=>{value+=delta;reasons.push(reason);};
 if(role==='unknown')return {delta:0,role,reasons:['身份未确认']};
 if(role==='farmer'){
  if(attack&&target&&target!==me&&other==='farmer')add(-2,'避免直接攻击农民队友');
  if(attack&&other==='landlord')add(.35,'农民集中攻击地主');
  if(heal&&target&&target!==me&&other==='farmer'&&target.hp<target.maxHp)add(target.hp<=1?.5:.2,'农民队友受伤救援');
 }else if(attack&&other==='farmer')add(target.hp<=1?.4:.15,'地主突破农民防线');
 // 额外出杀次数由宿主合法性与公共评分判断，不假设所有子模式技能相同。
 if(act.id==='kaihei'&&act.type==='skill'&&target&&target!==me){
  const theirs=target.countCards?.('h')||0;
  if(role==='landlord'&&other==='farmer'&&theirs>=4)add(.08,'强易：优先检查敌人资源交换');
 }
 return {delta:Math.round(value*10000)/10000,role,reasons,scope:'mode-preference',exchangeSelection:'host-native'};
}
export function landlordBidValue(candidates,rate){const values=(candidates||[]).map(rate).filter(Number.isFinite).sort((a,b)=>b-a);return values.length?values[0]:null;}
