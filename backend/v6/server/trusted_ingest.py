"""Recoverable inbox. No memory fallback, legacy pool writes, or implicit training.

FULL SQLite prepare (including original bytes) -> immutable fsynced request file ->
FULL SQLite finalize (sample index and receipt in one transaction) -> HTTP success.
The SQLite copy can restore directory entries lost on platforms without dir fsync.
"""
import collections
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import threading
import uuid
from training_contract import canonical, digest, ids, qualify, merge_transaction
from source_auth import AuthorizedSource

class IngestError(Exception):
    def __init__(self,code):super().__init__(code);self.code=code

def decode(raw):
    try:
        data=json.loads(raw.decode('utf-8'),parse_constant=lambda v:(_ for _ in ()).throw(ValueError(v)))
        canonical(data).encode('utf-8')  # Reject overflow and invalid Unicode before any receipt.
        samples=data.get('samples',[]) if isinstance(data,dict) else data
        if not isinstance(samples,list) or any(not isinstance(s,dict) for s in samples):raise ValueError('samples')
        return data,samples
    except (ValueError,UnicodeError,TypeError,OverflowError,RecursionError):raise IngestError('E_REQUEST_JSON')

def source_of(envelope):
    s=envelope.get('source') if isinstance(envelope,dict) else None
    if not isinstance(s,dict) or s.get('schema')!='ingest-source-v1':return None
    values=[s.get('domain'),s.get('instanceId')]
    return values if all(isinstance(v,str) and v.strip() and len(v)<=200 for v in values) else None

def business(sample):
    # Transport flags are never training evidence. Unknown business fields retained.
    return {k:v for k,v in sample.items() if k not in ('sync','_cloudAck','_eligibilityCheckedAt','_storageKey','__fp','__fpKey')}

def identity(envelope,s):
    source=source_of(envelope);action=ids(s)
    key=canonical(source+action) if source and action else None
    error=None
    sync=s.get('sync')
    if sync is not None:
        if not isinstance(sync,dict) or sync.get('schema')!='sample-revision-v1' or not isinstance(sync.get('revision'),str) or not sync['revision']:
            error='E_REVISION_PROTOCOL'
        elif action:
            try:matches=sync.get('identity')=='transaction' and isinstance(sync.get('logicalId'),str) and sync['logicalId'].startswith('tx:') and json.loads(sync['logicalId'][3:])==action
            except (ValueError,TypeError):matches=False
            if not matches:error='E_REVISION_IDENTITY'
        elif sync.get('identity')!='local-record-isolated':error='E_REVISION_IDENTITY'
    if not source:error='E_SOURCE_AUTH_MISSING' if isinstance(envelope,dict) and envelope.get('sourceAuthMissing') else 'E_SOURCE_IDENTITY'
    elif not action:error=error or 'E_IDENTITY'
    return key,error

def build_view(entries,request_counts=None):
    """entries from COMPLETE raw requests; raw indices preserved, no in-place edits."""
    groups=collections.defaultdict(dict);reasons=collections.Counter();unkeyed=0;raw_count=0;dups=0
    for envelope,s in entries:
        raw_count+=1;key,error=identity(envelope,s);value=business(s)
        q=qualify(value)
        if error:q=dict(eligible=False,state='quarantine',code=error,sample=None)
        if not q['eligible']:reasons[q['code']]+=1
        if not key:unkeyed+=1;continue
        fp=digest([value,error])
        if fp in groups[key]:dups+=1
        groups[key][fp]=(value,q)
    accepted=[];waiting=conflicts=bad=valid_revisions=0;superseded=0
    for key,versions in sorted(groups.items()):
        rows=[versions[k] for k in sorted(versions)]
        chosen,status=merge_transaction(rows)
        valid_revisions+=sum(q['eligible'] for _,q in rows)
        if chosen is not None:
            accepted.append(dict(logicalKey=key,source=json.loads(key)[:2],sample=chosen));superseded+=len(rows)-1
        elif status=='waiting':waiting+=1
        elif status=='E_TRANSACTION_CONFLICT':conflicts+=1;reasons[status]+=1
        else:bad+=1
    counts=dict(rawSampleRecords=raw_count,uniqueLogicalTransactions=len(groups),uniqueVersions=sum(map(len,groups.values())),duplicateBusinessRecords=dups,
                independentlyQualifiedRevisions=valid_revisions,supersededRevisions=superseded,waitingTransactions=waiting,conflictTransactions=conflicts,
                rejectedTransactions=bad,unidentifiedRecords=unkeyed,eligibleRecords=len(accepted))
    counts.update(request_counts or {})
    return dict(schema='trusted-training-view-v1',counts=counts,reasons=dict(sorted(reasons.items())),samples=accepted,
                rawInputHash=digest(sorted(digest([e,s]) for e,s in entries)))

