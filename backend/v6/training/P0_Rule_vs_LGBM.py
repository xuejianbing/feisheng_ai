# -*- coding: utf-8 -*-
"""P0_Rule_vs_LGBM.py - 规则前置 vs LGBM 对拍，只保留"对模型有利"的规则"""
import sys
import pickle
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD + r'\_pylibs')

KEEP = list(range(0, 32)) + list(range(48, 130))
DERIVED = {47: 'familiarity', 56: 'modulate_level', 57: 'modulator'}  # 动作派生特征

# 封版模型
pack = pickle.load(open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'rb'))
print('pkl keys:', list(pack.keys()) if isinstance(pack, dict) else 'raw model')
model = pack['model']
classes = np.array(pack['classes'], dtype=object)

# 真人数据
d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X'][:, KEEP].astype(np.float64)
lab = d['labels']
n = len(X)

# 模型预测
proba = model.predict_proba(X)
pred_idx = proba.argmax(axis=1)
pred = classes[pred_idx]
model_acc = (pred == lab).mean()
print('封版 LGBM 真人全量 Top-1: %.2f%%' % (100 * model_acc))


def make_conds(i):
    col = X[:, i]
    vals = np.unique(col)
    out = [('f%d>0' % i, col > 0)]
    if len(vals) <= 8:
        for v in vals:
            if v != 0:
                out.append(('f%d==%g' % (i, v), col == v))
    return out


# 单特征候选规则：规则命中率 vs 模型在该子集准确率
rows = []
for i in range(X.shape[1]):
    for desc, mask in make_conds(i):
        cnt = int(mask.sum())
        if cnt < 1000:
            continue
        a, c = Counter(lab[mask]).most_common(1)[0]
        rule_p = c / cnt                       # 强制出主导动作
        model_p = (pred[mask] == lab[mask]).mean()  # 模型在该子集
        gain = rule_p - model_p
        rows.append((gain, rule_p, model_p, desc, a, cnt, i in DERIVED))

# 纯局面（非动作派生）规则，按 gain 排序
print('\n=== 纯局面单特征规则：规则命中率 vs 模型命中率（Top12，按对模型增益）===')
clean = [r for r in rows if not r[6]]
clean.sort(reverse=True)
for gain, rp, mp, desc, a, cnt, _ in clean[:12]:
    flag = '有利' if gain > 0 else '拖累'
    print('  %-10s -> %-14s 规则%5.1f%% 模型%5.1f%% 增益%+.1f%% n=%d [%s]'
          % (desc, a, 100 * rp, 100 * mp, 100 * gain, cnt, flag))

print('\n=== 动作派生特征规则（直接预测时不可用，仅参考）===')
for gain, rp, mp, desc, a, cnt, _ in sorted([r for r in rows if r[6]], reverse=True):
    print('  %-10s -> %-14s 规则%5.1f%% 模型%5.1f%% n=%d' % (desc, a, 100 * rp, 100 * mp, cnt))

benefit = [r for r in clean if r[0] > 0]
print('\n对模型严格有利（增益>0）的纯局面规则数: %d' % len(benefit))
