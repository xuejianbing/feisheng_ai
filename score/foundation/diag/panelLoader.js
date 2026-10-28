export const PANEL_MODULES = [['openModeTrainingPanel','../../view/dashboard/modeTrainingPanel.js'], ['openScorePanel', '../../view/panel/panel.js'], ['openScoreDetailPanel', '../../view/panel/panel.js'], ['openPlanPanel', '../../view/panel/panel.js'], ['openFeedbackPanel', '../../view/panel/panel.js'], ['openArchivePanel', '../../view/panel/panel.js'], ['openRecommendPanel', '../../view/panel/panel.js'], ['openConfigPanel', '../../view/panel/panel.js'], ['openMemoryPanel', '../../view/panel/panel.js'], ['openSkillPanel', '../../view/panel/panel.js'], ['openOverridePanel', '../../view/panel/panel.js'], ['openSkillBreakdownPanel', '../../view/panel/panel.js'], ['openSkillCustomPanel', '../../view/panel/panel.js'], ['openHealthPanel', '../../view/panel/panel.js'], ['openBrainDashboard', '../../view/dashboard/brainDashboard.js'], ['openCalibratorPanel', '../../model/calibrate/calibratorPanel.js'], ['openComparePanel', '../../view/dashboard/comparePanel.js'], ['openDecisionDashboard', '../../view/dashboard/decisionDashboard.js'], ['openExportPanel', '../../foundation/io/exportAll.js'], ['openGuardPanel', '../../model/net/modelGuard.js'], ['openProfilerPanel', '../../foundation/diag/profiler.js'], ['openReplayPanel', '../../view/dashboard/replayPanel.js'], ['openSelfCheck', '../../verification/selfCheck.js'], ['openSmartPanel', '../../view/panel/smartPanel.js'], ['openChampionPanel', '../../view/dashboard/championPanel.js']];
// Each export has its own result; an unavailable module cannot suppress other panels.
export async function mountPanels(target, load=path=>import(/* webpackIgnore: true */ path+'?v=41a'), options={}) {
 if(options.lazy)return mountLazyPanels(target,load);
 const results=await Promise.allSettled(PANEL_MODULES.map(async([name,path])=>{
  const module=await load(path);if(typeof module[name]!=='function')throw Error('导出缺失：'+name);
  target[name]=module[name];return name;
 }));
 const panels=results.map((r,i)=>({name:PANEL_MODULES[i][0],path:PANEL_MODULES[i][1],ok:r.status==='fulfilled',error:r.status==='rejected'?String(r.reason?.message||r.reason):null}));
 return {schema:'extension-panel-load-v1',ok:panels.every(p=>p.ok),total:panels.length,loaded:panels.filter(p=>p.ok).length,panels};
}

// Existing eager callers keep their readiness contract. The extension opts in explicitly.
function mountLazyPanels(target, load) {
 let disposed=false;
 const pending=new Map(), owned=new Map();
 const panels=PANEL_MODULES.map(([name,path])=>({name,path,ok:true,state:'idle',error:null,ms:null}));
 const report={schema:'extension-panel-load-v1',ok:true,total:panels.length,loaded:0,panels,mode:'lazy',dispose(){
  disposed=true;
  for(const [name,fn]of owned)if(target[name]===fn)delete target[name];
 }};
 for(const row of panels){
  const {name,path}=row;
  let actual=null;
  const wrapper=function(...args){
   if(disposed)return Promise.reject(Error('面板已卸载 disposed'));
   if(actual)return actual.apply(this,args);
   row.state='loading';
   if(!pending.has(path))pending.set(path,Promise.resolve().then(()=>load(path)));
   const start=Date.now(),receiver=this;
   return pending.get(path).then(module=>{
    if(disposed)throw Error('面板已卸载 disposed');
    if(typeof module[name]!=='function')throw Error('导出缺失：'+name);
    if(!actual){actual=module[name];row.state='ready';row.ms=Date.now()-start;report.loaded++;}
    return actual.apply(receiver,args);
   }).catch(error=>{
    row.state=disposed?'disposed':'error';row.ok=false;row.error=String(error.message||error);report.ok=false;
    if(!disposed&&typeof console!=='undefined')console.warn('[无名AI] 面板加载失败 '+name+': '+row.error);
    throw error;
   });
  };
  owned.set(name,wrapper);target[name]=wrapper;
 }
 return report;
}
