/* 冠军策略配置契约：0/缺省/非法值关闭，正数保留为提权系数。 */
import { eq, loadScore, finish } from './_harness.mjs';

const champion = await loadScore('decision/strategy/championStrategy.js');
eq(champion.resolveChampionBoost(0), 0, '数值0关闭冠军提权');
eq(champion.resolveChampionBoost('0'), 0, '字符串0关闭冠军提权');
eq(champion.resolveChampionBoost(undefined), 0, '未配置时关闭冠军提权');
eq(champion.resolveChampionBoost('3'), 3, '正数枚举字符串保留系数');
eq(champion.resolveChampionBoost(6), 6, '正数数值保留系数');
eq(champion.resolveChampionBoost(-1), 0, '负值按禁用处理');
eq(champion.resolveChampionBoost('bad'), 0, '非法值按禁用处理');
eq(champion.resolveChampionBoost(Infinity), 0, '非有限值按禁用处理');
finish('Champion boost config');
