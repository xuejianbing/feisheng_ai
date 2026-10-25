import contextlib,importlib.util,json,os,pathlib,socket,sqlite3,subprocess,sys,tempfile,threading,unittest,urllib.request,urllib.error
from test_trusted import ROOT,row,env,raw
from source_auth import SourceAuthority
class HTTP(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=pathlib.Path(self.tmp.name)
        self.authority=SourceAuthority(self.base/'test-authority.sqlite',create=True,expected_endpoint='https://data.feiqiaoai.uno/');self.credential=self.authority.issue('client','wuming-ai','https://data.feiqiaoai.uno/')
        with unittest.mock.patch.dict(os.environ,{'INGEST_BASE_DIR':str(self.base),'INGEST_PUBLIC_ENDPOINT':'https://data.feiqiaoai.uno/'}):
            spec=importlib.util.spec_from_file_location('offline_server',ROOT/'server/server_sharded.py');self.server=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.server)
        self.server.AUTH_DB_PATH=str(self.authority.path);self.server._authority=self.authority
        self.http=self.server.ThreadingHTTPServer(('127.0.0.1',0),self.server.IngestHandler);self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close);self.url='http://127.0.0.1:'+str(self.http.server_port)
    def close(self):self.http.shutdown();self.http.server_close();self.thread.join()
    def authorized(self,body):
        try:e=json.loads(body)
        except ValueError:return body,{}
        if isinstance(e,dict) and e.get('source'):
            e['source'].update(principalId=self.credential['principalId'],realmId=self.credential['realmId'])
            return raw(e),{'Authorization':'Bearer '+self.credential['token']}
        return body,{}
    def send(self,body,path='/'):
        body,headers=self.authorized(body)
        try:
            with urllib.request.urlopen(urllib.request.Request(self.url+path,data=body,headers={'Content-Type':'application/json',**headers}),timeout=15) as r:return r.status,dict(r.headers),json.load(r)
        except urllib.error.HTTPError as e:return e.code,dict(e.headers),json.load(e)
    def test_real_post_receipt_rate_limit_get(self):
        body=raw(env([row()]));status,_,result=self.send(body);self.assertEqual(status,200);self.assertTrue(result['receipt']['attachmentsArchived'])
        for _ in range(11):self.assertEqual(self.send(body)[0],200)
        status,headers,result=self.send(body);self.assertEqual(status,429);self.assertGreater(int(headers['Retry-After']),0);self.assertIn('Retry-After',headers['Access-Control-Expose-Headers'])
        self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],1)
        with urllib.request.urlopen(self.url) as r:self.assertIsNone(json.load(r)['merged_samples'])
        self.assertFalse((self.base/'dedup.sqlite').exists());self.assertFalse((self.base/'merged_shards').exists())
    def test_error_and_legacy_archive(self):
        status,_,r=self.send(b'{"samples":[NaN]}');self.assertEqual(status,400)
        # Genuine unavailable SQLite path fails without a success receipt.
        parent=self.base/'trusted_ingest';parent.mkdir();(parent/'inbox.sqlite').mkdir()
        status,_,r=self.send(raw(env([row()])));self.assertEqual(status,503);self.assertFalse(r['ok'])
        (parent/'inbox.sqlite').rename(parent/'blocked-evidence');status,_,r=self.send(raw({'samples':[row()]}));self.assertEqual(status,200)
        self.assertEqual(self.server.trusted_inbox().view()['reasons']['E_SOURCE_AUTH_MISSING'],1)
    def test_response_loss_replay(self):
        body,headers=self.authorized(raw(env([row()])));sock=socket.create_connection(('127.0.0.1',self.http.server_port));sock.sendall(b'POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nAuthorization: '+headers['Authorization'].encode()+b'\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body);sock.shutdown(socket.SHUT_WR)
        # Do not consume any HTTP response. Server receive still commits exactly once.
        sock.close();status,_,r=self.send(body);self.assertEqual(status,200)
        view=self.server.trusted_inbox().view();self.assertEqual(view['counts']['rawRequests'],1);self.assertEqual(view['counts']['eligibleRecords'],1)
    def test_real_client_receipt_parser(self):
        body=self.base/'client-body.json';body.write_bytes(self.authorized(raw(env([row()])))[0]);key=self.base/'test-private-credential.json';key.write_text(json.dumps(self.credential))
        result=subprocess.run(['node',str(ROOT/'tests/receipt-client.mjs'),self.url,os.environ.get('CLIENT_ROOT',os.getcwd()),str(body),str(key)],capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(result.returncode,0,result.stderr);self.assertIn('PASS actual client receipt parser',result.stdout)
        self.assertEqual(self.server.trusted_inbox().view()['counts']['rawRequests'],1)
import unittest.mock
if __name__=='__main__':unittest.main(verbosity=2)
