import assert from 'node:assert/strict';
import {register} from 'node:module';
const stub={lib:{config:{},configOL:{}},game:{players:[],dead:[],saveConfig:(key,value)=>{stub.lib.config[key]=value;}},
 get:{mode:()=>mode,config:()=>false},_status:{mode:'two'},ui:{},ai:{}};
let mode='versus';
globalThis.__NONAME_STUB=stub;
register('./noname-stub-loader.mjs',import.meta.url);
const {CONFIG_ITEMS,validateSchema,applyConfigSchema}=await import('../js/config/configSchema.js?v=41a');
const {arrangeConfig}=await import('../js/config/configLayout.js?v=41a');
const {versusStrategyEnabled}=await import('../score/foundation/config/versusSettings.js?v=41a');
const {versusStatus}=await import('../score/view/dashboard/versusStatus.js?v=41a');
const {readSeatTactics}=await import('../score/decision/modes/versus/seatTacticsRuntime.js?v=41a');
const {readResourceReserve}=await import('../score/decision/modes/versus/resourceReserveRuntime.js?v=41a');
const {aoeRiskEnabled}=await import('../score/decision/modes/versus/aoeRiskRuntime.js?v=41a');
let count=0;
function check(name,fn){fn();count++;console.log('PASS '+name);}
function set(key,value){stub.lib.config['extension_无名AI_'+key]=value;}
check('schema有效且三个开关默认开启',()=>{
 assert.deepEqual(validateSchema(),{ok:true,errors:[]});
 for(const key of ['versusStrategy','versusSeatProtection','versusReserve'])assert.equal(CONFIG_ITEMS[key].default,true);
});
let rows=[];
globalThis.document={querySelectorAll:()=>rows};
const source=Object.fromEntries(Object.keys(CONFIG_ITEMS).map(key=>[key,{name:key}]));
const layout=arrangeConfig(applyConfigSchema(source),stub.lib,stub.game);
check('原生2v2折叠栏与四个简洁设置项',()=>{
 const keys=Object.keys(layout),fold=keys.find(key=>layout[key].name.includes('data-subgroup="versus2v2"'));
 assert.ok(fold);
 for(const key of ['versusStrategy','versusSeatProtection','versusReserve','openVersusStatus']){
  assert.ok(layout[key]);assert.ok(!layout[key].name.includes('djsc-setting-desc'));
  assert.ok(layout[key].name.includes('data-subgroup="versus2v2"'));
 }
 assert.ok(layout.openVersusStatus.name.includes('class="djsc-setting-action">查看'));
 assert.ok(!layout.openModeLearningProgress.name.includes('data-subgroup="versus2v2"'));
});
check('总开关关闭使策略入口停止，基础模式仍适用',()=>{
 layout.versusStrategy.onclick(false);
 assert.equal(versusStrategyEnabled('versusReserve'),false);
 assert.equal(readSeatTactics({}),null);
 assert.equal(readResourceReserve({},{}).discardPremium,0);
 assert.equal(aoeRiskEnabled(),false);
 assert.equal(versusStatus().applicable,true);
 assert.equal(versusStatus().cards[1].value,'总开关已关闭');
});
check('子开关保持独立且总开关重开不覆盖子项',()=>{
 set('versusSeatProtection',false);set('versusReserve',true);
 layout.versusStrategy.onclick(true);
 assert.equal(versusStrategyEnabled('versusSeatProtection'),false);
 assert.equal(aoeRiskEnabled(),false);
 assert.equal(versusStrategyEnabled('versusReserve'),true);
 assert.equal(versusStatus().cards[1].value,'已关闭');
});
check('通用打法关闭时状态准确',()=>{
 set('tacticalOptimization',false);
 assert.equal(versusStrategyEnabled('versusReserve'),false);
 assert.equal(versusStatus().cards[2].value,'通用打法优化已关闭');
 set('tacticalOptimization',true);
});
check('其他模式不显示已生效，自定义乱斗不适用',()=>{
 mode='identity';assert.equal(versusStatus().reserveEnabled,false);
 assert.equal(versusStatus().cards[2].value,'当前模式不适用');
 mode='versus';stub._status.brawl={};assert.equal(versusStatus().applicable,false);delete stub._status.brawl;
});
check('联机2v2状态与子项配置一致',()=>{
 stub._status.mode='2v2';stub._status.connectMode=true;
 assert.equal(versusStatus().cards[0].value,'联机2v2');
 assert.equal(versusStatus().reserveEnabled,true);
});
// 等待布局的非阻塞刷新；测试只检查实际DOM行状态，不新增行为模拟。
const row={style:{},classList:{toggle:(_name,value)=>row.disabled=value}};
rows=[{closest:()=>row}];
layout.versusStrategy.onclick(false);
await new Promise(resolve=>setTimeout(resolve,10));
check('关闭后子项变灰且不可点击',()=>{assert.equal(row.disabled,true);assert.equal(row.style.pointerEvents,'none');});
layout.versusStrategy.onclick(true);
await new Promise(resolve=>setTimeout(resolve,10));
check('重开恢复子项交互',()=>{assert.equal(row.disabled,false);assert.equal(row.style.pointerEvents,'');});
console.log(`2v2 settings: ${count} passed`);
