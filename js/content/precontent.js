/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { lib, game, ui, get, ai, _status } from '../shared/utils.js';
import { initAICardOpt } from './optimization.js';
import { registerStartupSkills } from './legacy/startupSkills.js';
import { registerGlobalRules } from './legacy/globalRules.js';
import { registerIdentityRules } from './legacy/identityRules.js';
import './afunction.js';

export function precontent(config, pack) {
	{
// Autor: Feisheng Original | Licença: GPL-3.0
		// 本体版本检测
		let noname = lib.version
				.split('.')
				.slice(1)
				.map((i) => Number(i)),
			min = [11, 1],
			status = false;
		while (noname.length < min.length) {
			noname.push(0);
		}
		for (let i = 0; i < min.length; i++) {
			if (noname[i] < min[i]) {
				status = '您的无名杀版本太低';
				break;
			}
			if (noname[i] > min[i]) {
				break;
			}
		}
		if (typeof status === 'string') {
			alert(status + '，为避免版本不兼容产生不必要的问题，已为您关闭《无名AI》，稍后重启游戏');
			game.saveExtensionConfig('无名AI', 'decisionScore', false);
			game.reload();
		}
	}

	initAICardOpt();
	/* 宿主规则依次注册；具体定义各归其模块，入口不再混写身份策略。 */
	registerStartupSkills();
	registerGlobalRules();
	registerIdentityRules();

}
