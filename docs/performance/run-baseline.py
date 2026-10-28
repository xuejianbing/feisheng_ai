from pathlib import Path
import subprocess,json,time,sys
label=sys.argv[1] if len(sys.argv)>1 else 'baseline'
out=Path('docs/performance/evidence');out.mkdir(parents=True,exist_ok=True)
rows=[]
for p in sorted(Path('tools').glob('test-*.mjs')):
 t=time.perf_counter()
 try:
  r=subprocess.run(['node','--experimental-vm-modules',str(p)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
  (out/(label+'-'+p.stem+'.log')).write_text(r.stdout+r.stderr,encoding='utf-8')
  rows.append(dict(test=p.name,exit=r.returncode,ms=round((time.perf_counter()-t)*1000)))
 except subprocess.TimeoutExpired:rows.append(dict(test=p.name,exit='timeout'))
 print(rows[-1],flush=True)
(out/(label+'-tests.json')).write_text(json.dumps(rows,indent=2),encoding='utf-8')
