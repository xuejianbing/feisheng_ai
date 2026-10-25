# -*- coding: utf-8 -*-
"""
P0_Baseline_Verify.py - 独立推理验证
对 real / demo 两个模型各随机抽 3 个测试样本，输出 Top-3 动作+概率，对比真实
"""
import sys, pickle
import numpy as np
sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')
from collections import Counter
from sklearn.model_selection import GroupShuffleSplit

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]
MIN_COUNT = 50

def verify(pool_name):
    d = np.load(WD + '\\' + pool_name + '_pool.npz', allow_pickle=True)
    X, labels, sids = d['X'], d['labels'], d['sids']
    keep = [i for i in range(130) if i not in LEAK_IDX]
    X = X[:, keep]
    lc = Counter(labels)
    keep_classes = sorted([k for k, v in lc.items() if v >= MIN_COUNT])
    classes = keep_classes + ['__other__']
    cls2idx = {k: i for i, k in enumerate(classes)}
    y = np.array([cls2idx.get(lab, len(keep_classes)) for lab in labels], dtype=np.int64)
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    tr, te = next(gss.split(X, y, groups=sids))

    with open(WD + '\\SubModel_Policy_' + pool_name + '.pkl', 'rb') as f:
        bundle = pickle.load(f)
    clf = bundle['model']
    mclasses = bundle['classes']
    assert mclasses == classes, '模型 classes 与复现不一致'

    rng = np.random.RandomState(20261020)
    picks = rng.choice(te, size=3, replace=False)
    print('=' * 70)
    print(f'模型: SubModel_Policy_{pool_name}.pkl  (num_class {len(classes)})')
    for j, i in enumerate(picks):
        proba = clf.predict_proba(X[i:i+1])[0]
        order = np.argsort(-proba)[:3]
        true_i = y[i]
        print(f'--- 样本 {j+1} (session {str(sids[i])[:22]}...) ---')
        print(f'  真实动作: {classes[true_i]}')
        for rank, ci in enumerate(order):
            print(f'  Top{rank+1}: {classes[ci]:24s} {proba[ci]*100:6.2f}%')
        print(f'  {"✓ 命中" if true_i in order else "✗ 未命中 Top3"}')

verify('real')
verify('demo')
