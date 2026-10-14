/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 标准插件框架 =================
 * 目标：所有功能都以"插件"形式声明接入；新增功能 = 写一个插件 + 注册，
 *       无需改动 core / index.js 的硬编码注册表。
 *
 * 【插件协议】每个插件是一个普通对象（或 definePlugin 产物）：
 *   {
 *     id:      '必填·唯一标识'，
 *     name:    '中文名'，
 *     version: '1.0.0'，
 *     desc:    '描述'，
 *     type:    '可选·能力分类'（engine/scorer/panel/feature/strategy/timer/io …），
 *     depends: ['其他插件id']（可选，安装前置检查），
 *     tags:    [''可选标签]，
 *     props:   { 可选·挂到 __DJSC[命名空间] 的键 }，  // 供 registry.bind 软合并
 *     hooks:   { 可选·生命周期钩子 }，
 *     onInstall(): void 或 Promise，   // 装入时调用（注册 hook/面板/定时任务）
 *     onUninstall(): void，           // 卸载时逆向清理
 *     onStart(): void，               // 对局开始时调用
 *     onGameEnd(): void，             // 对局结束时调用
 *   }
 *
 * 【注册方式】
 *   import { definePlugin, registerPlugin } from '.../plugins.js';
 *   const p = definePlugin({ id, name, props, onInstall, ... });
 *   registerPlugin(p);                 // 自动注册且（默认）立即安装
 *
 * 【加载器】错一处/缺依赖 → 该插件禁用并记录 reason，不影响其它插件。
 */

import { reg } from './registry.js?v=5e5';
import { emit } from './eventBus.js?v=5e5';  /* ★ P2-33：对局生命周期经事件总线对外发布，业务模块可订阅解耦 */

const PLUGINS = new Map();          /* id → 插件对象 */
const STATE = new Map();            /* id → 'installed' | 'disabled' | 'error' */
const REASON = new Map();           /* id → 禁用/错误原因 */
/* ★ P1-23：记录每个插件通过 props 实际绑定到 window.__DJSC 的键，卸载时逆向清理 */
const DEP_BOUND = new Map();        /* id → [{ns, key}] */
let _scanRun = false;

/* 定义插件：补缺省字段，返回可注册对象 */
export function definePlugin(spec) {
	const p = Object.assign({
		id: '', name: '', version: '1.0.0', desc: '', type: 'misc',
		depends: [], tags: [], props: {}, hooks: {},
		onInstall: null, onUninstall: null, onStart: null, onGameEnd: null,
	}, spec);
	if (!p.id) throw new Error('definePlugin: 插件缺少 id');
	return p;
}

/* 注册插件。默认立即尝试安装；opt.install=false 时只登记不安装 */
export function registerPlugin(plugin, opt) {
	try {
		if (!plugin || !plugin.id) return { ok: false, reason: '无效插件' };
		PLUGINS.set(plugin.id, plugin);
		STATE.set(plugin.id, 'pending');
		if (!opt || opt.install !== false) installPlugin(plugin.id);
		return { ok: true, id: plugin.id };
	} catch (e) {
		return { ok: false, reason: String(e) };
	}
}

