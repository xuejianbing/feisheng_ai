import {game,get,lib,_status} from '../../../foundation/adapt/host.js?v=41a';
import {aoeValue} from '../../timing/aoeTiming.js?v=41a';
import {aoeRiskEnabled} from './aoeRiskRuntime.js?v=41a';
import {cooperativeTrickEpoch} from '../../state/cooperativeTrickIntent.js?v=41a';

// 标准 reverseOrder 事件：顺时针反转座次排序，逆时针保留原序。
// 不设置真实 targets，不修改玩家选择，只向宿主现有 chooseControl 提供 AI 回调。
export function aoeDirectionChoice(player,parent) {
    const id=get.name?.(parent?.card,player)||parent?.card?.name;
    if(!['nanman','wanjian'].includes(id)||parent?.name!==id+'ContentBefore'||parent.player!==player||
        !Array.isArray(parent.targets)||parent.targets.length<2||!aoeRiskEnabled())return null;
    const risk=aoeValue(player,id,{card:parent.card,targets:parent.targets})?.teamRisk;
    const directions=risk?.directions;
    if(!directions||risk.extraImpact<=0)return null;
    // 只有“全部剩余敌方可能先结算完”才改变方向；不把一血当确定击杀。
    if(directions.clockwise.earlyFinishPossible===directions.counterclockwise.earlyFinishPossible)return null;
    return directions.clockwise.earlyFinishPossible?'顺时针':'逆时针';
}

export function installAoeDirectionBridge() {
    const proto=lib.element?.Player?.prototype,original=proto?.chooseControl;
    if(typeof original!=='function')return ()=>{};
    let active=true;
    const wrapped=function(...args) {
        const result=original.apply(this,args),player=this;
        if(!result||typeof result!=='object'||!args.includes('顺时针')||!args.includes('逆时针'))return result;
        const native=result.ai,parent=result.parent||_status.event,epoch=cooperativeTrickEpoch();
        result.ai=function(...rest) {
            try {
                if(active&&epoch===cooperativeTrickEpoch()&&!result.finished&&!parent?.finished&&
                    !(player===game.me&&!_status.auto)&&!player.isOnline2?.()) {
                    const direction=aoeDirectionChoice(player,parent);if(direction)return direction;
                }
            }catch(_){}
            return typeof native==='function'?native.apply(this,rest):native;
        };
        return result;
    };
    proto.chooseControl=wrapped;
    return ()=>{active=false;if(proto.chooseControl===wrapped)proto.chooseControl=original;};
}
