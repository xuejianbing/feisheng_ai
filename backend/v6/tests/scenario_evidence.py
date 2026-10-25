"""Synthetic evidence only. Writes summaries to an explicit output directory."""
import copy,json,pathlib,sys,tempfile
from test_trusted import DurableInbox,ROOT,row,pending,terminal,env,raw
from trusted_dataset import build_dataset,migrate
from training_contract import canonical

def generate(out):
    out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        base=pathlib.Path(directory);db=DurableInbox(base/'live-synthetic')
        p=pending(row());body=raw(env([p]));first=db.receive(body)
        for _ in range(9):db.receive(body)
        db.receive(raw(env([row()])));db.receive(raw(env([terminal(row())])))
        upgraded=terminal(row());upgraded['sync']=dict(schema='sample-revision-v1',logicalId='tx:'+canonical(['s','actor','tx']),revision='opaque',identity='transaction');db.receive(raw(env([upgraded])))
        bad=row('feature-conflict');changed=copy.deepcopy(bad);changed['f'][0]=999;db.receive(raw(env([bad,changed])))
        wait=pending(row('waiting'));wait['m']['rewardStatus']='partial';db.receive(raw(env([wait])))
        db.receive(raw({'v':2,'samples':[row('unknown-source')]}))
        db.receive(raw(env([row()],domain='different-source')))
        db.receive(raw(env([row('legacy-130',dim=130)])))
        db.receive(raw(env([row('experimental-142',dim=142)])))
        good=row('illegal-pending');illegal=copy.deepcopy(good);illegal['m']['rewardStatus']='pending';db.receive(raw(env([illegal,good])))
        view=db.view();summary={k:v for k,v in view.items() if k!='samples'};summary['firstReceipt']=first
        (out/'SCENARIO-EVIDENCE.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        bundle=build_dataset(view,generated_at='2026-10-24T00:00:00+08:00')
        (out/'SYNTHETIC-MANIFEST.json').write_text(json.dumps(bundle['manifest'],ensure_ascii=False,indent=2),encoding='utf-8')
        src=base/'legacy-source';src.mkdir();(src/'hour.json').write_bytes(raw([{'samples':[pending(row()),row(),terminal(row())]}]))
        unknown=migrate(src,base/'dry-unknown');known=migrate(src,base/'dry-proven',source=dict(schema='ingest-source-v1',domain='operator-proven',instanceId='synthetic-client'))
        migration=dict(unknownSource=unknown,explicitSyntheticProvenance=known,productionMigrated=False)
        (out/'MIGRATION-DRY-RUN.json').write_text(json.dumps(migration,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary['counts'],indent=2))
if __name__=='__main__':generate(sys.argv[1])
