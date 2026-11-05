/* 职责：唯一模型生命周期、候选槽与 A/B 状态；旧 net/modelState 路径仅兼容转出。
 * 存储键、版本、阈值及状态迁移保持不变。 */
import { showToast, showLoading, showTrainingStart } from '../../view/model/trainingFeedback.js';
import { buildTrainingRecommendation } from '../../view/model/trainingRecommendation.js';
import { _snapshotWeights, _cloneSnapshot, _snapToWeights, _snapshotComplete, _normalizeCandidate } from '../weights/modelSnapshot.js';
import { _trainOnSnapshot } from '../train/candidateTraining.js';
import { _championFixAndRecycle, autoRecycleChampion } from '../bootstrap/championLearning.js';
import { recordGameLearning } from '../bootstrap/gameLearning.js';
import { mountModelStateInterface } from '../../bootstrap/modelStateInterface.js';
/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 模型状态机（§8：单一 A/B 状态机，唯一真相源） =================
 * 状态流转：
 *   STABLE ──trainCandidate()──▶ TRAINING(瞬态) ──▶ CANDIDATE ──evaluate()──▶ PROMOTE / DISCARD ──▶ STABLE
 *
 * 不变式（§8）：
 *   STABLE：    active === stable，_candidate === null，_arm === null
 *   CANDIDATE： stable 快照不被破坏（训练后已回滚），_candidate 独立持有，
 *               每局由 hotGameStart 明确分组（candidate 换入 / baseline 保持），
 *               局末 hotRecordABScore 归档分数并精确还原在线模型
 *   PROMOTE：   stable = candidate（换入并持久化），candidate = null，不还原分组备份
 *   DISCARD：   active 还原 stable，candidate = null
 *
 * ★ 本模块已合并原 modelHotSwap.js（热更/A-B 分组）；modelHotSwap.js 现为兼容外壳。
 */

import { bufferSize, bufferClear, getSamples, resetAll, recycleChampionSamples } from '../train/trainExport.js';
import { trainLocalAsync, isTraining } from '../train/localTrainer.js';
import { scoreToLabel, normalizeLabelIndex } from '../train/labelPolicy.js';
// Автор: Фэйшэн Оригинал | Лицензия: GPL-3.0
import {  /* ★ P0-05：候选隔离用快照接口（替代 saveLocalWeights/reloadWeights 链） */
    __snapshotModel, __restoreModel, __applySnapshot, __getMoments, __setMoments,
    saveWeights, getAccuracy, setAccuracy, trainOne,
    __getW1, __getB1, __getW2, __getB2, __getW3, __getB3,
    __getW4, __getB4, __getPr1, __getPr2,
    MODEL_SCHEMA,
} from '../weights/weights.js';
import { log } from '../../foundation/diag/logger.js';  /* ★ 导入日志模块 */
import { cfg } from '../../foundation/config/util.js';  /* ★ 读取配置（learningRate 等） */
import { safeGet as _lsGet, safeSet as _lsSet, safeRemove as _lsRemove } from '../../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

function _swallow(e) { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (e2) {} }

const STORAGE_KEY = 'djsc_model_state';
const STATE_V = 2;   /* ★ v2：合并 modelHotSwap 的候选/A-B 存储（原 djsc_hotswap_v1 一次性迁移） */
const LEGACY_HOTSWAP_KEY = 'djsc_hotswap_v1';
const MIN_SAMPLES = 300;    /* ★ 自动热训练触发门槛 */
const MIN_AB_GAMES = 20;    /* ★ A/B 默认局数（可被配置 modelCandidateGames 覆盖） */
const PROMOTE_GAP = 0.05;   /* ★ 晋升分差门槛（候选均分 − 基线均分） */

/* ★ 主网络结构护栏：唯一来源是 MODEL_SCHEMA（§7），热更/候选只接受同构快照，
 *   杜绝旧 96 维/缺输出层/缺投影快照写回造成权重错位。 */


