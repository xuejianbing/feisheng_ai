/* 职责：创建积分/战报按钮。保留原时机，通过 isCurrent 校验异步代际。 */
import { ui } from '../../foundation/adapt/host.js';
import { openScorePanel } from '../panel/panel.js';
export function mountSystemButtons(isCurrent) {
	try {
		if (ui && ui.create && typeof ui.create.system === "function") {
			ui.create.system("决策积分", function () { try { openScorePanel(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }, true);
			ui.create.system("战报", function () {
				try {
					import('../report/report.js').then(function (m) { if (!isCurrent()) return; try { m.showReport(true); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } }).catch(function () {});
				} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			}, true);
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
