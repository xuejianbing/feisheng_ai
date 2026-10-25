import json,unittest,urllib.request,urllib.error
from unittest.mock import patch
import test_source_http as fixture
from test_trusted import row
from source_auth import SourceAuthority
class EndpointHTTP(unittest.TestCase):
 setUp=fixture.SourceHTTP.setUp
 close=fixture.SourceHTTP.close
 body=fixture.SourceHTTP.body
 post=fixture.SourceHTTP.post
 def test_service_b_cannot_be_changed_by_host_or_forwarded_host(self):
  self.assertEqual(self.post(self.body([row()]),self.a)[0],200)
  before=self.server.trusted_inbox().view()['counts'].copy()
  files={str(p):p.read_bytes() for p in (self.base/'trusted_ingest/requests').glob('*/*.json')}
  self.server.PUBLIC_ENDPOINT='https://endpoint-b.example/'
  self.server._authority=SourceAuthority(self.authority.path,expected_endpoint=self.server.PUBLIC_ENDPOINT)
  bad=row();bad['f'][0]=999;body=self.body([bad]);body['endpoint']=self.server.PUBLIC_ENDPOINT;body['source']['endpoint']=self.server.PUBLIC_ENDPOINT
  for host in ['data.feiqiaoai.uno','endpoint-b.example','not-a-url']:
   status,result,_=self.post(body,self.a,headers={'Host':host,'X-Forwarded-Host':'data.feiqiaoai.uno'})
   self.assertEqual(status,403);self.assertEqual(result['error'],'E_SOURCE_ENDPOINT_MISMATCH');self.assertNotIn(self.a['token'],json.dumps(result))
  self.assertEqual(self.server.trusted_inbox().view()['counts'],before)
  self.assertEqual(files,{str(p):p.read_bytes() for p in (self.base/'trusted_ingest/requests').glob('*/*.json')})
 def test_missing_endpoint_reports_configuration_and_keeps_legacy_archive(self):
  with patch.object(self.server,'PUBLIC_ENDPOINT',None),patch.object(self.server,'_authority',None):
   status,result,_=self.post(self.body([row()]),self.a);self.assertEqual(status,503);self.assertEqual(result['error'],'E_SOURCE_ENDPOINT_CONFIG')
   try:urllib.request.urlopen(self.url)
   except urllib.error.HTTPError as error:self.assertEqual(error.code,503);self.assertEqual(json.load(error)['error'],'E_SOURCE_ENDPOINT_CONFIG')
   else:self.fail('capability endpoint must report configuration failure')
   status,result,_=self.post({'v':2,'samples':[row()]});self.assertEqual(status,200);self.assertEqual(result['receipt']['sourceTrust']['status'],'archive-only')
  self.assertEqual(self.server.trusted_inbox().view()['counts']['eligibleRecords'],0)
 def test_invalid_configuration_is_not_replaced_by_request_headers(self):
  with patch.object(self.server,'PUBLIC_ENDPOINT','http://outside.example/'),patch.object(self.server,'_authority',None):
   status,result,_=self.post(self.body([row()]),self.a,headers={'Host':'data.feiqiaoai.uno','X-Forwarded-Host':'data.feiqiaoai.uno'})
   self.assertEqual(status,503);self.assertEqual(result['error'],'E_SOURCE_ENDPOINT_CONFIG')
 def test_explicit_loopback_http_service(self):
  public=self.url+'/'
  authority=SourceAuthority(self.authority.path,expected_endpoint=public,allow_loopback_http=True)
  credential=authority.issue('loopback','wuming-ai',public)
  with patch.object(self.server,'PUBLIC_ENDPOINT',public),patch.object(self.server,'ALLOW_LOOPBACK_HTTP',True),patch.object(self.server,'_authority',authority):
   status,result,_=self.post(self.body([row()],credential),credential)
   self.assertEqual(status,200);self.assertTrue(result['receipt']['sourceTrust']['eligibleSource'])
if __name__=='__main__':unittest.main(verbosity=2)
