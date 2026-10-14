
/* ===== 版本号校验（功能层面防盗） ===== */
const _fs_version = VERSION;
const _fs_author = '\x98de\x5347\x539f\x521b';

try {
    const decoded_ver = _fs_version;
    const decoded_author = _fs_author;
    console.log('%c[无名AI] 版本: ' + decoded_ver + ' | 作者: ' + decoded_author, 'color: #00d4ff;');
} catch(e) {
    console.warn('[无名AI] 版本校验失败，请确认是官方版本');
}
/* ==================================== */

// ===== 隐藏水印（不影响功能） =====
const __AUTHOR__ = "飞升原创";
const __CONTACT__ = "交流群: 1080487560";
const __VERSION__ = "v" + VERSION;
// ====================================
/*
 * ============================================
 * // Wydawca: Feisheng Original
 * 交流群: 1080487560
 * v4.0.19
 * 版权所有，侵权必究
 * ============================================
 */

import { modeModelsReady } from './score/model/weights/modeModelStore.js?v=5e5';
import { mountPanels } from './score/foundation/diag/panelLoader.js?v=5e5';
window.__DJSC = window.__DJSC || {};
// Inspectable readiness promise for browser/host release checks.
window.__DJSC.panelsReady = mountPanels(window.__DJSC).then(function (report) {
    window.__DJSC.panelLoadStatus = report;
    if (report.ok) console.log('[无名AI] 所有' + report.total + '个面板挂载完成');
    else console.warn('[无名AI] 面板挂载 ' + report.loaded + '/' + report.total + '：', report.panels.filter(p => !p.ok));
    return report;
});

// ===== 在线更新检查（直接写在这里，避免导入问题）=====
const _CURRENT_VER = 'α4.1.0';
const _UPDATE_URL = 'https://data.feiqiaoai.uno/update/check';
const _UPDATE_DOWNLOAD_URL = 'https://data.feiqiaoai.uno/update/download';
const _UPDATE_CHECK_TS = 'djsc_update_check_ts';
/* ★ 版本比较（语义化）：'α1.0.4.1' → [1,0,4,1] 逐段数值比较。
 *   旧实现用 !== —— 本地版本比服务器新（开发自打包）时会弹"降级"更新框，已修。 */
function _verKey(v) {
    try {
        const s = String(v || '').trim().replace(/^α/, '').replace(/^a/i, '');
        const parts = s.split('.').map(function (x) { return parseInt(x, 10) || 0; });
        while (parts.length < 4) parts.push(0);
        return parts.slice(0, 4);
    } catch (e) { return null; }
}
function _verGreater(remote, local) {
    const a = _verKey(remote), b = _verKey(local);
    if (!a || !b) return String(remote || '') !== String(local || '');
    for (let i = 0; i < 4; i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
}
/* ★ 检查入口：manual=false 启动自动检查（6 小时节流，失败也记时防轰炸）；
 *   manual=true 手动检查（面板/控制台调用），无论结果都给反馈。 */
function _checkUpdateOnce(manual) {
    try {
        if (typeof fetch !== 'function') {
            if (manual) _styledDialog({ title: '检查失败', message: '当前环境不支持 fetch 网络请求。\n\n可用浏览器打开：\n' + _UPDATE_DOWNLOAD_URL });
            return;
        }
        const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
        const timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (eT) {} }, 12000) : null;
        fetch(_UPDATE_URL, ctl ? { signal: ctl.signal } : undefined)
            .then(function (r) {
                if (timer) clearTimeout(timer);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                try { localStorage.setItem(_UPDATE_CHECK_TS, String(Date.now())); } catch (eS) {}
                console.log('[无名AI更新] 当前: ' + _CURRENT_VER + ', 最新: ' + (data && data.version));
                if (data && data.version && _verGreater(data.version, _CURRENT_VER)) {
                    _showUpdateDialog(data);
                } else if (manual) {
                    _styledDialog({ title: '检查完成', message: '当前已是最新版本：' + _CURRENT_VER + '\n\n服务器版本：' + ((data && data.version) || '未知') });
                }
            })
            .catch(function (e) {
                if (timer) clearTimeout(timer);
                try { localStorage.setItem(_UPDATE_CHECK_TS, String(Date.now())); } catch (eS2) {}
                console.log('[无名AI更新] 检查失败: ' + (e && e.message || e));
                if (manual) _styledDialog({ title: '检查失败', message: '原因：' + (e && e.message || e) + '\n\n请稍后重试，或用浏览器打开：\n' + _UPDATE_DOWNLOAD_URL });
            });
    } catch (e) {
        console.log('[无名AI更新] 启动失败: ' + (e && e.message || e));
        if (manual) { try { _styledDialog({ title: '检查失败', message: String(e && e.message || e) }); } catch (eM) {} }
    }
}
try {
    let _lastTs = 0;
    try { _lastTs = parseInt(localStorage.getItem(_UPDATE_CHECK_TS) || '0', 10) || 0; } catch (eL) {}
    if (Date.now() - _lastTs > 6 * 3600 * 1000) _checkUpdateOnce(false);
} catch (eAuto) {}
/* 手动检查入口（控制台：__DJSC.updateCheck()；后续面板可挂按钮） */
if (typeof window !== 'undefined') {
    window.__DJSC = window.__DJSC || {};
    window.__DJSC.updateCheck = function () { _checkUpdateOnce(true); };
}

