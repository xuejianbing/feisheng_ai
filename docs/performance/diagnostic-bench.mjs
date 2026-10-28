import fs from 'node:fs/promises';import {performance} from 'node:perf_hooks';
globalThis.window={__DJSC:{}};const m=await import('../../score/foundation/diag/bootTrace.js');m.installPerfReport();
const rows=[];for(let r=0;r<5;r++){let x=0,t=performance.now();for(let i=0;i<10000;i++)x+=i;const emptyMs=performance.now()-t;t=performance.now();for(let i=0;i<10000;i++)m.recordDecisionPerf(1,{context:1,model:2});rows.push({emptyMs,record10000Ms:performance.now()-t});}
await fs.writeFile('docs/performance/evidence/diagnostic-overhead-node.json',JSON.stringify({node:process.version,kind:'Node desktop microbenchmark; not Android or Chrome',rows},null,2));console.log(rows);
