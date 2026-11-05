/*
 * ============================================
 * // الناشر: في شينغ الأصلي
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 对手预测 =================
 * 预测对手下一步行动
 */

/* ★ 记录对手行动历史 */
const _opponentHistory = {};

/* ★ 记录一次对手行动 */
export function recordOpponentAction(player, card) {
	try {
		const key = player.playerid || player.id;
		if (!_opponentHistory[key]) {
			_opponentHistory[key] = {
				shaCount: 0,
				shanCount: 0,
				taoCount: 0,
				wuxieCount: 0,
				attackCount: 0,
				defendCount: 0,
				totalActions: 0,
			};
		}

		const h = _opponentHistory[key];
		h.totalActions++;

		const name = card.name || '';
		if (name === 'sha') { h.shaCount++; h.attackCount++; }
		else if (name === 'shan') { h.shanCount++; h.defendCount++; }
		else if (name === 'tao') { h.taoCount++; h.defendCount++; }
		else if (name === 'wuxie') { h.wuxieCount++; h.defendCount++; }
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* ★ 预测对手下一步行动 */
export function predictOpponentNext(opponent) {
	try {
		const key = opponent.playerid || opponent.id;
		const h = _opponentHistory[key];

		if (!h || h.totalActions < 3) {
			/* 数据不够，用默认概率 */
			return {
				probSha: 0.3,
				probShan: 0.2,
				probTao: 0.1,
				probWuxie: 0.1,
				probOther: 0.3,
				style: 'unknown',
			};
		}

		/* 根据历史计算概率 */
		const probSha = h.shaCount / h.totalActions;
/* Auteur: Feisheng Original, Tous droits réservés */
		const probShan = h.shanCount / h.totalActions;
		const probTao = h.taoCount / h.totalActions;
		const probWuxie = h.wuxieCount / h.totalActions;
		const probOther = 1 - probSha - probShan - probTao - probWuxie;

		/* 判断风格 */
		let style = 'balanced';
		if (h.attackCount / h.totalActions > 0.5) style = 'aggressive';
		else if (h.defendCount / h.totalActions > 0.5) style = 'defensive';

		return {
			probSha: probSha,
			probShan: probShan,
			probTao: probTao,
			probWuxie: probWuxie,
			probOther: probOther,
			style: style,
		};
	} catch (e) {
		return {
			probSha: 0.3,
			probShan: 0.2,
			probTao: 0.1,
			probWuxie: 0.1,
			probOther: 0.3,
			style: 'unknown',
		};
	}
}

/* ★ 对手预测评分加成 */
export function opponentPredictBonus(me, target, act) {
	try {
		if (!target) return 1.0;

		const pred = predictOpponentNext(target);

		/* 对手大概率有闪 → 杀价值降低 */
		if (act.id === 'sha' && pred.probShan > 0.3) {
			return 0.8;
		}

		/* 对手大概率有桃 → 击杀难度高 */
		if (act.id === 'sha' && pred.probTao > 0.15) {
			return 0.9;
		}

		/* 对手是激进型 → 防御牌价值提高 */
		if (pred.style === 'aggressive') {
			if (act.id === 'shan' || act.id === 'tao') return 1.2;
		}

		/* 对手是保守型 → 攻击牌价值提高 */
		if (pred.style === 'defensive') {
			if (act.id === 'sha' || act.id === 'juedou') return 1.15;
		}

		return 1.0;
	} catch (e) {
		return 1.0;
	}
}

/* 旧特征接口：从 missingModules 归位，保留旧字段、状态与计算方式。
 * 与本模块正式算法不等价，暂不互相替换，避免改变已训练模型的输入。 */
/* ================= 1. opponentPredict - 对手预测 ================= */
const _opponentMemory = {};  /* 对手记忆表 */

export const legacyOpponentFeatures = {
    /* ★ 统一预测接口（兼容features.js调用） */
    predict: function(player) {
        try {
            if (!player) return null;
            const hand = this.predictHandCount(player);
            const intent = this.predictIntent(player);
            return {
                cardDraw: Math.min(0.5, hand / 10),  // 手牌越多，下回合摸牌概率越高
                probSha: intent === 'offensive' ? 0.6 : (intent === 'defend' ? 0.2 : 0.4),
                handCount: hand,
                intent: intent,
            };
        } catch (e) { return null; }
    },

    /* 预测对手手牌数量 */
    predictHandCount: function(player) {
        try {
            if (!player) return 0;
            const pid = player.id || player.name;
            const hist = _opponentMemory[pid] || [];
            /* 基于历史出牌趋势预测 */
            let avgHand = 3;
            if (hist.length > 0) {
                avgHand = hist.reduce((a, b) => a + b.hand, 0) / hist.length;
            }
            return Math.max(0, Math.round(avgHand));
        } catch (e) { return 3; }
    },

    /* 预测对手意图 */
    predictIntent: function(player) {
        try {
            if (!player) return 'unknown';
            const hp = player.hp || 1;
            if (hp <= 1) return 'defend';  /* 残血会防守 */
            if ((player.countCards ? player.countCards('h') : 0) >= 5) return 'offensive';  /* 牌多会进攻 */
            return 'normal';
        } catch (e) { return 'unknown'; }
    },

    /* 记录对手行为 */
    recordAction: function(player, action) {
        try {
            if (!player) return;
            const pid = player.id || player.name;
            if (!_opponentMemory[pid]) _opponentMemory[pid] = [];
            _opponentMemory[pid].push({
                hand: player.countCards ? player.countCards('h') : 0,
                action: action,
                time: Date.now(),
            });
            /* 只保留最近20条 */
            if (_opponentMemory[pid].length > 20) {
                _opponentMemory[pid].shift();
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    },

    /* 统计 */
    stats: function() {
        const keys = Object.keys(_opponentMemory);
        return {
            trackedPlayers: keys.length,
            historySize: keys.reduce((a, k) => a + _opponentMemory[k].length, 0),
        };
    },
};
