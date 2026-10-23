# -*- coding: utf-8 -*-
"""
P2_Human_Slot_Retrain.py - 纯真人已结算数据重训 17 类槽位模型
数据源：E:\\NoNameAI\\merged_shards（三池拆分后仅含 player-demonstration 且所在 session 有 win/lose 终局的样本）
口径：
  - 特征 f[:, KEEP] 114 维；标签 m.action + ':' + m.id
  - 高频 card 标签（>=10000）原样保留；equip 按槽位合并为 equip:weapon / equip:nonweapon；其余 -> other
  - 按 sessionId GroupShuffleSplit 80/20，整局不跨训练/测试
  - LGBM 同旧口径（n_estimators=200, num_leaves=15, max_depth=4）
输出：
  - 覆盖 E:\\NoNameAI\\model\\SubModel_Policy_slot17.pkl
  - 指标落盘 P2_Human_Slot_Retrain.json
"""
import json, os, re, sys, pickle, collections
import numpy as np

WD = os.environ.get('TRAIN_WORK_DIR', os.path.dirname(os.path.abspath(__file__)))
WD2 = os.environ.get('TRAIN_LIBS_DIR', os.path.join(WD, '_pylibs'))
MODEL_DIR = os.environ.get('TRAIN_MODEL_DIR', r'E:\NoNameAI\model')
HUMAN_SHARD_DIR = os.environ.get('TRAIN_HUMAN_SHARD_DIR', r'E:\NoNameAI\merged_shards')
KEEP = list(range(0, 32)) + list(range(48, 130))
TOP_CARDS = 14   # 17 类 = 14 高频出牌 + 武器槽 + 非武器装备槽 + other
WEAPONS = {'zhuge', 'guanshi', 'zhangba', 'guding', 'cixiong', 'qinggang',
           'qinglong', 'hanbing', 'qilin', 'zhuque', 'fangtian', 'muniu'}
ARMORS = {'bagua', 'renwang', 'tengjia', 'baiyin'}
HORSES = {'jueying', 'dilu', 'zhuahuang', 'hualiu', 'chitu', 'zixin', 'dawan'}

sys.path.insert(0, os.path.join(WD2, '_pylibs'))
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


def label_of(lab, cards):
    if lab in cards:
        return lab
    if lab.startswith('equip:'):
        eid = lab.split(':', 1)[1]
        if slot_of(eid) == 'weapon':
            return 'equip:weapon'
        if slot_of(eid) in ('armor', 'horse'):
            return 'equip:nonweapon'
    return 'other'


