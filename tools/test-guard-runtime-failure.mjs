import assert from 'node:assert/strict';import {register} from 'node:module';
globalThis.window={__DJSC:{}};globalThis.__NONAME_STUB={lib:{config:{}},game:{players:[]},get:{},_status:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {guardCheck}=await import('../score/model/net/modelGuard.js');
const action={type:'end',id:'end',score:0};
for(const error of [new RangeError('recursive'),new Error('missing host')]){const context={get killAvailable(){throw error;}};const r=guardCheck({},action,context);assert.equal(r.ok,false);assert.equal(r.status,'error');assert.equal(r.fallback,null);assert.equal(r.rule,null);}
assert.equal(guardCheck(null,action,{}).status,'unavailable');assert.equal(guardCheck({},null,{}).ok,false);assert.equal(guardCheck({},action,{}).ok,true);console.log('PASS runtime/recursive guard failures are distinct from legal/invalid actions');

const fs=await import('node:fs/promises');let source=(await fs.readFile('score/decision/engine/engine.js','utf8')).replace(/\r/g,'');source=source.slice(source.indexOf('const _guardRes = guardCheck'),source.indexOf("guardEvidence={domain:'legality',ok:_guardRes.ok"));const evaluate=new Function('guardCheck','me','best','_guardCtx',source);const dangerous={id:'sha'};assert.equal(evaluate(()=>({ok:false,status:'error'}),{},dangerous,{}),null);assert.equal(dangerous.id,'sha');console.log('PASS engine withdraws failed guard recommendation without constructing end action');
