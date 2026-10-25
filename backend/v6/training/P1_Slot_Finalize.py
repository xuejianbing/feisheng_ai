# -*- coding: utf-8 -*-
"""
P1_Slot_Finalize.py - 保存候选槽位模型（V19/V17/V16）到 E:/NoNameAI/model，不部署、不覆盖线上
每个模型含 classes/feature_keep/hyperparams/threshold，schema=slot1X_v2
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import json
import os
import sys
import pickle
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
MODEL_DIR = r'E:\NoNameAI\model'
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


def label_of(lab, cards, scheme):
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
        elif scheme == 'V17':
            if sl == 'weapon':
                return 'equip:weapon'
            if sl in ('armor', 'horse'):
                return 'equip:nonweapon'
        elif scheme == 'V16':
            if sl == 'weapon':
                return 'equip:weapon'
    return 'other'


def topk(yt, proba, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in r for y, r in zip(yt, o)]))


def main():
    schemes = {'V19': 'SubModel_Policy_slot19.pkl',
               'V17': 'SubModel_Policy_slot17.pkl',
               'V16': 'SubModel_Policy_slot16.pkl'}
    d = np.load(os.path.join(WD, 'demo_pool.npz'), allow_pickle=True)
    Xd = d['X'][:, KEEP].astype(np.float32)
    yd, sidd = d['labels'], d['sids']
    dr = np.load(os.path.join(WD, 'real_pool.npz'), allow_pickle=True)
    Xr, yr = dr['X'][:, KEEP].astype(np.float32), dr['labels']
    cards = [k for k, v in collections.Counter(yd.tolist()).most_common()
             if k.startswith('card:') and v >= CARD_MIN]
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2,
                                    random_state=42).split(
        np.zeros(len(yd)), np.zeros(len(yd)), groups=sidd))
    summary = {}
    for scheme, fname in schemes.items():
        print('\n=== %s ===' % scheme)
        ysl = np.array([label_of(l, cards, scheme) for l in yd], dtype=object)
        yrs = np.array([label_of(l, cards, scheme) for l in yr], dtype=object)
        classes = sorted(c for c in set(ysl) if c != 'other') + ['other']
        c2i = {c: i for i, c in enumerate(classes)}
        yi = np.array([c2i[l] for l in ysl], dtype=np.int64)
        yi_r = np.array([c2i.get(l, c2i['other']) for l in yrs], dtype=np.int64)
        clf = lgb.LGBMClassifier(
            objective='multiclass', num_class=len(classes),
            n_estimators=200, num_leaves=15, max_depth=4,
            n_jobs=-1, random_state=42, verbosity=-1)
        clf.fit(Xd[tr], yi[tr], callbacks=[lgb.log_evaluation(0)])
        pt, pr = clf.predict_proba(Xd[te]), clf.predict_proba(Xr)
        d1, d5 = topk(yi[te], pt, 1), topk(yi[te], pt, 5)
        r1, r5 = topk(yi_r, pr, 1), topk(yi_r, pr, 5)
        pred = clf.classes_[np.argmax(pt, axis=1)]
        rep = classification_report(yi[te], pred, target_names=classes,
                                    digits=4, zero_division=0, output_dict=True)
        out = os.path.join(MODEL_DIR, fname)
        with open(out, 'wb') as f:
            pickle.dump({
                'model': clf, 'classes': classes,
                'feature_keep': KEEP, 'feature_dim': 114,
                'hyperparams': {'n_estimators': 200, 'num_leaves': 15,
                                'max_depth': 4},
                'threshold': 0.30,
                'schema': 'slot%s_v2' % scheme[1:],
                'training': 'demo demonstration 8:2 by session',
                'source_pool': 'demo_pool.npz (2026-10-20 14:44 冻结)',
            }, f)
        print('  已保存 %s' % out)
        print('  demo Top1 %.4f Top5 %.4f | real Top1 %.4f Top5 %.4f'
              % (d1, d5, r1, r5))
        summary[scheme] = {'file': out, 'classes': classes,
                           'demo_top1': d1, 'demo_top5': d5,
                           'real_top1': r1, 'real_top5': r5,
                           'weighted_f1': rep['weighted avg']['f1-score'],
                           'class_report': {
                               c: {'P': rep[c]['precision'], 'R': rep[c]['recall'],
                                   'support': int(rep[c]['support'])}
                               for c in classes}}
    with open(os.path.join(WD, 'P1_slot_finalize.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print('\n汇总:', {k: round(v['demo_top1'], 4) for k, v in summary.items()})


if __name__ == '__main__':
    main()
