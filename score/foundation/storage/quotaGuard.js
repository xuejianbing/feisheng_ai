/* 职责：维护既有存储配额治理策略，不负责引擎安装。 */
import { quotaProbe, safeGet, safeSet, safeRemove } from './storage.js';
/* ================= 存储配额守护 =================
 * 扩展把训练样本写进本地存储（旧版）会撑爆 ~5MB 配额，
 * 导致无名杀主程序自身 setItem 也抛 QuotaExceededError。
 * 启动时先探测：若写入极小的探针都失败，说明配额已满，
 * 则清理扩展占用最重的键，释放空间后再正常启动。
 * ★ P2-31：全部经由中央存储抽象（quotaProbe/safeGet/safeSet/safeRemove），
 *   业务层不再直触 localStorage；本函数属存储治理层代码。
 */
export function safeStorageGuard() {
	try {
		/* 探针：若连一个超小值都写不进去 → 存储已满 */
		if (quotaProbe()) return;  /* 还有空间，不用清 */
		/* ★ P1-21：分级清理策略（此前直接删除权重/归档/记忆等不可重建资产）
		 *   ① 可重建缓存（日志片段）→ 自动删；
		 *   ② 可导出但重要（训练样本缓冲）→ shrink 保留较新一半，不整库删除；
		 *   ③ 不可轻易重建（权重 djsc_weights_v3 / 战报归档 / 玩家记忆）→ 禁止静默删，仅告警。 */
		var removedCache = 0;
		var CACHE_KEYS = [
			'djsc_game_logs_v1'  /* 对局日志自存库：可从对局行为重建，优先释放 */
		];
		for (var i = 0; i < CACHE_KEYS.length; i++) {
			if (safeRemove(CACHE_KEYS[i])) removedCache++;
		}
		/* 训练样本缓冲：压缩为较新一半（trainExport.saveToStorage 同口径） */
		var shrunk = false;
		var rawS = safeGet('djsc_training_samples_v1');
		if (rawS) {
			try {
				var arr = JSON.parse(rawS);
				if (Array.isArray(arr) && arr.length > 2) {
					shrunk = safeSet('djsc_training_samples_v1', JSON.stringify(arr.slice(-Math.floor(arr.length / 2))));
				}
			} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
		/* 复查：仍写不进去 → 不再动权重/归档/记忆，告警交用户处理 */
		if (quotaProbe()) {
			try { console.warn('[无名AI] 本地存储已满：已清理可重建缓存 ' + removedCache + ' 个' + (shrunk ? '，训练样本已压缩一半' : '') + '；权重/战报/记忆已保留'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		} else {
			try { console.warn('[无名AI] 本地存储配额仍不足：为保护模型权重/战报归档/玩家记忆不再自动删除，请手动导出数据后清理'); } catch (e3) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e3); }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
