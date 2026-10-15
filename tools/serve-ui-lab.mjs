#!/usr/bin/env node
/*
 * 无名AI · 更新弹窗实测台静态服务器（仅本机调试用，不参与游戏运行）
 * 用法：node tools/serve-ui-lab.mjs  →  http://127.0.0.1:8765/tools/ui-lab.html
 *
 * 以扩展根目录为根，供 tools/ui-lab.html（设备矩阵）与 tools/ui-harness.html
 * （本体 CSS 干扰复现页）在浏览器中通过 http 同源加载（file:// 下 iframe 跨源受限）。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8765;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1');
        let p = decodeURIComponent(url.pathname);
        if (p === '/' || p === '') p = '/tools/ui-lab.html';
        const file = normalize(join(ROOT, p));
        if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
    } catch (e) {
        res.writeHead(404); res.end('not found');
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log('ui-lab server ready: http://127.0.0.1:' + PORT + '/tools/ui-lab.html');
});