/* ===== 统一风格弹窗参数（与 score/view/panel/panelTheme.js styleUtilityPanel + AIjinjiang.css 按钮同源）===== */
const _UI = {
    panelBg: 'rgba(35,39,44,0.20)',      /* 面板半透明底 */
    blur: 'blur(14px)',                  /* 毛玻璃 */
    border: '1px solid rgba(170,200,220,.5)',
    radius: '22px',
    text: '#eee',
    titleColor: '#f3e8ae',
    btnBorder: '#bda573',                /* 主按钮描边 */
    btnBg: 'rgba(80,65,40,.65)',         /* 主按钮底 */
    btnBg2: 'rgba(60,65,70,.55)',        /* 次按钮底 */
    btnBorder2: 'rgba(170,200,220,.5)',
    font: "xinwei, KaiTi, serif",
};

/* 统一风格对话框：opts={title, message, buttons:[{label,value,primary}], modal}
 * 返回 Promise<value>；DOM 不可用时自动退回原生 alert/confirm 语义。 */
function _styledDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        const buttons = opts.buttons && opts.buttons.length ? opts.buttons : [{ label: '确定', value: 'ok', primary: true }];
        let mask = null;
        const finish = function (v) {
            try { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {}
            resolve(v);
        };
        try {
            if (typeof document === 'undefined' || !document.body) throw new Error('no dom');
            mask = document.createElement('div');
            mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;';
            const panel = document.createElement('div');
            panel.style.cssText = 'width:min(560px,88vw);max-height:78vh;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;'
                + 'background:' + _UI.panelBg + ';backdrop-filter:' + _UI.blur + ';-webkit-backdrop-filter:' + _UI.blur + ';'
                + 'border:' + _UI.border + ';border-radius:' + _UI.radius + ';color:' + _UI.text + ';'
                + 'font-family:' + _UI.font + ';font-size:18px;line-height:1.6;box-shadow:0 8px 32px rgba(0,0,0,.35);';
            const h = document.createElement('div');
            h.textContent = opts.title || '无名AI';
            h.style.cssText = 'color:' + _UI.titleColor + ';font-size:24px;text-align:center;margin:0 0 10px;';
            const body = document.createElement('div');
            body.textContent = opts.message || '';
            body.style.cssText = 'white-space:pre-line;margin:0 0 14px;';
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;';
            const mkBtn = function (b) {
                const el = document.createElement('button');
                el.textContent = b.label;
                el.style.cssText = 'padding:6px 14px;border-radius:9px;font-size:18px;cursor:pointer;'
                    + 'font-family:' + _UI.font + ';color:' + _UI.titleColor + ';'
                    + 'border:1px solid ' + (b.primary ? _UI.btnBorder : _UI.btnBorder2) + ';'
                    + 'background:' + (b.primary ? _UI.btnBg : _UI.btnBg2) + ';';
                el.addEventListener('click', function () { finish(b.value); });
                return el;
            };
            buttons.forEach(function (b) { row.appendChild(mkBtn(b)); });
            panel.appendChild(h); panel.appendChild(body); panel.appendChild(row);
            mask.appendChild(panel);
            document.body.appendChild(mask);
            if (!opts.modal) mask.addEventListener('click', function (e) { if (e.target === mask) finish(null); });
        } catch (eNoDom) {
            /* DOM 不可用：退回原生弹窗，保证更新流程不断 */
            try { alert((opts.title ? opts.title + '\n\n' : '') + (opts.message || '')); } catch (e2) {}
            finish(buttons[0] && buttons[0].value);
        }
    });
}

function _showUpdateDialog(data) {
    const notes = (data && data.notes) ? String(data.notes) : '';
    _styledDialog({
        title: '发现新版本',
        message: '当前版本：' + _CURRENT_VER + '\n最新版本：' + (data.version || '?') + (notes ? '\n\n更新内容：\n' + notes : '') + '\n\n· 推荐用「直接安装」，装完重启游戏即生效\n· 「保存到手机」后需手动导入，过程中游戏可能弹出自带提示框',
        buttons: [
            { label: '直接安装', value: 'install', primary: true },
            { label: '保存到手机', value: 'save' },
            { label: '暂不更新', value: 'skip' },
        ],
    }).then(function (v) {
        if (v === 'install') _directInstall(data);
        else if (v === 'save') _downloadUpdatePackage(data);
    });
}

