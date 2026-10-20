#!/usr/bin/env node
// 冻结最小宿主输入，输出当前生产实现；后续 ID-04 可继续使用同一输入比较。
import {register} from 'node:module';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/identity-minimal-baseline.json',import.meta.url),'utf8'));
const stub={lib:{config:{}},game:{players:[],dead:[]},get:{mode:()=> 'identity'},_status:{mode:'normal',roundNumber:0},ui:{},ai:{}};
globalThis.__NONAME_STUB=stub;globalThis.window={__DJSC:{}};
register('./noname-stub-loader.mjs',import.meta.url);
const id=await import('../score/perception/observer/identity.js?v=41a');
const obs=await import('../score/perception/observer/observer.js?v=41a');
const roles=['zhu','zhong','fan','nei'];
stub.get.identityList=()=>roles.slice();
const rows=[];
for (const attackEvidence of [0,0.01,1]) {
    const players=roles.map((identity,i)=>({playerid:'p'+i,name:'同名武将',identity,identityShown:i===0,alive:true,hp:4,countCards:()=>0,getCards:()=>[]}));
    stub.game.players=players;stub.game.zhu=players[0];id.resetBelief();obs.resetObs();
    if (attackEvidence>0) { obs.observeAttack(players[2],players[0],attackEvidence);obs.observeAttack(players[3],players[0],attackEvidence); }
    const a=id.beliefOfFor(players[1],players[2]),b=id.beliefOfFor(players[1],players[3]);
    rows.push({attackEvidence,a,b,fanMass:a.fan+b.fan,slots:id.remainingRoleSlots(players[1]).counts});
}
const current={loyalToPublicLord:id.isLikelyAlly(stub.game.players[1],stub.game.zhu),rows};
const knownIssues={strengthInsensitive:Math.abs(rows[1].a.fan-rows[2].a.fan)<1e-12,
    quotaNotConserved:rows.some(row=>Math.abs(row.fanMass-row.slots.fan)>1e-12)};
console.log(JSON.stringify({fixtureCommit:fixture.commit,scope:fixture.scope,original:fixture.rows,current,knownIssues,
    note:'第一批保留旧信念权重。强度敏感与整桌配额一致性属于后续 ID-04；此输出不代表完整对局验证。'},null,2));
process.exitCode=current.loyalToPublicLord?0:1;
