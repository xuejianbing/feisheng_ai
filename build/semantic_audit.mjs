/* ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= semantic_audit.mjs（P2-34） =================
 * 游戏专有词表（牌名/身份/阶段）在决策内核 score/ 中的残留审计生成器。
 *
 * 背景：score/verification/semanticAudit.js 曾手工携带 2026-09-27 的陈旧快照
 *      （files=182，而当前 score JS 已 200+），professionalReadiness 却把它
 *      纳入综合就绪度，导致"就绪率"基于过期数据。
 *
 * 规则：
 *  - 本脚本为唯一生成入口：node build/semantic_audit.mjs
 *  - 产物 score/verification/semanticAudit.js 禁止手工修改；
 *  - 发布前必须重跑，files/hits/cleanRate 与当前代码树一致。
 *
 * 计数口径：
 *  - ASCII 牌名/身份/阶段 ID：标识符边界匹配（前后不接 [A-Za-z0-9_]），
 *    避免 'tao' 误命中 'taopao'、'sha' 误命中 'shadow' 之类；
 *  - 中文专有词：直接子串计数；
 *  - 只扫描 score 目录树内全部 .js 文件；注释与字符串中的残留同样计入
 *    （目标就是让"游戏语义"整体下沉为通用博弈语义，注释也应跟进）。
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'score');
const OUT = join(__dirname, '..', 'score', 'verification', 'semanticAudit.js');

/* 基本牌 / 锦囊 / 装备等游戏专有牌名（无名杀 card name 拼音 ID） */
const ASCII_TOKENS = [
    // 基本牌
    'sha', 'huosha', 'leisha', 'shan', 'tao', 'jiu',
    // 锦囊
    'wuxie', 'wugu', 'nanman', 'wanjian', 'taoyuan', 'juedou', 'huogong',
    'jiedao', 'wuzhong', 'shunshou', 'guohe', 'lebu', 'bingliang',
    'tiesuo', 'zhujin', 'lijian', 'sidian', 'fanjian', 'qingnang',
    'guoshi', 'tuxi', 'shuidong', 'qinggang', 'bihu', 'muniuliuma',
    // 身份
    'zhu', 'zhong', 'mingzhong', 'fan', 'nei',
    // 阶段（无名杀 phase* ID）
    'phaseJudge', 'phaseDraw', 'phaseUse', 'phaseRespond',
    'phaseDiscard', 'phaseAfterDiscard',
];

/* 中文专有词（多字术语；不收单字——单字大量出现在通用 UI 文案里，噪声过高） */
const CN_TOKENS = [
    '无懈', '南蛮', '万箭', '决斗', '火攻',
    '借刀', '无中', '顺手', '过河', '兵粮', '乐不', '铁索', '连环',
    '主公', '忠臣', '反贼', '内奸', '明忠',
    '判定阶段', '摸牌阶段', '出牌阶段', '弃牌阶段', '结束阶段',
    '回合外',
];

/* 审计域名归一化：score 下第一层目录；原报告六大域之外的归入实际域名 */
function domainOf(relPath) {
    const parts = relPath.split(sep);
    return parts.length > 1 ? parts[0] : '(root)';
}

function walk(dir, acc) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, acc);
        else if (name.endsWith('.js')) acc.push(p);
    }
    return acc;
}

const files = walk(ROOT, []);
const perFile = [];
const byDomain = {};
let totalHits = 0;

for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let count = 0;
    for (const tok of ASCII_TOKENS) {
        const re = new RegExp('(?<![A-Za-z0-9_])' + tok + '(?![A-Za-z0-9_])', 'g');
        const m = text.match(re);
        if (m) count += m.length;
    }
    for (const cn of CN_TOKENS) {
        let idx = 0;
        while ((idx = text.indexOf(cn, idx)) >= 0) { count++; idx += cn.length; }
    }
    const rel = relative(ROOT, file).split(sep).join('/');
    perFile.push({ file: 'score/' + rel, count });
    if (count > 0) {
        totalHits += count;
        const d = domainOf(relative(ROOT, file));
        byDomain[d] = (byDomain[d] || 0) + count;
    }
}

const legacyFiles = perFile.filter(function (f) { return f.count > 0; }).length;
const cleanFiles = files.length - legacyFiles;
const cleanRate = Math.round(cleanFiles / files.length * 100);
const top = perFile
    .filter(function (f) { return f.count > 0; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 10);

const audit = {
    generated: new Date().toISOString().slice(0, 10),
    files: files.length,
    cleanFiles: cleanFiles,
    legacyFiles: legacyFiles,
    hits: totalHits,
    cleanRate: cleanRate,
    byDomain: byDomain,
    top: top,
};

const body = JSON.stringify(audit, null, '\t');
const banner =
    '/* 本文件由 build/semantic_audit.mjs 自动生成，请勿手工修改。\n' +
    ' * 含义：游戏专有词表（牌名/身份/阶段）在决策内核中的残留审计。\n' +
    ' * 目标：随「适配词表下沉」推进，hits 逐步归零、cleanRate 逐步趋近 100%。\n' +
    ' * 重新生成：node build/semantic_audit.mjs（发布前必须重跑，P2-34）\n' +
    ' */\n';
writeFileSync(OUT, banner + 'export const AUDIT = ' + body + ';\n', 'utf8');

console.log('[semantic_audit] files=' + audit.files + ' hits=' + audit.hits +
    ' legacy=' + audit.legacyFiles + ' cleanRate=' + audit.cleanRate + '% -> ' +
    relative(join(__dirname, '..'), OUT));
