/* 职责：训练中的浮层与完成提示；不保存模型状态，不训练权重。 */
function _swallow(e) { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {} }
/* ★ 自定义浮层提示（训练完成后才消失） */
function showToast(msg, duration) {
    try {
        duration = duration || 3000;
        let toast = document.getElementById('djsc_toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'djsc_toast';
            toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#fff;padding:20px 30px;border-radius:10px;z-index:99999;font-size:16px;line-height:1.6;max-width:80%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.display = 'block';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function () {
            toast.style.display = 'none';
        }, duration);
    } catch (e) {
        try { if (typeof alert === 'function') alert(msg); } catch (e2) {}  /* ★ Node/无 DOM 环境静默降级 */
    }
}

/* ★ 训练中浮层（不自动消失，训练完成后手动替换） */
function showLoading(msg) {
    try {
        let toast = document.getElementById('djsc_toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'djsc_toast';
            toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#fff;padding:20px 30px;border-radius:10px;z-index:99999;font-size:16px;line-height:1.6;max-width:80%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.display = 'block';
        clearTimeout(toast._timer);
    } catch (e) { _swallow(e); }
}


export { showToast, showLoading };
export function showTrainingStart(samples) {
try { if (typeof alert === 'function') alert('⏳ 正在训练模型...\n\n样本数：' + samples + ' 条\n训练完成后会自动提示\n\n本次训练期间请不要关闭游戏'); } catch (e) { _swallow(e); }
}
