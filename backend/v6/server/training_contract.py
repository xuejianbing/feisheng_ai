"""Server mirror of client training-lineage-v1 (9b5e50a); no upload flag is evidence.
Numeric constants mirror labelPolicy/championSampleEligibility, tested against JS.
This module never trains, writes user samples, or changes labels.
"""
import copy
import hashlib
import json
import math

RULES = 'training-lineage-v1'
SYSTEM_SKILLS = {'_mvp_score_init', '_mvp_cure', '_mvp_help', '_wjmh_huifushuzi_'}
DELTA_FIELDS = ('hp', 'hand', 'equip', 'judging', 'alive', 'linked', 'turned', 'wine')

def canonical(value):
    # Server manifest uses its own explicit canonical encoding, not a claim that
    # Python float printing equals ECMAScript JSON.stringify for every double.
    def normalize(v):
        if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
        if isinstance(v,list):return [normalize(x) for x in v]
        if type(v) is float and math.isfinite(v) and v.is_integer():return int(v)
        return v
    return json.dumps(normalize(value), sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()

def obj(v):
    return v if isinstance(v, dict) else {}

def strict_equal(a,b):
    # JavaScript === for JSON primitives; bool is not the numeric 0/1.
    if isinstance(a,(dict,list)) or isinstance(b,(dict,list)):return a is b
    if type(a) in (int,float) and type(b) in (int,float):return a==b
    return type(a) is type(b) and a==b

def finite(v):
    try:return type(v) in (int, float) and math.isfinite(v)
    except OverflowError:return False

def truth(v):
    return v is not None and v is not False and not (type(v) in (int, float) and (v == 0 or type(v) is float and math.isnan(v))) and v != ''

def ids(sample):
    m = obj(obj(sample).get('m'))
    values = [m.get(k) for k in ('sessionId', 'actorId', 'transactionId')]
    return values if all(isinstance(v, str) and v.strip() for v in values) else None

def adapt(raw):
    s = copy.deepcopy(raw)
    f = s.get('f')
    context=obj(obj(s.get('m')).get('modeContext'))
    declared = ([s['featureDim']] if 'featureDim' in s else []) + ([context['featureVersion']] if 'featureVersion' in context else [])
    if not isinstance(f, list) or len(f) not in (130, 134) or any(not finite(v) or v not in (130, 134) for v in declared) or any(not finite(v) for v in f):
        return None
    if len(f) == 130:
        s.update(f=f + [0]*4, _dimAdapted=True, _originalDim=130, _missingFeatureIndices=[130,131,132,133])
    return s

def valid_label(s):
    m = s['m']; reward = m.get('observedReward'); value = s.get('value_target')
    skill = m.get('id') or m.get('skill') or s.get('id') or s.get('skill')
    skills = skill if isinstance(skill, list) else [skill]
    if any(x in SYSTEM_SKILLS for x in skills if isinstance(x, str)) and all(isinstance(x, str) and x in SYSTEM_SKILLS for x in skills):
        return False
    if s.get('schema') == 'delayed-action-group-v1' or not finite(reward) or not finite(value):
        return False
    credit = m.get('creditAllocation')
    if truth(credit):
        credit = obj(credit); rows = credit.get('allocations')
        if credit.get('schema') != 'action-credit-ledger-v1' or credit.get('policy') != 'cost-only-no-hit-v1' or not finite(credit.get('unallocatedReward')) or credit.get('unallocatedReward') != 0 or not isinstance(rows, list) or len(rows) < 2:
            return False
        txs = [canonical(obj(r).get('transactionId')) for r in rows]
        if len(set(txs)) != len(txs) or any(not finite(obj(r).get('reward')) or r['reward'] > 0 for r in rows) or not finite(credit.get('groupReward')):
            return False
        if abs(sum(r['reward'] for r in rows)-credit['groupReward']) > 1e-9 or next((r['reward'] for r in rows if r.get('transactionId') == m['transactionId']), None) != reward:
            return False
    scaled=reward*12
    expected = 147 if scaled>=147 else -147 if scaled<=-147 else math.floor(scaled+0.5)
    r = s.get('r') if s.get('r') is not None else s.get('reward')
    return finite(r) and r == expected and abs(value-max(-1, min(1, reward/12))) <= 1e-7

def evidence(s):
    m=s['m']; o=obj(m.get('actionOutcome'))
    if not all(truth(m.get(k)) for k in ('player','id')) or not truth(m.get('type') or m.get('action')):
        return 'MISSING_ACTION_IDENTITY'
    deltas=o.get('deltas')
    if o.get('normalization') != 12 or not isinstance(deltas,list) or not deltas:
        return 'MISSING_RESULT_EVIDENCE'
    if any(not truth(obj(d).get('playerId')) or type(obj(d).get('camp')) not in (int,float) or d['camp'] not in (-1,0,1) or any(not finite(d.get(k)) for k in DELTA_FIELDS) for d in deltas):
        return 'INVALID_RESULT_DELTAS'
    if o.get('attribution') == 'completed-chain-local-cost':
        return None if truth(m.get('creditAllocation')) else 'MISSING_CREDIT_LEDGER'
    if o.get('attribution') != 'host-event-window':
        return 'UNSUPPORTED_ATTRIBUTION'
    if any(any(d[k] for k in ('judging','linked','turned','wine')) for d in deltas):
        return 'UNRESOLVED_DELAYED_EFFECT'
    if any(not d['camp'] and any(d[k] for k in DELTA_FIELDS) for d in deltas):
        return 'UNKNOWN_RELATION'
    reward=sum(d['camp']*(d['hp']*3+d['hand']*1.5+d['equip']*1.2-d['judging']*2+d['alive']*3) for d in deltas)
    return 'RESULT_REWARD_MISMATCH' if abs(reward-m['observedReward']) > 1e-7 else None

def qualify(raw, mode_group=None):
    def fail(state,code): return dict(eligible=False,state=state,code=code,sample=None)
    if not isinstance(raw,dict): return fail('rejected','E_DIMENSION' if isinstance(raw,list) else 'E_SAMPLE')
    s=adapt(raw)
    if s is None:return fail('rejected','E_DIMENSION')
    m=obj(s.get('m'));c=obj(m.get('modeContext'))
    if mode_group and c.get('group') != mode_group:return fail('rejected','E_DATASET_SCOPE')
    if mode_group and (c.get('schema')!='mode-context-v1' or c.get('captured') is not True or c.get('mode')!='doudizhu' or c.get('submode') not in ('normal','kaihei','huanle') or c.get('collect') is not True or c.get('role') not in ('landlord','farmer') or not truth(c.get('ruleKey')) or not finite(c.get('ruleVersion')) or c.get('ruleVersion')!=1):return fail('quarantine','E_MODE_CONTEXT')
    if not ids(s):return fail('legacy' if truth(s.get('_dimAdapted')) else 'quarantine','E_IDENTITY')
    if m.get('rewardSchema')!='action-outcome-v1':return fail('quarantine','E_REWARD_SCHEMA')
    if s.get('trainingEligible') is False or m.get('trainingEligible') is False:return fail('rejected','E_NOT_ELIGIBLE')
    if m.get('executionState')!='committed':return fail('rejected','E_NOT_EXECUTED')
    terminal=m.get('gameOutcome') in ('win','lose')
    if (terminal and not finite(m.get('outcomeTarget'))) or (m.get('gameOutcome')=='win' and m.get('outcomeTarget')!=1) or (m.get('gameOutcome')=='lose' and m.get('outcomeTarget')!=-1) or (not terminal and (m.get('outcomeTarget') is not None or m.get('gameOutcome') not in (None,'unknown'))):return fail('quarantine','E_TERMINAL_LABEL')
    o=obj(m.get('actionOutcome'))
    for key,expected in [('transactionId',m['transactionId']),('actorId',m['actorId']),('sessionId',m['sessionId']),('id',m.get('id')),('type',m.get('action') or m.get('type')),('target',m.get('target'))]:
        if key in o and not (canonical(o[key])==canonical(expected) if key=='target' else strict_equal(o[key],expected)):return fail('quarantine','E_EVIDENCE_IDENTITY')
    status=m.get('rewardStatus')
    if status in ('pending','partial','unresolved'):
        if ('status' in o and o['status'] not in ('pending','partial','unresolved')) or m.get('observedReward') is not None or o.get('reward') is not None or m.get('creditAllocation') is not None or s.get('fbAsync') is True:return fail('quarantine','E_REWARD_STATE_CONFLICT')
        return fail('pending','E_REWARD_'+status.upper())
    if status!='observed':return fail('quarantine','E_REWARD_STATUS')
    if ('status' in o and o['status']!='observed') or ('reward' in o and (type(o['reward']) is bool or o['reward']!=m.get('observedReward'))):return fail('quarantine','E_EVIDENCE_IDENTITY')
    if not valid_label(s):return fail('quarantine','E_LABEL')
    reason=evidence(s)
    if reason:return fail('quarantine','E_EVIDENCE_'+reason)
    legacy=truth(s.get('_dimAdapted'))
    return dict(eligible=True,state='legacy' if legacy else 'trainable',code='L_FEATURES_130' if legacy else 'OK',sample=s,terminalConfirmed=terminal)

def immutable(s):
    m=s['m'];d={k:m[k] for k in ('sessionId','actorId','transactionId','player','id','modeContext') if k in m}
    d.update(f=s['f'],action=m.get('action') or m.get('type'),target=m.get('target'))
    return d

def result(s):
    m=s['m']
    return dict(reward=s.get('r') if s.get('r') is not None else s.get('reward'),value=s.get('value_target'),observedReward=m.get('observedReward'),credit=m.get('creditAllocation') or None)

def merge_transaction(rows):
    """Rows are (raw sample, independent qualification); never last-write-wins."""
    valid=[(s,q) for s,q in rows if q['eligible']]
    normalized=[adapt(s) for s,_ in rows]
    bad=any(not q['eligible'] and q['state']!='pending' for _,q in rows)
    features={canonical(immutable(s)) if s else 'invalid' for s in normalized}
    rewards={canonical(result(q['sample'])) for _,q in valid}
    terminals={obj(s.get('m')).get('gameOutcome') for s,_ in rows if obj(s.get('m')).get('gameOutcome') in ('win','lose')}
    if not valid:
        if len(features)>1 or len(terminals)>1:return None,'E_TRANSACTION_CONFLICT'
        return None, 'waiting' if all(q['state']=='pending' for _,q in rows) else 'quarantine'
    if bad or len(features)!=1 or len(rewards)!=1 or len(terminals)>1:
        return None,'E_TRANSACTION_CONFLICT'
    chosen=sorted((q for _,q in valid),key=lambda q:(not q['terminalConfirmed'],canonical(q['sample'])))[0]
    return chosen['sample'],'OK'
