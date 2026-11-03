const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'score');
function run({mode='versus',label='F',enabled=true,ready=true,missing=false,invalid=false,throws=false,risk=false,diagnostic=false}={}){
 let calls=0;
 const c=vm.createContext({
  FEATURE_DIM:1, cfg:(key)=>key==='useTrainedModel'?enabled:true,
  weightsReady:()=>ready, identityMode:()=>mode,
  evaluateSituation:()=>0, decisionActionSnapshot:a=>({id:a.id}),
  window:{__DJSC:{shaTraceEnabled:diagnostic,confidence(feat){
   calls++;
   if(throws)throw Error('inference failed');
   if(missing)return null;
   if(invalid)return {ready:false,maxProb:.99};
   const probs=Array(6).fill(feat[0]===2?.01:1/6);
   if(feat[0]===2)probs[label==='A'?0:5]=.95;
   return {ready:true,label,probs};
  }}},
 });
 for(const file of ['decision/state/decisionMargin.js','decision/state/actionCandidate.js','model/features/identityCompatibility.js','cognition/deepThink.js']){
  const code=fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*$/gm,'').replace(/\bexport (?=function|const)/g,'');
  vm.runInContext(code,c);
 }
 const candidates=[10,9.9,8,100,200].map((score,i)=>({
  type:'skill',id:String(i+1),score,_feat:[i+1],
  ...(risk&&i===0?{incrementalRiskEvidence:{schema:'incremental-risk-v1',status:'confirmed',source:'fixture',additional:true,alreadyScored:false,severity:1}}:{}),
  policy:{priorityTier:i===3?'forced':'normal',eligible:i!==4},
 }));
 const result=c.criticBest({},candidates,candidates[0],{modelP:.99});
 return {calls,winner:result.best.id,rows:JSON.parse(JSON.stringify(result.evidence.rows)),scores:candidates.map(a=>a.score)};
}
test('identity skips old inference and fallback while retaining comparison',()=>{
 const out=run({mode:'identity'});
 assert.equal(out.calls,0);
 assert.equal(out.winner,'1');
 assert.equal(out.rows.length,3);
 assert.ok(out.rows.every(row=>row.modelAdjustment===0));
});
test('compatible mode gives equally confident A and F the zero adjustment and retains the rule winner',()=>{
 const a=run({label:'A'}), f=run({label:'F'});
 assert.deepEqual(a,f);
 assert.equal(f.calls,3);
 assert.equal(f.winner,'1');
 assert.ok(f.rows.every(row=>row.modelAdjustment===0));
 assert.deepEqual(f.rows.map(r=>r.action.id).sort(),['1','2','3']);
 assert.deepEqual(f.scores,[10,9.9,8,100,200]);
 console.log('DEEP_COMPARE '+JSON.stringify(f.rows));
});
test('off, unavailable and missing model outcomes, and diagnostic parity',()=>{
 for(const config of [{enabled:false},{ready:false}]){
  const out=run(config);
  assert.equal(out.calls,0);
  assert.equal(out.winner,'1');
  assert.equal(out.rows.length,0);
 }
 const missing=run({missing:true});
 assert.equal(missing.calls,3);
 assert.equal(missing.winner,'1');
 assert.deepEqual(run({diagnostic:true}),run());
});

test('failed inference ignores an unbound probability from a replaced recommendation',()=>{
 for(const config of [{missing:true},{invalid:true},{throws:true}]){
  const out=run(config);
  assert.ok(out.rows.every(row=>row.modelProbability===0 && row.modelAdjustment===0));
 }
});
test('non-model risk still changes recommendation in incompatible identity mode',()=>{
 const out=run({mode:'identity',risk:true});
 assert.equal(out.calls,0);
 assert.equal(out.winner,'2');
});
test('predict failure and wrapper preserve an explicit unavailable status',()=>{
 const src=fs.readFileSync(path.join(root,'model/weights/weights.js'),'utf8');
 const engine=fs.readFileSync(path.join(root,'decision/engine/engine.js'),'utf8');
 const c=vm.createContext({W1:{},forwardFastWithValue:()=>{throw Error('failed');},
  weightsReady:()=>true,identityModelCompatibility:()=>({allowed:true})});
 vm.runInContext(src.match(/export function predict\(features\) \{[\s\S]*?\r*\n\}/)[0].replace('export ',''),c);
 vm.runInContext(engine.match(/export function safeModelPredict\(features\) \{[\s\S]*?\r*\n\}/)[0].replace('export ',''),c);
 assert.equal(c.predict([]).ready,false);
 assert.equal(c.safeModelPredict([]).ready,false);
 assert.equal(c.safeModelPredict([]).action,'skip');
});
