# -*- coding: utf-8 -*-
"""
P0_LeakFixed_Retrain.py - 纠正泄露后重训
对照剔除模式：
  old9   : 剔旧九维 [0,17,53,64,65,68,70,71,81]（121 维，含泄露，错误基线）
  true   : 剔真实动作区 f32-f47（16 维，114 维，无当前动作/目标答案）
11 分类，决策树 + 极简 LightGBM，demo 验证 + real 域外
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
OLD9 = [0, 17, 53, 64, 65, 68, 70, 71, 81]
ACT = list(range(32, 48))  # 真实动作+目标区 f32-f47

def load(name):
    d = np.load(WD + '\\' + name + '_pool.npz', allow_pickle=True)
    return d['X'], d['labels'], d['sids']

X_demo, lab_demo, sid_demo = load('demo')
X_real, lab_real, sid_real = load('real')

lc = Counter(lab_demo)
top10 = [k for k, _ in lc.most_common(10)]
classes = top10 + ['other']
c2i = {k: i for i, k in enumerate(classes)}
y_demo = np.array([c2i.get(l, 10) for l in lab_demo], dtype=np.int64)
y_real = np.array([c2i.get(l, 10) for l in lab_real], dtype=np.int64)

gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
tr, te = next(gss.split(X_demo, y_demo, groups=sid_demo))
print('11 分类（sha %.1f%% / other %.1f%%，随机基线 1/11=9.1%%）' %
      (100 * (y_demo == 0).mean(), 100 * (y_demo == 10).mean()))

def topk(p, y, k):
    o = np.argsort(-p, axis=1)[:, :k]
    return sum(1 for i in range(len(y)) if y[i] in o[i]) / len(y)

def run(mode, drop):
    keep = [i for i in range(130) if i not in drop]
    Xd = X_demo[:, keep]
    Xr = X_real[:, keep]
    names = ['f' + str(i) for i in keep]
    dt = DecisionTreeClassifier(max_depth=4, class_weight='balanced', random_state=42)
    dt.fit(Xd[tr], y_demo[tr])
    m = lgb.LGBMClassifier(objective='multiclass', num_class=11, max_depth=3, num_leaves=8,
                           n_estimators=100, n_jobs=-1, random_state=42)
    m.fit(Xd[tr], y_demo[tr], callbacks=[lgb.log_evaluation(0)])
    pv = m.predict_proba(Xd[te])
    pr = m.predict_proba(Xr)
    print('\n' + '=' * 72)
    print(f'模式 {mode} | 维度 {len(keep)}')
    print(f'  决策树  验证 {dt.score(Xd[te],y_demo[te])*100:5.2f}% | real {dt.score(Xr,y_real)*100:5.2f}%')
    print(f'  LGBM    验证 Top1 {topk(pv,y_demo[te],1)*100:5.2f}% Top5 {topk(pv,y_demo[te],5)*100:5.2f}%')
    print(f'  LGBM    real Top1 {topk(pr,y_real,1)*100:5.2f}% Top5 {topk(pr,y_real,5)*100:5.2f}%')
    return dt, m, keep, names

d1, m1, _, _ = run('old9 剔旧九维(仍含泄露)', OLD9)
d2, m2, keep2, names2 = run('true 剔f32-f47(无答案)', ACT)

print('\n' + '=' * 72)
print('正确剔除(f32-f47)后 4 层决策树真实规则：')
print(export_text(d2, feature_names=names2, class_names=classes, max_depth=4))

with open(WD + r'\SubModel_Policy_minimal_clean.pkl', 'wb') as f:
    pickle.dump({'model': m2, 'classes': classes, 'feature_keep': keep2,
                 'tree': d2,
                 'acc_demo': topk(m2.predict_proba(X_demo[:,keep2][te]), y_demo[te], 1),
                 'acc_real': topk(m2.predict_proba(X_real[:,keep2]), y_real, 1)}, f)
print('已保存 SubModel_Policy_minimal_clean.pkl（无泄露极简版）')
