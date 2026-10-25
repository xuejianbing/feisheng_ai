# -*- coding: utf-8 -*-
"""
P0_Baseline_Prepare.py - 分离 real / player-demonstration 两池
数据源：
  aggregate（默认）：通过 AggregateReader 透明读取冷热 aggregate
    - 冷日期：从 YYYY-MM-DD_raw.tar.gz 流式读取
    - 热日期：直接读取散装 .json
  raw：读取旧快照 E:\\NoNameAI\\data\\P0_True_Raw_Dataset.jsonl
特征口径：
  - 130 维：旧 schema，原样保留
  - 134 维：f130~f133 为目标身份 one-hot，规范化到旧 130 维时丢弃尾部
每行打标：source_type、role、outcome
Policy 标签：action:id（动作客观，不要求 outcome，故无终局的真实对局行也保留）
输出：
  real_pool.npz / demo_pool.npz  (X, raw_labels, sids, roles, outcomes)
  action_mapping.json  (全局复合标签 ID索引 -> 动作名)
自检：
  python P0_Baseline_Prepare.py --self-test
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import argparse
import json
import sys
import numpy as np
from collections import Counter

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
RAW = r'E:\NoNameAI\data\P0_True_Raw_Dataset.jsonl'
LEGACY_DIM = 130

# 冷热透明读取器：冷日期(已归档 *_raw.tar.gz)自动从 tar.gz 流式读取，
# 热日期(散装 .json)直接读取，无需解压到磁盘。
sys.path.insert(0, WD)
from AggregateReader import (
    iter_dates_samples,
    list_dates,
    normalize_features,
    selfTest as aggregateReaderSelfTest,
)


def iter_aggregate_rows(dates):
    """
    按日期遍历 aggregate 目录，yield 与 RAW 快照同构的原始行 dict（含 f/m）。
    - 旧日期(10-08~10-18，已归档)：自动识别并从 YYYY-MM-DD_raw.tar.gz 读取
    - 新日期(10-19+，散装 .json)：直接读取
    用法：for d in iter_aggregate_rows(['2026-10-14', '2026-10-15']): ...
    """
    for date, hour, d in iter_dates_samples(dates):
        yield d


def iter_input_rows(source, dates):
    """按 source 遍历输入行，yield (date, hour, row)。"""
    if source == 'raw':
        with open(RAW, encoding='utf-8') as f:
            for line in f:
                yield 'RAW', '-', json.loads(line)
    else:
        for date, hour, d in iter_dates_samples(dates):
            yield date, hour, d


def parse_row(d):
    """
    解析一行原始样本。
    成功返回：(key, feat130, label, sid, role, outcome, feature_version)
    失败返回：(None, skip_reason)
    """
    m = d.get('m') or {}
    mc = m.get('modeContext') or {}
    src = m.get('source')
    if src == 'real':
        key = 'real'
    elif src == 'player-demonstration':
        key = 'demo'
    else:
        return None, 'unsupported_source'

    try:
        f130, fv, target_tail = normalize_features(d)
    except Exception:
        return None, 'bad_feature_dim'

    sid = m.get('sessionId')
    act = m.get('action')
    aid = m.get('id')
    if sid is None or act is None or aid is None or aid == '':
        return None, 'missing_label'

    label = str(act) + ':' + str(aid)
    role = mc.get('role')
    outcome = m.get('gameOutcome')
    feat = np.array(f130, dtype=np.float32)
    return (key, feat, label, sid,
            str(role) if role is not None else 'unknown',
            str(outcome) if outcome is not None else 'none',
            fv), None


def build_pools(source, dates):
    """从指定数据源构建 real/demo 两池，并返回统计信息。"""
    pools = {'real': [], 'demo': []}
    global_label_cnt = Counter()
    skip_reasons = Counter()
    feature_version_cnt = Counter()
    scanned = 0

    for date, hour, d in iter_input_rows(source, dates):
        scanned += 1
        parsed, skip = parse_row(d)
        if skip:
            skip_reasons[skip] += 1
            continue
        key, feat, label, sid, role, outcome, fv = parsed
        pools[key].append((feat, label, sid, role, outcome))
        global_label_cnt[label] += 1
        feature_version_cnt[str(fv)] += 1
        if scanned % 200000 == 0:
            print(f'  已扫描 {scanned}...', flush=True)

    return {
        'pools': pools,
        'label_counts': global_label_cnt,
        'skip_reasons': skip_reasons,
        'feature_versions': feature_version_cnt,
        'scanned': scanned,
    }


def write_outputs(result):
    """写 action_mapping、real_pool.npz、demo_pool.npz，并打印汇总。"""
    pools = result['pools']
    global_label_cnt = result['label_counts']
    kept = sum(len(rows) for rows in pools.values())
    print(f"扫描总行数 {result['scanned']}, 进入两池 {kept}")
    print(f"跳过原因: {dict(result['skip_reasons'])}")
    print(f"特征版本分布: {dict(result['feature_versions'])}")

    # 全局动作字典（按频次降序）
    ordered = [k for k, _ in global_label_cnt.most_common()]
    mapping = {i: k for i, k in enumerate(ordered)}
    with open(WD + r'\action_mapping.json', 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1)
    print(f'全局复合标签数: {len(ordered)} -> action_mapping.json')

    summaries = {}
    for key, fn in [('real', 'real_pool.npz'), ('demo', 'demo_pool.npz')]:
        rows = pools[key]
        if not rows:
            print(f'--- {key} 池为空，未写入 {fn}')
            continue
        X = np.vstack([r[0] for r in rows]).reshape(len(rows), LEGACY_DIM)
        labels = np.array([r[1] for r in rows], dtype=object)
        sids = np.array([r[2] for r in rows])
        roles = np.array([r[3] for r in rows], dtype=object)
        outcomes = np.array([r[4] for r in rows], dtype=object)
        np.savez(WD + '\\' + fn, X=X, labels=labels, sids=sids,
                 roles=roles, outcomes=outcomes)
        lc = Counter(labels)
        print(f'--- {key} 池: {len(rows)} 行, session {len(set(sids))}, 标签 distinct {len(lc)}')
        print(f'    role: {dict(Counter(roles))}')
        print(f'    outcome: {dict(Counter(outcomes))}')
        # 频次分桶
        b = Counter()
        for k, v in lc.items():
            if v >= 500:
                b['>=500'] += 1
            elif v >= 100:
                b['100-500'] += 1
            elif v >= 50:
                b['50-100'] += 1
            elif v >= 20:
                b['20-50'] += 1
            elif v >= 10:
                b['10-20'] += 1
            else:
                b['<10'] += 1
        print(f'    标签频次桶: {dict(b)}')
        summaries[key] = {
            'rows': len(rows),
            'sessions': len(set(sids)),
            'distinct_labels': len(lc),
        }
    return summaries


def selfTest():
    """
    P0_Baseline_Prepare 自检：
      1) AggregateReader 冷/热读取与 134 维规范化通过
      2) 合成 130/134 维样本解析口径正确
    """
    try:
        reader_test = aggregateReaderSelfTest()
        if not reader_test.get('ok'):
            return {'ok': False, 'msg': 'AggregateReader 自检失败', 'data': reader_test}

        sample_130 = {
            'f': [0] * 130,
            'm': {
                'source': 'real',
                'sessionId': 'sid-130',
                'action': 'card',
                'id': 'sha',
                'modeContext': {'role': 'landlord'},
            },
        }
        sample_134 = {
            'f': [0] * 130 + [127, 0, 0, 0],
            'gen': {'fv': 134},
            'm': {
                'source': 'real',
                'sessionId': 'sid-134',
                'action': 'card',
                'id': 'tao',
                'modeContext': {'role': 'farmer'},
            },
        }
        result_130, skip_130 = parse_row(sample_130)
        result_134, skip_134 = parse_row(sample_134)
        if skip_130 or skip_134:
            return {
                'ok': False,
                'msg': '合成样本解析失败: 130=%s 134=%s' % (skip_130, skip_134),
                'data': None,
            }
        key_130, feat_130, label_130, sid_130, role_130, outcome_130, fv_130 = result_130
        key_134, feat_134, label_134, sid_134, role_134, outcome_134, fv_134 = result_134
        if feat_130.shape != (130,) or feat_134.shape != (130,):
            return {'ok': False, 'msg': '规范化后特征维度不是130', 'data': None}
        if label_134 != 'card:tao':
            return {'ok': False, 'msg': '134维样本标签解析错误', 'data': None}
        return {
            'ok': True,
            'msg': 'P0_Baseline_Prepare 自检正常：130/134维均可解析并规范化到130维',
            'data': {
                'reader': reader_test,
                'synthetic_130_label': label_130,
                'synthetic_134_label': label_134,
                'synthetic_134_shape': list(feat_134.shape),
            },
        }
    except Exception as e:
        return {'ok': False, 'msg': 'P0_Baseline_Prepare 自检异常: %s' % e, 'data': None}


def main():
    parser = argparse.ArgumentParser(description='构建 real/demo Policy 两池')
    parser.add_argument('--source', choices=['raw', 'aggregate'], default='aggregate',
                        help='数据源，默认 aggregate')
    parser.add_argument('--dates', nargs='*',
                        help='aggregate 模式下指定日期，如 --dates 2026-10-14 2026-10-15；默认自动发现全部日期')
    parser.add_argument('--self-test', action='store_true', help='运行自检并退出')
    args = parser.parse_args()

    if args.self_test:
        r = selfTest()
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r.get('ok') else 1

    dates = args.dates
    if args.source == 'aggregate':
        dates = dates or list_dates()
        if not dates:
            raise RuntimeError('未发现 aggregate 日期目录')
        print('数据源: aggregate | dates=%s' % dates, flush=True)
    else:
        print('数据源: raw snapshot | %s' % RAW, flush=True)

    result = build_pools(args.source, dates)
    write_outputs(result)
    return 0


if __name__ == '__main__':
    sys.exit(main())
