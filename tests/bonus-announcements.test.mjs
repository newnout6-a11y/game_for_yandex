import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Game } from '../src/game.js';
import { UI } from '../src/ui.js';
import { CONFIG } from '../src/config.js';
import { playerTrafficDepth } from '../src/traffic-physics.js';
import { createBonusAnnouncements, bonusAnnouncement, BONUS_ANNOUNCEMENT_LIMIT, BONUS_ANNOUNCEMENT_GAP_MS } from '../src/bonus-announcements.js';

/** One-shot controllable timers also retain cancelled callbacks for stale-callback tests. */
function timers() {
  let serial = 0;
  const pending = new Map(), all = new Map();
  return {
    pending, all,
    setTimer(callback, delay) { const id = ++serial; pending.set(id, { callback, delay }); all.set(id, callback); return id; },
    clearTimer(id) { pending.delete(id); },
    next() {
      const [id, job] = pending.entries().next().value || [];
      assert.ok(job, 'a one-shot callback is pending'); pending.delete(id); job.callback(); return job.delay;
    },
    drain() { let count = 0; while (pending.size && count++ < 100) this.next(); assert.equal(pending.size, 0, 'queue eventually becomes idle'); },
  };
}
function fixture(state = { phase: 'playing', revives: 0 }) {
  const clock = timers(), writes = []; let value = '';
  const element = { get textContent() { return value; }, set textContent(text) { value = text; writes.push(text); } };
  const announcer = createBonusAnnouncements(element, clock);
  announcer.sync(state, true);
  return { clock, writes, element, announcer, state };
}
const spoken = f => f.writes.filter(Boolean);
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

/** Execute the actual production callback with real Game and UI announcement methods. */
function integration() {
  const f = fixture(), ui = Object.create(UI.prototype), calls = { toast: [], bonus: [], audio: [], telemetry: [] };
  Object.assign(ui, { bonusAnnouncements: f.announcer, overlay: { hidden: true }, toast: message => calls.toast.push(message) });
  const sandbox = { Game, ui, renderer: { bonus: (...args) => calls.bonus.push(args), effect() {} },
    telemetry: { event: (...args) => calls.telemetry.push(args) }, audio: { tone: event => calls.audio.push(event) }, input: { releaseEmptyTouchBoost() {} } };
  vm.createContext(sandbox);
  vm.runInContext(main.slice(main.indexOf('const game=new Game('), main.indexOf('const lifecycle=')) + ';globalThis.game=game;', sandbox);
  const game = sandbox.game;
  game.start();
  Object.assign(game.state, { speed: 28, traffic: [], pickups: [], obstacles: [], nextSpawn: Infinity, nextEvent: Infinity });
  f.announcer.sync(game.state, true);
  return { ...f, ui, calls, game, sandbox };
}

test('reward wording preserves combo, configured goal/pickup and event points, with honest capped energy', () => {
  assert.match(bonusAnnouncement('near', 5), /Комбо ×5/);
  assert.match(bonusAnnouncement('charge'), new RegExp('\\+' + CONFIG.nitroPickup + '% энергии'));
  assert.match(bonusAnnouncement('charge'), /не выше 100%/);
  assert.equal(bonusAnnouncement('goal').replace(/\s/g, ''), '1500м.Цельпройдена.');
  assert.match(bonusAnnouncement('event-clear', { success: true, points: 450 }), /\+450 очков и \+15% нитро, запас не выше 100%/);
  for (const event of ['pass', 'cone', 'crash', 'boost-empty', 'event', 'roll', 'unknown']) assert.equal(bonusAnnouncement(event), '');
  for (const value of [null, { success: false, points: 400 }, { success: true, points: NaN }, { success: true, points: -1 }]) assert.equal(bonusAnnouncement('event-clear', value), '');
  for (const value of [undefined, 0, 1, 6, NaN, Infinity, '5']) assert.equal(bonusAnnouncement('near', value), '');
});

test('identical consecutive rewards are separated by a real blank interval and finish with no timer', () => {
  const f = fixture();
  assert.equal(f.announcer.announce('charge', undefined, f.state), true);
  assert.equal(f.announcer.announce('charge', undefined, f.state), true);
  assert.equal(f.clock.pending.size, 1);
  assert.equal(f.element.textContent, '');
  assert.equal(f.clock.next(), BONUS_ANNOUNCEMENT_GAP_MS);
  assert.equal(f.element.textContent, bonusAnnouncement('charge'));
  f.clock.next(); assert.equal(f.element.textContent, '');
  assert.equal(f.clock.next(), BONUS_ANNOUNCEMENT_GAP_MS);
  assert.equal(f.element.textContent, bonusAnnouncement('charge'));
  f.clock.drain();
  assert.deepEqual(f.writes, [bonusAnnouncement('charge'), '', bonusAnnouncement('charge'), '']);
  assert.equal(f.announcer.pendingCount, 0);
});

