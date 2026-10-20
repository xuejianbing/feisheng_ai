import assert from 'node:assert/strict';
import {register} from 'node:module';
class Player{
 constructor(id){Object.assign(this,{playerid:id,hp:3,maxHp:4,hujia:0,hand:[],equip:[],judge:[],skills:['wusheng'],skipList:[],turned:false,linked:false});}
 getCards(zone){if(zone==='h')return this.hand;if(zone==='e')return this.equip;if(zone==='j')return this.judge;throw Error('unexpected zone '+zone);}
 countCards(zone){return zone==='h'?this.hand.length:this.getCards(zone).length;}
 getSkills(){return this.skills.slice();}getStat(){return {};}
 isLinked(){return this.linked;}isTurnedOver(){return this.turned;}
}
const actor=new Player('actor'),other=new Player('other');actor.hand=[{name:'sha',suit:'spade',number:7}];
other.getCards=function(z){if(z==='h'||z==='s')throw Error('hidden hand');return z==='e'?this.equip:this.judge;};
other.getSkills=()=>{throw Error('hidden skill access');};
const choice={name:'chooseToUse',type:'phase',player:actor};
const stub={game:{me:actor,players:[actor,other]},get:{name:c=>c.name,suit:c=>c.suit,number:c=>c.number,nature:c=>c.nature||''},ui:{},_status:{currentPhase:actor,event:choice,roundNumber:1},lib:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {stateKey,checkStateChanged,cacheSet,cacheGet}=await import('../score/foundation/storage/cache.js?v=41a');
const {decisionCacheMatches}=await import('../score/decision/state/decisionCache.js?v=41a');
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
function changes(name,apply,undo){check(name,()=>{const before=stateKey();apply();try{assert.notEqual(stateKey(),before);}finally{undo();}});}
check('相同状态稳定复用，不读取其他玩家隐藏手牌或技能',()=>{const key=stateKey();assert(!key.startsWith('error_'));assert.equal(stateKey(),key);});
changes('自身护甲变化进入状态键',()=>actor.hujia=1,()=>actor.hujia=0);
changes('其他角色公开护甲变化进入状态键',()=>other.hujia=2,()=>other.hujia=0);
changes('自身翻面变化进入状态键',()=>actor.turned=true,()=>actor.turned=false);
changes('其他角色公开翻面变化进入状态键',()=>other.turned=true,()=>other.turned=false);
changes('自身可用技能增加进入状态键',()=>actor.skills.push('longdan'),()=>actor.skills.pop());
changes('自身技能被禁用后的可用列表变化进入状态键',()=>actor.skills=[],()=>actor.skills=['wusheng']);
changes('自身跳过阶段变化进入状态键',()=>actor.skipList=['phaseUse'],()=>actor.skipList=[]);
const original=actor.hand[0];
changes('自身同名同花色同点数的另一张实体牌不沿用旧引用',()=>actor.hand=[{...actor.hand[0]}],()=>actor.hand=[original]);
check('技能及手牌枚举顺序改变不制造状态变化',()=>{
 const second={name:'shan',suit:'heart',number:2};actor.hand.push(second);actor.skills.push('longdan');
 try{const before=stateKey();actor.hand.reverse();actor.skills.reverse();assert.equal(stateKey(),before);}
 finally{actor.hand=[original];actor.skills=['wusheng'];}
});
check('护甲变化使真实状态键和两层共享缓存检查失效',()=>{
 const entry={actor,key:stateKey(),window:choice,epoch:1,t:100,ba:{}};
 const ctx=()=>({actor,key:stateKey(),window:choice,epoch:1,now:101,ttl:1500});
 assert(decisionCacheMatches(entry,ctx()));other.hujia=1;
 try{assert.equal(decisionCacheMatches(entry,ctx()),false);}finally{other.hujia=0;}
});
check('技能变化触发状态监听并清除派生缓存',()=>{
 checkStateChanged();cacheSet('derived',42);assert.equal(cacheGet('derived'),42);actor.skills.push('longdan');
 try{assert.equal(checkStateChanged(),true);assert.equal(cacheGet('derived'),null);assert.equal(checkStateChanged(),false);}
 finally{actor.skills=['wusheng'];}
});
console.log(`Decision state fingerprint tests: ${n} passed, 0 failed`);
