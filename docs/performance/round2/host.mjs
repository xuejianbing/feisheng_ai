#!/usr/bin/env node
// 在隔离浏览器中加载完整无名杀宿主；不替换 Player、GameEvent、卡牌内容或触发器。
// 可选参数：--host-root 宿主目录 --browser Chrome路径 --playwright Playwright包路径 --output 报告路径；--autoplay 跑完整托管对局，--manual 跑浏览器点击场景
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1];};
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const hostRoot=path.resolve(option('host-root') || path.join(repoRoot,'../..'));
const extensionRoot=path.resolve(option('extension-root')||repoRoot);
const require=createRequire(import.meta.url);
const {chromium}=require(option('playwright') || 'playwright');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.ts':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const apiRoutes=new Set(['/checkFile','/checkDir','/getFileList','/readFile','/readFileAsText']);
// 仅为宿主 BrowserAdapter 提供只读文件接口；浏览器配置/IndexedDB 使用临时上下文。
const server=http.createServer(async(req,res)=>{
    try {
        const url=new URL(req.url,'http://localhost');
        const api=apiRoutes.has(url.pathname);
        const relative=api?url.searchParams.get('fileName') || url.searchParams.get('dir') || '':decodeURIComponent(url.pathname).replace(/^\//,'');
        const extensionPrefix='extension/无名AI/';
        const selectedRoot=relative.startsWith(extensionPrefix)?extensionRoot:hostRoot;
        const selectedPath=relative.startsWith(extensionPrefix)?relative.slice(extensionPrefix.length):relative;
        const filename=path.resolve(selectedRoot,selectedPath);
        // Never import the installed game's saved user configuration into the test context.
        if(path.basename(filename)==='noname.config.txt'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:null}));return;}
        if(filename!==selectedRoot && !filename.startsWith(selectedRoot+path.sep)){res.writeHead(403);res.end();return;}
        if(req.method!=='GET'){res.writeHead(405);res.end();return;}
        let data;
        if(api){
            if(url.pathname==='/checkFile' || url.pathname==='/checkDir'){
                const stat=await fs.stat(filename).catch(()=>null);
                data=stat?(stat.isFile()?'file':'directory'):null;
            } else if(url.pathname==='/getFileList'){
                const entries=await fs.readdir(filename,{withFileTypes:true});
                data={folders:entries.filter(e=>e.isDirectory()).map(e=>e.name),files:entries.filter(e=>e.isFile()).map(e=>e.name)};
            } else {
                const bytes=await fs.readFile(filename);
                data=url.pathname==='/readFileAsText'?bytes.toString('utf8'):Array.from(bytes);
            }
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data}));
        } else {
            data=await fs.readFile(filename);
            if(selectedPath==='noname/game/index.js')data=Buffer.from(data.toString().replace('phaseLoop(player) {',"phaseLoop(player) { if(!window.smokeReady){window.originalPhaseLoop=this.phaseLoop;window.smokePhaseArgs=[player];window.smokeReady=true;return;}"));
            if(selectedPath==='score/decision/engine/engine.js'){
              let code=data.toString().replace('_finalResult.phaseMs = _phaseMs;', '_finalResult.phaseMs = _phaseMs;window.probePhases=window.probePhases||[];window.probePhases.push({ms:_decisionMs,phases:{..._phaseMs}});if(window.probePhases.length>60)window.probePhases.shift();');const a=code.indexOf('function bestAction() {'),b=code.indexOf('function bestActionCore');
              let part=code.slice(a,b),last=part.lastIndexOf('}');part=part.slice(0,last)+'} finally { window.__round2Active--; }'+part.slice(last);
              part=part.replace('function bestAction() {','function bestAction() { window.__round2Active=(window.__round2Active||0)+1;window.round2Depth=Math.max(window.round2Depth||0,window.__round2Active);try {');
              data=Buffer.from(code.slice(0,a)+part+code.slice(b));
            }
            if(args.includes('--diagnose')&&selectedPath==='score/model/net/modelGuard.js'){data=Buffer.from(data.toString().replace("console.warn('[guard] 护栏检查异常：' + e.message)","console.warn('[guard] 护栏检查异常：' + e.message);if(!window.round2Stack){window.round2Stack=e.stack;console.error('ROUND2_STACK '+e.stack)}"));}
            if(relative==='game/config.json'){const config=JSON.parse(data.toString());config.mode=option('mode')||'doudizhu';config.extensions=[];config.extension_auto_import=false;config.mode_config.doudizhu={doudizhu_mode:'normal'};config.mode_config.versus={versus_mode:'two'};data=Buffer.from(JSON.stringify(config));}
            res.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
            res.setHeader('Cache-Control','no-store');res.end(data);
        }
    } catch {res.writeHead(404);res.end();}
});

