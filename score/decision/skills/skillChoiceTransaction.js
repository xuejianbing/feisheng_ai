/*
 * ============================================
 * // 著者: Feisheng Original
 * 通用卡牌博弈AI决策引擎 · Skill Choice Transaction
 * ============================================
 *
 * Stage 3：把一次主动技能里的连续宿主选择组织成一个显式事务。
 *
 * 只记录“发生了哪些选择阶段、顺序、宿主结果摘要”，不猜技能语义：
 *   chooseCard -> card
 *   chooseTarget -> target
 *   chooseCardTarget -> card-target
 *   chooseButtonTarget -> button-target
 *   chooseButton -> button
 *   chooseControl -> control
 *
 * 事务层不负责决定按钮/控制项含义；语义不明确时上层继续 fail-open。
 */

let _txSeq = 0;

function _playerKey(player) {
	try {
		if (!player) return '';
		return player.playerid || player.name1 || player.name || '';
	} catch (e) { return ''; }
}

function _copyList(v) {
	try { return Array.isArray(v) ? v.slice() : []; } catch (e) { return []; }
}

function _selectionSummary(result) {
	if (!result || typeof result !== 'object') return null;
	try {
		const out = {};
		if (typeof result.bool === 'boolean') out.bool = result.bool;
		if (Array.isArray(result.cards)) out.cards = result.cards.slice();
		if (Array.isArray(result.targets)) out.targets = result.targets.slice();
		if (Array.isArray(result.links)) out.links = result.links.slice();
		if (result.control !== undefined) out.control = result.control;
		if (result.index !== undefined) out.index = result.index;
		return Object.keys(out).length ? out : null;
	} catch (e) { return null; }
}

function _refreshCompletedStages(tx) {
	try {
		if (!tx || !Array.isArray(tx.stages)) return;
		for (const stage of tx.stages) {
			if (!stage || stage.completed || !stage.event) continue;
			const r = stage.event.result;
			if (r === undefined || r === null) continue;
			stage.selection = _selectionSummary(r);
			stage.completed = true;
		}
	} catch (e) {}
}

function _publicStage(stage) {
	if (!stage) return null;
	return {
		transactionId: stage.transactionId,
		skillId: stage.skillId,
		ordinal: stage.ordinal,
		choiceType: stage.choiceType,
		completed: !!stage.completed,
		selection: stage.selection || null,
	};
}

export function getOrCreateSkillChoiceTransaction(player, skillContext) {
	try {
		if (!skillContext || !skillContext.id || !skillContext.event) return null;
		const ownerEvent = skillContext.event;
		const pk = _playerKey(player);
		let tx = ownerEvent.__djscSkillChoiceTransaction || null;
		if (tx && tx.skillId === skillContext.id && tx.playerKey === pk && tx.closed !== true) {
			_refreshCompletedStages(tx);
			return tx;
		}
		tx = {
			id: 'skilltx-' + (++_txSeq),
			skillId: skillContext.id,
			playerKey: pk,
			ownerEvent: ownerEvent,
			stages: [],
			closed: false,
		};
		try {
			Object.defineProperty(ownerEvent, '__djscSkillChoiceTransaction', {
				value: tx,
				writable: true,
				configurable: true,
			});
		} catch (e) {
			ownerEvent.__djscSkillChoiceTransaction = tx;
		}
		return tx;
	} catch (e) { return null; }
}

export function beginSkillChoiceStage(player, skillContext, choiceType, nextEvent) {
	try {
		if (!choiceType) return null;
		const tx = getOrCreateSkillChoiceTransaction(player, skillContext);
		if (!tx) return null;
		_refreshCompletedStages(tx);
		const priorSelections = tx.stages
			.filter(function (s) { return s && s.completed && s.selection; })
			.map(_publicStage);
		const stage = {
			transactionId: tx.id,
			skillId: tx.skillId,
			ordinal: tx.stages.length,
			choiceType: String(choiceType),
			event: nextEvent || null,
			completed: false,
			selection: null,
			priorSelections: priorSelections,
		};
		tx.stages.push(stage);
		if (nextEvent && typeof nextEvent === 'object') {
			try {
				Object.defineProperty(nextEvent, '__djscSkillChoiceStage', {
					value: stage,
					writable: true,
					configurable: true,
				});
			} catch (e) {
				nextEvent.__djscSkillChoiceStage = stage;
			}
		}
		return stage;
	} catch (e) { return null; }
}

export function completeSkillChoiceStage(stage, result) {
	try {
		if (!stage) return false;
		/* provenance 只保存白名单摘要；未知宿主 result 不原样塞进 transaction，
		 * 避免内部对象/循环引用/非当前决策所需信息跨阶段传播。 */
		stage.selection = _selectionSummary(result);
		stage.completed = true;
		return true;
	} catch (e) { return false; }
}

export function skillChoiceTransactionSnapshot(skillContext, player) {
	try {
		const tx = getOrCreateSkillChoiceTransaction(player, skillContext);
		if (!tx) return null;
		_refreshCompletedStages(tx);
		return {
			id: tx.id,
			skillId: tx.skillId,
			playerKey: tx.playerKey,
			closed: !!tx.closed,
			stages: tx.stages.map(_publicStage),
		};
	} catch (e) { return null; }
}

export function closeSkillChoiceTransaction(skillContext, player) {
	try {
		const tx = getOrCreateSkillChoiceTransaction(player, skillContext);
		if (!tx) return false;
		_refreshCompletedStages(tx);
		tx.closed = true;
		return true;
	} catch (e) { return false; }
}

export function _resetSkillChoiceTransactionSequenceForTests() {
	_txSeq = 0;
}
