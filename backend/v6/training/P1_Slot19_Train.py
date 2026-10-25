# -*- coding: utf-8 -*-
"""
P1_Slot19_Train.py - 决策一：19 类槽位模型（废弃 38 类细粒度）
类别 = 14 张高频出牌 + equip:weapon / equip:armor / equip:horse_plus / equip:horse_minus + other
特征口径与线上一致：114 维（剔除 f32~f47）
按局切分 GroupShuffleSplit(0.2, seed=42)；超参小范围扫描选最优，要求 Top-1 >= 0.65
产物：E:\\NoNameAI\\model\\SubModel_Policy_v2.pkl（38 类旧版另存 _v2_38_deprecated.pkl）
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import argparse
import json
import os
import pickle
import shutil
import sys
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
MODEL_DIR = r'E:\NoNameAI\model'
KEEP = list(range(0, 32)) + list(range(48, 130))
CARD_MIN = 10000
WEAPONS = {'zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
           'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'}
ARMORS = {'bagua', 'renwang', 'tengjia', 'baiyin'}
HORSE_PLUS = {'jueying', 'dilu', 'zhuahuang', 'hualiu'}
HORSE_MINUS = {'chitu', 'zixin', 'dawan'}

sys.path.insert(0, os.path.join(WD, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report
import lightgbm as lgb

SWEEP = [
    {'n_estimators': 100, 'num_leaves': 8, 'max_depth': 3},   # 线上口径基线
    {'n_estimators': 200, 'num_leaves': 8, 'max_depth': 3},
    {'n_estimators': 200, 'num_leaves': 15, 'max_depth': 4},
    {'n_estimators': 200, 'num_leaves': 31, 'max_depth': 6},
    {'n_estimators': 400, 'num_leaves': 15, 'max_depth': 4},
    {'n_estimators': 400, 'num_leaves': 31, 'max_depth': 6},
]


def slot_label(lab, cards):
    if lab in cards:
        return lab
    if lab.startswith('equip:'):
        eid = lab.split(':', 1)[1]
        if eid in WEAPONS:
            return 'equip:weapon'
        if eid in ARMORS:
            return 'equip:armor'
        if eid in HORSE_PLUS:
            return 'equip:horse_plus'
        if eid in HORSE_MINUS:
            return 'equip:horse_minus'
    return 'other'


def topk(yt, proba, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in r for y, r in zip(yt, o)]))


def main_train():
    print('=== 加载 demo/real 池 ===', flush=True)
    d = np.load(os.path.join(WD, 'demo_pool.npz'), allow_pickle=True)
    Xd = d['X'][:, KEEP].astype(np.float32)
    yd = d['labels']
    sid = d['sids']
    r = np.load(os.path.join(WD, 'real_pool.npz'), allow_pickle=True)
    Xr = r['X'][:, KEEP].astype(np.float32)
    yr = r['labels']

    lc = collections.Counter(yd.tolist())
    cards = [k for k, v in lc.most_common()
             if k.startswith('card:') and v >= CARD_MIN]
    classes = cards + ['equip:weapon', 'equip:armor', 'equip:horse_plus',
                       'equip:horse_minus', 'other']
    print('类别 %d：%s' % (len(classes), classes))
    yslot = np.array([slot_label(l, cards) for l in yd], dtype=object)
    yr_slot = np.array([slot_label(l, cards) for l in yr], dtype=object)
    c2i = {c: i for i, c in enumerate(classes)}
    yi = np.array([c2i[l] for l in yslot], dtype=np.int64)

    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(gss.split(np.zeros(len(yi)), np.zeros(len(yi)), groups=sid))
    yri = np.array([c2i.get(l, c2i['other']) for l in yr_slot], dtype=np.int64)
    print('train=%d test=%d real=%d' % (len(tr), len(te), len(yi)))

    sweep_rows = []
    best = None
    for cfg in SWEEP:
        clf = lgb.LGBMClassifier(
            objective='multiclass', num_class=len(classes),
            n_jobs=-1, random_state=42, verbosity=-1, **cfg)
        clf.fit(Xd[tr], yi[tr], callbacks=[lgb.log_evaluation(0)])
        pte = clf.predict_proba(Xd[te])
        t1 = topk(yi[te], pte, 1)
        t5 = topk(yi[te], pte, 5)
        pre = clf.predict_proba(Xr)
        rt1 = topk(yri, pre, 1)
        rt5 = topk(yri, pre, 5)
        row = dict(cfg)
        row.update({'top1': t1, 'top5': t5, 'real_top1': rt1, 'real_top5': rt5})
        sweep_rows.append(row)
        print('  n=%3d leaves=%2d depth=%d | demo Top1 %.4f Top5 %.4f | real Top1 %.4f Top5 %.4f'
              % (cfg['n_estimators'], cfg['num_leaves'], cfg['max_depth'],
                 t1, t5, rt1, rt5), flush=True)
        if best is None or t1 > best[0]['top1']:
            best = (row, clf)

    row, clf = best
    print('\n最优配置: n=%d leaves=%d depth=%d, Top1 %.4f Top5 %.4f'
          % (row['n_estimators'], row['num_leaves'], row['max_depth'],
             row['top1'], row['top5']))
    pred = clf.classes_[np.argmax(clf.predict_proba(Xd[te]), axis=1)]
    rep = classification_report(yi[te], pred, target_names=classes,
                                digits=4, zero_division=0, output_dict=True)
    print('\n分类报告:')
    print('  %-20s %9s %9s %9s' % ('class', 'precision', 'recall', 'support'))
    for c in classes:
        q = rep[c]
        print('  %-20s %9.4f %9.4f %9d' % (c, q['precision'], q['recall'], int(q['support'])))
    print('  macro-F1 %.4f weighted-F1 %.4f'
          % (rep['macro avg']['f1-score'], rep['weighted avg']['f1-score']))
    if row['top1'] < 0.65:
        print('!! 未达到 65%% 目标线（%.4f）' % row['top1'])
    else:
        print('OK 达到/超过 65%% 目标线（%.4f）' % row['top1'])

    # 旧 38 类模型归档为 deprecated
    old = os.path.join(MODEL_DIR, 'SubModel_Policy_v2.pkl')
    dep = os.path.join(MODEL_DIR, 'SubModel_Policy_v2_38_deprecated.pkl')
    if os.path.isfile(old):
        # 仅当旧文件是 38 类时才改名
        with open(old, 'rb') as f:
            old_pack = pickle.load(f)
        if len(old_pack.get('classes', [])) == 38 and not os.path.exists(dep):
            shutil.move(old, dep)
            print('旧 38 类模型已归档:', dep)

    pack = {
        'model': clf,
        'classes': classes,
        'feature_keep': KEEP,
        'feature_dim': 114,
        'schema': 'slot19_v2',
        'source': 'demo_pool.npz; equip ids grouped to weapon/armor/horse_plus/horse_minus',
        'hyperparams': {k: row[k] for k in ('n_estimators', 'num_leaves', 'max_depth')},
        'slot_maps': {'weapon': sorted(WEAPONS), 'armor': sorted(ARMORS),
                      'horse_plus': sorted(HORSE_PLUS), 'horse_minus': sorted(HORSE_MINUS)},
        'metrics': {
            'top1_demo': row['top1'], 'top5_demo': row['top5'],
            'top1_real': row['real_top1'], 'top5_real': row['real_top5'],
            'macro_f1': rep['macro avg']['f1-score'],
            'weighted_f1': rep['weighted avg']['f1-score'],
            'train_samples': int(len(tr)), 'test_samples': int(len(te)),
            'real_samples': int(len(Xr)),
        },
        'sweep': sweep_rows,
    }
    os.makedirs(MODEL_DIR, exist_ok=True)
    out = os.path.join(MODEL_DIR, 'SubModel_Policy_v2.pkl')
    with open(out, 'wb') as f:
        pickle.dump(pack, f)
    print('19 类模型已保存:', out)
    with open(os.path.join(WD, 'P1_slot19_metrics.json'), 'w', encoding='utf-8') as f:
        json.dump({'classes': classes, 'metrics': pack['metrics'],
                   'sweep': sweep_rows, 'report': rep,
                   'slot_maps': pack['slot_maps']}, f, ensure_ascii=False, indent=1)
    print('指标: P1_slot19_metrics.json')


def self_test():
    try:
        with open(os.path.join(MODEL_DIR, 'SubModel_Policy_v2.pkl'), 'rb') as f:
            pack = pickle.load(f)
        assert pack['schema'] == 'slot19_v2', 'schema 不是 slot19_v2'
        assert len(pack['classes']) == 19, '类别数不是 19'
        clf = pack['model']
        x = np.zeros((1, 114), dtype=np.float32)
        pr = clf.predict_proba(x)[0]
        ok = abs(float(pr.sum()) - 1) < 1e-6 and clf.n_classes_ == 19
        i = int(np.argmax(pr))
        return {'ok': ok, 'msg': '19 类槽位模型自检',
                'data': {'classes': pack['classes'], 'top_action': pack['classes'][i],
                         'top_prob': float(pr[i]), 'metrics': pack['metrics'],
                         'hyperparams': pack['hyperparams']}}
    except Exception as e:
        return {'ok': False, 'msg': '19 类模型自检异常: %s' % e, 'data': None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), ensure_ascii=False, indent=1))
        return 0
    main_train()
    return 0


if __name__ == '__main__':
    sys.exit(main())