let _state = 'stable';          // stable / training / candidate
let _gamesSince = 0;            // 稳定期累计局数
let _candidateGames = 0;        // 候选期累计局数
/* ★ P0-05/P0-06：手动训练前抓取的稳定模型快照与基线准确率。
 * 训练在在线权重上原地进行，结束后立即用快照回滚在线模型；
 * 候选另存于 _candidate，A/B 期间在线始终是稳定模型，discard 才真正可回滚。 */
let _stableSnap = null;
let _stableAcc = 0;
/* ★ §8 统一候选槽：{ weights:{w1..pr2 数组}, meta:{createdAt,samples,accuracy,ms,source}, ab:{scores:[]} }
 * 手动 forceTrain 与自动 triggerHotTrain 共用同一候选槽、同一 A/B 分组、同一评估口径。 */
let _candidate = null;
let _abOldScores = [];          // 本 A/B 周期内基线组真实分数
let _promoted = 0;              // 历史晋升次数
let _discarded = 0;             // 历史丢弃次数
/* ★ P1-16：A/B 分组状态。
 * _arm：当前局分组（'candidate' 打候选 / 'baseline' 打在线稳定模型 / null 未分组）。
 * _liveSnap：候选局开始前备份的完整在线模型（含优化器状态），局末记录分数后精确还原。 */
let _arm = null;
let _liveSnap = null;

/* ---------- 模块解析：优先 window 挂载（生产引擎挂载点），兜底静态导入的同一实例 ---------- */
const _wStatic = {
    __getW1, __getB1, __getW2, __getB2, __getW3, __getB3, __getW4, __getB4, __getPr1, __getPr2,
    trainOne, __applySnapshot, __snapshotModel, __restoreModel, __getMoments, __setMoments,
    saveWeights, getAccuracy, setAccuracy,
};
function _wMod() {
    const w = (typeof window !== 'undefined' && window.__DJSC) ? window.__DJSC.__weightsModule : null;
    return (w && typeof w === 'object') ? w : _wStatic;
}
function _teMod() {
    const t = (typeof window !== 'undefined' && window.__DJSC) ? window.__DJSC.__trainExportModule : null;
    return (t && typeof t === 'object') ? t : { bufferSize, getSamples };
}

/* ---------- 快照工具（§7/§8：唯一口径，供候选训练 / 分组换入 / 晋升共用） ---------- */
/* ★ P1-14：快照必须包含主网络全部可训练参数（含 Critic 头 w4/b4、残差投影 pr1/pr2） */
function _avg(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    for (const x of arr) s += x;
    return s / arr.length;
}

/* ★ 候选规范化：持久化/迁移而来的候选必须满足统一结构，否则丢弃（不变式保护） */
/* ---------- 持久化（单一存储键，STATE_V=2） ---------- */
function saveState() {
    try {
        _lsSet(STORAGE_KEY, JSON.stringify({
            v: STATE_V,
            state: _state,
            gamesSince: _gamesSince,
            candidateGames: _candidateGames,
            candidate: _candidate,
            abOldScores: _abOldScores,
            promoted: _promoted,
            discarded: _discarded,
            ts: Date.now(),
        }));
    } catch (e) { _swallow(e); }
}