def topk(yt, proba, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return float(np.mean([y in r for y, r in zip(yt, o)]))


def load_human():
    X, y, groups = [], [], []
    skipped = 0
    for fn in sorted(os.listdir(HUMAN_SHARD_DIR)):
        if not re.match(r'^shard_\d{3}\.json$', fn):
            continue
        with open(os.path.join(HUMAN_SHARD_DIR, fn), encoding='utf-8') as f:
            d = json.load(f)
        for s in d.get('samples', []):
            m = s.get('m') or {}
            fv = s.get('f')
            if not fv or not isinstance(fv, list) or len(fv) < 130:
                skipped += 1
                continue
            if m.get('gameOutcome') not in ('win', 'lose'):
                skipped += 1
                continue
            X.append(fv[:130])
            y.append(str(m.get('action')) + ':' + str(m.get('id')))
            groups.append(m.get('sessionId'))
    X = np.asarray(X, dtype=np.float32)[:, KEEP]
    y = np.asarray(y, dtype=object)
    groups = np.asarray(groups, dtype=object)
    return X, y, groups, skipped


def main():
    print('加载真人池 ...')
    X, y, groups, skipped = load_human()
    print('样本数 %d, 特征维 %d, session 数 %d, 跳过 %d'
          % (len(X), X.shape[1], len(set(groups.tolist())), skipped))
    label_counter = collections.Counter(y.tolist())
    card_counts = [(k, v) for k, v in label_counter.most_common()
                   if k.startswith('card:')]
    cards = [k for k, v in card_counts[:TOP_CARDS]]
    print('高频 card 标签（取前 %d 个）: %d 个' % (TOP_CARDS, len(cards)))
    for c in cards:
        print('  %-18s %d' % (c, label_counter[c]))
    equip_weapon = sum(v for k, v in label_counter.items()
                       if k.startswith('equip:') and slot_of(k.split(':', 1)[1]) == 'weapon')
    equip_nonweapon = sum(v for k, v in label_counter.items()
                          if k.startswith('equip:') and slot_of(k.split(':', 1)[1]) in ('armor', 'horse'))
    print('装备原始分布: weapon %d, nonweapon(armor/horse) %d' % (equip_weapon, equip_nonweapon))

    ysl = np.array([label_of(l, cards) for l in y], dtype=object)
    classes = sorted(c for c in set(ysl.tolist()) if c != 'other') + ['other']
    print('输出类别 %d 个: %s' % (len(classes), classes))
    c2i = {c: i for i, c in enumerate(classes)}
    yi = np.array([c2i[l] for l in ysl], dtype=np.int64)

    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2,
                                    random_state=42).split(
        np.zeros(len(X)), np.zeros(len(X)), groups=groups))
    print('训练 %d 样本 / 测试 %d 样本（按 sessionId 切分）' % (len(tr), len(te)))

    clf = lgb.LGBMClassifier(
        objective='multiclass', num_class=len(classes),
        n_estimators=200, num_leaves=15, max_depth=4,
        n_jobs=-1, random_state=42, verbosity=-1)
    clf.fit(X[tr], yi[tr], callbacks=[lgb.log_evaluation(0)])
    pt = clf.predict_proba(X[te])
    t1, t5 = topk(yi[te], pt, 1), topk(yi[te], pt, 5)
    print('\n===== 纯真人已结算 17 类模型 =====')
    print('Top-1 = %.4f' % t1)
    print('Top-5 = %.4f' % t5)

    pred = clf.classes_[np.argmax(pt, axis=1)]
    rep = classification_report(yi[te], pred, target_names=classes,
                                digits=4, zero_division=0, output_dict=True)
    # 装备总召回
    equip_recall = None
    eq_keys = [c for c in classes if c.startswith('equip:')]
    if eq_keys:
        sup = sum(rep[c]['support'] for c in eq_keys)
        tp = sum(rep[c]['recall'] * rep[c]['support'] for c in eq_keys)
        equip_recall = tp / sup if sup else None
        print('装备总召回 = %.4f' % equip_recall)

    out = os.path.join(MODEL_DIR, 'SubModel_Policy_slot17.pkl')
    meta = {
        'model': clf, 'classes': classes,
        'feature_keep': KEEP, 'feature_dim': 114,
        'hyperparams': {'n_estimators': 200, 'num_leaves': 15, 'max_depth': 4},
        'threshold': 0.30,
        'schema': 'slot17_human_v2',
        'training': 'pure human settled (player-demonstration, win/lose sessions), 8:2 by session',
        'train_samples': int(len(tr)), 'test_samples': int(len(te)),
        'top1': t1, 'top5': t5,
    }
    with open(out, 'wb') as f:
        pickle.dump(meta, f)
    print('已保存 %s' % out)

    summary = {
        'file': out, 'classes': classes, 'top1': t1, 'top5': t5,
        'equip_recall': equip_recall,
        'train_samples': int(len(tr)), 'test_samples': int(len(te)),
        'total_sessions': int(len(set(groups.tolist()))),
        'high_freq_cards': cards,
        'class_report': {
            c: {'precision': rep[c]['precision'], 'recall': rep[c]['recall'],
                'f1': rep[c]['f1-score'], 'support': int(rep[c]['support'])}
            for c in classes},
    }
    with open(os.path.join(WD, 'P2_Human_Slot_Retrain.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print('指标落盘 P2_Human_Slot_Retrain.json')


if __name__ == '__main__':
    main()
