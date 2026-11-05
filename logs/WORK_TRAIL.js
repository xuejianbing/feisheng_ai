/*
 * ============================================
 * // Autor: Feisheng Original
 * 交流群: 123456789
 * v3.0
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 工作留痕（WORK TRAIL） =================
 * ★ 单一来源：本次会话及近期迭代中，「哪些文件被改动过 + 改动痕迹」。
 *   与 logs/今日修改日志.js（按 phase 描述改动内容）互补：
 *   - 今日修改日志：每条改动「改了什么」
 *   - 本工作留痕  ：每个文件「什么被碰过」，便于追溯具体落点 / 回滚定位
 *
 * 数据组织：CHANGED_FILES = { 文件相对路径: { dates:[改动日期], desc:改动概述 } }
 * 展示：score/config 更新日志区域自动渲染；也可 console.table 查看。
 */

export const WORK_TRAIL = {
    'score/decision/strategy/championStrategy.js': {
        dates: ['2026-09-26'],
        desc: '冠军策略嵌入主键升维(heroId,type,id)、上下文维度泛化(SIM_THRESHOLD=0.78)、上下文维度索引组、按决策点聚合嵌入'
    },
    'score/championStrategy.js': {
        dates: ['2026-09-26'],
        desc: '泛化相似度/_cosine/嵌入聚合(旧路径，兼容引用)'
    },
    'score/engine.js': {
        dates: ['2026-09-26','2026-09-28','2026-09-29'],
        desc: 'aliases: score/decision/engine/engine.js 主引擎。applyChampionRule 传heroId、历史写防抖、结算连招固化、负收益样本采集、__DJSC.comboChain 挂载'
    },
    'score/decision/engine/engine.js': {
        dates: ['2026-09-26','2026-09-27','2026-09-28','2026-09-29'],
        desc: '主引擎：全量 import 对齐、结算 finalizeLearned、负收益进样本(遍历候选压负分动作)、targetBrainScore 别名、deepThink 挂载'
    },
    'score/modelState.js': {
        dates: ['2026-09-26'],
        desc: '挂载 champion 容器(recompute/stats)'
    },
    'score/trainExport.js': {
        dates: ['2026-09-26','2026-09-29'],
        desc: 'IndexedDB 单例、样本 meta.negative 标记、exportAsJson minReward 改 -Infinity 全量导出'
    },
    'score/model/train/trainExport.js': {
        dates: ['2026-09-26','2026-09-29'],
        desc: '训练工具：IndexedDB 单例、负样本 negative 标记、全量导出不过滤'
    },
    'score/storage.js': {
        dates: ['2026-09-26'],
        desc: '中央存储抽象 safeGet/safeSet/getJSON/setJSON、防抖写、配额超限降级'
    },
    'score/mem.js': {
        dates: ['2026-09-26'],
        desc: '接入 storage.js 统一读写 + 记忆自动裁剪'
    },
    'score/cache.js': {
        dates: ['2026-09-26'],
        desc: '状态指纹增强(牌堆对数分桶+当前阶段)'
    },
    'score/foundation/storage/cache.js': {
        dates: ['2026-09-26'],
        desc: '缓存指纹增强'
    },
    'score/decision/threat/threat.js': {
        dates: ['2026-09-27'],
        desc: '修复 threatOf 恒为1、概率化伤害、多步规划资源 take() 消耗'
    },
    'score/decision/basic/judgeBrain.js': {
        dates: ['2026-09-27'],
        desc: '主动技能/判定目标决策细化'
    },
    'score/perception/observer/identity.js': {
        dates: ['2026-09-27','2026-09-28'],
        desc: '已阵亡阵营反推辅助函数 + 反贼/内奸上限剔除信念、主谋误解救修正'
    },
    'score/decision/strategy/comboChain.js': {
        dates: ['2026-09-28','2026-09-29'],
        desc: '连招学习机制：SESSION 高分登记、finalizeLearned 按胜负固化、exportAllChains 全维度导出、importChains 回流、learnChainUse 权重刷新'
    },
    'score/decision/skills/skillScanner.js': {
        dates: ['2026-09-28'],
        desc: '技能源码扫描(仅导出 scanObjectMethod)'
    },
    'score/decision/skills/skills.js': {
        dates: ['2026-09-28'],
        desc: 'scanCharacters 定义于此、技能标签/聚合/自动规则'
    },
    'score/plugins/skillPlugin.js': {
        dates: ['2026-09-29'],
        desc: '修复命名导出：scanCharacters 改从 skills.js 导入(原错误从 skillScanner.js)'
    },
    'score/plugins/cognitionPlugin.js': {
        dates: ['2026-09-29'],
        desc: '引用 pluginOverview 做插件状态总览'
    },
    'score/foundation/runtime/plugins.js': {
        dates: ['2026-09-29'],
        desc: '补全缺导出：新增 pluginOverview()(total/installed/list)'
    },
    'score/foundation/io/mergeExport.js': {
        dates: ['2026-09-29'],
        desc: '一键合并导出新增 modules.comboLibrary(结构化全维度)、summary.comboLibraryCount'
    },
    'score/foundation/storage/storagePaths.js': {
        dates: ['2026-09-29'],
        desc: '落盘路径统一 extension/无名AI/data，首次导出自动建 data 目录'
    },
    'js/config/config.js': {
        dates: ['2026-09-29'],
        desc: '导出/导入入口并入连招库、核心主面板配置项'
    },
    'js/config/changelog.js': {
        dates: ['2026-09-29'],
        desc: '更新日志标题日期、单源渲染今日修改日志 + WORK_TRAIL 工作留痕'
    },
    'logs/今日修改日志.js': {
        dates: ['2026-09-26','2026-09-27','2026-09-28','2026-09-29'],
        desc: '单源更新日志：完整覆盖 09.13~09.29 全量 phase 改动'
    },
    'logs/WORK_TRAIL.js': {
        dates: ['2026-09-29'],
        desc: '工作留痕：文件→日期→改动痕迹清单(本文件)'
    },
    'extension.js': {
        dates: ['2026-09-29'],
        desc: '根治旧 WebView 加载 SyntaxError：移除模块顶层 await，改异步 IIFE 读 info.json 合并进 package'
    },
    'score/decision/tuning/endgameOpt.js': {
        dates: ['2026-09-29'],
        desc: '残局策略细化：覆盖1v1/1v2/2v1/2v2，新增斩杀线、攻击距离可达、濒死队友优先救、手牌结构研判维度'
    }
};

/* 打印工作留痕 */
export function printWorkTrail() {
    console.log('=== 无名AI · 工作留痕 ===');
    Object.keys(WORK_TRAIL).forEach(function (f) {
        const r = WORK_TRAIL[f];
        console.log('· [' + r.dates.join(',') + '] ' + f + ' → ' + r.desc);
    });
}

if (typeof window !== 'undefined') {
    try {
        window.__WORK_TRAIL__ = WORK_TRAIL;
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}