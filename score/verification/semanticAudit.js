/* 本文件由 build/semantic_audit.mjs 自动生成，请勿手工修改。
 * 含义：游戏专有词表（牌名/身份/阶段）在决策内核中的残留审计。
 * 目标：随「适配词表下沉」推进，hits 逐步归零、cleanRate 逐步趋近 100%。
 * 重新生成：node build/semantic_audit.mjs（发布前必须重跑，P2-34）
 */
export const AUDIT = {
	"generated": "2026-10-05",
	"files": 236,
	"cleanFiles": 104,
	"legacyFiles": 132,
	"hits": 3474,
	"cleanRate": 44,
	"byDomain": {
		"cognition": 114,
		"decision": 1893,
		"foundation": 65,
		"knowledge": 218,
		"model": 276,
		"perception": 783,
		"verification": 6,
		"view": 119
	},
	"top": [
		{
			"file": "score/decision/engine/engine.js",
			"count": 357
		},
		{
			"file": "score/perception/observer/identity.js",
			"count": 351
		},
		{
			"file": "score/perception/memory/deckMemory.js",
			"count": 267
		},
		{
			"file": "score/knowledge/tables/value-tables.js",
			"count": 135
		},
		{
			"file": "score/decision/skills/skills.js",
			"count": 87
		},
		{
			"file": "score/decision/strategy/modeStrategy.js",
			"count": 85
		},
		{
			"file": "score/decision/cardplay/cardPlayBrain.js",
			"count": 84
		},
		{
			"file": "score/decision/relations/relations.js",
			"count": 81
		},
		{
			"file": "score/model/features/features.js",
			"count": 60
		},
		{
			"file": "score/decision/response/wuxieEvaluator.js",
			"count": 57
		}
	]
};
