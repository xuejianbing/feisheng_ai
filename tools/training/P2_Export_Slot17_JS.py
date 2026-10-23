# -*- coding: utf-8 -*-
"""
P2_Export_Slot17_JS.py - 纯真人 17 类模型 m2cgen 导出 + 1000 对拍样本
输入：E:\\NoNameAI\\model\\SubModel_Policy_slot17.pkl（schema slot17_human_v2）
输出：
  <工作目录>/client_policy_model_v2.js
  slot17_consistency_1000.json（1000 条测试侧样本，含 Python 概率）
"""
import json, os, re, sys, pickle, collections
import numpy as np

WD = os.environ.get('TRAIN_WORK_DIR', os.path.dirname(os.path.abspath(__file__)))
WD2 = os.environ.get('TRAIN_LIBS_DIR', os.path.join(WD, '_pylibs'))
PKL = os.environ.get('TRAIN_SLOT17_PKL', r'E:\NoNameAI\model\SubModel_Policy_slot17.pkl')
OUT_JS = os.path.join(WD, 'client_policy_model_v2.js')
OUT_SAMPLES = os.path.join(WD, 'slot17_consistency_1000.json')
HUMAN_SHARD_DIR = os.environ.get('TRAIN_HUMAN_SHARD_DIR', r'E:\NoNameAI\merged_shards')

sys.path.insert(0, os.path.join(WD2, '_pylibs'))
import m2cgen as m2c
from sklearn.model_selection import GroupShuffleSplit


def load_human():
    X, y, groups = [], [], []
    for fn in sorted(os.listdir(HUMAN_SHARD_DIR)):
        if not re.match(r'^shard_\d{3}\.json$', fn):
            continue
        with open(os.path.join(HUMAN_SHARD_DIR, fn), encoding='utf-8') as f:
            d = json.load(f)
        for s in d.get('samples', []):
            m = s.get('m') or {}
            fv = s.get('f')
            if not fv or not isinstance(fv, list) or len(fv) < 130:
                continue
            if m.get('gameOutcome') not in ('win', 'lose'):
                continue
            X.append(fv[:130])
            y.append(str(m.get('action')) + ':' + str(m.get('id')))
            groups.append(m.get('sessionId'))
    return np.asarray(X, dtype=np.float32), np.asarray(y, dtype=object), np.asarray(groups, dtype=object)


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
        ' * m2cgen 纯 JS 导出，无运行时依赖。源：SubModel_Policy_slot17.pkl (schema %s)\n'
        ' * 纯真人已结算数据（player-demonstration，win/lose）重训；类别 %d 个\n'
        ' * 输入为 114 维（原 130 维按 featureKeep 取 KEEP=f0-f31,f48-f129）\n'
        ' * 导出脚本：P2_Export_Slot17_JS.py\n'
        ' */\n'
        'var CLIENT_POLICY_V2_META = %s;\n\n'
        % (pkg.get('schema'), len(classes),
           json.dumps({'format': 'client-policy-model-v2',
                       'schema': pkg.get('schema'),
                       'classes': classes,
                       'featureKeep': keep,
                       'featureDim': 114,
                       'top1': pkg.get('top1'),
                       'top5': pkg.get('top5'),
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

    # ---- 2) 1000 条测试侧样本（与重训同切分口径） ----
    Xall, yall, sall = load_human()
    X = Xall[:, keep].astype(np.float64)
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2,
                                    random_state=42).split(
        np.zeros(len(X)), np.zeros(len(X)), groups=sall))
    rng = np.random.RandomState(20261022)
    idx = rng.choice(te, size=1000, replace=False)
    proba = model.predict_proba(X[idx])
    samples = []
    for row, pi, yi in zip(idx, proba, yall[idx]):
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
    tops = [s['py_top'] for s in samples]
    for k, v in collections.Counter(tops).most_common(7):
        print('  %-22s %d' % (k, v))


if __name__ == '__main__':
    main()
