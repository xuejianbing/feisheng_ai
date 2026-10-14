/*
 * 无名AI · Strategic State Core
 * 纯生命周期判断，不依赖宿主。
 */

export function shouldRefreshStrategicState(previous, turnKey, fingerprint, force) {
	if (force) return true;
	if (!previous) return true;
	if (previous.turnKey !== turnKey) return true;
	if (previous.fingerprint !== fingerprint) return true;
	return false;
}

export function makeStrategicStateRecord(previous, turnKey, fingerprint, fresh) {
	fresh = fresh || {};
	return {
		turnKey,
		fingerprint,
		createdAt: Date.now(),
		refreshedFrom: previous ? previous.intent && previous.intent.type : null,
		victory: Array.isArray(fresh.victory) ? fresh.victory.slice() : [],
		roleObjective: fresh.roleObjective || 'GENERAL_ADVANTAGE',
		intent: fresh.intent || null,
		context: fresh.context || null,
	};
}
