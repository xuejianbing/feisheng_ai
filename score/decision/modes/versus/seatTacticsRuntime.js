import {game,get,lib,_status} from '../../../foundation/adapt/host.js?v=41a';
import {versusStrategyEnabled} from '../../../foundation/config/versusSettings.js?v=41a';
import {playerKey,resolvePlayerByKey} from '../../../foundation/adapt/playerIdentity.js?v=41a';
import {readVersusMode,readVersusState} from '../../../foundation/runtime/versusContext.js?v=41a';
import {sameTeamBySide} from './team.js?v=41a';
import {buildSeatTactics,seatActionPreference} from './seatTactics.js?v=41a';
import {applyOwnedUtility} from '../../utility/utilityPipeline.js?v=41a';
import {isCandidateEligible} from '../../state/actionCandidate.js?v=41a';

export function ownPlayWindow(me) {
    if(!me||_status.currentPhase!==me)return false;
    let event=_status.event;
    for(let i=0;event&&i<16;i++) {
        if(event.type==='respond'||event.type==='dying'||event.name==='chooseToRespond'||event.name==='_save'||event.name==='dying')return false;
        if(event.name==='phaseUse')return event.player===me;
        event=event.parent||event.getParent?.();
    }
    return false;
}

export function publicAttackReach(from,to) {
    try {
        if(!from||!to||from===to)return false;
        // 使用宿主公开的距离/技能规则，不读取他人手牌或假设将来一定能出杀。
        if(lib.filter?.targetEnabled2&&!lib.filter.targetEnabled2({name:'sha',isCard:true},from,to))return false;
        if(typeof from.inRange==='function')return from.inRange(to)===true;
        if(typeof get.distance!=='function'||typeof from.getAttackRange!=='function')return false;
        const distance=get.distance(from,to,'attack'),range=from.getAttackRange();
        return Number.isFinite(distance)&&Number.isFinite(range)&&distance<=range;
    } catch (_) {return false;}
}

export function readSeatTactics(me) {
    if(!readVersusMode().is2v2||!versusStrategyEnabled('versusSeatProtection'))return null;
    const state=readVersusState(me),players=game.players||[];
    const byId=new Map(players.map(p=>[playerKey(p),p]));
    const publicPlayers=players.map(p=>({id:playerKey(p),hp:p.hp,turnSkipped:p.isTurnedOver?.()===true,playSkipped:p.skipList?.includes('phaseUse')===true}));
    return buildSeatTactics(state,publicPlayers,(from,to)=>publicAttackReach(byId.get(from),byId.get(to)));
}

export function versusSeatTeamPlan(me) {
    const seatTactics=readSeatTactics(me);
    const empty={focus:null,protect:null,protectList:[],combos:[],seatTactics};
    if(!seatTactics)return empty;
    const ally=resolvePlayerByKey(seatTactics.allyId,game.players||[]);
    const protect=seatTactics.allyInDanger?{ally,name:ally.name1||ally.name||playerKey(ally),
        score:seatTactics.threatsBeforeAlly.length,reason:'队友行动前存在可达敌方回合'}:null;
    // 仅是提示，候选仍须通过当前卡牌的合法性与正收益判断。
    const target=seatTactics.focusIds.length===1?resolvePlayerByKey(seatTactics.focusIds[0],game.players||[]):null;
    return {...empty,focus:target?{target,name:target.name1||target.name||playerKey(target),score:1,
        reason:'连续行动的共同可达目标'}:null,protect,protectList:protect?[protect]:[]};
}

// 延用现有拆顺的 effect/选牌桥；此处只返回可公开确认的防具卡。
export function relayArmorPlan(me,card,target) {
    if(!ownPlayWindow(me))return null;
    const plan=readSeatTactics(me);
    if(!plan?.consecutive||!plan.followupIds.includes(playerKey(target))||sameTeamBySide(me,target)!==false)return null;
    const armor=target.getEquip?.(2),ally=resolvePlayerByKey(plan.allyId,game.players||[]);
    if(!armor||!ally||target.hasSkillTag?.('noe')||target.hasSkillTag?.('loseEquip'))return null;
    if(get.name?.(armor,target)==='baiyin'&&target.hp<target.maxHp)return null;
    if(!Number.isFinite(get.value?.(armor,target))||get.value(armor,target)<=0)return null;
    if(ally.hasSkillTag?.('unequip',false,{name:'sha',target,card:{name:'sha'}})||ally.hasSkillTag?.('unequip_ai',false,{name:'sha',target,card:{name:'sha'}})||target.hasSkillTag?.('unequip2'))return null;
    const name=get.name?.(card,me)||card.name;
    const filter=name==='shunshou'?lib.filter?.canBeGained:lib.filter?.canBeDiscarded;
    if(filter&&!filter(armor,me,target))return null;
    // 宿主 effect 使用 score/5：只补 0.2 的接力机会，不重算整件防具收益。
    return {kind:'relay-armor',card:armor,score:1,allyId:plan.allyId,
        reason:'紧邻队友的公开攻击距离内可拆防具；不保证队友有杀'};
}

export function applyVersusSeatPreferences(me,candidates) {
    if(!ownPlayWindow(me))return candidates;
    const plan=readSeatTactics(me);
    if(!plan)return candidates;
    const hand=me.getCards?.('h')||[]; // 只读当前行动者自己的手牌。
    for(const action of candidates||[]) {
        if(action.type!=='card'||action.recast||action.targetResolved===false||!isCandidateEligible(action)||!Number.isFinite(action.score)||action.score<=0)continue;
        if(!['sha','huosha','leisha','juedou','huogong','lebu','bingliang'].includes(action.id))continue;
        const target=action.targetObj||resolvePlayerByKey(action.target,game.players||[]);
        if(!target||sameTeamBySide(me,target)!==false||Array.isArray(action.target)||action.targetList?.length>1)continue;
        const card=hand.find(c=>(get.name?.(c,me)||c.name)===action.id
            &&(!lib.filter?.cardEnabled||lib.filter.cardEnabled(c,me))
            &&(!lib.filter?.cardUsable||lib.filter.cardUsable(c,me))
            &&me.canUse?.(c,target)===true);
        if(!card)continue;
        const positive=typeof get.effect==='function'&&get.effect(target,card,me,me)>0;
        const preference=seatActionPreference(plan,{id:action.id,targetId:playerKey(target),positive,legal:true});
        if(!preference.delta)continue;
        // 一个动作仅记一个座次来源，不叠加伤害、斩杀或基础救援收益。
        if(applyOwnedUtility(action,'versusSeatTempo',[{dimension:'tempo',delta:preference.delta,
            note:preference.reason,details:{allyId:plan.allyId,enemiesBeforeAlly:plan.enemiesBeforeAlly.length}}])) {
            action.reason=(action.reason||'')+'｜'+preference.reason;
        }
    }
    return candidates;
}
