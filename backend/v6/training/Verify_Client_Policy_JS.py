# -*- coding: utf-8 -*-
import pickle, json, os
import numpy as np
BASE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(BASE, 'SubModel_Policy_minimal_clean.pkl'), 'rb') as f:
    pkg = pickle.load(f)
model = pkg['model']
keep = list(pkg['feature_keep'])
data = np.load(os.path.join(BASE, 'real_pool.npz'))
X = data['X']
rng = np.random.default_rng(42)
idx = rng.choice(len(X), 200, replace=False)
Xc = X[idx][:, keep]
probs = model.predict_proba(Xc)
out = [{'features': x.tolist(), 'expected': p.tolist(), 'expectedIndex': int(np.argmax(p))}
       for x, p in zip(Xc, probs)]
with open(os.path.join(BASE, 'client_policy_model_test_samples.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f)
print('samples', len(out), 'dim', Xc.shape[1])
