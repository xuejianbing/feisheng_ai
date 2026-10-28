import assert from 'node:assert/strict';import {register} from 'node:module';
let idle;globalThis.self=globalThis;globalThis.window={__DJSC:{},requestIdleCallback:fn=>idle=fn};globalThis.localStorage={getItem:()=>null};
globalThis.__NONAME_STUB={lib:{config:{'extension_无名AI_policyModelV3Mode':'off'}},game:{},get:{},_status:{}};register('./noname-stub-loader.mjs',import.meta.url);
const m=await import('../score/model/net/policyModelV3.js');idle();await Promise.resolve();assert.equal(m.policyModelStats().loadingStarted,false,'disabled idle preload must not start');
__NONAME_STUB.lib.config['extension_无名AI_policyModelV3Mode']='shadow';assert.equal(m.predictClasses(Array(130).fill(0)),null);await m.startLoading();assert(m.predictClasses(Array(130).fill(0))?.length===17);
__NONAME_STUB.lib.config['extension_无名AI_policyModelV3Mode']='off';assert.equal(m.predictClasses(Array(130).fill(0)),null);console.log('PASS disabled v3 skips idle preload; enabling starts once; disabling suppresses inference');
