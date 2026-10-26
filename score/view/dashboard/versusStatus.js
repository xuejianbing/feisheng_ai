import {cfg} from '../../foundation/config/util.js?v=41a';
import {readVersusMode} from '../../foundation/runtime/versusContext.js?v=41a';
import {versusStrategyEnabled} from '../../foundation/config/versusSettings.js?v=41a';
import {openStateCardPanel} from './stateCards.js?v=41a';

export function versusStatus() {
    const mode=readVersusMode();
    const applicable=mode.is2v2;
    const state=part=>!cfg('versusStrategy',true)?'总开关已关闭':
        !cfg('tacticalOptimization',true)?'通用打法优化已关闭':
        !cfg(part,true)?'已关闭':!applicable?'当前模式不适用':'已启用';
    return {applicable,seatEnabled:applicable&&versusStrategyEnabled('versusSeatProtection'),
        reserveEnabled:applicable&&versusStrategyEnabled('versusReserve'),cards:[
            {label:'当前模式',value:applicable?(mode.connect?'联机2v2':'欢乐2v2'):'当前模式不适用'},
            {label:'座次配合与队友保护',value:state('versusSeatProtection')},
            {label:'关键牌保留',value:state('versusReserve')},
        ]};
}

export function openVersusStatus() {
    return openStateCardPanel('2v2专项状态',versusStatus().cards,
        '<p>适用于欢乐2v2及联机2v2。设置修改后立即用于后续判断，已经开始的选择不保证重新评分。</p>'+
        '<p>座次配合与队友保护：座次机会、接力拆甲及群体牌队友风险。</p>'+
        '<p>关键牌保留：桃、闪、无懈及主动技能材料的保留。</p>'+
        '<p>基础阵营、合法目标与伤害判断始终生效。</p>');
}
