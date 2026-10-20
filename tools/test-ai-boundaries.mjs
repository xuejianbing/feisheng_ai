import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id,role='fan'){Object.assign(this,{playerid:id,name:'同名',identity:role,hp:3,maxHp:4,hand:[],equip:[],judge:[]});}
 getCards(z,f){const cs=z==='e'?this.equip:z==='j'?this.judge:this.hand;return typeof f==='string'?cs.filter(c=>c.name===f):typeof f==='function'?cs.filter(f):cs;}
 countCards(z,f){return this.getCards(z,f).length;}hasSkill(){return false;}hasSkillTag(){return false;}isOnline2(){return false;}addSkill(){}removeSkill(){}canUse(){return true;}
}
const human=new Player('human'),bot=new Player('bot'),enemy=new Player('enemy','zhu');
let legal=true;
const stub={lib:{config:{},skill:{},card:{jiedao:{singleCard:true,filterTarget:(c,p,h)=>p!==h&&h.equip.length>0,filterAddedTarget:(c,p,t,h)=>legal&&t!==h&&t!==p}},filter:{cardEnabled:()=>true,cardUsable:()=>true,targetEnabled:()=>true},element:{Player}},game:{writeFile(){},me:human,players:[human,bot,enemy],dead:[]},get:{mode:()=> 'doudizhu',name:c=>c?.name,number:c=>c.number,attitude:(a,b)=>a.identity===b.identity?5:-5,value:()=>4,subtypes:c=>c.subtypes||[],position:()=> 'e',effect:()=>12},_status:{mode:'normal'},ui:{selected:{cards:[],targets:[]}},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const response=await import('../score/decision/cardplay/responseAI.js?v=41a');
const tactical=await import('../score/decision/strategy/tacticalOptimization.js?v=41a');
const {decisionCacheMatches}=await import('../score/decision/state/decisionCache.js?v=41a');
const {installAIUseTargetGuard}=await import('../score/decision/override/use.js?v=41a');
const {CHAINS}=await import('../score/decision/strategy/comboChain.js?v=41a');
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
response.installResponseAI();const tag=stub.lib.skill._djsc_responseAI.ai.skillTagFilter;
check('1 决斗回应不再比较杀和锦囊的点数，也不落入通用留杀',()=>{
 for(const number of [1,2,12,13]){bot.hand=[{name:'sha',number}];const root={name:'juedou',cards:[{name:'juedou',number:12}],turn:bot};stub._status.event={name:'chooseToRespond',player:bot,parent:root};assert.equal(tag(bot,'respondSha'),undefined);}
});
check('1 决斗窗口识别支持parent和getParent，不跨实际出牌结算',()=>{
 const root={name:'juedou',cards:[{number:13}],turn:bot};stub._status.event={name:'chooseToRespond',player:bot,getParent:()=>root};assert.equal(tag(bot,'respondSha'),undefined);
});
const actor={},window={},base={actor,key:'world-a',window,epoch:1,t:100,ba:{}};const current={actor,key:'world-a',window,epoch:1,now:200,ttl:1500};
check('2 同一玩家、局面、窗口和局次才允许缓存复用',()=>{assert(decisionCacheMatches(base,current));});
check('2 局面、身份关系或窗口变化，即使未到1.5秒也不复用',()=>{for(const change of [{key:'world-b'},{key:'world-a::different-relation'},{window:{}},{epoch:2},{actor:{}}])assert.equal(decisionCacheMatches(base,{...current,...change}),false);});
check('2 同名玩家不能共享缓存，缺少状态键、倒退时钟和过期缓存均失效',()=>{
 for(const change of [{actor:{name:'同名'}},{key:''},{now:50},{now:1600}])assert.equal(decisionCacheMatches(base,{...current,...change}),false);
});
check('2 无法定位选择窗口或窗口已经结束时不复用',()=>{
 assert.equal(decisionCacheMatches({...base,window:null},{...current,window:null}),false);
 const finished={finished:true};assert.equal(decisionCacheMatches({...base,window:finished},{...current,window:finished}),false);
});
check('2 事务属于其他选择窗口时不能复用',()=>{assert.equal(decisionCacheMatches({...base,ba:{__djscTransaction:{domain:'play',choiceWindow:{}}}},current),false);});
check('3 铁索关闭且遗留建议存在时，其他牌仍按自己的合法目标选择',()=>{
 stub.lib.config.extension_无名AI_tacticalTiesuo=false;tactical.captureTacticalSettings();stub._status.djsc_lastTiesuoHint={targets:[human],score:9};
 const event={filterTarget:()=>true};installAIUseTargetGuard(event);
 for(const name of ['sha','juedou','huogong','guohe','shunshou','lebu','bingliang'])assert.equal(event.filterTarget({name},bot,enemy),true);
 delete stub.lib.config.extension_无名AI_tacticalTiesuo;tactical.captureTacticalSettings();
});
check('3 原生禁选保持，友方攻击保护保持',()=>{const ev={filterTarget:()=>false};installAIUseTargetGuard(ev);assert.equal(ev.filterTarget({name:'sha'},bot,enemy),false);const ev2={filterTarget:()=>true};installAIUseTargetGuard(ev2);assert.equal(ev2.filterTarget({name:'sha'},bot,human),false);});
const chain=CHAINS.find(c=>c.id==='tao_lengjia');
check('4 只有防具或坐骑不再凭装备位置触发借刀连招',()=>{bot.hand=[{name:'jiedao'},{name:'sha'}];human.equip=[];enemy.equip=[];bot.equip=[{name:'bagua',subtypes:['equip2']}];assert.equal(chain.condition(bot,enemy),false);});
check('4 真实合法持刀队友可触发，不要求借刀者自己装备武器',()=>{bot.equip=[];human.equip=[{name:'zhuge',subtypes:['equip1']}];human.hand=[{name:'shan'},{name:'shan'},{name:'shan'},{name:'shan'}];assert(chain.condition(bot,enemy));});
check('4 借刀组合距离失效时连招同步失效',()=>{legal=false;assert.equal(chain.condition(bot,enemy),false);legal=true;});
response.uninstallResponseAI();console.log(`AI boundary tests: ${n} passed, 0 failed`);process.exit(0);
