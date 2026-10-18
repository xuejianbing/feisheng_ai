#!/usr/bin/env node
// 在隔离浏览器中加载完整无名杀宿主；不替换 Player、GameEvent、卡牌内容或触发器。
// 可选参数：--host-root 宿主目录 --browser Chrome路径 --playwright Playwright包路径 --output 报告路径
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1];};
const repoRoot=fileURLToPath(new URL('../',import.meta.url));
const hostRoot=path.resolve(option('host-root') || path.join(repoRoot,'../..'));
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
        const filename=path.resolve(hostRoot,relative);
        if(filename!==hostRoot && !filename.startsWith(hostRoot+path.sep)){res.writeHead(403);res.end();return;}
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
            res.setHeader('Content-Type',mime[path.extname(filename)] || 'application/octet-stream');
            res.setHeader('Cache-Control','no-store');res.end(data);
        }
    } catch {res.writeHead(404);res.end();}
});

let browser;
try {
    await fs.access(path.join(hostRoot,'noname.js'));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,...(option('browser')?{executablePath:option('browser')}:{})});
    const context=await browser.newContext();
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',async dialog=>{
        if(dialog.message().includes('GPLv3'))await dialog.accept();
        else {errors.push(dialog.message());await dialog.dismiss();}
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
    await page.getByText('跳过向导',{exact:true}).waitFor({timeout:60000});
    await page.evaluate(async()=>{
        window.realHost=await import('/noname.js');
        const {game,lib,_status}=realHost;
        // 正常身份局完成选将/发牌后停住自动回合，再执行确定性场景。
        game.phaseLoop=function(){window.smokeReady=true;};
        lib.config.animation=false;lib.config.duration=0;lib.config.game_speed='vvfast';_status.auto=true;
    });
    await page.getByText('跳过向导',{exact:true}).click();
    await page.waitForFunction(()=>window.smokeReady===true,{},{timeout:60000});
    const report=await page.evaluate(async()=>{
        const {game,lib}=realHost;
        const base='/extension/无名AI/score/';
        const engine=await import(base+'decision/engine/engine.js?v=41a');
        const ledger=await import(base+'perception/observer/identityEvidence.js?v=41a');
        const identity=await import(base+'perception/observer/identity.js?v=41a');
        const relations=await import(base+'decision/relations/relations.js?v=41a');
        engine.installHooks();
        const lord=game.zhu,actor=game.players.find(p=>p.identity==='zhong');
        // 清技能/手牌只用于固定输入，事件及卡牌结算仍由完整宿主执行。
        for(const p of game.players)p.clearSkills(true);
        const run=async(name,player,content)=>{const event=game.createEvent(name,false);event.player=player;event.setContent(content);await game.loop(event);};
        await run('identitySmokeSetup',actor,async()=>{for(const p of game.players){const cards=p.getCards('hej');if(cards.length)await p.discard(cards);}});
        const scenes=[];
        const snapshot=extra=>({...extra,...ledger.identityEvidenceReport()});
        const beforeHp=lord.hp;
        await run('phaseUse',actor,async()=>{
            await actor.gain(game.createCard('sha'),'gain2');identity.resetBelief();
            await actor.chooseToUse({type:'phase',filterCard:c=>c.name==='sha',filterTarget:(c,p,t)=>t===lord,selectTarget:1,ai1:()=>10,ai2:t=>t===lord?10:0});
        });
        scenes.push(snapshot({scene:'sha',beforeHp,afterHp:lord.hp}));
        const attacker=game.players.find(p=>p.identity==='fan');
        await run('phaseUse',attacker,async()=>{
            await actor.gain(game.createCard('tao'),'gain2');lord.hp=1;lord.update();identity.resetBelief();
            await attacker.useCard(game.createCard('sha'),lord);
        });
        scenes.push(snapshot({scene:'tao-rescue',afterHp:lord.hp,alive:game.players.includes(lord)}));
        await run('phaseUse',actor,async()=>{
            await lord.addJudge(game.createCard('lebu'));await actor.gain(game.createCard('guohe'),'gain2');identity.resetBelief();
            await actor.chooseToUse({type:'phase',filterCard:c=>c.name==='guohe',filterTarget:(c,p,t)=>t===lord,selectTarget:1,ai1:()=>10,ai2:t=>t===lord?10:0});
        });
        scenes.push(snapshot({scene:'remove-lebu',remainingJudges:lord.getCards('j').map(c=>c.name)}));
        const victim=attacker;
        let beforeExposure;
        await run('phaseUse',actor,async()=>{
            victim.hp=1;victim.update();identity.resetBelief();beforeExposure=relations.exposureOf(actor,victim);
            await actor.useCard(game.createCard('sha'),victim);
        });
        scenes.push(snapshot({scene:'death',beforeExposure,afterExposure:relations.exposureOf(actor,victim),inDead:game.dead.includes(victim),hostShown:victim.identityShown,revealedRole:victim.__djsc_revealedRole}));
        return {hostVersion:lib.version,triggerNames:lib.skill._djsc_identityEvidence.trigger.global,scenes};
    });
    const [sha,rescue,remove,death]=report.scenes;
    assert.equal(sha.beforeHp-sha.afterHp,1);
    assert.deepEqual(sha.events.map(e=>e.actionKind),['damage','useCard']);
    assert.equal(sha.events[0].actualPublicDeltas.damage,1);
    assert.equal(sha.evidence.length,1);
    assert.equal(rescue.alive,true);assert.equal(rescue.afterHp,1);
    assert.equal(rescue.events.length,4);assert.equal(rescue.evidence.length,2);
    const heal=rescue.events.find(e=>e.actionKind==='recover');
    const damage=rescue.events.find(e=>e.actionKind==='damage');
    assert.equal(heal.actualPublicDeltas.healing,1);assert.equal(heal.semantics,'benefit');assert.equal(heal.agency,'chosen');
    assert.notEqual(heal.rootActionId,damage.rootActionId);
    assert.deepEqual(remove.remainingJudges,[]);assert.equal(remove.events.length,1);
    assert.equal(remove.events[0].actualPublicDeltas.removedNegativeJudges,1);
    assert.equal(remove.evidence.length,1);assert.equal(remove.evidence[0].semantics,'benefit');
    assert.equal(death.beforeExposure.shown,false);assert.equal(death.inDead,true);
    assert.equal(death.revealedRole,'fan');assert.equal(death.afterExposure.shown,true);
    assert.equal(death.afterExposure.known,1);assert.equal(death.afterExposure.source,'dead_id');
    assert.deepEqual(death.events.map(e=>e.actionKind).sort(),['damage','die','useCard']);
    assert.equal(new Set(death.events.map(e=>e.rootActionId)).size,1);assert.equal(death.evidence.length,1);
    for(const scene of report.scenes){
        assert.equal(new Set(scene.events.map(e=>e.eventId)).size,scene.events.length);
        assert(scene.events.every(e=>e.agency==='chosen'));
        assert.equal(scene.stats.duplicates,0);assert.equal(scene.stats.truncated,false);
    }
    assert.deepEqual(errors,[]);
    const result={completedAt:new Date().toISOString(),status:'passed',scope:'真实宿主固定场景集成验证；非完整自动对局、胜率或校准验收',setup:'隔离浏览器上下文、只读文件接口；正常标准八人身份局初始化后停住自动回合并清理技能/手牌；手动安装生产 engine.installHooks；不手动调用证据钩子',browserVersion:await browser.version(),...report};
    if(option('output'))await fs.writeFile(option('output'),JSON.stringify(result,null,2)+'\n','utf8');
    console.log(JSON.stringify({status:result.status,hostVersion:report.hostVersion,scenes:report.scenes.map(s=>({scene:s.scene,events:s.events.length,evidenceGroups:s.evidence.length}))},null,2));
} finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
}
