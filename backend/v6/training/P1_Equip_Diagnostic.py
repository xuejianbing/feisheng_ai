# -*- coding: utf-8 -*-
"""
P1_Equip_Diagnostic.py - 装备可判别性诊断（任务一的必要补充）
1) 旧 11 类 minimal_clean 在同一按局切分上的基线（公平对比）
2) 装备槽位聚合模型：14 高频出牌 + equip:weapon/equip:armor/equip:horse_plus/equip:horse_minus + other
   验证“装备动作类型/槽位”可学，而具体同名装备（如 7 匹马）特征不可区分
3) 38 类细粒度模型中，装备样本实际被预测成什么（动作类型级混淆）
输出：终端打印 + P1_equip_diagnostic.json
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import json
import os
import pickle
import sys
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
KEEP = list(range(0, 32)) + list(range(48, 130))
sys.path.insert(0, os.path.join(WD, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
import lightgbm as lgb

CARD_MIN = 10000
# 军争标准装备槽位
WEAPONS = {'zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
           'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'}
ARMORS = {'bagua', 'renwang', 'tengjia', 'baiyin'}
HORSE_PLUS = {'jueying', 'dilu', 'zhuahuang', 'hualiu'}    # 防御马 +1
HORSE_MINUS = {'chitu', 'zixin', 'dawan'}                  # 进攻马 -1


def load_demo():
    d = np.load(os.path.join(WD, 'demo_pool.npz'), allow_pickle=True)
    return d['X'][:, KEEP].astype(np.float32), d['labels'], d['sids']


def split(y, sids):
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(gss.split(np.zeros(len(y)), np.zeros(len(y)), groups=sids))
    return tr, te


def topk(yt, proba, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in r for y, r in zip(yt, o)]))


def fit_eval(classes, y_raw, tr, te, X, name):
    c2i = {c: i for i, c in enumerate(classes)}
    yi = np.array([c2i.get(l, c2i['other']) for l in y_raw], dtype=np.int64)
    tr_cls = set(yi[tr])
    tev = np.array([i for i in te if yi[i] in tr_cls])
    clf = lgb.LGBMClassifier(
        objective='multiclass', num_class=len(classes),
        n_estimators=100, num_leaves=8, max_depth=3,
        n_jobs=-1, random_state=42, verbosity=-1)
    clf.fit(X[tr], yi[tr], callbacks=[lgb.log_evaluation(0)])
    p = clf.predict_proba(X[tev])
    pred = np.argmax(p, axis=1)
    t1, t5 = topk(yi[tev], p, 1), topk(yi[tev], p, 5)
    print('%-28s 类别=%2d  Top-1 %.4f  Top-5 %.4f  (test=%d)'
          % (name, len(classes), t1, t5, len(tev)))
    return clf, c2i, yi, tev, t1, t5, pred


def main():
    print('=== 加载 demo 池 ===', flush=True)
    X, y, sids = load_demo()
    lc = collections.Counter(y.tolist())
    tr, te = split(y, sids)
    result = {}

    # ---------- 1) 旧 11 类基线（同切分）----------
    old_classes = ['card:sha', 'card:tiesuo', 'card:tao', 'card:guohe',
                   'card:shunshou', 'card:wuzhong', 'card:jiu', 'card:juedou',
                   'card:nanman', 'card:lebu', 'other']
    _, _, _, _, t1, t5, _ = fit_eval(old_classes, y, tr, te, X, '旧11类 minimal_clean 基线')
    result['baseline_11'] = {'classes': len(old_classes), 'top1': t1, 'top5': t5}

    # ---------- 2) 细粒度 38 类（同 v2 口径），取装备混淆 ----------
    cards = [k for k, v in lc.most_common() if k.startswith('card:') and v >= CARD_MIN]
    equips = [k for k, v in lc.most_common() if k.startswith('equip:') and v >= 1000]
    classes38 = cards + equips + ['other']
    _, c2i38, yi38, tev38, t1, t5, pred38 = fit_eval(
        classes38, y, tr, te, X, '38类细粒度（14牌+23装备+other）')
    result['fine38'] = {'classes': len(classes38), 'top1': t1, 'top5': t5}

    # 装备真实样本 -> 被预测成什么动作类型
    pos = {int(i): j for j, i in enumerate(tev38)}
    eq_test = np.array([i for i in tev38 if y[i].startswith('equip:')])
    pred_eq = pred38[[pos[int(i)] for i in eq_test]]
    to_equip = sum(1 for j in pred_eq if classes38[j].startswith('equip:'))
    to_card = sum(1 for j in pred_eq if classes38[j].startswith('card:'))
    to_other = len(pred_eq) - to_equip - to_card
    print('  装备样本 %d 条预测去向：装备类 %.1f%% / 出牌类 %.1f%% / other %.1f%%'
          % (len(eq_test), 100*to_equip/len(eq_test), 100*to_card/len(eq_test),
             100*to_other/len(eq_test)))
    result['fine38']['equip_routing'] = {
        'n': int(len(eq_test)),
        'to_equip_pct': 100*to_equip/len(eq_test),
        'to_card_pct': 100*to_card/len(eq_test),
        'to_other_pct': 100*to_other/len(eq_test),
    }

    # ---------- 3) 槽位聚合模型 ----------
    def slot_label(lab):
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

    yslot = np.array([slot_label(l) for l in y], dtype=object)
    slot_classes = cards + ['equip:weapon', 'equip:armor',
                            'equip:horse_plus', 'equip:horse_minus'] + ['other']
    clfS, c2iS, yiS, tevS, t1, t5, predS = fit_eval(
        slot_classes, yslot, tr, te, X, '槽位模型（14牌+4装备槽+other）')
    result['slot19'] = {'classes': len(slot_classes), 'top1': t1, 'top5': t5}
    print('\n  槽位类别 test precision/recall:')
    from sklearn.metrics import classification_report
    rep = classification_report(yiS[tevS], predS, target_names=slot_classes,
                                digits=4, zero_division=0, output_dict=True)
    for c in ['equip:weapon', 'equip:armor', 'equip:horse_plus', 'equip:horse_minus', 'other']:
        r = rep[c]
        print('    %-20s P %.4f R %.4f support %d'
              % (c, r['precision'], r['recall'], int(r['support'])))
    result['slot19']['slot_report'] = {
        c: rep[c] for c in ['equip:weapon', 'equip:armor',
                            'equip:horse_plus', 'equip:horse_minus', 'other']}

    with open(os.path.join(WD, 'P1_equip_diagnostic.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('\n诊断已保存 P1_equip_diagnostic.json')


if __name__ == '__main__':
    main()
