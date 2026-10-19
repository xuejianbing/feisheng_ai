"""
model_contract.py
训练与模型专项修复 · 独立审计工具
模型清单与实测元数据对比，不匹配时失败关闭

用法：
  python -m wumingai_audit.model_contract weights.json manifest.json
  python -m wumingai_audit.model_contract weights.json --feature-dim 134 --action-outputs 6
"""

import json
import sys
import argparse


FORMAL_CONTRACT = {
    'featureDim': 134,
    'hiddenDims': [128, 64],
    'actionOutputs': 6,
    'criticOutputs': 1,
    'weightType': 'int8',
    'version': 7,
}

EXPERIMENTAL_DIMS = [142, 150]


def infer_contract(weights):
    """从权重对象推断实际契约"""
    if not weights:
        return {'error': 'null-weights'}

    if 'dims' in weights and isinstance(weights['dims'], list):
        dims = weights['dims']
        return {
            'featureDim': weights.get('featureDim', dims[0]),
            'hiddenDims': dims[1:-1],
            'actionOutputs': dims[-1],
            'criticOutputs': 1 if weights.get('hasCritic') else 0,
            'version': weights.get('version') or weights.get('VERSION'),
        }

    if 'W' in weights and isinstance(weights['W'], list):
        layers = weights['W']
        return {
            'featureDim': weights.get('featureDim', len(layers[0]) if layers else 0),
            'hiddenDims': [len(l) for l in layers[:-1]],
            'actionOutputs': len(layers[-1]) if layers else 0,
            'criticOutputs': 1 if 'criticW' in weights else 0,
            'version': weights.get('version'),
        }

    if 'featureDim' in weights and 'outputDim' in weights:
        return {
            'featureDim': weights['featureDim'],
            'hiddenDims': weights.get('hiddenDims', []),
            'actionOutputs': weights['outputDim'],
            'criticOutputs': 1 if weights.get('hasCritic') else 0,
            'version': weights.get('version'),
        }

    return {'error': 'unrecognized-format'}


def verify(weights, expected=None):
    if expected is None:
        expected = FORMAL_CONTRACT

    actual = infer_contract(weights)
    if 'error' in actual:
        return {'ok': False, 'expected': expected, 'actual': actual, 'mismatches': [actual['error']]}

    mismatches = []
    if actual['featureDim'] != expected['featureDim']:
        mismatches.append(f"featureDim: expected={expected['featureDim']} actual={actual['featureDim']}")
    if actual['actionOutputs'] != expected['actionOutputs']:
        mismatches.append(f"actionOutputs: expected={expected['actionOutputs']} actual={actual['actionOutputs']}")
    if expected.get('criticOutputs', 0) > 0 and actual.get('criticOutputs', 0) != expected['criticOutputs']:
        mismatches.append(f"criticOutputs: expected={expected['criticOutputs']} actual={actual['criticOutputs']}")
    if actual['featureDim'] in EXPERIMENTAL_DIMS:
        mismatches.append(f"experimental-dim:{actual['featureDim']}-not-formal")

    return {
        'ok': len(mismatches) == 0,
        'expected': expected,
        'actual': actual,
        'mismatches': mismatches,
    }


def main():
    parser = argparse.ArgumentParser(description='模型契约校验')
    parser.add_argument('weights', help='权重 JSON 文件路径')
    parser.add_argument('manifest', nargs='?', default=None, help='manifest JSON 文件路径（可选）')
    parser.add_argument('--feature-dim', type=int, default=None)
    parser.add_argument('--action-outputs', type=int, default=None)
    parser.add_argument('--out', default=None)
    args = parser.parse_args()

    with open(args.weights, 'r', encoding='utf-8') as f:
        weights = json.load(f)

    expected = dict(FORMAL_CONTRACT)
    if args.manifest:
        with open(args.manifest, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
            expected.update({k: v for k, v in manifest.items() if k in expected})
    if args.feature_dim:
        expected['featureDim'] = args.feature_dim
    if args.action_outputs:
        expected['actionOutputs'] = args.action_outputs

    result = verify(weights, expected)
    output = json.dumps(result, ensure_ascii=False, indent=2)

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f'报告已写入: {args.out}')
    else:
        print(output)

    print(f"\n契约校验: {'✅ 通过' if result['ok'] else '❌ 失败'}")
    if not result['ok']:
        for m in result['mismatches']:
            print(f'  - {m}')

    sys.exit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
