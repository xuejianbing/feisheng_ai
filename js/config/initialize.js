/* 职责：初始化共享 AI 状态与 qz/cf 默认配置。沿用 arenaReady 时机，不覆盖已有对象。 */
import { lib, game } from '../shared/utils.js';
export function initializeAIConfig() {
	if (!lib.aiyh) {
		lib.aiyh = {};
	}
	if (!lib.aiyh.qz) {
		lib.aiyh.qz = {};
	}
	if (!lib.aiyh.skillModify) {
		lib.aiyh.skillModify = {};
	}
	if (Object.prototype.toString.call(lib.config.extension_无名AI_qz) !== '[object Object]') {
		game.saveExtensionConfig('无名AI', 'qz', {});
	}
	if (Object.prototype.toString.call(lib.config.extension_无名AI_cf) !== '[object Object]') {
		game.saveExtensionConfig('无名AI', 'cf', {});
	}
}
