import assert from 'node:assert/strict';import {register} from 'node:module';
globalThis.window={__DJSC:{}};globalThis.__NONAME_STUB={lib:{config:{}},game:{players:[]},get:{},_status:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {guardCheck}=await import('../score/model/net/modelGuard.js');
const action={type:'end',id:'end',score:0};
for(const error of [new RangeError('recursive'),new Error('missing host')]){const context={get killAvailable(){throw error;}};const r=guardCheck({},action,context);assert.equal(r.ok,false);assert.equal(r.status,'error');assert.equal(r.fallback,null);assert.equal(r.rule,null);}
assert.equal(guardCheck(null,action,{}).status,'unavailable');assert.equal(guardCheck({},null,{}).ok,false);assert.equal(guardCheck({},action,{}).ok,true);console.log('PASS runtime/recursive guard failures are distinct from legal/invalid actions');
