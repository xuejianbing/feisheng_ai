import subprocess
from pathlib import Path
common=['node','docs/performance/round2/host.mjs','--mode','versus','--diagnose','--timeout','25000','--host-root',r'C:\Users\32360\Desktop\无名杀-win32-x64\resources\app','--browser',r'C:\Program Files\Google\Chrome\Application\chrome.exe','--playwright',r'C:\Users\32360\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright']
for label,root in [('official-controlled',r'C:\Users\32360\.codex\worktrees\mobile-performance-443\无名AI'),('qa-controlled','dist/round2/aa919bb'),('fixed-controlled','.')]:
 with open('docs/performance/round2/'+label+'.log','w',encoding='utf-8')as f:
  r=subprocess.run(common+['--extension-root',root,'--output','docs/performance/round2/'+label+'.json'],stdout=f,stderr=subprocess.STDOUT,timeout=100);print(label,r.returncode,flush=True)
