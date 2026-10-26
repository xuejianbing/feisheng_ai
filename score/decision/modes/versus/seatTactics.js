// 纯函数：reach 仅表示公开攻击可达性，不表示拥有杀或保证击杀。
export function buildSeatTactics(state, players, reach) {
    if(!state?.teamsReady || state.currentActorId!==state.observerId || state.normalTurnOrder[0]!==state.observerId)return null;
    const me=state.observerId,allies=state.allyIds.filter(id=>id!==me);
    if(allies.length!==1)return null;
    const allyId=allies[0],order=state.normalTurnOrder,allyIndex=order.indexOf(allyId);
    if(allyIndex<1)return null;
    const ally=players.find(p=>p.id===allyId);
    if(!ally)return null;
    const enemiesBeforeAlly=order.slice(1,allyIndex).filter(id=>state.enemyIds.includes(id));
    const threatsBeforeAlly=enemiesBeforeAlly.filter(id=>players.find(p=>p.id===id)?.turnSkipped!==true&&reach(id,allyId));
    const consecutive=allyIndex===1&&ally.turnSkipped!==true&&ally.playSkipped!==true&&ally.hp>0;
    return {schema:'versus-seat-tactics-v1',observerId:me,allyId,consecutive,
        enemiesBeforeAlly,threatsBeforeAlly,
        allyHp:ally.hp,allyInDanger:Number.isFinite(ally.hp)&&ally.hp<=2&&threatsBeforeAlly.length>0,
        // 只给能共同到达的目标提供接力提示，不加低血量/击杀收益。
        focusIds:consecutive?state.enemyIds.filter(id=>reach(me,id)&&reach(allyId,id)):[],
        followupIds:consecutive?state.enemyIds.filter(id=>reach(allyId,id)):[],
        orderKind:'normal-cycle-opportunity',
    };
}

export function seatActionPreference(plan,{id,targetId,positive=false,legal=false,relayStrip=false}={}) {
    if(!plan||!positive||!legal)return {delta:0,reason:null};
    // 拆顺接力由宿主 effect 和实际选牌桥结算，此处不再重复加分。
    if(relayStrip||id==='guohe'||id==='shunshou')return {delta:0,reason:null};
    const attack=['sha','huosha','leisha','juedou','huogong'].includes(id);
    const control=['lebu','bingliang'].includes(id);
    if(plan.allyInDanger&&plan.threatsBeforeAlly.includes(targetId)&&control)
        return {delta:Math.min(.3,.15*plan.threatsBeforeAlly.length),reason:'压制队友行动前的可达敌人'};
    if(plan.consecutive&&plan.focusIds.includes(targetId)&&attack)
        return {delta:.15,reason:'紧邻队友具备公开攻击距离，可接力但不保证有牌'};
    return {delta:0,reason:null};
}
