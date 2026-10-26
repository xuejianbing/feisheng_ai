import copy,json,os,pathlib,subprocess,sys,tempfile,unittest
from test_trusted import row,pending,ROOT
from training_contract import qualify
class Contract(unittest.TestCase):
    def test_cross_language(self):
        cases=[{'name':'base','sample':row()},{'name':'null','sample':None},{'name':'array','sample':[]}]
        def add(name,mutate):
            s=row();mutate(s);cases.append(dict(name=name,sample=s))
        for dim in [0,129,130,134,142]:cases.append(dict(name='dim'+str(dim),sample=row(dim=dim)))
        for state in ['pending','partial','unresolved']:
            for o in [None,'pending','partial','unresolved','observed','garbage']:
                s=pending(row());s['m']['rewardStatus']=state
                if o:s['m']['actionOutcome']={'status':o}
                cases.append(dict(name=f'{state}/{o}',sample=s))
            for field,v in [('observedReward',0),('creditAllocation',{}),('gameOutcome','win')]:
                s=pending(row());s['m']['rewardStatus']=state;s['m'][field]=v;cases.append(dict(name=state+field,sample=s))
        for key in ['sessionId','actorId','transactionId']:
            for val in [None,'',' ',17,False]:add(key+str(val),lambda s,k=key,v=val:s['m'].__setitem__(k,v))
        for field,values in [('executionState',['cancelled','failed','suggested']),('gameOutcome',['unknown','win','lose','other']),('outcomeTarget',[None,False,True,0,1,-1]),('rewardSchema',[None,'old']),('observedReward',[None,True,'3',0,1e308])]:
            for v in values:add(field+str(v),lambda s,k=field,v=v:s['m'].__setitem__(k,v))
        for v in [None,False,142,'134',134]:add('declared'+str(v),lambda s,v=v:s.__setitem__('featureDim',v))
        for field,values in [('r',[None,True,'36',0,147]),('value_target',[None,True,'0.25',1]),('trainingEligible',[False,True]),('schema',['delayed-action-group-v1'])]:
            for v in values:add(field+str(v),lambda s,k=field,v=v:s.__setitem__(k,v))
        for field,values in [('target',['other',None,{}]),('actorId',['other',None,True]),('normalization',[12,True,None]),('attribution',['unknown','completed-chain-local-cost']),('status',['partial',None]),('reward',[True,3,4,None])]:
            for v in values:add('outcome'+field+str(v),lambda s,k=field,v=v:s['m']['actionOutcome'].__setitem__(k,v))
        for field in ['hp','camp','hand','judging','linked','wine','alive']:
            for val in [None,True,0,1,1e308]:add('delta'+field+str(val),lambda s,k=field,v=val:s['m']['actionOutcome']['deltas'][0].__setitem__(k,v))
        for field in ['player','id','action']:
            add('no'+field,lambda s,k=field:s['m'].pop(k))
        add('systemSkill',lambda s:s['m'].__setitem__('id','_mvp_cure'))
        for field,value,foreign in [('target',1,True),('id',1,True),('type',1,True),('target',{'x':1},{'x':True})]:
            s=row();s['m']['action' if field=='type' else field]=value;s['m']['actionOutcome'][field]=foreign
            cases.append(dict(name='strict-identity-'+field+str(value),sample=s))
        credit=row();credit['r']=-18;credit['value_target']=-.125;credit['m']['observedReward']=-1.5
        credit['m']['actionOutcome'].update(reward=-1.5,attribution='completed-chain-local-cost')
        credit['m']['creditAllocation']=dict(schema='action-credit-ledger-v1',policy='cost-only-no-hit-v1',unallocatedReward=0,groupReward=-3,allocations=[dict(transactionId='tx',reward=-1.5),dict(transactionId='tx2',reward=-1.5)])
        cases.append(dict(name='valid-credit',sample=credit))
        for field,v in [('policy','wrong'),('unallocatedReward',False),('groupReward',0),('allocations',[])]:
            s=copy.deepcopy(credit);s['m']['creditAllocation'][field]=v;cases.append(dict(name='credit-'+field,sample=s))
        context=dict(schema='mode-context-v1',captured=True,group='doudizhu-classic',mode='doudizhu',submode='normal',collect=True,role='farmer',ruleKey='test',ruleVersion=1)
        for field,values in [('captured',[True,False,1]),('ruleVersion',[1,True,None]),('group',['doudizhu-classic','foreign']),('role',['farmer','unknown']),('featureVersion',[130,134,142,None])]:
            for v in values:
                s=row();s['m']['modeContext']={**context,field:v};cases.append(dict(name='mode-'+field+str(v),sample=s,options={'modeGroup':'doudizhu-classic'}))
        # JSON-compatible corpus and codes are retained with the test evidence.
        client=os.environ.get('CLIENT_ROOT',os.getcwd())
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'corpus.json';path.write_text(json.dumps(cases),encoding='utf-8')
            js=subprocess.run(['node',str(ROOT/'tests/contract-client.mjs'),client,str(path)],capture_output=True,text=True,encoding='utf-8')
            self.assertEqual(js.returncode,0,js.stderr);expected=json.loads(js.stdout.strip().splitlines()[-1])
        got=[]
        for case in cases:
            try:q=qualify(case['sample'],case.get('options',{}).get('modeGroup'));got.append({k:q[k] for k in ('eligible','state','code')})
            except Exception as exc:got.append({'exception':repr(exc)})
        evidence=[{**case,'client':a,'server':b} for case,a,b in zip(cases,expected,got)]
        out=os.environ.get('CONTRACT_EVIDENCE')
        if out:pathlib.Path(out).write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
        failures=[r for r in evidence if r['client']!=r['server']]
        self.assertEqual(failures,[],json.dumps(failures,ensure_ascii=False))
        print('Cross-language qualification cases:',len(cases))
if __name__=='__main__':unittest.main(verbosity=2)
