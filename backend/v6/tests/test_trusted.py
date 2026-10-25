import copy, hashlib, importlib.util, json, os, pathlib, sqlite3, subprocess, sys, tempfile, unittest
from contextlib import closing
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from training_contract import qualify, canonical
try:
    from trusted_ingest import DurableInbox, IngestError, build_view
    from trusted_dataset import build_dataset, verify_dataset, bind_model, verify_binding, migrate
    from auth_fixture import FixtureInbox as DurableInbox
except ImportError:
    DurableInbox=None

# Only the old known-provenance migration fixture has a controlled test issuer.
# Production migrate keeps its default unverified inbox and cannot trust old claims.
from unittest.mock import patch
import trusted_dataset
_migration=migrate
def migrate(*args,**kwargs):
    with patch.object(trusted_dataset,'DurableInbox',DurableInbox):return _migration(*args,**kwargs)

def row(tx='tx',session='s',dim=134):
    return dict(f=[1]*dim,r=36,value_target=.25,ts=100,m=dict(sessionId=session,actorId='actor',transactionId=tx,player='hero',action='card',id='sha',target='enemy',rewardSchema='action-outcome-v1',executionState='committed',rewardStatus='observed',observedReward=3,actionOutcome=dict(transactionId=tx,actorId='actor',status='observed',reward=3,normalization=12,attribution='host-event-window',deltas=[dict(playerId='actor',camp=1,hp=1,hand=0,equip=0,judging=0,alive=0,linked=0,turned=0,wine=0)])))
def pending(s):
    s=copy.deepcopy(s);s['m']['rewardStatus']='pending';s['m'].pop('observedReward');s['m'].pop('actionOutcome');return s
def terminal(s):
    s=copy.deepcopy(s);s['m'].update(gameOutcome='win',outcomeTarget=1);return s
def env(rows,instance='client',domain='wuming-ai'):
    return dict(v=3,source=dict(schema='ingest-source-v1',domain=domain,instanceId=instance),samples=rows,panelStats={'real':1},shadowV5=[{'decisionId':'x'}],config={'test':True})
def raw(e):return json.dumps(e,ensure_ascii=False).encode()

