/* 职责：唯一编排引擎安装/卸载，维护状态与异步代际。保留既有执行顺序。 */
/*
 * ============================================
 * // 作者：飛昇原創
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 统一入口（整合进 无名AI） ================= */
import { lib, game, ui, get, ai, _status } from '../foundation/adapt/host.js';
import { installHooks, uninstallHooks, startSettleWatch, stopSettleWatch, bestAction, rulesDecide, clearScoreState } from '../decision/engine/engine.js';
import { openScorePanel } from '../view/panel/panel.js';  /* ★ P0-02：debug bridge / dialog guard 移交 panelPlugin 生命周期管理 */
import { scanReset } from '../decision/skills/skills.js';
import { installAIOverride, uninstallAIOverride } from '../decision/safety/aiOverride.js';
import { warnConflicts, shouldDisableOverride, applyCompatPatches } from '../foundation/adapt/compat.js';
import { log } from '../foundation/diag/logger.js';
import { reg } from '../foundation/runtime/registry.js';   /* ★ 唯一挂载总线：__DJSC 挂载统一入口 */
import { installResponseAI, uninstallResponseAI } from '../decision/response/responseAI.js';
import { installCompareAI, uninstallCompareAI } from '../decision/response/compareAI.js';
import { installStrategist, uninstallStrategist } from '../decision/strategy/strategist.js';
import { installOptimizationHooks, uninstallOptimizationHooks } from '../decision/safety/optimization.js';
import { installOverrideLayers, uninstallOverrideLayers, overrideStatus, retryOverrideLayers } from '../decision/override/index.js';
/* ★ 标准插件框架：所有功能以插件声明接入，新增功能写插件即可 */
import { loadPlugins, pluginOverview, getPluginState, uninstallAllPlugins } from '../plugins/index.js';
import { broadcastStart, broadcastGameEnd } from '../foundation/runtime/plugins.js';
import { on as busOn, clear as busClear } from '../foundation/runtime/eventBus.js';  /* ★ P2-33：事件总线真正接入业务链路 */
import { flushPending } from '../foundation/storage/storage.js';
import { safeStorageGuard } from '../foundation/storage/quotaGuard.js';
import { exposeScoreModules } from './moduleExposure.js';
import { mountSystemButtons } from '../view/bootstrap/systemButtons.js';
import { getInstalled } from '../foundation/runtime/engineQueries.js';

let _installed = false;
let _gen = 0;   /* ★ P1-24：安装代际——卸载后自动使所有 pending import().then() 回调失效，杜绝热重载后旧闭包仍挂载 API */

export function isScoreEngineEnabled() {
	try { return lib.config["extension_无名AI_decisionScore"] !== false; } catch (e) { return true; }
}

