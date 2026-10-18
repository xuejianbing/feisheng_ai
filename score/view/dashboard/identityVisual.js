/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 决策积分引擎 · 身份推理可视化 =================
 * 面板上显示 AI 对每个玩家的身份推理结果
 * 现在有身份推理，但没有可视化
 */
import { lib, game, get, _status } from '../../foundation/adapt/host.js?v=41a';

import {identityView,identityOfFor} from '../../perception/observer/identity.js?v=41a';

/* 不单独猜身份、不按武将名缓存；每次读取统一视图的精确修订号。 */
export function inferIdentity(player, observer = game.me) {
    const view = identityView(observer,player);
    if (!view) return {identity:'unknown',confidence:0,attitude:0,calibrated:false,weightLabel:'推断权重'};
    return {identity:identityOfFor(observer,player),confidence:view.diagnostics.maxProbability,
        attitude:0,calibrated:view.calibrated,weightLabel:'推断权重',view};
}

/* ================= 2. 身份描述 ================= */
export function describeIdentity(identity) {
	try {
		const map = {
			'zhu': { label: '主公', color: 'gold' },
			'zhong': { label: '忠臣', color: 'blue' },
			'fan': { label: '反贼', color: 'red' },
			'nei': { label: '内奸', color: 'purple' },
			'ally': { label: '队友', color: 'green' },
			'enemy': { label: '敌人', color: 'red' },
			'unknown': { label: '未知', color: 'gray' },
		};
		return map[identity] || map.unknown;
	} catch (e) {
		return { label: '未知', color: 'gray' };
	}
}

/* ================= 3. 全员身份概览 ================= */
export function getAllIdentities(me) {
	try {
		const players = game.players || [];
		const result = [];

		players.forEach(function (p) {
			if (!p || p.alive === false) return;

			const id = inferIdentity(p,me);
			const desc = describeIdentity(id.identity);

			result.push({
				name: p.name || p.name1 || '?',
				identity: id.identity,
				identityLabel: desc.label,
				color: desc.color,
				confidence: id.confidence,
                calibrated:id.calibrated,weightLabel:id.weightLabel,view:id.view,
				attitude: id.attitude,
			});
		});

		return result;
	} catch (e) {
		return [];
	}
}

/* ================= 4. 身份推理面板数据 ================= */
export function identityPanelData(me) {
	try {
		const all = getAllIdentities(me);

		return {
			players: all,
			myIdentity: me.identity || 'unknown',
			myIdentityLabel: describeIdentity(me.identity || 'unknown').label,
		};
	} catch (e) {
		return { players: [], myIdentity: 'unknown', myIdentityLabel: '未知' };
	}
}
