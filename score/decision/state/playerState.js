/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 玩家状态事实层 · 唯一横置读取入口 =================
 * 指令 02：铁索连环状态规划修复 → Task 1 统一 linked-state。
 *
 * 背景：项目内曾同时存在
 *   - p.isLinked()   （宿主真实 API，函数）
 *   - !!p.isLinked   （把函数对象当布尔值 → 恒 true）
 *   - !target.isLinked（把函数对象当布尔值 → 恒 false）
 *   - p.isChained    （未验证字段 → 恒 false）
 * 导致不同模块对「角色是否横置」得到不同事实。
 *
 * 本文件是全库唯一的横置状态读取入口：
 *   所有模块必须调用 isPlayerLinked(player)，禁止再自行读取 isLinked / isChained。
 *
 * 契约：
 *   - 宿主真实 API 为函数 isLinked()，调用后取布尔；
 *   - 仅当 isLinked 不是函数时，才回退读取布尔字段 isLinked（兼容旧快照）；
 *   - 读取失败一律 fail-closed 返回 false；
 *   - 本函数是纯读取，绝不修改 Player，绝不调用 link()。
 */

/* 统一诊断出口（不新增静默吞错：宿主提供 swallow 则上报，否则保持可诊断） */
function _swallow(e) {
	try {
		if (typeof window !== 'undefined' && window.__DJSC && typeof window.__DJSC.swallow === 'function') {
			window.__DJSC.swallow(e);
			return;
		}
	} catch (_) { /* swallow 自身失败时不再递归 */ }
}

/**
 * 判断角色是否处于「横置（铁索连环）」状态。
 * @param {*} player 无名杀 Player 对象（可为 null/undefined）
 * @returns {boolean}
 */
export function isPlayerLinked(player) {
	if (!player) return false;
	try {
		if (typeof player.isLinked === 'function') return !!player.isLinked();
		/* legacy：仅当宿主 isLinked 不是函数时才读取布尔字段（集中于此，禁止散落） */
		if (typeof player.isLinked === 'boolean') return player.isLinked;
	} catch (e) {
		_swallow(e);
		return false;
	}
	return false;
}

export default { isPlayerLinked };
