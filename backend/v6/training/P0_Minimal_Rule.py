# -*- coding: utf-8 -*-
"""
P0_Minimal_Rule.py - 极简模型与硬规则提取
- demo 池动态取 Top-10 高频动作 + other => 11 分类
- 121 维(剔九维)
- 任务二: DecisionTree max_depth=4, class_weight=balanced, export_text
- 任务三: LightGBM max_depth=3, num_leaves=8, n_estimators=100
- 域外测试: real 池(真实可用样本)
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import sys, pickle
import numpy as np
sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')
from collections import Counter
from sklearn.model_selection import GroupShuffleSplit
from sklearn.tree import DecisionTreeClassifier, export_text
import lightgbm as lgb

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]
KEEP = [i for i in range(130) if i not in LEAK_IDX]
FEATURE_NAMES = ['f' + str(i) for i in KEEP]

def load(name):
    d = np.load(WD + '\\' + name + '_pool.npz', allow_pickle=True)
    X = d['X'][:, KEEP]
    return X, d['labels'], d['sids']

def topk(proba, y, k):
    o = np.argsort(-proba, axis=1)[:, :k]
    return sum(1 for i in range(len(y)) if y[i] in o[i]) / len(y)

X_demo, lab_demo, sid_demo = load('demo')
X_real, lab_real, sid_real = load('real')

# ===== 任务一：Top-10 + other =====
lc = Counter(lab_demo)
top10 = [k for k, _ in lc.most_common(10)]
classes = top10 + ['other']
c2i = {k: i for i, k in enumerate(classes)}
y_demo = np.array([c2i.get(l, 10) for l in lab_demo], dtype=np.int64)
y_real = np.array([c2i.get(l, 10) for l in lab_real], dtype=np.int64)

print('=' * 70)
print('任务一：11 分类样本量分布（demo 池）')
for i, c in enumerate(classes):
    n = int((y_demo == i).sum())
    print(f'  [{i:2d}] {c:22s} {n:8d}  {n/len(y_demo)*100:5.2f}%')
n_real_other = int((y_real == 10).sum())
print(f'（real 池 {len(y_real)} 行，其中落入 other {n_real_other} 行 {n_real_other/len(y_real)*100:.1f}%）')
print(f'Top-10 对 demo 覆盖率: {(len(y_demo)-int((y_demo==10).sum()))/len(y_demo)*100:.2f}%')

# 按局切分 demo
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
tr, te = next(gss.split(X_demo, y_demo, groups=sid_demo))
print(f'切分: 训练 {len(tr)} / 验证 {len(te)}（按 sessionId，局不交叉）')

# ===== 任务二：极简决策树 =====
print('\n' + '=' * 70)
print('任务二：4 层决策树（max_depth=4, class_weight=balanced）')
dt = DecisionTreeClassifier(max_depth=4, class_weight='balanced', random_state=42)
dt.fit(X_demo[tr], y_demo[tr])
acc_val = dt.score(X_demo[te], y_demo[te])
acc_real = dt.score(X_real, y_real)
print(f'验证集 Accuracy: {acc_val*100:.2f}%')
print(f'real 真实玩家数据 Accuracy: {acc_real*100:.2f}%')
print('--- 完整决策规则（export_text） ---')
print(export_text(dt, feature_names=FEATURE_NAMES, class_names=classes, max_depth=4))

# ===== 任务三：极简 LightGBM =====
print('=' * 70)
print('任务三：极简 LightGBM（max_depth=3, num_leaves=8, n_estimators=100）')
lgbm = lgb.LGBMClassifier(objective='multiclass', num_class=11, max_depth=3, num_leaves=8,
                          n_estimators=100, n_jobs=-1, random_state=42)
lgbm.fit(X_demo[tr], y_demo[tr], eval_set=[(X_demo[te], y_demo[te])],
         eval_names=['test'], eval_metric='multi_logloss',
         callbacks=[lgb.log_evaluation(0)])
p_val = lgbm.predict_proba(X_demo[te])
p_real = lgbm.predict_proba(X_real)
print(f'验证集 Top-1: {topk(p_val, y_demo[te], 1)*100:.2f}% | Top-5: {topk(p_val, y_demo[te], 5)*100:.2f}%')
print(f'real 数据 Top-1: {topk(p_real, y_real, 1)*100:.2f}% | Top-5: {topk(p_real, y_real, 5)*100:.2f}%')

# 保存极简产物
with open(WD + r'\Minimal_Tree.pkl', 'wb') as f:
    pickle.dump({'model': dt, 'classes': classes, 'feature_keep': KEEP,
                 'acc_val': acc_val, 'acc_real': acc_real}, f)
with open(WD + r'\Minimal_LGBM.pkl', 'wb') as f:
    pickle.dump({'model': lgbm, 'classes': classes, 'feature_keep': KEEP}, f)
print('已保存 Minimal_Tree.pkl / Minimal_LGBM.pkl')
