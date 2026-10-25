# -*- coding: utf-8 -*-
import json, time, os
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://127.0.0.1:8000/api/v1/predict'
LEGAL = ['card:sha','card:tiesuo','card:tao','card:guohe','card:shunshou',
         'card:wuzhong','card:jiu','card:juedou','card:nanman','card:lebu','other']
X = np.load(os.path.join(BASE, 'real_pool.npz'))['X']
rng = np.random.default_rng(20261022)
idx = rng.choice(len(X), 200, replace=False)
bodies = []
for i in idx:
    features = list(map(float, X[i])) + [0.0] * 12
    if len(features) != 142:
        raise RuntimeError('bad feature dim')
    bodies.append(json.dumps({'features': features, 'legal_actions': LEGAL}).encode('utf-8'))

def one(body):
    t0 = time.perf_counter()
    req = Request(URL, data=body, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer <YOUR_API_KEY>'
    }, method='POST')
    try:
        with urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
            return {'ok': resp.status == 200, 'status': resp.status,
                    'elapsed_ms': (time.perf_counter() - t0) * 1000,
                    'source': payload.get('source'), 'action': payload.get('execute_action_id')}
    except Exception as e:
        return {'ok': False, 'status': None, 'elapsed_ms': (time.perf_counter() - t0) * 1000,
                'error': repr(e)}

start = time.perf_counter()
with ThreadPoolExecutor(max_workers=200) as ex:
    results = list(ex.map(one, bodies))
wall = time.perf_counter() - start
lat = sorted(r['elapsed_ms'] for r in results)

def pct(p):
    k = int(round((p / 100.0) * (len(lat) - 1)))
    return lat[k]

sources = {}
errors = []
for r in results:
    if r.get('ok'):
        sources[r.get('source')] = sources.get(r.get('source'), 0) + 1
    else:
        errors.append(r)
summary = {
    'target': 'local_8000',
    'requests': len(results),
    'concurrency': 200,
    'success': sum(1 for r in results if r.get('ok')),
    'errors': len(errors),
    'wall_seconds': round(wall, 3),
    'qps_by_wall': round(len(results) / wall, 2),
    'latency_ms': {'min': round(lat[0], 3), 'p50': round(pct(50), 3),
                   'p95': round(pct(95), 3), 'p99': round(pct(99), 3),
                   'max': round(lat[-1], 3)},
    'sources': sources,
    'error_samples': errors[:5]
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
