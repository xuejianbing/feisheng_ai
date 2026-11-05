/* 职责：通用文件下载和文件名时间戳，不读取决策或训练数据。 */
import { game } from '../adapt/host.js';
/* ============================================================
 * ★ 文件下载（兼容桌面端 / 移动端）
 * ============================================================ */

/**
 * 触发浏览器下载文件
 * @param {string} filename  文件名（含扩展名）
 * @param {string} content   文件内容（字符串）
 * @param {string} mime      MIME 类型，默认 application/json
 * @returns {boolean}        是否成功触发
 */
export function downloadFile(filename, content, mime) {
	try {
		if (typeof content !== 'string') content = String(content);
		mime = mime || 'application/json;charset=utf-8';

		/* 优先：本体自带的下载工具（若存在） */
		try {
			if (game && typeof game.download === 'function') {
				game.download(filename, content);
				return true;
			}
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* 主方案：Blob + a.download */
		try {
			const blob = new Blob([content], { type: mime });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.style.display = 'none';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			/* 延迟释放，避免某些浏览器下载未开始就失效 */
			setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }, 3000);
			return true;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		/* 兜底：data URI */
		try {
			const dataUri = 'data:' + mime + ',' + encodeURIComponent(content);
			const a2 = document.createElement('a');
			a2.href = dataUri;
			a2.download = filename;
			a2.style.display = 'none';
			document.body.appendChild(a2);
			a2.click();
			document.body.removeChild(a2);
			return true;
		} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

		return false;
	} catch (e) {
		return false;
	}
}

/**
 * 生成时间戳后缀（用于文件名）
 * @returns {string} 形如 20260919_143025
 */
export function _tsSuffix() {
	try {
		const d = new Date();
		const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
		return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
			+ '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
	} catch (e) { return String(Date.now()); }
}


export function downloadTextFile(filename, content, mime) {
	return downloadFile(filename, content, mime || 'text/plain;charset=utf-8');
}
