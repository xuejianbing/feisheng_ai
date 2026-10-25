# -*- coding: utf-8 -*-
"""
P1_Mode_Models_Train.py - 任务二：按模式拆分训练策略模型
数据源：E:\\NoNameAI\\merged_shards\\shard_*.json（服务端去重训练池，全部含对局结果标签）
模式：
  - doudizhu-classic（斗地主经典）：21.6 万样本 / 1.6 万局
  - identity（身份场）：约 6 千样本 / 约 1900 局
特征：130/134/142 维统一取前 130 维 -> 剔除 f32~f47 -> 114 维（沿用线上口径）
类别：模式内标签频次 >= 最小支持数（斗地主 200 / 身份场 50），其余归 other
切分：GroupShuffleSplit 按 sessionId 8:2，防同局泄漏
模型：LGBMClassifier 100 树 / 8 叶 / depth 3（与线上一致）
输出：
  E:\\NoNameAI\\model\\SubModel_Policy_doudizhu.pkl
  E:\\NoNameAI\\model\\SubModel_Policy_identity.pkl
  P1_mode_metrics.json
自检：python P1_Mode_Models_Train.py --self-test
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import argparse
import glob
import json
import os
import pickle
import sys
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
SHARD_DIR = r'E:\NoNameAI\merged_shards'
MODEL_DIR = r'E:\NoNameAI\model'
OUT_METRICS = os.path.join(WD, 'P1_mode_metrics.json')
KEEP = list(range(0, 32)) + list(range(48, 130))

MODES = {
    'doudizhu-classic': {'out': 'SubModel_Policy_doudizhu.pkl', 'min_support': 200},
    'identity': {'out': 'SubModel_Policy_identity.pkl', 'min_support': 50},
}

sys.path.insert(0, os.path.join(WD, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report
import lightgbm as lgb


def to_114(f):
    """130/134/142 维 -> 前 130 -> 剔除 f32-f47 -> 114；失败返回 None。"""
    if not isinstance(f, list) or len(f) < 130:
        return None
    return [float(x) for x in (f[:32] + f[48:130])]


def extract_mode_data():
    """扫描全部分片，按 group 收集 (X114, label, sid)。"""
    buckets = {g: {'X': [], 'y': [], 'sids': []} for g in MODES}
    n_total = 0
    n_bad = 0
    for fp in sorted(glob.glob(os.path.join(SHARD_DIR, 'shard_*.json'))):
        with open(fp, 'r', encoding='utf-8') as f:
            obj = json.load(f)
        for s in obj.get('samples', []):
            n_total += 1
            m = s.get('m') or {}
            mc = m.get('modeContext') or {}
            grp = mc.get('group')
            if grp not in MODES:
                continue
            x = to_114(s.get('f'))
            sid = m.get('sessionId')
            aid = m.get('id')
            act = m.get('action')
            if x is None or not sid or not aid or not act:
                n_bad += 1
                continue
            b = buckets[grp]
            b['X'].append(x)
            b['y'].append('%s:%s' % (act, aid))
            b['sids'].append(sid)
        print('  parsed', os.path.basename(fp), '累计', n_total, flush=True)
    print('总扫描 %d，跳过特征/标签缺失 %d' % (n_total, n_bad))
    out = {}
    for g, b in buckets.items():
        out[g] = (
            np.array(b['X'], dtype=np.float32),
            np.array(b['y'], dtype=object),
            np.array(b['sids'], dtype=object),
        )
    return out


def train_mode(group, X, y, sids, min_support):
    lc = collections.Counter(y.tolist())
    explicit = [k for k, v in lc.most_common() if v >= min_support]
    classes = explicit + ['other']
    print('\n' + '#' * 72)
    print('模式 %s：样本 %d，局 %d，显式类别 %d（阈值 %d），总类别 %d'
          % (group, len(y), len(set(sids)), len(explicit), min_support, len(classes)))
    for k in explicit:
        print('  %-24s %7d' % (k, lc[k]))
    n_other = sum(v for k, v in lc.items() if k not in set(explicit))
    print('  %-24s %7d' % ('other', n_other))

    c2i = {c: i for i, c in enumerate(classes)}
    yi = np.array([c2i.get(l, len(classes) - 1) for l in y], dtype=np.int64)

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(gss.split(X, yi, groups=sids))
    tr_cls = set(yi[tr])
    te_valid = np.array([i for i in te if yi[i] in tr_cls])
    print('按局切分: train=%d, test=%d（未见类过滤 %d）'
          % (len(tr), len(te_valid), len(te) - len(te_valid)))

    clf = lgb.LGBMClassifier(
        objective='multiclass', num_class=len(classes),
        n_estimators=100, num_leaves=8, max_depth=3,
        n_jobs=-1, random_state=42, verbosity=-1,
    )
    print('训练中...', flush=True)
    clf.fit(X[tr], yi[tr], callbacks=[lgb.log_evaluation(0)])

    proba = clf.predict_proba(X[te_valid])
    yt = yi[te_valid]                      # 测试集真实类索引（按测试集顺序对齐！）
    order = np.argsort(-proba, axis=1)
    top1 = float(np.mean([y in row for y, row in zip(yt, order[:, :1])]))
    top5 = float(np.mean([y in row for y, row in zip(yt, order[:, :min(5, len(classes))])]))
    pred = clf.classes_[order[:, 0]]
    report = classification_report(
        yi[te_valid], pred, target_names=classes,
        digits=4, zero_division=0, output_dict=True)
    print('\n=== %s 测试集指标 ===' % group)
    print('  Top-1: %.4f   Top-5: %.4f   随机基线 1/%d = %.3f'
          % (top1, top5, len(classes), 1.0 / len(classes)))
    print('  macro-F1: %.4f  weighted-F1: %.4f'
          % (report['macro avg']['f1-score'], report['weighted avg']['f1-score']))
    print('  %-24s %9s %9s %9s' % ('class', 'precision', 'recall', 'support'))
    for c in classes:
        r = report[c]
        print('  %-24s %9.4f %9.4f %9d'
              % (c, r['precision'], r['recall'], int(r['support'])))

    pack = {
        'model': clf,
        'classes': classes,
        'feature_keep': KEEP,
        'feature_dim': 114,
        'mode': group,
        'source': 'E:\\NoNameAI\\merged_shards (dedup pool)',
        'min_support': min_support,
        'metrics': {
            'top1': top1, 'top5': top5,
            'macro_f1': report['macro avg']['f1-score'],
            'weighted_f1': report['weighted avg']['f1-score'],
            'train_samples': int(len(tr)), 'test_samples': int(len(te_valid)),
            'total_samples': int(len(y)), 'sessions': int(len(set(sids))),
            'class_count': len(classes),
        },
    }
    return pack, classes, lc, report


def main_train():
    data = extract_mode_data()
    results = {}
    for group, cfg in MODES.items():
        X, y, sids = data[group]
        pack, classes, lc, report = train_mode(group, X, y, sids, cfg['min_support'])
        out_path = os.path.join(MODEL_DIR, cfg['out'])
        os.makedirs(MODEL_DIR, exist_ok=True)
        with open(out_path, 'wb') as f:
            pickle.dump(pack, f)
        print('模型已保存:', out_path)
        results[group] = {
            'path': out_path,
            'classes': classes,
            'label_counts': {k: lc[k] for k in classes},
            'metrics': pack['metrics'],
            'report': report,
        }
    with open(OUT_METRICS, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print('\n指标已保存:', OUT_METRICS)


def selfTest():
    try:
        data = {}
        ok_all = True
        for group, cfg in MODES.items():
            p = os.path.join(MODEL_DIR, cfg['out'])
            with open(p, 'rb') as f:
                pack = pickle.load(f)
            clf = pack['model']
            x = np.zeros((1, 114), dtype=np.float32)
            proba = clf.predict_proba(x)[0]
            i = int(np.argmax(proba))
            ok = (len(pack['classes']) == clf.n_classes_
                  and abs(float(proba.sum()) - 1.0) < 1e-6)
            ok_all = ok_all and ok
            data[group] = {'classes': len(pack['classes']),
                           'top_action': str(pack['classes'][i]),
                           'top_prob': float(proba[i]),
                           'metrics': pack['metrics']}
        return {'ok': ok_all, 'msg': '分模式模型自检', 'data': data}
    except Exception as e:
        return {'ok': False, 'msg': '分模式模型自检异常: %s' % e, 'data': None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        r = selfTest()
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r['ok'] else 1
    main_train()
    return 0


if __name__ == '__main__':
    sys.exit(main())
