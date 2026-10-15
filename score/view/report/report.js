import {classicEffectsHtml,bindClassicEffects} from './classicEffects.js?v=41a';
/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 结算战报 =================
 * 目的：终局时生成一页图文报告，浓缩本局决策质量与关键节点。
 * 叶子模块：仅依赖 engine / observer / memory 的对外查询接口。
 */
import { lib, game, ui, get, _status } from '../../foundation/adapt/host.js?v=41a';
import { getRound, getScoreLog, getDecisionLog, getGameTelemetry, decisionTransactionStats , getConservationLedger } from '../../decision/engine/engine.js?v=41a';
import { styleOf } from '../../perception/observer/observer.js?v=41a';
import { storeStats } from '../../perception/memory/memory.js?v=41a';
import { archiveStats } from '../../perception/archive/archive.js?v=41a';
import { currentMatchArchive, listMatchArchives, matchArchiveStatus, exportMatchArchive, saveMatchArchive, loadMatchArchives } from '../../perception/journal/matchArchiveStore.js?v=41a';
import { feedbackLabels, submitPlayerFeedback } from '../../perception/journal/playerFeedback.js?v=41a';
import { buildDecisionTraceLines } from '../../decision/engine/decisionTrace.js?v=41a';

let _effectsTimer=null;
let _reportShown = false;
let _reportDialog = null;
let _reportNativeClose = null;

