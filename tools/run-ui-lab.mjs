#!/usr/bin/env node
/*
 * 无名AI · 更新弹窗实测台（headless Chromium 驱动，零依赖 CDP）
 * 前置：node tools/serve-ui-lab.mjs（默认 8765 端口）
 * 运行：node tools/run-ui-lab.mjs
 *
 * 流程：
 *   1) 启动 headless Chrome/Edge（远程调试端口 9223）
 *   2) 打开 tools/ui-lab.html，等待 6 组"设备尺寸 × 本体缩放"几何断言跑完
 *   3) 按不同设备尺寸截取真实场景（安装完成弹窗 / 长文本滚动 / 进度浮层）
 *   结果写入 tools/.ui-lab-shots/ui-lab-result.json，退出码 0/1。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTTP_PORT = Number(process.argv[2]) || 8765;
const LEGACY = process.argv.includes('--legacy');
const CDP_PORT = Number(process.env.CDP_PORT) || 9223;
const OUT_DIR = fileURLToPath(new URL('./.ui-lab-shots/', import.meta.url));
const PROFILE_DIR = fileURLToPath(new URL('./.chrome-profile/', import.meta.url));

const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chromePath = candidates.find(p => existsSync(p));
if (!chromePath) { console.error('未找到 Chrome / Edge 可执行文件'); process.exit(2); }

mkdirSync(OUT_DIR, { recursive: true });
try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) {}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE_DIR, '--window-size=1500,1000', 'about:blank',
], { stdio: 'ignore' });

const getTarget = async () => {
    for (let i = 0; i < 80; i++) {
        try {
            const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list');
            const list = await res.json();
            const page = list.find(t => t.type === 'page');
            if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch (e) {}
        await sleep(250);
    }
    throw new Error('CDP 未就绪（端口 ' + CDP_PORT + '）');
};

const connect = url => new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map(); const listeners = []; let seq = 0;
    ws.onopen = () => resolve({
        send(method, params) {
            return new Promise((res, rej) => {
                const id = ++seq;
                pending.set(id, { res, rej });
                ws.send(JSON.stringify({ id, method, params: params || {} }));
            });
        },
        on(fn) { listeners.push(fn); },
        close() { try { ws.close(); } catch (e) {} },
    });
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
    ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id); pending.delete(msg.id);
            if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
        } else if (msg.method) listeners.forEach(fn => fn(msg));
    };
});

const evalIn = async (cdp, expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r && r.result ? r.result.value : undefined;
};

const waitLoad = cdp => new Promise(resolve => {
    const timer = setTimeout(resolve, 10000);
    cdp.on(msg => { if (msg.method === 'Page.loadEventFired') { clearTimeout(timer); resolve(); } });
});

const shot = async (cdp, name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(OUT_DIR + name, Buffer.from(r.data, 'base64'));
    console.log('  截图 → tools/.ui-lab-shots/' + name);
};

(async () => {
    let cdp = null;
    try {
        const wsUrl = await getTarget();
        cdp = await connect(wsUrl);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        /* 1) 六组"设备尺寸 × 本体缩放"矩阵（iframe 内为复现的本体 CSS 干扰环境） */
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        let loaded;
        if (LEGACY) {
            /* --legacy：证伪对照——同一套断言作用于"修复前快照"，应出现大量失败（旧实现缺陷复现） */
            loaded = waitLoad(cdp);
            await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/tools/ui-harness.html?src=legacy' });
            await loaded;
            const legacyRaw = await evalIn(cdp, '(async () => { for (let i = 0; i < 60; i++) { if (window.__uiReady) break; await new Promise(r => setTimeout(r, 100)); } const run = window.__runSuite(1).then(r => r).catch(e => ({ error: String(e && e.message) })); const out = await Promise.race([run, new Promise(r => setTimeout(() => r(null), 10000))]); const live = window.__suiteLive || []; const fails = live.filter(x => !x.ok); return JSON.stringify({ finished: !!(out && !out.error && out !== null), stuck: out === null, total: live.length, failCount: fails.length, firstFails: fails.slice(0, 4).map(f => f.name) }); })()');
            const legacy = JSON.parse(legacyRaw || 'null');
            console.log('证伪对照（修复前快照）：', JSON.stringify(legacy));
            child.kill();
            setTimeout(() => process.exit(legacy && legacy.failCount > 0 ? 0 : 1), 300);
            return;
        }
        loaded = waitLoad(cdp);
        await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/tools/ui-lab.html' });
        await loaded;
        const labRaw = await evalIn(cdp, '(async () => { for (let i = 0; i < 400; i++) { if (window.__labState && window.__labState.done) break; await new Promise(r => setTimeout(r, 250)); } return JSON.stringify(window.__labState || null); })()');
        const labState = JSON.parse(labRaw || 'null');
        writeFileSync(OUT_DIR + 'ui-lab-result.json', JSON.stringify(labState, null, 2));
        if (labState && labState.results) {
            console.log('矩阵结果：');
            labState.results.forEach(r => console.log('  ' + (r.cfg.w + '×' + r.cfg.h + ' @zoom ' + r.cfg.zoom).padEnd(24)
                + (r.ok ? ('✓ ' + r.total + ' 项全过') : ('✗ ' + r.fails.length + ' 项失败: ' + r.fails.join(' / ')))));
        } else {
            console.log('矩阵结果缺失');
        }
        await shot(cdp, 'lab-matrix.png');

        /* 2) 真实场景视觉截图（毛玻璃外观 / 长文本滚动 / 进度浮层） */
        const scenes = [
            { name: 'scene-open-android915-zoom075.png', w: 915, h: 412, url: 'ui-harness.html?auto=open&zoom=0.75' },
            { name: 'scene-long-800x360.png', w: 800, h: 360, url: 'ui-harness.html?auto=long' },
            { name: 'scene-progress-915x412.png', w: 915, h: 412, url: 'ui-harness.html?auto=progress' },
        ];
        for (const s of scenes) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: true });
            loaded = waitLoad(cdp);
            await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + HTTP_PORT + '/tools/' + s.url });
            await loaded;
            await evalIn(cdp, '(async () => { for (let i = 0; i < 60; i++) { if (window.__uiReady) break; await new Promise(r => setTimeout(r, 100)); } await new Promise(r => setTimeout(r, 400)); return true; })()');
            await shot(cdp, s.name);
        }

        cdp.close();
        const allOk = !!(labState && labState.allOk);
        console.log(allOk ? '=== UI-LAB ALL OK ===' : '=== UI-LAB FAILED ===');
        child.kill();
        setTimeout(() => process.exit(allOk ? 0 : 1), 300);
    } catch (e) {
        console.error('run-ui-lab 失败:', (e && e.message) || e);
        try { if (cdp) cdp.close(); } catch (e2) {}
        try { child.kill(); } catch (e2) {}
        process.exit(2);
    }
})();
