import {cfg} from './util.js?v=41a';

// 基础阵营、合法性与伤害判断不经过这些策略开关。
export function versusStrategyEnabled(part) {
    return !!cfg('tacticalOptimization',true)&&!!cfg('versusStrategy',true)&&
        (!part||!!cfg(part,true));
}
