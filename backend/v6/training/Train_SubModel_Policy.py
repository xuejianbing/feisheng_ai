# -*- coding: utf-8 -*-
"""
Train_SubModel_Policy.py - 训练真实玩家动作策略模型
输入：real_pool.npz（真实玩家，130维，复合标签 action:id）
切分：GroupShuffleSplit 按 sessionId 8:2，防止同局泄漏
模型：LGBMClassifier，100棵树，8叶，max_depth=3（极简封版口径）
输出：E:\\NoNameAI\\model\\SubModel_Policy.pkl
自检：python Train_SubModel_Policy.py --self-test
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import argparse
import json
import os
import pickle
import sys
import numpy as np
from sklearn.model_selection import GroupShuffleSplit
from lightgbm import LGBMClassifier

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
REAL_POOL = os.path.join(WD, 'real_pool.npz')
OUT_MODEL = r'E:\NoNameAI\model\SubModel_Policy.pkl'


def topk_accuracy(y_true, proba, classes, k):
    k = min(k, len(classes))
    order = np.argsort(-proba, axis=1)[:, :k]
    pred_topk = classes[order]
    hits = [true in row for true, row in zip(y_true, pred_topk)]
    return float(np.mean(hits))


def train():
    print('=== 加载 real_pool.npz ===', flush=True)
    d = np.load(REAL_POOL, allow_pickle=True)
    X = d['X']
    y = d['labels']
    sids = d['sids']
    print('X shape:', X.shape)
    print('samples:', len(y), 'sessions:', len(set(sids)), 'distinct labels:', len(set(y)))

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups=sids))
    train_classes = set(y[train_idx])
    valid_test_idx = np.array([i for i in test_idx if y[i] in train_classes])
    print('train samples:', len(train_idx))
    print('test samples:', len(valid_test_idx), '(原始', len(test_idx), '，训练未见类过滤', len(test_idx)-len(valid_test_idx), ')')

    clf = LGBMClassifier(
        objective='multiclass',
        n_estimators=100,
        num_leaves=8,
        max_depth=3,
        n_jobs=-1,
        random_state=42,
        verbosity=-1,
    )
    print('=== 开始训练 LightGBM：100树 / 8叶 / depth3 ===', flush=True)
    clf.fit(X[train_idx], y[train_idx])
    print('训练完成')

    proba_test = clf.predict_proba(X[valid_test_idx])
    classes = clf.classes_
    top1 = topk_accuracy(y[valid_test_idx], proba_test, classes, 1)
    top5 = topk_accuracy(y[valid_test_idx], proba_test, classes, 5)
    print('=== 测试集指标 ===')
    print('Top-1 accuracy: %.4f' % top1)
    print('Top-5 accuracy: %.4f' % top5)

    print('=== 3个测试样本 Top-3 对比 ===')
    for n, idx in enumerate(valid_test_idx[:3]):
        p = clf.predict_proba(X[idx:idx+1])[0]
        order = np.argsort(-p)[:3]
        top3 = [(str(classes[i]), round(float(p[i]), 4)) for i in order]
        print('样本%d true=%s top3=%s' % (n+1, y[idx], top3))

    os.makedirs(os.path.dirname(OUT_MODEL), exist_ok=True)
    with open(OUT_MODEL, 'wb') as f:
        pickle.dump(clf, f)
    print('模型已保存:', OUT_MODEL)
    return {'top1': top1, 'top5': top5, 'model': OUT_MODEL,
            'train_samples': int(len(train_idx)), 'test_samples': int(len(valid_test_idx))}


def selfTest():
    try:
        if not os.path.exists(OUT_MODEL):
            return {'ok': False, 'msg': 'SubModel_Policy.pkl 不存在', 'data': None}
        with open(OUT_MODEL, 'rb') as f:
            clf = pickle.load(f)
        x = np.zeros((1, 130), dtype=np.float32)
        proba = clf.predict_proba(x)[0]
        idx = int(np.argmax(proba))
        return {
            'ok': True,
            'msg': 'SubModel_Policy 自检正常',
            'data': {
                'classes': int(len(clf.classes_)),
                'top_action': str(clf.classes_[idx]),
                'top_prob': float(proba[idx]),
            },
        }
    except Exception as e:
        return {'ok': False, 'msg': 'SubModel_Policy 自检异常: %s' % e, 'data': None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        r = selfTest()
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r.get('ok') else 1
    train()
    return 0


if __name__ == '__main__':
    sys.exit(main())
