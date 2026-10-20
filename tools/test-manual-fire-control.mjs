import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id){this.playerid=id;this.hp=3;this.hand=[{name:'sha',value:2},{name:'shan',value:5}];this.remote=false;}
 getCards(z){assert.equal(z,'h');return this.hand;}isOnline2(){return this.remote;}
}
const me=new Player('me'),other=new Player('other');let nativeCalls=0;
const stub={lib:{config:{},skill:{},element:{Player},card:{huogong:{content:async function(event,trigger,player){nativeCalls++;return {event,trigger,player,receiver:this};}}},filter:{cardDiscardable:()=>true}},game:{me,players:[me,other],addGlobalSkill(){}},get:{mode:()=> 'doudizhu',value:c=>c.value},_status:{mode:'normal',auto:false},ui:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');tactical.captureTacticalSettings();tactical.installTacticalOptimization();
let count=0;async function check(name,fn){await fn();count++;console.log('PASS '+name);}
const run=(p,extra={})=>{const e={target:p,...extra};return stub.lib.card.huogong.content(e,null,p).then(()=>e);};
await check('本地手动自火攻保留原生展示选择',async()=>{const e=await run(me);assert.equal(e.chooseToShow,undefined);});
await check('远端人类自火攻保留展示选择且不读取其手牌',async()=>{
 other.remote=true;const saved=other.getCards;other.getCards=()=>{throw Error('remote hand');};
 try{const e=await run(other);assert.equal(e.chooseToShow,undefined);}finally{other.getCards=saved;other.remote=false;}
});
await check('本机托管状态不授予接管远端人类选牌的权限',async()=>{
 other.remote=true;stub._status.auto=true;
 try{assert.equal((await run(other)).chooseToShow,undefined);}finally{other.remote=false;stub._status.auto=false;}
});
await check('离线AI仍能使用自火攻展示优化',async()=>{
 const e=await run(other);assert.equal(typeof e.chooseToShow,'function');assert.deepEqual((await e.chooseToShow(e,other,other)).cards,[other.hand[0]]);
});
await check('本地托管仍能使用自火攻展示优化',async()=>{
 stub._status.auto=true;try{assert.equal(typeof (await run(me)).chooseToShow,'function');}finally{stub._status.auto=false;}
});
await check('宿主已有展示回调和筛选条件保持权威',async()=>{
 const show=()=>{};assert.equal((await run(other,{chooseToShow:show})).chooseToShow,show);
 assert.equal((await run(other,{filterShow:()=>true})).chooseToShow,undefined);
 assert.equal((await run(other,{showPosition:'e'})).chooseToShow,undefined);
});
await check('关闭专项时不注入自动展示',async()=>{
 stub.lib.config.extension_无名AI_tacticalFire=false;tactical.captureTacticalSettings();
 try{assert.equal((await run(other)).chooseToShow,undefined);}finally{delete stub.lib.config.extension_无名AI_tacticalFire;tactical.captureTacticalSettings();}
});
await check('原生牌内容只调用一次并保留参数、接收对象和返回结果',async()=>{
 const before=nativeCalls,event={target:me},trigger={},receiver={};const result=await stub.lib.card.huogong.content.call(receiver,event,trigger,me);
 assert.equal(nativeCalls,before+1);assert.deepEqual(result,{event,trigger,player:me,receiver});
});
console.log(`Manual fire control tests: ${count} passed, 0 failed`);
