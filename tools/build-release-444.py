from pathlib import Path
import subprocess,zipfile,io,json,hashlib,re,sys
root=Path.cwd();out=root/'dist/release-v4.4.4';out.mkdir(parents=True,exist_ok=True)
assert subprocess.check_output(['git','status','--porcelain']).strip()==b'', 'working tree is dirty'
head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
for ref in ['4d3aae7','020fd03','aa919bb','636b636']:
 subprocess.run(['git','merge-base','--is-ancestor',ref,head],check=True)
archive=zipfile.ZipFile(io.BytesIO(subprocess.check_output(['git','-c','core.autocrlf=false','archive','--format=zip',head])))
version=json.loads(archive.read('info.json'))['version'];assert version=='4.4.4'
source=archive.read('js/config/version.js').decode('utf-8');assert re.search(r"VERSION = '4.4.4'",source)and re.search(r"VERSION_SEMVER = '4.4.4'",source)
include=('assets/','css/','js/','logs/','model/','score/','shadow/')
files={n:archive.read(n)for n in archive.namelist()if not n.endswith('/')and(n in ['extension.js','info.json','LICENSE','README.md','CHANGELOG.md']or n.startswith(include))and n!='score/model/net/client_policy_model_v2.js'}
sha=lambda b:hashlib.sha256(b).hexdigest()
blobs={}
for row in subprocess.check_output(['git','ls-tree','-rz',head]).split(b'\0'):
 if row:
  meta,name=row.split(b'\t',1);blobs[name.decode('utf-8')]=meta.split()[2].decode('ascii')
for n,b in files.items():assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==blobs[n], 'archive is not byte-identical to source blob: '+n
weights=[]
for n,b in files.items():
 if n.startswith('model/')or n.endswith(('defaultWeights.js','client_policy_model_v3.js')):
  original=subprocess.check_output(['git','show','4d3aae7:'+n]);assert original==b,n
  weights.append({'path':n,'sha256':sha(b)})
# A complete archive from this exact commit; no git describe or historical tags.
package=out/('wuming_ai_v'+version+'.zip')
with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED,compresslevel=9)as z:
 for n,b in sorted(files.items()):
  info=zipfile.ZipInfo(n,(2026,10,29,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,b,compresslevel=9)
with zipfile.ZipFile(package)as z:
 assert z.testzip()is None and len(z.namelist())==len(files)
 for n,b in files.items():assert z.read(n)==b
manifest={'version':version,'sourceCommit':head,'files':[{'path':n,'bytes':len(b),'sha256':sha(b)}for n,b in sorted(files.items())],'weights':weights,'package':{'name':package.name,'bytes':package.stat().st_size,'sha256':sha(package.read_bytes())}}
(out/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(out/'SOURCE-COMMIT.txt').write_text(head+'\n',encoding='ascii')
(out/'RELEASE-NOTES.md').write_bytes(archive.read('docs/releases/v4.4.4.md'))
print(json.dumps({'source':head,'files':len(files),'package':manifest['package']},indent=2))