function _esc(s) {
	return String(s == null ? "" : s)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function _displayName(value) {
	try {
		if (value && typeof value === "object") {
			const translatedPlayer = get && get.translation ? get.translation(value) : "";
			if (translatedPlayer && translatedPlayer !== "undefined") return String(translatedPlayer);
			value = value.name1 || value.name || value.name2 || "?";
		}
		const id = String(value == null ? "?" : value);
		const translated = get && get.translation ? get.translation(id) : "";
		if (translated && translated !== id && translated !== "undefined") return String(translated);
		/* 玩家界面不展示 ol_sb_xxx、jsrg_xxx 等底层标识。 */
		if (/^[a-z][a-z0-9]*_[a-z0-9_]+$/i.test(id)) return "未知角色";
		return id;
	} catch (e) { return String(value == null ? "?" : value); }
}
function _num(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}
function _styleLabel(tag) {
	return ({ aggressive: "激进", cautious: "谨慎", vengeful: "记仇", balanced: "均衡", unknown: "未知" })[tag] || _displayName(tag);
}
function _signalLabel(value) {
	const labels = {
		early: "前期", mid: "中期", late: "后期", endgame: "残局",
		custom: "自定义", aggressive: "激进", balanced: "均衡", cautious: "谨慎",
		loner: "独行", guardian: "守护", offense: "进攻", defense: "防守",
		stable: "稳定", improving: "好转", worsening: "恶化", unknown: "未知",
	};
	if (labels[value]) return labels[value];
	if (typeof value === "string" && value.indexOf("auto:") === 0) {
		return "自动匹配·" + (labels[value.slice(5)] || "自定义");
	}
	return value || "—";
}
function _identityLabel(value) {
	return ({ zhu: "主公", zhong: "忠臣", mingzhong: "明忠", fan: "反贼", nei: "内奸", ally: "队友", none: "无", unknown: "未知" })[value] || "未知";
}
function _modeLabel(value) {
	return ({
		identity: "身份", guozhan: "国战", versus: "对决", doudizhu: "斗地主",
		boss: "挑战", chess: "战棋", stone: "炉石", connect: "联机", single: "单人",
		brawl: "乱斗", tafang: "塔防", unknown: "未知",
	})[value] || _displayName(value);
}
function _actionLabel(action) {
	const a = action || {};
	const translated = _displayName(a.id || "?");
	if (a.type === "card") return "使用【" + translated + "】";
	if (a.type === "skill") return "发动【" + translated + "】";
	if (a.type === "equip") return "装备【" + translated + "】";
	if (a.type === "end") return "结束回合";
	return translated;
}
function _bar(pct, color) {
	const c = color || (pct >= 60 ? "#7fe3a0" : pct >= 30 ? "#ffd479" : "#5a7aa8");
	return "<span style='display:inline-block;width:120px;height:10px;background:#14243c;border-radius:5px;overflow:hidden;vertical-align:middle;'>" +
		"<span style='display:inline-block;width:" + Math.max(0, Math.min(100, pct)) + "%;height:100%;background:" + c + ";'></span>" +
		"</span>";
}
function _identityTag(p) {
	try {
		const id = p && p.identity;
		if (id === "zhu") return "<span style='color:#ffd479'>[主公]</span>";
		if (id === "zhong" || id === "mingzhong") return "<span style='color:#7fe3a0'>[忠臣]</span>";
		if (id === "fan") return "<span style='color:#ff9c9c'>[反贼]</span>";
		if (id === "nei") return "<span style='color:#9ad8ff'>[内奸]</span>";
		return "";
	} catch (e) { return ""; }
}

function _getRoundNumber() {
	try {
		if (_status && typeof _status.roundNumber === "number") return _status.roundNumber;
		if (typeof game === "object" && typeof game.roundNumber === "number") return game.roundNumber;
		if (typeof game === "object" && typeof game.round === "number") return game.round;
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return 0;
}

function _sectionOverview() {
	const round = _getRoundNumber();
	const alive = (game.players || []).filter(function (p) { return p && p.alive !== false; }).length;
	const total = new Set((game.players || []).concat(game.dead || [])).size;
	const telemetry = getGameTelemetry();
	const log = getDecisionLog();
	const scores = getScoreLog();
	/* 性格三维卡（含身份基线） */
	const personalityCard = (function () {
		try {
			const preset = (lib.config && lib.config["extension_无名AI_riskProfile"]) || "custom";
			const PS = { aggressive: {agg:80,rsk:70,team:40}, balanced: {agg:50,rsk:50,team:50}, cautious: {agg:30,rsk:30,team:70}, loner: {agg:70,rsk:60,team:10}, guardian: {agg:30,rsk:20,team:90} };
			let agg, rsk, tea;
			if (preset !== "custom" && PS[preset]) { agg = PS[preset].agg; rsk = PS[preset].rsk; tea = PS[preset].team; }
			else {
				const gv = function (k, d) { return (lib.config["extension_无名AI_" + k] !== undefined) ? lib.config["extension_无名AI_" + k] : d; };
				agg = Number(gv("personalityAggression", 50)) || 50;
				rsk = Number(gv("personalityRisk", 50)) || 50;
				tea = Number(gv("personalityTeam", 50)) || 50;
			}
			let idMod = { agg: 0, rsk: 0, team: 0 };
			let idTag = "none";
			try {
				const md = (_status && _status.mode) || (get && get.mode ? get.mode() : "");
				if ((md === "identity" || md === "guozhan") && game.me && game.me.identity) {
					const IM = { zhu: {agg:-15,rsk:-10,team:10}, zhong: {agg:5,rsk:-5,team:15}, mingzhong: {agg:5,rsk:-5,team:15}, fan: {agg:15,rsk:10,team:5}, nei: {agg:5,rsk:15,team:-10} };
					if (IM[game.me.identity]) { idMod = IM[game.me.identity]; idTag = game.me.identity; }
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			const effAgg = Math.max(0, Math.min(100, agg + idMod.agg));
			const effRsk = Math.max(0, Math.min(100, rsk + idMod.rsk));
			const effTea = Math.max(0, Math.min(100, tea + idMod.team));
			const presetName = ({ aggressive: "激进", balanced: "均衡", cautious: "谨慎", loner: "独行", guardian: "守护", custom: "自定义" })[preset] || preset;
			return _card("性格预设", presetName, "#ffd479") +
				_card("身份基线", idTag === "none" ? "—" : _identityLabel(idTag) + " " + (idMod.agg >= 0 ? "+" : "") + idMod.agg + "/" + (idMod.rsk >= 0 ? "+" : "") + idMod.rsk + "/" + (idMod.team >= 0 ? "+" : "") + idMod.team, "#9ad8ff") +
				_card("攻守/冒险/团队", effAgg + "/" + effRsk + "/" + effTea, "#7fe3a0");
		} catch (e) { return ""; }
	})();
	/* 归档统计 */
	let archiveCards = "";
	try {
		const st = archiveStats();
		if (st && st.count > 0) {
			archiveCards = _card("历史局数", st.count, "#9ad8ff") +
				_card("历史平均结算积分", _num(st.avgScore), st.avgScore >= 0 ? "#7fe3a0" : "#ff9c9c");
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	return "<b class='djsc-report-heading'>对局概览</b><div class='djsc-report-overview'>" +
		_card("对局轮数", round, "#9ad8ff") +
		_card("存活", alive + " / " + total, "#7fe3a0") +
		_card("整局分析记录", telemetry.decisions, "#ffd479") +
		_card("整局记分事件", telemetry.scoreEvents, "#a8b8c8") +
		_card("实际结果（本人）", ({ win: '胜利', lose: '失败', draw: '平局', unknown: '未取得结果' })[telemetry.verdict], '#9ad8ff') +
		_card("已完成角色回合", telemetry.completedTurns, '#9ad8ff') +
		personalityCard +
		archiveCards +
		"</div><p style='position:relative;line-height:1.6;font-size:14px'>" +
		"整局累计与最近样本分开统计。当前保留分析 " + log.length + " / 20 条、记分日志 " + scores.length +
		" / 400 条；下方分差和精选决策只基于这些近期样本。结算积分不是胜率。</p>";
}
function _card(label, value, color) {
	return "<div class='djsc-report-stat'>" +
		"<div class='djsc-report-stat-label'>" + _esc(label) + "</div>" +
		"<div class='djsc-report-stat-value' style='color:" + (color || "#dbe7f5") + ";'>" + _esc(value) + "</div>" +
		"</div>";
}

function _sectionRank() {
	const rr = getRound();
	const keys = Object.keys(rr);
	if (!keys.length) return "";
	const name2p = {};
	(game.players || []).forEach(function (p) {
		try {
			if (!p) return;
			if (p.name) name2p[p.name] = p;
			if (p.name1) name2p[p.name1] = p;
			if (p.name2) name2p[p.name2] = p;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	});
	const rows = keys.map(function (k) {
		const p = name2p[k];
		return { name: k, pts: rr[k], player: p };
	}).sort(function (a, b) { return b.pts - a.pts; });
	const maxAbs = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.abs(r.pts); })));
	let h = "<b style='color:#9ad8ff'>① 积分排行</b>";
	h += "<div style='font-size:11px;color:#c8d8ea;margin-top:4px;'>";
	rows.forEach(function (r) {
		const pct = Math.round((Math.abs(r.pts) / maxAbs) * 100);
		const color = r.pts >= 0 ? "#7fe3a0" : "#ff9c9c";
		h += "<div style='display:flex;align-items:center;margin:3px 0;gap:8px;'>";
		h += "<span style='width:110px;color:#dbe7f5;'>" + _esc(_displayName(r.player || r.name)) + " " + (r.player ? _identityTag(r.player) : "") + "</span>";
		h += _bar(pct, color);
		h += "<span style='width:68px;text-align:right;color:" + color + ";font-weight:500;'>" + (r.pts > 0 ? "+" : "") + _num(r.pts) + "</span>";
		h += "</div>";
	});
	h += "</div>";
	const sum = rows.reduce(function (s, r) { return s + r.pts; }, 0);
	/* ★ 对账行：Σ玩家 + 未分配总账(ledger) 应=0（存活奖励/奖池等系统产出由 ledger 承接，不再显示误导性的「应恒为0」） */
	let _ledN = null, _balN = null;
	try {
		const _cl = (typeof getConservationLedger === 'function') ? getConservationLedger() : null;
		if (_cl && typeof _cl.ledger === 'number') { _ledN = _cl.ledger; _balN = _cl.balance; }
	} catch (eCl) { }
	h += "<div style='font-size:11px;color:#777;margin-top:3px;'>合计：" + _num(sum)
		+ (_ledN !== null
			? " ＋未分配 " + _num(_ledN) + " ＝ " + (typeof _balN === 'number' && Math.abs(_balN) < 0.02 ? "0.00 ✓守恒" : (typeof _balN === 'number' ? _num(_balN) + " ⚠偏差" : "?"))
			: "（含系统产出与胜负结算）")
		+ "</div>";
	return h;
}

function _sectionQuality() {
	const log = getDecisionLog();
	if (!log.length) return "";
	let crush = 0, close = 0, normal = 0;
	log.forEach(function (e) {
		const cands = e.candidates || [];
		if (cands.length < 2) { normal++; return; }
		const gap = (cands[0].score || 0) - (cands[1].score || 0);
		if (gap >= 3) crush++;
		else if (gap <= 0.8) close++;
		else normal++;
	});
	let h = "<b style='color:#9ad8ff'>② 近期候选评分差分布</b>";
	h += "<div class='djsc-report-quality'>";
	h += "<div class='djsc-report-quality-row'><span style='color:#7fe3a0;'>较大分差（≥3分）</span>" + _bar(Math.round((crush / log.length) * 100), "#7fe3a0") + "<span>" + crush + " 步</span></div>";
	h += "<div class='djsc-report-quality-row'><span style='color:#9ad8ff;'>中等分差</span>" + _bar(Math.round((normal / log.length) * 100), "#9ad8ff") + "<span>" + normal + " 步</span></div>";
	h += "<div class='djsc-report-quality-row'><span style='color:#ffd479;'>评分接近（≤0.8分）</span>" + _bar(Math.round((close / log.length) * 100), "#ffd479") + "<span>" + close + " 步</span></div>";
	h += "</div>";
	return h;
}

function _sectionHighlights() {
	const log = getDecisionLog();
	if (log.length < 1) return "";
	let best = null, closest = null, closestGap = Infinity;
	log.forEach(function (e) {
		if (!e.winner || !e.candidates) return;
		if (!best || (e.winner.score || 0) > (best.winner.score || 0)) best = e;
		if (e.candidates.length >= 2) {
			const gap = Math.abs((e.candidates[0].score || 0) - (e.candidates[1].score || 0));
			if (gap < closestGap) { closestGap = gap; closest = e; }
		}
	});
	let h = "<b style='color:#9ad8ff'>③ 近期决策样本</b>";
	h += "<div class='djsc-report-highlights'>";
	const render = function (tag, color, entry) {
		if (!entry) return "";
		const w = entry.winner || {};
		const L = entry.layers || {};
		let s = "<div class='djsc-report-highlight' style='border-left-color:" + color + ";'>";
		s += "<div><span style='color:" + color + ";'>" + tag + "</span>　第 " + entry.round + " 轮 · " + _esc(_displayName(entry.player)) + " → <b>" + _esc(_actionLabel(w)) + "</b>（" + _num(w.score || 0) + "）</div>";
		if (L.tempo && L.risk) s += "<div style='color:#888;'>信号：" + _esc(_signalLabel(L.tempo.stage)) + " / " + _esc(_signalLabel(L.risk.label)) +
			(L.team && L.team.focus ? " / 集火 " + _esc(_displayName(L.team.focus)) : "") +
			(L.style && L.style.tag ? " / 对手风格 " + _esc(_styleLabel(L.style.tag)) : "") + "</div>";
		s += "</div>";
		return s;
	};
	h += render("最高评分", "#7fe3a0", best);
	h += render("候选分最接近", "#ffd479", closest);
	h += "</div>";
	return h;
}

/* Autor: Feisheng Original, Todos os direitos reservados */
function _sectionOpponents() {
	const alive = (game.players || []).filter(function (p) { return p && p !== game.me; });
	if (!alive.length) return "";
	let h = "<b style='color:#9ad8ff'>④ 对手风格总结</b>";
	h += "<div style='font-size:11px;margin-top:4px;'>";
	alive.forEach(function (p) {
		const s = styleOf(p) || {};
		const col = s.tag === "aggressive" ? "#ff9c9c" : s.tag === "cautious" ? "#7fe3a0" : s.tag === "vengeful" ? "#ffd479" : "#9ad8ff";
		const src = s.source === "stored" ? "历史" : s.source === "live" ? "本局" : "未知";
		h += "<div style='margin:2px 0;'><span style='display:inline-block;width:110px;color:#dbe7f5;'>" + _esc(_displayName(p)) + " " + _identityTag(p) + "</span>" +
			"<span style='display:inline-block;width:62px;color:" + col + ";'>" + _esc(_styleLabel(s.tag)) + "</span>" +
			"<span style='color:#777;'>进攻 " + _num(s.attacks || 0) + "　援助 " + _num(s.aids || 0) + "　记仇 " + _num((s.vengeful || 0) * 100) + "%（" + src + "）</span></div>";
	});
	h += "</div>";
	return h;
}

function _sectionMemory() {
	let st = null;
	try { st = storeStats(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	if (!st) return "";
	return "<b style='color:#9ad8ff'>⑤ 跨局记忆库</b>" +
		"<div style='font-size:11px;color:#c8d8ea;margin-top:4px;'>" +
		"已记录 <b style='color:#ffd479'>" + st.entries + "</b> 位老对手，共 <b style='color:#ffd479'>" + _num(st.samples) + "</b> 条行为样本。<br>" +
		"<span style='color:#666;'>（仅联机且有稳定识别码时写入；本地电脑对局不计入）</span>" +
		"</div>";
}

function _sectionDiagnostics() {
	const t = getGameTelemetry();
	const tx = decisionTransactionStats();
	const rows = t.turns.slice(-12).map(x => '<tr><td>' + _esc(_displayName(x.player)) +
		'</td><td>' + x.round + '</td><td>' + x.actions + '</td><td>' + x.decisions +
		'</td><td>' + (x.partial ? '中断/终局' : x.decisions ? '有分析' : '无匹配分析') + '</td></tr>').join('');
	return "<b class='djsc-report-heading'>记录覆盖与执行诊断</b>" +
		"<p>观测动作 " + t.actions + " 次；累计引擎分析 " + t.decisions + " 条。两者不一一对应：响应和被动技能也会产生动作日志。</p>" +
		"<p>全场建议事务：暂存 " + tx.staged + "，提交 " + tx.committed + "，不匹配 " + tx.mismatched +
		"，取消 " + tx.cancelled + "，过期 " + tx.expired + "，替换 " + tx.superseded +
		"，提交异常 " + tx.commitErrors + "。未提交建议不等于实际出牌错误。</p>" +
		"<p>最近12个角色回合（汇总最多保留100个）；无匹配分析不等于 AI 没有运行。</p>" +
		"<table style='width:100%;position:relative;line-height:1.6;text-align:left'><thead><tr><th>角色</th><th>轮数</th><th>观测动作</th><th>分析条数</th><th>状态</th></tr></thead><tbody>" + rows + "</tbody></table>";
}

function _sectionMatchArchive() {
	const match = currentMatchArchive();
	return "<b class='djsc-report-heading'>对局档案与时间轴</b>" +
		"<p data-match-status>" + _esc(matchArchiveStatus()) + "</p>" +
		"<label>选择对局 <select data-match-select></select></label> " +
		"<button type='button' data-match-export>导出本局档案</button>" +
		"<div data-match-feedback style='position:relative;margin:16px 0'></div>" +
		"<p>点击回合查看动作与分析；拖动事件进度条查看单步。录像TXT可在本体录像入口导入，录像索引目前是观测位置提示。没有分析的动作不补造解释。</p>" +
		"<div data-match-turns style='display:flex;position:relative;flex-wrap:wrap;gap:6px'></div>" +
		"<input data-match-range type='range' min='0' max='0' value='0' style='width:100%;position:relative' aria-label='事件时间轴'>" +
		"<textarea data-match-note placeholder='记录问题、建议动作与理由' style='width:100%;position:relative'></textarea><button type='button' data-match-mark>标记当前事件待复核</button>" +
		"<div data-match-detail style='position:relative;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6'></div>";
}

function bindMatchArchive(body) {
	const select = body.querySelector('[data-match-select]');
	if (!select) return;
	const current = currentMatchArchive();
	const matches = [current, ...listMatchArchives()].filter((x, i, arr) => x && arr.findIndex(y => y && y.matchId === x.matchId) === i);
	const slider = body.querySelector('[data-match-range]'), detail = body.querySelector('[data-match-detail]');
	const turns = body.querySelector('[data-match-turns]'), status = body.querySelector('[data-match-status]');
	let selected = null, events = [];
	const translate = id => (lib.translate && lib.translate[id]) || id;
	function renderEvent(e) {
		const head = '#' + e.eventId + '｜角色回合 ' + e.turnId + '｜第' + (e.round || 0) + '轮｜' + _displayName(e.player || '') + '｜' + e.kind;
		if (e.kind === 'decision') return head + '\n' + buildDecisionTraceLines(e.data, '详细', translate).join('\n') +
			'\n实际动作：' + JSON.stringify(e.data.actual) + '\n事务编号：' + (e.data.transactionId || '无');
		return head + '\n' + JSON.stringify(e.data, null, 2);
	}
	function step() { detail.textContent = events.length ? renderEvent(events[Number(slider.value)]) : '暂无事件。'; }
	function chooseTurn(turnId) {
		const matching = events.filter(e => e.turnId === turnId);
		if (matching.length) slider.value = String(events.indexOf(matching[0]));
		detail.textContent = matching.map(renderEvent).join('\n\n');
	}
	function choose() {
		selected = matches[Number(select.value)] || null; events = selected ? selected.events : [];
		slider.max = String(Math.max(0, events.length - 1)); slider.value = '0'; slider.disabled = !events.length;
		turns.replaceChildren();
		if (selected) {
			status.textContent = selected.matchId + '｜事件 ' + events.length + '｜缺失 ' + selected.dropped +
				'｜录像 ' + (selected.replay ? '已关联原始TXT' : '未取得，检查本体录像是否开启') + '｜' + matchArchiveStatus();
			for (const e of events.filter(x => x.kind === 'turnBegin')) {
				const button = document.createElement('button'); button.type = 'button';
				button.textContent = '回合' + e.turnId + ' · ' + _displayName(e.player); button.onclick = () => chooseTurn(e.turnId); turns.appendChild(button);
			}
		} else status.textContent = '暂无统一档案；重载后完成新对局即可生成。';
		bindPlayerFeedback(body.querySelector('[data-match-feedback]'), selected);
		step();
	}
	matches.forEach((m, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = m.matchId; select.appendChild(option); });
	select.onchange = choose; slider.oninput = step;
	const exportButton = body.querySelector('[data-match-export]');
	exportButton.onclick = async () => {
		if (!selected) { status.textContent = '暂无可导出的档案。'; return; }
		exportButton.disabled = true;
		try { status.textContent = await exportMatchArchive(selected, translate); }
		catch (e) { status.textContent = '导出失败：' + String(e.message || e); }
		finally { exportButton.disabled = false; }
	};
	const markButton = body.querySelector('[data-match-mark]');
	markButton.onclick = async () => {
		const event = events[Number(slider.value)], note = body.querySelector('[data-match-note]').value.trim();
		if (!selected || !event || !note) { status.textContent = '先选择事件并填写问题说明。'; return; }
		selected.annotations = selected.annotations || [];
		selected.annotations.push({ eventId: event.eventId, ts: Date.now(), verdict: 'needsReview', note });
		markButton.disabled = true;
		try { await saveMatchArchive(selected, translate); status.textContent = '已标记事件 #' + event.eventId + ' 待人工复核；' + matchArchiveStatus(); }
		finally { markButton.disabled = false; }
	};
	choose();
}

function bindPlayerFeedback(panel, match) {
 if (!panel) return;
 const feedback = match && match.experienceFeedback;
 if (!feedback) { panel.textContent = '此档案没有体验反馈记录。'; return; }
 const states = { notDue: '每 5 局邀请一次评分，本局无需填写。', disabled: '体验反馈已关闭。', skipped: '已跳过本次体验反馈。' };
 if (feedback.state !== 'pending') {
  panel.textContent = feedback.state === 'rated' ? '无名AI 体验反馈：' + (feedback.score > 0 ? '+' : '') + feedback.score + ' 分 · ' + feedbackLabels[feedback.score + 5] + (feedback.note ? '\n备注：' + feedback.note : '') : states[feedback.state] || '暂无评分。';
  panel.style.whiteSpace = 'pre-wrap';
  return;
 }
 panel.innerHTML = "<b class='djsc-report-heading'>无名AI 体验反馈</b><p>已完成 " + feedback.games + " 局，邀请你评价本局 AI 表现。评分和备注随本局档案保存，供统计与人工筛选。</p>" +
  "<div style='display:flex;position:relative;flex-wrap:wrap;gap:6px'>" + feedbackLabels.map((label, index) => {
   const score = index - 5;
   return "<button type='button' data-feedback-score='" + score + "' style='position:relative;white-space:normal;padding:8px'>" + (score > 0 ? '+' : '') + score + '：' + _esc(label) + '</button>';
  }).join('') + "</div><textarea data-feedback-note maxlength='2000' placeholder='可选：具体哪一步不好，或哪次配合不错？' style='position:relative;width:100%;margin-top:8px'></textarea>" +
  "<button type='button' data-feedback-skip>跳过本次反馈</button><p data-feedback-status>0 分表示中规中矩；跳过请点击单独的按钮。</p>";
 const buttons = [...panel.querySelectorAll('button')];
 async function submit(score) {
  const status = panel.querySelector('[data-feedback-status]');
  buttons.forEach(button => { button.disabled = true; });
  try {
   const result = submitPlayerFeedback(match, score, panel.querySelector('[data-feedback-note]').value);
   await saveMatchArchive(match, id => (lib.translate && lib.translate[id]) || id);
   bindPlayerFeedback(panel, match);
   const message = document.createElement('p');
   message.textContent = (result.historySaved ? '' : '评分历史未写入；') + matchArchiveStatus();
   panel.appendChild(message);
  } catch (e) {
   status.textContent = '反馈保存失败：' + String(e.message || e) + '。本局内存档案可手动导出。';
   buttons.forEach(button => { button.disabled = feedback.state !== 'pending'; });
  }
 }
 panel.querySelectorAll('[data-feedback-score]').forEach(button => { button.onclick = () => submit(Number(button.getAttribute('data-feedback-score'))); });
 panel.querySelector('[data-feedback-skip]').onclick = () => submit(null);
}

export function buildReportHtml() {
	try {
		const parts = [];
		parts.push(_sectionOverview());
        if(lib.config.extension_无名AI_classicEffectReport!==false){const html=classicEffectsHtml(currentMatchArchive());if(html)parts.push('<div data-effects-section>'+html+'</div>');}
		parts.push(_sectionDiagnostics());
		parts.push(_sectionMatchArchive());
		parts.push(_sectionRank());
		parts.push(_sectionQuality());
		parts.push(_sectionHighlights());
		parts.push(_sectionOpponents());
		parts.push(_sectionMemory());
		return "<div class='djsc-report-grid'>" + parts.filter(Boolean).map(function (part) {
			return "<section class='djsc-report-section'>" + part + "</section>";
		}).join("") + "</div>";
	} catch (e) {
		return "<div style='color:#ff9c9c;'>战报生成异常：" + _esc(String(e).slice(0, 120)) + "</div>";
	}
}

export async function showReport(force) {
	try {
		await loadMatchArchives();
		if (_reportShown && !force) return;
		clearInterval(_effectsTimer);_effectsTimer=null;
		if (_reportDialog) {
			try { if (_reportNativeClose) _reportNativeClose(); else _reportDialog.close(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			_reportDialog = null;
			_reportNativeClose = null;
		}

		let dlg = null;
		try { dlg = ui.create.dialog("无名AI · 飞雀V2 对局战报", true, "peaceDialog"); } catch (eD) { dlg = null; }
		if (!dlg) return;
		_reportDialog = dlg;
		_reportShown = true;
		try {
			_reportNativeClose = dlg.close.bind(dlg);
			dlg.close = function () { return dlg; };
		} catch (eClose) { _reportNativeClose = null; }

		try {
			dlg.classList.add("djsc-report-dialog");
			dlg.dataset.djscReport = "1";
			if (dlg.content) {
				dlg.content.classList.add("djsc-report-content");
				dlg.content.style.position = "relative";
				dlg.content.style.overflow = "visible";
			}
			if (dlg.contentContainer) dlg.contentContainer.classList.add("djsc-report-scroll");
		} catch (eS) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eS); }

		const d = document.createElement("div");
		d.className = "djsc-report-body";
		d.innerHTML = buildReportHtml();
		dlg.content.appendChild(d);
		bindMatchArchive(d);
        const matchId=currentMatchArchive()?.matchId;
        const readMatch=()=>listMatchArchives().find(m=>m.matchId===matchId);
        bindClassicEffects(d,readMatch);
        let signature=JSON.stringify([readMatch()?.classicEffects,readMatch()?.outcomeRevision]);
        clearInterval(_effectsTimer);
        _effectsTimer=setInterval(()=>{const match=readMatch(),next=JSON.stringify([match?.classicEffects,match?.outcomeRevision]),section=d.querySelector('[data-effects-section]');if(section&&next!==signature){const dev=section.querySelector('[data-effect-developer]')?.hidden===false;section.innerHTML=classicEffectsHtml(match);bindClassicEffects(section,readMatch);if(dev)section.querySelector('[data-effect-view="developer"]')?.click();signature=next;}},1000);

		const closeBtn = document.createElement("button");
		closeBtn.className = "djsc-report-close";
		closeBtn.type = "button";
		closeBtn.setAttribute("aria-label", "关闭战报");
		closeBtn.textContent = "×";
		closeBtn.onclick = function () { closeReport(); };
		dlg.appendChild(closeBtn);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function resetReportShown() {
	_reportShown = false;
	closeReport();
}
export function closeReport() {
    clearInterval(_effectsTimer);_effectsTimer=null;
	try {
		if (_reportDialog) {
			if (_reportNativeClose) _reportNativeClose();
			else _reportDialog.close();
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	_reportDialog = null;
	_reportNativeClose = null;
}

/* ================= 决策回放导出 ================= */
export function exportDecisionsJson() {
	try {
		const log = getDecisionLog ? getDecisionLog() : [];
		const payload = {
			v: 1, ts: Date.now(),
			mode: (get && get.mode) ? get.mode() : (_status && _status.mode) || "unknown",
			round: _getRoundNumber(),
			player: game.me ? (game.me.name || "?") : "?",
			decisions: log.map(function (e) {
				const L = e.layers || {};
				return {
					round: e.round || 0, player: e.player || "?",
					winner: e.winner ? { type: e.winner.type, id: e.winner.id, score: e.winner.score, reason: e.winner.reason } : null,
					candidates: (e.candidates || []).map(function (c) { return { type: c.type, id: c.id, score: c.score, target: c.target || null, reason: c.reason || "" }; }),
					signals: { tempo: L.tempo || null, risk: L.risk || null, team: L.team || null, seat: L.seat || null, econ: L.econ || null, style: L.style || null, multiturn: L.multiturn || null },
				};
			}),
		};
		return JSON.stringify(payload, null, 2);
	} catch (e) { return "{}"; }
}

export function exportDecisionsMarkdown() {
	try {
		const log = getDecisionLog ? getDecisionLog() : [];
		if (!log.length) return "# 决策回放\n\n（无记录）";
		const mode = (get && get.mode) ? get.mode() : (_status && _status.mode) || "unknown";
		const round = _getRoundNumber();
		const player = game.me ? _displayName(game.me) : "?";
		let md = "# 决策回放 · " + _modeLabel(mode) + " · 轮 " + round + "\n\n";
		md += "**玩家**：" + player + "　|　**记录步数**：" + log.length + "\n\n---\n\n";
		log.forEach(function (e, i) {
			const w = e.winner || {};
			const L = e.layers || {};
			md += "## #" + (log.length - i) + " 轮 " + (e.round || 0) + " · " + _displayName(e.player || "?") + "\n\n";
			md += "**胜出动作**：" + _actionLabel(w);
			if (w.score !== undefined) md += "（评分 " + _num(w.score) + "）";
			md += "\n\n";
			if (w.reason) md += "> " + w.reason.replace(/\bEV\b/g, "预期收益") + "\n\n";
			md += "**信号**：\n\n";
			if (L.tempo) md += "- 节奏：" + _signalLabel(L.tempo.stage) + "\n";
			if (L.risk) md += "- 性格：" + _signalLabel(L.risk.label) + "\n";
			if (L.team) md += "- 团队：" + (L.team.focus ? "集火 " + _displayName(L.team.focus) : "无集火") + "\n";
			if (L.econ) md += "- 经济：手牌 " + L.econ.handCount + "，体力 " + L.econ.hp + "/" + L.econ.maxHp + "\n";
			if (L.style && L.style.tag) md += "- 博弈：" + _styleLabel(L.style.tag) + "\n";
			if (L.multiturn) md += "- 趋势：" + _signalLabel(L.multiturn.overall) + "\n";
			md += "\n";
			if (e.candidates && e.candidates.length) {
				md += "**前 " + Math.min(5, e.candidates.length) + " 项候选**：\n\n";
				md += "| # | 动作 | 评分 | 目标 |\n|---|---|---|---|\n";
				e.candidates.slice(0, 5).forEach(function (c, j) {
					const isWin = w.type === c.type && w.id === c.id;
					md += "| " + (j + 1) + (isWin ? " ★" : "") + " | " + _actionLabel(c) + " | " + _num(c.score) + " | " + (c.target ? _displayName(c.target) : "—") + " |\n";
				});
				md += "\n";
			}
			md += "---\n\n";
		});
		return md;
	} catch (e) { return "# 导出异常\n\n" + String(e); }
}

/* ================= 决策回放导入 ================= */
export function parseDecisionsJson(jsonStr) {
	try {
		if (typeof jsonStr !== "string") return { ok: false, err: "输入为空" };
		const obj = JSON.parse(jsonStr);
		if (!obj || typeof obj !== "object") return { ok: false, err: "数据格式错误" };
		if (!Array.isArray(obj.decisions)) return { ok: false, err: "缺少决策记录列表" };
		return { ok: true, meta: { ts: obj.ts || 0, mode: obj.mode || "unknown", round: obj.round || 0, player: obj.player || "?" }, decisions: obj.decisions };
	} catch (e) {
		return { ok: false, err: "解析异常：" + String(e).slice(0, 80) };
	}
}

export function renderImportedDecisions(parsed) {
	try {
		if (!parsed || !parsed.ok) return "<div style='color:#ff9c9c;'>数据无效</div>";
		const meta = parsed.meta;
		const decs = parsed.decisions;
		const padTime = function (ts) {
			try {
				const d = new Date(ts);
				const p = function (n) { return n < 10 ? "0" + n : n; };
				return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
			} catch (e) { return "?"; }
		};
		let html = "<div style='font-size:12px;color:#dbe7f5;line-height:1.7;'>";
		html += "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;'>";
		const card = function (label, val, color) {
			return "<div style='flex:1;min-width:76px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;text-align:center;'>" +
				"<div style='font-size:11px;color:#9ad8ff;margin-bottom:3px;'>" + label + "</div>" +
				"<div style='font-size:14px;font-weight:600;color:" + (color || "#dbe7f5") + ";'>" + val + "</div></div>";
		};
		html += card("时间", padTime(meta.ts), "#a8b8c8");
		html += card("模式", _modeLabel(meta.mode), "#9ad8ff");
		html += card("轮次", meta.round, "#ffd479");
		html += card("玩家", _displayName(meta.player), "#9ad8ff");
		html += card("步数", decs.length, "#7fe3a0");
		html += "</div>";
		if (!decs.length) { html += "<div style='color:#666;'>无决策记录</div></div>"; return html; }
		html += "<b style='color:#9ad8ff'>决策回放（导入）：</b><br>";
		decs.forEach(function (dd, i) {
			const w = dd.winner || {};
			const S = dd.signals || {};
			const sigParts = [];
			if (S.tempo && S.tempo.stage) sigParts.push("节奏：" + _signalLabel(S.tempo.stage));
			if (S.risk && S.risk.label) sigParts.push("性格：" + _signalLabel(S.risk.label));
			if (S.team && S.team.focus) sigParts.push("集火：" + _displayName(S.team.focus));
			if (S.style && S.style.tag) sigParts.push("对手：" + _styleLabel(S.style.tag));
			if (S.multiturn && S.multiturn.overall) sigParts.push("趋势：" + _signalLabel(S.multiturn.overall));
			html += "<div style='margin:6px 0;padding:6px 8px;border-left:3px solid #5a7aa8;background:rgba(255,255,255,0.02);border-radius:3px;'>";
			html += "<div style='color:#9ad8ff;'><b>#" + (i + 1) + "</b> 第 " + (dd.round || 0) + " 轮 · " + _esc(_displayName(dd.player || "?")) + " → ";
			html += "<b style='color:#7fe3a0'>" + _esc(_actionLabel(w)) + "</b>";
			if (w.score !== undefined) html += "（" + _num(w.score) + "）";
			html += "</div>";
			if (sigParts.length) html += "<div style='color:#888;font-size:10px;margin-top:2px;'>" + sigParts.join("｜") + "</div>";
			if (dd.candidates && dd.candidates.length) {
				const maxAbs = Math.max(1, Math.max.apply(null, dd.candidates.slice(0, 5).map(function (c) { return Math.abs(c.score || 0); })));
				html += "<div style='margin-top:4px;font-size:10px;'>";
				dd.candidates.slice(0, 5).forEach(function (c) {
					const isWin = w.type === c.type && w.id === c.id;
					const col = isWin ? "#7fe3a0" : "#a8b8c8";
					const pct = Math.round((Math.abs(c.score || 0) / maxAbs) * 100);
					html += "<div style='display:flex;align-items:center;gap:6px;margin:1px 0;'>";
					html += "<span style='width:130px;color:" + col + ";font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>" + _esc(_actionLabel(c)) + "</span>";
					html += "<span style='flex:1;height:7px;background:#14243c;border-radius:3px;overflow:hidden;'>";
					html += "<span style='display:block;width:" + pct + "%;height:100%;background:" + col + ";'></span></span>";
					html += "<span style='width:58px;text-align:right;color:" + col + ";font-size:10px;'>" + (c.score > 0 ? "+" : "") + _num(c.score) + "</span>";
					html += "</div>";
				});
				html += "</div>";
			}
			html += "</div>";
		});
		html += "</div>";
		return html;
	} catch (e) { return "<div style='color:#ff9c9c;'>渲染异常：" + String(e).slice(0, 80) + "</div>"; }
}

export function showImportedDecisions(parsed) {
	try {
		let dlg = null;
		try { dlg = ui.create.dialog("决策回放导入"); } catch (e) { dlg = null; }
		if (!dlg) { alert("无法创建弹窗"); return; }
		try { dlg.classList.add("fullheight"); dlg.style.width = "min(92vw, 820px)"; dlg.style.maxWidth = "92vw"; dlg.style.left = "4vw"; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		const d = document.createElement("div");
		d.innerHTML = renderImportedDecisions(parsed);
		dlg.content.appendChild(d);
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