test('bursts retain only bounded recent rewards, keep at most one timer, and passes never enqueue', () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) {
    f.announcer.announce('event-clear', { success: true, points: i }, f.state);
    assert.ok(f.announcer.pendingCount <= BONUS_ANNOUNCEMENT_LIMIT);
    assert.equal(f.clock.pending.size, 1);
    assert.equal(f.announcer.announce('pass', undefined, f.state), false);
  }
  f.clock.drain();
  assert.deepEqual(spoken(f), Array.from({ length: BONUS_ANNOUNCEMENT_LIMIT }, (_, i) => bonusAnnouncement('event-clear', { success: true, points: 80 - BONUS_ANNOUNCEMENT_LIMIT + i })));
  for (let i = 0; i < 100; i++) f.announcer.sync(f.state, true);
  assert.equal(f.clock.pending.size, 0, 'sync does not start idle polling');
});

test('pause, crash, reset and revive clear visible/queued speech and cancel even already-delivered callbacks', () => {
  const transitions = [
    f => f.announcer.sync(f.state, false),
    f => { f.state.phase = 'crashed'; f.announcer.sync(f.state, true); },
    f => { f.state = { phase: 'playing', revives: 0 }; f.announcer.sync(f.state, true); },
    f => { f.state.revives++; f.announcer.sync(f.state, true); },
  ];
  for (const transition of transitions) for (const alreadySpoken of [false, true]) {
    const f = fixture(); f.announcer.announce('near', 2, f.state); f.announcer.announce('charge', undefined, f.state);
    if (alreadySpoken) f.clock.next();
    const stale = [...f.clock.pending.keys()].map(id => f.clock.all.get(id));
    transition(f); assert.equal(f.element.textContent, ''); assert.equal(f.clock.pending.size, 0); assert.equal(f.announcer.pendingCount, 0);
    for (const callback of stale) callback();
    assert.equal(f.element.textContent, ''); assert.equal(f.clock.pending.size, 0);
    f.state.phase = 'playing'; f.announcer.sync(f.state, true);
    assert.equal(f.clock.pending.size, 0, 'resume never replays discarded rewards');
    f.announcer.announce('near', 3, f.state); f.clock.drain();
    assert.equal(spoken(f).at(-1), bonusAnnouncement('near', 3));
  }
});

test('a pending callback independently rejects a crash/revive and disposal permanently disables scheduling', () => {
  for (const change of [f => { f.state.phase = 'crashed'; }, f => { f.state.revives++; }]) {
    const f = fixture(); f.announcer.announce('charge', undefined, f.state); change(f); f.clock.next();
    assert.deepEqual(spoken(f), []); assert.equal(f.clock.pending.size, 0);
  }
  const f = fixture(); f.announcer.announce('charge', undefined, f.state);
  const stale = [...f.clock.all.values()]; f.announcer.dispose(); f.announcer.dispose();
  f.announcer.sync(f.state, true); assert.equal(f.announcer.announce('goal', undefined, f.state), false);
  for (const callback of stale) callback();
  assert.equal(f.clock.pending.size, 0); assert.deepEqual(spoken(f), []);
  const missing = createBonusAnnouncements(null, f.clock); missing.sync(f.state, true);
  assert.equal(missing.announce('goal', undefined, f.state), false); assert.equal(f.clock.pending.size, 0);
});

test('real close-pass, pickup, goal and successful-event Game emissions reach the production hidden UI path', () => {
  const f = integration(), s = f.game.state;
  const car = { id: 10, kind: 'sedan', lane: 0, z: 0, speed: 0, cruiseSpeed: 0, passed: false };
  car.z = -playerTrafficDepth(car, s.playerBounds) + .05; s.traffic = [car];
  f.game.update(1 / 60, { throttle: 1 }); f.clock.drain();
  assert.equal(spoken(f).at(-1), bonusAnnouncement('near', 2));
  s.traffic = []; s.nitro = 95; s.pickups = [{ id: 11, lane: 1, z: 2.1 }];
  f.game.update(.1, { throttle: 1 }); f.clock.drain();
  assert.equal(s.nitro, 100); assert.equal(spoken(f).at(-1), bonusAnnouncement('charge'));
  s.distance = 1499.9; f.game.update(.1, { throttle: 1 }); f.clock.drain();
  assert.equal(spoken(f).at(-1), bonusAnnouncement('goal'));
  s.roadEvent = { id: 12, type: 'checkpoint', lane: 1, at: 1501, points: 300, title: 'Контрольная точка' };
  f.game.finishEvent(true); f.clock.drain();
  assert.equal(spoken(f).at(-1), bonusAnnouncement('event-clear', { success: true, points: 300 }));
  assert.deepEqual(f.calls.toast, []); assert.deepEqual(f.calls.audio.filter(e => ['near', 'charge', 'goal', 'event-clear'].includes(e)), ['near', 'charge', 'goal', 'event-clear']);
  assert.equal(f.calls.bonus.length, 4);
});

