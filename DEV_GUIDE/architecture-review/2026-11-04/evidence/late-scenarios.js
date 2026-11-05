/* 隔离地址专用：真实宿主事件晚结算、真实 game.over；不用手动 reset 冒充换局。 */
export async function runLateScenarios(report) {
    const { lib, game, _status } = await import('/noname.js');
    const tx = await import('/extension/无名AI/score/decision/state/decisionTransaction.js');
    const training = await import('/extension/无名AI/score/model/train/trainExport.js');
    const player = game.players.find(p => p !== game.me && p !== _status.currentPhase && p.isAlive());
    if (!player || _status.over) throw new Error('请在尚未结束的隔离对局运行');
    const skill = 'b5_late_probe', previous = lib.skill[skill];
    const checks = [], cases = [], owned = new Set();
    let writes = 0, release = () => {};
    const snapshot = () => ({ core: lib.version, checks: checks.slice(), cases: cases.slice(), writes,
        over: !!_status.over, pending: tx.peekDecisionTransaction(player)?.id || null,
        ownSamples: training.getSamples().filter(s => owned.has(s.m?.decisionId)).length,
        boundary: '真实 Player.useSkill + 受控等待；game.over 为真实终局入口，尚非自然长局' });
    const assert = (condition, label) => {
        checks.push({ label, pass: !!condition });
        if (!condition) { const e = new Error(label); e.evidence = snapshot(); throw e; }
    };
    try {
        lib.skill[skill] = {
            charlotte: true, direct: true, popup: false, lose: false, discard: false, delay: false,
            async content(event) {
                const parent = event.getParent('useSkill');
                parent.b5Begin();
                await parent.b5Gate;
            },
        };
        for (const outcome of ['late-finish', 'late-cancel', 'game-over']) {
            let begin;
            const started = new Promise(resolve => { begin = resolve; });
            const gate = new Promise(resolve => { release = resolve; });
            const old = tx.createDecisionTransaction({ type: 'skill', id: skill }, () => { writes++; });
            owned.add(old.id); tx.stageDecisionTransaction(player, old);
            const native = player.useSkill({ skill, b5Begin: begin, b5Gate: gate });
            const finishing = Promise.resolve(native);
            await started;
            assert(!native.finished, outcome + '：旧技能确实在执行中等待');
            let newer;
            if (outcome === 'game-over') {
                game.over(true);
                assert(_status.over === true, '真实 game.over 已设置终局状态');
            } else {
                newer = tx.createDecisionTransaction({ type: 'skill', id: skill }, () => { writes++; });
                owned.add(newer.id); tx.stageDecisionTransaction(player, newer);
                if (outcome === 'late-cancel') native.cancel(true, null, 'notrigger');
            }
            release();
            if (outcome === 'game-over') {
                /* 终局可能停止宿主队列；有界记录未完成，不能把挂起当作通过。 */
                let timeout;
                const finished = await Promise.race([
                    finishing.then(() => true),
                    new Promise(resolve => { timeout = setTimeout(() => resolve(false), 2000); }),
                ]);
                clearTimeout(timeout);
                if (!finished) {
                    const evidence = { ...snapshot(), terminalCompleted: false,
                        reason: '真实终局后宿主等待未返回；不判定该场景通过' };
                    sessionStorage.setItem('b5_restart_evidence', JSON.stringify({
                        oldIds: [...owned], writes, core: lib.version, checkedAtMs: Date.now(), terminalCompleted: false,
                    }));
                    if (report) await report(evidence);
                    return evidence;
                }
            } else await finishing;
            await Promise.resolve();
            const row = { outcome, oldId: old.id, oldState: old.state, newId: newer?.id || null,
                pendingId: tx.peekDecisionTransaction(player)?.id || null, writes,
                eventFinished: native.finished, observedCancelRestored: !Object.hasOwn(native, 'cancel') };
            cases.push(row);
            assert(writes === 0, outcome + '：旧回调没有提交或写入');
            if (newer) {
                assert(tx.peekDecisionTransaction(player)?.id === newer.id, outcome + '：新事务未被提交或取消');
                tx.cancelDecisionTransaction(player, 'b5-late-cleanup');
            } else {
                assert(!tx.peekDecisionTransaction(player), '终局后原 pending 已失效');
            }
            assert(row.observedCancelRestored, outcome + '：事件 cancel 已恢复');
            if (report) await report(snapshot());
        }
        assert(snapshot().ownSamples === 0, '受控事务未生成训练样本');
        sessionStorage.setItem('b5_restart_evidence', JSON.stringify({ oldIds: [...owned], writes, core: lib.version }));
        return snapshot();
    } finally {
        release();
        if (owned.has(tx.peekDecisionTransaction(player)?.id)) tx.cancelDecisionTransaction(player, 'b5-late-cleanup');
        if (previous === undefined) delete lib.skill[skill]; else lib.skill[skill] = previous;
    }
}

export async function inspectRestart() {
    let previous = JSON.parse(sessionStorage.getItem('b5_restart_evidence') || 'null');
    if (!previous) {
        const response = await fetch('/__b5/prior-run.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('缺少上一局证据，不宣称换局通过');
        previous = await response.json();
    }
    const { game, _status, lib } = await import('/noname.js');
    const tx = await import('/extension/无名AI/score/decision/state/decisionTransaction.js');
    const oldPending = game.players.map(p => tx.peekDecisionTransaction(p)).filter(p => p &&
        (previous.oldIds.includes(p.id) || p.createdAt <= previous.checkedAtMs));
    return { core: lib.version, previous, over: !!_status.over, players: game.players.length,
        oldPending: oldPending.length, pass: !_status.over && game.players.length > 0 && oldPending.length === 0,
        boundary: 'UI 重来后重载；旧 JS 上下文销毁，新局无旧 pending，不证明同页复用模式' };
}
