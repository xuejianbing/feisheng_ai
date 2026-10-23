import {classicActiveInfo,classicModelStorageStatus} from '../../model/weights/modeModelStore.js?v=41a';
import {CURRENT_DIM} from '../../model/features/dimensionAdapter.js?v=41a';
import {game,get,lib,_status} from '../adapt/host.js?v=41a';
import {cfg} from '../config/util.js?v=41a';
export const CLASSIC_SUBMODES=Object.freeze(['normal','kaihei','huanle']);
export const DOUDIZHU_NAMES=Object.freeze({normal:'休闲',kaihei:'开黑',huanle:'欢乐',binglin:'兵临城下',online:'智斗三国'});
let current=null;
export function roleOf(player){if(player?.isZhu||['zhu','dizhu','landlord'].includes(player?.identity))return 'landlord';if(['fan','nongmin','farmer'].includes(player?.identity))return 'farmer';return 'unknown';}
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
export function resolveModeContext({mode='unknown',submode='unknown',settings={},pile=[],enabled=true,collect=true}={}){
 const classic=mode==='doudizhu'&&CLASSIC_SUBMODES.includes(submode),special=mode==='doudizhu'&&['binglin','online'].includes(submode);
 const rules={feiyang:settings.feiyang_version??'unknown',farmerLegacy:settings.enhance_nongmin??'unknown',landlordEnhance:settings.enhance_dizhu??'unknown',doubleCharacter:!!settings.double_character,doubleHp:settings.double_hp??'unknown',pile:hash(JSON.stringify(pile))};
 const ruleKey=mode+'/'+submode+'/'+hash(JSON.stringify(rules));
 return {schema:'mode-context-v1',mode,submode,name:DOUDIZHU_NAMES[submode]||submode,group:classic?'doudizhu-classic':special?'doudizhu-special':mode,
  ruleVersion:1,ruleKey,rules,enabled:classic&&enabled===true,collect:classic&&collect===true,modelVersion:'public-runtime',featureVersion:CURRENT_DIM,networkProfile:'public-runtime'};
}
// Lightweight canonical scope read for policy callbacks; no pile hashing or model lookup.
export function readModeScope(){
 let mode='unknown';try{mode=get.mode?.()||'unknown';}catch(_){}
 const connect=!!_status.connectMode;
 let submode='unknown';
 try{submode=mode==='doudizhu'?(_status.mode||(connect?lib.configOL?.doudizhu_mode:get.config?.('doudizhu_mode'))||'unknown'):'unknown';}catch(_){}
 return {mode,submode};
}
export function readModeContext(){
 const {mode,submode}=readModeScope();
 const connect=!!_status.connectMode,settings={};
 for(const key of ['feiyang_version','enhance_nongmin','enhance_dizhu','double_character','double_hp']){try{settings[key]=connect?lib.configOL?.[key]:get.config?.(key);}catch(_){}}
 const pile=(lib.card?.list||[]).map(c=>Array.isArray(c)?c.slice(0,5):String(c));
 return resolveModeContext({mode,submode,settings,pile,enabled:cfg('classicDoudizhu',true),collect:cfg('classicDoudizhuCollect',true)});
}
export function beginModeContext(sessionId){current={...readModeContext(),modelStorage:classicModelStorageStatus(),playerDemonstrations:cfg('playerDemonstrations',true)===true,specialistEnabled:cfg('classicModelEnabled',false)===true,autoUpdate:cfg('classicAutoUpdate',false)===true,specialistVersion:classicActiveInfo()?.id||null,sessionId,startedAt:Date.now(),closed:false};return modeContext();}
export function modeContext(){return current?JSON.parse(JSON.stringify(current)):readModeContext();}
export function closeModeContext(){if(current)current.closed=true;}
export function modeSessionActive(){return !!current&&!current.closed;}
export function classicEnabled(){const c=current&&!current.closed?current:readModeContext();return c.enabled;}
export function modeSampleMeta(player){const c=modeContext();return {...c,role:roleOf(player),captured:!!current&&!current.closed,actorSkills:(player?.getSkills?.()||[]).filter(s=>typeof s==='string')};}
