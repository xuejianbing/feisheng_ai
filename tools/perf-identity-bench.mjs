// node tools/perf-identity-bench.mjs [--cards N] [--players N] [--mode identity]
// 量化「为什么只有身份局卡顿」：同一真实引擎、同一套桩宿主，只改模式与人数。
// 计时来自引擎自带 profiler 的 decision.* 阶段（bestActionCore 内 _markPhase）。
import {register} from 'node:module';

const arg = (k, d) => {
	const i = process.argv.indexOf('--' + k);
	return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const MODE = arg('mode', '');
const CARDS = Number(arg('cards', 8));
const SEED_ROLES = ['zhu', 'zhong', 'fan', 'fan', 'nei', 'fan', 'zhong', 'fan'];
const CARD_POOL = ['sha', 'shan', 'tao', 'guohe', 'shunshou', 'juedou', 'nanman', 'wanjian', 'wuxie', 'jiedao', 'lebu', 'wuzhong'];
const CARD_DEF = {};
for (const n of CARD_POOL) CARD_DEF[n] = {name: n, type: 'basic', enable: true, usable: 1, targets: 1, ai: {}};

let seq = 0;
function mkCard(name, owner) {
	return {name, suit: ['spade', 'heart', 'club', 'diamond'][seq % 4], number: (seq++ % 13) + 1, owner};
}

class Player {
	constructor(id, role, me) {
		this.playerid = String(id);
		this.name = 'p' + id;
		this.name1 = this.name;
		this.identity = role;
		this.identityShown = (role === 'zhu');
		this.hp = 4; this.maxHp = 4; this.hujia = 0;
		this.sex = 'male';
		this.group = role === 'zhu' || role === 'zhong' ? 'shu' : 'wei';
		this.alive = true;
		this.hand = []; this.equip = []; this.judge = [];
		this.skills = ['wusheng'];
		this.skipList = []; this.turned = false; this.linked = false;
		this._me = me;
	}
	getCards(zone) {
		if (zone === 'h') return this.hand;
		if (zone === 'e') return this.equip;
		if (zone === 'j') return this.judge;
		const out = [];
		for (const ch of String(zone)) {
			if (ch === 'h') out.push(...this.hand);
			else if (ch === 'e') out.push(...this.equip);
			else if (ch === 'j') out.push(...this.judge);
		}
		return out;
	}
	countCards(zone, name) { const cs = this.getCards(zone || 'h'); return name ? cs.filter(c => c && c.name === name).length : cs.length; }
	hasCard(name) { return this.countCards('hes', name) > 0; }
	getSkills() { return this.skills.slice(); }
	hasSkill(s) { return this.skills.includes(s); }
	hasSkillTag() { return false; }
	getStat() { return {}; }
	getEquip() { return null; }
	isLinked() { return this.linked; }
	isTurnedOver() { return this.turned; }
	isAlive() { return this.alive; }
	isDead() { return !this.alive; }
	isFriend() { return false; }
	isOnline2() { return false; }
	canUse() { return true; }
	isMin() { return false; }
	isMax() { return false; }
	chooseToUse(req) { return req; }
	discard() {}
	distanceTo() { return 1; }
	distanceFrom() { return 1; }
	distance() { return 1; }
	getHistory() { return {get: () => [], has: () => false}; }
	countUsed() { return 0; }
	hasJudge() { return false; }
	hasEquip() { return false; }
	addSkill() {}
	removeSkill() {}
	addTempSkill() {}
	markSkill() {}
	unmarkSkill() {}
	hasMark() { return 0; }
	num() { return 0; }
	line() { return ''; }
	skip() {}
	getHp() { return this.hp; }
	loseHp() {}
	recover() {}
	draw() {}
	useCard() { return {name: 'useCard'}; }
	respond() { return {name: 'useCard'}; }
	isUnderControl() { return false; }
}

function buildStub(mode, nPlayers) {
	const roles = SEED_ROLES.slice(0, nPlayers);
	const players = roles.map((r, i) => new Player(i, r, i === 1));
	players.forEach((p, pi) => {
		for (let k = 0; k < CARDS; k++) p.hand.push(mkCard(CARD_POOL[(pi + k) % CARD_POOL.length], p));
	});
	const stub = {
		lib: {
			config: {mode_config: {identity: {identity: [[1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]]}}},
			card: {...CARD_DEF, list: [], cardPile: [], discardPile: []},
			skill: {}, element: {Player}, translate: {}, character: {}, status: {}, video: []
		},
		game: {
			players, dead: [], me: players[1], zhu: players[0], roundNumber: 1,
			players: players, addGlobalSkill() {}, removeGlobalSkill() {}, writeFile() {}, log() {}, checkWin() {}
		},
		get: {
			mode: () => mode,
			name: c => c?.name, suit: c => c?.suit, number: c => c?.number,
			itemtype: p => (p && p.playerid !== undefined ? 'player' : 'card'),
			identityList: () => roles.slice(),
			attitude: (a, b) => {
				const loyal = r => r === 'zhu' || r === 'zhong';
				if (a.identity === 'nei' || b.identity === 'nei') return 0;
				return loyal(a.identity) === loyal(b.identity) ? 4 : -4;
			},
			value: () => 4, damageEffect: () => -1, effect: () => 0,
			skill: () => null, player: () => null, distance: () => 1,
			config: () => undefined, cardCount: () => 0, cardInfo: () => ({}), translation: k => k
		},
		_status: {mode: 'normal', mode2: '', currentPhase: players[1], event: null, roundNumber: 1, auto: true},
		ui: {selected: {cards: [], targets: []}, createDialog() {}, click() {}},
		ai: {get: {}, order: {}, value: {}, result: {}},
		rootURL: '', AI: {}, Get: {}, Game: {}, Library: {}, UI: {}
	};
	globalThis.__NONAME_STUB = stub;
	Object.assign(globalThis, stub);   // 无名杀大量代码直接引用裸全局 lib/game/get/_status
	return {stub, players};
}

const SWALLOWED = new Map();
let SCORING_ERR = false;
globalThis.window = {
	__DJSC: {
		scoringError: e => {
			if (SCORING_ERR) return;
			SCORING_ERR = true;
			console.error('\n=== bestAction 内部异常（首次） ===');
			console.error(e && e.stack ? e.stack : String(e));
		},
		swallow: e => {
			try {
				const k = String((e && e.message) || e).slice(0, 110);
				SWALLOWED.set(k, (SWALLOWED.get(k) || 0) + 1);
			} catch (_) {}
		}
	},
	innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {}, document: null
};
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
register('./noname-stub-loader.mjs', import.meta.url);

const mode = MODE || 'identity';
const nPlayers = mode === 'identity' ? 8 : 3;
const {players} = buildStub(mode, nPlayers);
const engine = await import('../score/decision/engine/engine.js?v=41a');

console.log(`\n=== 场景：${mode} / ${nPlayers} 人 / 每人 ${CARDS} 张手牌 ===`);
const prof = await import('../score/foundation/diag/profiler.js?v=41a');
try { prof.profilerEnable(true); prof.profilerReset(); } catch (_) {}
const snap = () => {
	const out = {};
	try {
		const st = prof.profilerStats();
		for (const p of st.phases || []) out[p.phase] = p.total;
	} catch (_) {}
	return out;
};
const WARM = 3, N = Number(arg('n', 30));
const timeSnap = snap();
const times = [];
for (let i = 0; i < WARM + N; i++) {
	players[0].hujia = (i % 2) + 1;      // 破坏 stateKey 缓存，强制重算
	const t0 = performance.now();
	let ba = null;
	try { ba = engine.bestAction(); } catch (e) { console.error('threw', e); }
	const dt = performance.now() - t0;
	if (i === WARM - 1) {
		console.log('决策样例: ' + JSON.stringify({type: ba && ba.type, id: ba && ba.id, score: ba && Math.round(ba.score || 0), reason: ba && String(ba.reason || '').slice(0, 40)}));
		if (ba && /^评分异常/.test(String(ba.reason))) {
			console.error('引擎内部抛异常，未进入完整评分：' + ba.reason);
			process.exit(2);
		}
	}
	if (i >= WARM) times.push(dt);
}
times.sort((a, b) => a - b);
const sum = times.reduce((s, v) => s + v, 0);
console.log(`单次决策：平均 ${(sum / times.length).toFixed(2)}ms  p50 ${times[Math.floor(times.length / 2)].toFixed(2)}ms  p95 ${times[Math.floor(times.length * 0.95)].toFixed(2)}ms  max ${times[times.length - 1].toFixed(2)}ms`);
const after = snap();
const rows = Object.keys(after).map(k => [k, (after[k] || 0) - (timeSnap[k] || 0)]).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]);
if (rows.length) {
	const tot = rows.reduce((s, r) => s + r[1], 0);
	console.log('阶段均摊（每次决策，总计 ' + (tot / N).toFixed(2) + 'ms）:');
	for (const [k, v] of rows.slice(0, 14)) {
		console.log(`  ${k.padEnd(22)} ${(v / N).toFixed(2).padStart(7)}ms  ${((v / tot) * 100).toFixed(1).padStart(5)}%`);
	}
}
if (process.argv.includes('--tree')) {
	const t = prof.profilerStats().tree || {};
	const walk = (node, depth, acc) => {
		if (!node || depth > 4) return acc;
		if (node.name && node.name !== 'root' && node.total > 0) acc.push([depth, node.name, node.count, node.total]);
		for (const c of node.children || []) walk(c, depth + 1, acc);
		return acc;
	};
	const acc = walk(t, 0, []).sort((a, b) => b[3] - a[3]).slice(0, 45);
	console.log('调用树（总耗时降序）:');
	for (const [d, name, count, total] of acc) console.log('  ' + '·'.repeat(d) + name + '  ' + count + '次  ' + total.toFixed(2) + 'ms');
}
if (SWALLOWED.size) {
	console.log('被静默吞掉的异常（桩缺失线索）:');
	for (const [msg, n] of [...SWALLOWED.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}× ${msg}`);
}
process.exit(0);