/* 初始化：读取统一存储 + 一次性迁移 legacy hotSwap 存档 + 不变式修复 */
(function loadState() {
    try {
        const raw = _lsGet(STORAGE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && typeof obj.state === 'string') _state = obj.state;
            if (obj && typeof obj.gamesSince === 'number') _gamesSince = obj.gamesSince;
            if (obj && typeof obj.candidateGames === 'number') _candidateGames = obj.candidateGames;
            if (obj && obj.v >= 2) {
                if (obj.candidate) _candidate = _normalizeCandidate(obj.candidate);
                if (Array.isArray(obj.abOldScores)) _abOldScores = obj.abOldScores;
                if (typeof obj.promoted === 'number') _promoted = obj.promoted;
                if (typeof obj.discarded === 'number') _discarded = obj.discarded;
            }
        }
        /* ★ §8 迁移：原 modelHotSwap 的 v3 存档一次性并入统一状态机，随后删除旧键 */
        const legacy = _lsGet(LEGACY_HOTSWAP_KEY);
        if (legacy) {
            try {
                const obj = JSON.parse(legacy);
                if (obj && obj.v === 3) {
                    if (!_candidate && obj.candidate) _candidate = _normalizeCandidate(obj.candidate);
                    if (_candidate && !_abOldScores.length && obj.ab && Array.isArray(obj.ab.oldScores)) {
                        _abOldScores = obj.ab.oldScores;
                    }
                    _promoted = Math.max(_promoted, obj.promoted || 0);
                    _discarded = Math.max(_discarded, obj.discarded || 0);
                }
            } catch (e) { _swallow(e); }
            try { _lsRemove(LEGACY_HOTSWAP_KEY); } catch (e) { _swallow(e); }
        }
        /* ★ 不变式修复：training 是瞬态，跨会话残留一律回 stable */
        if (_state === 'training') {
            try { log.warn('model', '状态不一致：training 跨会话残留，自动重置为 stable'); } catch (e) { _swallow(e); }
            _state = 'stable';
            _gamesSince = 0;
            saveState();
        }
        /* ★ 不变式修复：candidate 状态必须持有候选，否则回 stable */
        if (_state === 'candidate' && !_candidate) {
            try { log.warn('model', '状态不一致：candidate 但无候选，自动重置为 stable'); } catch (e) { _swallow(e); }
            _state = 'stable';
            _gamesSince = 0;
            _candidateGames = 0;
            saveState();
        }
        /* ★ 不变式修复：候选跨会话存活（含迁移而来）→ 恢复 candidate 状态继续 A/B */
        if (_candidate && _state === 'stable') {
            _state = 'candidate';
            saveState();
        }
    } catch (e) { _swallow(e); }
})();

export function getState() { return _state; }
export function getGamesSince() { return _gamesSince; }

/* ================= 每局结束调用 ================= */
export function onGameEnd() {
    _gamesSince++;

    recordGameLearning();
    /* ★ 自动训练已关闭：改为手动触发，训练时弹窗提示（自动热训练由引擎在局末触发 triggerHotTrain） */
    /* 候选期：计数；评估统一由 hotRecordABScore 按分组分数驱动（§8 单一评估口径） */
    if (_state === 'candidate') {
        _candidateGames++;
        _gamesSince = _candidateGames;  /* ★ 让面板显示候选期局数 */
        saveState();
    }
}

/* ================= A/B 分组（P1-16，原 modelHotSwap 实现并入） ================= */
/* ★ 对局开始时分配 A/B 分组。候选局把候选快照真正换入在线，
 *   使本局打出的分数确实来自候选模型；基线局保持在线稳定模型。
 *   分组按已记录局数交替，保证两组样本数量均衡。
 *   在引擎开局钩子里调用（engine.js installHooks → trainStartGame 旁）。 */
export function hotGameStart() {
    try {
        if (!_candidate) { _arm = null; return; }
        if (_arm) return;  /* 已分组（异常残留），不重复换入 */
        const wm = _wMod();
        if (!wm) { _arm = 'baseline'; return; }
        const candN = _candidate.ab.scores.length;
        const baseN = _abOldScores.length;
        const arm = ((candN + baseN) % 2 === 0) ? 'candidate' : 'baseline';
        if (arm === 'candidate') {
            if (!_snapshotComplete(_candidate.weights) || typeof wm.__snapshotModel !== 'function' || typeof wm.__applySnapshot !== 'function') {
                _arm = 'baseline';
                return;
            }
            _liveSnap = wm.__snapshotModel();  /* 备份完整在线模型（权重+优化器+META） */
            if (wm.__applySnapshot(_candidate.weights) === false) {
                _liveSnap = null;
                _arm = 'baseline';
                return;
            }
            _arm = 'candidate';
        } else {
            _arm = 'baseline';
        }
    } catch (e) { _arm = null; }
}

