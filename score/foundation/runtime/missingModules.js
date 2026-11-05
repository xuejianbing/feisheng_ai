/* 旧路径兼容入口：不再包含业务实现或独立状态。新代码从 bootstrap 接入。 */
export { opponentPredict, teamBroadcast, multiturn, economy, cognitiveLog }
    from "../../bootstrap/legacyFeatureInterfaces.js";
