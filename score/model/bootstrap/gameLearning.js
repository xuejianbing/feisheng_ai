/* 职责：局末知识贡献、对手记忆和软指标学习。保持原全局 game 解析语义，不另改胜负判断。 */
import { shareContribute } from '../../perception/knowledge/sharedKnowledge.js';
import { rememberGame } from '../../perception/memory/playerMemory.js';
import { learnFromGame } from '../../cognition/reasoning/softMetrics.js';
function _swallow(e) { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {} }

export function recordGameLearning() {
    /* ★ 公共知识库贡献：记录这局的结果 */
    try {
        const me = (typeof game !== 'undefined' && game.me) ? game.me : null;
        if (me) {
            const won = (me.isDead && !me.isDead()) || (typeof me.isAlive === 'function' && me.isAlive());
            shareContribute(me, { type: 'gameEnd', id: won ? 'win' : 'lose' }, { win: won });
            
            /* ★ 对手记忆：记录所有存活玩家 */
            const alivePlayers = (game.players || []).filter(function (p) {
                return p && p.alive !== false && p !== me;
            });
            alivePlayers.forEach(function (p) {
                try {
                    rememberGame(p, { games: 1, won: false });
                } catch (e) { _swallow(e); }
            });
            
            /* ★ 软指标学习：根据这局结果学习 */
            try {
                learnFromGame({ won: won, hp: me.hp || 0 });
            } catch (e) { _swallow(e); }
        }
    } catch (e) { _swallow(e); }


}
