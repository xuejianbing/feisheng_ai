import {game,get,lib} from '../../../foundation/adapt/host.js?v=41a';
import {readVersusMode} from '../../../foundation/runtime/versusContext.js?v=41a';
import {sameTeamBySide} from './team.js?v=41a';
import {probHasShan,probHasSha,probHasTao,probHasJiu,probHasWuxie} from '../../../model/predict/handInference.js?v=41a';
import {baguaSuccessRate} from '../../../model/predict/deckPredict.js?v=41a';
import {evaluateAttackExpectedValue} from '../../utility/attackExpectedUtility.js?v=41a';
import {hasVengeanceSkill} from '../../threat/threat.js?v=41a';

const clamp=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):.5;
const alive=player=>player&&player.alive!==false&&player.isAlive?.()!==false;
const idOf=(card,player)=>card?(get.name?.(card,player)||card.name):null;
const isSha=id=>['sha','huosha','leisha'].includes(id);
let evaluating=false;
function empty(resolved=true) {
    return {resolved,legal:false,certain:false,killProbability:0,evaluation:{score:0,offense:0,risk:0,resourceCost:0,hitProbability:0,damage:0}};
}
function countHand(player) {
    try {const n=player.countCards?.('h');return Number.isFinite(n)&&n>=0?n:null;}catch(_){return null;}
}
function knownRescue(target,damage) {
    const needed=Math.max(1,Math.ceil(1-target.hp+damage));
    let budget=0,unknown=false,publicSave=false;
    for(const player of game.players||[]) {
        if(!alive(player)||sameTeamBySide(target,player)!==true)continue;
        const n=countHand(player);
        if(n===null){unknown=true;budget+=.5;}
        else if(n>0){budget+=clamp(probHasTao(player));if(player===target)budget+=clamp(probHasJiu(player));}
        // 只读公开技能的静态声明，不执行 skillTagFilter 来探测救援者的私有材料。
        const skills=player.getSkills?.()||[];
        if(skills.some(id=>lib.skill?.[id]?.ai?.save===true&&!player.awakenedSkills?.includes(id))){budget+=.5;publicSave=true;}
    }
    return {rescueProbability:Math.min(.95,budget/needed),rescueUnknown:unknown,requiredHealing:needed,publicSave};
}
function trickResolution(target) {
    let resolution=1;
    for(const defender of game.players||[]) {
        if(!alive(defender)||sameTeamBySide(target,defender)!==true)continue;
        const n=countHand(defender);
        resolution*=1-(n===null ? .5 : n>0?clamp(probHasWuxie(defender)):0);
    }
    return resolution;
}

