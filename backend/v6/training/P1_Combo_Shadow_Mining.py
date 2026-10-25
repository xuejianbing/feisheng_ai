# -*- coding: utf-8 -*-
"""
P1_Combo_Shadow_Mining.py - 任务三：附属数据二次挖掘（comboChains + shadowV5）

数据源：E:\\NoNameAI\\aggregate\\*\\*.json（服务端原始小时归档，全量收包）

产出（落盘 E:\\NoNameAI\\mining\\，作为"组合技硬规则"与盲区补强的原料）：
  1. combo_chains_by_session.jsonl   每个携带 comboChains 的包 -> 按 sessionId 切片
  2. combo_chain_summary.json        连招 id 聚合：次数/胜场/胜率/出现包数
  3. action_bigrams.json             同玩家相邻动作二元组（酒+杀、顺手+杀等真实序列）
  4. shadow_diff_records.jsonl       shadowV5 与真实动作不一致的逐条记录（盲区切片）
  5. shadow_summary.json             影子差异率：总体/按模式/按真实动作/按候选数

自检：python P1_Combo_Shadow_Mining.py --self-test  -> {ok,msg,data}
"""
import argparse
import collections
import glob
import json
import os
import sqlite3
import sys
import time

BASE = r'E:\NoNameAI'
AGG_DIR = os.path.join(BASE, 'aggregate')
OUT_DIR = os.path.join(BASE, 'mining')
SQLITE = os.path.join(BASE, 'dedup.sqlite')

LABEL_KEYS = ('gameOutcome', 'outcomeTarget', 'observedReward')


def iter_aggregate_files():
    return sorted(glob.glob(os.path.join(AGG_DIR, '*', '*.json')))


def label_of(m):
    return '%s:%s' % (m.get('action'), m.get('id'))


def action_type(lab):
    return (lab or '').split(':', 1)[0]


