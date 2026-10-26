# -*- coding: utf-8 -*-
"""
P2_Critic_Train.py - Critic 局面胜率模型（二分类）重训
数据口径（用户 P0 指令）：
  - 真人胜局（merged_shards, gameOutcome=win）            -> y=1
  - 真人负局（merged_shards, gameOutcome=lose）           -> y=0
  - 强退局（aborted_shards, 无终局, is_aborted=true）      -> y=0
  - AI 池（ai_shards）不参与
特征：
  - 原始 f 取前 130 维；按 P0_Baseline_Train 的 LEAK_IDX 剔除 9 维 -> 121 维
    CRITIC_KEEP = [i for i in range(130) if i not in LEAK_IDX]
切分：
  - GroupShuffleSplit 按 sessionId 8:2，整局不跨训练/测试
训练：
  - LightGBM 二分类；为保证“真实胜率”可校准，不做类别加权（概率反映真实基准率）
输出：
  - E:\\NoNameAI\\model\\SubModel_Critic_v1.pkl
  - 指标落盘 P2_Critic_Train.json
评估：
  - 样本级：AUC / F1 / 混淆矩阵（阈值 0.5）+ 最优阈值（Youden J）
  - 局级：每局预测概率均值后再判，AUC / 混淆矩阵（更公平地看“抓败局”）
"""
import json, os, re, sys, pickle, collections
import numpy as np

WD = os.environ.get('TRAIN_WORK_DIR', os.path.dirname(os.path.abspath(__file__)))
WD2 = os.environ.get('TRAIN_LIBS_DIR', os.path.join(WD, '_pylibs'))
MODEL_DIR = os.environ.get('TRAIN_MODEL_DIR', r'E:\NoNameAI\model')
HUMAN_SHARD_DIR = os.environ.get('TRAIN_HUMAN_SHARD_DIR', r'E:\NoNameAI\merged_shards')
ABORTED_SHARD_DIR = os.environ.get('TRAIN_ABORTED_SHARD_DIR', r'E:\NoNameAI\aborted_shards')

# 与 P0_Baseline_Train.py 一致的 9 维泄漏索引（130-9=121）
LEAK_IDX = [0, 17, 53, 64, 65, 68, 70, 71, 81]
CRITIC_KEEP = [i for i in range(130) if i not in LEAK_IDX]

