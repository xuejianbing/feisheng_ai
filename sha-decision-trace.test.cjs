const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const dir=path.join(__dirname,'score','decision');
function load(file, context) {
 vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8').replace(/^import .*$/gm,'').replaceAll('export function','function'),context);
}
function fixture(){
 const context=vm.createContext({window:{__DJSC:{}}});
 load('analysis/shaTrace.js',context);
 return context;
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('default off, enabled traces isolate events, redact and truncate',()=>{
 const c=fixture();
 assert.equal(c.beginShaTrace('a','identity','phase'),null);
 c.window.__DJSC.shaTraceEnabled=true;
 const a=c.beginShaTrace('a','identity','phase'), b=c.beginShaTrace('b','identity','phase');
 a.record('candidate',{id:'sha',target:'c',hiddenHand:['secret'],identity:'secret'});
 b.record('cache',{id:'sha'});
 for(let i=0;i<200;i++) a.record('model',{before:1,after:2});
 const [left,right]=plain(c.window.__DJSC.shaTraceSnapshot());
 assert.notEqual(left.traceId,right.traceId);
 assert.equal(left.actor,'a');
 assert.equal(right.actor,'b');
 assert.equal(right.rows.length,1);
 assert.equal(right.rows[0].stage,'cache');
 assert.equal(left.rows.length,64);
 assert.equal(left.truncated,true);
 assert.equal(JSON.stringify(left).includes('secret'),false);
 for(let i=0;i<30;i++) c.beginShaTrace('a','identity','phase');
 assert.equal(c.window.__DJSC.shaTraceSnapshot().length,16);
});
test('observing existing computations preserves candidates, ordering and calls',()=>{
 const c=fixture();
 function decide(enabled){
  c.window.__DJSC.shaTraceEnabled=enabled;
  const trace=c.beginShaTrace('a','identity','phase');
  const calls={filter:0,score:0,random:0};
  const filter=()=>{calls.filter++;return true;};
  const random=()=>{calls.random++;return .25;};
  const score=()=>{calls.score++;return 1+random();};
  const candidates=[{id:'end',score:0,tier:0}];
  if(filter()){
   const candidate={id:'sha',score:score(),tier:0};
   trace?.record('candidate',{id:candidate.id,after:candidate.score,tier:'normal'});
   candidates.push(candidate);
  }
  candidates.sort((a,b)=>b.tier-a.tier||b.score-a.score);
  trace?.record('rank',{id:candidates[0].id,after:candidates[0].score});
  return {calls,candidates,winner:candidates[0].id};
 }
 assert.deepEqual(decide(false),decide(true));
 console.log('TRACE_SAMPLE '+JSON.stringify(c.window.__DJSC.shaTraceSnapshot()[0]));
});
test('collector microbenchmark, isolated Node only',()=>{
 const c=fixture();
 for(const enabled of [false,true]){
  c.window.__DJSC.shaTraceEnabled=enabled;
  const start=performance.now();
  for(let i=0;i<5000;i++){
   const trace=c.beginShaTrace('a','identity','phase');
   trace?.record('candidate',{id:'sha',entity:null,after:1});
   trace?.record('rank',{id:'sha',after:1});
  }
  console.log('TRACE_BENCH '+enabled+' '+(performance.now()-start).toFixed(2)+' ms / 5000');
 }
});
test('identity Slash applies target style once, with signed utility and other signals intact',()=>{
 const c=fixture();
 c.applyOwnedUtility=(candidate,source,terms)=>{
  for(const term of terms) candidate.score+=term.delta;
 };
 load('utility/contextUtility.js',c);
 const source=fs.readFileSync(path.join(dir,'engine','engine.js'),'utf8');
 const legacy=source.slice(source.indexOf('const shaStyleBefore'),source.indexOf('/* ★ 资敌防护'));
 const applyLegacy=vm.runInContext('(s,id,cardTarget,cardTargetStyle,auditMode,shaTrace)=>{'+legacy+';return s;}',c);
 const rows=[];
 for(const base of [4,-4]) for(const tag of ['neutral','vengeful','cautious']) for(const extra of [false,true]){
  function run(enabled,mode){
   c.window.__DJSC.shaTraceEnabled=enabled;
   const trace=c.beginShaTrace('a',mode,'phase');
   const style={tag};
   const score=applyLegacy(base,'sha',{},style,{mode},trace);
   const candidate={id:'sha',type:'card',score,utilityBaseScore:score};
   c.applyContextUtility(candidate,'opponentContext','uncertainty',{style:c.styleRatio('sha',style),memory:extra?1.2:1});
   return candidate.score;
  }
  const before=run(false,'versus'),after=run(false,'identity');
  assert.equal(run(true,'identity'),after);
  const rate={neutral:0,vengeful:-.15,cautious:.1}[tag];
  const expected=base+Math.abs(base)*(rate+(extra?.2:0))/((rate?1:0)+(extra?1:0)||1);
  rows.push({base,tag,extra,before:+before.toFixed(3),after:+after.toFixed(3)});
  assert.ok(Math.abs(after-expected)<1e-9,JSON.stringify(rows.at(-1)));
 }
 const sample=rows.find(r=>r.base===4&&r.tag==='vengeful'&&!r.extra);
 assert.equal(sample.before>3.1,false);
 assert.equal(sample.after>3.1,true);
 console.log('STYLE_COMPARISON '+JSON.stringify(rows));
});
