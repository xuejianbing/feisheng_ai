/* 职责：训练包、备份包、自动导出与文件读写编排；展示结果由面板接收。
 * 既有筛选规则、格式、配置键、文件名和导入语义保持不变。 */
/*
 * ============================================
 * // Penulis: Feisheng Original
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

import { safeGet as _lsGet, safeSet as _lsSet, lsKeys as _lsAllKeys } from '../foundation/storage/storage.js';  /* ★ P2-31：中央存储抽象，业务层禁止直触 localStorage */

/* ================= 决策积分引擎 · 一键导出打包 =================
 * 三种导出模式：
 *   ① 最小蒸馏包（train.jsonl + manifest.json + weights.djscw + meta.json）
 *   ② 完整训练包（A+B+C1+C5）
 *   ③ 全量备份包（24 个单元一键还原）
 * 导出路径：extension/无名AI/data/output/
 * 导入路径：extension/无名AI/data/input/
 * （统一由 core/storagePaths.js 定义，避免多套前缀混用）
 */
import { lib, game, get, _status } from '../foundation/adapt/host.js';
import { log } from '../foundation/diag/logger.js';
import { DIRS } from '../foundation/storage/storagePaths.js';   /* ★ 统一导出路径（唯一来源） */
import { FEATURE_NAMES, FEATURE_DIM } from '../model/features/features.js';
import { getWeights, getBias, getMeta as getWeightMeta, isReady } from '../model/weights/weights.js';
import { getSamples, bufferSize, bufferClear } from '../model/train/trainExport.js';

const OUTPUT_DIR = DIRS.output;   /* extension/无名AI/data/output/ */
const INPUT_DIR = DIRS.input;     /* extension/无名AI/data/input/ */

/* ================= 自动导出配置 ================= */
const AUTO_KEY = 'djsc_auto_export_v1';
let _autoCfg = null;

function _loadAutoCfg() {
    if (_autoCfg) return _autoCfg;
    try {
        const raw = _lsGet(AUTO_KEY);
        _autoCfg = raw ? JSON.parse(raw) : { enabled: false, interval: 10, type: 'distill', lastExport: 0, gameCount: 0 };
    } catch (e) {
        _autoCfg = { enabled: false, interval: 10, type: 'distill', lastExport: 0, gameCount: 0 };
    }
    return _autoCfg;
}
function _saveAutoCfg() {
    try { _lsSet(AUTO_KEY, JSON.stringify(_autoCfg)); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

/* 每局结束后调用，检查是否该自动导出 */
export function autoExportCheck() {
    try {
        const cfg = _loadAutoCfg();
        if (!cfg.enabled) return;
        cfg.gameCount++;
        if (cfg.gameCount >= cfg.interval) {
            cfg.gameCount = 0;
            cfg.lastExport = Date.now();
            _saveAutoCfg();
            if (cfg.type === 'distill') exportDistillPackage();
            else if (cfg.type === 'fulltrain') exportFullTrainingPackage();
            else if (cfg.type === 'backup') exportFullBackup();
            log.info('autoExport', '自动导出完成（类型：' + cfg.type + '）');
        }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}

export function getAutoExportConfig() {
    return _loadAutoCfg();
}

export function setAutoExportConfig(cfg) {
    _autoCfg = Object.assign(_loadAutoCfg(), cfg);
    _saveAutoCfg();
    return _autoCfg;
}

/* ================= 工具函数 ================= */
function _safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback !== undefined ? fallback : null; }
}
function _b64Encode(arr) {
    try {
        let s = '';
        for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i] & 0xff);
        return btoa(s);
    } catch (e) { return ''; }
}
/* ★ P2-31：_lsGet 直接由中央存储抽象提供。
 *   旧桩 `function _lsGet(){ return _lsGet(); }` 是无限递归死代码，已删除。 */
function _lsKeys() {
    /* 只导出本扩展键（djsc_ / 无名AI_ 前缀）；键枚举走中央存储抽象 */
    try {
        return _lsAllKeys().filter(function (k) {
            return k && (k.indexOf('djsc_') === 0 || k.indexOf('无名AI_') === 0);
        });
    } catch (e) { return []; }
}

