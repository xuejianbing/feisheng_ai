/*
 * 无名AI · Config Spec 兼容适配层
 *
 * 配置唯一真相源位于 js/config/configSchema.js。
 * 本文件保留历史查询 API，供内核/面板继续调用；禁止在这里再次写默认值。
 */

import {
	CONFIG_ITEMS,
	CONFIG_SECTIONS,
	configMeta,
	validateSchema,
} from '../../../js/config/configSchema.js';

export const STATUS = { ACTIVE: 'active', PENDING: 'pending' };

function sectionForKey(key) {
	for (const section of CONFIG_SECTIONS) {
		for (const entry of section.entries || []) {
			if (entry === key) return section;
		}
	}
	return null;
}

function normalizeType(type) {
	if (type === 'bool') return 'bool';
	if (type === 'enum') return 'enum';
	if (type === 'text') return 'text';
	return type || 'string';
}

/* Config Spec 只描述真正可配置值；action 按钮不是“配置值”，不进入 SPEC。 */
export const SPEC = Object.keys(CONFIG_ITEMS)
	.filter(function (key) { return CONFIG_ITEMS[key] && CONFIG_ITEMS[key].type !== 'action'; })
	.map(function (key) {
		const meta = CONFIG_ITEMS[key];
		const section = sectionForKey(key);
		const item = {
			key: key,
			group: section ? section.title : '隐藏配置',
			scope: section ? section.scope : 'hidden',
			section: section ? section.id : null,
			label: meta.label,
			type: normalizeType(meta.type),
			default: meta.default,
			status: STATUS.ACTIVE,
			hint: meta.description || '',
			advanced: section ? section.scope === 'developer' : !!meta.hidden,
			hidden: !!meta.hidden,
		};
		if (meta.options) item.options = Object.keys(meta.options);
		return item;
	});

export function byKey(key) {
	const meta = configMeta(key);
	if (!meta || meta.type === 'action') return null;
	for (let i = 0; i < SPEC.length; i++) if (SPEC[i].key === key) return SPEC[i];
	return null;
}

export function active() {
	return SPEC.slice();
}

/* 预留/实验功能不再伪装成 active config。
 * 真正接线并进入 configSchema 后才会成为设置项。 */
export function pending() {
	return [];
}

export function groups() {
	const out = [];
	SPEC.forEach(function (s) {
		if (out.indexOf(s.group) < 0) out.push(s.group);
	});
	return out;
}

export function schema() {
	return groups().map(function (name) {
		return {
			group: name,
			items: SPEC.filter(function (s) { return s.group === name; }),
		};
	});
}

export function validate(obj) {
	const errors = [];
	obj = obj || {};

	const schemaCheck = validateSchema();
	if (!schemaCheck.ok) errors.push.apply(errors, schemaCheck.errors);

	SPEC.forEach(function (s) {
		const v = obj[s.key];
		if (v === undefined || v === null) return;

		if (s.type === 'bool' && typeof v !== 'boolean') {
			errors.push(s.key + ' 不是布尔值：' + v);
			return;
		}
		if (s.type === 'enum' && s.options && s.options.indexOf(String(v)) < 0) {
			errors.push(s.key + ' 取值非法：' + v + '（允许 ' + s.options.join('/') + '）');
		}
	});

	return { ok: errors.length === 0, errors: errors };
}

export function readiness() {
	const a = active().length;
	return {
		active: a,
		pending: 0,
		total: a,
		percent: a ? 100 : 0,
		pendingKeys: [],
	};
}