def run():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = iter_aggregate_files()
    print('aggregate 文件数: %d' % len(files))

    # 连招聚合
    chain_agg = collections.defaultdict(lambda: {
        'name': '', 'bonus': 0.0, 'packets': 0, 'times': 0, 'wins': 0})
    # 动作二元组（同 session 同 actor，按 ts 排序后相邻）
    bigram_all = collections.Counter()
    bigram_card_card = collections.Counter()
    n_pair_sessions = 0
    # 影子（服务端归档时已按 decisionId 去重，此处无需再去）
    sh_total = sh_diff = 0
    sh_by_mode = collections.Counter()
    sh_by_mode_diff = collections.Counter()
    sh_by_action = collections.Counter()
    sh_by_action_diff = collections.Counter()
    sh_by_cand = collections.Counter()
    sh_by_cand_diff = collections.Counter()
    # 切片文件句柄
    f_chain = open(os.path.join(OUT_DIR, 'combo_chains_by_session.jsonl'),
                   'w', encoding='utf-8')
    f_shadow = open(os.path.join(OUT_DIR, 'shadow_diff_records.jsonl'),
                    'w', encoding='utf-8')
    n_pkts = 0
    n_samples = 0

    for fp in files:
        with open(fp, 'r', encoding='utf-8') as f:
            try:
                packets = json.load(f)
            except Exception:
                continue
        date = os.path.basename(os.path.dirname(fp))
        hour = os.path.splitext(os.path.basename(fp))[0]
        for pkt in packets:
            n_pkts += 1
            samples = pkt.get('samples') or []
            n_samples += len(samples)

            # ---- 1) comboChains 按 sessionId 切片 ----
            cc = pkt.get('comboChains')
            if cc:
                sid = None
                if samples:
                    sid = (samples[0].get('m') or {}).get('sessionId')
                for c in cc:
                    cid = c.get('id', '?')
                    a = chain_agg[cid]
                    a['name'] = c.get('name', '')
                    a['bonus'] = c.get('bonus', 0) or 0
                    a['packets'] += 1
                    a['times'] += c.get('times', 0) or 0
                    a['wins'] += c.get('wins', 0) or 0
                f_chain.write(json.dumps({
                    'date': date, 'hour': hour, 'sessionId': sid,
                    'chains': cc,
                }, ensure_ascii=False) + '\n')

            # ---- 2) 同玩家相邻动作二元组 ----
            seq = collections.defaultdict(list)
            for s in samples:
                m = s.get('m') or {}
                sid = m.get('sessionId')
                actor = m.get('actorId')
                if not sid or actor is None or not m.get('action') or not m.get('id'):
                    continue
                seq[(sid, actor)].append((s.get('ts', 0), label_of(m)))
            for key, rows in seq.items():
                if len(rows) < 2:
                    continue
                rows.sort(key=lambda x: x[0])
                labs = [x[1] for x in rows]
                n_pair_sessions += 1
                for a, b in zip(labs[:-1], labs[1:]):
                    bigram_all[(a, b)] += 1
                    if a.startswith('card:') and b.startswith('card:'):
                        bigram_card_card[(a, b)] += 1

            # ---- 3) shadowV5 差异分析 ----
            sv = pkt.get('shadowV5')
            if sv:
                for r in sv:
                    team = r.get('teamPick')
                    v5 = r.get('v5Pick')
                    if not team or not v5:
                        continue
                    sh_total += 1
                    mode = r.get('mode', 'unknown')
                    cand = r.get('candCount', 0)
                    diff = (team != v5)
                    sh_by_mode[mode] += 1
                    sh_by_action[team] += 1
                    sh_by_cand[cand] += 1
                    if diff:
                        sh_diff += 1
                        sh_by_mode_diff[mode] += 1
                        sh_by_action_diff[team] += 1
                        sh_by_cand_diff[cand] += 1
                        f_shadow.write(json.dumps({
                            'date': date, 'hour': hour,
                            'ts': r.get('ts'), 'mode': mode,
                            'player': r.get('player'), 'round': r.get('round'),
                            'candCount': cand, 'reward': r.get('reward'),
                            'teamPick': team, 'v5Pick': v5,
                            'v5PickS42': r.get('v5PickS42'),
                            'v5PickS456': r.get('v5PickS456'),
                        }, ensure_ascii=False) + '\n')
        if n_pkts % 100 == 0:
            print('  已处理 %d 包 / %d 样本' % (n_pkts, n_samples), flush=True)

    f_chain.close()
    f_shadow.close()

    # ---------- 连招汇总 ----------
    chain_out = []
    for cid, a in chain_agg.items():
        winrate = a['wins'] / a['times'] if a['times'] else None
        chain_out.append({
            'id': cid, 'name': a['name'], 'bonus': a['bonus'],
            'packets': a['packets'], 'times': a['times'],
            'wins': a['wins'], 'winrate': winrate,
        })
    chain_out.sort(key=lambda x: -x['times'])
    with open(os.path.join(OUT_DIR, 'combo_chain_summary.json'), 'w',
              encoding='utf-8') as f:
        json.dump(chain_out, f, ensure_ascii=False, indent=1)

    # ---------- 二元组 top 榜 ----------
    bigram_out = {
        'note': '同局同玩家按ts相邻动作对；client按20~300局/包上报，跨包长链仅统计包内相邻',
        'top_all': [
            {'a': a, 'b': b, 'count': c}
            for (a, b), c in bigram_all.most_common(80)
        ],
        'top_card_card': [
            {'a': a, 'b': b, 'count': c}
            for (a, b), c in bigram_card_card.most_common(50)
        ],
        # 用户点名的组合
        'focus': {
            '%s -> %s' % (a, b): bigram_all[(a, b)]
            for a, b in [('card:shunshou', 'card:sha'), ('card:jiu', 'card:sha'),
                         ('card:guohe', 'card:sha'), ('card:wuzhong', 'card:sha'),
                         ('card:nanman', 'card:sha'), ('card:tiesuo', 'card:huogong'),
                         ('card:jiu', 'card:juedou'), ('card:lebu', 'card:sha')]
        },
    }
    with open(os.path.join(OUT_DIR, 'action_bigrams.json'), 'w',
              encoding='utf-8') as f:
        json.dump(bigram_out, f, ensure_ascii=False, indent=1)

    # ---------- 影子汇总 ----------
    def rate(diff, tot):
        return round(diff / tot, 4) if tot else None
    shadow_out = {
        'total_decisions': sh_total,
        'diff_count': sh_diff,
        'diff_rate': rate(sh_diff, sh_total),
        'by_mode': {
            m: {'total': sh_by_mode[m],
                'diff': sh_by_mode_diff[m],
                'diff_rate': rate(sh_by_mode_diff[m], sh_by_mode[m])}
            for m in sorted(sh_by_mode)
        },
        'blindspot_by_teamPick': sorted(
            ({'action': a, 'total': sh_by_action[a],
              'diff': sh_by_action_diff[a],
              'diff_rate': rate(sh_by_action_diff[a], sh_by_action[a])}
             for a in sh_by_action if sh_by_action[a] >= 20),
            key=lambda x: -(x['diff_rate'] or 0)),
        'by_candCount': {
            str(c): {'total': sh_by_cand[c],
                     'diff': sh_by_cand_diff[c],
                     'diff_rate': rate(sh_by_cand_diff[c], sh_by_cand[c])}
            for c in sorted(sh_by_cand)
        },
    }
    with open(os.path.join(OUT_DIR, 'shadow_summary.json'), 'w',
              encoding='utf-8') as f:
        json.dump(shadow_out, f, ensure_ascii=False, indent=1)

    # ---------- 终端摘要 ----------
    print('\n===== comboChains 连招汇总（按触发次数）=====')
    for c in chain_out:
        wr = '%.0f%%' % (100 * c['winrate']) if c['winrate'] is not None else 'N/A'
        print('  %-20s %-12s times=%-5d wins=%-5d 胜率=%s bonus=%s'
              % (c['id'], c['name'], c['times'], c['wins'], wr, c['bonus']))
    print('\n===== 出牌->出牌 Top15 二元组 =====')
    for item in bigram_out['top_card_card'][:15]:
        print('  %-18s -> %-18s %d' % (item['a'], item['b'], item['count']))
    print('  点名组合:', json.dumps(bigram_out['focus'], ensure_ascii=False))
    print('\n===== shadowV5 影子差异 =====')
    print('  决策总数 %d，差异 %d，差异率 %.2f%%'
          % (sh_total, sh_diff, 100 * (sh_diff / sh_total if sh_total else 0)))
    print('  按模式:')
    for m, v in shadow_out['by_mode'].items():
        print('    %-12s %5d 决策, 差异率 %.1f%%'
              % (m, v['total'], 100 * (v['diff_rate'] or 0)))
    print('  盲区 Top10（真实动作被影子判错率，支持>=20）:')
    for x in shadow_out['blindspot_by_teamPick'][:10]:
        print('    %-22s %5d 次, 差异率 %.1f%%'
              % (x['action'], x['total'], 100 * (x['diff_rate'] or 0)))
    print('\n切片已落盘目录:', OUT_DIR)
    return shadow_out


