/* 职责：扩展加载时暴露版本、训练导入导出与旧版诊断接口。
 * 保留原有赋值和异步加载语义，后续业务不应在入口重复定义这些接口。 */
import { mountAllyExemptInterface } from '../../score/decision/safety/allyExempt.js';
import { VERSION, VERSION_SEMVER, BUILD_DATE } from '../config/version.js';
export function mountExtensionInterface() {
/* ★ 挂载校验相关接口到 window.__DJSC（直接内联，避免加载失败） */
window.__DJSC = window.__DJSC || {};
/* ★ 兼容别名：游戏内控制台/旧教程里常裸写 DJSC.xxx，指向同一对象避免 ReferenceError */
window.DJSC = window.__DJSC;
/* ★ P2-35：版本号单一权威源下发到全局，面板/自检/战报一律读此值，不再各自写死 */
window.__DJSC.VERSION = VERSION;
window.__DJSC.VERSION_SEMVER = VERSION_SEMVER;
window.__DJSC.BUILD_DATE = BUILD_DATE;

/* ★ 提前挂载训练数据导入/导出（扩展加载时就可用，不用进对局） */
import('../../score/model/train/trainExport.js').then(function (m) {
    m.mountTrainingInterface();
    console.log('[extension] ✅ trainExport/trainImport 已挂载（提前加载）');
}).catch(function (e) {
    console.warn('[extension] trainExport 加载失败:', e);
});

/* 提示与决策使用同一个正式判断。 */
mountAllyExemptInterface();

/* 校验记录器（动态加载） */
import('../../score/decision/safety/guardRecorder.js').then(function (m) {
    m.mountGuardRecorderInterface();
}).catch(function (e) { console.warn('guardRecorder 加载失败:', e); });


}