class DurableInbox:
    def __init__(self,base,authorization_guard=None):
        self.authorization_guard=authorization_guard
        self.base=Path(base);self.base.mkdir(parents=True,exist_ok=True);self.path=self.base/'inbox.sqlite';self.lock=threading.RLock()
        (self.base/'requests').mkdir(exist_ok=True)
        with self.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS requests(sha TEXT PRIMARY KEY,raw BLOB NOT NULL,raw_sha TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','complete')),receipt TEXT,attempts INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS sample_records(request_sha TEXT NOT NULL,ordinal INTEGER NOT NULL,logical_key TEXT,version_fp TEXT NOT NULL,protocol_error TEXT,PRIMARY KEY(request_sha,ordinal),FOREIGN KEY(request_sha) REFERENCES requests(sha));
            CREATE TABLE IF NOT EXISTS versions(logical_key TEXT NOT NULL,version_fp TEXT NOT NULL,PRIMARY KEY(logical_key,version_fp));
            CREATE TABLE IF NOT EXISTS request_authorizations(request_sha TEXT PRIMARY KEY,proof TEXT NOT NULL,FOREIGN KEY(request_sha) REFERENCES requests(sha));''')
        self.recover()
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.path,timeout=30)
        try:
            c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA synchronous=FULL');c.execute('PRAGMA foreign_keys=ON')
            with c:yield c
        finally:c.close()
    def _checkpoint(self,stage):pass  # Test subclasses/process crash probes may stop here; no injected receipts.
    def request_hash(self,raw,authorization=None):
        envelope=decode(raw)[0]
        return digest([authorization.namespace(),envelope]) if authorization else digest(envelope)
    def provenance(self,c,sha):
        row=c.execute('SELECT proof FROM request_authorizations WHERE request_sha=?',(sha,)).fetchone()
        if not row:return dict(source=None,sourceAuthMissing=True),dict(status='archive-only',eligibleSource=False)
        p=json.loads(row[0])
        if p.get('schema')!='verified-source-v1':raise IngestError('E_AUTH_PROOF_CORRUPT')
        if p.get('recoveryDenied'):return dict(source=None,sourceAuthMissing=True),dict(status='archive-only',eligibleSource=False,reason='E_SOURCE_AUTH_REVOKED_BEFORE_FINALIZE')
        source=AuthorizedSource(p['realm'],p['domain'],p['principalId'],p['clientInstanceId'],p['credentialId'])
        return dict(source=source.namespace()),dict(status='authenticated',eligibleSource=True,realmId=p['realm'],domain=p['domain'],principalId=p['principalId'],clientInstanceId=p['clientInstanceId'])
    def _archive(self,sha,raw,expected):
        if hashlib.sha256(raw).hexdigest()!=expected:raise IngestError('E_RAW_DB_CORRUPT')
        parent=self.base/'requests'/sha[:2];path=parent/(sha+'.json')
        try:
            parent.mkdir(exist_ok=True)
            if path.exists():
                old=path.read_bytes()
                if hashlib.sha256(old).hexdigest()==expected:return
                # Preserve corrupt evidence before repair. Never overwrite original silently.
                evidence=path.with_name(path.name+'.corrupt-'+hashlib.sha256(old).hexdigest())
                if not evidence.exists():os.replace(path,evidence)
            tmp=parent/(sha+'.tmp-'+uuid.uuid4().hex)
            with tmp.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
            os.replace(tmp,path)
            if os.name!='nt':
                fd=os.open(parent,os.O_RDONLY)
                try:os.fsync(fd)
                finally:os.close(fd)
        except OSError as e:raise IngestError('E_ARCHIVE_WRITE') from e
    def _finalize(self,sha,raw):
        envelope,samples=decode(raw);new=duplicates=unknown=0
        try:
            with self.connect() as c:
                c.execute('BEGIN IMMEDIATE')
                state,receipt=c.execute('SELECT state,receipt FROM requests WHERE sha=?',(sha,)).fetchone()
                if state=='complete':return json.loads(receipt)
                provenance,trust=self.provenance(c,sha)
                for i,s in enumerate(samples):
                    key,error=identity(provenance,s);fp=digest([business(s),error])
                    c.execute('INSERT INTO sample_records VALUES(?,?,?,?,?)',(sha,i,key,fp,error))
                    if key:
                        inserted=c.execute('INSERT OR IGNORE INTO versions VALUES(?,?)',(key,fp)).rowcount
                        new+=inserted;duplicates+=1-inserted
                    else:unknown+=1
                receipt=dict(schema='ingest-receipt-v1',receivedSamples=len(samples),archivedSamples=len(samples),mergedNewSamples=new,duplicateSamples=duplicates,
                    rejectedUnlabeledSamples=0,unidentifiedSamples=unknown,requestId=sha,durability='sqlite-full-and-fsynced-raw-v1',attachmentsArchived=True,
                    countSemantics='mergedNewSamples=unique-namespaced-revision-index; NOT qualified training rows',qualifiedSamples=None,sourceTrust=trust)
                c.execute("UPDATE requests SET state='complete',receipt=? WHERE sha=?",(canonical(receipt),sha))
            return receipt
        except sqlite3.Error as e:raise IngestError('E_FINALIZE_DB') from e
    def recover(self):
        with self.lock:
            with self.connect() as c:rows=c.execute("SELECT sha,raw,raw_sha FROM requests WHERE state='prepared'").fetchall()
            for sha,raw,raw_sha in rows:
                self._archive(sha,raw,raw_sha)
                with self.connect() as c:p=c.execute('SELECT proof FROM request_authorizations WHERE request_sha=?',(sha,)).fetchone()
                if not p:self._finalize(sha,raw);continue
                if not self.authorization_guard:raise IngestError('E_AUTH_RECOVERY_REQUIRED')
                proof=json.loads(p[0])
                with self.authorization_guard(proof) as active:
                    if not active:
                        with self.connect() as c:c.execute('UPDATE request_authorizations SET proof=? WHERE request_sha=?',(canonical({**proof,'recoveryDenied':True}),sha))
                        continue  # Retain prepared/raw bytes until a fresh authorized same-principal retry.
                    self._finalize(sha,raw)
    def receive(self,raw,authorization=None):
        envelope,_=decode(raw)
        if authorization is not None:
            source=envelope.get('source') if isinstance(envelope,dict) else None
            if not isinstance(authorization,AuthorizedSource) or not source or source.get('domain')!=authorization.domain or source.get('instanceId')!=authorization.instance:raise IngestError('E_AUTH_PROOF_BINDING')
        sha=self.request_hash(raw,authorization)
        with self.lock:
            try:
                with self.connect() as c:
                    c.execute('BEGIN IMMEDIATE');prior=c.execute('SELECT raw,raw_sha,state,receipt FROM requests WHERE sha=?',(sha,)).fetchone()
                    if prior:
                        c.execute('UPDATE requests SET attempts=attempts+1 WHERE sha=?',(sha,))
                        if prior[2]=='prepared' and authorization:
                            if not c.execute('UPDATE request_authorizations SET proof=? WHERE request_sha=?',(canonical(authorization.record()),sha)).rowcount:raise IngestError('E_AUTH_PROOF_CORRUPT')
                    else:
                        c.execute("INSERT INTO requests(sha,raw,raw_sha,state) VALUES(?,?,?,'prepared')",(sha,raw,hashlib.sha256(raw).hexdigest()))
                        if authorization:c.execute('INSERT INTO request_authorizations VALUES(?,?)',(sha,canonical(authorization.record())))
            except sqlite3.Error as e:raise IngestError('E_PREPARE_DB') from e
            self._checkpoint('prepared')
            saved=prior[0] if prior else raw;raw_sha=prior[1] if prior else hashlib.sha256(raw).hexdigest()
            self._archive(sha,saved,raw_sha);self._checkpoint('archived')
            receipt=json.loads(prior[3]) if prior and prior[2]=='complete' else self._finalize(sha,saved)
            self._checkpoint('finalized')
            return dict(ok=True,duplicate_request=bool(prior and prior[2]=='complete'),receipt=receipt)
    def view(self):
        with self.connect() as c:
            rows=c.execute("SELECT sha,raw,attempts FROM requests WHERE state='complete' ORDER BY sha").fetchall()
            prepared=c.execute("SELECT count(*) FROM requests WHERE state='prepared'").fetchone()[0]
        entries=[]
        with self.connect() as c:
            for sha,body,_ in rows:
                _,samples=decode(body);provenance,_=self.provenance(c,sha)
                entries.extend((provenance,s) for s in samples)
        counts=dict(rawRequests=len(rows),duplicateRequests=sum(n-1 for _,_,n in rows),preparedRequests=prepared)
        return build_view(entries,counts)
