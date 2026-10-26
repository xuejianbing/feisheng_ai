import {game,get,ui} from '../../../foundation/adapt/host.js?v=41a';
import {versusStrategyEnabled} from '../../../foundation/config/versusSettings.js?v=41a';
import {playerKey} from '../../../foundation/adapt/playerIdentity.js?v=41a';
import {readVersusMode,readVersusState} from '../../../foundation/runtime/versusContext.js?v=41a';
import {publicAttackReach,ownPlayWindow} from './seatTacticsRuntime.js?v=41a';
import {resourceReserve} from './resourceReserve.js?v=41a';

export function readResourceReserve(player,card,{selected=[]}={}) {
    const empty={factor:1,discardPremium:0,reason:null};
    if(!player||!card||!readVersusMode().is2v2||!versusStrategyEnabled('versusReserve'))return empty;
    const id=get.name?.(card,player)||card.name;
    if(!['tao','shan','wuxie'].includes(id))return empty;
    const state=readVersusState(player),ownId=playerKey(player);
    if(!state?.teamsReady||state.currentActorId!==ownId||state.normalTurnOrder[0]!==ownId)return empty;
    const hand=player.getCards?.('h')||[];
    if(!hand.includes(card)||selected.includes(card))return empty;
    const count=hand.filter(c=>!selected.includes(c)&&(get.name?.(c,player)||c.name)===id).length;
    if(count!==1)return empty;
    const byId=new Map((game.players||[]).map(p=>[playerKey(p),p]));
    const allyId=state.allyIds.find(key=>key!==ownId),ally=byId.get(allyId);
    const order=state.normalTurnOrder.slice(1),allyIndex=order.indexOf(allyId);
    const beforeAlly=allyIndex>=0?order.slice(0,allyIndex):[];
    const threats=(ids,target)=>ids.filter(key=>{
        const enemy=byId.get(key);
        return state.enemyIds.includes(key)&&enemy?.isTurnedOver?.()!==true&&publicAttackReach(enemy,target);
    }).length;
    const result=resourceReserve({id,count,selfHp:player.hp,allyHp:ally?.hp,
        selfThreats:threats(order,player),allyThreats:threats(beforeAlly,ally)});
    return {...result,id,count,allyId:allyId||null};
}

export function versusConsumptionReserve(player,card,baseCost) {
    if(!ownPlayWindow(player)||!Number.isFinite(baseCost))return {cost:0,reason:null};
    if(!readVersusMode().is2v2||!versusStrategyEnabled('versusReserve'))return {cost:0,reason:null};
    if(typeof card==='string'&&!['tao','shan','wuxie'].includes(card))return {cost:0,reason:null};
    if(typeof card==='string')card=(player.getCards?.('h')||[]).find(c=>(get.name?.(c,player)||c.name)===card);
    const reserve=readResourceReserve(player,card);
    // 替代同一张牌的基础成本估计，与其它保留/预测估计取 max，不再叠加扣分。
    return {cost:reserve.factor>1?Math.min(baseCost*reserve.factor,baseCost+.6):0,reason:reserve.reason};
}

function ownDiscardWindow(player,event) {
    for(let i=0;event&&i<16;i++) {
        if(event.name==='phaseDiscard')return event.player===player;
        event=event.parent||event.getParent?.();
    }
    return false;
}

export function versusDiscardPremium(player,card,event) {
    if(!ownDiscardWindow(player,event))return 0;
    return readResourceReserve(player,card,{selected:ui.selected?.cards||[]}).discardPremium;
}

// 只从当前救援事件及其祖先取明确目标，不把任意受伤玩家或上一轮状态当成濒死请求。
export function dyingTargetForEvent(event) {
    for(let i=0;event&&i<16;i++) {
        if(event.dying&&typeof event.dying==='object'&&!Array.isArray(event.dying))return event.dying;
        if(event.name==='dying'&&event.player)return event.player;
        event=event.parent||event.getParent?.();
    }
    return null;
}

export function taoRescueFacts(player,target) {
    const hp=Number.isFinite(target?.hp)?target.hp:null;
    const requiredHealing=hp===null?null:Math.max(0,Math.ceil(1-hp));
    let ownPhysicalTaoCount=null;
    try {
        if(typeof player?.getCards==='function')ownPhysicalTaoCount=player.getCards('h')
            .filter(c=>(get.name?.(c,player)||c.name)==='tao').length;
    } catch (_) {}
    return {requiredHealing,ownPhysicalTaoCount,
        // 这只是普通桃的资源事实，不表示技能/其他救援者无能为力，也不用于否决。
        ordinaryTaoShortfall:requiredHealing!==null&&ownPhysicalTaoCount!==null?Math.max(0,requiredHealing-ownPhysicalTaoCount):null,
        permissionOnly:true};
}
