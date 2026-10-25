// Isolated actual client optimizer/inference. Never reads player localStorage.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {register} from 'node:module';import {performance} from 'node:perf_hooks';
const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
globalThis.localStorage={getItem:()=>null,setItem:()=>{throw Error('E_PUBLIC_WRITE');},removeItem:()=>{throw Error('E_PUBLIC_WRITE');}};
globalThis.__NONAME_STUB={lib:{config:{}},game:{},get:{mode:()=> 'doudizhu'},_status:{},ui:{},ai:{}};
register('./client_host_loader.mjs',import.meta.url);
const root=request.clientRoot;
const weights=await import(pathToFileURL(path.join(root,'score/model/weights/weights.js')).href+'?v=41a');
const store=await import(pathToFileURL(path.join(root,'score/model/weights/modeModelStore.js')).href+'?v=41a');
await store.modeModelsReady;
const plain=s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,ArrayBuffer.isView(v)?Array.from(v):v]));
const publicBefore=JSON.stringify(plain(weights.__snapshotModel()));
const shape=Object.fromEntries([['W1',134*128],['B1',128],['W2',128*64],['B2',64],['W3',64*6],['B3',6],['W4',64],['B4',1],['W_proj1',134*128],['W_proj2',128*64]]);
function seeded(seed){
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const s={parameterFormat:'float32-v1',adamT:0,META:{version:7,trained:0,accuracy:0,ready:true}};
 for(const [key,n] of Object.entries(shape)){s[key]=Float32Array.from({length:n},()=>key.startsWith('B')?0:(random()-.5)*8);s['m'+key]=new Float32Array(n);s['v'+key]=new Float32Array(n);}
 return s;
}
if(JSON.stringify(weights.MODEL_SCHEMA.dims)!=='[134,128,64,6]'||weights.MODEL_SCHEMA.version!==7)throw Error('E_CLIENT_CONTRACT');
let output;
if(request.operation==='train'){
 const policy=await import(pathToFileURL(path.join(root,'score/model/train/labelPolicy.js')).href+'?v=41a');
 if(!Array.isArray(request.rows)||!request.rows.length)throw Error('E_EMPTY_TRAIN');
 const rows=request.rows.map(s=>{const label=policy.trainingLabelOf(s);if(label===null)throw Error('E_TRAIN_LABEL');return {f:s.f,label,value_target:s.value_target};});
 const session=weights.createIsolatedModelSession(seeded(request.config.seed),{useResidual:request.config.useResidual,floatTraining:true});
 let count=0;
 for(let epoch=0;epoch<request.config.epochs;epoch++)for(let i=0;i<rows.length;i+=request.config.batchSize)count+=session.trainBatch(rows.slice(i,i+request.config.batchSize),request.config.learningRate*(1-.15*epoch));
 output={snapshot:plain(session.snapshot()),actualTrainedRows:count,partitionsReadByOptimizer:['training'],contract:weights.MODEL_SCHEMA};
}else if(request.operation==='infer'){
 const snapshot=store.decodeModeSnapshot(request.snapshot);if(!snapshot)throw Error('E_MODEL_SHAPE');
 const session=weights.createIsolatedModelSession(snapshot,request.networkProfile);const start=performance.now();
 output={predictions:request.inputs.map(f=>{if(f.length!==134||!f.every(Number.isFinite))throw Error('E_INPUT_SHAPE');const p=session.predict(f);if(!p||!Number.isFinite(p.value)||p.logits.some(v=>!Number.isFinite(v)))throw Error('E_INFERENCE');return p;}),elapsedMs:performance.now()-start,parameterBytes:Object.values(snapshot).filter(ArrayBuffer.isView).reduce((n,v)=>n+v.byteLength,0)};
}else throw Error('E_OPERATION');
if(JSON.stringify(plain(weights.__snapshotModel()))!==publicBefore)throw Error('E_PUBLIC_MUTATION');
fs.writeFileSync(process.argv[3],JSON.stringify(output),{flag:'wx'});
