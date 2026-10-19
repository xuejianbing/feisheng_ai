"""
td_audit.py
训练与模型专项修复 · 独立审计工具
TD 转移字段完整性、奖励数值及终止标记检查

用法：
  python -m wumingai_audit.td_audit transitions.jsonl \
    --state-field state \
    --action-field action \
    --reward-field reward \
    --next-state-field next_state \
    --done-field done \
    --out td-audit.json
"""

import json
import sys
import argparse
from collections import Counter


TD_FIELDS = ['state', 'action', 'reward', 'nextState', 'done']

REWARD_HARD_MIN = -100
REWARD_HARD_MAX = 100
REWARD_SOFT_MIN = -10
REWARD_SOFT_MAX = 10


def validate_transition(t, field_map):
    errors = []
    warnings = []

    state = t.get(field_map['state'])
    action = t.get(field_map['action'])
    reward = t.get(field_map['reward'])
    next_state = t.get(field_map['next_state'])
    done = t.get(field_map['done'])

    if state is None:
        errors.append('missing-state')
    if action is None:
        errors.append('missing-action')
    if reward is None:
        errors.append('missing-reward')
    if next_state is None:
        errors.append('missing-next-state')
    if done is None:
        errors.append('missing-done')

    if reward is not None:
        if not isinstance(reward, (int, float)) or isinstance(reward, bool):
            errors.append('reward-non-number')
        elif reward < REWARD_HARD_MIN or reward > REWARD_HARD_MAX:
            errors.append('reward-out-of-range')
        elif reward < REWARD_SOFT_MIN or reward > REWARD_SOFT_MAX:
            warnings.append(f'reward-soft-range:{reward}')

    if done is not None and not isinstance(done, bool):
        errors.append('done-non-boolean')

    if done is True and next_state is not None:
        warnings.append('done-with-next-state')
    if done is False and next_state is None:
        errors.append('not-done-without-next-state')

    return {'valid': len(errors) == 0, 'errors': errors, 'warnings': warnings}


def load_jsonl(path):
    records = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def main():
    parser = argparse.ArgumentParser(description='TD 转移审计')
    parser.add_argument('input', help='输入 JSONL 文件路径')
    parser.add_argument('--state-field', default='state')
    parser.add_argument('--action-field', default='action')
    parser.add_argument('--reward-field', default='reward')
    parser.add_argument('--next-state-field', default='nextState')
    parser.add_argument('--done-field', default='done')
    parser.add_argument('--out', default=None)
    args = parser.parse_args()

    field_map = {
        'state': args.state_field,
        'action': args.action_field,
        'reward': args.reward_field,
        'next_state': args.next_state_field,
        'done': args.done_field,
    }

    records = load_jsonl(args.input)
    valid = 0
    invalid = 0
    error_counts = Counter()
    warning_counts = Counter()
    invalid_samples = []

    for i, t in enumerate(records):
        r = validate_transition(t, field_map)
        if r['valid']:
            valid += 1
        else:
            invalid += 1
            if len(invalid_samples) < 10:
                invalid_samples.append({'line': i + 1, 'errors': r['errors']})
        for e in r['errors']:
            error_counts[e] += 1
        for w in r['warnings']:
            warning_counts[w] += 1

    report = {
        'total': len(records),
        'valid': valid,
        'invalid': invalid,
        'error_counts': dict(error_counts),
        'warning_counts': dict(warning_counts),
        'invalid_samples': invalid_samples,
    }

    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f'报告已写入: {args.out}')
    else:
        print(output)

    sys.exit(1 if invalid > 0 else 0)


if __name__ == '__main__':
    main()
