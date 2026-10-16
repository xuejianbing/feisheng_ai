/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 无名AI · 统一风格弹窗（更新流程共用） =================
 * 从 extension.js 内联实现迁出：扩展入口只负责装配，样式集中在此。
 * 样式与 score/view/panel/panelTheme.js 的 styleUtilityPanel 及 css/AIjinjiang.css 按钮同源。
 *
 * 导出：
 *  - styledDialog(opts)     统一风格对话框，返回 Promise<value>
 *  - progressDialog(text)   进度浮层（手动 close）
 * 两者在 DOM 不可用时都退回原生 alert 语义，保证任何环境更新流程都不中断。
 *
 * ★ 布局修复（手机横屏下弹窗塌缩成"一条横向窄框"）：
 *  无名杀本体 layout.css 存在全局规则 `div{display:inline-block;position:absolute;transition:all .5s}`，
 *  body 为 `position:absolute; transform-origin:top left`；`ui.updatez()` 还会对 body 做
 *  `transform:scale(zoom)`（宽高按 viewport/zoom 反算）。普通 div 因此全部脱离文档流：
 *  标题/正文/按钮被绝对定位后互相重叠、溢出，面板高度塌缩成一条窄框。
 *  修复方式（与 panelTheme.styleUtilityPanel 同源）：
 *   1) 面板 = 明确的纵向 Flex 布局：标题/按钮 `flex:0 0 auto` 恒定可见，
 *      正文区 `flex:1 1 auto; min-height:0; overflow:auto` 承担滚动；
 *   2) 所有结构节点用 setProperty(prop, value, 'important') 显式覆盖本体全局规则
 *      （position:static、display、transition:none 等），绝不依赖文档流默认值；
 *   3) 尺寸/位置按"实际可视区域 ÷ 实测缩放比"换算（visualViewport + rect/offsetWidth），
 *      补偿 body transform:scale，避免二次放大或偏移；面板高度随内容自适应，
 *      超过上限时仅正文区滚动；
 *   4) 单弹窗策略：同一时刻至多一个确认弹窗 + 一个进度浮层，
 *      新弹窗用各自的安全取消值关闭旧弹窗（不替代布局修复，仅防叠加）。
 */

export const UI = {
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
    font: 'xinwei, KaiTi, serif',
};

/* 关键布局一律 !important 覆盖本体全局样式（与 styleUtilityPanel 同一手法） */
const _set = (node, values) => {
    if (!node || !node.style || typeof node.style.setProperty !== 'function') return;
    Object.keys(values).forEach(key => {
        try { node.style.setProperty(key, values[key], 'important'); } catch (e) {}
    });
};

/* ---------- 单弹窗策略（避免多个更新弹窗同时显示） ----------
 * 打开新弹窗前，用各自的安全取消值关闭旧弹窗：
 *   安全取消值 = defaultValue → 非主按钮末位值（dangerous）→ null；
 *   现有调用方一律以 `v === 'go'/'apply'/'fix'` 正向匹配结果，取消值绝不会触发动作。 */
const _openDialogs = new Set();      /* { cancel } 确认/提示弹窗 */
const _openProgress = new Set();     /* { close }  进度浮层 */
const _cancelOpenDialogs = () => {
    Array.from(_openDialogs).forEach(d => { try { d.cancel(); } catch (e) {} });
    _openDialogs.clear();
};
const _closeOpenProgress = () => {
    Array.from(_openProgress).forEach(p => { try { p.close(); } catch (e) {} });
    _openProgress.clear();
};

/* ---------- 视口适配（补偿本体 body transform:scale） ---------- */
const _fitters = new Set();
let _viewportWatched = false;
const _refreshFits = () => { Array.from(_fitters).forEach(f => { try { f(); } catch (e) {} }); };
const _watchViewport = fit => {
    _fitters.add(fit);
    if (!_viewportWatched) {
        _viewportWatched = true;
        try {
            if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
                new MutationObserver(_refreshFits).observe(document.body, { attributes: true, attributeFilter: ['style'] });
            }
        } catch (e) {}
        try { window.addEventListener('resize', _refreshFits); } catch (e) {}
        try { if (window.visualViewport) window.visualViewport.addEventListener('resize', _refreshFits); } catch (e) {}
    }
    const run = () => { try { fit(); } catch (e) {} };
    try { requestAnimationFrame(run); } catch (e) { run(); }
};

/* 面板尺寸/位置适配：按**实际可视区域**换算成布局像素（除以实测缩放比），
 * 避免手机横屏下 body transform:scale 造成的二次放大与位置偏移；
 * 居中校正逻辑与 panelTheme.fitUtilityPanel 一致（visualViewport 偏移 + dx/dy 回正）。 */
