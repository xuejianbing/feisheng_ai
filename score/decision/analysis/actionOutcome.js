/* 真实动作的事件窗口观测。整局胜负、静态评分及不完整事件均不充当动作收益。 */
export function createActionOutcomeObserver({ players, relation, key, equipmentValue = () => 1 }) {
 let generation = 0;
 let observedVersion = 0;
 const active = new Set();
 const within = (event, root) => {
  const seen = new Set();
  while (event && !seen.has(event)) {
   if (event === root) return true;
   seen.add(event);
   event = event.parent || (typeof event.getParent === 'function' ? event.getParent() : null);
  }
  return false;
 };
 const alive = p => typeof p.isDead === 'function' ? !p.isDead() : p.alive !== false && !p.dead;
 const assets = p => {
  const live = alive(p);
  const equipment = live && p.getCards ? p.getCards('e') || [] : [];
  return { hp: live ? Math.max(0, Number(p.hp) || 0) : 0,
   hand: live && p.countCards ? p.countCards('h') : 0,
   equip: equipment.reduce((s,c) => s + Math.max(0, Number(equipmentValue(c)) || 0), 0),
   judging: live && p.getCards ? (p.getCards('j') || []).length : 0, alive: live ? 1 : 0,
   linked: (typeof p.isLinked === 'function' ? p.isLinked() : p.linked) ? 1 : 0,
   turned: (typeof p.isTurnedOver === 'function' ? p.isTurnedOver() : p.turnedover) ? 1 : 0, wine: Number(p.storage?.jiu) || 0 };
 };
 function before(actor, event, capture = true) {
  try {
  for (const scope of active) if (!within(event, scope.root)) scope.ambiguous = true;
  if (!capture) return null;
  const all = [...new Set([actor, ...(players() || [])])].filter(Boolean);
  return { generation, observedVersion, actorId: key(actor), rows: all.map(p => {
   let camp = 0;
   try { const disposition = p === actor ? 1 : relation(actor,p); camp = disposition > 0 ? 1 : disposition < 0 ? -1 : 0; } catch (_) {}
   return { player: p, playerId: key(p), camp, assets: assets(p) };
  }) };
  } catch (_) { return null; }
 }
 function observe(snapshot, root, transaction, callback) {
  if (!snapshot || !transaction || transaction.state !== 'committed') return false;
  // Promise/GameEvent 完成且能确认 finished，才认为观察到了完整窗口；普通返回值不猜。
  if (!root || typeof root.then !== 'function') return false;
  for (const prior of active) if (prior.root !== root && within(root, prior.root)) prior.ambiguous = true;
  if (active.size >= 64) { const oldest = active.values().next().value; oldest.ambiguous = true; active.delete(oldest); }
  const scope = { root, ambiguous: snapshot.observedVersion !== observedVersion, snapshot, terminalDeltas: null }; active.add(scope);
  observedVersion++;
  let completed = false;
  const completeScope = function complete(terminal = false) {
   if (completed) return; completed = true;
   active.delete(scope);
   if (snapshot.generation !== generation) return;
   const complete = !terminal && root.finished === true && !scope.ambiguous;
   const deltas = scope.terminalDeltas || snapshot.rows.map(row => {
    const after = assets(row.player), delta = {};
    for (const name of Object.keys(after)) delta[name] = after[name] - row.assets[name];
    return { playerId: row.playerId, camp: row.camp, ...delta };
   });
   // 同一资产变化计一次，不另叠目标伤害/自身损失/阵营净收益。
   const raw = deltas.reduce((sum,d) => sum + d.camp * (d.hp*3 + d.hand*1.5 + d.equip*1.2 - d.judging*2 + d.alive*3),0);
   const known = snapshot.rows.every(row => row.camp || !deltas.find(d => d.playerId === row.playerId && Object.keys(row.assets).some(k => d[k])));
   const deferred = deltas.some(d => d.judging || d.linked || d.turned || d.wine);
   callback({ transactionId: transaction.id, actorId: snapshot.actorId, type: transaction.expected.type,
    id: transaction.expected.id, target: transaction.actual.target, status: complete && known ? deferred ? 'partial' : 'observed' : 'unresolved',
    scope: 'immediate-event', futureStatus: 'unobserved', immediateReward: complete && known ? raw : null,
    terminal, reason: !complete ? scope.ambiguous ? 'overlapping-action' : terminal ? 'terminal-event-incomplete' : 'event-incomplete' : !known ? 'unknown-relation' : deferred ? 'delayed-effect-unattributed' : null,
    reward: complete && known && !deferred ? raw : null, deltas, attribution: 'host-event-window', normalization: 12 });
  };
  scope.complete = completeScope;
  return () => completeScope(false);
 }
 function freezeTerminal() {
  for (const scope of active) {
   if (scope.terminalDeltas) continue;
   scope.terminalDeltas = scope.snapshot.rows.map(row => {
    const after = assets(row.player), delta = {};
    for (const name of Object.keys(after)) delta[name] = after[name] - row.assets[name];
    return { playerId: row.playerId, camp: row.camp, ...delta };
   });
  }
 }
 function flushTerminal() {
  freezeTerminal();
  for (const scope of [...active]) { try { scope.complete(true); } catch (_) {} }
 }
 return { before, observe, freezeTerminal, flushTerminal, reset() { generation++; active.clear(); } };
}