/* ================= ① 最小蒸馏包（纯 .jsonl 导出） ================= */
export function exportDistillPackage() {
    try {
        const samples = getSamples();
        const lines = [];
        let total = 0, droppedViolation = 0, droppedLowReward = 0;

        for (const s of samples) {
            total++;

            /* ★ 重构：不再用"非法/违规"标记丢弃训练样本。
             * 正负由异步实测(阵营净收益)与冠军策略价值判定，违规硬标记不再拦截样本进训练。 */

            /* ★ 数据清洗：只丢极端低分(异常噪声)，正常样本全进训练 */
            if (typeof s.r === 'number' && s.r < -50) {
                droppedLowReward++;
                continue;
            }

            const row = {
                features: s.f ? s.f.slice() : [],
                reward: s.r || 0,
                meta: s.m || {},
            };
            if (s.logits) row.teacher_logits = s.logits;
            if (s.probs) row.teacher_probs = s.probs;
            lines.push(JSON.stringify(row));
        }

        const jsonl = lines.join('\n');
        const ts = Date.now();

        /* 导出 train.jsonl（纯 jsonl 格式，Python 可直接读） */
        game.writeFile(jsonl, OUTPUT_DIR, 'train_' + ts, function () {
            /* 同时导出 manifest.json */
            const manifest = {
                version: 1,
                exportedAt: new Date().toISOString(),
                featureDim: FEATURE_DIM,
                sampleCount: lines.length,
                totalSamples: total,
                droppedViolation: droppedViolation,
                droppedLowReward: droppedLowReward,
                featureNames: FEATURE_NAMES.slice(),
                labels: ['A', 'B', 'C', 'D', 'E', 'F'],
                structure: { input: FEATURE_DIM, hidden: 64, output: 6, type: 'int8_mlp', scale: 32 },
            };
            game.writeFile(JSON.stringify(manifest, null, 2), OUTPUT_DIR, 'manifest_' + ts, function () {
                /* 同时导出 weights.djscw */
                try {
                    const W1 = getWeights();
                    const B1 = getBias();
                    const meta = getWeightMeta();
                    const wdata = {
                        v: meta.v || 3,
                        trained: meta.trained || 0,
                        accuracy: meta.accuracy || 0,
                        ready: !!meta.ready,
                        w1: _b64Encode(W1),
                        b1: _b64Encode(B1),
                    };
                    game.writeFile(JSON.stringify(wdata), OUTPUT_DIR, 'weights_' + ts, function () {
                        _showExportResult(
                            '✅ 蒸馏包已导出（纯 .jsonl）',
                            OUTPUT_DIR + 'train_' + ts + '.jsonl',
                            lines.length + ' 条样本（丢弃违规 ' + droppedViolation + ' / 低分 ' + droppedLowReward + '）'
                        );
                    });
                } catch (e) {
                    _showExportResult('✅ 蒸馏包已导出', OUTPUT_DIR + 'train_' + ts + '.jsonl', lines.length + ' 条样本');
                }
            });
        });

        return { ok: true, samples: lines.length, total: total, droppedViolation, droppedLowReward };
    } catch (e) {
        return { ok: false, err: e.message };
    }
}

/* ================= ② 完整训练包 ================= */
function _buildFullTrainingPackage() {
    /* 直接构造蒸馏包数据（不调用已删除的 _buildDistillPackage） */
    const samples = getSamples();
    const distillSamples = [];
    for (const s of samples) {
        /* ★ 重构：不再以"非法/违规"标记剔除训练样本；只扔极端低分异常噪声。 */
        if (typeof s.r === 'number' && s.r < -50) continue;
        const row = { features: s.f ? s.f.slice() : [], reward: s.r || 0, meta: s.m || {} };
        if (s.logits) row.teacher_logits = s.logits;
        if (s.probs) row.teacher_probs = s.probs;
        distillSamples.push(row);
    }

    const W1 = _safe(getWeights, []);
    const B1 = _safe(getBias, []);
    const weightMeta = _safe(getWeightMeta, {});

    return {
        meta: { version: 1, exportedAt: new Date().toISOString(), type: 'full_training' },
        distill: {
            meta: { version: 1, featureDim: FEATURE_DIM, sampleCount: distillSamples.length },
            manifest: { featureNames: FEATURE_NAMES.slice(), labels: ['A','B','C','D','E','F'], structure: { input: FEATURE_DIM, hidden: 64, output: 6 } },
            weights: { v: weightMeta.v||3, trained: weightMeta.trained||0, accuracy: weightMeta.accuracy||0, ready: !!weightMeta.ready, w1: _b64Encode(W1), b1: _b64Encode(B1) },
            train: distillSamples,
        },
        metacog: _safe(() => JSON.parse(_lsGet('djsc_metacog_v1') || '{}')),
        calibrator: _safe(() => JSON.parse(_lsGet('djsc_calibrator_v1') || '{}')),
        multiProfile: _safe(() => JSON.parse(_lsGet('djsc_multi_profile_v1') || '{}')),
        archive: _safe(() => JSON.parse(_lsGet('无名AI_archive') || '[]')),
    };
}