/* ★ 修复「下载后找不到文件」：
 *   原实现用 Blob + <a download> 触发下载——无名杀手机端 WebView 没有
 *   浏览器下载管理器，blob 链接点击后不会落盘，文件从未被保存到任何目录。
 *   现按优先级分三层，全部结果用统一风格弹窗反馈，不再静默：
 *   ① game.download：本体写文件通道（与训练数据导出同源），zip 按字节
 *      （latin1 字符串）写入游戏下载目录，文件管理器可见；
 *   ② 系统下载：直接用远端 URL 触发，WebView 配置了 DownloadListener 时
 *      走系统下载管理器，通知栏可见进度；
 *   ③ 兜底：把下载地址明确告知用户，自行在浏览器打开（浏览器下载 zip
 *      100% 可靠）。 */
/* _UPDATE_DOWNLOAD_URL 已在文件头部更新检查块统一定义 */

/* ===== ★ 直接安装通道（实验）：下载 zip → 本体解压 → game.writeFile 写回扩展目录 → 重启生效 =====
 * 依据：本扩展 storagePaths.js 已验证 game.writeFile/readFileAsText 以游戏根目录为基准，
 * extension/无名AI/... 中文路径可用。此通道让用户跳过「找文件-手动导入」两步。
 * 风险控制：
 *  - 仅写文本文件（js/css/json/md/txt/html），二进制资源（png/字体/音频）跳过并如实告知；
 *  - 写入前弹明确风险确认（中途失败可能导致扩展异常，需重新覆盖安装修复）；
 *  - 优先把整个包解到内存、全部成功再落盘，减少半成品概率；任一文件写失败立即中止并报告。
 *  - 不删除旧文件：同名覆盖、多退少补，重启游戏后生效。 */
function _zipDetector() {
    /* 返回 {unzip: function(u8)->Promise<{path:Uint8Array}>, name} 或 null */
    try {
        if (typeof window !== 'undefined' && window.JSZip && typeof window.JSZip.loadAsync === 'function') {
            return { name: 'JSZip', unzip: function (u8) { return window.JSZip.loadAsync(u8).then(function (zip) {
                const out = {}; const jobs = [];
                zip.forEach(function (path, entry) { if (!entry.dir) jobs.push(entry.async('uint8array').then(function (d) { out[path] = d; })); });
                return Promise.all(jobs).then(function () { return out; });
            }); } };
        }
    } catch (eJ) {}
    try {
        if (typeof window !== 'undefined' && window.fflate && typeof window.fflate.unzipSync === 'function') {
            return { name: 'fflate', unzip: function (u8) { return Promise.resolve(window.fflate.unzipSync(u8)); } };
        }
    } catch (eF) {}
    try {
        if (typeof game !== 'undefined' && game && typeof game.unzip === 'function') {
            return { name: 'game.unzip', unzip: function (u8) { return new Promise(function (res, rej) { game.unzip(u8, res, rej); }); } };
        }
    } catch (eU) {}
    return null;
}

/* ===== ★ fix5/fix6: 容器解压模块扫描器（结果挂 game.__wmzZipEnv） ===== */
function _scanZipEnv() {
    const res = { ts: Date.now(), scanned: 0, hits: [], scripts: [], usable: null };
    const RX = /zip|gzip|pako|fflate|inflate|deflate|compress|unzip|\btar\b|archive/i;
    const probe = function (obj, label) {
        if (!obj) return;
        let keys = null;
        try { keys = Object.getOwnPropertyNames(obj); } catch (e) { return; }
        res.scanned += keys.length;
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (!RX.test(k)) continue;
            let v = null;
            try { v = obj[k]; } catch (e) {}
            const kind = typeof v;
            let caps = [];
            try {
                if (v && typeof v.loadAsync === 'function') caps.push('loadAsync');
                if (v && typeof v.unzipSync === 'function') caps.push('unzipSync');
                if (v && typeof v.unzip === 'function') caps.push('unzip');
                if (v && typeof v.gunzipSync === 'function') caps.push('gunzipSync');
            } catch (eC) {}
            res.hits.push(label + k + '(' + kind + (caps.length ? ':' + caps.join('+') : '') + ')');
        }
    };
    try { if (typeof window !== 'undefined') probe(window, 'window.'); } catch (eW) {}
    try { if (typeof window !== 'undefined') probe(window.game, 'game.'); } catch (eG) {}
    try { if (typeof window !== 'undefined') probe(window.lib, 'lib.'); } catch (eL) {}
    try {
        if (typeof document !== 'undefined' && document.scripts) {
            for (let i = 0; i < document.scripts.length; i++) {
                const s = document.scripts[i].src || '';
                if (s && RX.test(s)) res.scripts.push(String(s).split('/').pop());
            }
        }
    } catch (eD) {}
    const det = _zipDetector();
    res.usable = det ? det.name : null;
    try {
        const gHost = (typeof game !== 'undefined' && game) || (typeof window !== 'undefined' && window.game) || null;
        if (gHost) gHost.__wmzZipEnv = res;
    } catch (eS) {}
    return res;
}
try { setTimeout(function () { try { _scanZipEnv(); } catch (eZ) {} }, 800); } catch (eBoot) {}
const _TEXT_EXT = /\.(js|mjs|json|css|md|txt|html|htm|gitkeep|svg)$/i;

