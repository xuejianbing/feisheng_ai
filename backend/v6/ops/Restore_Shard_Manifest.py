# -*- coding: utf-8 -*-
import os, json, re
from datetime import datetime

BASE = r'E:\NoNameAI'
SHARD_DIR = os.path.join(BASE, 'merged_shards')
MERGED_FILE = os.path.join(BASE, 'merged_samples.json')
SHARD_SIZE = 50000

names = sorted(n for n in os.listdir(SHARD_DIR) if re.match(r'^shard_\d{3}\.json$', n))
if not names:
    raise RuntimeError('no shards found')
shards = []
total = 0
conf_dist = {}
for name in names:
    path = os.path.join(SHARD_DIR, name)
    with open(path, 'r', encoding='utf-8') as f:
        obj = json.load(f)
    samples = obj.get('samples', [])
    if obj.get('total_unique') != len(samples):
        raise RuntimeError('count mismatch in %s: %s != %s' % (name, obj.get('total_unique'), len(samples)))
    rel = 'merged_shards/' + name
    shards.append(rel)
    total += len(samples)
    for s in samples:
        conf = s.get('conf', 0)
        try:
            key = '%.1f' % float(conf)
        except Exception:
            key = str(conf)
        conf_dist[key] = conf_dist.get(key, 0) + 1
    print(name, len(samples), 'MB=%.3f' % (os.path.getsize(path) / 1024 / 1024))

manifest = {
    'format': 'merged-pool-shards-v1',
    'merged_at': datetime.now().isoformat(),
    'total_unique': total,
    'shard_size': SHARD_SIZE,
    'shards': shards,
    'confidence_distribution': conf_dist,
    'samples': []
}
tmp = MERGED_FILE + '.tmp'
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
os.replace(tmp, MERGED_FILE)
print('manifest_total_unique', total)
print('manifest_MB', '%.3f' % (os.path.getsize(MERGED_FILE) / 1024 / 1024))
print('shards', shards)
