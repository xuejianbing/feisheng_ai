/*
 * ============================================
 * // 作者: 飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 统一导出路径（全扩展唯一来源） =================
 * 背景：历史上三套前缀混用 —— 'data' / 'extension/无名AI/data/...' / '无名AI/data/...'，
 * 而无名杀的 game.writeFile / readFileAsText / getFileList 以**游戏根目录**为基准，
 * 只有 'extension/无名AI/data/...' 是正确的。其余前缀会把文件写到错误位置，
 * 表现为手机上"提示导出成功却找不到文件"。
 *
 * 约定：所有落盘路径一律走本文件，如需改动只改这里一处。
 */
export const EXT_DIR = 'extension/无名AI';
export const DATA_DIR = EXT_DIR + '/data';

/* 允许的二级子目录（未登记的按原样拼接） */
const SUB = { training: 'training', output: 'output', input: 'input', gamelog: 'gamelog', replay: 'replay' };

/* 取子目录（带尾斜杠，可直接传给 game.writeFile 的 path 参数） */
export function dirOf(sub) {
	return DATA_DIR + '/' + (SUB[sub] || sub || '') + '/';
}

/* 常用目录常量 */
export const DIRS = {
	root: DATA_DIR + '/',
	training: dirOf('training'),
	output: dirOf('output'),
	input: dirOf('input'),
	gamelog: dirOf('gamelog'),
	replay: dirOf('replay'),
};

/* 完整文件路径（仅用于提示文案，不参与写盘） */
export function fileOf(sub, filename) {
	return dirOf(sub) + filename;
}

/* 浏览器下载兜底（手机 / 无 game.writeFile 环境）：不依赖任何模块，避免循环引用 */
export function downloadText(filename, content, mime) {
	try {
		if (typeof document === 'undefined') return false;
		const type = mime || 'application/json;charset=utf-8';
		const blob = new Blob([content], { type: type });
		const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
		const a = document.createElement('a');
		a.href = url || ('data:' + type + ',' + encodeURIComponent(content));
		a.download = filename;
		if (a.style) a.style.display = 'none';
		document.body.appendChild(a);
		a.click();
		if (document.body.removeChild) document.body.removeChild(a);
		if (url && URL.revokeObjectURL) setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
		return true;
	} catch (e) { return false; }
}

/* 统一写盘：优先 game.writeFile（无名杀原生，落到 extension/无名AI/data/<sub>/），
 * 失败则回退浏览器下载，保证手机端也能拿到文件。返回 'file' | 'download' | 'none' */
export function writeData(sub, filename, content, cb) {
	try {
		if (typeof game !== 'undefined' && game && typeof game.writeFile === 'function') {
			game.writeFile(content, dirOf(sub), filename, function () { if (cb) cb(true, 'file'); });
			return 'file';
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	const ok = downloadText(filename, content, 'application/json;charset=utf-8');
	if (cb) cb(!!ok, ok ? 'download' : 'none');
	return ok ? 'download' : 'none';
}

