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
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
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
            if(relative==='game/config.json'){const config=JSON.parse(data.toString());config.mode='doudizhu';config.extensions=[];config.extension_auto_import=false;config.mode_config.doudizhu={doudizhu_mode:'normal'};data=Buffer.from(JSON.stringify(config));}
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
    await context.route('**/*',route=>{const url=new URL(route.request().url());return ['http:','https:'].includes(url.protocol)&&!(url.hostname==='127.0.0.1'&&Number(url.port)===server.address().port)?route.abort():route.continue();});
    const page=await context.newPage();debugPage=page;
    console.error("[smoke] browser ready");
    const errors=[];let startupComplete=false; page.on('console',m=>console.error('[browser-console]',m.type(),m.text())); page.on('requestfailed',r=>console.error('[requestfailed]',r.url(),r.failure()?.errorText));
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
    await page.evaluate(()=>{if(realHost._status.paused){realHost._status.auto=false;realHost.ui.click.auto();}});
    await page.waitForFunction(()=>window.smokeReady===true,{},{timeout:30000});
      break;
     }catch(error){if(startupAttempt>=3)throw error;console.error('[smoke] retry startup after',error.message.slice(0,120));}
    }
    startupComplete=true;console.error('[smoke] game initialized');

    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
    await cdp.send('Performance.enable');
    const result=await page.evaluate(async(slow)=>{
      performance.clearResourceTimings();performance.setResourceTimingBufferSize(3000);
      const longs=[];const observer=new PerformanceObserver(l=>longs.push(...l.getEntries().map(e=>({start:e.startTime,ms:e.duration}))));observer.observe({type:'longtask'});
      if(slow){const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(...args){const req=open(...args);if(args[0]!=='djsc_mode_models_v1')return req;return new Proxy(req,{get(t,k){return Reflect.get(t,k,t);},set(t,k,v){t[k]=k==='onsuccess'?(...a)=>setTimeout(()=>v(...a),8500):v;return true;}});};}
      localStorage.setItem('__ai_reason_shadow_off','1');
      const start=performance.now();
      const ext=await import('/extension/无名AI/extension.js');
      const imported=performance.now();
      await ext.default.content({},{});
      const content=performance.now();
      await new Promise(r=>setTimeout(r,2500));
      const panelMs=[];for(let i=0;i<2;i++){const t=performance.now();await window.__DJSC.openChampionPanel();panelMs.push(performance.now()-t);}
      return {panelMs,importMs:imported-start,contentMs:content-imported,totalMs:content-start,report:window.__DJSC.perfReport(),resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/extension/')).map(r=>({name:r.name.split('/extension/')[1],duration:r.duration})),heap:performance.memory?.usedJSHeapSize,longs};
    },args.includes('--slow-db'));
    result.metrics=(await cdp.send('Performance.getMetrics')).metrics;
    result.browser=await browser.version();result.cpuRate=6;result.kind='Chrome desktop approximation; host initialized before extension import';
    await fs.writeFile(option('output'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({importMs:result.importMs,contentMs:result.contentMs,totalMs:result.totalMs,resources:result.resources.length}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
