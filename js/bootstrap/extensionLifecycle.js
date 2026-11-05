/* 职责：连接宿主 content/uninstall 与引擎生命周期；维持原先调用顺序。 */
import { installScoreEngine, uninstallScoreEngine, isScoreEngineEnabled } from '../../score/index.js';
import { uninstallTargetDiagnostics } from '../../score/decision/safety/targetDiagnostics.js';

export function attachExtensionLifecycle(extensionPackage) {
/* ★ 整合：原 content 钩子后初始化决策积分引擎（可配置开关） */
const _content = extensionPackage.content;
extensionPackage.content = function (config, pack) {
	try { if (typeof _content === 'function') _content(config, pack); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		if (isScoreEngineEnabled()) {
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
	try { uninstallScoreEngine(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	uninstallTargetDiagnostics();
	try { if (typeof _uninstall === 'function') _uninstall(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
};


}
