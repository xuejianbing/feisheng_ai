
/* ===== 版本号校验（功能层面防盗） ===== */
const _fs_version = VERSION;
const _fs_author = '\x98de\x5347\x539f\x521b';

try {
    const decoded_ver = _fs_version;
    const decoded_author = _fs_author;
    console.log('%c[无名AI] 版本: ' + decoded_ver + ' | 作者: ' + decoded_author, 'color: #00d4ff;');
} catch(e) {
    console.warn('[无名AI] 版本校验失败，请确认是官方版本');
}
/* ==================================== */

// ===== 隐藏水印（不影响功能） =====
const __AUTHOR__ = "飞升原创";
const __CONTACT__ = "交流群: 1080487560";
const __VERSION__ = "v" + VERSION;
// ====================================
/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 1080487560
 * v4.0.19
 * 版权所有，侵权必究
 * ============================================
 */

import { modeModelsReady } from './score/model/weights/modeModelStore.js?v=41a';
import { mountPanels } from './score/foundation/diag/panelLoader.js?v=41a';
import { installModelUpdate, uninstallModelUpdate } from './js/update/modelUpdate.js?v=41a';   /* ★ 模型权重在线更新（原整包在线更新已移除） */
import { installPolicyModelUpdate } from './js/update/policyModelUpdate.js?v=41a';   /* ★ 4.1.5.0：策略模型 v3 热更检查（纯数据 JSON，失败静默） */
import './score/model/net/policyModelV3.js?v=41a';   /* ★ 4.1.5.0：策略模型 v3 接线（自注册 window.__DJSC.policyModelV3，影子评估默认开） */
import { bootMark, installPerfReport } from './score/foundation/diag/bootTrace.js?v=41a';   /* ★ 4.4.3：启动/首次决策耗时轨迹（手机端卡死定位，只读） */
window.__DJSC = window.__DJSC || {};
bootMark('ext:start');   /* ★ 4.4.3：模块开始执行；控制台看不到这条 = 卡在宿主解析/加载阶段 */
installPerfReport();
// Inspectable readiness promise for browser/host release checks.
bootMark('panels:start');
window.__DJSC.panelsReady = mountPanels(window.__DJSC).then(function (report) {
    bootMark('panels:ready', { total: report.total, loaded: report.loaded, ok: !!report.ok });
    window.__DJSC.panelLoadStatus = report;
    if (report.ok) console.log('[无名AI] 所有' + report.total + '个面板挂载完成');
    else console.warn('[无名AI] 面板挂载 ' + report.loaded + '/' + report.total + '：', report.panels.filter(p => !p.ok));
    return report;
});

// ===== 模型权重在线更新（整包下载 / 解压安装已移除，实现见 js/update/）=====
installModelUpdate();
installPolicyModelUpdate();   /* ★ 4.1.5.0：策略模型 v3 热更检查（空闲时一次，失败静默保留内置） */
bootMark('update:install');
// ===== 模型权重在线更新结束 =====

/* ===== 目标合理性校验（前置校验，不拦截，仅日志） =====
 * ★ P1-25：保存定时器句柄与原始 useCard 引用，扩展卸载时可完整还原，
 *   杜绝"扩展关了补丁还在 / 热重载后旧闭包残留"的永久猴补丁。 */
