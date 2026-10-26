/* 公开队伍与模式判定：无宿主依赖。null 仅表示异常输入，不是 2v2 身份状态。 */
export function hasKnownSide(player) {
    return player != null && player.side !== undefined && player.side !== null && player.side !== '';
}

export function sameTeamBySide(a, b) {
    return hasKnownSide(a) && hasKnownSide(b) ? a.side === b.side : null;
}

export function isVersus2v2(mode, submode) {
    return mode === 'versus' && (submode === 'two' || submode === '2v2');
}
