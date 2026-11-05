import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SUSPICIOUS_RECEIVER = /^(?:p|target|tgt|tgtObj|enemy|opponent|other)$/i;

function walk(dir, out) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) walk(full, out);
		else if (st.isFile() && name.endsWith('.js')) out.push(full);
	}
	return out;
}

function lineOf(src, index) {
	let line = 1;
	for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
	return line;
}

function findingKey(f) {
	return [f.path, f.receiver, f.operation, f.zone || '', f.card || '*'].join('|');
}

function debtKey(d) {
	return [d.path, d.receiver, d.operation || 'countCards', d.zone || '', d.card || '*'].join('|');
}

export function scanHiddenInfo(root) {
	const files = [];
	for (const dir of [
		join(root, 'score', 'decision'),
		join(root, 'score', 'model'),
		join(root, 'score', 'cognition'),
	]) {
		walk(dir, files);
	}

	const findings = [];
	for (const file of files) {
		const src = readFileSync(file, 'utf8');
		const path = relative(root, file).replace(/\\/g, '/');

		/* 精确查询对手某张隐藏手牌的数量：
		 * target.countCards('h[s]', 'sha') 这类读取不能作为公平 AI 的事实来源。 */
		const countRe = /\b([A-Za-z_$][\w$]*)\.countCards\(\s*(['"])(h|hs)\2\s*,\s*(['"])([A-Za-z0-9_$-]+)\4\s*\)/g;
		let m;
		while ((m = countRe.exec(src))) {
			const receiver = m[1];
			if (!SUSPICIOUS_RECEIVER.test(receiver)) continue;
			findings.push({
				path,
				line: lineOf(src, m.index),
				receiver,
				operation: 'countCards',
				zone: m[3],
				card: m[5],
				excerpt: m[0],
			});
		}

		/* 直接枚举明显“目标/敌人”别名的隐藏手牌同样属于高风险读取。
		 * 这里只审计明确的 opponent aliases，避免把当前行动者 player 的合法私有信息误报。 */
		const cardsRe = /\b([A-Za-z_$][\w$]*)\.getCards\(\s*(['"])h\2\s*\)/g;
		while ((m = cardsRe.exec(src))) {
			const receiver = m[1];
			if (!SUSPICIOUS_RECEIVER.test(receiver)) continue;
			findings.push({
				path,
				line: lineOf(src, m.index),
				receiver,
				operation: 'getCards',
				zone: 'h',
				card: '*',
				excerpt: m[0],
			});
		}
	}
	return findings;
}

export function compareHiddenInfoBaseline(findings, baseline) {
	const knownDebt = (baseline && Array.isArray(baseline.knownHiddenInfoDebt))
		? baseline.knownHiddenInfoDebt : [];
	const knownKeys = new Set(knownDebt.map(debtKey));
	const findingKeys = new Set((findings || []).map(findingKey));

	return {
		known: (findings || []).filter(function (f) { return knownKeys.has(findingKey(f)); }),
		unexpected: (findings || []).filter(function (f) { return !knownKeys.has(findingKey(f)); }),
		resolved: knownDebt.filter(function (d) { return !findingKeys.has(debtKey(d)); }),
	};
}

export function hiddenInfoFindingKey(finding) {
	return findingKey(finding);
}
