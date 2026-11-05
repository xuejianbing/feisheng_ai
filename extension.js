
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
 * v4.0.13-test
 * 版权所有，侵权必究
 * ============================================
 */

/* 界面实现移交视图模块，保持原加载时机。 */
import { mountAllPanels } from './score/view/bootstrap/panels.js';
mountAllPanels();

/* 补丁的创建与卸载由同一模块持有。 */
import { scheduleTargetDiagnostics } from './score/decision/safety/targetDiagnostics.js';
scheduleTargetDiagnostics();

/* ★ P2-32：观测器必须最先求值——全模块任何 catch 触发时 window.__DJSC.swallow 都已可用 */
import './score/foundation/diag/swallow.js';
import { lib, game, ui, get, ai, _status } from './js/shared/utils.js';
import { arenaReady } from './js/bootstrap/arenaReady.js';
import { config } from './js/config/config.js';
import { content } from './js/content/content.js';
import { precontent } from './js/content/precontent.js';
import { help } from './js/help/help.js';
import { VERSION, VERSION_SEMVER, BUILD_DATE } from './js/config/version.js';  /* ★ P2-35：版本号唯一权威源 */

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

/* 宿主钩子仅在这里接线，实现在 bootstrap 内维护。 */
import { attachExtensionLifecycle } from './js/bootstrap/extensionLifecycle.js';
import { mountExtensionInterface } from './js/bootstrap/publicInterface.js';
attachExtensionLifecycle(extensionPackage);
mountExtensionInterface();

export let type = 'extension';
export default extensionPackage;
