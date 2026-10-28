import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../shadow/shadowCore.js',import.meta.url),'utf8');
let resolve;const loading=new Promise(r=>resolve=r),intervals=new Set(),storage=new Map();let next=0,enabled;
const context=vm.createContext({console,Date,JSON,window:{__AI_REASON:{},addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:()=>{const id=++next;intervals.add(id);return id;},clearInterval:id=>intervals.delete(id),setTimeout:()=>++next,clearTimeout(){}});
const bindings={setV5Enabled:v=>enabled=v,loadV5All:()=>loading,v5Predict:()=>null,isV5Ready:()=>false,isEnemyOf:()=>false};
const mock=new vm.SyntheticModule(Object.keys(bindings),function(){for(const [k,v]of Object.entries(bindings))this.setExport(k,v);},{context});
const m=new vm.SourceTextModule(source,{context});await m.link(()=>mock);await m.evaluate();
const p=m.namespace.startShadow();assert.equal(intervals.size,1);m.namespace.stopShadowRuntime();resolve();await p;assert.equal(intervals.size,0,'unload must clear flush timer and suppress late poll timer');assert.equal(enabled,false);
console.log('PASS stop during model loading cancels flush timer and prevents late polling');
