# -*- coding: utf-8 -*-
"""
P3_Critic_WinLoss_Train.py - Critic 胜率模型（真人已结算局，win=1 / lose=0）
口径（严格按真人审计结论）：
  - 数据源 E:\\NoNameAI\\merged_shards（三池拆分后的真人池，仅 player-demonstration 且 session 有 win/lose）
  - 仅取 m.gameOutcome in ('win','lose')；无终局（强退）行整体剔除，不参与训练
  - 特征 f[:, KEEP] 114 维（KEEP=0-31+48-129，已排除 32-47 泄露维）
  - 按 sessionId GroupShuffleSplit 80/20，整局不跨训练/测试（杜绝局内泄漏）
  - LGBM 二分类，同 policy 口径（n_estimators=200, num_leaves=15, max_depth=4）
输出：
  - E:\\NoNameAI\\model\\Critic_WinLoss_v1.pkl
  - P3_Critic_WinLoss.json（行级 ROC-AUC/PR-AUC/Brier、局级 ROC-AUC、校准分桶、top 特征）
"""
import json, os, re, sys, pickle
import numpy as np

WD = os.environ.get('TRAIN_WORK_DIR', os.path.dirname(os.path.abspath(__file__)))
WD2 = os.environ.get('TRAIN_LIBS_DIR', os.path.join(WD, '_pylibs'))
MODEL_DIR = os.environ.get('TRAIN_MODEL_DIR', r'E:\NoNameAI\model')
HUMAN_SHARD_DIR = os.environ.get('TRAIN_HUMAN_SHARD_DIR', r'E:\NoNameAI\merged_shards')
KEEP = list(range(0, 32)) + list(range(48, 130))

sys.path.insert(0, os.path.join(WD2, '_pylibs'))
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import roc_auc_score, average_precision_score, brier_score_loss
import lightgbm as lgb


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
            y.append(1 if m.get('gameOutcome') == 'win' else 0)
            groups.append(m.get('sessionId'))
    X = np.asarray(X, dtype=np.float32)[:, KEEP]
    y = np.asarray(y, dtype=np.int8)
    groups = np.asarray(groups, dtype=object)
    return X, y, groups, skipped


def main():
    print('加载真人已结算池 ...')
    X, y, groups, skipped = load_human()
    sess = {}
    for g, yy in zip(groups.tolist(), y.tolist()):
        sess[g] = yy
    n_win_s = sum(1 for v in sess.values() if v == 1)
    n_lose_s = sum(1 for v in sess.values() if v == 0)
    print('行数 %d（win %d / lose %d）, 特征维 %d, 局数 %d（胜 %d / 负 %d）, 跳过 %d'
          % (len(X), int((y == 1).sum()), int((y == 0).sum()), X.shape[1],
             len(sess), n_win_s, n_lose_s, skipped))

    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2,
                                    random_state=42).split(
        np.zeros(len(X)), np.zeros(len(X)), groups=groups))
    print('训练 %d 行 / 测试 %d 行（按 sessionId 切分，整局不跨集）' % (len(tr), len(te)))

    clf = lgb.LGBMClassifier(
        objective='binary', n_estimators=200, num_leaves=15, max_depth=4,
        n_jobs=-1, random_state=42, verbosity=-1)
    clf.fit(X[tr], y[tr], callbacks=[lgb.log_evaluation(0)])
    p = clf.predict_proba(X[te])[:, 1]

    # ---- 行级指标 ----
    row_auc = roc_auc_score(y[te], p)
    row_ap = average_precision_score(y[te], p)
    brier = brier_score_loss(y[te], p)
    base = float(y[te].mean())

    # ---- 局级指标：每个测试局的行预测均值 ----
    g_te = groups[te]
    sg, sp = {}, {}
    for g, pp in zip(g_te.tolist(), p.tolist()):
        sg.setdefault(g, []).append(pp)
    gy, gprob = [], []
    for g, ps in sg.items():
        gy.append(sess[g])
        gprob.append(float(np.mean(ps)))
    gy, gprob = np.asarray(gy), np.asarray(gprob)
    sess_auc = roc_auc_score(gy, gprob)
    sess_ap = average_precision_score(gy, gprob)

    # ---- 校准分桶（行级） ----
    bins = np.linspace(0, 1, 11)
    idx = np.digitize(p, bins[1:-1])
    cal = []
    for b in range(10):
        m = idx == b
        if m.sum() == 0:
            continue
        cal.append({'bin': '%.1f-%.1f' % (bins[b], bins[b + 1]),
                    'n': int(m.sum()), 'pred_win': round(float(p[m].mean()), 3),
                    'actual_win': round(float(y[te][m].mean()), 3)})

    # ---- 重要特征 ----
    imp = sorted(zip(range(X.shape[1]), clf.feature_importances_),
                 key=lambda t: -t[1])[:10]
    top_feats = [{'keep_idx': int(i), 'importance': int(v)} for i, v in imp]

    print('\n===== Critic 胜率模型（真实指标） =====')
    print('测试集胜率基线 = %.4f' % base)
    print('行级 ROC-AUC   = %.4f' % row_auc)
    print('行级 PR-AUC    = %.4f' % row_ap)
    print('行级 Brier     = %.4f' % brier)
    print('局级（%d 局，胜 %d / 负 %d）ROC-AUC = %.4f' % (
        len(gy), int((gy == 1).sum()), int((gy == 0).sum()), sess_auc))
    print('局级 PR-AUC    = %.4f' % sess_ap)
    print('校准分桶:')
    for c in cal:
        print('  %-9s n=%-6d 预测胜=%.3f 实际胜=%.3f' % (
            c['bin'], c['n'], c['pred_win'], c['actual_win']))

    out = os.path.join(MODEL_DIR, 'Critic_WinLoss_v1.pkl')
    meta = {'model': clf, 'feature_keep': KEEP, 'feature_dim': 114,
            'schema': 'critic_winloss_human_v1',
            'training': 'pure human settled (player-demonstration, win/lose sessions), 8:2 by session',
            'label': {'win': 1, 'lose': 0, 'aborted': 'excluded'},
            'row_roc_auc': row_auc, 'session_roc_auc': sess_auc}
    with open(out, 'wb') as f:
        pickle.dump(meta, f)
    print('已保存 %s' % out)

    summary = {
        'file': out,
        'rows': int(len(X)), 'rows_win': int((y == 1).sum()), 'rows_lose': int((y == 0).sum()),
        'sessions': len(sess), 'sessions_win': n_win_s, 'sessions_lose': n_lose_s,
        'skipped': skipped,
        'train_rows': int(len(tr)), 'test_rows': int(len(te)),
        'metrics': {'row_roc_auc': row_auc, 'row_pr_auc': row_ap, 'brier': brier,
                    'test_win_rate_baseline': base,
                    'session_count': int(len(gy)),
                    'session_roc_auc': sess_auc, 'session_pr_auc': sess_ap},
        'calibration': cal, 'top_features': top_feats,
    }
    with open(os.path.join(WD, 'P3_Critic_WinLoss.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print('指标落盘 P3_Critic_WinLoss.json')


if __name__ == '__main__':
    main()
