import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let failed=0;async function test(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+' '+e.stack);}}
await test('content completes before eight-second model restore and installs only once',async()=>{
 const src=(await read('extension.js')).replace(/\r/g,'');
 const body=src.slice(src.indexOf('const _content ='),src.indexOf('/* ★ 卸载时'));
 const db=deferred();let installs=0;
 const ctx={_extensionDisposed:false,extensionPackage:{content:async()=>{}},modeModelsReady:db.promise,bootMark(){},isScoreEngineEnabled:()=>true,installScoreEngine:()=>installs++,window:{__DJSC:{}}};
 vm.runInNewContext(body,ctx);
 const done=ctx.extensionPackage.content({},{});
 const settled=await Promise.race([done.then(()=>true),new Promise(r=>setTimeout(()=>r(false),40))]);
 db.resolve({backend:"IndexedDB"});await done;assert.equal(settled,true);assert.equal(installs,1);
});
async function storeFixture(){
 const db=deferred(),local=new Map();
 const ctx=vm.createContext({console,Date,Float32Array,Float64Array,Int8Array,Int16Array,ArrayBuffer});
 const exports={readModeModels:()=>db.promise,writeModeModel:async()=>({ok:true}),safeGet:k=>local.get(k)??null,safeSet:(k,v)=>{local.set(k,v);return true;},safeRemove:k=>local.delete(k),MODEL_SCHEMA:{version:7,featureDim:2,dims:[2,2,2,2]},createIsolatedModelSession:()=>({}),_stableStringify:JSON.stringify};
 const mock=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context:ctx});
 const m=new vm.SourceTextModule(await read('score/model/weights/modeModelStore.js'),{context:ctx});await m.link(()=>mock);await m.evaluate();
 const record=id=>{const snapshot={META:{version:7,trained:0,accuracy:0,ready:true},adamT:0};for(const [k,n]of Object.entries({W1:4,B1:2,W2:4,B2:2,W3:4,B3:2,W4:2,B4:1,W_proj1:4,W_proj2:4})){for(const pre of ['','m','v'])snapshot[pre+k]=Array(n).fill(0);}return {id,ruleKeys:['doudizhu/normal'],networkProfile:{useResidual:true},schema:'classic-candidate-v1',featureDim:2,modelVersion:7,snapshot};};
 return {db,m:m.namespace,record,local};
}
await test('active identity is unavailable while restore is pending',async()=>{const f=await storeFixture(),c=f.record('legacy');f.local.set('djsc_classic_doudizhu_active_v1',JSON.stringify({schema:'classic-active-v1',current:c}));assert.equal(f.m.classicActiveInfo(),null);f.db.resolve({rows:[]});await f.m.modeModelsReady;assert.equal(f.m.classicActiveInfo().id,'legacy');});
await test('late restore preserves new candidate and activation including same ID replacement',async()=>{const f=await storeFixture(),old=f.record('same'),next=f.record('same');next.createdAt=2;assert.equal(f.m.saveClassicCandidate(next).ok,true);assert.equal(f.m.promoteClassicCandidate().ok,true);f.db.resolve({rows:[{key:'candidate',value:old},{key:'active',value:{schema:'classic-active-v1',current:old}}]});await f.m.modeModelsReady;assert.equal(f.m.loadClassicCandidate().createdAt,2);assert.equal(f.m.loadClassicActive().createdAt,2);});
await test('restore errors are settled failures rather than successful reads',async()=>{const f=await storeFixture();f.db.resolve({rows:[{key:'candidate',value:{broken:true}}]});await f.m.modeModelsReady;assert(f.m.classicModelStorageStatus().error);});
const timeout=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('mount blocked on panel import')),50))]);
const panel=await import('../score/foundation/diag/panelLoader.js');
await test('panels load only on first open, coalesce shared paths, retain loaded synchronous return',async()=>{let loads=0;const d=deferred(),target={};const report=await timeout(panel.mountPanels(target,()=>{loads++;return d.promise;},{lazy:true}));assert.equal(loads,0);const a=target.openScorePanel(),b=target.openPlanPanel();d.resolve({openScorePanel:()=>1,openPlanPanel:()=>2});assert.equal(await a,1);assert.equal(await b,2);assert.equal(loads,1);assert.equal(target.openScorePanel(),1);assert.equal(report.total,25);});
await test('unmount during panel load suppresses stale invocation and mounting',async()=>{const d=deferred(),target={};let opens=0;const r=await timeout(panel.mountPanels(target,()=>d.promise,{lazy:true}));const p=target.openScorePanel();r.dispose();d.resolve({openScorePanel:()=>++opens});await assert.rejects(p,/卸载|disposed/);assert.equal(opens,0);});
await test('failed lazy panel reports error without breaking other panels or automatic retry',async()=>{const target={};let loads=0;const r=await timeout(panel.mountPanels(target,async()=>{loads++;throw Error('bad file');},{lazy:true}));await assert.rejects(target.openScorePanel(),/bad file/);await assert.rejects(target.openScorePanel(),/bad file/);assert.equal(loads,1);assert.equal(r.panels.find(p=>p.name==='openScorePanel').state,'error');assert.equal(typeof target.openChampionPanel,'function');});
await test('already mounted synchronous panel keeps synchronous return',async()=>{const target={openScorePanel:()=>42};await panel.mountPanels(target,()=>{throw Error('unexpected load');},{lazy:true});assert.equal(target.openScorePanel(),42);});
await test('module self registration cannot survive disposed pending load',async()=>{const d=deferred(),target={};const fn=()=>1;const r=await panel.mountPanels(target,()=>d.promise,{lazy:true});const p=target.openScorePanel();await Promise.resolve();r.dispose();target.openScorePanel=fn;d.resolve({openScorePanel:fn});await assert.rejects(p);assert.equal(target.openScorePanel,undefined);});
await test('late old module registration preserves new hot-reload owner',async()=>{const d=deferred(),target={};const a=await panel.mountPanels(target,()=>d.promise,{lazy:true});const pending=target.openScorePanel();await Promise.resolve();a.dispose();await panel.mountPanels(target,async()=>({openScorePanel:()=>2}),{lazy:true});const current=target.openScorePanel,old=()=>1;target.openScorePanel=old;d.resolve({openScorePanel:old});await assert.rejects(pending);assert.equal(target.openScorePanel,current);assert.equal(await target.openScorePanel(),2);});
if(failed)process.exitCode=1;
