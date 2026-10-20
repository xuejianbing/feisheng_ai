import {hasKnownSide, sameTeamBySide} from './team.js?v=41a';

// 只接收公开字段投影。配置缺失保留 unknown，不伪装成关闭。
export function versusRules(settings={}, connect=false) {
    const flag = key => typeof settings[key] === 'boolean' ? settings[key] : 'unknown';
    return {
        connect,
        reserve: connect ? false : flag('replace_character_two'),
        fourthSeatExtraCard: flag(connect ? 'replace_handcard' : 'replace_handcard_two'),
        fourthSeatFeiyang: flag('olfeiyang_four'),
        assignTeammate: connect ? false : flag('two_assign'),
        controlTeammate: connect ? false : flag('two_phaseswap'),
        doubleCharacter: flag('double_character'),
        doubleHp: settings.double_hp ?? 'unknown',
    };
}

function cycle(rows, startId, link) {
    const map = new Map(rows.map(p=>[p.id,p]));
    const order=[];
    let id=startId;
    while (map.has(id) && !order.includes(id)) {
        order.push(id);
        id=map.get(id)[link];
    }
    return order.length === rows.length && id === startId ? order : [];
}

// nextSeatId 是座次环；nextId 是宿主当前存活角色的常规行动环。
// 不读取武将名、手牌、身份或替补武将，不预测插入回合和技能改序。
export function resolveVersusState({players=[],observerId=null,firstActorId=null,currentActorId=null,reserve='unknown'}={}) {
    const rows=players.filter(Boolean);
    const alive=rows.filter(p=>p.alive!==false);
    const issues=[];
    const ids=rows.map(p=>p.id);
    const idsReady=ids.every(Boolean)&&new Set(ids).size===ids.length;
    const sides=new Map();
    for(const p of rows)if(hasKnownSide(p))sides.set(p.side,(sides.get(p.side)||0)+1);
    const observer=rows.find(p=>p.id===observerId);
    const teamsReady=idsReady&&rows.length===4&&rows.every(hasKnownSide)&&sides.size===2&&[...sides.values()].every(n=>n===2);
    if(!idsReady)issues.push('player-id-incomplete');
    if(!teamsReady)issues.push('public-team-setup-incomplete');
    const seatOrder=idsReady ? cycle(rows,firstActorId,'nextSeatId') : [];
    if(!seatOrder.length)issues.push('seat-ring-incomplete');
    const current=alive.find(p=>p.id===currentActorId);
    const start=current?.id || seatOrder.find(id=>alive.some(p=>p.id===id));
    const normalTurnOrder=idsReady&&alive.length ? cycle(alive,start,'nextId') : [];
    if(alive.length&&!normalTurnOrder.length)issues.push('normal-turn-ring-incomplete');
    const allies=teamsReady&&observer ? alive.filter(p=>sameTeamBySide(observer,p)===true).map(p=>p.id) : [];
    const enemies=teamsReady&&observer ? alive.filter(p=>sameTeamBySide(observer,p)===false).map(p=>p.id) : [];
    const teamSizes=teamsReady ? [...sides.keys()].map(side=>alive.filter(p=>p.side===side).length).sort((a,b)=>b-a) : [];
    return {
        schema:'versus-state-v1',observerId,firstActorId:rows.some(p=>p.id===firstActorId)?firstActorId:null,
        currentActorId:current?.id||null,seatOrder,normalTurnOrder,
        // 仅表示常规后继，不代表额外回合或技能插队后的实际下一行动者。
        nextNormalActorId:current&&normalTurnOrder.length>1?normalTurnOrder[1]:null,
        teamsReady,seatReady:seatOrder.length===4,alive:alive.length,
        allyIds:allies,enemyIds:enemies,
        structure:teamsReady&&observer?`${allies.length}v${enemies.length}`:null,
        teamSizes,
        reduced:teamsReady&&alive.length>0&&alive.length<4&&teamSizes.every(n=>n>0),
        reserve,issues,
    };
}
