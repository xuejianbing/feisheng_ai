import {safeGet,safeSet} from '../../foundation/storage/storage.js?v=41a';
const KEY='djsc_classic_doudizhu_matches_v1';
export function classicMatches(){try{const rows=JSON.parse(safeGet(KEY)||'[]');return Array.isArray(rows)?rows.filter(r=>r?.sessionId&&r.group==='doudizhu-classic').slice(-500):[];}catch(_){return [];}}
export function recordClassicMatch(context,role,won){
 if(context.group!=='doudizhu-classic'||!context.collect||!context.sessionId)return false;
 const rows=classicMatches().filter(r=>r.sessionId!==context.sessionId);
 rows.push({...context,role,verdict:typeof won==='boolean'?(won?'win':'loss'):'unknown',endedAt:Date.now()});
 return safeSet(KEY,JSON.stringify(rows.slice(-500)))!==false;
}
export function classicMatchSummary(){const rows=classicMatches(),groups={};for(const r of rows){const k=r.submode+'/'+r.role,g=groups[k]||(groups[k]={games:0,wins:0,losses:0,unknown:0});g.games++;g[r.verdict==='win'?'wins':r.verdict==='loss'?'losses':'unknown']++;}return {retained:rows.length,window:500,groups};}
