// Bounded aggregates; completed calls never retain their execution frames.
export function createPerformanceCollector({now=()=>typeof performance!=='undefined'?performance.now():Date.now(),maxPhases=64,maxNodes=128,maxSamples=200,maxDepth=5,maxActive=128}={}) {
 const stats=new Map(),stack=[],active=new Set();let enabled=true,generation=0,nodes=1,dropped=0;
 const root={name:'root',total:0,count:0,children:new Map()};
 function phaseKey(phase){return String(phase||'unknown').slice(0,100);}
 function record(phase,dt,mode='sync'){
  if(!enabled||!Number.isFinite(dt)||dt<0)return;
  let key=phaseKey(phase);if(!stats.has(key)&&stats.size>=maxPhases){dropped++;return;}
  let s=stats.get(key);if(!s){s={phase:key,count:0,total:0,max:0,min:Infinity,samples:[],cursor:0,mode};stats.set(key,s);}
  s.count++;s.total+=dt;s.max=Math.max(s.max,dt);s.min=Math.min(s.min,dt);
  if(s.samples.length<maxSamples)s.samples.push(dt);else{s.samples[s.cursor]=dt;s.cursor=(s.cursor+1)%maxSamples;}
 }
 function start(phase,{detached=false}={}){
  if(!enabled)return null;
  if(active.size>=maxActive){dropped++;return null;}
  const name=phaseKey(phase),parent=detached?null:stack[stack.length-1],depth=parent?parent.depth+1:1;
  const parentNode=parent?parent.node:root;let node=null;
  if(depth<=maxDepth&&parentNode){node=parentNode.children.get(name);if(!node&&nodes<maxNodes){node={name,total:0,count:0,children:new Map()};parentNode.children.set(name,node);nodes++;}}
  const frame={phase:name,t0:now(),generation,depth,node,detached};active.add(frame);if(!detached)stack.push(frame);return frame;
 }
 function end(handle){
  const frame=typeof handle==='string'?stack[stack.length-1]:handle;
  if(!frame||!active.has(frame)||frame.generation!==generation)return 0;
  if(typeof handle==='string'&&frame.phase!==handle)return 0;
  const index=stack.indexOf(frame);if(index>=0)stack.splice(index,1);active.delete(frame);
  const dt=Math.max(0,now()-frame.t0);record(frame.phase,dt,frame.detached?'async-wall':'sync');
  if(frame.node){frame.node.total+=dt;frame.node.count++;}root.total+=frame.depth===1?dt:0;root.count+=frame.depth===1?1:0;return dt;
 }
 const round=n=>Math.round(n*100)/100;
 function tree(node){return {name:node.name,total:round(node.total),count:node.count,children:[...node.children.values()].map(tree).sort((a,b)=>b.total-a.total)};}
 function snapshot(){return {phases:[...stats.values()].map(s=>{const a=s.samples.slice().sort((a,b)=>a-b);const pct=p=>round(a[Math.min(a.length-1,Math.floor(a.length*p))]||0);return {phase:s.phase,count:s.count,total:round(s.total),avg:round(s.total/s.count),max:round(s.max),min:round(s.min),p95:pct(.95),p99:pct(.99),sampleCount:a.length,mode:s.mode};}).sort((a,b)=>b.total-a.total),tree:tree(root),retention:{phases:stats.size,nodes,active:active.size,samples:[...stats.values()].reduce((n,s)=>n+s.samples.length,0),dropped,maxPhases,maxNodes,maxSamples,maxActive}};}
 function reset(){generation++;stats.clear();stack.length=0;active.clear();root.children.clear();root.total=0;root.count=0;nodes=1;dropped=0;}
 function enable(value){enabled=!!value;if(!enabled){generation++;stack.length=0;active.clear();}}
 return {start,end,record,snapshot,reset,enable,enabled:()=>enabled};
}
export const runtimePerformance=createPerformanceCollector();
