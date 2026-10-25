# -*- coding: utf-8 -*-
"""
P1_Export_Slot17_JS.py
用 m2cgen 把 SubModel_Policy_slot17.pkl（17 类 LightGBM）导出为纯 JS：
client_policy_model_v2.js（无运行时依赖），并抽取 1000 条固定测试样本
（slot17_consistency_1000.json）供 Node 对拍。
"""

from legacy_training_guard import require_trusted_training_adapter
require_trusted_training_adapter()

import json
import os
import sys
import pickle
import numpy as np

WD = r'C:\Users\123\Doubao\chats\2026-10-18\new-chat-1'
PKL = r'E:\NoNameAI\model\SubModel_Policy_slot17.pkl'
OUT_JS = os.path.join(WD, 'client_policy_model_v2.js')
OUT_SAMPLES = os.path.join(WD, 'slot17_consistency_1000.json')

sys.path.insert(0, os.path.join(WD, '_pylibs'))
import m2cgen as m2c
from sklearn.model_selection import GroupShuffleSplit


def main():
    with open(PKL, 'rb') as f:
        pkg = pickle.load(f)
    model, classes, keep = pkg['model'], pkg['classes'], pkg['feature_keep']
    print('源模型 schema=%s classes=%d' % (pkg.get('schema'), len(classes)))

    # ---- 1) m2cgen 导出 ----
    body = m2c.export_to_javascript(model)
    header = (
        '/* -*- coding: utf-8 -*-\n'
        ' * client_policy_model_v2.js\n'
        ' * m2cgen 纯 JS 导出，无运行时依赖。源：SubModel_Policy_slot17.pkl (schema slot17_v2)\n'
        ' * 类别 %d 个；输入为 114 维（原 130 维按 featureKeep 取 KEEP=f0-f31,f48-f129）\n'
        ' * 导出脚本：P1_Export_Slot17_JS.py\n'
        ' */\n'
        'var CLIENT_POLICY_V2_META = %s;\n\n'
        % (len(classes),
           json.dumps({'format': 'client-policy-model-v2',
                       'schema': pkg.get('schema'),
                       'classes': classes,
                       'featureKeep': keep,
                       'featureDim': 114,
                       'threshold': pkg.get('threshold', 0.30)},
                      ensure_ascii=False, separators=(',', ':')))
    )
    footer = (
        '\n\n/* 对外封装：保持与 client_policy_model.js 一致的调用面 */\n'
        '(function (root, factory) {\n'
        '  if (typeof module !== "undefined" && module.exports) module.exports = factory();\n'
        '  else root.CLIENT_POLICY_MODEL_V2 = factory();\n'
        '})(typeof self !== "undefined" ? self : this, function () {\n'
        '  function predictProba(features) { return score(features); }\n'
        '  function topK(features, k) {\n'
        '    var p = predictProba(features);\n'
        '    return p.map(function (v, i) { return {action: CLIENT_POLICY_V2_META.classes[i], probability: v}; })\n'
        '      .sort(function (a, b) { return b.probability - a.probability; })\n'
        '      .slice(0, k || 3);\n'
        '  }\n'
        '  function selfTest() {\n'
        '    var z = []; for (var i = 0; i < 114; i++) z.push(0);\n'
        '    var p = predictProba(z);\n'
        '    var s = p.reduce(function (a, b) { return a + b; }, 0);\n'
        '    return {ok: Math.abs(s - 1) < 1e-6, msg: "client_policy_model_v2 selfTest",\n'
        '            data: {sum: s, classes: CLIENT_POLICY_V2_META.classes.length, top3: topK(z, 3)}};\n'
        '  }\n'
        '  return {classes: CLIENT_POLICY_V2_META.classes, meta: CLIENT_POLICY_V2_META,\n'
        '          predictProba: predictProba, topK: topK, selfTest: selfTest};\n'
        '});\n'
    )
    with open(OUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(header + body + footer)
    print('已导出 JS:', OUT_JS, os.path.getsize(OUT_JS), 'bytes')

    # ---- 2) 抽取 1000 条测试样本（按 session 切分的 test 侧，固定种子） ----
    d = np.load(os.path.join(WD, 'demo_pool.npz'), allow_pickle=True)
    X = d['X'][:, keep].astype(np.float64)
    y, sid = d['labels'], d['sids']
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2,
                                    random_state=42).split(
        np.zeros(len(y)), np.zeros(len(y)), groups=sid))
    rng = np.random.RandomState(20261022)
    idx = rng.choice(te, size=1000, replace=False)
    proba = model.predict_proba(X[idx])
    samples = []
    for row, pi, yi in zip(idx, proba, y[idx]):
        samples.append({
            'x': [round(float(v), 6) for v in X[row]],
            'py_proba': [float(v) for v in pi],
            'py_top': classes[int(np.argmax(pi))],
            'true_label': str(yi),
        })
    with open(OUT_SAMPLES, 'w', encoding='utf-8') as f:
        json.dump({'classes': classes, 'samples': samples}, f,
                  ensure_ascii=False, separators=(',', ':'))
    print('已写出 1000 条样本:', OUT_SAMPLES)
    print('Python 侧 Top1 分布（前 5）:')
    tops = [s['py_top'] for s in samples]
    import collections
    for k, v in collections.Counter(tops).most_common(5):
        print('  %-22s %d' % (k, v))


if __name__ == '__main__':
    main()
