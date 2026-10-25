# -*- coding: utf-8 -*-
"""
P1_EDA.py - 扩维/分模式训练前的真实数据盘点
数据源：
  1) E:\\NoNameAI\\merged_shards\\shard_*.json（去重训练池，任务二指定数据源）
  2) demo_pool.npz / real_pool.npz（既有 aggregate 原始管线，任务一参考）
输出：动作/模式/标签频次、按组可训练性评估。
只读盘点，不写训练产物。
"""
import os
import sys
import json
import glob
import collections
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
SHARD_DIR = r'E:\NoNameAI\merged_shards'


def scan_shards():
    """扫描去重池全部分片，统计 group / action / label / session / 特征维度。"""
    stats = {
        'total': 0,
        'group': collections.Counter(),
        'action': collections.Counter(),
        'label': collections.Counter(),
        'label_group': collections.defaultdict(collections.Counter),
        'sid_group': collections.defaultdict(set),
        'dim': collections.Counter(),
        'fv': collections.Counter(),
        'has_outcome': collections.Counter(),
        'no_sid': 0,
    }
    files = sorted(glob.glob(os.path.join(SHARD_DIR, 'shard_*.json')))
    for fp in files:
        with open(fp, 'r', encoding='utf-8') as f:
            obj = json.load(f)
        ss = obj.get('samples', [])
        for s in ss:
            stats['total'] += 1
            m = s.get('m') or {}
            mc = m.get('modeContext') or {}
            grp = mc.get('group') or 'unknown'
            act = m.get('action') or 'unknown'
            aid = m.get('id') or 'unknown'
            label = '%s:%s' % (act, aid)
            stats['group'][grp] += 1
            stats['action'][act] += 1
            stats['label'][label] += 1
            stats['label_group'][grp][label] += 1
            sid = m.get('sessionId')
            if sid:
                stats['sid_group'][grp].add(sid)
            else:
                stats['no_sid'] += 1
            fv = s.get('f')
            stats['dim'][len(fv) if isinstance(fv, list) else -1] += 1
            stats['fv'][str((s.get('gen') or {}).get('fv', '?'))] += 1
            has = ('gameOutcome' in m) or ('outcomeTarget' in m) or ('observedReward' in m)
            stats['has_outcome'][has] += 1
        print('  parsed', os.path.basename(fp), 'cumulative', stats['total'], flush=True)
    return stats


def report_shards(st):
    print('\n' + '=' * 72)
    print('去重池 merged_shards 总样本: %d' % st['total'])
    print('特征维度分布: %s' % dict(st['dim']))
    print('featureVersion 分布: %s' % dict(st['fv']))
    print('有结果标签: %s' % dict(st['has_outcome']))
    print('无 sessionId 样本: %d' % st['no_sid'])
    print('\n-- 按模式 group --')
    for g, c in st['group'].most_common():
        print('  %-18s %8d  sessions=%d' % (g, c, len(st['sid_group'][g])))
    print('\n-- 按动作 action --')
    for a, c in st['action'].most_common():
        print('  %-12s %8d  (%.1f%%)' % (a, c, 100.0 * c / st['total']))

    print('\n-- 各模式下 top 20 动作标签 --')
    for g in st['group']:
        print('  [%s]' % g)
        for lab, cnt in st['label_group'][g].most_common(20):
            print('      %-28s %8d' % (lab, cnt))

    print('\n-- equip 高频标签 Top 30（全局）--')
    for lab, cnt in st['label'].most_common():
        if lab.startswith('equip:'):
            print('  %-28s %8d' % (lab, cnt))
    print('\n-- skill 高频标签 Top 20（全局）--')
    n = 0
    for lab, cnt in st['label'].most_common():
        if lab.startswith('skill:'):
            print('  %-36s %8d' % (lab, cnt))
            n += 1
            if n >= 20:
                break


def report_npz():
    """既有原始池里的动作/标签分布（任务一原始数据参考）。"""
    print('\n' + '=' * 72)
    print('既有 npz 原始池（aggregate 抽取，10-21 构建）')
    for name in ['real', 'demo']:
        fp = os.path.join(WD, name + '_pool.npz')
        if not os.path.exists(fp):
            print(name, '缺失')
            continue
        d = np.load(fp, allow_pickle=True)
        X, y = d['X'], d['labels']
        lc = collections.Counter(y.tolist())
        act = collections.Counter()
        equip = collections.Counter()
        for lab, cnt in lc.items():
            a = lab.split(':', 1)[0]
            act[a] += cnt
            if a == 'equip':
                equip[lab] += cnt
        print('  %s: %d 行, 特征%s, 标签数%d, sessions=%d'
              % (name, len(y), X.shape, len(lc), len(set(d['sids']))))
        print('    动作分布:', dict(act))
        print('    equip Top 20:', equip.most_common(20))


if __name__ == '__main__':
    st = scan_shards()
    report_shards(st)
    report_npz()
