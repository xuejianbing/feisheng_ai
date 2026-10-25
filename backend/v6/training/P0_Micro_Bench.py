# -*- coding: utf-8 -*-
"""P0_Micro_Bench.py - 微基准：纯推理/单请求/串行延迟"""
import sys
import time
import json
import pickle
import urllib.request
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
sys.path.insert(0, WD)
sys.path.insert(0, WD + r'\_pylibs')
import Hybrid_Router as HR

KEEP = list(range(0, 32)) + list(range(48, 130))
d = np.load(WD + r'\real_pool.npz', allow_pickle=True)
X130 = d['X']
X114 = X130[:, KEEP].astype(np.float64)

# 1) 纯 predict_proba：单条循环 vs 批量
model, classes = HR._load()
t0 = time.perf_counter()
for k in range(1000):
    model.predict_proba(X114[k:k + 1])
t_single = (time.perf_counter() - t0) / 1000

t0 = time.perf_counter()
model.predict_proba(X114[:1000])
t_batch = (time.perf_counter() - t0) / 1000

print('LGBM predict_proba: 单条 %.3fms  批量(1000) 每条 %.4fms' % (t_single * 1000, t_batch * 1000))

# 2) 完整 route() 纯吞吐
t0 = time.perf_counter()
for k in range(1000):
    HR.route(X114[k].tolist())
t_route = (time.perf_counter() - t0) / 1000
print('完整 route() 单次: %.3fms  理论吞吐 %.0f QPS' % (t_route * 1000, 1 / t_route))

# 3) 串行 HTTP 单请求延迟（空闲系统）
HDR = {"Authorization": "Bearer <YOUR_API_KEY>", "Content-Type": "application/json"}
lat = []
for k in range(60):
    body = json.dumps({"features": X130[k].tolist() + [0] * 12}).encode("utf-8")
    req = urllib.request.Request("http://127.0.0.1:8000/api/v1/predict",
                                 data=body, headers=HDR, method="POST")
    t0 = time.perf_counter()
    urllib.request.urlopen(req, timeout=10).read()
    lat.append((time.perf_counter() - t0) * 1000)
lat.sort()
print('HTTP 串行单请求: P50 %.2fms P95 %.2fms' % (lat[len(lat) // 2], lat[int(0.95 * len(lat))]))
