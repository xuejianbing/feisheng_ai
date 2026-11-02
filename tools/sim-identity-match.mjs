// node tools/sim-identity-match.mjs [--rounds N] [--cards N] [--seed N]
//
// 整局模拟：8 人身份局，逐座位跑真实引擎 bestAction，并按推荐执行（扣牌/扣血/击杀），
// 用来验证两件事：
//   1) 长局下决策链不抛异常、不产出非法推荐（推荐的牌必须在手牌里、目标必须合法）；
//   2) 状态变化时身份局关系缓存必须失效（不返回过期敌我判断），
//      且「按推荐执行」在事务层必须 committed，不再出现推荐≠执行的静默分叉。
//
// 宿主桩与 tools/perf-identity-bench.mjs 同源（只替换无名杀宿主，跑真实生产模块）。
import {register} from 'node:module';

const arg = (k, d) => {
	const i = process.argv.indexOf('--' + k);
	return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const ROUNDS = Number(arg('rounds', 12));
const CARDS = Number(arg('cards', 6));
const SEED = Number(arg('seed', 1));
const ROLES = ['zhu', 'zhong', 'fan', 'fan', 'nei', 'fan', 'zhong', 'fan'];
const CARD_POOL = ['sha', 'shan', 'tao', 'guohe', 'shunshou', 'juedou', 'nanman', 'wanjian', 'wuxie', 'jiedao', 'lebu', 'wuzhong'];
const CARD_DEF = {};
for (const n of CARD_POOL) CARD_DEF[n] = {name: n, type: 'basic', enable: true, usable: 1, targets: 1, ai: {}};

/* 可复现的伪随机：同一 seed 必须产出同一局 */
let rngState = SEED >>> 0 || 1;
function rnd() { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; }
let seq = 0;
function mkCard(name, owner) {
	return {name, suit: ['spade', 'heart', 'club', 'diamond'][seq % 4], number: (seq++ % 13) + 1, owner};
}

class Player {
	constructor(id, role, me) {
		this.playerid = String(id);
		this.name = 'p' + id; this.name1 = this.name;
		this.identity = role;
		this.identityShown = (role === 'zhu');
		this.hp = 4; this.maxHp = 4; this.hujia = 0;
		this.sex = 'male';
		this.group = role === 'zhu' || role === 'zhong' ? 'shu' : 'wei';
		this.alive = true;
		this.hand = []; this.equip = []; this.judge = [];
		this.skills = ['wusheng'];
		this.turned = false; this.linked = false;
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
	loseHp(n) { this.hp -= Number(n) || 1; }
	recover(n) { this.hp = Math.min(this.maxHp, this.hp + (Number(n) || 1)); }
	draw() {}
	useCard() { return {name: 'useCard'}; }
	respond() { return {name: 'useCard'}; }
	isUnderControl() { return false; }
}

const players = ROLES.map((r, i) => new Player(i, r, i === 1));
for (const p of players) for (let k = 0; k < CARDS; k++) p.hand.push(mkCard(CARD_POOL[(Number(p.playerid) + k) % CARD_POOL.length], p));

const stub = {
	lib: {
		config: {mode_config: {identity: {identity: [[1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]]}}},
		card: {...CARD_DEF, list: [], cardPile: [], discardPile: []},
		skill: {}, element: {Player}, translate: {}, character: {}, status: {}, video: []
	},
	game: {
		players, dead: [], me: players[1], zhu: players[0], roundNumber: 1,
		addGlobalSkill() {}, removeGlobalSkill() {}, writeFile() {}, log() {}, checkWin() {}
	},
	get: {
		mode: () => 'identity',
		name: c => c?.name, suit: c => c?.suit, number: c => c?.number,
		itemtype: p => (p && p.playerid !== undefined ? 'player' : 'card'),
		identityList: () => ROLES.slice(),
		attitude: (a, b) => {
			if (!a || !b) return 0;
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
	rootURL: '', AI: {}, Get: {}, Game: {}, Library: {}, UI: {}, config: {}
};
globalThis.__NONAME_STUB = stub;
Object.assign(globalThis, stub);          // 无名杀代码直接引用裸全局 lib/game/get/_status
const SWALLOWED = new Map();
let HARD_ERROR = null;
globalThis.window = {
	__DJSC: {
		scoringError: e => { if (!HARD_ERROR) HARD_ERROR = e && e.stack ? e.stack : String(e); },
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

const engine = await import('../score/decision/engine/engine.js?v=41a');
const relations = await import('../score/decision/relations/relations.js?v=41a');
const tx = await import('../score/decision/state/decisionTransaction.js?v=41a');
const obsMod = await import('../score/perception/observer/observer.js?v=41a');
const prof = await import('../score/foundation/diag/profiler.js?v=41a');
try { prof.profilerEnable(true); prof.profilerReset(); } catch (_) {}

/* ---------------- 统计 ---------------- */
const stats = {
	decisions: 0, endTurn: 0, played: 0, illegalCard: 0, illegalTarget: 0,
	commitOk: 0, commitMismatch: 0, commitDifferentType: 0,
	missedMismatch: 0, throws: 0, deaths: 0,
	byCard: {}, byType: {},
};
const times = [];
const notes = [];

function alivePlayers() { return (stub.game.players || []).filter(p => p && p.alive !== false); }
function die(p) {
	p.alive = false; p.hp = 0;
	p.__djsc_revealedRole = p.identity;                 // 死亡公开身份
	stub.game.players = (stub.game.players || []).filter(x => x !== p);
	stub.game.dead = (stub.game.dead || []).concat([p]);
	stats.deaths++;
}

/* 按推荐执行后的事务校验：推荐即执行必须是 committed */
function checkTx(player, rec) {
	try {
		const expected = {type: rec.type, id: rec.rule, target: rec.target == null ? null : rec.target, recast: !!rec.recast};
		const t = tx.createDecisionTransaction(expected, () => {});
		tx.stageDecisionTransaction(player, t);
		const res = tx.commitDecisionTransaction(player, expected);
		if (res && res.ok && t.state === 'committed') stats.commitOk++;
		else if (res && res.reason === 'different-type') stats.commitDifferentType++;
		else stats.commitMismatch++;
	} catch (_) { stats.commitMismatch++; }
}

/* 反例：故意把目标换成另一个人，事务必须判 mismatched（对账器不能哑火） */
function checkMismatchDetector(player, rec, other) {
	if (!rec.target || !other) return;
	try {
		const expected = {type: rec.type, id: rec.rule, target: rec.target, recast: !!rec.recast};
		const t = tx.createDecisionTransaction(expected, () => {});
		tx.stageDecisionTransaction(player, t);
		tx.commitDecisionTransaction(player, {type: 'card', id: rec.rule, target: other, recast: !!rec.recast});
		if (t.state !== 'mismatched') stats.missedMismatch++;
	} catch (_) {}
}

/* ---------------- 整局 ---------------- */
for (let round = 1; round <= ROUNDS; round++) {
	stub._status.roundNumber = round;
	stub.game.roundNumber = round;
	if (alivePlayers().length <= 1) break;
	const order = alivePlayers().slice();
	for (const actor of order) {
		if (actor.alive === false) continue;
		stub._status.currentPhase = actor;
		/* 摸牌：补到 CARDS 张，制造每轮手牌变化 */
		while (actor.hand.length < CARDS) actor.hand.push(mkCard(CARD_POOL[Math.floor(rnd() * CARD_POOL.length)], actor));

		let rec = null;
		const t0 = performance.now();
		try { rec = engine.bestAction(); } catch (e) { stats.throws++; notes.push('bestAction 抛异常: ' + (e && e.message)); break; }
		times.push(performance.now() - t0);
		stats.decisions++;

		if (!rec || typeof rec !== 'object') { notes.push('决策返回空'); continue; }
		const isEnd = rec.rule === 'end' || rec.type === 'end' || rec.action === 'C';
		if (isEnd) { stats.endTurn++; continue; }

		/* 1) 推荐的牌必须在手牌里（推荐门的 card 段正是按此合法性判定） */
		const cardIdx = actor.hand.findIndex(c => c && c.name === rec.rule);
		if (cardIdx < 0) {
			stats.illegalCard++;
			notes.push('推荐牌不在手牌 p' + actor.playerid + ' ' + rec.type + ':' + rec.rule + ' hand=[' + actor.hand.map(c => c.name).join(',') + ']');
			continue;
		}
		/* 2) 推荐目标必须合法（存活玩家；tao 可对濒死/自己） */
		let target = null;
		if (Array.isArray(rec.target)) target = rec.target[0] || null;
		else if (rec.target && typeof rec.target === 'object') target = rec.target;
		if (target && target.alive === false && rec.rule !== 'tao') {
			stats.illegalTarget++;
			notes.push('推荐目标已阵亡 p' + actor.playerid + ' → ' + rec.rule);
			target = null;
		}

		/* 3) 推荐即执行：事务层必须 committed；再抽检一次目标替换必须被识别 */
		checkTx(actor, {...rec, target});
		const others = alivePlayers().filter(p => p !== actor && p !== target);
		if (others.length && rnd() < 0.25) checkMismatchDetector(actor, {...rec, target}, others[Math.floor(rnd() * others.length)]);

		/* 4) 执行：扣牌 + 极简效果 */
		actor.hand.splice(cardIdx, 1);
		const key0 = (rec.type === 'card' ? 'card:' : String(rec.type) + ':') + String(rec.rule);
		stats.byCard[key0] = (stats.byCard[key0] || 0) + 1;
		stats.byType[String(rec.type)] = (stats.byType[String(rec.type)] || 0) + 1;
		stats.played++;

		if ((rec.rule === 'sha' || rec.rule === 'juedou') && target && target !== actor) {
			target.loseHp(1);
			if (target.hp <= 0) die(target);
		} else if (rec.rule === 'tao') {
			actor.recover(1);
		} else if (rec.rule === 'nanman' || rec.rule === 'wanjian') {
			for (const p of alivePlayers()) if (p !== actor) { p.loseHp(1); if (p.hp <= 0) die(p); }
		}
	}
}

/* 缓存两项硬检：
 *  A) 同一状态强制失效后重算，结果必须与缓存版一致（缓存不得改写语义）；
 *  B) 新增行为证据后必须失效（不得返回过期敌我判断）。
 * 注：血量不进关系指纹取值（关系只看阵营/暴露/置信度），故不能用改血量验失效。 */
const probe = players.find(p => p.alive !== false) || players[0];
const enemy = alivePlayers().find(p => p !== probe) || players[players.length - 1];
const kA = relations.relationStateKey(probe);
const roundSave = stub._status.roundNumber;
stub._status.roundNumber = 987;                 // 键变 → 三个缓存 Map 全清，强制真算
const kB = relations.relationStateKey(probe);
stub._status.roundNumber = roundSave;
const cacheSameAsFresh = kA === kB;
obsMod.observeAttack(enemy, probe, 1);          // 新增敌意证据
const kC = relations.relationStateKey(probe);
const cacheInvalidates = kC !== kB;

/* ---------------- 报告 ---------------- */
times.sort((a, b) => a - b);
const avg = times.length ? times.reduce((s, v) => s + v, 0) / times.length : 0;
const p95 = times.length ? times[Math.floor(times.length * 0.95)] : 0;
const total = times.reduce((s, v) => s + v, 0);

console.log('\n=== 模拟对局：8 人身份局 / 轮上限 ' + ROUNDS + ' / 每人 ' + CARDS + ' 张 ===');
console.log('座位角色: ' + ROLES.join(' '));
console.log('决策 ' + stats.decisions + ' 次（出牌 ' + stats.played + '、结束回合 ' + stats.endTurn + '）｜阵亡 ' + stats.deaths + ' 人｜剩 ' + alivePlayers().length + ' 人');
console.log('耗时：平均 ' + avg.toFixed(2) + 'ms  p95 ' + p95.toFixed(2) + 'ms  合计 ' + total.toFixed(0) + 'ms（整局约 ' + (total / 1000).toFixed(1) + 's CPU）');
console.log('非法推荐：牌不在手牌 ' + stats.illegalCard + ' 次、目标已阵亡 ' + stats.illegalTarget + ' 次');
console.log('事务对账：committed ' + stats.commitOk + '、mismatched ' + stats.commitMismatch + '、different-type ' + stats.commitDifferentType + '、对账器漏判 ' + stats.missedMismatch);
console.log('缓存：同状态重算一致 ' + (cacheSameAsFresh ? 'OK' : '不一致') + '｜证据变化后失效 ' + (cacheInvalidates ? 'OK' : '未失效'));
console.log('出牌分布: ' + Object.entries(stats.byCard).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join(' '));

try {
	const st = prof.profilerStats();
	const rows = (st.phases || []).filter(p => p.total > 0 && /^(decision\.|bestAction)/.test(p.phase)).sort((a, b) => b.total - a.total);
	if (rows.length) {
		console.log('阶段总耗时（整局）:');
		for (const r of rows.slice(0, 9)) console.log('  ' + r.phase.padEnd(22) + r.total.toFixed(1).padStart(8) + 'ms  ' + ((r.total / total) * 100).toFixed(1).padStart(5) + '%');
	}
} catch (_) {}

if (SWALLOWED.size) {
	console.log('被静默吞掉的异常:');
	for (const [msg, n] of [...SWALLOWED.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log('  ' + String(n).padStart(4) + '× ' + msg);
}
if (HARD_ERROR) console.error('\n引擎内部异常（首次）:\n' + HARD_ERROR);
if (notes.length) {
	console.log('异常记录（最多 8 条）:');
	for (const n of notes.slice(0, 8)) console.log('  - ' + n);
}

const fail = stats.throws > 0 || stats.illegalCard > 0 || stats.illegalTarget > 0 ||
	stats.commitMismatch > 0 || stats.missedMismatch > 0 ||
	!cacheSameAsFresh || !cacheInvalidates || !!HARD_ERROR;
console.log('\n结果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
