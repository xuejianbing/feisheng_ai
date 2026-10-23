import {ai,game,get,lib,ui,_status} from '../../../foundation/adapt/host.js?v=41a';
import {readVersusMode} from '../../../foundation/runtime/versusContext.js?v=41a';
import {evaluateVersusAttack} from './lethal.js?v=41a';
import {cooperativeTrickEpoch} from '../../state/cooperativeTrickIntent.js?v=41a';

const MARK=Symbol('versus-attack-choice');
function single(value){
    const range=typeof get.select==='function'?get.select(value):value;
    return Array.isArray(range)&&range[0]===1&&range[1]===1;
}
function windowFor(event,player) {
    try {
    if(!readVersusMode().is2v2||!player||event?.player!==player||event.finished||
        event.name!=='chooseToUse'||event.type!=='phase'||event.forced||event.skill||event.respondTo||event.complexCard||event.complexTarget||
        _status.currentPhase!==player||player===game.me&&!_status.auto||player.isOnline2?.()===true||
        !single(event.selectCard))return false;
    const parent=event.parent||event.getParent?.();
    return parent?.name==='phaseUse'&&parent.player===player&&!parent.finished;
    }catch(_){return false;}
}
function supported(card,player){return card&&typeof card==='object'&&['sha','huosha','leisha','juedou'].includes(get.name?.(card,player)||card.name);}
function cardAllowed(event,card,player){
    return typeof event.filterCard==='function'&&!!event.filterCard(card,player,event);
}
function targetAllowed(event,card,player,target){
    // 只接入明确的单目标普通用牌，不能把技能改变的多目标需求缩成一个目标。
    const info=get.info?.(card)||{};
    let select=event.selectTarget;
    if(select===undefined||select===lib.filter?.selectTarget) {
        // 宿主默认selectTarget从已选牌取信息；选牌阶段必须使用正在评分的实体牌。
        const range=get.select?.(info.selectTarget??1)??info.selectTarget;
        if(!Array.isArray(range))return false;
        select=[...range];
        game.checkMod?.(card,player,select,'selectTarget',player);
    }else if(typeof select==='function'&&!(ui.selected?.cards?.length===1&&ui.selected.cards[0]===card))return false;
    if(info.multitarget||!single(select)||(ui.selected?.targets?.length||0)>1)return false;
    return typeof event.filterTarget==='function'&&!!event.filterTarget(card,player,target);
}

export function attackChoiceValue(player,card,event=_status.event,target=null) {
    try {
        if(!windowFor(event,player)||!supported(card,player)||!cardAllowed(event,card,player))return null;
        const hand=player.getCards?.('h')||[];
        if(!hand.includes(card))return null;
        const options=[];
        for(const candidate of target?[target]:game.players||[]) {
            if(!targetAllowed(event,card,player,candidate))continue;
            const plan=evaluateVersusAttack(player,card,candidate);
            if(plan?.resolved&&plan.legal)options.push(plan.evaluation.score);
            else if(plan?.resolved===false)return null;
        }
        // 无合法敌方目标时沿用宿主；不猜测技能正收益或友方用牌用途。
        return options.length?Math.max(...options):null;
    }catch(_){return null;}
}

// 包住宿主实际执行的check，避免后续设置ai1/ai2或技能递归覆盖最初回调。
export function installAttackChoiceBridge() {
    const basic=ai?.basic;
    if(!basic)return ()=>{};
    let active=true;
    const restores=[];
    for(const name of ['chooseCard','chooseTarget']) {
        const native=basic[name];if(typeof native!=='function')continue;
        const wrapped=function(check,...args) {
            const event=_status.event,player=event?.player,epoch=cooperativeTrickEpoch();
            if(typeof check!=='function'||!windowFor(event,player)||check[MARK]?.event===event)
                return native.call(this,check,...args);
            const original=check[MARK]?.original||check;
            let scoring=false;
            const score=function(item,...rest) {
                const value=original.call(this,item,...rest);
                if(scoring||!active||!Number.isFinite(value)||value<=0||_status.event!==event||
                    epoch!==cooperativeTrickEpoch()||!windowFor(event,player))return value;
                scoring=true;
                try {
                    const selected=ui.selected?.cards||[];
                    const card=name==='chooseCard'?item:selected.length===1?selected[0]:null;
                    if(name==='chooseCard'&&selected.some(c=>c!==card))return value;
                    const result=attackChoiceValue(player,card,event,name==='chooseTarget'?item:null);
                    // 不抬高原生否决；支持的正分候选按同一实际攻击估值排序。
                    return Number.isFinite(result)?result>0?result:-1:value;
                }finally{scoring=false;}
            };
            score[MARK]={event,original};
            return native.call(this,score,...args);
        };
        basic[name]=wrapped;
        restores.push(()=>{if(basic[name]===wrapped)basic[name]=native;});
    }
    return ()=>{active=false;for(const restore of restores.reverse())restore();};
}
