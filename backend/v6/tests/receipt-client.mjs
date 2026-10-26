import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [url,clientRoot,bodyFile]=process.argv.slice(2);
const parser=await import(pathToFileURL(clientRoot.replaceAll('\\','/')+'/score/foundation/cloud/ingestReceipt.js').href+'?v=41a');
const body=readFileSync(bodyFile,'utf8');let summary=parser.createIngestReceiptSummary();
const credential=process.argv[5]?JSON.parse(readFileSync(process.argv[5],'utf8')):null;
const headers={'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential.token}:{})};
for(let i=0;i<12;i++){
 const response=await fetch(url,{method:'POST',headers,body});
 const result=await parser.parseIngestHttpResponse(response);
 assert(parser.normalizeIngestReceipt(result));assert.equal(result.duplicate_request,i!==0);
 summary=parser.addIngestReceipt(summary,result);
}
assert.equal(summary.archivedSamples,1);assert.equal(summary.duplicateRequests,11);
await assert.rejects(async()=>parser.parseIngestHttpResponse(await fetch(url,{method:'POST',headers,body})),e=>e.rateLimited===true&&e.retryAfterMs>0&&e.retryAfterMs<=3600000);
console.log('PASS actual client receipt parser: archive acknowledgement, frozen replay, no duplicate counter, Retry-After');
