/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { lib, game, ui, get, ai, _status } from '../shared/utils.js';
import { installSettingsHelp } from '../config/settingsHelp.js';

export function content(config, pack) {
    installSettingsHelp(lib, ui, _status);
	const cssPath = lib.assetURL + 'extension/无名AI/css/AIjinjiang.css';
// Autor: Feisheng Original | Licencia: GPL-3.0
	lib.init.css(cssPath.slice(0, cssPath.lastIndexOf('/')), cssPath.split('/').pop().slice(0, -4));
	/* ★ 手机端：告知 CSS 是手机 */
	try {
		const isMobile = lib.config.touchscreen || window.innerWidth <= 768;
		if (isMobile) {
			document.documentElement.classList.add('djsc-mobile');
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
