/* 无名杀宿主桩加载器（仅测试用）
 *
 * 生产模块里 `foundation/adapt/host.js` 直接 re-export 游戏本体 `noname.js`，
 * 于是所有引用宿主适配层的模块在 Node 下都 import 不动——
 * 本加载器把「任何指向 noname.js 的 import」统一换成同一个桩模块，
 * 让测试可以 import **生产代码本身**（而不是另写一份理想化假实现）。
 *
 * 桩对象由 globalThis.__NONAME_STUB 提供，测试可在 import 之前配置：
 *   globalThis.__NONAME_STUB = { lib: {...}, game: {...}, _status: {...} }
 * 未提供的对象退化为空对象；所有 import 拿到的是同一实例（data: URL 单一模块）。
 */
const SRC = [
    'const s = globalThis.__NONAME_STUB || (globalThis.__NONAME_STUB = {});',
    'const o = k => (s[k] || (s[k] = {}));',
    'export const lib = o("lib");',
    'export const game = o("game");',
    'export const ui = o("ui");',
    'export const get = o("get");',
    'export const ai = o("ai");',
    'export const _status = o("_status");',
    'export const status = o("status");',
    'export const rootURL = o("rootURL");',
    'export const AI = o("AI");',
    'export const Get = o("Get");',
    'export const Game = o("Game");',
    'export const Library = o("Library");',
    'export const UI = o("UI");',
    'export const setAI = () => {};',
    'export const setGame = () => {};',
    'export const setGet = () => {};',
    'export const setLibrary = () => {};',
    'export const setStatus = () => {};',
    'export const setUI = () => {};',
].join('\n');

const STUB_URL = 'data:text/javascript;base64,' + Buffer.from(SRC, 'utf8').toString('base64');

export async function resolve(specifier, context, next) {
    if (/(^|\/)noname\.js(\?|$)/.test(specifier)) {
        return { url: STUB_URL, format: 'module', shortCircuit: true };
    }
    return next(specifier, context);
}
