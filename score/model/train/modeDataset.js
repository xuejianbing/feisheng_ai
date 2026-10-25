/*
 * modeDataset.js — dataset filtering and deterministic session split.
 */
import {trainingLabelOf} from './labelPolicy.js?v=41a';
import {championSampleEligibility} from '../../decision/strategy/championStrategy.js?v=41a';
import {adaptToCurrentDim, detectDim, SUPPORTED_DIMS} from '../features/dimensionAdapter.js?v=41a';
import {SAMPLE_STATES, stampEligibility} from './sampleEligibility.js?v=41a';
import {collectTrainingDataset} from './trainingDataset.js?v=41a';

const DEFAULT_SPLIT_SEED = 20261019;
const DEFAULT_HOLDOUT_RATIO = 0.2;
function _hashString(str) {
  let h=0;
  for (let i=0;i<str.length;i++) h=((h<<5)-h+str.charCodeAt(i))|0;
  return Math.abs(h);
}
function cloneTrainingSample(sample) {
  const cloned = JSON.parse(JSON.stringify(sample));
  if (sample?.f != null) {
    if (ArrayBuffer.isView(sample.f)) cloned.f = new sample.f.constructor(sample.f);
    else if (Array.isArray(sample.f)) cloned.f = sample.f.slice();
  }
  return cloned;
}

export function selectClassicDataset(samples) {
  const lineage=collectTrainingDataset(samples,{modeGroup:'doudizhu-classic'});
  const map=new Map(), conflicts=new Set(), rejected={...lineage.reasons};
  let duplicates=lineage.counts.duplicates, dimAdaptedCount=0;
  const dimStats={dim130:0,dim134:0,other:0};
  const reject=(r)=>{rejected[r]=(rejected[r]||0)+1;};
  for (const s of lineage.samples) {
    const m=s?.m, c=m?.modeContext;
    // 历史TypedArray仅在输入边界归一为Array；收益/执行资格仍走同一门禁。
    const source=ArrayBuffer.isView(s?.f)&&Number.isInteger(s.f.length)?{...s,f:Array.from(s.f)}:s;
    const featureDim=detectDim(s);
    let reason=null;
    if (!c || c.schema!=='mode-context-v1' || c.captured!==true) reason='模式来源未知';
    else if (c.group!=='doudizhu-classic' || c.mode!=='doudizhu' || !['normal','kaihei','huanle'].includes(c.submode)) reason='非本专项';
    else if (!c.collect) reason='采集未开启';
    else if (!['landlord','farmer'].includes(c.role)) reason='角色未确认';
    else if (!c.ruleKey || c.ruleVersion!==1) reason='规则版本不兼容';
    else if (!SUPPORTED_DIMS.includes(featureDim)) reason='特征维度不支持:'+featureDim;
    else reason=championSampleEligibility(source);
    const sourceDim=s._dimAdapted===true?s._originalDim:featureDim;
    if (sourceDim===130) dimStats.dim130++;
    else if (sourceDim===134) dimStats.dim134++;
    else if (c) dimStats.other++;
    if (reason) {
      reject(reason); stampEligibility(s,SAMPLE_STATES.REJECTED,reason);
      if (m?.sessionId && m.actorId && m.transactionId) {
        const key=JSON.stringify([m.sessionId,m.actorId,m.transactionId]);
        map.delete(key); conflicts.add(key);
      }
      continue;
    }
    const adapted=adaptToCurrentDim(source);
    if (adapted.error) { reject('维度适配失败:'+adapted.error); continue; }
    const sample=adapted.sample;
    if (adapted.adapted||sample._dimAdapted===true) dimAdaptedCount++;
    const key=JSON.stringify([m.sessionId,m.actorId,m.transactionId]);
    const identity=JSON.stringify({f:Array.from(sample.f),r:sample.r,value:sample.value_target,
      id:m.id,type:m.type||m.action,target:m.target,c});
    if (conflicts.has(key)) { reject('事务冲突'); continue; }
    if (map.has(key)) {
      if (map.get(key).identity===identity) duplicates++;
      else { map.delete(key); conflicts.add(key); reject('事务冲突'); }
    } else map.set(key,{identity,s:sample});
  }
  const accepted=[...map.values()].map(r=>{
    stampEligibility(r.s,SAMPLE_STATES.TRAINABLE,null);
    return cloneTrainingSample(r.s);
  });
  const breakdown={};
  for (const s of accepted) {
    const c=s.m.modeContext, k=c.submode+'/'+c.role;
    const b=breakdown[k]||(breakdown[k]={samples:0,sessions:new Set()});
    b.samples++; b.sessions.add(s.m.sessionId);
  }
  return {samples:accepted,stats:{
    accepted:accepted.length,duplicates,conflicts:conflicts.size+lineage.counts.conflicts,rejected,lineage:lineage.counts,
    sessions:new Set(accepted.map(s=>s.m.sessionId)).size,dimAdaptedCount,dimStats,
    breakdown:Object.fromEntries(Object.entries(breakdown).map(([k,v])=>[k,{samples:v.samples,sessions:v.sessions.size}])),
  }};
}