sys.path.insert(0, os.path.join(WD2, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import (roc_auc_score, f1_score, confusion_matrix,
                             roc_curve)
import lightgbm as lgb


def _iter_shards(d):
    for fn in sorted(os.listdir(d)):
        if re.match(r'^shard_\d{3}\.json$', fn):
            with open(os.path.join(d, fn), encoding='utf-8') as f:
                yield json.load(f)


def load_data():
    X, y, groups = [], [], []
    tag_counter = collections.Counter()
    skipped = 0
    # 真人已结算
    for d in _iter_shards(HUMAN_SHARD_DIR):
        for s in d.get('samples', []):
            m = s.get('m') or {}
            fv = s.get('f')
            if not fv or not isinstance(fv, list) or len(fv) < 130:
                skipped += 1
                continue
            g = m.get('gameOutcome')
            if g == 'win':
                yy = 1
            elif g == 'lose':
                yy = 0
            else:
                skipped += 1
                continue
            X.append(fv[:130])
            y.append(yy)
            groups.append(m.get('sessionId'))
            tag_counter['win' if yy == 1 else 'lose'] += 1
    # 强退局 -> y=0
    for d in _iter_shards(ABORTED_SHARD_DIR):
        for s in d.get('samples', []):
            m = s.get('m') or {}
            fv = s.get('f')
            if not fv or not isinstance(fv, list) or len(fv) < 130:
                skipped += 1
                continue
            X.append(fv[:130])
            y.append(0)
            groups.append(m.get('sessionId'))
            tag_counter['aborted'] += 1
    X = np.asarray(X, dtype=np.float32)[:, CRITIC_KEEP]
    y = np.asarray(y, dtype=np.int64)
    groups = np.asarray(groups, dtype=object)
    return X, y, groups, tag_counter, skipped


def session_label(groups, y):
    """每个 session 的真实标签（取该 session 内任一标签；win=1, lose/abort=0）。"""
    lab = {}
    for g, yy in zip(groups, y):
        if g not in lab:
            lab[g] = int(yy)
    return lab


def session_scores(groups, proba):
    """每局预测概率（取该 session 内所有状态概率的均值）。"""
    acc = collections.defaultdict(list)
    for g, p in zip(groups, proba):
        acc[g].append(float(p))
    return {g: float(np.mean(v)) for g, v in acc.items()}


def cm_block(yt, yp, labels=(0, 1)):
    cm = confusion_matrix(yt, yp, labels=list(labels))
    return cm


def main():
    print('加载三池（真人胜/真人负/强退） ...')
    X, y, groups, tag_counter, skipped = load_data()
    print('样本级分布: 胜(win) %d, 负(lose) %d, 强退(aborted) %d, 跳过 %d'
          % (tag_counter['win'], tag_counter['lose'],
             tag_counter['aborted'], skipped))
    print('总样本 %d, 特征维 %d' % (len(X), X.shape[1]))

    # 局级标签
    slab = session_label(groups, y)
    n_win_sess = sum(1 for v in slab.values() if v == 1)
    n_lose_sess = sum(1 for v in slab.values() if v == 0)
    print('局级分布: 胜局 %d, 负+强退局 %d, 合计 %d'
          % (n_win_sess, n_lose_sess, len(slab)))

    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2,
                                   random_state=42).split(
        np.zeros(len(X)), np.zeros(len(X)), groups=groups))
    print('训练 %d 样本 / 测试 %d 样本（按 sessionId 切分）'
          % (len(tr), len(te)))

    clf = lgb.LGBMClassifier(
        objective='binary', n_estimators=300, learning_rate=0.03,
        num_leaves=31, max_depth=5, min_child_samples=30,
        subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
        reg_lambda=1.0, n_jobs=-1, random_state=42, verbosity=-1)
    clf.fit(X[tr], y[tr], callbacks=[lgb.log_evaluation(0)])
    pte = clf.predict_proba(X[te])[:, 1]
    ptr = clf.predict_proba(X[tr])[:, 1]
    yte = y[te]

    # ---------- 样本级指标 ----------
    auc = roc_auc_score(yte, pte)
    f1 = f1_score(yte, (pte >= 0.5).astype(int), zero_division=0)
    cm = cm_block(yte, (pte >= 0.5).astype(int))
    # Youden 最优阈值
    fpr, tpr, thr = roc_curve(yte, pte)
    j = np.argmax(tpr - fpr)
    best_thr = float(thr[j])
    f1_best = f1_score(yte, (pte >= best_thr).astype(int), zero_division=0)
    cm_best = cm_block(yte, (pte >= best_thr).astype(int))

    print('\n===== Critic 样本级（测试集） =====')
    print('AUC = %.4f' % auc)
    print('F1@0.5 = %.4f' % f1)
    print('混淆矩阵@0.5 (行真值[负,胜], 列预测[负,胜]):')
    print('  TN=%d  FP=%d' % (cm[0, 0], cm[0, 1]))
    print('  FN=%d  TP=%d' % (cm[1, 0], cm[1, 1]))
    if cm[0, 0] + cm[1, 0] > 0:
        print('  败局召回(真实负中被抓出) = %.4f'
              % (cm[0, 0] / (cm[0, 0] + cm[1, 0])))
    print('Youden 最优阈值 = %.4f, F1@best = %.4f' % (best_thr, f1_best))
    print('混淆矩阵@best:')
    print('  TN=%d  FP=%d' % (cm_best[0, 0], cm_best[0, 1]))
    print('  FN=%d  TP=%d' % (cm_best[1, 0], cm_best[1, 1]))

    # ---------- 局级指标（每局均值概率） ----------
    test_groups = groups[te]
    s_lab = session_label(test_groups, yte)
    s_score = session_scores(test_groups, pte)
    gs = np.array(sorted(s_lab.keys()), dtype=object)
    gtrue = np.array([s_lab[g] for g in gs])
    gpred = np.array([s_score[g] for g in gs])
    g_auc = roc_auc_score(gtrue, gpred)
    g_cm = cm_block(gtrue, (gpred >= 0.5).astype(int))
    g_f1 = f1_score(gtrue, (gpred >= 0.5).astype(int), zero_division=0)
    print('\n===== Critic 局级（每局概率均值，测试集） =====')
    print('局数 %d（胜 %d / 负+强退 %d）'
          % (len(gs), int((gtrue == 1).sum()), int((gtrue == 0).sum())))
    print('局级 AUC = %.4f, 局级 F1@0.5 = %.4f' % (g_auc, g_f1))
    print('局级混淆矩阵:')
    print('  TN=%d  FP=%d' % (g_cm[0, 0], g_cm[0, 1]))
    print('  FN=%d  TP=%d' % (g_cm[1, 0], g_cm[1, 1]))
    if g_cm[0, 0] + g_cm[1, 0] > 0:
        print('  败局局级召回 = %.4f'
              % (g_cm[0, 0] / (g_cm[0, 0] + g_cm[1, 0])))

    # ---------- 保存 ----------
    out = os.path.join(MODEL_DIR, 'SubModel_Critic_v1.pkl')
    meta = {
        'model': clf,
        'feature_keep': CRITIC_KEEP,
        'leak_idx': LEAK_IDX,
        'feature_dim': 121,
        'threshold': 0.5,
        'youden_threshold': best_thr,
        'schema': 'critic_v1',
        'training': 'human win=1 / lose=0 / aborted=0, 8:2 by session, 121-dim (130 minus 9 leak)',
        'train_samples': int(len(tr)), 'test_samples': int(len(te)),
        'sessions_total': int(len(slab)),
        'metrics': {
            'sample_auc': float(auc), 'sample_f1': float(f1),
            'sample_cm': cm.tolist(),
            'sample_cm_best': cm_best.tolist(),
            'best_threshold': best_thr, 'sample_f1_best': float(f1_best),
            'session_auc': float(g_auc), 'session_f1': float(g_f1),
            'session_cm': g_cm.tolist(),
        },
    }
    with open(out, 'wb') as f:
        pickle.dump(meta, f)
    print('\n已保存 %s' % out)

    summary = {
        'file': out, 'feature_dim': 121, 'leak_idx': LEAK_IDX,
        'sample_auc': float(auc), 'sample_f1': float(f1),
        'sample_cm': cm.tolist(),
        'best_threshold': best_thr, 'sample_f1_best': float(f1_best),
        'sample_cm_best': cm_best.tolist(),
        'session_auc': float(g_auc), 'session_f1': float(g_f1),
        'session_cm': g_cm.tolist(),
        'counts': {
            'win_samples': tag_counter['win'],
            'lose_samples': tag_counter['lose'],
            'aborted_samples': tag_counter['aborted'],
            'win_sessions': n_win_sess,
            'lose_aborted_sessions': n_lose_sess,
        },
    }
    with open(os.path.join(WD, 'P2_Critic_Train.json'), 'w',
              encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print('指标落盘 P2_Critic_Train.json')


if __name__ == '__main__':
    main()
