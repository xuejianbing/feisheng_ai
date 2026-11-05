/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 123456789
 * v3.1α
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= Behavior Regression · 全局锦囊（AOE/桃园/五谷） =================
 * 南蛮/万箭（aoeTiming）：只当净伤害或残局/敌多时使用；
 * 桃园（taoyuanTiming）：Σ allyHeal−Σ enemyHeal 净治疗为正才放；
 * 五谷（wuguTiming）：敌我人数+手牌需求+座次综合净效用为正才放。
 * （Stage F 已深化，此处锁定深化后的净效用语义。）
 */
import { ok, eq, getHost, loadScore, finish } from './_harness.mjs';

const aoe = await loadScore('decision/timing/aoeTiming.js');
const tao = await loadScore('decision/timing/taoyuanTiming.js');
const wugu = await loadScore('decision/timing/wuguTiming.js');

/* ---- 注入敌我关系 / 玩家表 ---- */
const host = getHost();
host.get.attitude = function (me, t) { return t && t.rel ? t.rel : 0; };

function mkP(name, rel, opts) {
    opts = opts || {};
    return {
        name: name, rel: rel, alive: true,
        hp: opts.hp == null ? 4 : opts.hp, maxHp: opts.maxHp == null ? 4 : opts.maxHp,
        _h: opts.h == null ? 4 : opts.h,
        countCards: function (a) { return a === 'h' ? this._h : 0; },
    };
}

/* ===== 南蛮/万箭：净伤害 → 用 ===== */
{
    const me = mkP('me', 1, { h: 4 });
    const e1 = mkP('e1', -1, { h: 0 });
    const e2 = mkP('e2', -1, { h: 0 });
    const e3 = mkP('e3', -1, { h: 0 });
    host.game.players = [me, e1, e2, e3];
    const v = aoe.aoeValue(me, 'nanman');
    ok(v.enemyHit >= 2.9, '三空手敌人南蛮 → 高期望命中');
    ok(v.netDamage > 0, '净伤害为正');
    eq(aoe.aoeTiming(me, 'nanman').use, true, '净伤害足够 → 用 AOE');
}

/* ===== 只有队友 → 不用 ===== */
{
    const me = mkP('me', 1, { h: 4 });
    const a1 = mkP('a1', 1, { h: 4 });
    const a2 = mkP('a2', 1, { h: 4 });
    host.game.players = [me, a1, a2];
    eq(aoe.aoeTiming(me, 'wanjian').use, false, '无敌人且无净伤害 → 不用 AOE');
    eq(aoe.aoeBonus(me, { id: 'nanman' }), 0.5, '不用时 nanman 加成 0.5');
    eq(aoe.aoeBonus(me, { id: 'sha' }), 1.0, '非 AOE → 1.0');
}

/* ===== 桃园：自己/队友残血才放 ===== */
{
    host.game.players = [mkP('me', 1, { hp: 2, maxHp: 4 })];
    eq(tao.taoyuanTiming(mkP('me', 1, { hp: 2, maxHp: 4 })).use, true, '自己残血 → 放桃园');
}
{
    const me = mkP('me', 1, { hp: 4, maxHp: 4 });
    host.game.players = [me, mkP('allyLow', 1, { hp: 2, maxHp: 4 })];
    eq(tao.taoyuanTiming(me).use, true, '队友残血 → 放桃园');
}
{
    const me = mkP('me', 1, { hp: 4, maxHp: 4 });
    host.game.players = [me, mkP('allyFull', 1, { hp: 4, maxHp: 4 })];
    eq(tao.taoyuanTiming(me).use, false, '自己满血且无残血队友 → 不放桃园');
    eq(tao.taoyuanBonus(me, { id: 'taoyuan' }), 0.5, '不放时 taoyuan 加成 0.5');
}

/* ===== 五谷：自己/队友手牌少才放 ===== */
{
    host.game.players = [mkP('me', 1, { h: 2 })];
    eq(wugu.wuguTiming(mkP('me', 1, { h: 2 })).use, true, '自己手牌少 → 放五谷');
}
{
    const me = mkP('me', 1, { h: 3 });
    host.game.players = [me, mkP('allyLow', 1, { h: 2 })];
    eq(wugu.wuguTiming(me).use, true, '队友手牌少 → 放五谷');
}
{
    const me = mkP('me', 1, { h: 6 });
    host.game.players = [me];
    eq(wugu.wuguTiming(me).use, false, '自己手牌多 → 不放五谷');
    eq(wugu.wuguBonus(me, { id: 'wugu' }), 0.6, '不放时 wugu 加成 0.6');
}

/* ===== Stage F 深化：净治疗效用（帮敌人奶 → 不放） ===== */
{
    const me = mkP('me', 1, { hp: 4, maxHp: 4 });
    host.game.players = [me, mkP('eLow1', -1, { hp: 1, maxHp: 4 }), mkP('eLow2', -1, { hp: 2, maxHp: 4 })];
    const v = tao.taoyuanValue(me);
    ok(v.allyHeal === 0, '满血且无残血队友 → allyHeal=0');
    ok(v.enemyHeal > 0, '敌人残血 → enemyHeal>0');
    ok(v.net < 0, '敌方回血价值更高 → net<0');
    eq(tao.taoyuanTiming(me).use, false, '帮敌人奶更多 → 不放桃园');
}
{
    const me = mkP('me', 1, { hp: 4, maxHp: 4 });
    host.game.players = [me, mkP('allyLow', 1, { hp: 1, maxHp: 4 })];
    eq(tao.taoyuanTiming(me).use, true, '我方濒死且无敌人 → 放桃园（net>0）');
}

/* ===== Stage F 深化：五谷净效用（帮敌人补牌 → 不放） ===== */
{
    const me = mkP('me', 1, { h: 3 });
    host.game.players = [me, mkP('eLow1', -1, { h: 1 }), mkP('eLow2', -1, { h: 2 })];
    const v = wugu.wuguValue(me);
    ok(v.enemyLow >= 2, '两名敌人缺牌 → enemyLow>=2');
    ok(v.net < 0, '敌方缺牌更多 → 五谷 net<0');
    eq(wugu.wuguTiming(me).use, false, '帮敌人补牌 → 不放五谷');
}

finish('global_tricks');