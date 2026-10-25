# -*- coding: utf-8 -*-
"""
P1_Slot19_Variants.py - 19 类槽位标签方案的诚实变体对比（决策一达标性验证）
固定最优超参 n=200/leaves=15/depth=4，同一切分（seed 42）：
  V19 = 14牌 + weapon + armor + horse_plus + horse_minus + other（用户拍板方案）
  V18 = 14牌 + weapon + armor + horse(+1/-1 合并) + other
  V17 = 14牌 + weapon + equip_nonweapon(防具+马) + other
  V16 = 14牌 + weapon + other（防具/马并入 other）
  V15 = 14牌 + other（不做装备槽，对照组）
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import json
import os
import sys
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
KEEP = list(range(0, 32)) + list(range(48, 130))
CARD_MIN = 10000
WEAPONS = {'zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
           'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'}
ARMORS = {'bagua', 'renwang', 'tengjia', 'baiyin'}
HORSES = {'jueying', 'dilu', 'zhuahuang', 'hualiu', 'chitu', 'zixin', 'dawan'}

sys.path.insert(0, os.path.join(WD, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import classification_report
import lightgbm as lgb


def slot_of(eid):
    if eid in WEAPONS:
        return 'weapon'
    if eid in ARMORS:
        return 'armor'
    if eid in HORSES:
        return 'horse'
    return 'other'


def variant_label(lab, cards, scheme):
    if lab in cards:
        return lab
    if lab.startswith('equip:'):
        eid = lab.split(':', 1)[1]
        sl = slot_of(eid)
        if scheme == 'V19':
            if eid in WEAPONS:
                return 'equip:weapon'
            if eid in ARMORS:
                return 'equip:armor'
            if eid in {'jueying', 'dilu', 'zhuahuang', 'hualiu'}:
                return 'equip:horse_plus'
            if eid in {'chitu', 'zixin', 'dawan'}:
                return 'equip:horse_minus'
        elif scheme == 'V18':
            if sl == 'weapon':
                return 'equip:weapon'
            if sl == 'armor':
                return 'equip:armor'
            if sl == 'horse':
                return 'equip:horse'
        elif scheme == 'V17':
            if sl == 'weapon':
                return 'equip:weapon'
            if sl in ('armor', 'horse'):
                return 'equip:nonweapon'
        elif scheme == 'V16':
            if sl == 'weapon':
                return 'equip:weapon'
        elif scheme == 'V15':
            return 'other'
    return 'other'


def topk(yt, proba, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in r for y, r in zip(yt, o)]))


def main():
    d = np.load(os.path.join(WD, 'demo_pool.npz'), allow_pickle=True)
    X = d['X'][:, KEEP].astype(np.float32)
    y, sid = d['labels'], d['sids']
    lc = collections.Counter(y.tolist())
    cards = [k for k, v in lc.most_common()
             if k.startswith('card:') and v >= CARD_MIN]
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42).split(
        np.zeros(len(y)), np.zeros(len(y)), groups=sid))
    results = {}
    for scheme in ['V19', 'V18', 'V17', 'V16', 'V15']:
        ysl = np.array([variant_label(l, cards, scheme) for l in y], dtype=object)
        classes = sorted(c for c in set(ysl) if c != 'other') + ['other']
        c2i = {c: i for i, c in enumerate(classes)}
        yi = np.array([c2i[l] for l in ysl], dtype=np.int64)
        clf = lgb.LGBMClassifier(
            objective='multiclass', num_class=len(classes),
            n_estimators=200, num_leaves=15, max_depth=4,
            n_jobs=-1, random_state=42, verbosity=-1)
        clf.fit(X[tr], yi[tr], callbacks=[lgb.log_evaluation(0)])
        p = clf.predict_proba(X[te])
        t1, t5 = topk(yi[te], p, 1), topk(yi[te], p, 5)
        pred = clf.classes_[np.argmax(p, axis=1)]
        rep = classification_report(yi[te], pred, target_names=classes,
                                    digits=4, zero_division=0, output_dict=True)
        slot_rep = {c: {'P': rep[c]['precision'], 'R': rep[c]['recall'],
                        'support': int(rep[c]['support'])}
                    for c in classes if c.startswith('equip')}
        results[scheme] = {'classes': len(classes), 'top1': t1, 'top5': t5,
                           'macro_f1': rep['macro avg']['f1-score'],
                           'weighted_f1': rep['weighted avg']['f1-score'],
                           'slots': slot_rep}
        print('\n=== %s: %d 类 Top1 %.4f Top5 %.4f weighted-F1 %.4f ==='
              % (scheme, len(classes), t1, t5, rep['weighted avg']['f1-score']))
        for c, q in slot_rep.items():
            print('  %-18s P %.3f R %.3f support %d'
                  % (c, q['P'], q['R'], q['support']))
    with open(os.path.join(WD, 'P1_slot19_variants.json'), 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print('\n汇总:')
    for k, v in results.items():
        print('  %s: %d 类 Top1 %.4f Top5 %.4f'
              % (k, v['classes'], v['top1'], v['top5']))


if __name__ == '__main__':
    main()
