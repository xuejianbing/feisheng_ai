import {game,get,lib,_status} from '../adapt/host.js?v=41a';
import {playerKey} from '../adapt/playerIdentity.js?v=41a';
import {isVersus2v2} from '../../decision/modes/versus/team.js?v=41a';
import {resolveVersusState,versusRules} from '../../decision/modes/versus/context.js?v=41a';

export function readVersusMode() {
    let mode='unknown';
    try { mode=get.mode?.()||'unknown'; } catch (_) {}
    if(mode!=='versus')return {mode,submode:'unknown',is2v2:false,connect:false};
    const connect=!!_status.connectMode;
    let submode=_status.mode;
    if(!submode)try { submode=connect?lib.configOL?.versus_mode:get.config?.('versus_mode'); } catch (_) {}
    // 自定义乱斗不自动启用普通 2v2 规则接入；纯标识判定函数仍保持严格原契约。
    return {mode,submode:submode||'unknown',connect,is2v2:!_status.brawl&&isVersus2v2(mode,submode)};
}

export function readVersusSettings(info=readVersusMode()) {
    const settings={};
    for(const key of ['replace_character_two','replace_handcard_two','replace_handcard','olfeiyang_four','two_assign','two_phaseswap','double_character','double_hp']) {
        try { settings[key]=info.connect?lib.configOL?.[key]:get.config?.(key); } catch (_) {}
    }
    // 选将后宿主公开的替补模式开关优先于菜单配置；不读取任何替补武将。
    if(!info.connect&&info.submode==='two'&&typeof _status.replacetwo==='boolean') {
        settings.replace_character_two=_status.replacetwo;
    }
    return settings;
}

export function readVersusRules(info=readVersusMode()) {
    return versusRules(readVersusSettings(info),info.connect);
}

export function readVersusState(observer=game.me,info=readVersusMode()) {
    if(!info.is2v2)return null;
    const players=[...new Set([...(game.players||[]),...(game.dead||[])])];
    const dead=new Set(game.dead||[]);
    // 新投影、无缓存：死亡/复活/换位/当前回合变化在下一次读取立即反映。
    const rows=players.map(p=>({id:playerKey(p),side:p.side,
        alive:!dead.has(p)&&p.alive!==false,
        nextSeatId:playerKey(p.nextSeat),nextId:playerKey(p.next)}));
    return resolveVersusState({players:rows,observerId:playerKey(observer),
        firstActorId:playerKey(_status.firstAct),currentActorId:playerKey(_status.currentPhase),
        reserve:readVersusRules(info).reserve});
}
