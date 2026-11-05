/* 职责：安装/恢复宿主 Player 钩子，持有安装状态及延迟挂载取消句柄。
 * 不决定动作；副作用入口仍使用既有执行网关。 */
import { lib, game, get, ai, _status } from '../../foundation/adapt/host.js';
import { beginStrategicAction, beginStrategicTurn } from '../state/turnStrategicState.js';
import { dispositionOf } from '../threat/threat.js';
import { memLoad } from '../../perception/memory/mem.js';
import { deckConsume, deckAutoDetect, deckSyncFromUI } from '../../perception/memory/deckMemory.js';
import { log } from '../../foundation/diag/logger.js';
import { loadStore } from '../../perception/memory/memory.js';
import { loadArchive } from '../../perception/archive/archive.js';
import { trainStartGame } from '../../model/train/trainExport.js';
import { loadFeedback } from '../../perception/feedback/feedback.js';
import { loadStyleFeedback } from '../../perception/feedback/styleFeedback.js';
import { installBroadcastHooks, uninstallBroadcastHooks } from '../../perception/team/teamBroadcast.js';
import { getModeStrategy, isSameCamp, isEnemy } from '../strategy/modeStrategy.js';
import { autoSelfHeal } from '../../foundation/diag/selfHeal.js';
import { peekDecisionTransaction } from '../state/decisionTransaction.js';
import { confirmExecutionFromHostEvent, cancelExecution, invokeObservedHost } from '../execution/executionGateway.js';
import { startElementFeedbackLoop } from '../../perception/feedback/elementFeedback.js';
import { metaStartGame } from '../../cognition/metaCognition.js';
import { postCheckDiscard } from '../analysis/postCheck.js';
import { captureExecutionSnapshot } from './decisionEffects.js';
import { rec, _initLedger, give, giveVs } from '../scoring/scoreLedger.js';
import { scoreCardUse, scoreEffect, EFFECT_HANDLERS } from '../scoring/scoreEvents.js';
import { addPlayerLog } from '../../perception/journal/playerActionLog.js';
let installed = false, _disposed = false, _lateBindTimer = null;
const DJSC_ORIG = '__djsc_orig';
function installHooks() {
	if (installed) return;
	const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
	if (!proto) return;

	/* 热重载场景：proto 上若残留原函数记录，先还原，避免嵌套包装 */
	if (proto[DJSC_ORIG]) {
		try { uninstallHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	}

	memLoad();   // 上一局记忆载入
	try { deckAutoDetect(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   // ★ 自动识别牌堆模式
	try { trainStartGame(game.me, get.mode ? get.mode() : 'identity'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }  // ★ 开始训练局
	/* ★ 热更新 A/B 分组：若有候选模型，按交替分组在本局换入候选或保持基线（P1-16） */
	try {
		if (window.__DJSC && window.__DJSC.hotSwap && window.__DJSC.hotSwap.gameStart) {
			window.__DJSC.hotSwap.gameStart();
		}
	} catch (eHSG) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eHSG); }
	try { loadStore(); } catch (eMem) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eMem); }   // 跨局记忆载入
	try { loadArchive(); } catch (eArc) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eArc); }  // 战报归档载入
	try { loadFeedback(); } catch (eFb) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eFb); }  // 技能反馈载入
	try { loadStyleFeedback(); } catch (eSf) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eSf); } // 风格反馈载入
	/* ★ 决策回放：局开始 */
	try {
		if (window.__DJSC && window.__DJSC.replay && window.__DJSC.replay.start) {
			window.__DJSC.replay.start({
				mode: (typeof get !== 'undefined' && get.mode) ? get.mode() : 'unknown',
				playerCount: (game.players || []).length,
				meKey: game.me ? (game.me.name1 || game.me.name || '?') : '?',
				myIdentity: game.me ? (game.me.identity || null) : null,
			});
		}
	} catch (eR) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eR); }

	const orig = {};
	proto[DJSC_ORIG] = orig;

	/* 1) useCard —— 出牌记分 + 记录玩家日志 */
	const oUse = proto.useCard;
	if (typeof oUse === "function") {
		orig.useCard = oUse;
		proto.useCard = function () {
			const me = this, args = arguments;
			let _pendingCardTx = null;
			try {
				_pendingCardTx = peekDecisionTransaction(me);
				const pc = _pendingCardTx && _pendingCardTx.meta && _pendingCardTx.meta.postCheck;
				if (_pendingCardTx && (_pendingCardTx.expected.type === 'card' || _pendingCardTx.expected.type === 'equip') && pc && !_pendingCardTx.meta.postCheckKey) {
					captureExecutionSnapshot(me, _pendingCardTx);
				}
			} catch (ePc) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePc); }

			/* 观测前置逻辑彼此隔离，任何记录失败都不能阻止真实宿主调用。 */
			try {
				addPlayerLog('useCard', {
					card: args[0] ? (args[0].name || args[0].suit + args[0].number) : '?',
					target: args[1] ? (args[1].name || '?') : null
				});
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			try {
				const _cid = (get && typeof get.name === 'function') ? get.name(args[0], me) : (args[0] && args[0].name);
				const _tg = args[1];
				const _target = Array.isArray(_tg) ? _tg[0] : _tg;
				if (_target && typeof _target === 'object') {
					beginStrategicAction(me, _cid, _target, {
						relationOf: function (mi, t) { return dispositionOf(mi, t); },
					});
				}
			} catch (eRec) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eRec); }

			/* Execution Gateway 规则：真实宿主函数只允许调用一次。 */
			const host = invokeObservedHost({ orig: oUse, thisArg: this, args: Array.from(args), decisionPoint: 'useCard' });
			if (!host.ok) {
				try { postCheckDiscard(_pendingCardTx && _pendingCardTx.meta && _pendingCardTx.meta.postCheckKey); } catch (_) {}
				try { if (_pendingCardTx) cancelExecution(me, 'useCard-host-error', 'card', _pendingCardTx.id); } catch (_) {}
				return host.result;
			}
			const next = host.result;

			/* useCard 只创建宿主事件；等待事件完成且未取消后才确认 card/equip。 */
			try {
				const _actualId = (get && typeof get.name === 'function') ? get.name(args[0], me) : (args[0] && args[0].name);
				const _actualTarget = [];
				function _collectActualTarget(v) {
					if (!v) return;
					if (Array.isArray(v)) {
						for (let i = 0; i < v.length; i++) _collectActualTarget(v[i]);
						return;
					}
					let isPlayer = false;
					try { isPlayer = !!(get && typeof get.itemtype === 'function' && get.itemtype(v) === 'player'); } catch (e) {}
					if (!isPlayer) {
						try { isPlayer = typeof v === 'object' && typeof v.countCards === 'function' && v.hp !== undefined; } catch (e) {}
					}
					if (!isPlayer) return;
					try {
						const k = v.name1 || v.name || v.playerid || '';
						if (k && _actualTarget.indexOf(k) < 0) _actualTarget.push(k);
					} catch (e) {}
				}
				for (let ai = 1; ai < args.length; ai++) _collectActualTarget(args[ai]);
				const _pendingTx = _pendingCardTx || peekDecisionTransaction(me);
				if (_pendingTx && (_pendingTx.expected.type === 'card' || _pendingTx.expected.type === 'equip')) {
					confirmExecutionFromHostEvent(me, {
						type: 'card',
						id: _actualId || '',
						target: _actualTarget.length > 1 ? _actualTarget : (_actualTarget[0] || null),
					}, next, { eventName: 'useCard', transactionId: _pendingTx.id }).then(function (result) {
						if (!result.ok) postCheckDiscard(_pendingTx.meta && _pendingTx.meta.postCheckKey);
					}).catch(function () {
						postCheckDiscard(_pendingTx.meta && _pendingTx.meta.postCheckKey);
					});
				}
			} catch (eTx) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx); }

			if (next && typeof next.then === "function") {
				Promise.resolve(next).then(function () {
					try { scoreCardUse(me, args[0], args[1]); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}).catch(function () {});
			} else {
				try { scoreCardUse(me, args[0], args[1]); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}
			return next;
		};
	}

	/* 2) 效果钩子 —— 每个 proto[m] 直接绑定对应的处理函数，不再经过 scoreEffect 的字符串分派 */
	const EF = ["damage", "recover", "draw", "discard", "loseHp", "gainMaxHp", "loseMaxHp",
	            "turnOver", "link", "changeHp", "gain", "lose", "judge", "equip"];
	EF.forEach(function (m) {
		const o = proto[m];
		if (typeof o !== "function") return;
		const handler = EFFECT_HANDLERS[m];
		orig[m] = o;
		proto[m] = function () {
			const me = this, args = arguments;
			const host = invokeObservedHost({ orig: o, thisArg: this, args: Array.from(args), decisionPoint: m });
			if (!host.ok) return host.result;
			if (handler) {
				try { rec("effects", m); handler(me, args); } catch (eS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eS); }
			}
			return host.result;
		};
	});

	/* 技能日志不代表技能已执行；等待宿主 useSkill GameEvent 完成且未取消后才提交。 */
	const oUseSkill = proto.useSkill;
	if (typeof oUseSkill === "function") {
		orig.useSkill = oUseSkill;
		proto.useSkill = function () {
			const me = this, args = arguments;
			let _pendingSkillTx = null;
			try {
				_pendingSkillTx = peekDecisionTransaction(me);
				const pc = _pendingSkillTx && _pendingSkillTx.meta && _pendingSkillTx.meta.postCheck;
				if (_pendingSkillTx && _pendingSkillTx.expected.type === 'skill' && pc && !_pendingSkillTx.meta.postCheckKey) {
					captureExecutionSnapshot(me, _pendingSkillTx);
				}
			} catch (ePc) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(ePc); }
			const host = invokeObservedHost({ orig: oUseSkill, thisArg: this, args: Array.from(args), decisionPoint: 'useSkill' });
			if (!host.ok) {
				try { postCheckDiscard(_pendingSkillTx && _pendingSkillTx.meta && _pendingSkillTx.meta.postCheckKey); } catch (_) {}
				try { if (_pendingSkillTx) cancelExecution(me, 'useSkill-host-error', 'skill', _pendingSkillTx.id); } catch (_) {}
				return host.result;
			}
			try {
				const sid = (typeof args[0] === 'string') ? args[0] :
					(args[0] && (args[0].name || args[0].skill || args[0].id)) || '';
				const _pendingTx = _pendingSkillTx || peekDecisionTransaction(me);
				if (_pendingTx && _pendingTx.expected.type === 'skill' && sid &&
					sid === _pendingTx.expected.id) {
					confirmExecutionFromHostEvent(me,
						{ type: 'skill', id: sid, target: null },
						host.result,
						{ eventName: 'useSkill', transactionId: _pendingTx.id }
					).then(function (result) {
						if (!result.ok) postCheckDiscard(_pendingTx.meta && _pendingTx.meta.postCheckKey);
					}).catch(function () {
						postCheckDiscard(_pendingTx.meta && _pendingTx.meta.postCheckKey);
					});
				}
			} catch (eTx) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTx); }
			return host.result;
		};
	}

	/* ★ 单独监听 respond（打出牌响应）+ 记录玩家日志 */
	const oRespond = proto.respond;
	if (typeof oRespond === "function") {
		orig.respond = oRespond;
		proto.respond = function () {
			const me = this, args = arguments;
			try {
				addPlayerLog('respond', {
					card: args[0] ? (args[0].name || args[0].suit + args[0].number) : '?'
				});
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

			const host = invokeObservedHost({ orig: oRespond, thisArg: this, args: Array.from(args), decisionPoint: 'respond' });
			if (!host.ok) return host.result;
			try { deckConsume(args[0]); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			return host.result;
		};
	}

	/* ★ 精确 hook：get.cards —— 从牌堆拿牌的统一入口 */
	try {
		const _origGetCards = get.cards;
		if (typeof _origGetCards === "function" && !get.__djsc_patched) {
			get.cards = function () {
				const args = arguments;
				const r = _origGetCards.apply(this, args);
				/* r 是从牌堆拿到的牌数组 */
				try {
					if (Array.isArray(r)) {
						r.forEach(function (c) { try { deckConsume(c); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return r;
			};
			get.__djsc_patched = true;
			orig.__djsc_getCards = _origGetCards;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ★ 初始手牌：监听 gameDraw 事件 */
	try {
		const _origGameDraw = game.gameDraw;
		if (typeof _origGameDraw === "function" && !game.__djsc_gameDraw_patched) {
			game.gameDraw = function () {
				const r = _origGameDraw.apply(this, arguments);
				/* 等 gameDraw 事件结束后同步一次 UI */
				try {
					const ev = r;
					if (ev && typeof ev.then === 'function') {
						Promise.resolve(ev).then(function () {
							try { deckSyncFromUI(true); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						});
					} else {
						setTimeout(function () {
							try { deckSyncFromUI(true); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
						}, 200);
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return r;
			};
			orig.__djsc_gameDraw = _origGameDraw;   /* ★ Stage H：保存原函数供卸载还原 */
			game.__djsc_gameDraw_patched = true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* 3) die —— 单独处理，不走 scoreEffect
	 * 原因：阵亡计分在语义上属于"终局事件"，不该与通用效果分派混在一起；
	 *       且若未来 scoreEffect 增加 die 分支会造成双倍扣分。
	 */
	const oDie = proto.die;
	if (typeof oDie === "function") {
		orig.die = oDie;
		proto.die = function () {
			const me = this, args = arguments;
			try {
				try { giveVs(me, -6, "阵亡"); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				/* 击杀奖励：从事件链上溯到造成致命伤的伤害事件源 */
				try {
					let killer = null;
					try {
						const ev = _status.event;
						if (ev && ev.getParent) {
							const dmgEv = ev.getParent('damage');
							if (dmgEv && dmgEv.source && dmgEv.source !== me) killer = dmgEv.source;
						}
					} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					if (killer) {
						/* ★ 污染修复：判断 killer 和 me 是否是友方 */
						let isAlly = false;
						try {
							if (isSameCamp(killer, me)) isAlly = true;
							const strategy = getModeStrategy();
							if (strategy && strategy.isSameCamp && strategy.isSameCamp(killer, me)) isAlly = true;
						} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

						if (isAlly) {
							/* 杀队友：只记录特征，不重罚（走本体合法检测） */
							logBestAction(killer, null, { reason: '击杀队友（特征记录）' });
						} else {
							/* 杀敌人：正常加分 */
							give(killer, 6, "击杀" + (me.name || me.name1 || "敌方"));
						}
					}
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			} catch (e) {
				if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
			}
			const host = invokeObservedHost({ orig: oDie, thisArg: this, args: Array.from(args), decisionPoint: 'die' });
			return host.result;
		};
	}

	/* ★ 时序特征：回合开始时记录历史 */
	try {
		const oPhaseBegin = proto.phaseBegin;
		if (typeof oPhaseBegin === 'function' && !proto.__djsc_phaseBegin_patched) {
			proto.phaseBegin = function () {
				const me2 = this;
				/* 显式 turn epoch：同一角色额外回合也必须清空上一回合战略 ledger。 */
				try { beginStrategicTurn(me2); } catch (eTurn) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eTurn); }
				const r = oPhaseBegin.apply(this, arguments);
				try { recordTurnHistory(me2); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				return r;
			};
			orig.phaseBegin = oPhaseBegin;   /* ★ Stage H：保存原函数供卸载还原 */
			proto.__djsc_phaseBegin_patched = true;
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ★ 元素反馈闭环启动 */
	try { startElementFeedbackLoop(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 元认知启动 */
	try { metaStartGame(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* ★ 守恒引擎 · 开局记账：
	 *   - 入场投入：对局开始时所有玩家损失一部分货币（入场费 SEED_FEE → 奖池）。
	 *   - 系统注入：系统给予总约 30% 的货币，作为奖池（由失败阵营产出补偿）。
	 *   奖池 = 入场费总额 + 系统近 30% 注水，作为 ledger 的正基线。
	 *   此后每笔 give 走守恒入账（ledger 补亏/存留），最终 Σ玩家 + ledger = 0。 */
	try { _initLedger(game.players || []); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	installed = true;
	_disposed = false;  /* ★ P1-26：重新安装后允许延迟挂载生效 */
	try { installBroadcastHooks(); } catch (eB) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eB); }
	/* ★ 开机自修复：延迟 3 秒执行，等所有模块加载完 */
	try { autoSelfHeal(3000); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { log.info('init', '已接入记分钩子（卡牌/效果/时机，异步延迟记分，守恒）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

function uninstallHooks() {
	try {
		/* ★ P1-26：无论钩子是否存在，先取消延迟挂载并置卸载标志 */
		_disposed = true;
		if (_lateBindTimer) { try { clearTimeout(_lateBindTimer); } catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); } _lateBindTimer = null; }
		const proto = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (!proto) { installed = false; return; }
		const orig = proto[DJSC_ORIG];
		if (!orig) { installed = false; return; }
		/* ★ Stage H：只还原 proto 方法键，跳过非 proto 原始引用（get.cards / game.gameDraw 单独还原），
		 *   避免把 get.cards/game.gameDraw 方法误还原到 Player.prototype 制造垃圾属性。 */
		for (const k in orig) {
			if (k === '__djsc_getCards' || k === '__djsc_gameDraw') continue;
			try { proto[k] = orig[k]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		try { delete proto[DJSC_ORIG]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ 还原 get.cards */
		try {
			if (orig.__djsc_getCards) {
				get.cards = orig.__djsc_getCards;
			}
			if (get.__djsc_patched) delete get.__djsc_patched;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ Stage H：还原 game.gameDraw（此前缺失，导致卸载后旧闭包残留/重装时嵌套包装） */
		try {
			if (orig.__djsc_gameDraw) {
				game.gameDraw = orig.__djsc_gameDraw;
			}
			if (game.__djsc_gameDraw_patched) delete game.__djsc_gameDraw_patched;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ Stage H：清理 phaseBegin patch 标志（proto.phaseBegin 已由循环还原） */
		try {
			if (proto.__djsc_phaseBegin_patched) delete proto.__djsc_phaseBegin_patched;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* ★ Stage H：卸载广播钩子（还原 game.check） */
		try { uninstallBroadcastHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		installed = false;
		/* ★ P1-26：取消 100ms 延迟挂载并置卸载标志，防止卸载后回调复活写回 API */
		_disposed = true;
		if (_lateBindTimer) { try { clearTimeout(_lateBindTimer); } catch (eT) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eT); } _lateBindTimer = null; }
		try { log.info('init', '已卸下记分钩子（proto 方法已还原）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	} catch (e) { installed = false; }
}

/* ================= 灵活度升级：局势/目标/EV/边际/combo/记忆（统一动作评分框架） ================= */

export { installHooks, uninstallHooks, installed };
export function setHookInstalled(value) { installed = value; }
export function scheduleHookExposure(fn, delay) {
    _lateBindTimer = setTimeout(function () {
        _lateBindTimer = null;
        if (_disposed) return;
        fn();
    }, delay);
}
