#!/usr/bin/env node
// 在隔离浏览器中加载完整无名杀宿主；不替换 Player、GameEvent、卡牌内容或触发器。
// 可选参数：--host-root 宿主目录 --browser Chrome路径 --playwright Playwright包路径 --output 报告路径；--autoplay 跑完整托管对局，--manual 跑浏览器点击场景；--cross-mode --mode identity|guozhan|versus 跑原生模式与响应窗口检查
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1];};
const hostMode=option('mode')||'doudizhu';
assert(['doudizhu','identity','guozhan','versus'].includes(hostMode),'unsupported smoke mode');
const repoRoot=fileURLToPath(new URL('../',import.meta.url));
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
            if(relative==='game/config.json'){const config=JSON.parse(data.toString());config.mode=hostMode;config.extensions=[];config.extension_auto_import=false;config.mode_config.doudizhu.doudizhu_mode='normal';config.mode_config.versus.versus_mode='two';config.mode_config.versus.two_assign=false;data=Buffer.from(JSON.stringify(config));}
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
    const errors=[];let startupComplete=false;
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
    // Some native modes show a version notice before character selection.
    if(await page.getByText(/1\.11\.6更新内容/).isVisible())await page.getByText('确定',{exact:true}).click();
    await page.evaluate(()=>{if(realHost._status.paused){realHost._status.auto=false;realHost.ui.click.auto();}});
    await page.waitForFunction(()=>window.smokeReady===true||document.body.innerText.includes('1.11.6更新内容'),{},{timeout:30000});
    if(!await page.evaluate(()=>window.smokeReady===true)){await page.getByText('确定',{exact:true}).click();await page.waitForFunction(()=>window.smokeReady===true,{},{timeout:30000});}
      break;
     }catch(error){
      console.error('[smoke] startup state',JSON.stringify(await page.evaluate(()=>({auto:realHost?._status.auto,paused:realHost?._status.paused,event:realHost?._status.event?.name,player:realHost?._status.event?.player?.name,body:document.body.innerText.slice(-900)})).catch(()=>null)));
      if(startupAttempt>=3)throw error;console.error('[smoke] retry startup after',error.message.slice(0,120));
     }
    }
    startupComplete=true;console.error('[smoke] game initialized');
    if(args.includes('--cross-mode')){
      const {runCrossModeResponseScenes}=await import('./cross-mode-response-host-scenes.mjs');
      const report=await runCrossModeResponseScenes(page,hostMode);
      const result={completedAt:new Date().toISOString(),status:errors.length?'failed':'passed',scope:'实际模式初始化、固定公开局面与原生结算；非完整对局或联机测试',browserVersion:await browser.version(),...report,errors};
      if(option('output'))await fs.writeFile(option('output'),JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));assert.deepEqual(errors,[]);
    }else if(args.includes('--manual')){
      const {runManualIntentScenes}=await import('./manual-intent-host-scenes.mjs');
      const report=await runManualIntentScenes(page);
      const result={completedAt:new Date().toISOString(),status:errors.length?'failed':'passed',scope:'真实宿主固定局面、浏览器点击输入的本地手动用牌验证；非远端联机',browserVersion:await browser.version(),...report,errors};
      if(option('output'))await fs.writeFile(option('output'),JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));assert.deepEqual(errors,[]);
    }else if(args.includes('--autoplay')){
      await page.evaluate(async()=>{
        const {game,lib,_status}=realHost,base='/extension/无名AI/score/decision/';
        const engine=await import(base+'engine/engine.js?v=41a');
        const tactical=await import(base+'strategy/tacticalOptimization.js?v=41a');
        const response=await import(base+'cardplay/responseAI.js?v=41a');
        const soft=await import(base+'safety/aiOverride.js?v=41a');
        const use=await import(base+'override/use.js?v=41a');
        const respond=await import(base+'override/respond.js?v=41a');
        tactical.captureTacticalSettings();tactical.installTacticalOptimization();engine.installHooks();
        soft.installAIOverride();response.installResponseAI();use.installUseOverride();respond.installRespondOverride();
        window.smokeEngine=engine;window.smokeMatch={settings:tactical.tacticalSettingsSnapshot(),startedAt:Date.now(),phases:0,uses:0,done:false,initial:game.players.map(p=>({id:p.playerid,role:p.identity,name:p.name,hp:p.hp}))};
        lib.skill._smokeFullGame={charlotte:true,silent:true,forced:true,popup:false,trigger:{global:['phaseBefore','useCard']},filter:(e,p)=>p===game.me,
          content:async(e,t)=>{if(t.name==='phase'){smokeMatch.phases++;}else smokeMatch.uses++;}};
        game.addGlobalSkill('_smokeFullGame');
        const over=game.over;game.over=function(...args){smokeMatch.done=true;smokeMatch.result=args[0];return over.apply(this,args);};
        game.phaseLoop=window.originalPhaseLoop;const event=game.phaseLoop(...window.smokePhaseArgs);
        game.loop(event).catch(error=>{smokeMatch.error=error.stack||String(error);});
      });
      const deadline=Date.now()+180000;
      while(Date.now()<deadline){
        try{await page.waitForFunction(()=>smokeMatch.done||smokeMatch.error,{},{timeout:20000});break;}
        catch(error){if(!error.message.includes('Timeout'))throw error;console.error('[autoplay]',await page.evaluate(()=>({phases:smokeMatch.phases,uses:smokeMatch.uses,event:realHost._status.event?.name,paused:realHost._status.paused})));}
      }
      const report=await page.evaluate(()=>({...smokeMatch,elapsedMs:Date.now()-smokeMatch.startedAt,hostVersion:realHost.lib.version,mode:realHost.get.mode(),submode:realHost._status.mode,
        decisions:smokeEngine.getDecisionLog().length,overrideStats:realHost._status.djsc_overrideStats,alive:realHost.game.players.map(p=>({role:p.identity,hp:p.hp})),dead:realHost.game.dead.map(p=>({role:p.identity,hp:p.hp}))}));
      const result={completedAt:new Date().toISOString(),status:report.done&&!report.error&&!errors.length&&report.phases>0&&report.uses>0&&report.decisions>0?'passed':'incomplete',scope:'真实斗地主宿主完整托管对局烟测；非胜率或全配置验证',browserVersion:await browser.version(),report,errors};
      if(option('output'))await fs.writeFile(option('output'),JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify(result,null,2));assert.equal(result.status,'passed');assert(report.phases>0&&report.uses>0);assert(report.decisions>0);assert.deepEqual(errors,[]);
    }else{
    const report=await page.evaluate(async()=>{
        const {game,lib,get,_status}=realHost,base='/extension/无名AI/score/';
        const engine=await import(base+'decision/engine/engine.js?v=41a');
        const tactical=await import(base+'decision/strategy/tacticalOptimization.js?v=41a');
        const response=await import(base+'decision/cardplay/responseAI.js?v=41a');
        const {refinedWuxieEffect}=await import(base+'decision/response/wuxieOptimization.js?v=41a');
        tactical.captureTacticalSettings();tactical.installTacticalOptimization();response.installResponseAI();engine.installHooks();
        const lord=game.zhu,farmers=game.players.filter(p=>p!==lord),[holder,actor]=farmers;
        for(const p of game.players)p.clearSkills(true);
        const run=async(name,player,content)=>{const event=game.createEvent(name,false);event.player=player;event.setContent(content);await game.loop(event);};
        const clean=async()=>{for(const p of game.players){const cards=p.getCards('hej');if(cards.length)await p.discard(cards);p.hp=p.maxHp;p.update();}};
        const scenes=[],borrowTrace=[];
        const choose=lib.element.Player.prototype.chooseToUse;
        const responseEval=await import(base+'decision/response/jiedaoResponse.js?v=41a');
        const materials=await import(base+'decision/response/responseMaterials.js?v=41a');
        lib.element.Player.prototype.chooseToUse=function(...args){
          const e=choose.apply(this,args);
          if(this===holder&&_status.event.name==='jiedao'){
            const before=e.ai1;e.ai1=function(item,...rest){const score=before?.call(this,item,...rest),d=responseEval.evaluateJiedaoResponse(holder,e,item);if(borrowTrace.length<24)borrowTrace.push({item:typeof item==='string'?item:item?.name,score,reason:d.reason,action:d.action,sha:d.shaValue,transfer:d.transferValue,skill:e.skill});return score;};
            const before2=e.ai2;e.ai2=function(target,...rest){const score=before2?.call(this,target,...rest);if(borrowTrace.length<24)borrowTrace.push({target:target.playerid,score,skill:e.skill});return score;};
          }
          return e;
        };
        await run('phaseUse',lord,async()=>{
            await clean();await holder.gain(game.createCard('sha','spade',2),'gain2');
            const before={lord:lord.hp,holder:holder.hp};
            await lord.useCard(game.createCard('juedou','spade',12),holder);
            scenes.push({name:'duel-low-rank-sha',before,after:{lord:lord.hp,holder:holder.hp}});
        });
        await run('phaseUse',actor,async()=>{
            await clean();await holder.equip(game.createCard('zhuge'));holder.addSkill('wusheng');
            await holder.gain(game.createCard('shan','heart',4),'gain2');const before=lord.hp;
            const probe={hasSha:holder.hasSha(),skills:holder.getSkills(),materials:materials.responseMaterialOptions(holder,'sha',{use:true,target:lord}).map(o=>({skill:o.skill,cards:o.cards.map(c=>c.name)}))};
            await actor.useCard(game.createCard('jiedao'),[holder,lord]);
            scenes.push({name:'borrow-converted-sha',before,after:lord.hp,keptWeapon:!!holder.getEquip(1),hand:holder.countCards('h'),probe,trace:borrowTrace});holder.removeSkill('wusheng');
        });
        for(const conversion of ['zhangba','longdan'])await run('phaseUse',actor,async()=>{
            await clean();await holder.equip(game.createCard(conversion==='zhangba'?'zhangba':'zhuge'));
            if(conversion==='longdan')holder.addSkill('longdan');
            await holder.gain([game.createCard('shan','spade',4),...(conversion==='zhangba'?[game.createCard('shan','club',6)]:[])],'gain2');
            const before=lord.hp;
            await actor.useCard(game.createCard('jiedao'),[holder,lord]);
            scenes.push({name:'borrow-'+conversion,before,after:lord.hp,keptWeapon:!!holder.getEquip(1),hand:holder.countCards('h')});
            if(conversion==='longdan')holder.removeSkill('longdan');
        });
        await run('phaseUse',actor,async()=>{
            await clean();await holder.equip(game.createCard('baiyin'));await holder.equip(game.createCard('zhuge'));holder.hp=1;holder.update();
            await actor.useCard(game.createCard('guohe'),holder);
            scenes.push({name:'friendly-lion-selection',afterHp:holder.hp,armor:holder.getEquip(2)?.name||null,weapon:holder.getEquip(1)?.name||null});
        });
        const pool=[];
        lib.skill._smokePublicWugu={trigger:{global:'useCardToBefore'},forced:true,silent:true,popup:false,
          filter:(event,p)=>p===game.me&&get.name(event.card)==='wugu',content:async(event,trigger)=>{
            const r=refinedWuxieEffect(holder,{originalSpellId:'wugu',source:trigger.player,target:trigger.target,targets:trigger.targets,effectScope:'target',card:trigger.card,responseEvent:trigger});
            const root=trigger.getParent('useCard'),dialog=realHost.ui.dialogs.find(d=>d.videoId===root.preResult);
            pool.push({target:trigger.target.playerid,remaining:dialog?.buttons?.length??null,resolved:!!r,value:r?.value??null});
        }};game.addGlobalSkill('_smokePublicWugu');
        await run('phaseUse',actor,async()=>{await clean();await actor.useCard({name:'wugu',isCard:true,storage:{fixedShownCards:[game.createCard('tao'),game.createCard('sha'),game.createCard('shan')]}},game.players.slice());});
        scenes.push({name:'public-wugu-pool',picks:pool});game.removeGlobalSkill('_smokePublicWugu');
        return {hostVersion:lib.version,mode:get.mode(),submode:_status.mode,players:game.players.length,settings:tactical.tacticalSettingsSnapshot(),scenes};
    });
    await fs.writeFile('/tmp/trick-real-host-attempt.json',JSON.stringify({report,errors},null,2));
    console.error(JSON.stringify(report));
    const [duel,borrow]=report.scenes;const lion=report.scenes.find(s=>s.name==='friendly-lion-selection'),wugu=report.scenes.find(s=>s.name==='public-wugu-pool');
    assert.equal(report.mode,'doudizhu');assert.equal(report.players,3);
    assert.equal(duel.after.holder,duel.before.holder);assert.equal(duel.before.lord-duel.after.lord,1);
    assert.equal(borrow.before-borrow.after,1);assert.equal(borrow.keptWeapon,true);assert.equal(borrow.hand,0);
    for(const name of ['borrow-zhangba','borrow-longdan']){const s=report.scenes.find(s=>s.name===name);assert.equal(s.before-s.after,1);assert.equal(s.keptWeapon,true);assert.equal(s.hand,0);}
    assert.equal(lion.armor,null);assert.equal(lion.afterHp,2);assert.equal(lion.weapon,'zhuge');
    assert.equal(wugu.picks.length,3);assert.deepEqual(wugu.picks.map(p=>p.remaining),[3,2,1]);assert(wugu.picks.every(p=>p.resolved));
    assert.deepEqual(errors,[]);
    const result={completedAt:new Date().toISOString(),status:'passed',scope:'真实斗地主宿主固定场景；非完整自动对局或胜率验证',setup:'隔离浏览器、只读宿主、映射工作区生产模块；原生Player/GameEvent和牌内容未替换',browserVersion:await browser.version(),...report};
    if(option('output'))await fs.writeFile(option('output'),JSON.stringify(result,null,2)+'\n','utf8');
    console.log(JSON.stringify(result,null,2));
    }
} catch(error){
    if(args.includes('--manual')&&debugPage){console.error('[manual failure state]',JSON.stringify(await debugPage.evaluate(()=>({scene:manualHarness?.scene,done:manualHarness?.done,error:manualHarness?.error,uses:manualHarness?.uses,traces:manualHarness?.traces,auto:realHost._status.auto,paused:realHost._status.paused,event:{name:realHost._status.event?.name,type:realHost._status.event?.type,player:realHost._status.event?.player?.dataset?.manualRole,parent:realHost._status.event?.parent?.name}})).catch(()=>null)));}
    if(debugPage){await debugPage.screenshot({path:'/tmp/trick-real-host-failure.png'}).catch(()=>{});console.error(await debugPage.evaluate(()=>document.body.innerText.slice(0,2500)).catch(()=>''));}
    throw error;
} finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
}
