import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=(await fs.readFile('extension.js','utf8')).replace(/\r/g,'');
const shadowSource=await fs.readFile('shadow/shadowCore.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture({lateImport=false,loading=false,fail=null}={}) {
 let now=0,id=0,starts=0,requests=0;const jobs=new Map(),listeners=new Set(),cleaned=[];
 const set=(fn,ms,repeat=false)=>{jobs.set(++id,{fn,at:now+ms,ms,repeat});return id;};
 const clear=id=>jobs.delete(id),load=deferred(),gate=deferred();
 const window={__DJSC:{swallow(){}},addEventListener:n=>listeners.add(n),removeEventListener:n=>listeners.delete(n)};
 const context=vm.createContext({window,console,Date,JSON,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:(f,m)=>set(f,m),clearTimeout:clear,setInterval:(f,m)=>set(f,m,true),clearInterval:clear,lib:{element:{Player:{prototype:{}}}}});
 const bindings={setV5Enabled(){},loadV5All:()=>loading?load.promise:Promise.resolve(),v5Predict:()=>null,isV5Ready:()=>false,isEnemyOf:()=>false};
 const mock=new vm.SyntheticModule(Object.keys(bindings),function(){for(const [k,v]of Object.entries(bindings))this.setExport(k,v);},{context});
 const shadow=new vm.SourceTextModule(shadowSource,{context,importModuleDynamically:async()=>{const m=new vm.SyntheticModule([],()=>{},{context});await m.link(()=>{});await m.evaluate();return m;}});await shadow.link(()=>mock);await shadow.evaluate();
 const shadowExports={...shadow.namespace,startShadow:()=>{starts++;return shadow.namespace.startShadow();}};
 const linked=new vm.SyntheticModule(Object.keys(shadowExports),function(){for(const [k,v]of Object.entries(shadowExports))this.setExport(k,v);},{context});await linked.link(()=>{});await linked.evaluate();
 const updaterJobs=[];
 function install(name){updaterJobs.push([name,set(()=>requests++,10000)]);listeners.add(name);}
 function uninstall(name){cleaned.push(name);if(fail===name)throw Error(name);for(const [n,id]of updaterJobs)if(n===name)clear(id);listeners.delete(name);}
 Object.assign(context,{extensionPackage:{},uninstallPerfReport(){},_panelReport:null,_useCardPatchTimer:null,uninstallModelUpdate:()=>uninstall('model'),uninstallPolicyModelUpdate:()=>uninstall('policy'),uninstallScoreEngine(){},installModelUpdate:()=>install('model'),installPolicyModelUpdate:()=>install('policy')});
 const declaration=source.match(/^let _extensionDisposed[^\n]+/m)[0];
 const cleanup=source.slice(source.indexOf('const _uninstall ='),source.indexOf('/* ★ 挂载校验'));
 const startup=source.slice(source.indexOf("import('./shadow/shadowCore.js?v=41a').then",source.indexOf('/* ===== v5 shadow')),source.indexOf("export let type"));
 const m=new vm.SourceTextModule(declaration+'\ninstallModelUpdate();installPolicyModelUpdate();\n'+cleanup+'\n'+startup,{context,importModuleDynamically:async()=>{if(lateImport)await gate.promise;return linked;}});await m.link(()=>{});await m.evaluate();
 const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};await flush();
 return {uninstall:()=>context.extensionPackage.uninstall(),resolveImport:async()=>{gate.resolve();await flush();},resolveLoad:async()=>{load.resolve();await flush();},flush,advance:async ms=>{const end=now+ms;for(;;){const row=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!row)break;const [key,j]=row;now=j.at;if(j.repeat)j.at+=j.ms;else jobs.delete(key);j.fn();await flush();}now=end;},get queuedStart(){return [...jobs.values()].find(j=>j.ms===3000)?.fn;},get starts(){return starts;},get requests(){return requests;},jobs,listeners,cleaned};
}
let failures=0;async function test(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name,e);}}
await test('install then immediately uninstall: no shadow start after 3s and no update jobs',async()=>{const f=await fixture();f.uninstall();await f.flush();await f.advance(15000);assert.equal(f.starts,0);assert.equal(f.requests,0);assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0);});
await test('already queued timer callback cannot start after uninstall',async()=>{const f=await fixture();const callback=f.queuedStart;assert(callback);f.uninstall();await f.flush();callback();await f.flush();assert.equal(f.starts,0);assert.equal(f.jobs.size,0);});
await test('late module import cannot schedule a start after uninstall',async()=>{const f=await fixture({lateImport:true});f.uninstall();await f.resolveImport();await f.advance(15000);assert.equal(f.starts,0);assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0);});
await test('uninstall while v5 load awaits cannot install polling or exit listeners',async()=>{const f=await fixture({loading:true});await f.advance(3000);assert.equal(f.starts,1);f.uninstall();await f.flush();await f.resolveLoad();await f.advance(15000);assert.equal(f.starts,1);assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0);assert.equal(f.requests,0);});
for(const fail of ['model','policy'])await test(fail+' cleanup failure does not skip the other updater',async()=>{const f=await fixture({fail});f.uninstall();await f.flush();assert.deepEqual(f.cleaned,['model','policy']);});
await test('five installation/uninstallation generations leave no polling, update requests or listeners',async()=>{for(let i=0;i<5;i++){const f=await fixture();await f.advance(3000);assert.equal(f.starts,1);f.uninstall();f.uninstall();await f.flush();await f.advance(15000);assert.equal(f.starts,1);assert.equal(f.jobs.size,0);assert.equal(f.listeners.size,0);assert.equal(f.requests,0);}});
if(failures)process.exitCode=1;
