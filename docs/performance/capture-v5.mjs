import fs from 'node:fs/promises';
const m=await import('../../shadow/decodeV5.js');globalThis.lib={init:{promises:{json:async url=>JSON.parse(await fs.readFile(url.replace('extension/无名AI/',''),'utf8'))}}};await m.loadV5All();
const inputs=[Array(130).fill(0),...Array.from({length:12},(_,s)=>Array.from({length:134},(_,i)=>(i*37+s*19)%255-127))];
await fs.writeFile('docs/performance/evidence/v5-golden.json',JSON.stringify(inputs.map(input=>({input,output:m.v5Predict(input)})),null,2));
