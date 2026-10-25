# -*- coding: utf-8 -*-
"""
P1_Data_Daily_Report.py - 任务四：数据监控日报

用法：
  python P1_Data_Daily_Report.py                # 当天（本地时区）
  python P1_Data_Daily_Report.py --date 2026-10-22
  python P1_Data_Daily_Report.py --self-test    # 自检（最近一天），返回 {ok,msg,data}

统计口径：
  1. aggregate 当日小时归档（原始收包，含被过滤样本）：
     收到样本数、动作分布 card/equip/skill/end、模式分布、无标签样本数、污染率
  2. dedup.sqlite request_receipts（按 receipt.hour 过滤当日）：
     新增入池、去重拦截、过滤无标签（服务端计数，与归档口径互校）
  3. GET http://127.0.0.1:8787/ ：当前池内总数、累计去重、degraded
告警：污染率（无标签样本/收到样本）> 50% 时打印 ALERT，退出码 2（cron 可识别）
报告落盘：E:\\NoNameAI\\reports\\daily_YYYY-MM-DD.json
"""
import argparse
import datetime as dt
import glob
import json
import os
import sqlite3
import sys
import urllib.request

BASE = r'E:\NoNameAI'
AGG_DIR = os.path.join(BASE, 'aggregate')
REPORT_DIR = os.path.join(BASE, 'reports')
SQLITE = os.path.join(BASE, 'dedup.sqlite')
POLLUTION_ALERT = 0.50
LABEL_KEYS = ('gameOutcome', 'outcomeTarget', 'observedReward')


def scan_aggregate(date):
    files = sorted(glob.glob(os.path.join(AGG_DIR, date, '*.json')))
    received = 0
    unlabeled = 0
    action_dist = {}
    mode_dist = {}
    hours = {}
    for fp in files:
        hour = os.path.splitext(os.path.basename(fp))[0]
        h_recv = 0
        h_nolabel = 0
        try:
            packets = json.load(open(fp, encoding='utf-8'))
        except Exception:
            continue
        for pkt in packets:
            for s in pkt.get('samples') or []:
                received += 1
                h_recv += 1
                m = s.get('m') or {}
                act = m.get('action') or 'unknown'
                action_dist[act] = action_dist.get(act, 0) + 1
                grp = ((m.get('modeContext') or {}).get('group')) or 'unknown'
                mode_dist[grp] = mode_dist.get(grp, 0) + 1
                has_label = any(k in m for k in LABEL_KEYS)
                if not has_label:
                    unlabeled += 1
                    h_nolabel += 1
        hours[hour] = {'received': h_recv, 'unlabeled': h_nolabel,
                       'bytes': os.path.getsize(fp)}
    return {'files': len(files), 'received': received, 'unlabeled': unlabeled,
            'action_dist': dict(sorted(action_dist.items(), key=lambda x: -x[1])),
            'mode_dist': dict(sorted(mode_dist.items(), key=lambda x: -x[1])),
            'hours': hours}


def scan_receipts(date):
    agg = {'received': 0, 'merged_new': 0, 'duplicates': 0,
           'rejected_unlabeled': 0, 'requests': 0}
    if not os.path.isfile(SQLITE):
        agg['error'] = 'dedup.sqlite 不存在'
        return agg
    con = sqlite3.connect(SQLITE, timeout=15)
    cur = con.execute('SELECT receipt FROM request_receipts WHERE receipt IS NOT NULL')
    pref = date + 'T'
    for (txt,) in cur:
        try:
            r = json.loads(txt)
        except Exception:
            continue
        if not str(r.get('hour', '')).startswith(pref):
            continue
        agg['requests'] += 1
        agg['received'] += r.get('receivedSamples', 0) or 0
        agg['merged_new'] += r.get('mergedNewSamples', 0) or 0
        agg['duplicates'] += r.get('duplicateSamples', 0) or 0
        agg['rejected_unlabeled'] += r.get('rejectedUnlabeledSamples', 0) or 0
    con.close()
    return agg


def query_pool():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8787/', timeout=8) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'status': 'DOWN', 'error': str(e)}


def build_report(date):
    agg = scan_aggregate(date)
    rc = scan_receipts(date)
    pool = query_pool()
    pollution = agg['unlabeled'] / agg['received'] if agg['received'] else 0.0
    rc_pollution = (rc['rejected_unlabeled'] / rc['received']
                    if rc.get('received') else None)
    return {
        'date': date,
        'generated_at': dt.datetime.now().isoformat(timespec='seconds'),
        'aggregate': agg,
        'receipts': rc,
        'pool': pool,
        'pollution_rate': round(pollution, 4),
        'pollution_alert': bool(pollution > POLLUTION_ALERT),
        'receipt_pollution_rate': (round(rc_pollution, 4)
                                   if rc_pollution is not None else None),
    }