const _fitPanel = (mask, panel, box) => {
    const fit = () => {
        try {
            if (!mask.isConnected || !panel.isConnected) { _fitters.delete(fit); return; }
            const mrect = mask.getBoundingClientRect();
            const scaleX = (mask.offsetWidth ? mrect.width / mask.offsetWidth : 1) || 1;
            const scaleY = (mask.offsetHeight ? mrect.height / mask.offsetHeight : 1) || 1;
            const vv = window.visualViewport;
            const width = vv ? vv.width : window.innerWidth;
            const height = vv ? vv.height : window.innerHeight;
            if (!width || !height) return;
            _set(panel, {
                width: Math.min(box.maxW, width * box.wRatio) / scaleX + 'px',
                'max-height': Math.min(box.maxH, height * box.hRatio) / scaleY + 'px',
                left: '50%', top: '50%',
            });
            const rect = panel.getBoundingClientRect();
            const dx = (vv ? vv.offsetLeft : 0) + width / 2 - (rect.left + rect.width / 2);
            const dy = (vv ? vv.offsetTop : 0) + height / 2 - (rect.top + rect.height / 2);
            _set(panel, { left: 'calc(50% + ' + dx / scaleX + 'px)', top: 'calc(50% + ' + dy / scaleY + 'px)' });
        } catch (e) { /* 测量失败（特殊/极简 DOM）：保留初始尺寸，不阻断更新流程 */ }
    };
    fit();
    _watchViewport(fit);
};

/* ---------- 玻璃面板骨架（弹窗与进度浮层共用） ---------- */
const DIALOG_BOX = { maxW: 560, maxH: 720, wRatio: 0.88, hRatio: 0.82 };
const _buildShell = () => {
    const mask = document.createElement('div');
    mask.className = 'djsc-dialog-mask';
    _set(mask, {
        position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
        margin: '0', padding: '0', display: 'block', overflow: 'hidden',
        background: 'rgba(0,0,0,.35)', 'z-index': '2147483646', transition: 'none',
        'box-sizing': 'border-box',
    });
    const panel = document.createElement('div');
    panel.className = 'djsc-dialog-panel';
    _set(panel, {
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        /* 明确的纵向 Flex：标题（固定）/ 正文（可滚动）/ 按钮（固定） */
        display: 'flex', 'flex-direction': 'column', 'flex-wrap': 'nowrap',
        'align-items': 'stretch', 'justify-content': 'flex-start',
        width: 'min(560px, 88vw)', 'max-height': 'min(720px, 82vh)', 'min-width': '0', 'min-height': '0',
        margin: '0', padding: '0', overflow: 'hidden',
        'box-sizing': 'border-box', 'z-index': '2147483647', transition: 'none',
        background: UI.panelBg, 'backdrop-filter': UI.blur, '-webkit-backdrop-filter': UI.blur,
        border: UI.border, 'border-radius': UI.radius, color: UI.text,
        'font-family': UI.font, 'font-size': '18px', 'line-height': '1.6', 'text-align': 'left',
        'box-shadow': '0 8px 32px rgba(0,0,0,.35)',
    });
    return { mask, panel };
};
const _buildTitle = text => {
    const h = document.createElement('div');
    h.className = 'djsc-dialog-title';
    h.textContent = text || '';
    _set(h, {
        position: 'static', display: 'block', float: 'none', flex: '0 0 auto', width: '100%',
        margin: '0', padding: '16px 20px 6px', 'box-sizing': 'border-box',
        color: UI.titleColor, 'font-size': '24px', 'line-height': '1.4', 'text-align': 'center',
        'white-space': 'normal', overflow: 'visible', transition: 'none',
    });
    return h;
};
const _buildScroll = () => {
    const body = document.createElement('div');
    body.className = 'djsc-dialog-scroll';
    _set(body, {
        position: 'static', display: 'block', float: 'none',
        flex: '1 1 auto', 'min-height': '0', height: 'auto',
        width: '100%', margin: '0', padding: '0 20px', 'box-sizing': 'border-box',
        overflow: 'auto', '-webkit-overflow-scrolling': 'touch',
        'white-space': 'pre-line', 'overflow-wrap': 'break-word',
        transition: 'none',
    });
    return body;
};
/* 兜底：结构内所有节点强制参与文档流（本体全局 div 定位规则绝不能影响布局） */
const _releaseFlow = root => {
    try {
        root.querySelectorAll('div, span, p, button, h1, h2, h3').forEach(node => {
            _set(node, { position: 'static', float: 'none' });
        });
    } catch (e) {}
};

/* 统一风格对话框：opts={title, message, buttons:[{label,value,primary}], modal, dangerous, defaultValue}
 * 返回 Promise<value>；DOM 不可用时自动退回原生 alert 语义。
 * ★ P2-4：dangerous=true 的破坏性操作（覆盖权重/删除记录/恢复备份等），
 *   在无法呈现交互界面时一律返回"取消"值，绝不把普通提示当成用户已确认；
 *   只读提示可安全降级（返回首个按钮值）。 */
