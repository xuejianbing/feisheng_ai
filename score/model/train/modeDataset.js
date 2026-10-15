import {trainingLabelOf} from './labelPolicy.js?v=41a';
import {championSampleEligibility} from '../../decision/strategy/championStrategy.js?v=41a';
export function selectClassicDataset(samples){
 const map=new Map(),conflicts=new Set(),rejected={};let duplicates=0;
 const reject=r=>{rejected[r]=(rejected[r]||0)+1;};
 for(const s of samples||[]){const m=s?.m,c=m?.modeContext;let reason=null;
  if(!c||c.schema!=='mode-context-v1'||c.captured!==true)reason='模式来源未知';
  else if(c.group!=='doudizhu-classic'||c.mode!=='doudizhu'||!['normal','kaihei','huanle'].includes(c.submode))reason='非本专项';
  else if(!c.collect)reason='采集未开启';
  else if(!['landlord','farmer'].includes(c.role))reason='角色未确认';
  else if(!c.ruleKey||c.ruleVersion!==1||c.featureVersion!==130)reason='规则或特征版本不兼容';
  else reason=championSampleEligibility(s);
  if(reason){reject(reason);if(m?.sessionId&&m.actorId&&m.transactionId){const key=JSON.stringify([m.sessionId,m.actorId,m.transactionId]);map.delete(key);conflicts.add(key);}continue;}
  const key=JSON.stringify([m.sessionId,m.actorId,m.transactionId]),identity=JSON.stringify({f:s.f,r:s.r,value:s.value_target,id:m.id,type:m.type||m.action,target:m.target,c});
  if(conflicts.has(key)){reject('事务冲突');continue;}
  if(map.has(key)){if(map.get(key).identity===identity)duplicates++;else{map.delete(key);conflicts.add(key);reject('事务冲突');}}else map.set(key,{identity,s});
 }
 const accepted=[...map.values()].map(r=>JSON.parse(JSON.stringify(r.s))),breakdown={};
 for(const s of accepted){const c=s.m.modeContext,k=c.submode+'/'+c.role;const b=breakdown[k]||(breakdown[k]={samples:0,sessions:new Set()});b.samples++;b.sessions.add(s.m.sessionId);}
 return {samples:accepted,stats:{accepted:accepted.length,duplicates,conflicts:conflicts.size,rejected,sessions:new Set(accepted.map(s=>s.m.sessionId)).size,
  breakdown:Object.fromEntries(Object.entries(breakdown).map(([k,v])=>[k,{samples:v.samples,sessions:v.sessions.size}]))}};
}
export function splitClassicByGame(samples){
 const sessions=[...new Set(samples.map(s=>s.m.sessionId))].sort(),holdout=new Set(sessions.filter((_,i)=>i%5===0));
 return {training:samples.filter(s=>!holdout.has(s.m.sessionId)),validation:samples.filter(s=>holdout.has(s.m.sessionId)),holdoutSessions:[...holdout]};
}
export function sampleLabel(s){return trainingLabelOf(s);}
