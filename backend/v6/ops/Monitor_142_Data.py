# -*- coding: utf-8 -*-
"""
Monitor_142_Data.py — 监控 142 维实战数据流入。
只读取 aggregate 与 8787 统计，不修改原始数据。
"""
import os, json, time, math, hashlib, threading, argparse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import urlopen
from urllib.error import URLError

BASE_DIR = r'E:\NoNameAI'
AGG_DIR = os.path.join(BASE_DIR, 'aggregate')
INGEST_STATS_URL = 'http://127.0.0.1:8787/'
MONITOR_PORT = 8799
TARGET_DIM = 142
POLL_SECONDS = 10

STATS_LOCK = threading.RLock()
STATS = {
    'startedAt': datetime.now().isoformat(),
    'lastScanAt': None,
    'filesScanned': 0,
    'samplesSeen': 0,
    'byDim': {},
    'target142Seen': 0,
    'badSamples': 0,
    'lastTarget142': None,
    'poolTotal': None,
    'errors': []
}
SEEN_KEYS = set()
FILE_CACHE = {}


def now():
    return datetime.now().isoformat(timespec='seconds')


def add_error(msg):
    item = {'at': now(), 'msg': str(msg)}
    with STATS_LOCK:
        STATS['errors'].append(item)
        if len(STATS['errors']) > 100:
            STATS['errors'] = STATS['errors'][-100:]
    print('[ERROR]', item['msg'], flush=True)


def extract_samples(root):
    out = []
    if isinstance(root, dict):
        if isinstance(root.get('samples'), list):
            out.extend(root['samples'])
        elif isinstance(root.get('f'), list):
            out.append(root)
    elif isinstance(root, list):
        for item in root:
            if isinstance(item, dict):
                if isinstance(item.get('samples'), list):
                    out.extend(item['samples'])
                elif isinstance(item.get('f'), list):
                    out.append(item)
    return out


def sample_key(sample):
    m = sample.get('m', {}) if isinstance(sample, dict) else {}
    parts = [m.get('transactionId'), m.get('sessionId'), sample.get('ts'),
             m.get('action'), m.get('id'), sample.get('r')]
    raw = '|'.join('' if p is None else str(p) for p in parts)
    if raw.strip('|'):
        return raw
    return hashlib.sha256(json.dumps(sample, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def validate_sample(sample):
    issues = []
    if not isinstance(sample, dict):
        return ['sample_not_object']
    f = sample.get('f')
    m = sample.get('m', {})
    if not isinstance(f, list):
        issues.append('missing_f')
        return issues
    if not m.get('sessionId'):
        issues.append('empty_sessionId')
    if len(f) > 0 and all(float(x) == 0.0 for x in f if isinstance(x, (int, float))):
        issues.append('all_zero_features')
    for x in f:
        if not isinstance(x, (int, float)):
            issues.append('non_numeric_feature')
            break
        y = float(x)
        if math.isnan(y) or math.isinf(y):
            issues.append('nonfinite_feature')
            break
        if abs(y) > 1000000:
            issues.append('extreme_value')
            break
    return issues


def inspect_sample(sample):
    key = sample_key(sample)
    if key in SEEN_KEYS:
        return False
    SEEN_KEYS.add(key)
    f = sample.get('f', []) if isinstance(sample, dict) else []
    dim = len(f) if isinstance(f, list) else 0
    issues = validate_sample(sample)
    with STATS_LOCK:
        STATS['samplesSeen'] += 1
        STATS['byDim'][str(dim)] = STATS['byDim'].get(str(dim), 0) + 1
        if issues:
            STATS['badSamples'] += 1
    if issues:
        add_error('样本质量问题 %s: %s' % (key, ','.join(issues)))
    if dim == TARGET_DIM:
        total = fetch_pool_total()
        with STATS_LOCK:
            STATS['target142Seen'] += 1
            STATS['lastTarget142'] = {'at': now(), 'key': key, 'poolTotal': total,
                                      'issues': issues}
        print('>>> 捕获到142维新数据！当前池内总数：%s' % total, flush=True)
        print(json.dumps({'sessionId': sample.get('m', {}).get('sessionId'),
                          'action': sample.get('m', {}).get('action'),
                          'id': sample.get('m', {}).get('id'),
                          'issues': issues}, ensure_ascii=False), flush=True)
    return True


def read_json_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def scan_current_hour_files():
    today = datetime.now().strftime('%Y-%m-%d')
    hour = int(datetime.now().strftime('%H'))
    date_dir = os.path.join(AGG_DIR, today)
    scanned = 0
    if not os.path.isdir(date_dir):
        return scanned
    for name in os.listdir(date_dir):
        if not name.endswith('.json'):
            continue
        try:
            hh = int(name[:2])
        except Exception:
            continue
        if hh > hour:
            continue
        path = os.path.join(date_dir, name)
        st = os.stat(path)
        sig = (st.st_size, st.st_mtime)
        if FILE_CACHE.get(path) == sig:
            scanned += 1
            continue
        try:
            root = read_json_file(path)
            samples = extract_samples(root)
            new_count = 0
            for sample in samples:
                if inspect_sample(sample):
                    new_count += 1
            FILE_CACHE[path] = sig
            scanned += 1
            with STATS_LOCK:
                STATS['filesScanned'] += 1
            print('[SCAN] %s samples=%s new=%s' % (name, len(samples), new_count), flush=True)
        except Exception as e:
            add_error('读取 %s 失败: %s' % (path, e))
    with STATS_LOCK:
        STATS['lastScanAt'] = now()
    return scanned


def fetch_pool_total():
    try:
        with urlopen(INGEST_STATS_URL, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        total = data.get('merged_samples')
        with STATS_LOCK:
            STATS['poolTotal'] = total
        return total
    except Exception as e:
        add_error('8787统计查询失败: %s' % e)
        return None


def snapshot():
    with STATS_LOCK:
        return json.loads(json.dumps(STATS, ensure_ascii=False))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def send(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/health', '/stats'):
            data = snapshot()
            ok = data['poolTotal'] is not None and data['badSamples'] == 0
            self.send(200 if ok else 500,
                      {'ok': ok, 'status': 'ok' if ok else 'degraded', 'msg': 'monitor142',
                       'data': data})
        else:
            self.send(404, {'ok': False, 'msg': 'not found', 'data': None})


def run_http():
    httpd = HTTPServer(('127.0.0.1', MONITOR_PORT), Handler)
    httpd.serve_forever()


def self_test():
    fake_features = [0] * TARGET_DIM
    fake_features[0] = 1
    fake_features[1] = 1
    fake = {'f': fake_features, 'm': {'sessionId': 'selftest', 'action': 'use', 'id': 'sha'},
            'ts': int(time.time() * 1000)}
    issues = validate_sample(fake)
    extracted = len(extract_samples([{'samples': [fake]}]))
    ok = not issues and extracted == 1
    return {'ok': ok, 'msg': 'Monitor_142_Data selfTest',
            'data': {'issues': issues, 'extracted': extracted, 'port': MONITOR_PORT}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--selftest', action='store_true')
    args = parser.parse_args()
    if args.selftest:
        print(json.dumps(self_test(), ensure_ascii=False, indent=2))
        return
    t = threading.Thread(target=run_http, daemon=True)
    t.start()
    print('Monitor_142_Data started: http://127.0.0.1:%s/health' % MONITOR_PORT, flush=True)
    fetch_pool_total()
    while True:
        try:
            scan_current_hour_files()
            fetch_pool_total()
        except Exception as e:
            add_error(e)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
