/* 只识别已核对源码的统计/界面事件；不能按下划线/charlotte一概过滤真实技能。 */
const SYSTEM_SKILLS = new Set(['_mvp_score_init', '_mvp_cure', '_mvp_help',
 '_wjmh_huifushuzi_', // 十周年UI recoverBegin：仅播放回复体力数字动画。
]);
export function splitSkillLog(value) {
 const skills = (Array.isArray(value) ? value : [value]).map(x => String(x || '?'));
 return { actionSkills: skills.filter(x => !SYSTEM_SKILLS.has(x)), systemSkills: skills.filter(x => SYSTEM_SKILLS.has(x)) };
}
export function isSystemSkillLog(value) {
 const split = splitSkillLog(value);
 return split.systemSkills.length > 0 && split.actionSkills.length === 0;
}
