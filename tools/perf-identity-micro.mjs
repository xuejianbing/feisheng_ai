// node tools/perf-identity-micro.mjs
// 逐函数微基准：身份局专属推断链 vs 非身份局，量化「身份局为什么慢」。
import {register} from 'node:module';

const MODE = process.argv.includes('--versus') ? 'versus' : 'identity';
const NP = MODE === 'identity' ? 8 : 3;
const CARDS = 8;
const POOL = ['sha', 'shan', 'tao', 'guohe', 'shunshou', 'juedou', 'nanman', 'wanjian', 'wuxie', 'jiedao', 'lebu', 'wuzhong'];
const CARD_DEF = {};
for (const n of POOL) CARD_DEF[n] = {name: n, type: 'basic', enable: true, usable: 1, targets: 1, ai: {}};
const SEED = ['zhu', 'zhong', 'fan', 'fan', 'nei', 'fan', 'zhong', 'fan'].slice(0, NP);
let seq = 0;
const mk = o => ({name: POOL[seq % POOL.length], suit: 'spade', number: (seq++ % 13) + 1, owner: o});
class P {
	constructor(id, role) {
		this.playerid = String(id); this.name = 'p' + id; this.name1 = this.name;
		this.identity = role; this.identityShown = (role === 'zhu');
		this.hp = 4; this.maxHp = 4; this.hujia = 0; this.sex = 'male'; this.group = 'shu';
		this.alive = true; this.hand = []; this.equip = []; this.judge = [];
		this.skills = ['wusheng']; this.turned = false; this.linked = false;
	}
	getCards(z) {
		if (z === 'h') return this.hand;
		if (z === 'e') return this.equip;
		if (z === 'j') return this.judge;
		const o = [];
		for (const ch of String(z || '')) {
			if (ch === 'h') o.push(...this.hand); else if (ch === 'e') o.push(...this.equip); else if (ch === 'j') o.push(...this.judge);
		}
		return o;
	}
	countCards(z, n) { const cs = this.getCards(z || 'h'); return n ? cs.filter(c => c && c.name === n).length : cs.length; }
	hasCard(n) { return this.countCards('hes', n) > 0; }
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
	distanceTo() { return 1; }
	distanceFrom() { return 1; }
	getHistory() { return {get: () => [], has: () => false}; }
	countUsed() { return 0; }
	hasJudge() { return false; }
	num() { return 0; }
	line() { return ''; }
}

const players = SEED.map((r, i) => new P(i, r));
players.forEach((p, pi) => { for (let k = 0; k < CARDS; k++) p.hand.push(mk(p)); });
const stub = {
	lib: {config: {mode_config: {identity: {identity: [[1, 1, 1, 1], [1, 1, 1, 1, 1]]}}}, card: {...CARD_DEF, list: []}, skill: {}, element: {Player: P}, translate: {}, character: {}, status: {}},
	game: {players, dead: [], me: players[1], zhu: players[0], roundNumber: 1, addGlobalSkill() {}, log() {}},
	get: {
		mode: () => MODE, name: c => c?.name,
		itemtype: p => (p && p.playerid !== undefined ? 'player' : 'card'),
		identityList: () => SEED.slice(),
		attitude: (a, b) => ((a.identity === 'zhu' || a.identity === 'zhong') === (b.identity === 'zhu' || b.identity === 'zhong') ? 4 : -4),
		value: () => 4, damageEffect: () => -1, effect: () => 0,
		translation: k => k, config: () => undefined
	},
	_status: {mode: 'normal', mode2: '', currentPhase: players[1], roundNumber: 1, auto: true},
	ui: {selected: {cards: [], targets: []}},
	ai: {get: {}, order: {}, value: {}, result: {}},
	rootURL: '', AI: {}, Get: {}, Game: {}, Library: {}, UI: {}
};
globalThis.__NONAME_STUB = stub;
Object.assign(globalThis, stub);
globalThis.window = {__DJSC: {swallow() {}, scoringError() {}}, addEventListener() {}, document: null};
register('./noname-stub-loader.mjs', import.meta.url);

