import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, sanitizeSave, STORAGE_KEY } from '../src/storage.js';
import { createLifecycle } from '../src/lifecycle.js';
const memory = raw => { let value = raw; return { getItem: () => value, setItem: (key, v) => { assert.equal(key, STORAGE_KEY); value = v; } }; };
test('missing, corrupt and inaccessible storage all fall back safely', () => {
  for (const raw of [null, 'bad json', 'null', '[]']) assert.equal(createStorage(() => memory(raw)).get().best.flow, 0);
  const store = createStorage(() => { throw new Error('blocked'); }); assert.equal(store.finish(120, 100, 'flow'), true); assert.equal(store.get().best.flow, 120);
});
test('save validation rejects unknown modes, nonfinite and negative values', () => {
  const save = sanitizeSave({ best: { flow: -4, rush: Infinity }, route: 'toString', difficulty: '__proto__', sound: 'true', runs: NaN }); assert.equal(save.route, 'ring'); assert.equal(save.difficulty, 'flow'); assert.equal(save.best.rush, 0); assert.equal(save.sound, false);
});
test('records remain separate by mode, never decrease, and survive reload', () => {
  const provider = memory(null); const s = createStorage(() => provider);
  assert.equal(s.finish(500.8, 400.5, 'flow'), true); assert.equal(s.finish(100, 80, 'flow'), false); s.finish(300, 200, 'rush');
  const reloaded = createStorage(() => provider).get(); assert.deepEqual(reloaded.best, { flow: 500, rush: 300 }); assert.equal(reloaded.runs, 3); assert.equal(reloaded.totalDistance, 680);
});
test('a continued run records only new distance and does not double-count runs', () => {
  const s = createStorage(() => memory(null)); s.finish(500, 400, 'flow'); s.finish(800, 100, 'flow', false);
  assert.equal(s.get().runs, 1); assert.equal(s.get().totalDistance, 500); assert.equal(s.get().best.flow, 800);
});
test('settings persist, getters return independent copies', () => {
  const s = createStorage(() => memory(null)); s.settings({ route: 'neon', sound: true, difficulty: 'rush' }); const data = s.get(); data.best.flow = 999;
  assert.equal(s.get().best.flow, 0); assert.equal(s.get().route, 'neon'); assert.equal(s.get().sound, true);
});
test('independent pause reasons cannot resume one another; duplicates are idempotent', () => {
  const changes = []; const lifecycle = createLifecycle(paused => changes.push(paused));
  lifecycle.pause('platform'); lifecycle.pause('platform'); lifecycle.pause('blur'); lifecycle.resume('blur'); lifecycle.resume('focus');
  assert.equal(lifecycle.paused, true); assert.deepEqual(lifecycle.reasons(), ['platform']); lifecycle.resume('platform'); assert.equal(lifecycle.paused, false); assert.deepEqual(changes, [true, true, true, false]);
});
