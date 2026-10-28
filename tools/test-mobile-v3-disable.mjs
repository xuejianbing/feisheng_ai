import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';import {register} from 'node:module';
const boolean=process.argv.includes('--boolean');let idle;globalThis.self=globalThis;globalThis.window={__DJSC:{},requestIdleCallback:fn=>idle=fn};globalThis.localStorage={getItem:()=>null};
globalThis.__NONAME_STUB={lib:{config:{'extension_无名AI_policyModelV3Mode':boolean?'shadow':'off','extension_无名AI_policyModelV3Shadow':!boolean}},game:{},get:{},_status:{}};register('./noname-stub-loader.mjs',import.meta.url);
const m=await import('../score/model/net/policyModelV3.js');idle();await Promise.resolve();assert.equal(m.policyModelStats().loadingStarted,false,'disabled idle preload must not start');
__NONAME_STUB.lib.config['extension_无名AI_policyModelV3Mode']='shadow';__NONAME_STUB.lib.config['extension_无名AI_policyModelV3Shadow']=true;assert.equal(m.shadowEvaluate([{type:'end',_feat:Array(130).fill(0)}],{type:'end'},null,{}),null);assert.equal(m.policyModelStats().loadingStarted,true,'production shadow entry must restart lazy load');await m.startLoading();assert(m.predictClasses(Array(130).fill(0))?.length===17);
__NONAME_STUB.lib.config['extension_无名AI_policyModelV3Mode']='off';assert.equal(m.predictClasses(Array(130).fill(0)),null);console.log('PASS disabled v3 skips idle preload; enabling starts once; disabling suppresses inference');

if(!boolean)process.stdout.write(execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--boolean'],{encoding:'utf8'}));
