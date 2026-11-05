/* 职责：记录目标合理性提示；统一持有补丁定时器和还原逻辑。
 * 只迁移既有行为，不改变目标判定规则。 */
import { lib, game, get } from '../../foundation/adapt/host.js';
/* ===== 目标合理性校验（前置校验，不拦截，仅日志） =====
 * ★ P1-25：保存定时器句柄与原始 useCard 引用，扩展卸载时可完整还原，
 *   杜绝"扩展关了补丁还在 / 热重载后旧闭包残留"的永久猴补丁。 */
let _useCardPatchTimer = null;
export function scheduleTargetDiagnostics() {
_useCardPatchTimer = setTimeout(function () {
    _useCardPatchTimer = null;
    try {
        var _p = lib.element.Player.prototype;
        if (_p.__logicCheck) return;
        _p.__logicCheck = true;
        var _o = _p.useCard;
        _p.__djsc_origUseCard = _o;  /* ★ P1-25：保存原函数供卸载还原 */
        var TARGET_RESTRICT_CARDS = ['sha','huosha','leisha','juedou','huogong','nanman','wanjian',
                   'zhujin','jiedao','lijian','shunshou','guohe','lebu','bingliang',
                   'tiesuo','fanjian','sidian'];
        _p.useCard = function (card, cards, target) {
            try {
                var me = this;
                var cn = typeof card === 'string' ? card : (card && (card.name || card.cardname));
                if (cn && TARGET_RESTRICT_CARDS.indexOf(cn) >= 0) {
                    var list = Array.isArray(target) ? target : (target ? [target] : []);
                    for (var i = 0; i < list.length; i++) {
                        var t = list[i];
                        if (!t || typeof t !== 'object' || t === me) continue;
                        var myId = me.identity, tid = t.identity;
                        var isSameFaction = false;
                        if (myId === 'zhu' && (tid === 'zhong' || tid === 'mingzhong')) isSameFaction = true;
                        if ((myId === 'zhong' || myId === 'mingzhong') && tid === 'zhu') isSameFaction = true;
                        if ((myId === 'zhong' || myId === 'mingzhong') && (tid === 'zhong' || tid === 'mingzhong')) isSameFaction = true;
                        if (myId === 'fan' && tid === 'fan') isSameFaction = true;
                        try { if (get.attitude(me, t) > 0) isSameFaction = true; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                        if (isSameFaction) {
                            var exempt = false;
                            try {
                                if (window.__DJSC && window.__DJSC.checkAllyExempt) {
                                    exempt = window.__DJSC.checkAllyExempt(me, t, cn);
                                }
                            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            if (!exempt) {
                                try { game.log('⚠️ 校验：' + cn + ' 对同阵营目标 ' + (t.name1 || t.name) + ' 不推荐'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            } else {
                                try { game.log('✅ 豁免：' + cn + ' 对同阵营目标 ' + (t.name1 || t.name) + ' 合理'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            }
                        }
                    }
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            return _o.apply(me, arguments);
        };
        try { game.log('✅ 目标合理性校验模块已就绪（仅日志，不拦截）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}, 3000);

}

export function uninstallTargetDiagnostics() {
	/* ★ P1-25：还原 Player.prototype.useCard，取消未执行的 3s 补丁定时器 */
	try { if (_useCardPatchTimer) { clearTimeout(_useCardPatchTimer); _useCardPatchTimer = null; } } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		const _p = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (_p && _p.__djsc_origUseCard) {
			_p.useCard = _p.__djsc_origUseCard;
			try { delete _p.__djsc_origUseCard; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			try { delete _p.__logicCheck; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}
