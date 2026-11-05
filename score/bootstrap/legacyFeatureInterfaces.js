/* 五组旧特征接口的装配入口。实现与状态由各自业务模块持有。
 * 仅保留旧加载行为；正式接口与旧特征的字段差异需另行验收，不在这里改算法。 */
import { legacyOpponentFeatures as opponentPredict } from "../model/predict/opponentPredict.js";
import { legacyTeamFeatures as teamBroadcast } from "../perception/team/teamBroadcast.js";
import { legacyPlanFeatures as multiturn } from "../decision/strategy/multiturn.js";
import { legacyEconomyFeatures as economy } from "../decision/resource/economy.js";
import { legacyCognitiveFeatures as cognitiveLog } from "../cognition/log/cognitiveLog.js";

export { opponentPredict, teamBroadcast, multiturn, economy, cognitiveLog };

/* ================= 挂载到window.__DJSC ================= */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.opponentPredict = opponentPredict;
    window.__DJSC.teamBroadcast = teamBroadcast;
    window.__DJSC.multiturn = multiturn;
    window.__DJSC.economy = economy;
    window.__DJSC.cognitiveLog = cognitiveLog;
}
