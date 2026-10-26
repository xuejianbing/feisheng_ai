import {game,get,lib,ui,_status} from '../../../foundation/adapt/host.js?v=41a';
import {versusStrategyEnabled} from '../../../foundation/config/versusSettings.js?v=41a';
import {playerKey} from '../../../foundation/adapt/playerIdentity.js?v=41a';
import {readVersusMode,readVersusState} from '../../../foundation/runtime/versusContext.js?v=41a';
import {aoeAllyRisk} from './aoeRisk.js?v=41a';

export function aoeRiskEnabled() {return readVersusMode().is2v2&&!!versusStrategyEnabled('versusSeatProtection');}

// 这是当前存活座次环，供标准牌的座次结算排序使用，不是下一行动者预测。
function targetOrders(me,targets,state) {
    if(_status.currentPhase!==me||!state.seatReady)return null;
    const index=state.seatOrder.indexOf(playerKey(me));
    if(index<0)return null;
    // sortBySeat 使用座次，不借用可能因技能而变化的常规行动环。
    const forward=[...state.seatOrder.slice(index+1),...state.seatOrder.slice(0,index)];
    const ids=new Set(targets.map(row=>row.id));
    const order=forward.filter(id=>ids.has(id));
    return order.length===ids.size?{counterclockwise:order,clockwise:[...order].reverse()}:null;
}

export function readAoeTeamRisk(me,cardId,impacts,{card=null,targets=null}={}) {
    if(!['nanman','wanjian'].includes(cardId)||!aoeRiskEnabled())return null;
    const state=readVersusState(me);
    if(!state?.teamsReady)return null;
    const byId=new Map((game.players||[]).map(p=>[playerKey(p),p]));
    // 仅己方这一名决策者的实体桃；不读取队友或敌方手牌，不预支转化技。
    const excluded=new Set([...(card?.cards||[]),...(ui.selected?.cards||[])]);
    let hand=[];
    try {hand=(me.getCards?.('h')||[]).filter(c=>c!==card&&!excluded.has(c)&&(get.name?.(c,me)||c.name)==='tao');}catch(_){}
    const rows=impacts.map(row=>{
        const target=byId.get(row.id);
        let tao=0;
        if(row.relation==='ally'&&target&&typeof lib.filter?.cardSavable==='function') {
            for(const peach of hand)try {if(lib.filter.cardSavable(peach,me,target)===true)tao++;}catch(_){}
        }
        return {...row,hujia:Math.max(0,Number(target?.hujia)||0),ownSavableTao:tao};
    });
    const orders=targetOrders(me,rows,state);
    const meta=lib.card?.[cardId];
    // contentBefore 可重排目标；不假定自定义牌流程也沿用标准 reverseOrder。
    const selectable=!!orders&&meta?.reverseOrder===true&&!meta.contentBefore;
    const assess=order=>aoeAllyRisk({targets:rows,order,enemyIds:state.enemyIds,reserve:state.reserve});
    const base=assess([]);
    let directions=null;
    if(selectable) {
        const affected=targets?new Set(targets.map(playerKey)):null;
        const filtered=order=>affected?order.filter(id=>affected.has(id)):order;
        directions={counterclockwise:assess(filtered(orders.counterclockwise)),clockwise:assess(filtered(orders.clockwise))};
    }
    return {...base,orderStatus:selectable?'direction-unselected':'order-unverified',directions,
        reserve:state.reserve,heuristic:true};
}
