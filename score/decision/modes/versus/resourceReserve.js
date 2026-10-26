// 纯函数：仅根据公开的行动机会与当前玩家自己的资源判断保留压力。
// 暴露于攻击距离不是伤害概率；不猜测他人的桃、杀、无懈。
export function resourceReserve({id,count=0,selfHp,allyHp=null,selfThreats=0,allyThreats=0}={}) {
    if(count!==1||!['tao','shan','wuxie'].includes(id))return {factor:1,discardPremium:0,reason:null};
    const selfDanger=Number.isFinite(selfHp)&&selfHp>0&&selfHp<=2&&selfThreats>0;
    const allyDanger=Number.isFinite(allyHp)&&allyHp>0&&allyHp<=2&&allyThreats>0;
    if(id==='tao'&&Number.isFinite(selfHp)&&selfHp<=1)
        return {factor:1,discardPremium:selfHp>0?2:0,reason:'自己低血时不新增用桃成本，弃牌仍优先保留'};
    const needed=id==='shan'?selfDanger:id==='tao'?selfDanger||allyDanger:selfDanger||allyDanger;
    if(!needed)return {factor:1,discardPremium:0,reason:null};
    const reasons={tao:'最后一张桃保留救援机会',shan:'最后一张闪保留自身防守机会',wuxie:'最后一张无懈保留队伍响应机会'};
    return {factor:1.4,discardPremium:2,reason:reasons[id]};
}