export const styledDialog = opts => {
    opts = opts || {};
    return new Promise(resolve => {
        const buttons = (opts.buttons && opts.buttons.length) ? opts.buttons : [{ label: '确定', value: 'ok', primary: true }];
        const safeValue = () => {
            if (opts.defaultValue !== undefined) return opts.defaultValue;
            if (opts.dangerous) {
                const safe = buttons.filter(b => !b.primary);
                return safe.length ? safe[safe.length - 1].value : null;
            }
            return null;
        };
        let mask = null, done = false;
        const entry = { cancel: () => finish(safeValue()) };
        const finish = v => {
            if (done) return;
            done = true;
            _openDialogs.delete(entry);
            try { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {}
            resolve(v);
        };
        try {
            if (typeof document === 'undefined' || !document.body) throw new Error('no dom');
            /* 单弹窗策略：关闭现有确认弹窗与进度浮层，避免多个更新弹窗同时显示 */
            _cancelOpenDialogs();
            _closeOpenProgress();
            const shell = _buildShell();
            mask = shell.mask;
            const panel = shell.panel;
            const h = _buildTitle(opts.title || '无名AI');
            const body = _buildScroll();
            body.textContent = opts.message || '';
            const row = document.createElement('div');
            row.className = 'djsc-dialog-actions';
            _set(row, {
                position: 'static', display: 'flex', float: 'none',
                'flex-wrap': 'wrap', gap: '10px', 'justify-content': 'center', 'align-items': 'center',
                flex: '0 0 auto', width: '100%', margin: '0', padding: '12px 20px 16px',
                'box-sizing': 'border-box', transition: 'none',
            });
            const mkBtn = b => {
                const el = document.createElement('button');
                el.textContent = b.label;
                _set(el, {
                    position: 'static', display: 'inline-block', float: 'none', flex: '0 0 auto',
                    padding: '6px 14px', 'border-radius': '9px', 'font-size': '18px', cursor: 'pointer',
                    'font-family': UI.font, color: UI.titleColor, 'box-sizing': 'border-box',
                    border: '1px solid ' + (b.primary ? UI.btnBorder : UI.btnBorder2),
                    background: b.primary ? UI.btnBg : UI.btnBg2,
                    margin: '0', 'line-height': '1.6', transition: 'none',
                });
                el.addEventListener('click', () => finish(b.value));
                return el;
            };
            buttons.forEach(b => row.appendChild(mkBtn(b)));
            panel.appendChild(h); panel.appendChild(body); panel.appendChild(row);
            _releaseFlow(panel);
            mask.appendChild(panel);
            _openDialogs.add(entry);
            document.body.appendChild(mask);
            _fitPanel(mask, panel, DIALOG_BOX);
            if (!opts.modal) mask.addEventListener('click', e => { if (e.target === mask) finish(null); });
        } catch (eNoDom) {
            /* DOM 不可用：退回原生弹窗，保证更新流程不断 */
            try { alert((opts.title ? opts.title + '\n\n' : '') + (opts.message || '')); } catch (e2) {}
            if (opts.defaultValue !== undefined) { finish(opts.defaultValue); return; }
            if (opts.dangerous) {
                /* 危险操作：无法呈现交互界面 → 默认取消（取非主按钮值，无则 null） */
                const safe = buttons.filter(b => !b.primary);
                finish(safe.length ? safe[safe.length - 1].value : null);
                return;
            }
            finish(buttons[0] && buttons[0].value);
        }
    });
};

/* 进度浮层：update(text) / close()，DOM 不可用时为无操作（由调用方自行兜底提示） */
let _pulseStyleInjected = false;
const _injectPulseStyle = () => {
    if (_pulseStyleInjected) return;
    try {
        const st = document.createElement('style');
        st.textContent = '@keyframes wmzPulse{0%,100%{opacity:.55}50%{opacity:1}}';
        document.head.appendChild(st);
        _pulseStyleInjected = true;
    } catch (e) {}
};

export const progressDialog = (text, title) => {
    let body = null, mask = null, closed = false;
    const entry = { close: () => close() };
    const close = () => {
        if (closed) return;
        closed = true;
        _openProgress.delete(entry);
        try { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {}
    };
    _injectPulseStyle();
    try {
        if (typeof document === 'undefined' || !document.body) throw new Error('no dom');
        /* 单弹窗策略：至多一个进度浮层；开始新操作时安全关闭遗留的确认弹窗 */
        _closeOpenProgress();
        _cancelOpenDialogs();
        const shell = _buildShell();
        mask = shell.mask;
        const panel = shell.panel;
        const h = _buildTitle(title || '正在更新模型权重 ⏳');
        _set(h, { animation: 'wmzPulse 1.4s ease-in-out infinite' });
        const scroll = _buildScroll();
        _set(scroll, { 'text-align': 'center', padding: '0 20px 18px' });
        scroll.textContent = text || '准备中…';
        panel.appendChild(h); panel.appendChild(scroll);
        _releaseFlow(panel);
        mask.appendChild(panel);
        _openProgress.add(entry);
        document.body.appendChild(mask);
        _fitPanel(mask, panel, DIALOG_BOX);
        body = scroll;
    } catch (e) {}
    return {
        update: t => { try { if (body) body.textContent = t; } catch (e) {} },
        close,
    };
};
