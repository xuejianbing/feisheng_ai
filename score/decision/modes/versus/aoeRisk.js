// 公开局势的有界风险估计；不把一血、空手或自己有桃解释成确定死亡/确定获救。
export function aoeAllyRisk({targets=[],order=[],enemyIds=[],reserve='unknown'}={}) {
    let casualtyRisk=0,rescueCost=0;
    const allies=[];
    for(const target of targets) {
        if(target.relation!=='ally'||!Number.isFinite(target.hp)||target.hp<=0)continue;
        const hit=Math.max(0,Math.min(1,Number(target.hitProbability)||0));
        const damage=Math.max(0,1-Math.max(0,Number(target.hujia)||0));
        const healing=Math.max(0,Math.ceil(1-(target.hp-damage)));
        if(!healing||!hit)continue;
        const tao=Math.max(0,Math.floor(Number(target.ownSavableTao)||0));
        const covered=tao>=healing;
        // 有普通桃仍保留一半额外风险：转化、禁救、增伤与后续触发不作确定性模拟。
        const casualty=2*hit*(covered ? .5 : 1);
        const rescue=.35*hit*Math.min(healing,tao);
        casualtyRisk+=casualty;rescueCost+=rescue;
        const index=order.indexOf(target.id);
        const earlier=enemyIds.length>0&&index>=0&&enemyIds.every(id=>{
            const enemy=targets.find(row=>row.id===id&&row.relation==='enemy');
            const pos=order.indexOf(id);
            return pos>=0&&pos<index&&enemy&&enemy.hp>0&&enemy.hp<=1&&
                !(enemy.hujia>0)&&enemy.hitProbability>0;
        });
        allies.push({id:target.id,hitProbability:hit,requiredHealing:healing,ownSavableTao:tao,
            ordinaryRescueCovered:covered,casualtyRisk:casualty,rescueCost:rescue,
            // 仅用于方向选择的机会提示，不加胜利分，也不抵扣队友风险。
            earlyFinishPossible:reserve===false&&earlier});
    }
    return {extraImpact:casualtyRisk+rescueCost,casualtyRisk,rescueCost,allies,
        earlyFinishPossible:allies.length>0&&allies.every(row=>row.earlyFinishPossible)};
}