export function splitClassicByGame(samples, options={}) {
  const seed=options.seed ?? DEFAULT_SPLIT_SEED;
  const holdoutRatio=options.holdoutRatio ?? DEFAULT_HOLDOUT_RATIO;
  if (typeof holdoutRatio!=='number' || !Number.isFinite(holdoutRatio) || holdoutRatio<0 || holdoutRatio>1)
    throw new RangeError('holdoutRatio must be a finite number in [0, 1]');
  const rows=samples||[];
  const sessions=[...new Set(rows.map(s=>s?.m?.sessionId).filter(sid=>sid!=null))].sort();
  const holdout=new Set();
  for (const sid of sessions) {
    const h=_hashString(String(sid)+':'+String(seed));
    if ((h%1000)/1000 < holdoutRatio) holdout.add(sid);
  }
  const training=rows.filter(s=>!holdout.has(s?.m?.sessionId));
  const validation=rows.filter(s=>holdout.has(s?.m?.sessionId));
  return {training,validation,metadata:{
    seed,holdoutRatio,totalSessions:sessions.length,holdoutSessions:[...holdout].sort(),
    trainingSessions:sessions.length-holdout.size,trainingSamples:training.length,
    validationSamples:validation.length,splitMethod:'session-level-deterministic-hash',
  }};
}
// 新报告以splitMetadata为权威；旧报告只有顶层ID时仍需完整原留出行。
// 不因metadata缺失而重新抽样，否则可能把已训练局混进验证集。
export function classicHoldoutDataset(samples,report,ruleKeys){
  const fail=err=>({ok:false,err,rows:[]});
  const metadata=report?.splitMetadata,ids=metadata===undefined?report?.holdoutSessions:metadata?.holdoutSessions;
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)
    return fail('候选留出验证局ID缺失或无效，请重新训练；未切换版本');
  const sameIds=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every(id=>b.includes(id));
  if(report.holdoutSessions!==undefined&&!sameIds(report.holdoutSessions,ids))
    return fail('候选holdoutSessions与splitMetadata不一致，未切换版本');
  if(!Number.isSafeInteger(report.validation)||report.validation<450)
    return fail('候选留出验证样本计数无效（验证≥450），未切换版本');
  if(metadata!==undefined&&(!metadata||metadata.splitMethod!=='session-level-deterministic-hash'||metadata.seed===undefined||
      !Number.isFinite(metadata.holdoutRatio)||metadata.holdoutRatio<0||metadata.holdoutRatio>1||
      !Number.isSafeInteger(metadata.totalSessions)||!Number.isSafeInteger(metadata.trainingSessions)||metadata.trainingSessions<0||
      metadata.totalSessions!==metadata.trainingSessions+ids.length||metadata.validationSamples!==report.validation||
      !Number.isSafeInteger(metadata.trainingSamples)||metadata.trainingSamples!==report.training))
    return fail('候选留出验证metadata不完整或计数不一致，未切换版本');
  if(metadata!==undefined){
    const expected=splitClassicByGame(samples,{seed:metadata.seed,holdoutRatio:metadata.holdoutRatio}).metadata;
    if(!sameIds(ids,expected.holdoutSessions)||expected.trainingSamples!==metadata.trainingSamples||expected.validationSamples!==metadata.validationSamples||expected.totalSessions!==metadata.totalSessions)
      return fail('候选留出验证metadata与原整局划分不一致，未切换版本');
  }
  const holdout=new Set(ids),rows=(samples||[]).filter(s=>holdout.has(s.m?.sessionId)&&ruleKeys?.includes(s.m?.modeContext?.ruleKey));
  const present=new Set(rows.map(s=>s.m.sessionId));
  if(ids.some(id=>!present.has(id)))return fail('原留出验证局的数据不在本地或不完整，请恢复原专项数据；未切换版本');
  if(rows.length!==report.validation)return fail('原留出验证数据不完整：期望 '+report.validation+' 条，实际 '+rows.length+' 条；未切换版本');
  return {ok:true,rows,holdoutSessions:ids.slice()};
}
export function sampleLabel(s) { return trainingLabelOf(s); }
