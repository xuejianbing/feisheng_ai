# -*- coding: utf-8 -*-
"""P0_Concurrency_Sweep.py - 并发等级扫描：找真实容量边界"""
import time
import json
import urllib.request
import numpy as np
from concurrent.futures import ThreadPoolExecutor

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
URL = "http://127.0.0.1:8000/api/v1/predict"
HDR = {"Authorization": "Bearer <YOUR_API_KEY>",
       "Content-Type": "application/json"}

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X']
POOL = [json.dumps({"features": X[k % len(X)].tolist() + [0] * 12}).encode("utf-8")
        for k in range(800)]


def one(body):
    t0 = time.perf_counter()
    req = urllib.request.Request(URL, data=body, headers=HDR, method="POST")
    try:
        urllib.request.urlopen(req, timeout=30).read()
        return (time.perf_counter() - t0) * 1000
    except Exception:
        return None


print('并发  请求数  错误  QPS    P50ms    P95ms')
for cc in [1, 5, 10, 20, 50, 100, 200]:
    n = max(cc * 4, 40)
    bodies = POOL[:n]
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=cc) as ex:
        lat = list(ex.map(one, bodies))
    wall = time.perf_counter() - t0
    ok = [x for x in lat if x is not None]
    errs = len(lat) - len(ok)
    ok.sort()
    p50 = ok[len(ok) // 2]
    p95 = ok[min(len(ok) - 1, int(0.95 * len(ok)))]
    print('%4d  %5d  %4d  %6.1f  %7.1f  %7.1f'
          % (cc, n, errs, len(ok) / wall, p50, p95))