// 主动实体杀/决斗的公开机会估计。没有宿主死亡确认，certain始终为false。
export function evaluateVersusAttack(player,card,target) {
    if(!readVersusMode().is2v2)return null;
    if(evaluating)return empty(false);
    evaluating=true;
    try {
        const id=idOf(card,player),normalized=isSha(id)?'sha':id;
        if(!['sha','juedou'].includes(normalized)||!alive(player)||!alive(target)||target.hp<=0||sameTeamBySide(player,target)!==false)return empty();
        const hand=player.getCards?.('h')||[];
        if(!hand.includes(card)||lib.filter?.cardEnabled?.(card,player)===false||lib.filter?.cardUsable?.(card,player)===false||player.canUse?.(card,target)!==true)return empty();
        const armor=target.getEquip?.(2),armorId=idOf(armor,target);
        const ignore=target.hasSkillTag?.('unequip2')===true||
            player.hasSkillTag?.('unequip',false,{name:normalized,card,target})===true||normalized==='sha'&&idOf(player.getEquip?.(1),player)==='qinggang';
        const nature=id==='huosha'?'fire':id==='leisha'?'thunder':get.nature?.(card,player)??card.nature;
        const natures=Array.isArray(nature)?nature:typeof nature==='string'?nature.split('|').filter(Boolean):[];
        const color=get.color?.(card,player)||card.color;
        const targetHandCount=countHand(target);
        const context={targetHp:target.hp,shanProbability:targetHandCount===null ? .5 : clamp(probHasShan(target)),shaProbability:targetHandCount===null ? .5 : clamp(probHasSha(target)),
            hasBagua:normalized==='sha'&&!ignore&&(armorId==='bagua'||!armor&&target.hasSkill?.('bazhen')===true),
            baguaSuccess:clamp(baguaSuccessRate()),ownSha:hand.filter(c=>idOf(c,player)==='sha').length,
            targetHandCount:targetHandCount??2,vengeance:hasVengeanceSkill(target),
            drunkDamage:normalized==='sha'&&player.hasSkill?.('jiu')?Math.max(0,Number(player.storage?.jiu)||0):0};
        const raw=evaluateAttackExpectedValue(normalized,context);
        const resolutionProbability=normalized==='juedou'?trickResolution(target):1;
        let hit=raw.hitProbability*resolutionProbability,damage=raw.damage;
        const effect=typeof get.effect==='function'?get.effect(target,card,player,player):null;
        const immune=target.hasSkillTag?.('nodamage')===true||normalized==='juedou'&&target.hasSkillTag?.('notrick')===true||
            natures.includes('fire')&&target.hasSkillTag?.('nofire')===true||natures.includes('thunder')&&target.hasSkillTag?.('nothunder')===true||
            normalized==='sha'&&!ignore&&(armorId==='tengjia'&&!natures.length||armorId==='renwang'&&color==='black');
        if(immune||Number.isFinite(effect)&&effect<=0)hit=0;
        if(!Number.isFinite(effect))hit*=.5;
        if(normalized==='sha'&&!ignore&&armorId==='renwang'&&!['red','black'].includes(color))hit*=.5;
        if(normalized==='sha'&&!ignore&&armorId==='tengjia'&&natures.includes('fire'))damage+=1;
        if(normalized==='sha'&&idOf(player.getEquip?.(1),player)==='guding'&&targetHandCount===0)damage+=1;
        if(!ignore&&armorId==='baiyin')damage=Math.min(damage,1);
        const shield=Math.max(0,Number(target.hujia)||0),hpDamage=Math.max(0,damage-shield);
        const dying=hpDamage>=target.hp&&target.hp>0?hit:0;
        const rescue=dying>0?knownRescue(target,hpDamage):{rescueProbability:0,rescueUnknown:false,requiredHealing:0,publicSave:false};
        // 留出未建模技能/触发的余量；该系数和救援预算均为启发式，不是实测胜率。
        const killProbability=dying*(1-rescue.rescueProbability)*.9;
        const lethal={schema:'versus-lethal-v1',hitProbability:hit,damage,hpDamage,killProbability,
            dyingProbability:dying,certain:false,resolutionProbability,
            duelFailureProbability:normalized==='juedou'?(1-raw.hitProbability)*resolutionProbability:0,...rescue};
        const evaluation=evaluateAttackExpectedValue(normalized,{...context,lethal});
        return {resolved:true,legal:true,certain:false,killProbability,evaluation,lethal};
    }catch(_){return empty(false);}finally{evaluating=false;}
}

export function evaluateVersusAttackForId(player,id,target) {
    if(!readVersusMode().is2v2)return null;
    try {
        const cards=(player.getCards?.('h')||[]).filter(card=>idOf(card,player)===id);
        const options=cards.map(card=>evaluateVersusAttack(player,card,target)).filter(plan=>plan?.legal);
        if(!options.length)return empty();
        // 牌名候选尚未提交实体牌；只表示当前确有实体牌提供这一机会，不提升为必杀职责。
        const best=options.sort((a,b)=>b.evaluation.score-a.evaluation.score)[0];
        return {...best,materialUnbound:cards.length>1};
    }catch(_){return empty(false);}
}
