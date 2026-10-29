import subprocess
common=['node','docs/performance/chrome-bench.mjs','--host-root',r'C:\Users\32360\Desktop\无名杀-win32-x64\resources\app','--browser',r'C:\Program Files\Google\Chrome\Application\chrome.exe','--playwright',r'C:\Users\32360\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright']
for label,root in [('startup-aa919bb','dist/round2/aa919bb'),('startup-final','.')]:
 with open('docs/performance/round2/'+label+'.log','w',encoding='utf-8')as f:
  r=subprocess.run(common+['--extension-root',root,'--output','docs/performance/round2/'+label+'.json'],stdout=f,stderr=subprocess.STDOUT,timeout=90);print(label,r.returncode,flush=True)