/* ★ 候选局结束/中断时把在线模型精确还原为分组前备份 */
function _restoreLiveAfterArm() {
    try {
        if (_arm === 'candidate' && _liveSnap) {
            const wm = _wMod();
            if (wm && typeof wm.__restoreModel === 'function') wm.__restoreModel(_liveSnap);
        }
    } catch (e) { _swallow(e); }
    _arm = null;
    _liveSnap = null;
}

/* ★ 局末归档 A/B 分数：按本局实际分组归档——候选局才记入候选，
 *   基线局记入 _abOldScores，杜绝"旧模型打的分记到候选头上"（P1-16）。 */
export function hotRecordABScore(score) {
    try {
        if (!_candidate) { _restoreLiveAfterArm(); return; }
        if (_arm === 'candidate') _candidate.ab.scores.push(score);
        else _abOldScores.push(score);
        _restoreLiveAfterArm();
        saveState();
        if (_candidate && _candidate.ab.scores.length >= _getCandidateGames()) {
            _evaluateCandidate();
        }
    } catch (e) { _swallow(e); }
}

/* ★ 基线均分：优先用本 A/B 周期内真实记录的基线局分数；不足时回退到战报归档 */
function _baselineAvg() {
    try {
        if (_abOldScores.length) return _avg(_abOldScores);
        const ar = (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.getArchive) ? window.__DJSC.getArchive() : [];
        const recent = (ar || []).slice(-_getCandidateGames());
        if (!recent.length) return 0;
        let s = 0;
        recent.forEach(function (g) { s += (g.myScore || 0); });
        return s / recent.length;
    } catch (e) { return 0; }
}

/* ================= 评估候选（§8：唯一评估口径 = 分组实战胜率差） ================= */
function _evaluateCandidate() {
    try {
        if (!_candidate) return;
        const candAvg = _avg(_candidate.ab.scores);
        const oldAvg = _baselineAvg();
        const gap = candAvg - oldAvg;
        const need = _getPromoteGap();
        if (gap >= need) {
            _promoteCore();
        } else {
            _discardCore('分差 ' + (gap * 100).toFixed(1) + '% < ' + (need * 100).toFixed(0) + '%');
        }
    } catch (e) {
        _discardCore('评估异常');
    }
}

/* ★ PROMOTE 不变式：stable = candidate（换入并持久化）；candidate = null；不还原分组备份 */
function _promoteCore() {
    if (!_candidate) return false;
    const meta = _candidate.meta || {};
    const wm = _wMod();
    try {
        /* ★ 结构护栏：候选必须与主网络同构，否则一律不写回（防污染） */
        if (!_snapshotComplete(_candidate.weights)) {
            try { log.warn('model', '候选快照结构不符，已拒绝晋升（防权重错位污染）'); } catch (e) { _swallow(e); }
            _discardCore('快照结构不符');
            return false;
        }
        if (wm && wm.__applySnapshot && wm.__applySnapshot(_candidate.weights) === false) {
            try { log.warn('model', '候选快照被主模型拒绝（维度校验失败）'); } catch (e) { _swallow(e); }
            _discardCore('快照被主模型拒绝');
            return false;
        }
        if (wm) {
            if (typeof meta.accuracy === 'number' && wm.setAccuracy) wm.setAccuracy(meta.accuracy);
            if (wm.saveWeights) wm.saveWeights();
        }
        _promoted++;
        try { log.info('model', '候选模型已晋升（来源 ' + (meta.source || '?') + '，样本 ' + (meta.samples || 0) + '），共晋升 ' + _promoted + ' 次'); } catch (e) { _swallow(e); }
    } catch (e) {
        /* 提升失败：在线仍是稳定模型（未被动过），仅丢弃候选并复位状态 */
        try { log.warn('model', '候选提升失败：' + ((e && e.message) || e) + '，保留稳定模型'); } catch (e2) { _swallow(e2); }
        _discardCore('提升异常');
        return false;
    }
    showToast('模型 A/B 测试通过！\n\n' +
        (typeof meta.accuracy === 'number' ? '新模型准确率：' + (meta.accuracy * 100).toFixed(1) + '%\n\n' : '') +
        '已自动提升为正式模型');
    _candidate = null;
    _abOldScores = [];
    _arm = null; _liveSnap = null;   /* ★ 晋升后在线即候选：清掉分组备份，不要还原回旧模型 */
    _stableSnap = null;
    _stableAcc = 0;
    _state = 'stable';
    _gamesSince = 0;
    _candidateGames = 0;
    saveState();
    /* ★ 固化冠军策略 + 清空样本 + 替换回流（手动/自动候选同一晋升尾流程） */
    _championFixAndRecycle();
    return true;
}

