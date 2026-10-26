# -*- coding: utf-8 -*-
"""
P1_Policy_v2_Train.py - 任务一：策略模型分类扩维（出牌 + 高频装备 + other）
数据源：demo_pool.npz（aggregate 原始数据，玩家演示，与线上 minimal_clean 同口径）
       real_pool.npz（真实对局，仅作域外验证，不参与训练）
特征：130 维 -> 剔除 f32~f47 动作泄露区 -> 114 维纯净特征（沿用线上口径）
类别（按 demo 池频次自然断层）：
  - 高频出牌：频次 >= 10000（14 类，sha/tiesuo/tao/.../wugu）
  - 高频装备：频次 >= 1000（23 类核心装备，muniu 3760 后断层到 fh_yinyueqiang 757）
  - other：其余全部
切分：GroupShuffleSplit 按 sessionId 8:2，防同局泄漏
模型：LGBMClassifier 100 树 / 8 叶 / depth 3（与线上一致）
输出：E:\\NoNameAI\\model\\SubModel_Policy_v2.pkl
      P1_v2_metrics.json（类别清单与全部指标）
自检：python P1_Policy_v2_Train.py --self-test
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import argparse
import json
import os
import pickle
import sys
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
OUT_MODEL = r'E:\NoNameAI\model\SubModel_Policy_v2.pkl'
OUT_METRICS = os.path.join(WD, 'P1_v2_metrics.json')

# 与线上 Hybrid_Router_v3 完全一致的纯净特征口径
KEEP = list(range(0, 32)) + list(range(48, 130))

CARD_MIN = 10000   # 高频出牌阈值（自然断层：wugu 17383 -> shandian 6212）
EQUIP_MIN = 1000   # 高频装备阈值（自然断层：muniu 3760 -> fh_yinyueqiang 757）

sys.path.insert(0, os.path.join(WD, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report
import lightgbm as lgb


def load_pool(name):
    d = np.load(os.path.join(WD, name + '_pool.npz'), allow_pickle=True)
    X = d['X'][:, KEEP].astype(np.float32)   # 130 -> 114
    y = d['labels']
    sids = d['sids']
    return X, y, sids


def build_classes(y_demo):
    lc = collections.Counter(y_demo.tolist())
    cards = sorted([(k, v) for k, v in lc.items()
                    if k.startswith('card:') and v >= CARD_MIN],
                   key=lambda x: -x[1])
    equips = sorted([(k, v) for k, v in lc.items()
                     if k.startswith('equip:') and v >= EQUIP_MIN],
                    key=lambda x: -x[1])
    classes = [k for k, _ in cards] + [k for k, _ in equips] + ['other']
    return classes, cards, equips


def topk_accuracy(y_idx, proba, k):
    k = min(k, proba.shape[1])
    order = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in row for y, row in zip(y_idx, order)]))


def train():
    print('=== 加载原始池（demo 训练 / real 域外验证）===', flush=True)
    Xd, yd, sid_d = load_pool('demo')
    Xr, yr, sid_r = load_pool('real')
    print('demo X:', Xd.shape, ' real X:', Xr.shape)

    classes, cards, equips = build_classes(yd)
    print('高频出牌 %d 类:' % len(cards))
    for k, v in cards:
        print('  %-20s %8d' % (k, v))
    print('高频装备 %d 类:' % len(equips))
    for k, v in equips:
        print('  %-20s %8d' % (k, v))
    print('总类别数（含 other）: %d' % len(classes))
    c2i = {c: i for i, c in enumerate(classes)}
    other_i = c2i['other']

    def encode(labels):
        return np.array([c2i.get(l, other_i) for l in labels], dtype=np.int64)

    yd_i = encode(yd)
    yr_i = encode(yr)

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(gss.split(Xd, yd_i, groups=sid_d))
    tr_cls = set(yd_i[tr])
    te_valid = np.array([i for i in te if yd_i[i] in tr_cls])
    print('\n按 sessionId 切分: train=%d, test=%d（未见类过滤 %d）'
          % (len(tr), len(te_valid), len(te) - len(te_valid)))

    clf = lgb.LGBMClassifier(
        objective='multiclass', num_class=len(classes),
        n_estimators=100, num_leaves=8, max_depth=3,
        n_jobs=-1, random_state=42, verbosity=-1,
    )
    print('=== 训练 LightGBM：100 树 / 8 叶 / depth3 ===', flush=True)
    clf.fit(Xd[tr], yd_i[tr], callbacks=[lgb.log_evaluation(0)])
    print('训练完成')

    pv = clf.predict_proba(Xd[te_valid])
    pr = clf.predict_proba(Xr)
    top1 = topk_accuracy(yd_i[te_valid], pv, 1)
    top5 = topk_accuracy(yd_i[te_valid], pv, 5)
    top1_real = topk_accuracy(yr_i, pr, 1)
    top5_real = topk_accuracy(yr_i, pr, 5)

    pred_te = clf.classes_[np.argmax(pv, axis=1)]
    pred_real = clf.classes_[np.argmax(pr, axis=1)]
    print('\n' + '=' * 72)
    print('SubModel_Policy_v2 测试集指标（demo 按局切分）')
    print('  Top-1: %.4f   Top-5: %.4f   随机基线 1/%d = %.3f'
          % (top1, top5, len(classes), 1.0 / len(classes)))
    print('  real 域外 Top-1: %.4f   Top-5: %.4f' % (top1_real, top5_real))

    report = classification_report(
        yd_i[te_valid], pred_te, target_names=classes,
        digits=4, zero_division=0, output_dict=True)
    print('\n-- 显式类别（非 other）测试集 precision/recall/support --')
    print('  %-20s %9s %9s %9s' % ('class', 'precision', 'recall', 'support'))
    for c in classes:
        if c == 'other':
            continue
        r = report[c]
        print('  %-20s %9.4f %9.4f %9d'
              % (c, r['precision'], r['recall'], int(r['support'])))
    ro = report['other']
    print('  %-20s %9.4f %9.4f %9d'
          % ('other', ro['precision'], ro['recall'], int(ro['support'])))
    print('  macro-F1: %.4f  weighted-F1: %.4f'
          % (report['macro avg']['f1-score'], report['weighted avg']['f1-score']))

    # 装备类专项汇总（任务一目标：装备是否可判）
    equip_names = [c for c in classes if c.startswith('equip:')]
    eq_idx = [i for i, c in enumerate(clf.classes_) if c in set(equip_names)]
    eq_mask = np.isin(yd_i[te_valid], [c2i[c] for c in equip_names])
    if eq_mask.any():
        yt = yd_i[te_valid][eq_mask]
        pt = pred_te[eq_mask]
        eq_acc = float(np.mean([y in o for y, o in
                                zip(yt, np.argsort(-pv[eq_mask], axis=1)[:, :5])]))
        eq_top1 = float(np.mean(yt == pt))
        print('\n装备样本专项（test 中 %d 条装备）：Top-1 %.4f  Top-5 %.4f'
              % (int(eq_mask.sum()), eq_top1, eq_acc))
    else:
        eq_top1 = eq_acc = None

    os.makedirs(os.path.dirname(OUT_MODEL), exist_ok=True)
    pack = {
        'model': clf,
        'classes': classes,
        'feature_keep': KEEP,
        'feature_dim': 114,
        'source': 'demo_pool.npz (aggregate raw)',
        'thresholds': {'card_min': CARD_MIN, 'equip_min': EQUIP_MIN},
        'metrics': {
            'top1_demo': top1, 'top5_demo': top5,
            'top1_real': top1_real, 'top5_real': top5_real,
            'equip_top1': eq_top1, 'equip_top5': eq_acc,
            'macro_f1': report['macro avg']['f1-score'],
            'weighted_f1': report['weighted avg']['f1-score'],
            'train_samples': int(len(tr)), 'test_samples': int(len(te_valid)),
            'real_samples': int(len(yr)),
        },
    }
    with open(OUT_MODEL, 'wb') as f:
        pickle.dump(pack, f)
    print('\n模型已保存:', OUT_MODEL)

    metrics = {
        'model': OUT_MODEL,
        'classes': classes,
        'card_classes': cards,
        'equip_classes': equips,
        'class_count': len(classes),
        'report': report,
        'metrics': pack['metrics'],
    }
    with open(OUT_METRICS, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=1)
    print('指标已保存:', OUT_METRICS)
    return pack


def selfTest():
    try:
        with open(OUT_MODEL, 'rb') as f:
            pack = pickle.load(f)
        clf = pack['model']
        classes = pack['classes']
        x = np.zeros((1, 114), dtype=np.float32)
        proba = clf.predict_proba(x)[0]
        i = int(np.argmax(proba))
        ok = (len(classes) == clf.n_classes_
              and any(c.startswith('equip:') for c in classes)
              and abs(float(proba.sum()) - 1.0) < 1e-6)
        return {'ok': ok, 'msg': 'SubModel_Policy_v2 自检（含装备类）',
                'data': {'classes': int(len(classes)),
                         'equip_classes': sum(1 for c in classes if c.startswith('equip:')),
                         'top_action': str(classes[i]), 'top_prob': float(proba[i]),
                         'metrics': pack.get('metrics')}}
    except Exception as e:
        return {'ok': False, 'msg': 'SubModel_Policy_v2 自检异常: %s' % e, 'data': None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        r = selfTest()
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r['ok'] else 1
    train()
    return 0


if __name__ == '__main__':
    sys.exit(main())