export function installScoreEngine() {
	if (_installed) return;
	const myGen = ++_gen;   /* 本次安装代际 */

	/* ★ 存储配额守护：先释放扩展占用的重键，避免 localStorage 耗尽导致主程序 QuotaExceededError */
	try { safeStorageGuard(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	/* installHooks 是关键路径：失败则不置 _installed，允许下次重试
	 * （原代码先置 true 再 try，任何异常都会被吞掉且永远无法恢复）
	 */
	try { installHooks(); } catch (e) { return; }
	/* 宿主未准备好时 installHooks 会正常返回；不能据此宣称引擎已安装。 */
	if (!getInstalled()) {
		log.warn('init', '引擎钩子尚未安装，暂不启动依赖插件，等待宿主准备后重试');
		return;
	}
	_installed = true;

	/* ★ 标准插件框架：登记并按依赖拓扑序统一安装全部插件（★ P0-02：注册/安装分离，
	 *   import 阶段只注册；debug bridge 与 dialog guard 由 panelPlugin.onInstall 负责） */
	try {
		loadPlugins();
		const overview = pluginOverview();  /* loadPlugins 返回数组，统计须走 pluginOverview */
		reg.mount('plugins', {
			list: function () { return pluginOverview(); },
			state: getPluginState,
			broadcastStart: broadcastStart,
			broadcastGameEnd: broadcastGameEnd,
		});
		log.info('init', '插件系统已装载 ' + (overview && overview.total) + ' 个（已安装 ' + (overview && overview.installed) + '）');
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	try { startSettleWatch(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P2-33：事件总线业务订阅（此前 eventBus 仅被挂到 __DJSC，无任何业务发布/订阅） */
	try {
		/* 对局结束：强制把防抖写队列落盘，保证跨局记忆/校准/反馈不丢最后一写 */
		busOn('game:end', function () { try { flushPending(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
		/* 训练生命周期：由 localTrainer 发布，此处订阅做可观测性记录 */
		busOn('train:done', function (r) { try { log.info('train', '本地训练完成 acc=' + (r && r.accuracy) + ' samples=' + (r && r.samples) + ' 用时' + (r && r.ms) + 'ms'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
		busOn('train:fail', function (r) { try { log.warn('train', '本地训练未成功：' + (r && r.err)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } });
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 兼容性检测（不阻断，只打日志） */
	try { warnConflicts(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 本体 Bug 兼容补丁 */
	try { applyCompatPatches(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 联机自动禁用接管层 */
	try {
		if (!shouldDisableOverride()) {
			// 软接管：永远安装（保底层，不破坏本体）
			installAIOverride();
			// 硬接管：逐层安装（每层独立熔断，自动重试）
			installOverrideLayers();
		} else {
			log.info('compat', '联机模式：已跳过原生 AI 接管层');
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('../view/autoplay/autoplay.js').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.initAutoplayMonitor(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	mountSystemButtons(function () { return myGen === _gen && _installed; });
	/* ★ 主面板通过 config.js 的 openPanel.onclick 打开，旧版 setInterval 轮询已移除 */
	try { log.info('init', '已整合进 无名AI（记分+评分框架+小模型+扩展识别）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 响应/弃牌 AI 增强 */
	try { installResponseAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 拼点/选牌 AI */
	try { installCompareAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 策略总线（最后安装，收集所有信号） */
	try { installStrategist(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 卡牌优化器（hook result.target 暴露覆写信号） */
	try { installOptimizationHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 选将推荐 */
	try { import('../decision/strategy/pickRecommend.js').then(function (m) { if (myGen !== _gen || !_installed) return; m.installPickRecommend && m.installPickRecommend(); }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 模型状态机 + Bandit 自动调 trust */
	try {
		import('../model/weights/weights.js').then(function (m) {
			if (myGen !== _gen || !_installed) return;
			/* ★ 统一走总线：已存在则不覆盖，消除与 engine.js 的重复挂载互冲 */
			reg.mount('weightsReady', m.isReady);
			reg.mount('predict', m.predict);
			reg.mount('reloadWeights', m.reloadWeights);
			reg.mount('getMeta', m.getMeta);
			reg.mount('resetWeights', m.resetWeights);
			/* ★ 特征契约自检：网络输入维度 ／ 特征输出维度 若漂移，首启即告警而非训练时静默崩坏 */
			import('../model/features/features.js').then(function (f) {
				if (myGen !== _gen || !_installed) return;
				try {
					var dc = (m.DIM_CHECK && m.DIM_CHECK.check && m.DIM_CHECK.check()) || Object.keys(m.DIM_CHECK || {}).length > 0;
					var wIn = (m.DIM_CHECK && m.DIM_CHECK.input) || (m.IN_DIM) || 0;
					if (!dc) { console.warn('[无名AI·契约] 权重网络结构校验 DIM_CHECK 失败'); }
					else if (f.FEATURE_DIM && wIn && f.FEATURE_DIM !== wIn) {
						console.warn('[无名AI·契约] 特征维度漂移：features.FEATURE_DIM=' + f.FEATURE_DIM + ' ≠ weights.IN_DIM=' + wIn + '，模型输入将错位！');
					}
				} catch (eChk) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(eChk); }
			}).catch(function () {});
		}).catch(function () {});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('../model/state/modelLifecycle.js').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 置信度工具（熵置信版）：模块自挂载 __DJSC.confidenceOf / evaluateConfidence / blendScore，
	 *   此前从未被导入导致自挂载不生效（孤立模块）→ 副作用导入激活 */
	try { import('../model/net/confidence.js').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('../model/train/bandit.js').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ M08：让"决策点监督员"真正上岗（之前只导入没安装，等于白装摄像头）。
	 *    延时到下一轮宏任务，确保 DECISION_REGISTRY 等依赖已就绪。 */
	try {
		import('../decision/engine/decisionHook.js').then(function (m) {
			try {
				window.setTimeout(function () {
					if (myGen !== _gen || !_installed) return;
					try { if (m.installDecisionHooks) m.installDecisionHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
				}, 0);
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}).catch(function () {});
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 决策点自动发现（影子模式） */
	try { import('../perception/discover/autoDiscover.js').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.installAutoDiscover(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 全局反射扫描器（运行时探针） */
	try { import('../foundation/runtime/globalScanner.js').then(function (m) { if (myGen !== _gen || !_installed) return; try { m.installProbes(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 决策点观测面板 */
	try { import('../view/dashboard/decisionDashboard.js').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ 全量自检指令（window.__DJSC.verifyAll） */
	try { import('../verification/verifyAll.js').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ §9 分层自检（window.__DJSC.verifyLayers / verifyLayersText） */
	try { import('../verification/layers.js').catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

	exposeScoreModules(function () { return myGen === _gen && _installed; });
}

export function uninstallScoreEngine() {
	if (!_installed) return;
	_installed = false;
	_gen++;   /* ★ P1-24：使本次安装的所有 pending import().then() 回调代际失效 */
	try { busClear(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ P2-33：清空事件订阅，防止热重载后旧闭包残留 */
	try { flushPending(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }   /* ★ P2-33：卸载前强制落盘防抖写队列 */
	try { uninstallHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { stopSettleWatch(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P0-02：debug bridge / dialog guard 的清理随插件统一逆序卸载 */
	try { uninstallAllPlugins(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallAIOverride(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ M08：监督员对称下班（还原所有被换装的 chooseTo* 决策点） */
	try {
		if (window.__DJSC && window.__DJSC.decisionHook && typeof window.__DJSC.decisionHook.uninstall === 'function') {
			window.__DJSC.decisionHook.uninstall();
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallOverrideLayers(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallResponseAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallCompareAI(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallStrategist(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { uninstallOptimizationHooks(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* 卸载扩展不是对局结束；不在这里发送会触发业务结算的 game:end。 */
	/* ★ P1-24：补充此前未卸载的副作用 */
	try { import('../view/autoplay/autoplay.js').then(function (m) { try { m.stopBatchAutoplay ? m.stopBatchAutoplay() : (m.stopAutoplay && m.stopAutoplay()); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('../foundation/runtime/globalScanner.js').then(function (m) { try { m.uninstallProbes && m.uninstallProbes(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('../decision/strategy/pickRecommend.js').then(function (m) { try { m.uninstallPickRecommend && m.uninstallPickRecommend(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { import('../perception/discover/autoDiscover.js').then(function (m) { try { m.uninstallAutoDiscover && m.uninstallAutoDiscover(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {}); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export { openScorePanel, bestAction, rulesDecide, scanReset };
