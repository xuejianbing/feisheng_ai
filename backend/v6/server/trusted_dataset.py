"""Offline derived datasets, manifest verification, model binding, and migration rehearsal.
No fitting, activation, deployment, or writes to legacy sources.
"""
import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path
import sqlite3
from contextlib import contextmanager
from trusted_ingest import DurableInbox, source_of
from training_contract import canonical, digest, qualify, ids

CLIENT_RULES_SHA256='1a18530563184a10e7cb2ad2c4f4b8a310523c4157183993e221de848ac8d392'
CLIENT_CONTRACT_HASHES={'score/model/train/trainingDataset.js': '1a18530563184a10e7cb2ad2c4f4b8a310523c4157183993e221de848ac8d392', 'score/model/train/labelPolicy.js': 'f9d81bad29d69fbd35c2d9b8c4014a64124fcf3e2dcb445502d78d1b0b1fbf15', 'score/model/features/dimensionAdapter.js': 'ea7f557376c6ef5cf8c3e00882bbb6741da5694e70f8ca70d8b34389745c9a51', 'score/decision/strategy/championStrategy.js': '0aeee62c5aa722723a6f7f1a344400a2420286b29f0c5c9301bee98f54ce2190', 'score/decision/engine/skillLog.js': '7431a97d5130bfb0ed0f28417399a98b34f9a4b0aa23acb92cc0e79861554bd0'}
@contextmanager
def journal_connection(path):
    c=sqlite3.connect(path)
    try:
        c.execute('PRAGMA synchronous=FULL')
        with c:yield c
    finally:c.close()
def build_dataset(view,seed='20261023',generated_at=None):
    rows=sorted(copy.deepcopy(view['samples']),key=lambda r:r['logicalKey'])
    seen=set()
    for row in rows:
        if not qualify(row['sample'])['eligible'] or source_of({'source':dict(schema='ingest-source-v1',domain=row['source'][0],instanceId=row['source'][1])})!=row['source'] or row['logicalKey']!=canonical(row['source']+ids(row['sample'])) or row['logicalKey'] in seen:raise ValueError('E_DATASET_VIEW')
        seen.add(row['logicalKey'])
    partitions={k:[] for k in ('training','validation','holdout')};sessions={k:set() for k in partitions}
    for r in rows:
        sid=canonical(r['source']+[r['sample']['m']['sessionId']]);bucket=int(digest([str(seed),sid])[:8],16)/4294967296
        name='holdout' if bucket<.1 else 'validation' if bucket<.2 else 'training'
        sessions[name].add(sid);partitions[name].append(r)
    splits=dict(schema='namespaced-session-hash-three-way-v1',seed=str(seed),ratios=dict(training=.8,validation=.1,holdout=.1),sessions={k:sorted(v) for k,v in sessions.items()},validationIsHoldout=False,
                classicClientRule='client classic validation IS holdout; this server export is a separate three-way split')
    core=dict(schema='server-training-dataset-v1',rules='training-lineage-v1',clientRulesSHA256=CLIENT_RULES_SHA256,clientContractHashes=CLIENT_CONTRACT_HASHES,clientSchema='action-outcome-v1',
        counts={k:v for k,v in view['counts'].items() if k not in ('duplicateRequests','preparedRequests')},reasons=view['reasons'],rawInputHash=view['rawInputHash'],splits=splits,
        partitionHashes={k:digest(v) for k,v in partitions.items()},modelArchitecture=[134,128,64,6],legacyMissingFeatures=[130,131,132,133],
        labelDefinition='actor=clamp(round(observedReward*12),-147,147); critic=clamp(observedReward/12,-1,1); terminal independent',
        pretrainedExposure='unknown',entityMatchContinuity='unproven across client reload',
        hashAlgorithm='SHA-256/server-canonical-json-v1 (sorted keys; UTF-8; finite numbers; integral doubles normalized)',
        revisions=[dict(logicalKey=r['logicalKey'],contentHash=digest(r['sample'])) for r in rows])
    content_hash=digest(core)
    manifest={**core,'contentHash':content_hash,'datasetVersion':'sha256:'+content_hash,'generatedAt':generated_at or datetime.datetime.now(datetime.timezone.utc).isoformat()}
    return dict(manifest=manifest,partitions=partitions,view=copy.deepcopy(view))

def verify_dataset(bundle):
    try:
        m=bundle['manifest'];rebuilt=build_dataset(bundle['view'],m['splits']['seed'],m['generatedAt'])
        return canonical(rebuilt)==canonical(bundle)
    except (KeyError,TypeError,ValueError):return False