def pct(x, n):
    return '%.1f%%' % (100 * x / n) if n else 'N/A'


def print_report(r):
    agg, rc, pool = r['aggregate'], r['receipts'], r['pool']
    print('=' * 64)
    print('数据监控日报  %s（生成于 %s）' % (r['date'], r['generated_at']))
    print('=' * 64)
    print('[原始归档] 小时文件 %d 个，收到样本 %d，无标签 %d（污染率 %s）'
          % (agg['files'], agg['received'], agg['unlabeled'],
             pct(agg['unlabeled'], agg['received'])))
    print('[服务端回执] 请求 %d 次：新增入池 %d / 去重拦截 %d / 过滤无标签 %d'
          % (rc['requests'], rc['merged_new'], rc['duplicates'],
             rc['rejected_unlabeled']))
    if rc.get('error'):
        print('  回执异常: %s' % rc['error'])
    if pool.get('status') == 'DOWN':
        print('[去重池] 8787 服务不可达: %s' % pool.get('error'))
    else:
        print('[去重池] 当前池内 %s，累计去重 %s，degraded=%s'
              % (pool.get('merged_samples'), pool.get('total_deduped'),
                 pool.get('merged_pool_degraded')))
    print('\n动作分布（归档）:')
    for k, v in agg['action_dist'].items():
        print('  %-8s %8d  %s' % (k, v, pct(v, agg['received'])))
    print('\n模式分布（归档）:')
    for k, v in list(agg['mode_dist'].items())[:12]:
        print('  %-20s %8d  %s' % (k, v, pct(v, agg['received'])))
    print('\n小时明细:')
    for h, d in sorted(agg['hours'].items()):
        print('  %s  %7d 样本 (%.1f MB) 无标签 %d'
              % (h, d['received'], d['bytes'] / 1048576, d['unlabeled']))
    print('\n污染率 = 无标签/收到 = %.2f%%（阈值 %.0f%%）'
          % (100 * r['pollution_rate'], 100 * POLLUTION_ALERT))
    if r['pollution_alert']:
        print('!! ALERT !! 污染率超过 %.0f%%，立即排查客户端上报/数据链路（可能在回传古早无标签数据）'
              % (100 * POLLUTION_ALERT))
    else:
        print('污染率正常（未触发告警）')


def self_test():
    try:
        dates = sorted([os.path.basename(p)
                        for p in glob.glob(os.path.join(AGG_DIR, '*'))
                        if os.path.isdir(p)])
        if not dates:
            return {'ok': False, 'msg': 'aggregate 下无任何日期目录', 'data': None}
        date = dates[-1]
        r = build_report(date)
        pool_ok = r['pool'].get('status') == 'ok'
        data_ok = r['aggregate']['received'] > 0
        ok = pool_ok and data_ok
        return {
            'ok': ok,
            'msg': '日报自检（最近日期 %s）：%s；%s'
                   % (date, '8787正常' if pool_ok else '8787不可达',
                      '归档有数据' if data_ok else '归档无数据'),
            'data': {
                'date': date,
                'received': r['aggregate']['received'],
                'unlabeled': r['aggregate']['unlabeled'],
                'pollution_rate': r['pollution_rate'],
                'pollution_alert': r['pollution_alert'],
                'merged_new': r['receipts']['merged_new'],
                'pool_total': r['pool'].get('merged_samples'),
                'pool_status': r['pool'].get('status'),
            },
        }
    except Exception as e:
        return {'ok': False, 'msg': '日报自检异常: %s' % e, 'data': None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default='today',
                    help="YYYY-MM-DD 或 today / yesterday")
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()
    if args.self_test:
        r = self_test()
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0 if r['ok'] else 1
    if args.date == 'today':
        date = dt.date.today().isoformat()
    elif args.date == 'yesterday':
        date = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    else:
        date = args.date
    r = build_report(date)
    os.makedirs(REPORT_DIR, exist_ok=True)
    out = os.path.join(REPORT_DIR, 'daily_%s.json' % date)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    print_report(r)
    print('\n报告已落盘:', out)
    return 2 if r['pollution_alert'] else 0


if __name__ == '__main__':
    sys.exit(main())
