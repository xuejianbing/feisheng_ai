/*
 * ============================================================
 * 无名AI · 装备基本决策引擎（equipBrain）
 * ------------------------------------------------------------
 * 职责：对「装备牌」（武器/防具/马）给出统一决策标准，
 *       与 cardPlayBrain / skillPlayBrain 同法：
 *       分类 → 硬否决 → 优先级 → 中文理由。
 *
 * 原则（官方人机基础逻辑：摸到装备立刻装）：
 *   1. 立刻装，不留手牌；但有同槽位更优装备时需权衡
 *   2. 武器 > 防具 > 马；关键武器(诸葛/青釭/青龙)最高
 *   3. 防具：藤甲怕火；白银/八卦稳定抗伤
 *   4. 已有更好装备(同槽)时，是否替换按价值对比
 *
 * 本模块为纯函数，事实通过 ctx 注入，可单测。
 * ============================================================
 */

/* ---------- 装备分类 ---------- */
export function classifyEquip(id) {
	const WEAPON = ['zhuge', 'qinggang', 'qinglong', 'guding', 'guanshi', 'hanbing',
		'jueying', 'qilin', 'zhangba', 'cixiong', 'zhuque', 'yiyang', 'fangtian'];
	const ARMOR = ['renwang', 'bagua', 'tengjia', 'baiyin'];
	const HORSE = ['dilu', 'chitu', 'dawan', 'zixin', 'hualiu', 'zhuahuang'];
	const TOOL = ['muniu'];
	if (WEAPON.indexOf(id) >= 0) return 'weapon';
	if (ARMOR.indexOf(id) >= 0) return 'armor';
	if (HORSE.indexOf(id) >= 0) return 'horse';
	if (TOOL.indexOf(id) >= 0) return 'tool';
	return 'other';
}

/* 槽位键（决定是否同槽冲突） */
export function equipSlot(id) {
	const c = classifyEquip(id);
	if (c === 'weapon' || c === 'tool') return 'weapon';
	if (c === 'armor') return 'armor';
	if (c === 'horse') return 'horse';
	return null;
}

/* 内置装备价值表（0-10，越大越珍贵） */
export const EQUIP_VALUE = {
	/* 武器 */
	zhuge: 10, qinggang: 8.5, qinglong: 7.5, fangtian: 7, zhangba: 6.5,
	guding: 6, guanshi: 6, hanbing: 6, qilin: 6, cixiong: 5.5,
	zhuque: 6, yiyang: 6, jueying: 6,
	/* 防具 */
	renwang: 7.5, bagua: 7, baiyin: 6.8, tengjia: 6,
	/* 马 */
	chitu: 4.5, dilu: 4.5, dawan: 4, hualiu: 4, zixin: 4, zhuahuang: 4,
	/* 工具 */
	muniu: 5,
};

export function baseEquipValue(id) {
	return EQUIP_VALUE[id] !== undefined ? EQUIP_VALUE[id] : 3;
}

/* ---------- 否决硬规则 ---------- */
export function vetoEquip(id, ctx) {
	ctx = ctx || {};
	const slot = equipSlot(id);
	/* 替换同槽位更优装备 → 否决（除非价值优势明显） */
	if (slot && ctx[slot] && ctx[slot] !== id) {
		const cur = ctx[slot];
		const oldV = baseEquipValue(cur);
		const newV = baseEquipValue(id);
		const gain = newV - oldV;
		if (gain < 0.5 && !ctx.forceEquip) {
			return { veto: true, reason: '当前' + slot + '(' + cur + ')价值更高，不替换' };
		}
	}
	/* 藤甲：敌有火属性攻击 → 否决 */
	if (id === 'tengjia' && ctx.enemyHasFire) {
		return { veto: true, reason: '敌有火攻/火杀，藤甲负负得正更易被烧' };
	}
	/* 木牛流马无实际战斗价值，除非有手牌传递需求 */
	return { veto: false, reason: '' };
}

/* ---------- 装备优先级（越高越先装） ---------- */
export function equipPriority(id, ctx) {
	ctx = ctx || {};
	const base = baseEquipValue(id);
	const c = classifyEquip(id);
	/* 稀缺度加成（ctx.scarcity 0~1） */
	const scarcity = (ctx.scarcity !== undefined) ? ctx.scarcity : 0.5;
	let v = base * (0.85 + scarcity * 0.3);
	/* 藤甲怕火调整 */
	if (id === 'tengjia' && ctx.enemyHasFire) v *= 0.5;
	/* 都有装备时同槽替换不着急 */
	const slot = equipSlot(id);
	if (slot && ctx[slot]) v *= 0.6;
	/* 归一化到 0-100，装备整体高位 */
	return clamp(Math.round(60 + v * 3.5), 0, 100);
}

/* ---------- 汇总决策 ---------- */
export function decideEquip(id, ctx) {
	ctx = ctx || {};
	const v = vetoEquip(id, ctx);
	if (v.veto) {
		return {
			card: id, category: classifyEquip(id),
			veto: true, vetoReason: v.reason,
			priority: 0, targetIndex: -1, reason: '否决：' + v.reason,
		};
	}
	const p = equipPriority(id, ctx);
	return {
		card: id, category: classifyEquip(id),
		veto: false, vetoReason: '',
		priority: p, targetIndex: -1,
		reason: '装备价值 ' + baseEquipValue(id),
	};
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }