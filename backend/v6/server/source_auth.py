"""Operator-issued per-source bearer credentials. No HTTP registration, shared key,
device attestation, or account recovery claim. The operator must verify ownership
out of band; copied credentials are equivalent to possession until revoked.
"""
import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib,hmac,json,os,re,secrets,sqlite3,time
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,unquote

class AuthError(Exception):
    def __init__(self,code,status=401):super().__init__(code);self.code=code;self.status=status

def normalize_endpoint(value,allow_loopback_http=False):
    """ASCII absolute receiver URL; no request headers or DNS resolution.
    Scheme/DNS case and default ports normalize; empty path becomes '/'. Path
    case, non-root trailing slash and percent-escape spelling stay significant.
    Query/fragment/userinfo, controls, backslashes and dot traversal are refused.
    """
    try:
        if not isinstance(value,str) or not value or not value.isascii() or any(ord(c)<=32 or ord(c)==127 for c in value) or any(c in value for c in ('\\','?','#')):raise ValueError()
        p=urlsplit(value);scheme=p.scheme.lower();host=p.hostname;port=p.port
        if not host or p.username is not None or p.password is not None or '@' in p.netloc or '%' in host or p.netloc.endswith(':') or port is not None and not 1<=port<=65535:raise ValueError()
        host=host.lower()
        try:
            address=ipaddress.ip_address(host);host=address.compressed;loopback=address.is_loopback
            authority='['+host+']' if address.version==6 else host
        except ValueError:
            if len(host)>253 or host.split('.')[-1].isdigit() or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label) for label in host.split('.')):raise ValueError()
            authority=host;loopback=host=='localhost'
        if scheme!='https' and not (scheme=='http' and allow_loopback_http and loopback):raise ValueError()
        path=p.path or '/'
        if not re.fullmatch(r"/(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9a-fA-F]{2})*",path):raise ValueError()
        decoded=unquote(path,errors='strict')
        if decoded.startswith('//') or '\\' in decoded or any(ord(c)<32 or ord(c)==127 for c in decoded) or any(s in ('.','..') for s in decoded.split('/')):raise ValueError()
        default=443 if scheme=='https' else 80
        if port is not None and port!=default:authority+=':'+str(port)
        return urlunsplit((scheme,authority,path,'',''))
    except (ValueError,TypeError,UnicodeError):raise AuthError('E_SOURCE_ENDPOINT_INVALID',400) from None

@dataclass(frozen=True)
class AuthorizedSource:
    realm:str
    domain:str
    principal:str
    instance:str
    credential_id:str
    def record(self):return dict(schema='verified-source-v1',realm=self.realm,domain=self.domain,principalId=self.principal,clientInstanceId=self.instance,credentialId=self.credential_id)
    def namespace(self):return dict(schema='ingest-source-v1',domain=json.dumps([self.realm,self.domain],separators=(',',':')),instanceId=self.principal)

class SourceAuthority:
    def __init__(self,path,create=False,expected_endpoint=None,allow_loopback_http=False):
        self.allow_loopback_http=allow_loopback_http
        self.expected_endpoint=None
        if expected_endpoint is not None:
            try:self.expected_endpoint=normalize_endpoint(expected_endpoint,allow_loopback_http)
            except AuthError:raise AuthError('E_SOURCE_ENDPOINT_CONFIG',503) from None
        self.path=Path(path).resolve()
        if not create and not self.path.is_file():raise AuthError('E_AUTH_NOT_CONFIGURED',503)
        if create:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with self.connect(create=True) as c:
                c.executescript('''CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,realm TEXT NOT NULL,domain TEXT NOT NULL,instance TEXT NOT NULL,principal TEXT NOT NULL,endpoint TEXT NOT NULL,expires REAL NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);''')
                c.execute('INSERT OR IGNORE INTO metadata VALUES(?,?)',('realm',secrets.token_hex(16)))
        with self.connect() as c:
            found=c.execute("SELECT value FROM metadata WHERE key='realm'").fetchone()
            if not found:raise AuthError('E_AUTH_STORE',503)
            self.realm=found[0]
    def require_endpoint(self):
        if self.expected_endpoint is None:raise AuthError('E_SOURCE_ENDPOINT_CONFIG',503)
        return self.expected_endpoint
    def matches_endpoint(self,value):
        expected=self.require_endpoint()
        try:return normalize_endpoint(value,self.allow_loopback_http)==expected
        except AuthError:return False
    @contextmanager
    def connect(self,create=False):
        c=None
        try:
            c=sqlite3.connect(str(self.path) if create else self.path.as_uri()+'?mode=rw',uri=not create,timeout=30)
            c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA synchronous=FULL')
            with c:yield c
        except sqlite3.Error as e:raise AuthError('E_AUTH_STORE',503) from e
        finally:
            if c is not None:c.close()
    def _issue(self,c,instance,domain,endpoint,ttl,principal):
        endpoint=normalize_endpoint(endpoint,self.allow_loopback_http)
        if not all(isinstance(v,str) and v.strip() and len(v)<=200 for v in [instance,domain]):raise ValueError('E_SOURCE_IDENTITY')
        kid=secrets.token_hex(16);secret=secrets.token_urlsafe(32);expires=time.time()+ttl
        c.execute('INSERT INTO credentials VALUES(?,?,?,?,?,?,?,?,0)',(kid,hashlib.sha256(secret.encode()).hexdigest(),self.realm,domain,instance,principal,endpoint,expires))
        return dict(schema='ingest-source-credential-v1',realmId=self.realm,domain=domain,clientInstanceId=instance,principalId=principal,credentialId=kid,token='sa1.'+kid+'.'+secret,endpoint=endpoint,expiresAt=expires)
    def issue(self,instance,domain,endpoint,ttl=30*86400):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE');return self._issue(c,instance,domain,endpoint,ttl,secrets.token_hex(16))
    def revoke(self,kid):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('UPDATE credentials SET revoked=1 WHERE id=?',(kid,)).rowcount:raise ValueError('E_CREDENTIAL_UNKNOWN')
    def rotate(self,kid,ttl=30*86400):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT instance,domain,endpoint,principal FROM credentials WHERE id=?',(kid,)).fetchone()
            if not row:raise ValueError('E_CREDENTIAL_UNKNOWN')
            c.execute('UPDATE credentials SET revoked=1 WHERE id=?',(kid,))
            return self._issue(c,row[0],row[1],row[2],ttl,row[3])
    @contextmanager
    def prepared_guard(self,proof):
        self.require_endpoint()
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT realm,domain,instance,principal,expires,revoked,endpoint FROM credentials WHERE id=?',(proof.get('credentialId'),)).fetchone()
            yield bool(row and list(row[:4])==[proof.get('realm'),proof.get('domain'),proof.get('clientInstanceId'),proof.get('principalId')] and row[4]>time.time() and not row[5] and self.matches_endpoint(row[6]))
    @contextmanager
    def authorize(self,header,envelope):
        self.require_endpoint()
        matched=re.fullmatch(r'Bearer sa1\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})',header or '')
        if not matched:raise AuthError('E_SOURCE_AUTH_REQUIRED')
        with self.connect() as c:
            # Serialize authorization through final inbox commit against revocation.
            # A revoke that commits first wins; an already authorized receive finishes first.
            c.execute('BEGIN IMMEDIATE');kid,secret=matched.groups()
            row=c.execute('SELECT secret_hash,realm,domain,instance,principal,expires,revoked,endpoint FROM credentials WHERE id=?',(kid,)).fetchone()
            if not row or not hmac.compare_digest(row[0],hashlib.sha256(secret.encode()).hexdigest()):raise AuthError('E_SOURCE_AUTH_INVALID')
            if row[1]!=self.realm:raise AuthError('E_AUTH_REALM_CHANGED',503)
            if row[6]:raise AuthError('E_SOURCE_AUTH_REVOKED')
            if row[5]<=time.time():raise AuthError('E_SOURCE_AUTH_EXPIRED')
            if not self.matches_endpoint(row[7]):raise AuthError('E_SOURCE_ENDPOINT_MISMATCH',403)
            source=envelope.get('source') if isinstance(envelope,dict) else None
            if not isinstance(source,dict) or source.get('schema')!='ingest-source-v1' or source.get('domain')!=row[2] or source.get('instanceId')!=row[3] or source.get('principalId')!=row[4] or source.get('realmId')!=row[1]:raise AuthError('E_SOURCE_AUTH_BINDING',403)
            if envelope.get('v')!=3:raise AuthError('E_PROTOCOL_VERSION',400)
            yield AuthorizedSource(row[1],row[2],row[4],row[3],kid)

def main():
    p=argparse.ArgumentParser(description='Local operator only; never expose this as an HTTP registration endpoint')
    p.add_argument('--db',required=True);p.add_argument('--allow-loopback-http',action='store_true',help='isolated loopback tests only');sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('init')
    issue=sub.add_parser('issue');issue.add_argument('--client-instance',required=True);issue.add_argument('--domain',default='wuming-ai');issue.add_argument('--endpoint',required=True);issue.add_argument('--output',required=True)
    rotate=sub.add_parser('rotate');rotate.add_argument('--credential-id',required=True);rotate.add_argument('--output',required=True)
    revoke=sub.add_parser('revoke');revoke.add_argument('--credential-id',required=True)
    args=p.parse_args();store=SourceAuthority(args.db,create=args.command=='init',allow_loopback_http=args.allow_loopback_http)
    if args.command=='init':print('source authority initialized; protect DB/directory ACLs');return
    if args.command=='revoke':store.revoke(args.credential_id);print('credential revoked');return
    # Fail before rotating if the output already exists. No secrets printed to logs.
    fd=os.open(args.output,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f:
        value=store.rotate(args.credential_id) if args.command=='rotate' else store.issue(args.client_instance,args.domain,args.endpoint)
        json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
    print('credential written to explicit private output; deliver through a controlled channel')
if __name__=='__main__':main()
