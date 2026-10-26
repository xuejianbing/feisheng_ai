import {ai,game,get,lib,ui,_status} from '../../../foundation/adapt/host.js?v=41a';
import {cfg} from '../../../foundation/config/util.js?v=41a';
import {versusStrategyEnabled} from '../../../foundation/config/versusSettings.js?v=41a';
import {readVersusMode} from '../../../foundation/runtime/versusContext.js?v=41a';
import {readResourceReserve} from './resourceReserveRuntime.js?v=41a';
import {cooperativeTrickEpoch} from '../../state/cooperativeTrickIntent.js?v=41a';

const WRAPPED=Symbol('versus-material-reserve');
function activeSkill(info) {
    const seen=new Set();
    while(info&&!seen.has(info)&&seen.size<8) {
        seen.add(info);
        if(info.enable==='phaseUse'||info.enable==='chooseToUse'||
            Array.isArray(info.enable)&&info.enable.some(value=>value==='phaseUse'||value==='chooseToUse'))return true;
        // 宿主 chooseButton.backup 常只保留 sourceSkill，没有自己的 enable。
        info=lib.skill?.[info.sourceSkill];
    }
    return false;
}
const parentOf=event=>event.parent||event.getParent?.();
function urgentRecovery(player,info) {
    if(!(player.hp<=1))return false;
    const view=typeof info.viewAs==='string'?info.viewAs:info.viewAs?.name;
    const recover=info.ai?.tag?.recover;
    // 目标可能尚未选择；一血时不先用材料惩罚阻挡宿主声明的回复机会。
    return view==='tao'||typeof recover==='function'||Number.isFinite(recover)&&recover>0;
}

// 只允许明确的主动出牌/技能付费链。技能内部的响应、救援或强制用牌不借用 phaseUse 祖先。
function phaseParent(event,player,skill=null) {
    const seen=new Set();
    for(let i=0;event&&i<16&&!seen.has(event);i++,event=parentOf(event)) {
        seen.add(event);
        if(event.finished||event.player&&event.player!==player)return false;
        if(event.name==='phaseUse')return event.player===player;
        if(event.name==='chooseToUse'&&event.type==='phase'&&!event.forced)continue;
        if(skill&&event.name==='useSkill'&&event.skill===skill)continue;
        return false;
    }
    return false;
}

export function materialReserveContext(player,event=_status.event) {
    if(!player||event?.player!==player||event.finished||_status.currentPhase!==player||
        !readVersusMode().is2v2||!versusStrategyEnabled('versusReserve'))return null;
    if(event.name==='chooseToUse') {
        const skill=event.skill,info=lib.skill?.[skill];
        if(event.type!=='phase'||event.forced||!activeSkill(info)||info.forced||!info.filterCard||
            !phaseParent(parentOf(event),player))return null;
        // 动态 viewAs 的用途可能随材料改变，保留宿主判断，不猜测是否正用于急救。
        if(typeof info.viewAs==='function')return null;
        const view=typeof info.viewAs==='string'?info.viewAs:info.viewAs?.name;
        if(urgentRecovery(player,info))return null;
        // 纯主动出牌技能若没有 viewAs，只有宿主明确声明会弃牌/失去材料时才计成本。
        // 未声明的 filterCard 可能只是限定选择范围，不能据此推断材料会被消耗。
        if(!info.viewAs&&info.discard!==true&&info.lose!==true)return null;
        return {skill,kind:view?'conversion':'active-skill-cost',forced:false};
    }
    if(!['chooseToDiscard','chooseCard','chooseCardTarget'].includes(event.name))return null;
    // chooseCard 本身不消费牌；只有宿主明确标记消耗时才接管，不能把展示牌当代价。
    if(event.name!=='chooseToDiscard'&&event.discard!==true&&event.lose!==true)return null;
    const root=parentOf(event);
    const skill=root?.name==='useSkill'?root.skill:root?.skill&&root.name===root.skill+'_cost'?root.skill:root?.name;
    const info=lib.skill?.[skill];
    if(root?.player!==player||root.finished||!activeSkill(info)||info.trigger||info.forced||
        !phaseParent(parentOf(root),player,skill))return null;
    if(urgentRecovery(player,info))return null;
    return {skill,kind:'active-skill-payment',forced:!!event.forced};
}

export function versusMaterialReserve(player,card,event=_status.event) {
    const context=materialReserveContext(player,event);
    if(!context||!card||typeof card!=='object')return {premium:0,reason:null};
    const selected=ui.selected?.cards||[];
    const id=get.name?.(card,player)||card.name;
    // 宿主最终复核已选集合时，同名资源耗尽只让最后选入的一张承担一次保留压力。
    if(selected.includes(card)&&selected.filter(c=>(get.name?.(c,player)||c.name)===id).at(-1)!==card)
        return {premium:0,reason:null};
    const reserve=readResourceReserve(player,card,{selected:selected.filter(c=>c!==card)});
    return {premium:reserve.discardPremium||0,reason:reserve.reason,skill:context.skill,kind:context.kind,forced:context.forced};
}

export function installMaterialReserveBridge() {
    const basic=ai?.basic,native=basic?.chooseCard;
    if(typeof native!=='function')return ()=>{};
    let active=true;
    const controlled=player=>player===game.me&&!_status.auto||player.isOnline2?.()===true;
    const wrapped=function(check,...args) {
        const event=_status.event,player=event?.player,epoch=cooperativeTrickEpoch();
        let context;
        try {context=active&&player&&!controlled(player)&&materialReserveContext(player,event);}catch(_){}
        if(!context||typeof check!=='function')return native.call(this,check,...args);
        if(check[WRAPPED]?.event===event)return native.call(this,check,...args);
        const original=check[WRAPPED]?.original||check;
        const score=function(card,...rest) {
            const value=original.call(this,card,...rest);
            if(!Number.isFinite(value)||!active||epoch!==cooperativeTrickEpoch()||_status.event!==event)return value;
            try {
                if(controlled(player))return value;
                const reserve=versusMaterialReserve(player,card,event);
                // 只补2v2的额外保留压力，不重算牌价或整份机会成本。
                // 已提交的强制付费保留正分，避免用评分破坏必须完成的选择。
                const premium=reserve.forced&&value>0?Math.min(reserve.premium,value*.5):reserve.premium;
                return value-premium;
            }catch(_){return value;}
        };
        score[WRAPPED]={event,original};
        return native.call(this,score,...args);
    };
    basic.chooseCard=wrapped;
    return ()=>{active=false;if(basic.chooseCard===wrapped)basic.chooseCard=native;};
}