let _useCardPatchTimer = null;
_useCardPatchTimer = setTimeout(function () {
    _useCardPatchTimer = null;
    try {
        var _p = lib.element.Player.prototype;
        if (_p.__logicCheck) return;
        _p.__logicCheck = true;
        var _o = _p.useCard;
        _p.__djsc_origUseCard = _o;  /* ★ P1-25：保存原函数供卸载还原 */
        var TARGET_RESTRICT_CARDS = ['sha','huosha','leisha','juedou','huogong','nanman','wanjian',
                   'zhujin','jiedao','lijian','shunshou','guohe','lebu','bingliang',
                   'tiesuo','fanjian','sidian'];
        _p.useCard = function (card, cards, target) {
            try {
                var me = this;
                var cn = typeof card === 'string' ? card : (card && (card.name || card.cardname));
                if (cn && TARGET_RESTRICT_CARDS.indexOf(cn) >= 0) {
                    var list = Array.isArray(target) ? target : (target ? [target] : []);
                    for (var i = 0; i < list.length; i++) {
                        var t = list[i];
                        if (!t || typeof t !== 'object' || t === me) continue;
                        var myId = me.identity, tid = t.identity;
                        var isSameFaction = false;
                        if (myId === 'zhu' && (tid === 'zhong' || tid === 'mingzhong')) isSameFaction = true;
                        if ((myId === 'zhong' || myId === 'mingzhong') && tid === 'zhu') isSameFaction = true;
                        if ((myId === 'zhong' || myId === 'mingzhong') && (tid === 'zhong' || tid === 'mingzhong')) isSameFaction = true;
                        if (myId === 'fan' && tid === 'fan') isSameFaction = true;
                        try { if (get.attitude(me, t) > 0) isSameFaction = true; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                        if (isSameFaction) {
                            var exempt = false;
                            try {
                                if (window.__DJSC && window.__DJSC.checkAllyExempt) {
                                    exempt = window.__DJSC.checkAllyExempt(me, t, cn);
                                }
                            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            if (!exempt) {
                                try { game.log('⚠️ 校验：' + cn + ' 对同阵营目标 ' + (t.name1 || t.name) + ' 不推荐'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            } else {
                                try { game.log('✅ 豁免：' + cn + ' 对同阵营目标 ' + (t.name1 || t.name) + ' 合理'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            }
                        }
                    }
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            return _o.apply(me, arguments);
        };
        try { game.log('✅ 目标合理性校验模块已就绪（仅日志，不拦截）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}, 3000);

/* ★ P2-32：观测器必须最先求值——全模块任何 catch 触发时 window.__DJSC.swallow 都已可用 */
import './score/foundation/diag/swallow.js';
import { lib, game, ui, get, ai, _status } from './js/shared/utils.js?v=41a';
import { arenaReady } from './js/bootstrap/arenaReady.js?v=41a';
import { config } from './js/config/config.js?v=41a';
import { content } from './js/content/content.js?v=41a';
import { precontent } from './js/content/precontent.js?v=41a';
import { help } from './js/help/help.js?v=41a';
import { installScoreEngine, uninstallScoreEngine, isScoreEngineEnabled } from './score/index.js?v=41a';
import { VERSION, VERSION_SEMVER, BUILD_DATE } from './js/config/version.js?v=41a';  /* ★ P2-35：版本号唯一权威源 */

let extensionPackage = {
	name: '无名AI',
	arenaReady,
	content,
	precontent,
	config,
	help,
	package: {},
	files: {},
	css: ['./css/AIjinjiang.css'],
};

/* ★ 兼容旧版 WebView：不使用模块顶层 await（需 Chrome89+/ES2022），
 *   改为在异步 IIFE 内读取 info.json 并合并到 package，保证低版本也能整包解析加载。 */
(function () {
    try {
        Promise.resolve(lib.init.promises.json(`${lib.assetURL}extension/无名AI/info.json`)).then(function (extensionInfo) {
            if (!extensionInfo || typeof extensionInfo !== 'object') return;
            Object.keys(extensionInfo)
                .filter(function (key) { return key !== 'name'; })
                .forEach(function (key) {
                    if (extensionPackage.package && typeof extensionPackage.package === 'object') {
                        extensionPackage.package[key] = extensionInfo[key];
                    }
                });
        }).catch(function () {});
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
})();

/* ★ 整合：原 content 钩子后初始化决策积分引擎（可配置开关） */
const _content = extensionPackage.content;
extensionPackage.content = async function (config, pack) {
	bootMark('content:start');
	try { if (typeof _content === 'function') await _content(config, pack); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	bootMark('content:native');
	// Optional specialist restore never gates public engine installation.
	modeModelsReady.then(function (status) { bootMark('content:models', { backend: status.backend, error: !!status.error }); });
	try {
		if (isScoreEngineEnabled()) {
			bootMark('engine:install-begin');
			installScoreEngine();
		}
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.reportUnexpected) window.__DJSC.reportUnexpected('engine', 'installScoreEngine 安装失败', e);
	}
};

/* ★ 卸载时清理决策积分引擎 + 还原 useCard 猴补丁（P1-25） */
const _uninstall = extensionPackage.uninstall;
extensionPackage.uninstall = function () {
	try { uninstallModelUpdate();
installPolicyModelUpdate();   /* ★ 4.1.5.0：策略模型 v3 热更检查（空闲时一次，失败静默保留内置） */ } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ P1-3：解除更新器监听与定时器 */
	try { uninstallScoreEngine(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★P2 修复：卸载前把 shadow 防抖窗口内未落盘的日志同步写掉（模块已加载时同一微任务内完成），并停掉退出兜底监听 */
	try {
		import('./shadow/shadowCore.js?v=41a').then(function (mShadow) {
			try { mShadow.flushShadowLog(true); } catch (eF) {}
			try { mShadow.dropExitFlush(); } catch (eD) {}
		}).catch(function () {});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P1-25：还原 Player.prototype.useCard，取消未执行的 3s 补丁定时器 */
	try { if (_useCardPatchTimer) { clearTimeout(_useCardPatchTimer); _useCardPatchTimer = null; } } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		const _p = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (_p && _p.__djsc_origUseCard) {
			_p.useCard = _p.__djsc_origUseCard;
			try { delete _p.__djsc_origUseCard; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			try { delete _p.__logicCheck; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { if (typeof _uninstall === 'function') _uninstall(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
};

/* ★ 挂载校验相关接口到 window.__DJSC（直接内联，避免加载失败） */
window.__DJSC = window.__DJSC || {};
/* ★ 兼容别名：游戏内控制台/旧教程里常裸写 DJSC.xxx，指向同一对象避免 ReferenceError */
window.DJSC = window.__DJSC;
/* ★ P2-35：版本号单一权威源下发到全局，面板/自检/战报一律读此值，不再各自写死 */
window.__DJSC.VERSION = VERSION;
window.__DJSC.VERSION_SEMVER = VERSION_SEMVER;
window.__DJSC.BUILD_DATE = BUILD_DATE;

/* ★ 提前挂载训练数据导入/导出（扩展加载时就可用，不用进对局） */
import('./score/model/train/trainExport.js?v=41a').then(function (m) {
    window.__DJSC.trainExport = function() { return m.exportForImport(); };
    window.__DJSC.trainImport = function(jsonStr) { return m.importFromJson(jsonStr); };
    window.__DJSC.trainBufferSize = function() { return m.bufferSize(); };
    console.log('[extension] ✅ trainExport/trainImport 已挂载（提前加载）');
}).catch(function (e) {
    console.warn('[extension] trainExport 加载失败:', e);
});

/* 合法性校验函数（直接内联，不依赖 allyExempt.js） */
// The real module can be mounted by the static engine import before this fallback.
// Preserve that implementation; the fallback is only for an absent module.
if (typeof window.__DJSC.checkAllyExempt !== 'function') window.__DJSC.checkAllyExempt = function (me, target, cardName) {
    try {
        if (!me || !target) return false;

        /* 1. 技能战术判定：目标有卖血技能 */
        const SPECIAL_SKILLS = ['yiji', 'jianxiong', 'fankui', 'gangzhi', 'yongsi', 'juejing', 'guicai', 'buyi', 'xingshang'];
        if (target.getSkills) {
            const skills = target.getSkills();
            for (let i = 0; i < skills.length; i++) {
                if (SPECIAL_SKILLS.indexOf(skills[i]) >= 0) return true;
            }
        }

        /* 2. 送牌收益判定：目标手牌少 */
        const hc = target.countCards ? target.countCards('h') : 0;
        if (hc <= 1) return true;

        /* 3. 残局判定：只剩2人且目标残血 */
        try {
            const alive = (game.players || []).filter(function (p) { return p && p.alive !== false; });
            if (alive.length <= 2 && target.hp <= 1) return true;
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        return false;
    } catch (e) { return false; }
};

/* 校验记录器（动态加载） */
import('./score/decision/safety/guardRecorder.js?v=41a').then(function (m) {
    window.__DJSC.guardRecorder = {
        record: m.recordGuardEvent,
        getStats: m.getGuardStats,
        reset: m.resetGuardRecorder,
    };
}).catch(function (e) { console.warn('guardRecorder 加载失败:', e); });

/* ===== v5 shadow 评估模块（不接管决策，仅后台记录对比；__AI_REASON.cmd.shadow('stats'|'export'|'clear')）===== */
import('./shadow/shadowCore.js?v=41a').then(function (mShadow) {
    window.__AI_REASON = window.__AI_REASON || {};
    window.__AI_REASON.cmd = window.__AI_REASON.cmd || {};
    window.__AI_REASON.cmd.shadow = mShadow.shadowCmd;
    setTimeout(function () {
        mShadow.startShadow().catch(function (e) { console.error('[Shadow] 启动失败:', e); });
    }, 3000);
}).catch(function (e) { console.warn('[Shadow] 模块加载失败:', e); });

export let type = 'extension';
export default extensionPackage;