/* 专用进度弹窗（保留引用以便更新文案；统一风格参数同 _styledDialog） */
let _pulseStyleInjected = false;
function _injectPulseStyle() {
    if (_pulseStyleInjected) return;
    _pulseStyleInjected = true;
    try {
        const st = document.createElement('style');
        st.textContent = '@keyframes wmzPulse{0%,100%{opacity:.55}50%{opacity:1}}';
        document.head.appendChild(st);
    } catch (e) {}
}

function _progressDialog(text) {
    let body = null, mask = null;
    _injectPulseStyle();
    try {
        mask = document.createElement('div');
        mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;';
        const panel = document.createElement('div');
        panel.style.cssText = 'width:min(560px,88vw);box-sizing:border-box;padding:18px 20px 16px;background:' + _UI.panelBg
            + ';backdrop-filter:' + _UI.blur + ';-webkit-backdrop-filter:' + _UI.blur + ';border:' + _UI.border
            + ';border-radius:' + _UI.radius + ';color:' + _UI.text + ';font-family:' + _UI.font + ';font-size:18px;line-height:1.6;box-shadow:0 8px 32px rgba(0,0,0,.35);text-align:center;';
        const h = document.createElement('div');
        h.textContent = '正在安装 ⏳';
        h.style.cssText = 'color:' + _UI.titleColor + ';font-size:24px;margin:0 0 10px;animation:wmzPulse 1.4s ease-in-out infinite;';
        body = document.createElement('div');
        body.textContent = text || '准备中…';
        panel.appendChild(h); panel.appendChild(body); mask.appendChild(panel); document.body.appendChild(mask);
    } catch (e) {}
    return {
        update: function (t) { try { if (body) body.textContent = t; } catch (e) {} },
        close: function () { try { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {} },
    };
}

function _directInstall(data) {
    const zipper = _zipDetector();
    if (!zipper) {
        _styledDialog({
            title: '本环境不支持直接安装',
            message: '当前游戏环境没有可用的解压模块，无法直接写入扩展目录。\n\n请改用「保存到手机」后手动导入，或用浏览器下载后安装。',
            buttons: [{ label: '保存到手机', value: 'save', primary: true }, { label: '取消', value: 'no' }],
        }).then(function (v) { if (v === 'save') _downloadUpdatePackage(data); });
        return;
    }
    _styledDialog({
        title: '确认直接安装',
        message: '将把新版本（' + ((data && data.version) || '?') + '）直接写入扩展目录，重启游戏后生效。\n\n· 写入前自动做编码自检，每个文件写完即读回核对，通道异常会立即中止且不改动正式文件\n· ⚠️ 安装过程请勿退出游戏；若中途失败导致扩展异常，用浏览器打开 ' + _UPDATE_DOWNLOAD_URL + ' 重新下载覆盖安装即可修复\n· 图片/字体等资源文件将跳过（不影响功能）\n\n（若期间游戏弹出其它自带提示框，均为游戏本体界面，忽略即可）',
        buttons: [{ label: '开始安装', value: 'go', primary: true }, { label: '取消', value: 'no' }],
    }).then(function (v) {
        if (v !== 'go') return;
        const prog = _progressDialog('下载更新包…');
        /* zip 内路径自适应：服务端包可能自带 extension/无名AI/ 或 无名AI/ 前缀，统一剥到扩展根再拼 */
        const norm = function (k) {
            let p = String(k).replace(/\\/g, '/').replace(/^\//, '');
            if (p.indexOf('extension/无名AI/') === 0) p = p.slice('extension/无名AI/'.length);
            else if (p.indexOf('无名AI/') === 0) p = p.slice('无名AI/'.length);
            return p;
        };
        /* ★ 修复（关键）：game.writeFile 是 UTF-8 文本语义。旧实现按 latin1 拼串写入，
         *   含中文的文件全部二次编码成乱码 → 直接安装=损坏扩展。现 UTF-8 解码后写入，
         *   回调结果按 trainingExportFile.js 口径判错（Error/字符串/带 error 或 code 都算失败），
         *   并支持 game.promises.writeFile 降级。写入后由 verifyOne 逐文件读回核对。 */
        const writeOne = function (relPath, u8) {
            return new Promise(function (resolve, reject) {
                try {
                    const target = 'extension/无名AI/' + relPath;
                    const cut = target.lastIndexOf('/');
                    const dir = target.slice(0, cut + 1);
                    const fn = target.slice(cut + 1);
                    const s = _utf8Decode(u8);
                    let settled = false;
                    const to = setTimeout(function () { if (!settled) { settled = true; reject(new Error('write timeout 12s')); } }, 12000);
                    const onDone = function (result) {
                        if (settled) return;
                        const bad = Object.prototype.toString.call(result) === '[object Error]'
                            || (typeof result === 'string' && result)
                            || (result && (result.error || typeof result.code === 'number'));
                        settled = true; clearTimeout(to);
                        if (bad) reject(new Error(String(result.message || result.error || result)));
                        else resolve();
                    };
                    if (typeof game !== 'undefined' && game && typeof game.writeFile === 'function') {
                        game.writeFile(s, dir, fn, onDone);
                    } else if (typeof game !== 'undefined' && game && game.promises && typeof game.promises.writeFile === 'function') {
                        game.promises.writeFile(s, dir, fn).then(onDone, onDone);
                    } else {
                        settled = true; clearTimeout(to); reject(new Error('原生文件接口不可用'));
                    }
                } catch (eW) { reject(eW); }
            });
        };
        /* ★ 读回核对：resolve true=一致 / false=不一致（中止）/ null=无法核验（放行并计数） */
        const verifyOne = function (relPath, u8) {
            return new Promise(function (resolve) {
                try {
                    const target = 'extension/无名AI/' + relPath;
                    const expect = _utf8Decode(u8);
                    if (typeof game === 'undefined' || !game) return resolve(null);
                    if (game.promises && typeof game.promises.readFileAsText === 'function') {
                        Promise.resolve(game.promises.readFileAsText(target)).then(
                            function (saved) { resolve(saved === expect); },
                            function () { resolve(null); });
                    } else if (typeof game.readFileAsText === 'function') {
                        game.readFileAsText(target, function (saved) { resolve(saved === expect); });
                    } else resolve(null);
                } catch (eR) { resolve(null); }
            });
        };
        fetch(_UPDATE_DOWNLOAD_URL)
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
            .then(function (buf) { return zipper.unzip(new Uint8Array(buf)); })
            .then(function (files) {
                const keys = Object.keys(files).filter(function (k) { return k && !String(k).endsWith('/'); });
                if (!keys.length) throw new Error('压缩包为空');
                let skipped = 0;
                const jobs = [];
                keys.forEach(function (k) {
                    const rel = norm(k);
                    if (!rel) { skipped++; return; }             /* 目录占位 */
                    if (!_TEXT_EXT.test(rel)) { skipped++; return; }  /* 二进制资源跳过 */
                    jobs.push({ rel: rel, u8: files[k] });
                });
                if (!jobs.length) throw new Error('包内没有可写的文本文件');
                let done = 0, failed = null;
                const finish = function () {
                    prog.close();
                    _styledDialog({
                        title: failed ? '❌ 安装中止' : '✅ 安装完成',
                        message: failed
                            ? ('写入 ' + failed.path + ' 失败：' + failed.msg + '\n\n扩展可能未完整更新，请用浏览器打开 ' + _UPDATE_DOWNLOAD_URL + ' 重新下载覆盖安装修复。')
                            : ('已写入 ' + done + ' / ' + jobs.length + ' 个文件（全部读回核对一致' + (skipped ? '，跳过资源文件 ' + skipped + ' 个' : '') + '）。\n\n请完全退出游戏（杀进程）后重新打开，新版本即生效。\n\n如重启后扩展异常：浏览器打开 ' + _UPDATE_DOWNLOAD_URL + ' 重下覆盖安装。'),
                    });
                };
                const writeNext = function (i) {
                    if (failed || i >= jobs.length) { finish(); return; }
                    prog.update('正在写入 ' + (i + 1) + ' / ' + jobs.length + '：' + jobs[i].rel);
                    writeOne(jobs[i].rel, jobs[i].u8).then(function () {
                        return verifyOne(jobs[i].rel, jobs[i].u8);
                    }).then(function (vok) {
                        if (vok === false) {
                            failed = { path: jobs[i].rel, msg: '读回核对不一致（文件通道编码异常），已中止' };
                            finish(); return;
                        }
                        done++; writeNext(i + 1);
                    }).catch(function (err) {
                        failed = { path: jobs[i].rel, msg: (err && err.message) || String(err) };
                        finish();
                    });
                };
                /* ★ 编码通道预检：先写探针（含中文）→ 读回核对，通道异常时不碰任何正式文件 */
                prog.update('文件通道编码自检…');
                const probeU8 = _utf8Encode('wuming-ai-probe-编码自检-无名AI-α');
                writeOne('__update_probe.txt', probeU8).then(function () {
                    return verifyOne('__update_probe.txt', probeU8);
                }).then(function (pok) {
                    if (pok === false) {
                        prog.close();
                        _styledDialog({
                            title: '❌ 本环境不支持直接安装',
                            message: '文件写入通道读回核对失败（写入内容与读回不一致），直接安装会损坏扩展文件。\n\n已中止，未改动任何正式文件。\n\n请改用「保存到手机」后手动导入，或浏览器打开 ' + _UPDATE_DOWNLOAD_URL + ' 下载后导入。',
                            buttons: [{ label: '我知道了', value: 'ok', primary: true }],
                        });
                        return;
                    }
                    /* 探针清空（留 0 字节占位，不参与扩展运行） */
                    writeOne('__update_probe.txt', new Uint8Array(0)).then(function () { writeNext(0); }, function () { writeNext(0); });
                }).catch(function (eProbe) {
                    prog.close();
                    _styledDialog({
                        title: '❌ 安装失败',
                        message: '编码自检失败：' + (eProbe && eProbe.message || eProbe) + '\n\n未改动任何正式文件。可改用「保存到手机」或浏览器打开 ' + _UPDATE_DOWNLOAD_URL + ' 下载安装。',
                    });
                });
            })
            .catch(function (e) {
                prog.close();
                _styledDialog({
                    title: '❌ 安装失败',
                    message: '原因：' + (e && e.message || e) + '\n\n扩展未被改动。可改用「保存到手机」或浏览器下载安装。',
                    buttons: [{ label: '保存到手机', value: 'save', primary: true }, { label: '取消', value: 'no' }],
                }).then(function (v2) { if (v2 === 'save') _downloadUpdatePackage(data); });
            });
    });
}

function _uint8ToBinary(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return s;
}

/* ===== ★ UTF-8 编解码助手（直接安装编码修复的核心） =====
 * game.writeFile / readFileAsText 是【文本语义】（trainingExportFile.js 写入后读回逐字符
 * 核对的实证；含中文的 JSON 训练数据导出长期正常），即写入字符串按 UTF-8 落盘。
 * 旧「直接安装」把 zip 字节按 latin1 拼串写入 → 含中文的文件全部被二次编码成乱码，
 * 直接安装=损坏扩展。修复：zip 内文本文件按 UTF-8 解码成 JS 字符串再写入。 */
function _utf8Decode(u8) {
    try {
        if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(u8);
    } catch (eD) {}
    let out = '', i = 0;
    while (i < u8.length) {
        const b = u8[i];
        let cp = 0, len = 0;
        if (b < 0x80) { cp = b; len = 1; }
        else if (b >= 0xC0 && b < 0xE0) { cp = b & 0x1F; len = 2; }
        else if (b >= 0xE0 && b < 0xF0) { cp = b & 0x0F; len = 3; }
        else if (b >= 0xF0 && b < 0xF8) { cp = b & 0x07; len = 4; }
        else { out += String.fromCharCode(b); i++; continue; }
        let ok = i + len <= u8.length;
        for (let k = 1; ok && k < len; k++) {
            if ((u8[i + k] & 0xC0) !== 0x80) ok = false;
            else cp = (cp << 6) | (u8[i + k] & 0x3F);
        }
        if (!ok) { out += String.fromCharCode(b); i++; continue; }
        i += len;
        if (cp > 0xFFFF) { cp -= 0x10000; out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
        else out += String.fromCharCode(cp);
    }
    return out;
}

function _utf8Encode(str) {
    try {
        if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    } catch (eE) {}
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let cp = str.codePointAt(i);
        if (cp > 0xFFFF) i++;
        if (cp < 0x80) bytes.push(cp);
        else if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
        else if (cp < 0x10000) bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        else bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    }
    return new Uint8Array(bytes);
}

function _downloadUpdatePackage(data) {
    const fname = 'wuming_ai_' + (data && data.version ? data.version : 'latest') + '.zip';
    _styledDialog({ title: '正在下载', message: '正在获取更新包，请稍候…\n\n（过程中若游戏弹出「正在下载新包」等自带提示框，那是游戏本体的界面，属正常现象，请勿关闭游戏）', modal: true });
    fetch(_UPDATE_DOWNLOAD_URL)
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
        })
        .then(function (buf) {
            const u8 = new Uint8Array(buf);
            if (!u8.length) throw new Error('服务器返回空文件（0 字节）');
            /* ① 本体写文件通道 */
            let savedNative = false;
            try {
                if (typeof game !== 'undefined' && game && typeof game.download === 'function') {
                    game.download(fname, _uint8ToBinary(u8));
                    savedNative = true;
                    console.log('[无名AI更新] game.download 已保存 ' + fname + '（' + u8.length + ' 字节）');
                }
            } catch (eG) {
                console.log('[无名AI更新] game.download 通道失败: ' + (eG && eG.message || eG));
            }
            if (savedNative) {
                _styledDialog({
                    title: '✅ 下载完成',
                    message: '新版本包已保存：' + fname + '\n\n位置：游戏下载目录（download）\n请用手机文件管理器找到它，或到无名杀扩展管理中导入安装。\n\n若导入时提示压缩包损坏，请改用浏览器打开下方地址重新下载：\n' + _UPDATE_DOWNLOAD_URL,
                });
                return;
            }
            /* ② 系统下载通道（远端 URL，非 blob；无 DownloadListener 时静默无效） */
            try {
                const a = document.createElement('a');
                a.href = _UPDATE_DOWNLOAD_URL;
                a.download = fname;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (eA) {
                console.log('[无名AI更新] 系统下载通道异常: ' + (eA && eA.message || eA));
            }
            /* ③ 明确告知兜底路径 */
            _styledDialog({
                title: '已尝试下载',
                message: '目标文件：' + fname + '\n\n如果手机通知栏没有出现下载记录，请用浏览器打开下面的地址手动下载安装包：\n\n' + _UPDATE_DOWNLOAD_URL,
            });
        })
        .catch(function (e) {
            console.log('[无名AI更新] 下载失败: ' + (e && e.message || e));
            _styledDialog({
                title: '❌ 下载失败',
                message: '原因：' + (e && e.message || e) + '\n\n请稍后重试，或用浏览器直接打开下载：\n' + _UPDATE_DOWNLOAD_URL,
            });
        });
}
// ===== 在线更新检查结束 =====

/* ===== 目标合理性校验（前置校验，不拦截，仅日志） =====
 * ★ P1-25：保存定时器句柄与原始 useCard 引用，扩展卸载时可完整还原，
 *   杜绝"扩展关了补丁还在 / 热重载后旧闭包残留"的永久猴补丁。 */
let _useCardPatchTimer = null;
_useCardPatchTimer = setTimeout(function () {
    _useCardPatchTimer = null;
    try {
        var _p = lib.element.Player.prototype;
        if (_p.__logicCheck) return;
        _p.__logicCheck = true;
        var _o = _p.useCard;
        _p.__djsc_origUseCard = _o;  /* ★ P1-25：保存原函数供卸载还原 */
        var TARGET_RESTRICT_CARDS = ['sha','huosha','leisha','juedou','huogong','nanman','wanjian',
                   'zhujin','jiedao','lijian','shunshou','guohe','lebu','bingliang',
                   'tiesuo','fanjian','sidian'];
        _p.useCard = function (card, cards, target) {
            try {
                var me = this;
                var cn = typeof card === 'string' ? card : (card && (card.name || card.cardname));
                if (cn && TARGET_RESTRICT_CARDS.indexOf(cn) >= 0) {
                    var list = Array.isArray(target) ? target : (target ? [target] : []);
                    for (var i = 0; i < list.length; i++) {
                        var t = list[i];
                        if (!t || typeof t !== 'object' || t === me) continue;
                        var myId = me.identity, tid = t.identity;
                        var isSameFaction = false;
                        if (myId === 'zhu' && (tid === 'zhong' || tid === 'mingzhong')) isSameFaction = true;
                        if ((myId === 'zhong' || myId === 'mingzhong') && tid === 'zhu') isSameFaction = true;
                        if ((myId === 'zhong' || myId === 'mingzhong') && (tid === 'zhong' || tid === 'mingzhong')) isSameFaction = true;
                        if (myId === 'fan' && tid === 'fan') isSameFaction = true;
                        try { if (get.attitude(me, t) > 0) isSameFaction = true; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                        if (isSameFaction) {
                            var exempt = false;
                            try {
                                if (window.__DJSC && window.__DJSC.checkAllyExempt) {
                                    exempt = window.__DJSC.checkAllyExempt(me, t, cn);
                                }
                            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            if (!exempt) {
                                try { game.log('⚠️ 校验：' + cn + ' 对同阵营目标 ' + (t.name1 || t.name) + ' 不推荐'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            } else {
                                try { game.log('✅ 豁免：' + cn + ' 对同阵营目标 ' + (t.name1 || t.name) + ' 合理'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
                            }
                        }
                    }
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
            return _o.apply(me, arguments);
        };
        try { game.log('✅ 目标合理性校验模块已就绪（仅日志，不拦截）'); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
}, 3000);

/* ★ P2-32：观测器必须最先求值——全模块任何 catch 触发时 window.__DJSC.swallow 都已可用 */
import './score/foundation/diag/swallow.js';
import { lib, game, ui, get, ai, _status } from './js/shared/utils.js?v=5e5';
import { arenaReady } from './js/bootstrap/arenaReady.js?v=5e5';
import { config } from './js/config/config.js?v=5e5';
import { content } from './js/content/content.js?v=5e5';
import { precontent } from './js/content/precontent.js?v=5e5';
import { help } from './js/help/help.js?v=5e5';
import { installScoreEngine, uninstallScoreEngine, isScoreEngineEnabled } from './score/index.js?v=5e5';
import { VERSION, VERSION_SEMVER, BUILD_DATE } from './js/config/version.js?v=5e5';  /* ★ P2-35：版本号唯一权威源 */

let extensionPackage = {
	name: '无名AI',
	arenaReady,
	content,
	precontent,
	config,
	help,
	package: {},
	files: {},
	css: ['./css/AIjinjiang.css'],
};

/* ★ 兼容旧版 WebView：不使用模块顶层 await（需 Chrome89+/ES2022），
 *   改为在异步 IIFE 内读取 info.json 并合并到 package，保证低版本也能整包解析加载。 */
(function () {
    try {
        Promise.resolve(lib.init.promises.json(`${lib.assetURL}extension/无名AI/info.json`)).then(function (extensionInfo) {
            if (!extensionInfo || typeof extensionInfo !== 'object') return;
            Object.keys(extensionInfo)
                .filter(function (key) { return key !== 'name'; })
                .forEach(function (key) {
                    if (extensionPackage.package && typeof extensionPackage.package === 'object') {
                        extensionPackage.package[key] = extensionInfo[key];
                    }
                });
        }).catch(function () {});
    } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
})();

/* ★ 整合：原 content 钩子后初始化决策积分引擎（可配置开关） */
const _content = extensionPackage.content;
extensionPackage.content = async function (config, pack) {
	try { if (typeof _content === 'function') await _content(config, pack); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	await modeModelsReady;
	try {
		if (isScoreEngineEnabled()) {
			installScoreEngine();
		}
	} catch (e) {
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e);
		if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.reportUnexpected) window.__DJSC.reportUnexpected('engine', 'installScoreEngine 安装失败', e);
	}
};

/* ★ 卸载时清理决策积分引擎 + 还原 useCard 猴补丁（P1-25） */
const _uninstall = extensionPackage.uninstall;
extensionPackage.uninstall = function () {
	try { uninstallScoreEngine(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	/* ★ P1-25：还原 Player.prototype.useCard，取消未执行的 3s 补丁定时器 */
	try { if (_useCardPatchTimer) { clearTimeout(_useCardPatchTimer); _useCardPatchTimer = null; } } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try {
		const _p = lib.element && lib.element.Player && lib.element.Player.prototype;
		if (_p && _p.__djsc_origUseCard) {
			_p.useCard = _p.__djsc_origUseCard;
			try { delete _p.__djsc_origUseCard; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
			try { delete _p.__logicCheck; } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
		}
	} catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
	try { if (typeof _uninstall === 'function') _uninstall(); } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }
};

/* ★ 挂载校验相关接口到 window.__DJSC（直接内联，避免加载失败） */
window.__DJSC = window.__DJSC || {};
/* ★ 兼容别名：游戏内控制台/旧教程里常裸写 DJSC.xxx，指向同一对象避免 ReferenceError */
window.DJSC = window.__DJSC;
/* ★ P2-35：版本号单一权威源下发到全局，面板/自检/战报一律读此值，不再各自写死 */
window.__DJSC.VERSION = VERSION;
window.__DJSC.VERSION_SEMVER = VERSION_SEMVER;
window.__DJSC.BUILD_DATE = BUILD_DATE;

/* ★ 提前挂载训练数据导入/导出（扩展加载时就可用，不用进对局） */
import('./score/model/train/trainExport.js?v=5e5').then(function (m) {
    window.__DJSC.trainExport = function() { return m.exportForImport(); };
    window.__DJSC.trainImport = function(jsonStr) { return m.importFromJson(jsonStr); };
    window.__DJSC.trainBufferSize = function() { return m.bufferSize(); };
    console.log('[extension] ✅ trainExport/trainImport 已挂载（提前加载）');
}).catch(function (e) {
    console.warn('[extension] trainExport 加载失败:', e);
});

/* 合法性校验函数（直接内联，不依赖 allyExempt.js） */
window.__DJSC.checkAllyExempt = function (me, target, cardName) {
    try {
        if (!me || !target) return false;

        /* 1. 技能战术判定：目标有卖血技能 */
        const SPECIAL_SKILLS = ['yiji', 'jianxiong', 'fankui', 'gangzhi', 'yongsi', 'juejing', 'guicai', 'buyi', 'xingshang'];
        if (target.getSkills) {
            const skills = target.getSkills();
            for (let i = 0; i < skills.length; i++) {
                if (SPECIAL_SKILLS.indexOf(skills[i]) >= 0) return true;
            }
        }

        /* 2. 送牌收益判定：目标手牌少 */
        const hc = target.countCards ? target.countCards('h') : 0;
        if (hc <= 1) return true;

        /* 3. 残局判定：只剩2人且目标残血 */
        try {
            const alive = (game.players || []).filter(function (p) { return p && p.alive !== false; });
            if (alive.length <= 2 && target.hp <= 1) return true;
        } catch (e) { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); }

        return false;
    } catch (e) { return false; }
};

/* 校验记录器（动态加载） */
import('./score/decision/safety/guardRecorder.js?v=5e5').then(function (m) {
    window.__DJSC.guardRecorder = {
        record: m.recordGuardEvent,
        getStats: m.getGuardStats,
        reset: m.resetGuardRecorder,
    };
}).catch(function (e) { console.warn('guardRecorder 加载失败:', e); });

/* ===== v5 shadow 评估模块（不接管决策，仅后台记录对比；__AI_REASON.cmd.shadow('stats'|'export'|'clear')）===== */
import('./shadow/shadowCore.js?v=5e5').then(function (mShadow) {
    window.__AI_REASON = window.__AI_REASON || {};
    window.__AI_REASON.cmd = window.__AI_REASON.cmd || {};
    window.__AI_REASON.cmd.shadow = mShadow.shadowCmd;
    setTimeout(function () {
        mShadow.startShadow().catch(function (e) { console.error('[Shadow] 启动失败:', e); });
    }, 3000);
}).catch(function (e) { console.warn('[Shadow] 模块加载失败:', e); });

export let type = 'extension';
export default extensionPackage;