def bind_model(model_path,bundle,validation):
    """Records hashes only; callers must supply real trainer/validator evidence.
    This function does not attest that an external trainer actually used a dataset.
    No supplied legacy trainer is approved to consume this contract yet.
    """
    model_hash=hashlib.sha256(Path(model_path).read_bytes()).hexdigest()
    if not verify_dataset(bundle) or validation.get('status')!='passed' or validation.get('modelSHA256')!=model_hash or validation.get('datasetHash')!=bundle['manifest']['contentHash']:raise ValueError('E_BINDING_PROOF')
    core=dict(schema='model-dataset-binding-v1',modelSHA256=model_hash,
              datasetHash=bundle['manifest']['contentHash'],validation=copy.deepcopy(validation),manifest=copy.deepcopy(bundle['manifest']),
              externalTrainingAttested=False)
    return {**core,'bindingHash':digest(core)}

def verify_binding(model_path,bundle,proof):
    try:return canonical(bind_model(model_path,bundle,proof['validation']))==canonical(proof)
    except (OSError,ValueError,KeyError,TypeError):return False

def migrate(source_dir,output_dir,source=None,max_files=None):
    """Dry-run into a separately marked directory. No production import entry point.
    Source map is an operator claim requiring evidence outside these scripts.
    """
    src=Path(source_dir).resolve();dst=Path(output_dir).resolve()
    if dst==src or src in dst.parents or dst in src.parents:raise ValueError('E_MIGRATION_PATH')
    if source is not None and source_of({'source':source}) is None:raise ValueError('E_SOURCE_IDENTITY')
    config=dict(schema='migration-dry-run-v1',sourceDirectory=str(src),source=source)
    dst.mkdir(parents=True,exist_ok=True);marker=dst/'dry-run.json'
    if marker.exists():
        stored=json.loads(marker.read_text(encoding='utf-8'))
        if {k:stored.get(k) for k in config}!=config:raise ValueError('E_MIGRATION_CONFIG')
    else:
        if any(dst.iterdir()):raise ValueError('E_MIGRATION_UNMARKED_OUTPUT')
        stored={**config,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        marker.write_text(canonical(stored),encoding='utf-8')
    journal=dst/'migration.sqlite';processed=0
    with journal_connection(journal) as c:
        c.execute("CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,sha TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('planned','complete')))")
        known={p:(h,state) for p,h,state in c.execute('SELECT path,sha,state FROM files')}
    # Check even incomplete source files BEFORE recovering any prepared inbox rows.
    for relative,(sha,_) in known.items():
        path=src/relative
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise ValueError('E_MIGRATION_SOURCE_CHANGED')
    inbox=DurableInbox(dst/'inbox')
    for path in sorted(src.rglob('*.json')):
        relative=path.relative_to(src).as_posix();body=path.read_bytes();sha=hashlib.sha256(body).hexdigest()
        if relative in known:
            if known[relative][0]!=sha:raise ValueError('E_MIGRATION_SOURCE_CHANGED')
            if known[relative][1]=='complete':continue
        if max_files is not None and processed>=max_files:break
        # Plan hash durably before any receive, including the first file.
        with journal_connection(journal) as c:c.execute("INSERT OR IGNORE INTO files VALUES(?,?,'planned')",(relative,sha))
        data=json.loads(body);records=data if isinstance(data,list) else [data]
        # Hourly envelopes vs a bare legacy shard of samples. Never infer identity.
        envelopes=records if all(isinstance(r,dict) and isinstance(r.get('samples'),list) for r in records) else [{'samples':records}]
        for i,e in enumerate(envelopes):
            e=copy.deepcopy(e)
            if source is not None:e['source']=source
            e['migrationProvenance']=dict(file=relative,sha256=sha,record=i,dryRun=True)
            inbox.receive(canonical(e).encode())
        if path.read_bytes()!=body:raise ValueError('E_MIGRATION_SOURCE_CHANGED')
        # Crash before journal commit is safe: same immutable request hashes replay.
        with journal_connection(journal) as c:c.execute("UPDATE files SET state='complete' WHERE path=?",(relative,))
        known[relative]=(sha,'complete');processed+=1
    view=inbox.view()
    return dict(schema='migration-dry-run-report-v1',filesCompleted=sum(state=='complete' for _,state in known.values()),inputFileHashes={p:h for p,(h,_) in sorted(known.items())},view={k:v for k,v in view.items() if k!='samples'},dataset=build_dataset(view,generated_at=stored['generatedAt'])['manifest'],
                productionMigrated=False,sourceIdentity='operator-asserted' if source else 'unknown-quarantined')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);parser.add_argument('--dry-run',action='store_true',required=True)
    args=parser.parse_args();report=migrate(args.source,args.output)
    print(json.dumps(report,ensure_ascii=False,indent=2))