/* ★ DISCARD 不变式：active 还原 stable；candidate = null */
function _discardCore(reason) {
    _discarded++;
    try { log.info('model', '候选模型被丢弃（' + (reason || '未通过 A/B') + '），保留稳定模型'); } catch (e) { _swallow(e); }
    showToast('模型 A/B 测试未通过\n\n保留旧模型，继续积累数据');
    /* ★ P0-05：兜底回滚——A/B 期间在线本就应是稳定模型（训练结束即已回滚），
     * 此处强制还原一次并持久化，覆盖"回滚失败/被其它路径污染"的残留情形。 */
    try {
        if (_stableSnap) {
            if (!__restoreModel(_stableSnap)) throw new Error('稳定快照还原失败');
            saveWeights();
        }
    } catch (e) { try { log.warn('model', 'discard 回滚失败：' + ((e && e.message) || e)); } catch (e2) { _swallow(e2); } }
    _candidate = null;
    _abOldScores = [];
    _stableSnap = null;
    _stableAcc = 0;
    _state = 'stable';
    _candidateGames = 0;
    _restoreLiveAfterArm();   /* ★ 若当前正处于候选局，把在线模型还原回分组前备份 */
    saveState();
    /* 不清样本，继续累积，下轮一起用 */
    /* ★ 每次训练（即便候选未通过）也刷新一次最强冠军并回游老策略 */
    try { autoRecycleChampion(); } catch (eRec) { _swallow(eRec); }
}

/* ★ 固化冠军策略：从本次训练样本里按类型聚合最高价值决策，写入引擎默认偏好；
 *   随后清空样本开始新一轮收集，被替换的旧决策点回流入样本库（不丢失）。 */
/* ================= 自动热训练（原 modelHotSwap.triggerHotTrain 并入） ================= */
export async function triggerHotTrain() {
    try {
        const te = _teMod();
        const wm = _wMod();
        if (!te || !wm || !te.bufferSize || !wm.trainOne) {
            log.warn('hotswap', '训练模块或权重模块未挂载');
            return { ok: false, err: '模块缺失' };
        }
        /* ★ §8 不变式：只有 STABLE 且无候选才允许开训（候选槽唯一） */
        if (_state !== 'stable' || _candidate) {
            return { ok: false, err: '当前状态不允许热训练（' + _state + '）' };
        }
        const sampleN = te.bufferSize();
        if (sampleN < MIN_SAMPLES) {
            return { ok: false, err: '样本不足（' + sampleN + '/' + MIN_SAMPLES + '）' };
        }

        const oldSnapshot = _snapshotWeights(wm);
        const candidateSnapshot = _cloneSnapshot(oldSnapshot);
        await _trainOnSnapshot(candidateSnapshot, te, wm);
        if (!_snapshotComplete(candidateSnapshot)) {
            log.warn('hotswap', '候选训练后快照不完整，放弃登记');
            return { ok: false, err: '候选快照不完整' };
        }

        _candidate = {
            weights: candidateSnapshot,
            meta: { createdAt: Date.now(), samples: sampleN, source: 'auto' },
            ab: { scores: [] },
        };
        _abOldScores = [];
        _state = 'candidate';
        _candidateGames = 0;
        saveState();
        log.info('hotswap', '候选模型已生成（样本 ' + sampleN + '），进入 A/B 测试期');
        return { ok: true, samples: sampleN };
    } catch (e) {
        return { ok: false, err: e.message };
    }
}

