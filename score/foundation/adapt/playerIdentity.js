/* ================= 玩家运行时身份契约 =================
 * 决策链内部以 playerid 作为唯一主键；未分配ID的对象使用会话临时键。
 * 武将名只用于显示和唯一旧别名解析，不能作为缓存主键。
 */

const temporaryKeys = new WeakMap();
let temporarySequence = 0;

function _text(v) {
	if (v === undefined || v === null) return '';
	const s = String(v);
	return s ? s : '';
}

export function playerKey(player) {
	if (!player) return null;
	const runtimeId = _text(player.playerid);
	if (runtimeId) return runtimeId;
	if (typeof player !== 'object') return null;
	if (!temporaryKeys.has(player)) temporaryKeys.set(player, 'anon_player_' + (++temporarySequence));
	return temporaryKeys.get(player);
}

export function playerDisplayName(player) {
	if (!player) return '?';
	return _text(player.name1) || _text(player.name) || _text(player.name2) || playerKey(player) || '?';
}

function _legacyAliases(player) {
	const out = [];
	for (const v of [player && player.name1, player && player.name, player && player.name2]) {
		const s = _text(v);
		if (s && out.indexOf(s) < 0) out.push(s);
	}
	return out;
}

/* 解析顺序：
 * 1. playerid 精确命中；
 * 2. 旧武将名只有唯一匹配时才兼容；
 * 3. 同名产生歧义时返回 null，禁止默认取第一个。 */
export function resolvePlayerByKey(key, players) {
	if (!key) return null;
	if (typeof key === 'object') return key;
	const wanted = _text(key);
	const list = Array.isArray(players) ? players : [];

	for (const p of list) {
		if (!p) continue;
		const runtimeId = _text(p.playerid);
		if ((runtimeId && runtimeId === wanted) || playerKey(p) === wanted) return p;
	}

	const legacy = [];
	for (const p of list) {
		if (!p) continue;
		if (_legacyAliases(p).indexOf(wanted) >= 0) legacy.push(p);
	}
	return legacy.length === 1 ? legacy[0] : null;
}

export function samePlayerEntity(a, b) {
	if (!a || !b) return false;
	if (a === b) return true;
	const ak = playerKey(a);
	const bk = playerKey(b);
	return ak != null && bk != null && ak === bk;
}

export default {
	playerKey,
	playerDisplayName,
	resolvePlayerByKey,
	samePlayerEntity,
};
