/*
 * ============================================
 * // 作者：飞升原创
 * 交流群: 1080487560
 * v4.0.13-test
 * 版权所有，侵权必究
 * ============================================
 */

/* ================= 版本号唯一权威源（P2-35） =================
 * 此前版本号四处漂移：info.json=3.1α / CHANGELOG=3.1.0 /
 * 游戏内更新日志=2.9 / 设置页标题=v4.56.3，影响 bug 上报、
 * 更新确认、缓存排查与数据迁移判断。
 *
 * 规则：
 *  - 任何 UI / 日志 / 自检面板需要显示版本，一律 import 本文件，禁止写死；
 *  - info.json 的 "version" 与 VERSION 保持同字符串（发布检查项）；
 *  - VERSION_SEMVER 使用标准 SemVer；测试版使用 prerelease 标识，供迁移与兼容判断。
 */

export const VERSION = '4.0.13-test';
export const VERSION_SEMVER = '4.0.13-test';
export const MIN_GAME_VERSION = '1.11.1';   /* 支持的无名杀本体最低版本 */
export const BUILD_DATE = '2026-10-05';

export const VERSION_FULL = '无名AI v' + VERSION;
