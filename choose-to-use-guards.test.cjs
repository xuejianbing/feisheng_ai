const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const dir = path.join(__dirname,  'score', 'decision', 'override');
const use = fs.readFileSync(path.join(dir, 'use.js'), 'utf8');
const lifecycle = fs.readFileSync(path.join(dir, 'choiceLifecycle.js'), 'utf8');
function fixture() {
 const player = {}, failure = new Error('sentinel');
 const context = vm.createContext({
  game: {}, lib: {element: {GameEvent: class {setContent(fn) {this.run = fn;}}}},
  _shouldBlockTaoRescue: () => {throw failure;},
  get: {name: () => {throw failure;}},
  TAO_GUARD_KEY: Symbol(),
 });
 // Evaluate only the named functions under review, with explicit host mocks.
 vm.runInContext(lifecycle.slice(lifecycle.indexOf('export function bindChoiceLifecycle'), lifecycle.indexOf('// Selection/AI')).replaceAll('export function', 'function'), context);
 vm.runInContext(use.slice(use.indexOf('function _installTaoRescueGuard'), use.indexOf('export function installUseOverride')).replaceAll('export function', 'function'), context);
 return {player, failure, context};
}
for (const field of ['filterCard', 'filterTarget']) {
 for (const outcome of [true, false, 'throw']) {
  test(field + ' preserves native outcome ' + outcome, () => {
   const {player, failure, context} = fixture();
   const receiver = {}, args = [{}, player, {}, 'extra'];
   const calls = [];
   const ev = {[field]: function (...received) {
    calls.push([this, received]);
    if (outcome === 'throw') throw failure;
    return outcome;
   }};
   if (field === 'filterCard') context._installTaoRescueGuard(player, ev);
   else context.installAIUseTargetGuard(ev);
   const invoke = () => ev[field].apply(receiver, args);
   if (outcome === 'throw') assert.throws(invoke, error => error === failure);
   else assert.equal(invoke(), outcome);
   assert.deepEqual(calls, [[receiver, args]]);
  });
 }
}
test('nested filters restore in reverse order and cleanup is idempotent', () => {
 const {player, context} = fixture();
 const native = () => true, ev = {filterCard: native};
 const restore = context._installTaoRescueGuard(player, ev);
 const inner = ev.filterCard;
 const outer = () => false;
 const undo = context.patchChoiceField(ev, 'filterCard', outer);
 assert.equal(ev.filterCard, outer);
 undo();
 assert.equal(ev.filterCard, inner);
 restore();
 restore();
 assert.equal(ev.filterCard, native);
});
test('third-party wrapper keeps ownership and retained guard becomes inert', () => {
 const {player, context} = fixture();
 context._shouldBlockTaoRescue = () => true;
 const ev = {filterCard: () => true};
 const restore = context._installTaoRescueGuard(player, ev);
 const inner = ev.filterCard;
 const thirdParty = (...args) => inner(...args);
 ev.filterCard = thirdParty;
 assert.equal(thirdParty(), false);
 restore();
 assert.equal(ev.filterCard, thirdParty);
 assert.equal(thirdParty(), true);
});
test('setup exception cleans installed fields immediately and only once', async () => {
 const {player, context, failure} = fixture();
 const native = () => true, errors = [];
 const ev = {filterCard: native, after: [], pushHandler(fn) {this.begin = fn;}};
 assert.equal(context.bindChoiceLifecycle(ev, 'use', (event, trace, register) => {
  register(context._installTaoRescueGuard(player, event));
  register(context.patchChoiceField(event, 'filterCard', () => false));
  throw failure;
 }, undefined, error => errors.push(error)), true);
 ev.begin(ev, {state: 'begin'});
 assert.equal(ev.filterCard, native);
 assert.deepEqual(errors, [failure]);
 const replacement = () => false;
 ev.filterCard = replacement;
 await ev.after[0].run();
 assert.equal(ev.filterCard, replacement);
});
test('missing host target filter is left to host defaults', () => {
 const {context} = fixture();
 const ev = {};
 context.installAIUseTargetGuard(ev);
 assert.equal(Object.hasOwn(ev, 'filterTarget'), false);
});
