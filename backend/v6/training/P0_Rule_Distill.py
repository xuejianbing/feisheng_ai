# -*- coding: utf-8 -*-
"""
P0_Rule_Distill.py - 后端规则蒸馏三步
任务一：复杂 LGBM（不限制深度）复现 real 基线 + Top10 重要特征
任务二：深度 8 白盒决策树，demo 训练 real 测试
任务三：export_text + 规则转 JSON，导出 rule_distillation_v1.json
口径：114 维（130 维剔 f32-f47），11 分类（demo Top-10 + other）
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import sys, json
import numpy as np
sys.path.insert(0, r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1\_pylibs')
from collections import Counter
from sklearn.model_selection import GroupShuffleSplit
from sklearn.tree import DecisionTreeClassifier, export_text
import lightgbm as lgb

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
KEEP = list(range(0, 32)) + list(range(48, 130))  # 114 维

def load(name):
    d = np.load(WD + '\\' + name + '_pool.npz', allow_pickle=True)
    return d['X'][:, KEEP], d['labels'], d['sids']

Xd, labd, sid = load('demo')
Xr, labr, _ = load('real')

lc = Counter(labd)
top10 = [k for k, _ in lc.most_common(10)]
classes = top10 + ['other']
c2i = {k: i for i, k in enumerate(classes)}
yd = np.array([c2i.get(l, 10) for l in labd])
yr = np.array([c2i.get(l, 10) for l in labr])

gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
tr, te = next(gss.split(Xd, yd, groups=sid))

def top1(p, y):
    return (np.argmax(p, axis=1) == y).mean()
def topk(p, y, k):
    o = np.argsort(-p, axis=1)[:, :k]
    return sum(1 for i in range(len(y)) if y[i] in o[i]) / len(y)

# ========== 任务一：复杂 LGBM ==========
print('=' * 72)
print('任务一：复杂 LGBM（不限深度，n_estimators=300，num_leaves=63）')
big = lgb.LGBMClassifier(objective='multiclass', num_class=11, num_leaves=63,
                         n_estimators=300, learning_rate=0.05, n_jobs=-1, random_state=42)
big.fit(Xd[tr], yd[tr], callbacks=[lgb.log_evaluation(0)])
pv = big.predict_proba(Xd[te])
pr = big.predict_proba(Xr)
print('demo 验证 Top1 %.2f%% Top5 %.2f%%' % (top1(pv, yd[te]) * 100, topk(pv, yd[te], 5) * 100))
print('real 域外 Top1 %.2f%% Top5 %.2f%%' % (top1(pr, yr) * 100, topk(pr, yr, 5) * 100))

imp = big.feature_importances_
order = np.argsort(-imp)[:10]
print('\n114 维特征重要性 Top10（gain）：')
for rank, idx in enumerate(order):
    print('  #%d  114维索引 f%-3d  原始130维索引 f%-3d  gain=%d' %
          (rank + 1, idx, KEEP[idx], imp[idx]))

# ========== 任务二：深度 8 白盒树 ==========
print('\n' + '=' * 72)
print('任务二：DecisionTree max_depth=8 min_samples_leaf=50')
dt = DecisionTreeClassifier(max_depth=8, min_samples_leaf=50, class_weight='balanced', random_state=42)
dt.fit(Xd[tr], yd[tr])
tv = dt.predict_proba(Xd[te])
tvr = dt.predict_proba(Xr)
print('demo 验证 Top1 %.2f%%' % (top1(tv, yd[te]) * 100))
print('real 域外 Top1 %.2f%%' % (top1(tvr, yr) * 100))
print('叶子节点数：%d' % dt.get_n_leaves())

# ========== 任务三：规则固化 ==========
print('\n' + '=' * 72)
print('任务三：深度 8 白盒树文本规则（前 30 行）')
txt = export_text(dt, feature_names=['f' + str(i) for i in range(114)],
                  class_names=classes, max_depth=8)
print('\n'.join(txt.split('\n')[:30]))

def tree_to_rules(tree, class_names):
    t = tree.tree_
    names = ['f' + str(i) for i in range(114)]
    rules = []
    def rec(node, cond):
        if t.feature[node] != -2:
            fi = int(t.feature[node]); th = float(t.threshold[node])
            rec(t.children_left[node], cond + [dict(feature=names[fi], feature_idx=fi, op='<=', threshold=round(th, 3))])
            rec(t.children_right[node], cond + [dict(feature=names[fi], feature_idx=fi, op='>', threshold=round(th, 3))])
        else:
            cls = int(np.argmax(t.value[node]))
            rules.append(dict(rule_id=len(rules), conditions=cond, class_idx=cls,
                              action=class_names[cls], samples=int(t.n_node_samples[node])))
    rec(0, [])
    return rules

rules = tree_to_rules(dt, classes)
out = {
    'version': 'v1.0', 'date': '2026-10-20',
    'feature_dim': 114, 'feature_keep_note': '114维=原始130维剔f32-f47；新索引 f0-31=原0-31, f32-113=原48-129',
    'classes': classes,
    'real_top1': round(top1(tvr, yr), 4),
    'rule_count': len(rules),
    'rules': rules
}
with open(WD + r'\rule_distillation_v1.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print('\n已导出 rule_distillation_v1.json，提取规则数量：%d' % len(rules))

print('\n前 10 条规则（条件 → 动作）：')
for r in rules[:10]:
    cond = ' and '.join('%s %s %s' % (c['feature'], c['op'], c['threshold']) for c in r['conditions']) or '(root)'
    print('  [R%-3d n=%-4d] %-60s => %s' % (r['rule_id'], r['samples'], cond, r['action']))
