from pathlib import Path
import subprocess
root=str(Path.cwd());base=r'C:\Users\32360\.codex\worktrees\mobile-performance-443\无名AI'
common=['node','docs/performance/chrome-bench.mjs','--host-root',r'C:\Users\32360\Desktop\无名杀-win32-x64\resources\app','--browser',r'C:\Program Files\Google\Chrome\Application\chrome.exe','--playwright',r'C:\Users\32360\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright']
for label,ext in [('baseline',base),('final',root)]:
 for run in ['cold1','cold2','cold3','slow-db']:
  name=label+'-host-'+run
  args=common+['--extension-root',ext,'--output','docs/performance/evidence/'+name+'.json']+(['--slow-db'] if run=='slow-db' else [])
  with open('docs/performance/evidence/'+name+'.log','w',encoding='utf-8') as out:
   try:r=subprocess.run(args,stdout=out,stderr=subprocess.STDOUT,timeout=110);print(name,r.returncode,flush=True)
   except subprocess.TimeoutExpired:print(name,'timeout',flush=True)
