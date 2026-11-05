/* 独立地址专用：真实 Player/useSkill/respond 与 GameEvent，不进入正式扩展。 */
export async function runHostScenarios() {
    const { lib, game, _status } = await import('/noname.js');
    const tx = await import('/extension/无名AI/score/decision/state/decisionTransaction.js');
    const training = await import('/extension/无名AI/score/model/train/trainExport.js');
    const player = game.players.find(p => p !== game.me && p !== _status.currentPhase && p.isAlive());
    if (!player) throw new Error('请先进入对局，再运行宿主场景');
    const checks = [];
    const assert = (condition, label) => { checks.push({ label, pass: !!condition }); if (!condition) throw new Error(label); };
    const skill = 'b5_isolated_probe';
    const previous = lib.skill[skill];
    const oldMarker = player.storage[skill];
    const samplesBefore = training.bufferSize();
    const ownTransactions = new Set();
    let commits = 0;
    try {
        lib.skill[skill] = {
            charlotte: true, direct: true, popup: false, lose: false, discard: false, delay: false,
            async content(event, trigger, player) {
                player.storage.b5_isolated_probe = (player.storage.b5_isolated_probe || 0) + 1;
            },
        };
        const success = tx.createDecisionTransaction({ type: 'skill', id: skill }, () => { commits++; });
        ownTransactions.add(success.id);
        tx.stageDecisionTransaction(player, success);
        const skillEvent = player.useSkill(skill);
        assert(commits === 0, 'useSkill 正常返回时不提前 Commit');
        await skillEvent;
        await Promise.resolve();
        assert(skillEvent.finished === true && !skillEvent._cancelled, '真实 useSkill 事件完成且未取消');
        assert(player.storage[skill] === (oldMarker || 0) + 1, '真实技能内容实际执行');
        assert(success.state === 'committed' && commits === 1, '技能完成后对应事务只提交一次');

        for (const silent of [false, true]) {
            const label = silent ? '静默取消' : '普通取消';
            const cancelled = tx.createDecisionTransaction({ type: 'skill', id: skill }, () => { commits++; });
            ownTransactions.add(cancelled.id);
            tx.stageDecisionTransaction(player, cancelled);
            const cancelledEvent = player.useSkill(skill);
            const originalCancel = Object.getPrototypeOf(cancelledEvent).cancel;
            cancelledEvent.cancel(true, null, silent ? 'notrigger' : undefined);
            await cancelledEvent;
            await Promise.resolve();
            assert(cancelled.state === 'cancelled', label + '只取消对应事务');
            assert(commits === 1 && player.storage[skill] === (oldMarker || 0) + 1, label + '不执行技能内容、不产生 Commit');
            assert(cancelledEvent.cancel === originalCancel, label + '结束后恢复宿主 cancel 方法');
        }

        const pending = tx.createDecisionTransaction({ type: 'card', id: 'b5_unexecuted' }, () => { commits++; });
        ownTransactions.add(pending.id);
        tx.stageDecisionTransaction(player, pending);
        const responseEvent = player.respond({ name: 'shan' }, [], false);
        await responseEvent;
        await Promise.resolve();
        assert(responseEvent.finished === true && responseEvent.name === 'respond', '真实 Player.respond 事件能够完成');
        assert(tx.peekDecisionTransaction(player)?.id === pending.id && commits === 1,
            '响应事件不冒充待执行主动动作、不误提交');
        if (ownTransactions.has(tx.peekDecisionTransaction(player)?.id)) tx.cancelDecisionTransaction(player, 'b5-scenario-cleanup');
        assert(!training.getSamples().some(s => ownTransactions.has(s.m?.decisionId)),
            '受控事务未产生训练样本（自然对局的其他样本不计入此断言）');
        return { core: lib.version, checks, commits, samplesBefore, samplesAfter: training.bufferSize(),
            boundary: '真实宿主事件+受控事务回调；不是自然选牌或完整训练链验收' };
    } finally {
        if (ownTransactions.has(tx.peekDecisionTransaction(player)?.id)) tx.cancelDecisionTransaction(player, 'b5-scenario-cleanup');
        if (previous === undefined) delete lib.skill[skill]; else lib.skill[skill] = previous;
        if (oldMarker === undefined) delete player.storage[skill]; else player.storage[skill] = oldMarker;
    }
}