let browser,debugPage;
try {
    await fs.access(path.join(hostRoot,'noname.js'));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,...(option('browser')?{executablePath:option('browser')}:{})});
    const context=await browser.newContext();
    await context.addInitScript(()=>{let seed=443;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);Error.stackTraceLimit=100;});
    await context.route('**/*',route=>{const url=new URL(route.request().url());return ['http:','https:'].includes(url.protocol)&&!(url.hostname==='127.0.0.1'&&Number(url.port)===server.address().port)?route.abort():route.continue();});
    const page=await context.newPage();debugPage=page;
    console.error("[smoke] browser ready");
    let consoleCount=0,guardErrors=0;const missingExtension=[];
    const errors=[];let startupComplete=false; page.on('console',m=>{if(m.text().includes('Maximum call stack'))guardErrors++;if(consoleCount++<200)console.error('[browser-console]',m.type(),m.text());}); page.on('requestfailed',r=>console.error('[requestfailed]',r.url(),r.failure()?.errorText));
    page.on('response',r=>{if(r.status()>=400&&decodeURI(r.url()).includes('/extension/无名AI/'))missingExtension.push({url:r.url(),status:r.status()});});
    page.on('pageerror',error=>{errors.push(error.message);console.error('[host-error]',error.stack);});
    page.on('dialog',async dialog=>{
        const license=dialog.message().includes('GPLv3');
        try{if(license)await dialog.accept();else{errors.push(dialog.message());await dialog.dismiss();}}
        catch(error){
          // License acceptance may navigate and detach the startup document.
          // Startup must still reach a real initialized game below.
          if(!license||startupComplete)errors.push(error.message);
        }
    });
    for(let gameIndex=0;gameIndex<Number(option('games')||1);gameIndex++){
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
    for(let startupAttempt=0;;startupAttempt++){
     try{
    await page.waitForFunction(async()=>!!(await import('/noname.js')).lib.config?.mode_config,{},{timeout:30000});
    await page.evaluate(async()=>{
        window.realHost=await import('/noname.js');
        for(let i=0;i<400&&!window.realHost.lib.config;i++)await new Promise(r=>setTimeout(r,50));
        const {game,lib,_status}=window.realHost;
        if(!lib.config)throw Error('host-config-not-ready');
        window.originalPhaseLoop ||= game.phaseLoop;
        game.phaseLoop=function(...args){window.smokePhaseArgs=args;window.smokeReady=true;};
        lib.config.animation=false;lib.config.duration=0;lib.config.game_speed='vvfast';_status.auto=true;
    });
    console.error('[smoke] phase hook ready');
    if(await page.getByText('跳过向导',{exact:true}).isVisible())await page.getByText('跳过向导',{exact:true}).click();
    await page.evaluate(()=>{realHost._status.auto=false;realHost.ui.click.auto();});
    await page.waitForFunction(()=>window.smokeReady===true,{},{timeout:30000});
      break;
     }catch(error){if(startupAttempt>=3)throw error;console.error('[smoke] retry startup after',error.message.slice(0,120));}
    }
    startupComplete=true;console.error('[smoke] game initialized');


    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(option('cpu')||1)});
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    await page.evaluate(async()=>{
      window.probeLongs=[];new PerformanceObserver(l=>{window.probeLongs.push(...l.getEntries().map(e=>({ms:e.duration,start:e.startTime})));window.probeLongs=window.probeLongs.slice(-160);}).observe({type:'longtask'});
      localStorage.setItem('__ai_reason_shadow_off','1');
      if(realHost.get.mode()==='versus')realHost.game.players.forEach((p,i)=>{p.init(['jiakui','dc_sunchen','pe_yangyuhuan','sunlang'][i]);for(const c of p.getCards('h'))c.remove();p.directgain([['jiedao','sha','qinggang','tiesuo'],['shan','sha','shunshou','bingliang'],['shan','wuzhong','zhuge','tiesuo'],['bagua','shan','sha','dawan']][i].map(n=>realHost.game.createCard(n,'spade',7)));});
      const ext=await import('/extension/无名AI/extension.js');await ext.default.content({},{});
      window.smokeMatch={initial:realHost.game.players.map(p=>({name:p.name,side:p.side,seat:p.getSeatNum?.(),hand:p.getCards('h').map(c=>c.name)})),done:false,startedAt:Date.now(),phases:0,uses:0};
      const {game,lib}=realHost;
      lib.skill._smokeFullGame={charlotte:true,silent:true,forced:true,popup:false,trigger:{global:['phaseBefore','useCard']},filter:(e,p)=>p===game.me,content:async(e,t)=>{if(t.name==='phase')smokeMatch.phases++;else smokeMatch.uses++;}};
      game.addGlobalSkill('_smokeFullGame');const over=game.over;game.over=function(...args){smokeMatch.done=true;smokeMatch.result=args[0];return over.apply(this,args);};
      game.phaseLoop=window.originalPhaseLoop;const event=game.phaseLoop(...window.smokePhaseArgs);game.loop(event).catch(e=>smokeMatch.error=String(e.stack||e));
    });
    try{await page.waitForFunction(()=>smokeMatch.done||smokeMatch.error,{},{timeout:Number(option('timeout')||180000)});}catch(e){errors.push(e.message);}
    const result=await page.evaluate(()=>({...smokeMatch,stack:window.round2Stack||null,maxDepth:window.round2Depth||null,probeLongs:window.probeLongs||[],probePhases:window.probePhases||[],heap:performance.memory?.usedJSHeapSize,resources:performance.getEntriesByType('resource').length,hostVersion:realHost.lib.version,mode:realHost.get.mode(),submode:realHost._status.mode,perf:window.__DJSC.perfReport(),overrideStats:realHost._status.djsc_overrideStats,alive:realHost.game.players.length,dead:realHost.game.dead.length}));
    const cpuProfile=(await cdp.send('Profiler.stop')).profile;await fs.writeFile(option('output').replace('.json','-cpu.json'),JSON.stringify(cpuProfile));
    result.elapsedMs=Date.now()-result.startedAt;result.guardErrors=guardErrors;result.missingExtension=missingExtension;result.errors=errors;result.browser=await browser.version();result.status=result.done&&!result.error?'completed':'incomplete';
    await fs.writeFile(Number(option('games')||1)>1?option('output').replace('.json','-g'+gameIndex+'.json'):option('output'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    }
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