test('ordinary passes are silent; failed events and cone penalties retain the original warning path', () => {
  const f = integration(), s = f.game.state;
  s.x = s.lane = 2;
  const car = { id: 10, kind: 'sedan', lane: 0, z: 0, speed: 0, cruiseSpeed: 0, passed: false };
  car.z = -playerTrafficDepth(car, s.playerBounds) + .05; s.traffic = [car];
  f.game.update(1 / 60, { throttle: 1 });
  assert.equal(f.calls.bonus[0][0], 'pass'); assert.equal(f.clock.pending.size, 0); assert.deepEqual(spoken(f), []);
  s.roadEvent = { id: 12, type: 'checkpoint', lane: 1, at: 1501, points: 300, title: 'Контрольная точка' };
  f.game.finishEvent(false); f.game.onEvent('cone');
  assert.deepEqual(f.calls.toast, ['СОБЫТИЕ НЕ ПРОЙДЕНО', 'КОНУС · −50 ОЧКОВ']);
  assert.equal(f.clock.pending.size, 0); assert.deepEqual(spoken(f), []);
});

test('actual syncGameplay gates announcements on lifecycle pause, screen, phase, document and modal state', () => {
  const f = integration(), oldDocument = globalThis.document;
  globalThis.document = { hidden: false };
  try {
    const syncSource = main.slice(main.indexOf('function syncGameplay(){'), main.indexOf('/** Keep legacy driving HUD'));
    Object.assign(f.sandbox, { screen: 'playing', lifecycle: { paused: false }, syncMobileControls() {}, sdk: { gameplay() {} }, audio: { tone() {}, update() {} } });
    vm.runInContext(syncSource + ';globalThis.sync=syncGameplay;', f.sandbox);
    for (const blocker of ['pause', 'screen', 'phase', 'hidden', 'modal']) {
      f.sandbox.screen = 'playing'; f.sandbox.lifecycle.paused = false; f.game.state.phase = 'playing'; globalThis.document.hidden = false; f.ui.overlay.hidden = true;
      f.sandbox.sync(); f.game.onEvent('charge'); f.clock.next(); assert.ok(f.element.textContent);
      if (blocker === 'pause') f.sandbox.lifecycle.paused = true;
      if (blocker === 'screen') f.sandbox.screen = 'hub';
      if (blocker === 'phase') f.game.state.phase = 'crashed';
      if (blocker === 'hidden') globalThis.document.hidden = true;
      if (blocker === 'modal') f.ui.overlay.hidden = false;
      f.sandbox.sync(); assert.equal(f.element.textContent, ''); assert.equal(f.clock.pending.size, 0);
      f.game.onEvent('charge'); assert.equal(f.clock.pending.size, 0);
    }
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('real Game reset/revive and UI screen/modal/page boundaries never replay pending rewards', () => {
  const f = integration(), oldDocument = globalThis.document;
  const nodes = new Map(), node = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  globalThis.document = { hidden: false, getElementById: node, activeElement: null, body: { style: {} }, querySelector: () => node('topbar') };
  Object.assign(f.ui, { app: { dataset: {} }, renderSettingsHome: { append() {} }, renderSettingsElement: {},
    dialog: { innerHTML: '', scrollTop: 0, querySelector: () => ({ focus() {} }) } });
  try {
    const pending = () => { f.ui.syncBonusAnnouncements(f.game.state, true); f.ui.announceBonus('charge', undefined, f.game.state); f.clock.next(); assert.ok(f.element.textContent); };
    const cleared = () => { assert.equal(f.element.textContent, ''); assert.equal(f.clock.pending.size, 0); assert.equal(f.announcer.pendingCount, 0); };
    pending(); f.game.reset(); f.game.start(); f.ui.syncBonusAnnouncements(f.game.state, true); cleared();
    pending(); f.game.crash(); f.ui.syncBonusAnnouncements(f.game.state, false); cleared();
    assert.equal(f.game.revive(), true); f.ui.syncBonusAnnouncements(f.game.state, true); cleared();
    for (const screen of ['paused', 'menu', 'results']) { pending(); f.ui.setScreen(screen); cleared(); }
    pending(); f.ui.open('help', '<p>Управление</p>'); cleared(); f.ui.overlay.hidden = true;
    pending(); f.ui.clearBonusAnnouncements(false); cleared();
    pending(); f.ui.clearBonusAnnouncements(true); cleared();
    f.ui.syncBonusAnnouncements(f.game.state, true); assert.equal(f.ui.announceBonus('charge', undefined, f.game.state), false); cleared();
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('static shell uses one polite atomic screen-reader-only reward region, without hidden/aria-hidden', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tag = html.match(/<div\b[^>]*\bid="bonusAnnouncement"[^>]*>/g);
  assert.equal(tag?.length, 1);
  for (const attribute of ['class="visually-hidden"', 'role="status"', 'aria-live="polite"', 'aria-atomic="true"']) assert.ok(tag[0].includes(attribute));
  assert.doesNotMatch(tag[0], /(?:\s|^)hidden(?:[\s=>]|$)|aria-hidden|style=/);
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\.visually-hidden\s*\{([^}]+)\}/)?.[1];
  assert.match(rule, /clip-path:\s*inset\(50%\)/); assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden/);
  assert.match(main, /pagehide.*ui\.clearBonusAnnouncements\(!event\.persisted\)/);
  assert.match(main, /pageshow.*syncGameplay/);
});
