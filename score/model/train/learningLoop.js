/*
 * ============================================
 * // Éditeur: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · AI 学习闭环 =================
 * 打完一局后，自动调整权重
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js';
import { WEIGHTS, BIAS } from '../weights/weights.js';
import { recordGame } from './learningOptimizer.js';  // ★ 接线：课程学习随真实对局推进
import { safeGet as _lsGet, safeSet as _lsSet } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

// Autor: Feisheng Original | Licencia: GPL-3.0
/* ================= 学习缓存 ================= */
let _learnData = {
	games: 0,
	wins: 0,
	losses: 0,
	weightAdjustments: [],
};

/* ★ 从localStorage加载学习数据 */
try {
	const raw = _lsGet('djsc_learn_data_v1');
	if (raw) {
		const obj = JSON.parse(raw);
		if (obj && typeof obj.games === 'number') {
			_learnData = obj;
		}
	}
} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

/* ★ 保存学习数据到localStorage */
function _saveLearnData() {
	try {
		_lsSet('djsc_learn_data_v1', JSON.stringify(_learnData));
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 1. 记录结果 ================= */
export function recordGameResult(won) {
	try {
		_learnData.games++;
		if (won) {
			_learnData.wins++;
		} else {
			_learnData.losses++;
		}
		_saveLearnData();  /* ★ 保存到localStorage */
		recordGame();      /* ★ 接线：推进课程学习阶段 */
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ================= 2. 计算胜率 ================= */
export function getWinRate() {
	try {
		if (_learnData.games === 0) return 0;
		return _learnData.wins / _learnData.games;
	} catch (e) {
		return 0;
	}
}

/* ================= 3. 自动调整权重 =================
 * 如果胜率低 → 自动调整权重
 */
export function autoAdjustWeights() {
	try {
		const winRate = getWinRate();

		/* 如果胜率 < 0.4 → 权重微调 */
		if (winRate < 0.4 && _learnData.games > 10) {
			/* 这里只是占位，真正的调整需要 Python 蒸馏 */
			return {
				adjusted: false,
				reason: '胜率低，建议用 Python 重新蒸馏',
			};
		}

		return {
			adjusted: false,
			reason: '胜率正常，不需要调整',
		};
	} catch (e) {
		return { adjusted: false, reason: '未知错误' };
	}
}

/* ================= 4. 学习数据面板 ================= */
export function learningPanelData() {
	try {
		/* ★ 检查WEIGHTS是否真的存在 */
		let weightReady = false;
		try {
			weightReady = !!(typeof WEIGHTS !== 'undefined' && WEIGHTS && WEIGHTS.length > 0);
		} catch (e) {
			weightReady = false;
		}
		
		return {
			games: _learnData.games || 0,
			wins: _learnData.wins || 0,
			losses: _learnData.losses || 0,
			winRate: _learnData.games > 0 ? Math.round((_learnData.wins / _learnData.games) * 100) / 100 : 0,
			weightReady: weightReady,
		};
	} catch (e) {
		return { games: 0, wins: 0, losses: 0, winRate: 0, weightReady: false };
	}
}

/* ================= 5. 清空学习数据 ================= */
export function clearLearningData() {
	_learnData = {
		games: 0,
		wins: 0,
		losses: 0,
		weightAdjustments: [],
	};
}
