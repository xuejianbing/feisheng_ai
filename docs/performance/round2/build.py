from pathlib import Path
import subprocess,zipfile,io,json,hashlib
BASE='636b636b862d427d8a8d55a764159238c3029c0d'
head=subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()
out=Path('dist/mobile-performance-443-round2');out.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
include=('assets/','css/','js/','logs/','model/','score/','shadow/')
def payload(ref):
 archive=zipfile.ZipFile(io.BytesIO(subprocess.check_output(['git','archive','--format=zip',ref])))
 return {n:archive.read(n)for n in archive.namelist()if not n.endswith('/')and(n in ['extension.js','info.json','LICENSE','README.md','CHANGELOG.md']or n.startswith(include))and n!='score/model/net/client_policy_model_v2.js'}
base=payload(BASE);final=payload(head)
for n in base:
 if n.startswith('model/')or n.endswith(('defaultWeights.js','client_policy_model_v3.js')):assert base[n]==final[n],n
reports=[]
for label,files,ref in [('baseline',base,BASE),('QA-round2',final,head)]:
 filename='wumingAI-4.4.3-'+label+'.zip';dest=out/filename
 with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
  for n,data in sorted(files.items()):
   info=zipfile.ZipInfo('无名AI/'+n,(2026,10,28,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
 manifest=[dict(path='无名AI/'+n,bytes=len(b),sha256=sha(b))for n,b in sorted(files.items())]
 with zipfile.ZipFile(dest)as z:
  assert len(z.namelist())==len(manifest)
  for row in manifest:assert sha(z.read(row['path']))==row['sha256']
 (out/(label+'-files.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 reports.append(dict(file=filename,commit=ref,files=len(files),bytes=dest.stat().st_size,sha256=sha(dest.read_bytes())))
(out/'FINAL-COMMIT.txt').write_text(head+'\n',encoding='ascii')
(out/'round2.patch').write_bytes(subprocess.check_output(['git','diff','--binary','aa919bb',head]))
(out/'review.patch').write_bytes(subprocess.check_output(['git','diff','--binary',BASE,head]))
subprocess.run(['git','format-patch',BASE+'..'+head,'--output-directory',str(out/'commits')],check=True,capture_output=True)
(out/'SHA256SUMS.txt').write_text(''.join(r['sha256']+'  '+r['file']+'\n'for r in reports),encoding='ascii')
(out/'delivery.json').write_text(json.dumps(dict(baseline=BASE,head=head,status='source review; Android acceptance pending',packages=reports,reviewPatchSHA256=sha((out/'review.patch').read_bytes())),ensure_ascii=False,indent=2),encoding='utf-8')
(out/'INSTALL-MOBILE-QA.md').write_bytes(Path('docs/performance/round2/INSTALL.md').read_bytes())
print(json.dumps(reports,ensure_ascii=False,indent=2))