/* ★ 候选训练：备份在线权重 → 换入候选副本 → 复用权威训练器 trainOne（GELU+LN+AdamW）
 *   → 抓取训练后参数 → 还原在线权重与优化器状态。
 *   复用单一训练实现，杜绝"自写反向"与主网络错位、污染主模型的问题。 */
/* ================= 配置读取 ================= */
function _getCandidateGames() {
    try { return (typeof cfg === 'function') ? (Number(cfg('modelCandidateGames', 20)) || 20) : 20; }
    catch (e) { return 20; }
}

function _getPromoteGap() {
    try { return ((typeof cfg === 'function') ? (Number(cfg('modelPromoteGap', 5)) || 5) : 5) / 100; }
    catch (e) { return PROMOTE_GAP; }
}

/* ================= A/B 历史 ================= */
function _loadABHistory() {
    try {
        const raw = _lsGet('djsc_ab_scores');
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

/* ★ 每次训练完成即自动固化"最强冠军"并回流被替换的旧决策点。
 * 对齐：无论本次训练是否通过 A/B，都用当前样本重算一次冠军嵌入，
 * 把新晋的最强决策点固化进嵌入池，凡被排挤/替换的旧决策点则回流入样本库继续参与后续训练。
 * 即"每次训练 → 最强冠军老策略回流"。 */
export function recordABScore(score) {
    try {
        const arr = _loadABHistory();
        arr.push(score);
        while (arr.length > 100) arr.shift();
        _lsSet('djsc_ab_scores', JSON.stringify(arr));
    } catch (e) { _swallow(e); }
}

/* ================= 热更状态查询 / 复位（原 modelHotSwap 信息接口并入） ================= */
export function hotSwapStats() {
    const te = _teMod();
    const bufN = te && te.bufferSize ? te.bufferSize() : 0;
    const need = _getCandidateGames();
    return {
        samples: bufN,
        hasCandidate: !!_candidate,
        candidateSamples: _candidate ? (_candidate.meta.samples || 0) : 0,
        candidateAge: _candidate ? Math.round((Date.now() - (_candidate.meta.createdAt || Date.now())) / 1000) : 0,
        abScores: _candidate ? _candidate.ab.scores.slice() : [],
        abOldScores: _abOldScores.slice(),
        abArm: _arm,
        abProgress: _candidate ? (_candidate.ab.scores.length + '/' + need) : '0/0',
        promoted: _promoted,
        discarded: _discarded,
        MIN_SAMPLES: MIN_SAMPLES,
        MIN_AB_GAMES: need,
    };
}

export function resetHotSwap() {
    _restoreLiveAfterArm();  /* ★ 复位前先把候选局占用的在线模型还原 */
    _candidate = null;
    _abOldScores = [];
    _promoted = 0;
    _discarded = 0;
    if (_state === 'candidate') {
        _state = 'stable';
        _candidateGames = 0;
    }
    try { _lsRemove(LEGACY_HOTSWAP_KEY); } catch (e) { _swallow(e); }
    saveState();
}

/* ================= 调试接口 ================= */
export function forceTrain() {
    /* ★ 修复：如果状态是 candidate，先重置回 stable，允许强制重新训练 */
    if (_state === 'candidate') {
        try { log.warn('model', '强制训练：从 candidate 重置回 stable，丢弃当前候选模型'); } catch (e) { _swallow(e); }
        _restoreLiveAfterArm();
        _candidate = null;
        _abOldScores = [];
        _stableSnap = null;
        _stableAcc = 0;
        _state = 'stable';
        _candidateGames = 0;
        saveState();
    }
    if (_state !== 'stable') {
        showToast('当前状态：' + _state + '，无法训练');
        return;
    }
    if (bufferSize() < 200) {
        showToast('样本不足！\n\n当前样本数：' + bufferSize() + '\n需要至少 200 条样本才能训练\n\n请多打几局游戏积累数据');
        return;
    }
    
    /* ★ 弹窗提示：正在训练 */
    showTrainingStart(bufferSize());

    /* ★ P0-05：训练前抓取稳定模型快照（权重+AdamW 动量+META）与基线准确率。
     * trainLocalAsync 会在在线权重上原地训练并自行 saveWeights（持久层也被写入），
     * 因此训练一结束必须立即回滚在线与持久层，候选另存于 _candidate。 */
    try { _stableSnap = __snapshotModel(); } catch (e) { _stableSnap = null; }
    _stableAcc = getAccuracy() || 0;

    _state = 'training';
    saveState();
    showLoading('开始训练...\n\n样本数：' + bufferSize());
    trainLocalAsync(r => {
        /* 训练一结束立即隔离候选并回滚稳定模型（先于 1 秒 UI 延迟，避免持久层滞留候选权重） */
        let candSnap = null;
        if (r && r.ok) {
            try { candSnap = __snapshotModel(); } catch (e) { candSnap = null; }
        }
        try {
            if (_stableSnap) {
                if (!__restoreModel(_stableSnap)) throw new Error('稳定快照还原失败');
                saveWeights();
            }
        } catch (e) { try { log.warn('model', '训练后回滚失败：' + ((e && e.message) || e)); } catch (e2) { _swallow(e2); } }
        /* ★ 延迟 1 秒再显示结果，让用户能看清楚"开始训练" */
        setTimeout(function () {
            /* ★ 训练完成即先做一次"最强冠军固化 + 旧策略回流"（不依赖 A/B 是否通过） */
            try { autoRecycleChampion(); } catch (eRec) { _swallow(eRec); }
            const candWeights = _snapToWeights(candSnap);
            if (r && r.ok && _snapshotComplete(candWeights)) {
                _candidate = {
                    weights: candWeights,
                    meta: { createdAt: Date.now(), samples: r.samples, accuracy: r.accuracy, ms: r.ms, source: 'manual' },
                    ab: { scores: [] },
                };
                _abOldScores = [];
                _state = 'candidate';
                _candidateGames = 0;
                saveState();
                /* ★ 动态推荐：训练完成后直接弹带推荐的提示（不再单独弹纯提示，避免两个弹窗重叠） */
                var toastBase = '模型训练完成！\n\n样本数：' + r.samples + '\n准确率：' + (r.accuracy * 100).toFixed(1) + '%\n耗时：' + r.ms + 'ms\n\n进入 A/B 测试阶段';
                recommend(r.accuracy, r.samples).then(function (rec) {
                    if (rec && rec.indexOf('推荐生成失败') < 0) {
                        showToast(toastBase + '\n\n—— 动态推荐 · 保持学习 ——\n' + rec, 6000);
                    } else {
                        showToast(toastBase);
                    }
                }).catch(function () { showToast(toastBase); });
            } else {
                _state = 'stable';
                saveState();
                showToast('模型训练失败：' + ((r && r.err) || (r && r.ok ? '候选隔离失败' : '未知错误')));
            }
        }, 1000);
    });
}

export function forcePromote() {
    if (!_candidate) {
        showToast('没有候选模型可提升\n\n当前状态：' + _state);
        return { ok: false, err: 'no pending' };
    }
    const okP = _promoteCore();
    return okP ? { ok: true, msg: '提升成功' } : { ok: false, err: 'promote failed' };
}

export function forceDiscard() {
    if (!_candidate) {
        showToast('没有候选模型可丢弃\n\n当前状态：' + _state);
        return { ok: false, err: 'no pending' };
    }
    _discardCore('手动丢弃');
    return { ok: true, msg: '已丢弃' };
}

export function recommend(accArg, nArg) { return buildTrainingRecommendation(accArg, nArg, _state); }
mountModelStateInterface({ getState, getGamesSince, forceTrain, forcePromote, forceDiscard, onGameEnd, hotGameStart, hotRecordABScore, hotSwapStats, resetHotSwap, triggerHotTrain, recommend });
/* ★ §8：导出常量供 modelHotSwap 兼容外壳与引擎使用 */
export { MIN_SAMPLES, MIN_AB_GAMES };
