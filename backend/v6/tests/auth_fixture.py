"""Explicit test-only operator authorization for the unchanged B durability probes.
No production caller imports this. Fixed test realm/principals let two temporary
copies model the same authorized server for order/manifest comparisons.
"""
import copy,hashlib,json
from pathlib import Path
from source_auth import SourceAuthority
from trusted_ingest import DurableInbox,decode,source_of
class FixtureInbox(DurableInbox):
    def __init__(self,base,**kwargs):
        path=Path(base)/'fixture-authority.sqlite';self.fixture_authority=SourceAuthority(path,create=True,expected_endpoint='https://data.feiqiaoai.uno/')
        with self.fixture_authority.connect() as c:c.execute("UPDATE metadata SET value='synthetic-test-realm' WHERE key='realm'")
        self.fixture_authority.realm='synthetic-test-realm';self.fixture_credentials={}
        super().__init__(base,authorization_guard=self.fixture_authority.prepared_guard)
    def credential_for(self,e):
        source=source_of(e)
        if not source:return None
        key=tuple(source)
        if key not in self.fixture_credentials:
            c=self.fixture_authority.issue(source[1],source[0],'https://data.feiqiaoai.uno/')
            principal=hashlib.sha256(json.dumps(source).encode()).hexdigest()[:32]
            with self.fixture_authority.connect() as db:db.execute('UPDATE credentials SET principal=? WHERE id=?',(principal,c['credentialId']))
            c['principalId']=principal;self.fixture_credentials[key]=c
        return self.fixture_credentials[key]
    def receive(self,raw,authorization=None):
        e,_=decode(raw);c=self.credential_for(e)
        if authorization or not c:return super().receive(raw,authorization=authorization)
        verified=copy.deepcopy(e);verified['v']=3;verified['source'].update(principalId=c['principalId'],realmId=c['realmId'])
        with self.fixture_authority.authorize('Bearer '+c['token'],verified) as proof:return super().receive(raw,authorization=proof)
    def request_hash(self,raw,authorization=None):
        if authorization:return super().request_hash(raw,authorization)
        e,_=decode(raw);c=self.credential_for(e)
        if not c:return super().request_hash(raw)
        verified=copy.deepcopy(e);verified['v']=3;verified['source'].update(principalId=c['principalId'],realmId=c['realmId'])
        with self.fixture_authority.authorize('Bearer '+c['token'],verified) as proof:return super().request_hash(raw,proof)
