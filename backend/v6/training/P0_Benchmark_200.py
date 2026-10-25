# -*- coding: utf-8 -*-
"""P0_Benchmark_200.py - 200 并发压测 /api/v1/predict，打印 QPS 与 P95"""
import sys
import time
import json
import urllib.request
import numpy as np
from concurrent.futures import ThreadPoolExecutor

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
URL = "http://127.0.0.1:8000/api/v1/predict"
HDR = {"Authorization": "Bearer <YOUR_API_KEY>",
       "Content-Type": "application/json"}
TOTAL = 400
CONCURRENCY = 200

# 真实特征构造 142 维（前130 + 补12个0）
d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X']
payloads = []
for k in range(TOTAL):
    row = X[k % len(X)].tolist()
    body = json.dumps({"features": row + [0] * 12}).encode("utf-8")
    payloads.append(body)


def one(body):
    t0 = time.perf_counter()
    req = urllib.request.Request(URL, data=body, headers=HDR, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        return time.perf_counter() - t0, data.get("execute_action_id"), data.get("abstain")
    except Exception as e:
        return time.perf_counter() - t0, "ERR:%s" % e, None


print("开始压测 %d 请求 / %d 并发 ..." % (TOTAL, CONCURRENCY))
t_start = time.perf_counter()
with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
    results = list(ex.map(one, payloads))
wall = time.perf_counter() - t_start

lat = sorted(r[0] for r in results)
errs = [r for r in results if str(r[1]).startswith("ERR")]
fired = [r for r in results if r[2] is False]
abstained = [r for r in results if r[2] is True]


def pct(p):
    return lat[min(len(lat) - 1, int(p * len(lat)))] * 1000

print("\n========== 压测结果 ==========")
print("总请求 %d  成功 %d  错误 %d" % (TOTAL, TOTAL - len(errs), len(errs)))
print("总耗时 %.2fs  QPS %.1f" % (wall, TOTAL / wall))
print("延迟 P50 %.2fms  P95 %.2fms  P99 %.2fms" % (pct(0.5), pct(0.95), pct(0.99)))
print("下发(具体动作) %d (%.1f%%)  弃权回退 %d (%.1f%%)"
      % (len(fired), 100 * len(fired) / TOTAL,
         len(abstained), 100 * len(abstained) / TOTAL))