def self_test():
    try:
        ok = True
        msgs = []
        for name, need in [('combo_chains_by_session.jsonl', 0),
                           ('combo_chain_summary.json', 1),
                           ('action_bigrams.json', 1),
                           ('shadow_diff_records.jsonl', 0),
                           ('shadow_summary.json', 1)]:
            p = os.path.join(OUT_DIR, name)
            exists = os.path.isfile(p)
            if not exists:
                ok = False
                msgs.append('缺少 %s' % name)
        summ = json.load(open(os.path.join(OUT_DIR, 'shadow_summary.json'),
                              encoding='utf-8'))
        big = json.load(open(os.path.join(OUT_DIR, 'action_bigrams.json'),
                             encoding='utf-8'))
        return {'ok': ok, 'msg': '任务三挖掘自检: ' + ('; '.join(msgs) or '全部切片就绪'),
                'data': {'shadow_total': summ['total_decisions'],
                         'shadow_diff_rate': summ['diff_rate'],
                         'top_bigrams': big['top_card_card'][:5],
                         'combo_kinds': len(json.load(open(
                             os.path.join(OUT_DIR, 'combo_chain_summary.json'),
                             encoding='utf-8')))}}
    except Exception as e:
        return {'ok': False, 'msg': '任务三自检异常: %s' % e, 'data': None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), ensure_ascii=False, indent=1))
        return 0
    t0 = time.time()
    run()
    print('耗时 %.1fs' % (time.time() - t0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