class Trusted(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(DurableInbox,'durable receive/merge contract is not implemented')
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
        self.db=DurableInbox(self.base)
    def test_replay_ten_and_restart(self):
        body=raw(env([row()]));a=self.db.receive(body)
        for _ in range(9):self.assertTrue(self.db.receive(body)['duplicate_request'])
        self.db=DurableInbox(self.base);self.assertEqual(a['receipt'],self.db.receive(body)['receipt'])
        self.assertEqual(len(list((self.base/'requests').glob('*/*.json'))),1)
        st=self.db.view();self.assertEqual(st['counts']['eligibleRecords'],1);self.assertEqual(st['counts']['duplicateRequests'],10)
        archive=list((self.base/'requests').glob('*/*.json'))[0];self.assertEqual(archive.read_bytes(),body)
    def test_order_independence_and_source(self):
        s=row();versions=[pending(s),s,terminal(s)]
        for v in reversed(versions):self.db.receive(raw(env([v])))
        a=self.db.view();self.assertEqual(a['counts']['eligibleRecords'],1);self.assertEqual(a['samples'][0]['sample']['m']['gameOutcome'],'win')
        self.db.receive(raw(env([s],domain='another')));self.db.receive(raw(env([row('other')])));self.assertEqual(self.db.view()['counts']['eligibleRecords'],3)
        b=DurableInbox(self.base/'other')
        for v in versions:b.receive(raw(env([v])))
        self.assertEqual(b.view()['samples'],a['samples'])
    def test_conflict_entire_transaction(self):
        s=row()
        for change in ['f','target','reward','pending']:
            with self.subTest(change=change):
                b=DurableInbox(self.base/change);bad=copy.deepcopy(s)
                if change=='f':bad['f'][0]=999
                elif change=='target':bad['m']['target']='different'
                elif change=='pending':bad['m']['rewardStatus']='pending'
                else:
                    bad['r']=-36;bad['value_target']=-.25;bad['m']['observedReward']=-3;bad['m']['actionOutcome']['reward']=-3;bad['m']['actionOutcome']['deltas'][0]['hp']=-1
                b.receive(raw(env([bad,s])));self.assertEqual(b.view()['counts']['eligibleRecords'],0);self.assertEqual(b.view()['counts']['conflictTransactions'],1)
    def test_legacy_upgrade_sync_and_isolation(self):
        s=row();self.db.receive(raw(env([s])))
        upgraded=copy.deepcopy(s);upgraded['sync']=dict(schema='sample-revision-v1',logicalId='tx:'+canonical(['s','actor','tx']),revision='opaque',identity='transaction')
        self.db.receive(raw(env([upgraded])));self.assertEqual(self.db.view()['counts']['uniqueVersions'],1)
        self.db.receive(raw({'v':2,'samples':[s]}));self.assertEqual(self.db.view()['reasons']['E_SOURCE_AUTH_MISSING'],1)
        self.assertEqual(self.db.view()['counts']['eligibleRecords'],1)
        bad=copy.deepcopy(upgraded);bad['sync']['logicalId']='tx:'+canonical(['wrong','actor','tx']);self.db.receive(raw(env([bad])))
        self.assertEqual(self.db.view()['counts']['eligibleRecords'],0)
    def test_real_files_database_failures(self):
        body=raw(env([row()]))
        # A real path collision makes immutable archive writing fail after DB prepare.
        request_sha=self.db.request_hash(body);parent=self.base/'requests'/request_sha[:2];parent.write_text('blocked')
        with self.assertRaises(IngestError) as e:self.db.receive(body)
        self.assertEqual(e.exception.code,'E_ARCHIVE_WRITE')
        with closing(sqlite3.connect(self.db.path)) as c:self.assertEqual(c.execute('select state from requests').fetchone()[0],'prepared')
        parent.rename(self.base/'saved-path-collision');self.db=DurableInbox(self.base);self.assertEqual(self.db.view()['counts']['eligibleRecords'],1)
        # A real sqlite trigger fails final commit; raw archive remains recoverable.
        with closing(sqlite3.connect(self.db.path)) as c:c.execute("CREATE TRIGGER reject_complete BEFORE UPDATE ON requests WHEN NEW.state='complete' BEGIN SELECT RAISE(ABORT,'disk simulation'); END")
        next_body=raw(env([row('next')]))
        with self.assertRaises(IngestError) as e:self.db.receive(next_body)
        self.assertEqual(e.exception.code,'E_FINALIZE_DB')
        with closing(sqlite3.connect(self.db.path)) as c:c.execute('DROP TRIGGER reject_complete')
        self.db=DurableInbox(self.base);self.assertEqual(self.db.view()['counts']['eligibleRecords'],2)
        # Missing raw file after metadata loss is rebuilt from full durable DB payload.
        p=self.base/'requests'/request_sha[:2]/(request_sha+'.json');p.rename(p.with_suffix('.evidence'))
        self.assertTrue(self.db.receive(body)['duplicate_request']);self.assertEqual(p.read_bytes(),body)
    def test_crash_process_recovery(self):
        body_path=self.base/'body.json';body_path.write_bytes(raw(env([row()])))
        for stage in ['prepared','archived','finalized']:
            dst=self.base/stage
            code="import os,sys;from auth_fixture import FixtureInbox as DurableInbox;d=DurableInbox(sys.argv[1]);d._checkpoint=lambda s: os._exit(71) if s==sys.argv[3] else None;d.receive(open(sys.argv[2],'rb').read())"
            result=subprocess.run([sys.executable,'-c',code,str(dst),str(body_path),stage],env={**os.environ,'PYTHONPATH':os.pathsep.join([str(ROOT/'server'),str(ROOT/'tests')])},capture_output=True)
            self.assertEqual(result.returncode,71,result.stderr.decode());b=DurableInbox(dst);receipt=b.receive(body_path.read_bytes())
            self.assertEqual(receipt['receipt']['archivedSamples'],1);self.assertEqual(b.view()['counts']['eligibleRecords'],1)
    def test_qualification_and_dimensions(self):
        for dim,code in [(130,'L_FEATURES_130'),(134,'OK'),(142,'E_DIMENSION')]:self.assertEqual(qualify(row(dim=dim))['code'],code)
        bad=row();bad['f'][0]=float('nan');self.assertEqual(qualify(bad)['code'],'E_DIMENSION')
        with self.assertRaises(IngestError):self.db.receive(json.dumps(env([bad])).encode())
    def test_pending_immutable_conflicts(self):
        s=pending(row());other=copy.deepcopy(s);other['m']['target']='different'
        self.db.receive(raw(env([s,other])));view=self.db.view()
        self.assertEqual(view['counts']['conflictTransactions'],1);self.assertEqual(view['counts']['waitingTransactions'],0)
    def test_manifest_and_candidate_binding(self):
        self.db.receive(raw(env([row(str(i),'s'+str(i//3)) for i in range(90)])))
        a=build_dataset(self.db.view(),generated_at='2026-10-23T00:00:00Z');b=build_dataset(self.db.view(),generated_at='2026-10-24T00:00:00Z')
        self.assertEqual(a['manifest']['contentHash'],b['manifest']['contentHash']);self.assertTrue(verify_dataset(a))
        sessions=[set(x) for x in a['manifest']['splits']['sessions'].values()]
        self.assertTrue(all(not sessions[i]&sessions[j] for i in range(3) for j in range(i)))
        bad=copy.deepcopy(a);bad['partitions']['training'][0]['sample']['f'][0]=999;self.assertFalse(verify_dataset(bad))
        model=self.base/'model.bin';model.write_bytes(b'synthetic snapshot A');validation={'status':'passed','checks':['synthetic-only'],'modelSHA256':hashlib.sha256(model.read_bytes()).hexdigest(),'datasetHash':a['manifest']['contentHash']}
        proof=bind_model(model,a,validation);self.assertTrue(verify_binding(model,a,proof))
        model.write_bytes(b'B');self.assertFalse(verify_binding(model,a,proof))
        with self.assertRaisesRegex(ValueError,'E_BINDING_PROOF'):bind_model(model,a,validation)
        self.db.receive(raw(env([row('new','new')])));self.assertFalse(verify_binding(model,build_dataset(self.db.view()),proof))
    def test_migration_resume_readonly(self):
        src=self.base/'legacy';src.mkdir();p=src/'hour.json';p.write_text(json.dumps([{'samples':[row(),terminal(row())]}]));before=p.read_bytes()
        dest=self.base/'dry-run';a=migrate(src,dest,max_files=0);self.assertEqual(a['filesCompleted'],0)
        b=migrate(src,dest);c=migrate(src,dest);self.assertEqual(b,c);self.assertEqual(p.read_bytes(),before);self.assertEqual(b['view']['counts']['eligibleRecords'],0)
        known=migrate(src,self.base/'known',source={'schema':'ingest-source-v1','domain':'proven-offline','instanceId':'operator-evidence'})
        self.assertEqual(known['view']['counts']['eligibleRecords'],1)
    def test_concurrent_revisions(self):
        import concurrent.futures
        bodies=[raw(env([row()])),raw(env([terminal(row())]))]*5
        with concurrent.futures.ThreadPoolExecutor(4) as pool:list(pool.map(self.db.receive,bodies))
        self.assertEqual(self.db.view()['counts']['eligibleRecords'],1);self.assertEqual(self.db.view()['counts']['rawRequests'],2)
    def test_manifest_order_retry_and_raw_change(self):
        rows=[row(str(i),'s'+str(i//2)) for i in range(40)]
        self.db.receive(raw(env(rows)));a=build_dataset(self.db.view())['manifest']['contentHash']
        other=DurableInbox(self.base/'reversed');other.receive(raw(env(list(reversed(rows)))));self.assertEqual(a,build_dataset(other.view())['manifest']['contentHash'])
        self.db.receive(raw(env(rows)));self.assertEqual(a,build_dataset(self.db.view())['manifest']['contentHash'])
        invalid=row('invalid');invalid['f']=[1]*142;self.db.receive(raw(env([invalid])));self.assertNotEqual(a,build_dataset(self.db.view())['manifest']['contentHash'])
    def test_migration_crash_and_changed_input(self):
        src=self.base/'source';src.mkdir();path=src/'hour.json';body=json.dumps([{'samples':[row()]}]);path.write_text(body)
        dst=self.base/'resume'
        code="import os,sys;from trusted_ingest import DurableInbox;from trusted_dataset import migrate;DurableInbox._checkpoint=lambda self,s: os._exit(72) if s=='prepared' else None;migrate(sys.argv[1],sys.argv[2])"
        result=subprocess.run([sys.executable,'-c',code,str(src),str(dst)],env={**os.environ,'PYTHONPATH':str(ROOT/'server')},capture_output=True)
        self.assertEqual(result.returncode,72,result.stderr.decode())
        path.write_text(json.dumps([{'samples':[row('changed')]}]))
        with self.assertRaisesRegex(ValueError,'E_MIGRATION_SOURCE_CHANGED'):migrate(src,dst)
        path.write_text(body);report=migrate(src,dst);self.assertEqual(report['filesCompleted'],1);self.assertEqual(path.read_text(),body)

if __name__=='__main__':unittest.main(verbosity=2)
