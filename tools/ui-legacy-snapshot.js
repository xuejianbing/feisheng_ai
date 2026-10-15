/*
 * ============================================
 * // 作者：飞升原创
 * 交流群：1080487560
 * 版权所有，侵权必究
 * ============================================
 */

/* ⚠️ 仅供测试对照：此为"布局修复前"的 js/update/updateUi.js 快照（来源提交 a820987）。
 * 用途：tools/ui-harness.html?src=legacy 加载本文件，用同一套几何断言复现旧实现的
 * 塌缩/重叠缺陷（证伪对照，证明断言有效）。**生产代码绝不引用本文件**。
 * 与修复版的唯一差异：仅补充了 djsc-dialog-* 类名以便测量，旧样式逻辑原样保留。 */

/* ================= 无名AI · 统一风格弹窗（更新流程共用） =================
 * 从 extension.js 内联实现迁出：扩展入口只负责装配，样式集中在此。
 * 样式与 score/view/panel/panelTheme.js 的 styleUtilityPanel 及 css/AIjinjiang.css 按钮同源。
 *
 * 导出：
 *  - styledDialog(opts)     统一风格对话框，返回 Promise<value>
 *  - progressDialog(text)   进度浮层（手动 close）
 * 两者在 DOM 不可用时都退回原生 alert 语义，保证任何环境更新流程都不中断。
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

/* 统一风格对话框：opts={title, message, buttons:[{label,value,primary}], modal, dangerous, defaultValue}
 * 返回 Promise<value>；DOM 不可用时自动退回原生 alert 语义。
 * ★ P2-4：dangerous=true 的破坏性操作（覆盖权重/删除记录/恢复备份等），
 *   在无法呈现交互界面时一律返回"取消"值，绝不把普通提示当成用户已确认；
 *   只读提示可安全降级（返回首个按钮值）。 */
export const styledDialog = opts => {
    opts = opts || {};
    return new Promise(resolve => {
        const buttons = (opts.buttons && opts.buttons.length) ? opts.buttons : [{ label: '确定', value: 'ok', primary: true }];
        let mask = null;
        const finish = v => {
            try { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {}
            resolve(v);
        };
        try {
            if (typeof document === 'undefined' || !document.body) throw new Error('no dom');
            mask = document.createElement('div');
            mask.className = 'djsc-dialog-mask';
            mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;';
            const panel = document.createElement('div');
            panel.className = 'djsc-dialog-panel';
            panel.style.cssText = 'width:min(560px,88vw);max-height:78vh;overflow:auto;box-sizing:border-box;padding:18px 20px 16px;'
                + 'background:' + UI.panelBg + ';backdrop-filter:' + UI.blur + ';-webkit-backdrop-filter:' + UI.blur + ';'
                + 'border:' + UI.border + ';border-radius:' + UI.radius + ';color:' + UI.text + ';'
                + 'font-family:' + UI.font + ';font-size:18px;line-height:1.6;box-shadow:0 8px 32px rgba(0,0,0,.35);';
            const h = document.createElement('div');
            h.className = 'djsc-dialog-title';
            h.textContent = opts.title || '无名AI';
            h.style.cssText = 'color:' + UI.titleColor + ';font-size:24px;text-align:center;margin:0 0 10px;';
            const body = document.createElement('div');
            body.className = 'djsc-dialog-scroll';
            body.textContent = opts.message || '';
            body.style.cssText = 'white-space:pre-line;margin:0 0 14px;';
            const row = document.createElement('div');
            row.className = 'djsc-dialog-actions';
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;';
            const mkBtn = b => {
                const el = document.createElement('button');
                el.textContent = b.label;
                el.style.cssText = 'padding:6px 14px;border-radius:9px;font-size:18px;cursor:pointer;'
                    + 'font-family:' + UI.font + ';color:' + UI.titleColor + ';'
                    + 'border:1px solid ' + (b.primary ? UI.btnBorder : UI.btnBorder2) + ';'
                    + 'background:' + (b.primary ? UI.btnBg : UI.btnBg2) + ';';
                el.addEventListener('click', () => finish(b.value));
                return el;
            };
            buttons.forEach(b => row.appendChild(mkBtn(b)));
            panel.appendChild(h); panel.appendChild(body); panel.appendChild(row);
            mask.appendChild(panel);
            document.body.appendChild(mask);
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
    _pulseStyleInjected = true;
    try {
        const st = document.createElement('style');
        st.textContent = '@keyframes wmzPulse{0%,100%{opacity:.55}50%{opacity:1}}';
        document.head.appendChild(st);
    } catch (e) {}
};

export const progressDialog = (text, title) => {
    let body = null, mask = null;
    _injectPulseStyle();
    try {
        mask = document.createElement('div');
        mask.className = 'djsc-dialog-mask';
        mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;';
        const panel = document.createElement('div');
        panel.className = 'djsc-dialog-panel';
        panel.style.cssText = 'width:min(560px,88vw);box-sizing:border-box;padding:18px 20px 16px;background:' + UI.panelBg
            + ';backdrop-filter:' + UI.blur + ';-webkit-backdrop-filter:' + UI.blur + ';border:' + UI.border
            + ';border-radius:' + UI.radius + ';color:' + UI.text + ';font-family:' + UI.font + ';font-size:18px;line-height:1.6;box-shadow:0 8px 32px rgba(0,0,0,.35);text-align:center;';
        const h = document.createElement('div');
        h.className = 'djsc-dialog-title';
        h.textContent = title || '正在更新模型权重 ⏳';
        h.style.cssText = 'color:' + UI.titleColor + ';font-size:24px;margin:0 0 10px;animation:wmzPulse 1.4s ease-in-out infinite;';
        body = document.createElement('div');
        body.className = 'djsc-dialog-scroll';
        body.textContent = text || '准备中…';
        panel.appendChild(h); panel.appendChild(body); mask.appendChild(panel); document.body.appendChild(mask);
    } catch (e) {}
    return {
        update: t => { try { if (body) body.textContent = t; } catch (e) {} },
        close: () => { try { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); } catch (e) {} },
    };
};