/* ================= ③ 全量备份包 ================= */
function _buildFullBackup() {
    const keys = _lsKeys();
    const data = {};
    for (const k of keys) data[k] = _lsGet(k);
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        device: { ua: navigator.userAgent, screen: window.screen ? (window.screen.width + 'x' + window.screen.height) : '' },
        data: data,
    };
}

/* ================= 导出（game.writeFile） ================= */

/* ★ 鸿蒙兼容：带 fallback 的文件写入 */
function _safeWriteFile(content, dir, filename, onSuccess, onFail) {
    try {
        if (typeof game !== 'undefined' && game.writeFile) {
            game.writeFile(content, dir, filename, function () {
                if (onSuccess) onSuccess();
            });
        } else {
            throw new Error('game.writeFile 不可用');
        }
    } catch (e) {
        /* fallback：存到 localStorage */
        try {
            const key = 'djsc_export_' + filename;
            _lsSet(key, content);
            if (onFail) onFail('文件系统不可用，已存到 localStorage（键：' + key + '）');
        } catch (e2) {
            if (onFail) onFail('导出失败：' + e.message);
        }
    }
}

export function exportFullTrainingPackage() {
    const pkg = _buildFullTrainingPackage();
    const json = JSON.stringify(pkg, null, 2);
    const filename = '完整训练包_' + Date.now();
    _safeWriteFile(json, OUTPUT_DIR, filename,
        function () {
            _showExportResult('✅ 完整训练包已导出', OUTPUT_DIR + filename, '含蒸馏+元认知+校准器+战报');
        },
        function (msg) {
            _showExportResult('⚠️ 完整训练包已导出（本地存储）', 'localStorage: djsc_export_' + filename, msg);
        }
    );
    return { ok: true };
}

export function exportFullBackup() {
    const pkg = _buildFullBackup();
    const json = JSON.stringify(pkg, null, 2);
    const filename = '全量备份_' + Date.now();
    _safeWriteFile(json, OUTPUT_DIR, filename,
        function () {
            _showExportResult('✅ 全量备份包已导出', OUTPUT_DIR + filename, Object.keys(pkg.data).length + ' 个键');
        },
        function (msg) {
            _showExportResult('⚠️ 全量备份包已导出（本地存储）', 'localStorage: djsc_export_' + filename, msg);
        }
    );
    return { ok: true };
}

/* ================= 导入还原 ================= */
export function importBackup(filename) {
    game.readFileAsText(INPUT_DIR + filename, function (data) {
        try {
            const pkg = JSON.parse(data);
            if (!pkg || !pkg.data) { _showImportResult('❌ 格式错误'); return; }
            let restored = 0;
            for (const k of Object.keys(pkg.data)) {
                try { _lsSet(k, pkg.data[k]); restored++; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            }
            _showImportResult('✅ 导入完成（还原 ' + restored + ' 个键）\n刷新游戏后生效');
        } catch (e) {
            _showImportResult('❌ 解析失败：' + e.message);
        }
    });
}

/* ================= 列出导出文件 ================= */
export function listExportedFiles() {
    return new Promise(function (resolve) {
        game.getFileList(OUTPUT_DIR, function (folders, files) {
            resolve(files || []);
        }, function () {
            resolve([]);
        });
    });
}

export function listImportableFiles() {
    return new Promise(function (resolve) {
        game.getFileList(INPUT_DIR, function (folders, files) {
            resolve(files || []);
        }, function () {
            resolve([]);
        });
    });
}


let notifications = {};
/* 内部装配接口：只通知结果，不反向导入面板。 */
export function setDataTransferNotifications(handlers) { notifications = handlers; }
function _showExportResult(title, path, detail) {
    if (notifications.exportResult) notifications.exportResult(title, path, detail);
}
function _showImportResult(message) {
    if (notifications.importResult) notifications.importResult(message);
}
export function getTransferOverview() {
    return { sampleN: bufferSize(), weightReady: isReady(), lsKeys: _lsKeys().length };
}
