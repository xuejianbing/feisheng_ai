/* 对局日志使用 innerHTML；先转义动态文本，再统一输出有序段落。 */
export function formatLogLines(lines) {
	const escape = value => String(value).replace(/[&<>"']/g, ch => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[ch]));
	return '<div style="display:block;position:relative;text-align:left;white-space:normal;overflow-wrap:anywhere;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;padding:6px 0">' +
		lines.map((line, i) => '<div style="display:block;position:relative;margin:0;' +
			(i === 0 ? 'font-weight:600;' : '') + '">' + escape(line) + '</div>').join('') + '</div>';
}