const facts = await import('../score/perception/observer/identityFacts.js?v=41a');
const rel = await import('../score/decision/relations/relations.js?v=41a');
const strat = await import('../score/decision/strategy/strategicState.js?v=41a');
const brain = await import('../score/decision/basic/targetBrain.js?v=41a');

const me = players[1];
const OTHER = players[0];const REP = 800;
function bench(label, fn) {
	for (let i = 0; i < 20; i++) fn();          // 预热
	const t0 = performance.now();
	for (let i = 0; i < REP; i++) { try { fn(); } catch (_) {} }
	const dt = (performance.now() - t0) / REP;
	console.log('  ' + label.padEnd(34) + dt.toFixed(4).padStart(9) + ' ms/次' + (dt * 1000).toFixed(1).padStart(8) + ' µs');
	return dt;
}

console.log(`\n=== 微基准 ${MODE} / ${NP} 人 ===`);
const r = {};
r.caps = bench('identityRuleCapabilities()', () => facts.identityRuleCapabilities());
r.pubRole = bench('publicIdentityRole(p)', () => facts.publicIdentityRole(OTHER));
r.players = bench('identityPlayers()', () => facts.identityPlayers());
r.inv = bench('identityRoleInventory()', () => facts.identityRoleInventory());
r.state = bench('identityFactsState(null)', () => facts.identityFactsState(null));
r.state2 = bench('identityFactsState(me,{})', () => facts.identityFactsState(me, {}));
r.skey = bench('relationStateKey(me)', () => rel.relationStateKey(me));
r.expo = bench('exposureOf(me, other)', () => rel.exposureOf(me, OTHER));
r.disp = bench('dispositionOf(me, other)', () => rel.dispositionOf(me, OTHER));
r.strat = bench('getStrategicState(me)', () => strat.getStrategicState(me));
r.tscore = bench('targetScore(me, other)', () => brain.targetScore(me, OTHER));
const ident = await import('../score/perception/observer/identity.js?v=41a');
r.view = bench('identityView(me, other)', () => ident.identityView(me, OTHER));
r.belief = bench('beliefOfFor(me, other)', () => ident.beliefOfFor(me, OTHER));
r.hard = bench('hardIdentityOf(me, other)', () => ident.hardIdentityOf(me, OTHER));
r.slots = bench('remainingIdentitySlots(me)', () => facts.remainingIdentitySlots(me));
const others = players.filter(p => p !== me);
r.loopExpo = bench('loop exposureOf ×' + others.length, () => { for (const p of others) rel.exposureOf(me, p); });
r.loopDisp = bench('loop dispositionOf ×' + others.length, () => { for (const p of others) rel.dispositionOf(me, p); });
r.loopView = bench('loop identityView ×' + others.length, () => { for (const p of others) ident.identityView(me, p); });
r.loopFacts = bench('loop identityFactsState ×' + others.length, () => { for (const p of others) facts.identityFactsState(me, {}); });
for (let i = 0; i < others.length; i++) {
	const p = others[i];
	bench('exposureOf -> ' + (p.identity || '?') + '/' + p.playerid, () => rel.exposureOf(me, p));
}

const n = NP - 1;
console.log('\n按一次决策的典型调用次数折算（context 段）：');
console.log('  ' + 'targetScore ×'.padEnd(34) + (r.tscore * n).toFixed(3) + ' ms');
console.log('  ' + 'relationStateKey ×2'.padEnd(34) + (r.skey * 2).toFixed(3) + ' ms');
console.log('  ' + 'getStrategicState ×1'.padEnd(34) + r.strat.toFixed(3) + ' ms');
console.log('  ' + 'identityFactsState ×2'.padEnd(34) + (r.state * 2).toFixed(3) + ' ms');
