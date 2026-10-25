# -*- coding: utf-8 -*-
"""P0_Benchmark_Diag.py - 诊断并发错误类型"""
import time
import json
import urllib.request
import numpy as np
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
URL = "http://127.0.0.1:8000/api/v1/predict"
HDR = {"Authorization": "Bearer <YOUR_API_KEY>",
       "Content-Type": "application/json"}

d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X = d['X']
bodies = [json.dumps({"features": X[k % len(X)].tolist() + [0] * 12}).encode("utf-8")
          for k in range(120)]


def one(body):
    t0 = time.perf_counter()
    req = urllib.request.Request(URL, data=body, headers=HDR, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return time.perf_counter() - t0, "OK"
    except Exception as e:
        return time.perf_counter() - t0, type(e).__name__ + ":" + str(e)[:80]


with ThreadPoolExecutor(max_workers=200) as ex:
    res = list(ex.map(one, bodies))
c = Counter(r[1] for r in res)
for k, v in c.most_common():
    print("%4d  %s" % (v, k))
