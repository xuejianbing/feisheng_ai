"""
jsonl_audit.py
训练与模型专项修复 · 独立审计工具
JSONL 解析、维度分布、资格计数和重复候选审计

用法：
  python -m wumingai_audit.jsonl_audit samples.jsonl \
    --dimension-field state \
    --required-fields session_id,skill,committed,observed,trainingEligible \
    --dedupe-fields session_id,transaction_id \
    --out audit.json
"""

import json
import sys
import argparse
from collections import Counter, defaultdict


def load_jsonl(path):
    records = []
    errors = []
    with open(path, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as e:
                errors.append({'line': i, 'error': str(e)})
    return records, errors


def audit_dimensions(records, dimension_field='state'):
    dims = Counter()
    for r in records:
        val = r.get(dimension_field)
        if val is None:
            dims['missing'] += 1
        elif isinstance(val, list):
            dims[len(val)] += 1
        elif isinstance(val, int):
            dims[val] += 1
        else:
            dims[type(val).__name__] += 1
    return dict(dims)


def audit_required_fields(records, required_fields):
    missing = Counter()
    for r in records:
        for field in required_fields:
            if field not in r or r[field] is None:
                missing[field] += 1
    return dict(missing)


def audit_duplicates(records, dedupe_fields):
    seen = {}
    duplicates = []
    conflicts = []
    for i, r in enumerate(records):
        key = tuple(str(r.get(f, '')) for f in dedupe_fields)
        if key in seen:
            prev_idx = seen[key]
            prev = records[prev_idx]
            # 比较关键字段是否一致
            if _records_equivalent(prev, r):
                duplicates.append({'line': i + 1, 'prev_line': prev_idx + 1, 'key': key})
            else:
                conflicts.append({'line': i + 1, 'prev_line': prev_idx + 1, 'key': key})
        else:
            seen[key] = i
    return {'duplicates': len(duplicates), 'conflicts': len(conflicts), 'duplicate_samples': duplicates[:20]}


def _records_equivalent(a, b):
    keys = set(list(a.keys()) + list(b.keys()))
    for k in keys:
        if k in ('_eligibilityState', '_eligibilityReason', '_eligibilityCheckedAt'):
            continue
        if a.get(k) != b.get(k):
            return False
    return True


def audit_eligibility(records):
    states = Counter()
    for r in records:
        state = r.get('_eligibilityState', 'unstamped')
        states[state] += 1
    return dict(states)


def main():
    parser = argparse.ArgumentParser(description='JSONL 训练数据审计')
    parser.add_argument('input', help='输入 JSONL 文件路径')
    parser.add_argument('--dimension-field', default='state', help='维度字段名')
    parser.add_argument('--required-fields', default='', help='必填字段，逗号分隔')
    parser.add_argument('--dedupe-fields', default='', help='去重字段，逗号分隔')
    parser.add_argument('--out', default=None, help='输出 JSON 报告路径')
    args = parser.parse_args()

    records, parse_errors = load_jsonl(args.input)
    required = [f.strip() for f in args.required_fields.split(',') if f.strip()]
    dedupe = [f.strip() for f in args.dedupe_fields.split(',') if f.strip()]

    report = {
        'total_records': len(records),
        'parse_errors': parse_errors,
        'dimensions': audit_dimensions(records, args.dimension_field),
        'required_fields_missing': audit_required_fields(records, required) if required else {},
        'eligibility_states': audit_eligibility(records),
    }

    if dedupe:
        report['duplicates'] = audit_duplicates(records, dedupe)

    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f'报告已写入: {args.out}')
    else:
        print(output)

    # 退出码：有解析错误返回1
    sys.exit(1 if parse_errors else 0)


if __name__ == '__main__':
    main()
