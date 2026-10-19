"""
test_audit.py
训练与模型专项修复 · 单元测试
验证样本资格计数、TD转移校验、模型契约不匹配即失败

运行：python -m unittest discover -s tests -v
"""

import unittest
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools', 'training_audit'))

from jsonl_audit import audit_dimensions, audit_required_fields, audit_duplicates, load_jsonl
from td_audit import validate_transition
from model_contract import verify, infer_contract, FORMAL_CONTRACT, EXPERIMENTAL_DIMS


class TestSampleEligibility(unittest.TestCase):
    """样本资格计数测试"""

    def test_dimension_distribution(self):
        records = [
            {'state': [0] * 130},
            {'state': [0] * 134},
            {'state': [0] * 134},
            {'state': None},
        ]
        dims = audit_dimensions(records, 'state')
        self.assertEqual(dims.get(130), 1)
        self.assertEqual(dims.get(134), 2)
        self.assertEqual(dims.get('missing'), 1)

    def test_required_fields_missing(self):
        records = [
            {'session_id': 's1', 'skill': 'sha'},
            {'session_id': 's2'},
            {},
        ]
        missing = audit_required_fields(records, ['session_id', 'skill', 'committed'])
        self.assertEqual(missing.get('skill'), 2)  # 第2、3条缺
        self.assertEqual(missing.get('committed'), 3)  # 全部缺

    def test_duplicate_detection(self):
        records = [
            {'session_id': 's1', 'transaction_id': 't1', 'action': 'sha', 'reward': 1},
            {'session_id': 's1', 'transaction_id': 't1', 'action': 'sha', 'reward': 1},  # 完全重复
            {'session_id': 's1', 'transaction_id': 't2', 'action': 'shan', 'reward': 0},
        ]
        result = audit_duplicates(records, ['session_id', 'transaction_id'])
        self.assertEqual(result['duplicates'], 1)
        self.assertEqual(result['conflicts'], 0)

    def test_conflict_detection(self):
        records = [
            {'session_id': 's1', 'transaction_id': 't1', 'action': 'sha', 'reward': 1},
            {'session_id': 's1', 'transaction_id': 't1', 'action': 'sha', 'reward': -1},  # 同key不同reward
        ]
        result = audit_duplicates(records, ['session_id', 'transaction_id'])
        self.assertEqual(result['conflicts'], 1)


class TestTdValidation(unittest.TestCase):
    """TD 转移五字段校验测试"""

    def _field_map(self):
        return {'state': 'state', 'action': 'action', 'reward': 'reward',
                'next_state': 'nextState', 'done': 'done'}

    def test_valid_transition(self):
        t = {'state': [0] * 134, 'action': 0, 'reward': 0.5, 'nextState': [0] * 134, 'done': False}
        r = validate_transition(t, self._field_map())
        self.assertTrue(r['valid'])
        self.assertEqual(len(r['errors']), 0)

    def test_missing_fields(self):
        t = {'state': [0] * 134, 'action': 0}  # 缺 reward/nextState/done
        r = validate_transition(t, self._field_map())
        self.assertFalse(r['valid'])
        self.assertIn('missing-reward', r['errors'])
        self.assertIn('missing-next-state', r['errors'])
        self.assertIn('missing-done', r['errors'])

    def test_reward_out_of_range(self):
        t = {'state': [0], 'action': 0, 'reward': 999, 'nextState': [0], 'done': False}
        r = validate_transition(t, self._field_map())
        self.assertFalse(r['valid'])
        self.assertIn('reward-out-of-range', r['errors'])

    def test_reward_non_number(self):
        t = {'state': [0], 'action': 0, 'reward': 'big', 'nextState': [0], 'done': False}
        r = validate_transition(t, self._field_map())
        self.assertFalse(r['valid'])
        self.assertIn('reward-non-number', r['errors'])

    def test_done_without_next_state(self):
        t = {'state': [0], 'action': 0, 'reward': 1, 'nextState': None, 'done': False}
        r = validate_transition(t, self._field_map())
        self.assertFalse(r['valid'])
        self.assertIn('not-done-without-next-state', r['errors'])

    def test_done_boolean_type(self):
        t = {'state': [0], 'action': 0, 'reward': 0, 'nextState': [0], 'done': 'yes'}
        r = validate_transition(t, self._field_map())
        self.assertFalse(r['valid'])
        self.assertIn('done-non-boolean', r['errors'])


class TestModelContract(unittest.TestCase):
    """模型契约校验测试：不匹配时失败关闭"""

    def test_formal_134_passes(self):
        weights = {'dims': [134, 128, 64, 6], 'featureDim': 134, 'hasCritic': True, 'version': 7}
        r = verify(weights)
        self.assertTrue(r['ok'])

    def test_legacy_130_fails_formal(self):
        weights = {'dims': [130, 128, 64, 6], 'featureDim': 130, 'hasCritic': True}
        r = verify(weights)
        self.assertFalse(r['ok'])
        self.assertTrue(any('featureDim' in m for m in r['mismatches']))

    def test_experimental_142_fails(self):
        weights = {'dims': [142, 128, 64, 6], 'featureDim': 142, 'hasCritic': True}
        r = verify(weights)
        self.assertFalse(r['ok'])
        self.assertTrue(any('experimental-dim' in m for m in r['mismatches']))

    def test_wrong_action_outputs_fails(self):
        weights = {'dims': [134, 128, 64, 8], 'featureDim': 134, 'hasCritic': True}
        r = verify(weights)
        self.assertFalse(r['ok'])
        self.assertTrue(any('actionOutputs' in m for m in r['mismatches']))

    def test_missing_critic_fails(self):
        weights = {'dims': [134, 128, 64, 6], 'featureDim': 134, 'hasCritic': False}
        r = verify(weights)
        self.assertFalse(r['ok'])
        self.assertTrue(any('criticOutputs' in m for m in r['mismatches']))

    def test_unrecognized_format_fails(self):
        weights = {'random': 'data'}
        r = verify(weights)
        self.assertFalse(r['ok'])

    def test_null_weights_fails(self):
        r = verify(None)
        self.assertFalse(r['ok'])

    def test_infer_from_W_format(self):
        weights = {'W': [[0] * 134, [0] * 128, [0] * 64, [0] * 6], 'criticW': [0], 'featureDim': 134}
        actual = infer_contract(weights)
        self.assertEqual(actual['featureDim'], 134)
        self.assertEqual(actual['actionOutputs'], 6)
        self.assertEqual(actual['criticOutputs'], 1)


class TestJsonlRoundTrip(unittest.TestCase):
    """JSONL 读写往返测试"""

    def test_load_valid_jsonl(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False, encoding='utf-8') as f:
            f.write('{"a": 1}\n{"b": 2}\n')
            path = f.name
        try:
            records, errors = load_jsonl(path)
            self.assertEqual(len(records), 2)
            self.assertEqual(len(errors), 0)
        finally:
            os.unlink(path)

    def test_load_invalid_jsonl(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False, encoding='utf-8') as f:
            f.write('{"a": 1}\ninvalid json\n')
            path = f.name
        try:
            records, errors = load_jsonl(path)
            self.assertEqual(len(records), 1)
            self.assertEqual(len(errors), 1)
        finally:
            os.unlink(path)


if __name__ == '__main__':
    unittest.main(verbosity=2)
