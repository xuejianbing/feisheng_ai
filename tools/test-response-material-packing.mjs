import assert from 'node:assert/strict';
import {register} from 'node:module';
const hand=['a','b','c','d','e','f'].map(name=>({name}));
const player={playerid:'p',hp:3,hujia:0,getCards:z=>z==='h'?hand:[],getSkills:()=>['ab','ac','bd']};
const skills={};
for(const [id,names]of Object.entries({ab:['a','b'],ac:['a','c'],bd:['b','d']}))skills[id]={enable:'chooseToRespond',viewAs:{name:'sha'},selectCard:2,filterCard:c=>names.includes(c.name)};
const stub={lib:{skill:skills,filter:{cardEnabled2:c=>!c.locked,cardRespondable:()=>true}},game:{},get:{name:c=>c.name},_status:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};register('./noname-stub-loader.mjs',import.meta.url);
const {canSupplyTrickResponse}=await import('../score/decision/response/responseMaterials.js?v=41a');
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name);};
const event={name:'chooseToRespond',shaRequired:2},ctx={responseEvent:event};
check('生产入口不会因先遇到AB而漏掉可行的AC与BD',()=>assert.equal(canSupplyTrickResponse(player,'sha',ctx),true));
const {hasDisjointResponseMaterials:pack}=await import('../score/decision/response/responseMaterialPacking.js?v=41a');
const options=sets=>sets.map(indices=>({cards:indices.map(i=>hand[i])}));
check('生产入口与技能枚举顺序无关',()=>{
 const original=player.getSkills;
 try{for(const order of [['bd','ab','ac'],['ac','bd','ab'],['ac','ab','bd'],['ab','bd','ac'],['bd','ac','ab']]){player.getSkills=()=>order;assert(canSupplyTrickResponse(player,'sha',ctx));}}
 finally{player.getSkills=original;}
});
check('共享材料的两条响应不能冒充两次',()=>assert.equal(pack(options([[0,1],[0,2]]),2),false));
check('同一实体牌通过多个技能转化只算一次',()=>assert.equal(pack(options([[0],[0],[0]]),2),false));
check('单材料与双材料一起分配不重复使用',()=>{
 assert.equal(pack(options([[0],[0,1],[1,2]]),2),true);
 assert.equal(pack(options([[0],[0,1]]),2),false);
 assert.equal(pack(options([[0],[1],[0,1]]),3),false);
});
check('重复双材料和颠倒材料顺序不增加响应次数',()=>assert.equal(pack(options([[0,1],[1,0],[0,1]]),2),false));
check('需要三次响应时能找到三组互斥材料',()=>{
 skills.ef={enable:'chooseToRespond',viewAs:{name:'sha'},selectCard:2,filterCard:c=>['e','f'].includes(c.name)};
 const original=player.getSkills;player.getSkills=()=>['ab','ac','bd','ef'];event.shaRequired=3;
 try{assert(canSupplyTrickResponse(player,'sha',ctx));event.shaRequired=4;assert.equal(canSupplyTrickResponse(player,'sha',ctx),false);}
 finally{event.shaRequired=2;player.getSkills=original;delete skills.ef;}
});
check('多闪要求走相同的分配路径',()=>{
 for(const info of Object.values(skills))info.viewAs.name='shan';event.shanRequired=2;
 try{assert(canSupplyTrickResponse(player,'shan',ctx));event.shanRequired=3;assert.equal(canSupplyTrickResponse(player,'shan',ctx),false);}
 finally{for(const info of Object.values(skills))info.viewAs.name='sha';delete event.shanRequired;}
});
check('材料禁用仍优先，匹配器不放开不合法材料',()=>{
 hand[2].locked=true;try{assert.equal(canSupplyTrickResponse(player,'sha',ctx),false);}finally{delete hand[2].locked;}
});
check('强命布尔、数组、集合仍禁止响应',()=>{
 try{for(const directHit of [true,[player],new Set([player])]){event.directHit=directHit;assert.equal(canSupplyTrickResponse(player,'sha',ctx),false);}}
 finally{delete event.directHit;}
});
check('目标专用要求与实际祖先要求仍取严格值',()=>{
 event.shaRequired=1;event.customArgs={p:{shaRequired:3}};
 try{assert.equal(canSupplyTrickResponse(player,'sha',ctx),false);event.customArgs.p.shaRequired=2;assert(canSupplyTrickResponse(player,'sha',ctx));
 event.parent={name:'useCard',shaRequired:3};assert.equal(canSupplyTrickResponse(player,'sha',ctx),false);}
 finally{delete event.customArgs;delete event.parent;event.shaRequired=2;}
});
check('畸形、超出支持范围或同一材料填两格的选项不制造能力',()=>{
 for(const sets of [[],[{cards:[]}],[{cards:[hand[0],hand[0]]}],[{cards:[hand[0],hand[1],hand[2]]}],[{cards:[null]}]])assert.equal(pack(sets,1),false);
 for(const required of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.equal(pack(options([[0]]),required),false);
 assert.equal(pack(options([[0,1]]),Number.MAX_SAFE_INTEGER),false);
});
check('奇数环与外接路径可同时匹配，不把材料图误当成两组',()=>assert(pack(options([[0,1],[1,2],[2,0],[0,3],[1,4],[2,5]]),3)));
check('评估不改写手牌、技能列表、事件或材料选项',()=>{
 const input=options([[0,1],[0,2],[1,3]]),saved=input.map(o=>o.cards.slice());
 Object.freeze(event);for(const o of input){Object.freeze(o.cards);Object.freeze(o);}Object.freeze(input);
 assert(pack(input,2));assert(canSupplyTrickResponse(player,'sha',ctx));assert.deepEqual(input.map(o=>o.cards),saved);
});
// Independent exhaustive oracle enumerates every choice of disjoint response.
function capacity(edges,singles,n){
 const memo=new Map();
 function visit(mask){
  if(!mask)return 0;if(memo.has(mask))return memo.get(mask);
  let v=0;while(!(mask&(1<<v)))v++;
  const rest=mask&~(1<<v);let best=visit(rest);
  if(singles&(1<<v))best=Math.max(best,1+visit(rest));
  for(const [a,b] of edges){const u=a===v?b:b===v?a:-1;if(u>=0&&(rest&(1<<u)))best=Math.max(best,1+visit(rest&~(1<<u)));}
  memo.set(mask,best);return best;
 }
 return visit((1<<n)-1);
}
check('穷举六张材料的全部32768张双材料图，与独立最优解一致',()=>{
 const edges=[];for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)edges.push([i,j]);
 for(let mask=0;mask<(1<<edges.length);mask++){
  const selected=edges.filter((_,i)=>mask&(1<<i)),max=capacity(selected,0,6),input=options(selected);
  for(let need=1;need<=4;need++)assert.equal(pack(input,need),need<=max,`pair graph ${mask}, need ${need}`);
 }
});
check('穷举五张材料的32768种单/双材料混合配置，与独立最优解一致',()=>{
 const edges=[];for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)edges.push([i,j]);
 for(let mask=0;mask<(1<<edges.length);mask++){
  const selected=edges.filter((_,i)=>mask&(1<<i));
  for(let singles=0;singles<32;singles++){
   const input=options([...selected,...hand.slice(0,5).flatMap((_,i)=>singles&(1<<i)?[[i]]:[])]),max=capacity(selected,singles,5);
   for(let need=1;need<=5;need++)assert.equal(pack(input,need),need<=max,`mixed ${mask}/${singles}, need ${need}`);
  }
 }
});
check('长交替路径可重排到500次响应，无递归组合爆炸',()=>{
 const cards=Array.from({length:1000},()=>({}));
 const input=[{cards:[cards[1],cards[2]]},...cards.slice(0,-1).map((c,i)=>({cards:[c,cards[i+1]]}))];
 assert(pack(input,500));assert.equal(pack(input,501),false);
});
console.log(`Response material packing tests: ${n} passed, 0 failed`);