/* 安装单个插件（须已注册）。依赖不满足则禁用 */
export function installPlugin(id) {
	try {
		const p = PLUGINS.get(id);
		if (!p) return { ok: false, reason: '未注册插件: ' + id };

		/* 依赖检查 */
		for (const dep of p.depends || []) {
			if (STATE.get(dep) !== 'installed') {
				disable(id, '缺依赖插件: ' + dep);
				return { ok: false, reason: '缺依赖插件: ' + dep };
			}
		}

		/* props → registry 软合并（只补缺失键），并记录实际写入的键供卸载逆向清理 */
		if (p.props && isObj(p.props)) {
			Object.keys(p.props).forEach(function (k) {
				try {
					const D = reg.root();
					const before = (D[k] && typeof D[k] === 'object') ? Object.keys(D[k]) : null;
					reg.bind(k, p.props[k]);
					const after = (D[k] && typeof D[k] === 'object') ? Object.keys(D[k]) : [];
					const added = [];
					for (let i = 0; i < after.length; i++) {
						if (!before || before.indexOf(after[i]) < 0) added.push(after[i]);
					}
					if (!DEP_BOUND.has(id)) DEP_BOUND.set(id, []);
					DEP_BOUND.get(id).push({ ns: k, keys: added, createdNs: !before });
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			});
		}

		/* 调用生命周期 */
		if (typeof p.onInstall === 'function') {
			const r = p.onInstall(pluginContext(p));
			if (r && typeof r.then === 'function') {
				return r.then(function () { STATE.set(id, 'installed'); REASON.delete(id); retryDependents(id); return { ok: true, id: id }; })
					.catch(function (e) { disable(id, 'onInstall异常: ' + String(e).slice(0, 60)); return { ok: false, reason: String(e) }; });
			}
		}

		STATE.set(id, 'installed');
		REASON.delete(id);
		/* ★ P1-22：依赖恢复后，自动重试因缺依赖被禁用的下游插件 */
		retryDependents(id);
		return { ok: true, id: id };
	} catch (e) {
		disable(id, '安装异常: ' + String(e).slice(0, 60));
		return { ok: false, reason: String(e) };
	}
}

/* ★ P1-22：某插件安装成功后，扫描"因缺依赖被禁用"且依赖它的插件，逐个重试安装。
 * 带递归保护：retryDependents 只在 installPlugin 成功后触发，链式恢复天然按依赖方向推进。 */
function retryDependents(depId) {
	try {
		PLUGINS.forEach(function (p, id) {
			if (STATE.get(id) !== 'disabled') return;
			if ((p.depends || []).indexOf(depId) < 0) return;
			/* 全部依赖均已 installed 才重试 */
			let ok = true;
			for (const d of p.depends || []) {
				if (STATE.get(d) !== 'installed') { ok = false; break; }
			}
			if (!ok) return;
			STATE.set(id, 'pending');  /* 解除 disabled，允许重新安装 */
			REASON.delete(id);
			try { installPlugin(id); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 卸载插件：onUninstall 逆向清理 + 移除 props 绑定 + 级联禁用依赖它的插件（P1-23） */
export function uninstallPlugin(id) {
	try {
		const p = PLUGINS.get(id);
		if (!p) return { ok: false, reason: '未注册' };
		if (typeof p.onUninstall === 'function') {
			try { p.onUninstall(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		/* ★ P1-23：移除本插件通过 props 绑定的键（只删本插件写入的，不碰其它来源同名键） */
		const bound = DEP_BOUND.get(id) || [];
		const D = reg.root();
		for (let i = 0; i < bound.length; i++) {
			try {
				const rec = bound[i];
				const target = D[rec.ns];
				if (target && typeof target === 'object') {
					for (let j = 0; j < rec.keys.length; j++) {
						try { delete target[rec.keys[j]]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					}
					/* 命名空间由本插件创建且已删空 → 整体移除，避免留下空壳 */
					if (rec.createdNs && Object.keys(target).length === 0) {
						try { delete D[rec.ns]; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
					}
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		DEP_BOUND.delete(id);
		STATE.set(id, 'pending');
		/* ★ P1-23：级联——依赖本插件的已安装插件一并卸载（先卸下游，再视为可重装） */
		PLUGINS.forEach(function (dp, did) {
			if (did === id) return;
			if (STATE.get(did) !== 'installed') return;
			if ((dp.depends || []).indexOf(id) < 0) return;
			try { uninstallPlugin(did); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		});
		return { ok: true, id: id };
	} catch (e) { return { ok: false, reason: String(e) }; }
}

function disable(id, reason) {
	STATE.set(id, 'disabled');
	REASON.set(id, reason);
}

/* ★ P0-02：统一安装全部已注册插件（按依赖图拓扑序，跳过已 installed）。
 * 收敛循环：每轮至少装好一个"依赖已满足"的插件；结束后仍未处理的
 * （依赖缺失/安装失败/成环）显式 disable 并记录 reason。
 * onInstall 返回 Promise 时汇总等待（allSettled），故本函数可能返回 Promise。 */
export function installAllPlugins() {
	const done = new Set();
	let installed = 0, failed = 0;
	const pend = [];
	let progress = true;
	while (progress && done.size < PLUGINS.size) {
		progress = false;
		for (const id of Array.from(PLUGINS.keys())) {
			if (done.has(id)) continue;
			const p = PLUGINS.get(id);
			let depsOk = true;
			for (const dep of p.depends || []) {
				if (STATE.get(dep) !== 'installed') { depsOk = false; break; }
			}
			if (!depsOk) continue;
			const r = installPlugin(id);
			done.add(id);
			progress = true;
			if (r && typeof r.then === 'function') {
				pend.push(r.then(function (res) { if (res && res.ok) installed++; else failed++; }, function () { failed++; }));
			} else if (r && r.ok) installed++;
			else failed++;
		}
	}
	for (const id of PLUGINS.keys()) {
		if (!done.has(id) && STATE.get(id) === 'pending') disable(id, '依赖不可用（缺失、安装失败或成环）');
	}
	if (pend.length) {
		return Promise.allSettled(pend).then(function () { return { ok: failed === 0, installed: installed, failed: failed }; });
	}
	return { ok: failed === 0, installed: installed, failed: failed };
}

/* ★ P0-02：逆序卸载全部已安装插件（与拓扑安装对称，后装先卸） */
export function uninstallAllPlugins() {
	const ids = Array.from(PLUGINS.keys()).reverse();
	let n = 0;
	for (const id of ids) {
		if (STATE.get(id) === 'installed') {
			try { uninstallPlugin(id); n++; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
	}
	return n;
}

/* 对局生命周期广播：installed 且有 onStart/onGameEnd 的插件
 * ★ P2-33：广播后通过 eventBus 发布同名事件，非插件业务模块也可订阅 */
export function broadcastStart() {
	PLUGINS.forEach(function (p, id) {
		if (STATE.get(id) !== 'installed') return;
		if (typeof p.onStart === 'function') { try { p.onStart(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
	});
	try { emit('game:start', { ts: Date.now() }); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
export function broadcastGameEnd() {
	PLUGINS.forEach(function (p, id) {
		if (STATE.get(id) !== 'installed') return;
		if (typeof p.onGameEnd === 'function') { try { p.onGameEnd(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }
	});
	try { emit('game:end', { ts: Date.now() }); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 插件上下文：给 onInstall 传参（restart 重装、uninstall 卸载、getState 查状态） */
function pluginContext(p) {
	return {
		id: p.id,
		restart: function () {
			try { uninstallPlugin(p.id); return installPlugin(p.id); } catch (e) { return { ok: false }; }
		},
		uninstall: function () { return uninstallPlugin(p.id); },
		getState: function () { return STATE.get(p.id); },
		reg: reg,
	};
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/* ---- 状态查询 ---- */
export function pluginState(id) { return { state: STATE.get(id) || 'unknown', reason: REASON.get(id) }; }
export function listPlugins() {
	return Array.from(PLUGINS.values()).map(function (p) {
		return {
			id: p.id, name: p.name, version: p.version, type: p.type, desc: p.desc,
			depends: p.depends, tags: p.tags,
			state: STATE.get(p.id), reason: REASON.get(p.id),
		};
	});
}
export function pluginCount() { return PLUGINS.size; }
export function installedCount() {
	let n = 0; STATE.forEach(function (s) { if (s === 'installed') n++; }); return n;
}
/* 插件总体览：供插件面板/cognitionPlugin 汇总展示 */
export function pluginOverview() {
	return {
		total: PLUGINS.size,
		installed: installedCount(),
		list: listPlugins(),
	};
}

/* 扫描目录并注册一批（自动 import 各子模块，模块内部 registerPlugin） */
export function scan() {
	if (_scanRun) return;
	_scanRun = true;
	/* 收集各能力插件模块（静态 import 在 index.js 完成动态加载，这里只做状态标记说明） */
	broadcastStart();
	return { total: PLUGINS.size, installed: installedCount() };
}

export default { definePlugin, registerPlugin, installPlugin, uninstallPlugin, installAllPlugins, uninstallAllPlugins, listPlugins, pluginState, pluginCount, installedCount, broadcastStart, broadcastGameEnd, scan };