/* 职责：训练/晋升后的冠军固化及旧决策点回流，保持原先清理与回流顺序。 */
import { getSamples, resetAll } from '../train/trainExport.js';
import { recompute as champRecompute, getChampions as champGet, diffDropped as champDiffDropped } from '../../decision/strategy/championStrategy.js';
import { log } from '../../foundation/diag/logger.js';
function _swallow(e) { try { if (typeof window !== 'undefined' && window.__DJSC && window.__DJSC.swallow) window.__DJSC.swallow(e); } catch (_) {} }
/* ★ 从当前样本缓冲读取并重算冠军（供 __DJSC.champion.recompute 无参调用） */
function champRecomputeFromBuffer() {
    try { return champRecompute(getSamples() || []); } catch (e) { return {}; }
}

function _championFixAndRecycle() {
    let _dropList = [];
    try {
        const _oldEmb = champGet();   /* ★ 固化前先记下旧嵌入池，用于找出被"替换/淘汰"的旧决策点 */
        const ch = champRecompute(getSamples() || []);   /* ★ 直接从当前样本缓冲重算冠军嵌入 */
        const _n = (typeof ch === 'object' && ch) ? Object.keys(ch).length : 0;
        if (_n > 0) {
            try { log.info('champion', '已固化 ' + _n + ' 类冠军决策写入引擎'); } catch (e) { _swallow(e); }
        }
        try {
            _dropList = champDiffDropped(_oldEmb, ch);
        } catch (eDiff) { _dropList = []; }
    } catch (e) { _swallow(e); }
    /* ★ 提升后清空样本，开始新一轮收集 */
    try { resetAll(); } catch (e) { _swallow(e); }
    /* ★ 冠军替换数据回流：必须放在 resetAll() 之后，否则刚回收的样本会被清空 */
    try {
        if (_dropList && _dropList.length && window.__DJSC.recycleChampionSamples) {
            const recycled = window.__DJSC.recycleChampionSamples(_dropList);
            try { log.info('champion', '替换回收：' + recycled + ' 条被替换决策点已回流入样本库'); } catch (e) { _swallow(e); }
        }
    } catch (eRecycle) { _swallow(eRecycle); }
}

function autoRecycleChampion() {
    try {
        const _old = champGet();                                  /* 旧嵌入池 */
        const _chNew = champRecompute(getSamples() || []);        /* 由当前样本重算 */
        const _drop = champDiffDropped(_old, _chNew);            /* 找出被替换的旧决策点 */
        if (_drop && _drop.length && window.__DJSC.recycleChampionSamples) {
            const n = window.__DJSC.recycleChampionSamples(_drop);
            try { log.info('champion', '训练回流：' + n + ' 条被替换旧冠军已回流入样本库'); } catch (e) { _swallow(e); }
        }
    } catch (e) { try { log.warn('champion', '训练回流异常', e); } catch (e2) { _swallow(e2); } }
}


export { champRecomputeFromBuffer, _championFixAndRecycle, autoRecycleChampion };
