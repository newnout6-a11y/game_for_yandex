import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DrivingInput } from '../src/input.js';
import { Game } from '../src/game.js';
import { CONFIG } from '../src/config.js';
import { createLifecycle } from '../src/lifecycle.js';
import { UI, CockpitGlanceControls, boostPresentation, cameraShortcutAllowed, glanceShortcutAllowed } from '../src/ui.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, boost: false, flight: false, horn: false, roll: 0 };

/** Execute production functions verbatim, rather than maintaining a second control implementation. */
function applicationFunction(name) {
  const declaration = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(main);
  assert.ok(declaration, 'production function exists: ' + name);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let at = main.indexOf('{', declaration.index); at < main.length; at++) {
    const char = main[at], next = main[at + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; at++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = null; continue; }
    if (char === '/' && next === '/') { lineComment = true; at++; continue; }
    if (char === '/' && next === '*') { blockComment = true; at++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return main.slice(declaration.index, at + 1);
  }
  assert.fail('unterminated production function: ' + name);
}

function sourceBetween(startMarker, endMarker) {
  const start = main.indexOf(startMarker), end = main.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'production binding markers exist: ' + startMarker);
  return main.slice(start, end);
}

/** A DOM/event shell only: ownership, gating, physics, lifecycle and HUD all remain production code. */
function element() {
  return {
    disabled: false, hidden: false, dataset: {}, attributes: {}, style: {}, textContent: '',
    listeners: new Map(), captures: [], failCapture: false,
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(handler);
    },
    setPointerCapture(id) { if (this.failCapture) throw new Error('No active capture'); this.captures.push(id); },
    closest() { return null; },
    emit(name, overrides = {}) {
      const event = {
        target: this, code: '', pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true,
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
        ...overrides,
      };
      for (const handler of this.listeners.get(name) || []) handler(event);
      return event;
    },
  };
}

function withDocument(document, operation) {
  const previous = globalThis.document;
  globalThis.document = document;
  try { return operation(); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}

function harness(state = {}) {
  const elements = new Map();
  const byId = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = element(), window = element();
  document.getElementById = byId; window.navigator = { maxTouchPoints: 2 };
  const effects = { renders: 0, scheduled: 0, pauses: 0, orbitCancels: 0, syncs: 0, events: [], audioEvents: [], visualEvents: [] };
  const hud = Object.create(UI.prototype);
  const s = {
    byId, document, window, Game, game: null, input: new DrivingInput(), createLifecycle,
    glance: new CockpitGlanceControls(() => {}), screen: 'playing', busy: false,
    garageOrbitInput: { cancel() { effects.orbitCancels++; } },
    ui: { overlay: { hidden: true }, hud: state => withDocument(document, () => hud.hud(state)), pause() { effects.pauses++; }, toast() {} },
    cameraShortcutAllowed, glanceShortcutAllowed,
    syncGlanceControls() {}, toggleCamera() { assert.fail('driving inputs must not toggle camera'); },
    startRun() { assert.fail('driving inputs must not start another run'); },
    applyScreen() {}, syncGameplay() { effects.syncs++; }, showResults() { s.screen = 'results'; },
    innerWidth: 551, innerHeight: 360, coarsePointer: true, mobileControls: true, matchMedia: () => ({ matches: s.coarsePointer }),
    previous: 0, orientationBlocked: false, garageScene: null, garageDirty: false,
    renderer: {
      reducedMotion: false, render() { effects.renders++; },
      effect(event) { effects.visualEvents.push(event); },
    },
    loading: {}, garageUI: { settingsOpen: false }, telemetry: null, crashElapsed: 0,
    tab: 'fleet', fleetVisibilityDirty: false, fleetTouchRemaining: 0, fleetMiniatures: null,
    audio: { update() {}, tone(event) { effects.audioEvents.push(event); } }, requestAnimationFrame() { effects.scheduled++; },
  };
  vm.createContext(s);
  // Construct Game with the entire real main.js event callback, including synchronous depletion cleanup.
  const gameExpression = sourceBetween('const game=new Game(', 'const lifecycle=').replace(/^const game=/, '');
  const game = s.game = vm.runInContext(gameExpression, s);
  const onEvent = game.onEvent;
  game.onEvent = (event, value) => {
    onEvent(event, value);
    effects.events.push({ event, elapsed: game.state.elapsed, nitro: game.state.nitro, controls: s.input.read() });
  };
  game.start();
  Object.assign(game.state, { speed: 20, traffic: [], pickups: [], obstacles: [], nextSpawn: Infinity, nextEvent: Infinity }, state);
  for (const name of ['clearInput', 'pauseRun', 'tick', 'syncMobileControls']) vm.runInContext(applicationFunction(name), s);
  // Strip only the declaration; its actual lifecycle callback closes over this sandbox.
  const lifecycleExpression = sourceBetween('const lifecycle=createLifecycle(', 'const ads=').replace(/^const lifecycle=/, '');
  s.lifecycle = vm.runInContext(lifecycleExpression, s);
  vm.runInContext(sourceBetween("document.addEventListener('keydown', event => {", '// Dedicated held glances'), s);
  vm.runInContext(sourceBetween("for (const name of ['pointerup', 'pointercancel']) window.addEventListener", 'let gesture = null;'), s);
  vm.runInContext('let gesture = null;\n' + sourceBetween("document.addEventListener('visibilitychange',", "sdk.on('game_api_pause'"), s);
  vm.runInContext(sourceBetween("window.addEventListener('resize',", '/** Loading completion'), s);
  let time = 0;
  return {
    s, effects, button: byId,
    frame(dt = .1) { time += dt * 1000; s.tick(time); return game.state; },
    hud() { s.ui.hud(game.state); },
    down(id, pointerId = 1, extras = {}) { return byId(id).emit('pointerdown', { pointerId, ...extras }); },
    up(id, pointerId = 1, event = 'pointerup') { return byId(id).emit(event, { pointerId }); },
  };
}

function closeTo(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} should equal ${expected}`); }

test('touch nitro has one independent owner for gas and boost; ordinary boost never adds gas', () => {
  const input = new DrivingInput();
  input.setTouch('boost', 'touch-1', true);
  assert.equal(input.held.size, 1);
  assert.equal(input.held.get('touch-1'), 'touchBoost');
  assert.deepEqual(input.read(), { ...NEUTRAL, throttle: 1, boost: true });
  assert.equal(input.active('gas'), true); assert.equal(input.active('boost'), true);
  input.setTouch('boost', 'touch-2', true);
  input.setTouch('boost', 'touch-1', false);
  assert.equal(input.held.size, 1); assert.equal(input.read().throttle, 1);
  input.release('touch-2'); assert.deepEqual(input.read(), NEUTRAL);
  input.set('boost', 'mouse', true); input.key('Space', true);
  assert.deepEqual(input.read(), { ...NEUTRAL, boost: true });
  input.release('mouse'); assert.equal(input.read().boost, true);
  input.key('Space', false); assert.deepEqual(input.read(), NEUTRAL);
});

test('real arrow bindings accept secondary fingers and cancel opposing arrows without cancelling owners', () => {
  const h = harness(), { input } = h.s;
  h.down('leftBtn', 10); h.down('leftBtn', 11, { isPrimary: false });
  assert.equal(input.read().steer, -1);
  h.down('rightBtn', 12, { isPrimary: false });
  assert.equal(input.read().steer, 0);
  h.up('leftBtn', 10); assert.equal(input.read().steer, 0);
  h.up('leftBtn', 11); assert.equal(input.read().steer, 1);
  h.down('gasBtn', 13, { isPrimary: false }); h.down('brakeBtn', 14, { isPrimary: false });
  assert.deepEqual(input.read(), { ...NEUTRAL, steer: 1, throttle: 1, brake: 1 });
  h.up('rightBtn', 12); h.up('brakeBtn', 14);
  assert.deepEqual(input.read(), { ...NEUTRAL, throttle: 1 });
  assert.deepEqual(h.button('leftBtn').captures, [10, 11]);
  assert.deepEqual(h.button('rightBtn').captures, [12]);
  h.up('gasBtn', 13); assert.deepEqual(input.read(), NEUTRAL);
});

test('a touch nitro hold alone produces real acceleration and energy drain beyond the gas-only baseline', () => {
  const nitro = harness(), gas = harness();
  const press = nitro.down('boostBtn', 7, { isPrimary: false }); gas.down('gasBtn', 8);
  assert.equal(press.prevented, true);
  nitro.frame(); gas.frame();
  assert.equal(nitro.s.game.state.throttle, 1); assert.equal(nitro.s.game.state.boosting, true);
  assert.equal(gas.s.game.state.boosting, false); closeTo(gas.s.game.state.nitro, 60);
  closeTo(nitro.s.game.state.nitro, 60 - CONFIG.nitroDrain * .1);
  assert.ok(nitro.s.game.state.speed > gas.s.game.state.speed + .6);
  assert.ok(nitro.s.game.state.distance > gas.s.game.state.distance);
  assert.equal(nitro.button('boostBtn').dataset.boostState, 'active');
  assert.equal(nitro.button('boostStatus').textContent, 'УСКОРЕНИЕ');
  assert.equal(nitro.button('boostBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(nitro.button('gasBtn').dataset.held, 'true');
});

test('steering plus nitro works with two fingers; releasing either preserves an independent gas hold', () => {
  const h = harness();
  h.down('rightBtn', 1); h.down('boostBtn', 2, { isPrimary: false }); h.frame();
  assert.equal(h.s.game.state.boosting, true); assert.ok(h.s.game.state.x > 1);
  h.down('gasBtn', 3, { isPrimary: false }); h.up('boostBtn', 2);
  assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: 1, throttle: 1 });
  const reserve = h.s.game.state.nitro; h.frame();
  assert.equal(h.s.game.state.boosting, false); closeTo(h.s.game.state.nitro, reserve);
  h.up('rightBtn', 1); assert.deepEqual(h.s.input.read(), { ...NEUTRAL, throttle: 1 });
  h.up('gasBtn', 3); assert.deepEqual(h.s.input.read(), NEUTRAL);
});

for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`real ${event} removes only its touch nitro owner, including secondary same-button fingers`, () => {
    const h = harness();
    h.down('boostBtn', 20); h.down('boostBtn', 21, { isPrimary: false });
    h.down('leftBtn', 30); h.down('gasBtn', 40);
    h.up('boostBtn', 20, event);
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: -1, throttle: 1, boost: true });
    assert.equal(h.s.input.held.has('pointer-20'), false); assert.equal(h.s.input.held.has('pointer-21'), true);
    h.up('boostBtn', 21, event);
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: -1, throttle: 1 });
    h.frame(); assert.equal(h.s.game.state.boosting, false); closeTo(h.s.game.state.nitro, 60);
    h.up('gasBtn', 40, event); h.up('leftBtn', 30, event);
    assert.deepEqual(h.s.input.read(), NEUTRAL);
  });
}

for (const event of ['pointerup', 'pointercancel']) {
  test(`window ${event} releases off-button touch nitro even when pointer capture failed`, () => {
    const h = harness(); h.button('boostBtn').failCapture = true;
    h.down('boostBtn', 7); h.down('rightBtn', 8); h.down('gasBtn', 9);
    assert.equal(h.s.input.read().boost, true);
    h.s.window.emit(event, { pointerId: 999 }); assert.equal(h.s.input.read().boost, true);
    h.s.window.emit(event, { pointerId: 7 });
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: 1, throttle: 1 });
    h.s.window.emit(event, { pointerId: 9 }); assert.equal(h.s.input.read().throttle, 0);
    h.s.window.emit(event, { pointerId: 8 }); assert.deepEqual(h.s.input.read(), NEUTRAL);
  });
}

test('mouse, pen and focused keyboard boost preserve their existing no-auto-throttle semantics', () => {
  for (const pointerType of ['mouse', 'pen']) {
    const h = harness(); h.down('boostBtn', 1, { pointerType });
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, boost: true });
    h.frame(); assert.equal(h.s.game.state.boosting, false); closeTo(h.s.game.state.nitro, 60);
    h.up('boostBtn'); assert.deepEqual(h.s.input.read(), NEUTRAL);
  }
  for (const code of ['Enter', 'Space']) {
    const h = harness(), button = h.button('boostBtn');
    const press = button.emit('keydown', { code });
    assert.equal(press.prevented, true); assert.equal(press.stopped, true);
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, boost: true });
    h.down('gasBtn', 4); h.frame(); assert.equal(h.s.game.state.boosting, true);
    const release = button.emit('keyup', { code });
    assert.equal(release.prevented, true); assert.equal(release.stopped, true);
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, throttle: 1 });
    button.emit('keydown', { code }); button.emit('blur');
    assert.deepEqual(h.s.input.read(), { ...NEUTRAL, throttle: 1 });
  }
});

test('actual document keyboard arrows and Space coexist with independent touch owners', () => {
  const h = harness(), doc = h.s.document;
  assert.equal(doc.emit('keydown', { code: 'Space' }).prevented, true);
  assert.deepEqual(h.s.input.read(), { ...NEUTRAL, boost: true });
  doc.emit('keydown', { code: 'ArrowUp' }); doc.emit('keydown', { code: 'ArrowLeft' });
  h.down('boostBtn', 7); h.down('rightBtn', 8);
  assert.deepEqual(h.s.input.read(), { ...NEUTRAL, throttle: 1, boost: true });
  h.up('boostBtn', 7); assert.equal(h.s.input.read().boost, true);
  doc.emit('keyup', { code: 'Space' }); assert.equal(h.s.input.read().boost, false);
  doc.emit('keyup', { code: 'ArrowLeft' }); assert.equal(h.s.input.read().steer, 1);
  h.up('rightBtn', 8); assert.equal(h.s.input.read().steer, 0);
  doc.emit('keydown', { code: 'ArrowDown' }); assert.equal(h.s.input.read().brake, 1);
  h.s.ui.overlay.hidden = false;
  doc.emit('keyup', { code: 'ArrowUp' }); doc.emit('keyup', { code: 'ArrowDown' });
  assert.deepEqual(h.s.input.read(), NEUTRAL, 'keyup must still clear owners after a modal opens');
});

test('disabled, aria-disabled, paused, wrong-screen and non-primary-button gates reject new owners', () => {
  const blockers = [
    h => { h.button('boostBtn').disabled = true; },
    h => { h.button('boostBtn').setAttribute('aria-disabled', 'true'); },
    h => { h.s.lifecycle.pause('orientation'); },
    ...['loading', 'hub', 'garage', 'paused', 'results', 'unknown'].map(screen => h => { h.s.screen = screen; }),
  ];
  for (const block of blockers) {
    const h = harness(); block(h);
    h.down('boostBtn', 7, { isPrimary: false });
    h.button('boostBtn').emit('keydown', { code: 'Space' });
    assert.deepEqual(h.s.input.read(), NEUTRAL); assert.deepEqual(h.button('boostBtn').captures, []);
  }
  for (const button of [1, 2]) {
    const h = harness(); h.down('boostBtn', 7, { pointerType: 'mouse', button });
    assert.deepEqual(h.s.input.read(), NEUTRAL);
  }
  const h = harness(); h.down('boostBtn', 7); h.button('boostBtn').disabled = true;
  h.up('boostBtn', 7); assert.deepEqual(h.s.input.read(), NEUTRAL, 'disabled buttons must still release an existing owner');
});

test('same-landscape viewport resize preserves exact held touch owners and continuous driving', () => {
  const h = harness(); h.down('leftBtn', 41); h.down('boostBtn', 42); h.frame(.1);
  const owners = [...h.s.input.held], before = h.s.game.state.nitro;
  const cancels = h.effects.orbitCancels;
  for (const [width, height] of [[560, 315], [551, 330], [551, 360], [667, 375]]) {
    h.s.innerWidth = width; h.s.innerHeight = height; h.s.window.emit('resize');
    assert.deepEqual([...h.s.input.held], owners, 'resize must retain original IDs, not repress replacements');
    assert.equal(h.effects.orbitCancels, cancels); assert.equal(h.s.mobileControls, true);
    h.frame(.1); assert.equal(h.s.game.state.boosting, true); assert.equal(h.s.game.state.throttle, 1);
    assert.equal(h.s.input.read().steer, -1);
  }
  closeTo(h.s.game.state.nitro, before - CONFIG.nitroDrain * .4);
  h.up('leftBtn', 41); assert.equal(h.s.input.read().boost, true); assert.equal(h.s.input.read().steer, 0);
  h.up('boostBtn', 42); assert.deepEqual(h.s.input.read(), NEUTRAL);
});

test('actual eligibility and portrait changes still clear holds and cannot restore them on resize back', () => {
  for (const change of [
    s => { s.innerWidth = 360; s.innerHeight = 551; },
    s => { s.coarsePointer = false; },
    s => { s.window.navigator.maxTouchPoints = 0; },
    s => { s.orientationBlocked = true; },
  ]) {
    const h = harness(); h.down('rightBtn', 1); h.down('boostBtn', 2); change(h.s); h.s.window.emit('resize');
    assert.equal(h.s.mobileControls, false); assert.deepEqual(h.s.input.read(), NEUTRAL);
    h.s.innerWidth = 551; h.s.innerHeight = 360; h.s.coarsePointer = true;
    h.s.window.navigator.maxTouchPoints = 2; h.s.orientationBlocked = false; h.s.window.emit('resize');
    assert.equal(h.s.mobileControls, true); assert.deepEqual(h.s.input.read(), NEUTRAL);
    h.frame(.1); assert.equal(h.s.game.state.boosting, false); assert.equal(h.s.game.state.throttle, 0);
  }
});

test('production clearInput forgets arrows, assisted nitro, keyboard, analog, swipe and horn holds', () => {
  const h = harness(), { input, game, glance } = h.s;
  h.down('boostBtn', 1); h.down('leftBtn', 2); input.key('KeyW', true); input.key('KeyH', true);
  input.setAnalog('legacy-analog', { throttle: 1, steer: .5 });
  glance.setEnabled(true); glance.set(-1, 'pointer-3', true); game.steer(-1); h.frame();
  assert.ok(game.pulseTime > 0); assert.equal(game.state.hornHeld, true);
  const before = { speed: game.state.speed, nitro: game.state.nitro };
  h.s.clearInput();
  assert.deepEqual(input.read(), NEUTRAL); assert.equal(input.held.size, 0); assert.equal(input.analog.size, 0);
  assert.equal(game.pulseTime, 0); assert.equal(game.state.hornHeld, false);
  assert.equal(glance.direction, 0); assert.equal(glance.sources.size, 0); assert.equal(h.effects.orbitCancels, 1);
  assert.equal(game.state.speed, before.speed); assert.equal(game.state.nitro, before.nitro);
});

for (const boundary of ['blur', 'hidden', 'orientation']) {
  test(`real ${boundary} lifecycle boundary clears touch boost and cannot revive it on resume`, () => {
    const h = harness(); h.down('boostBtn', 1); h.down('leftBtn', 2); h.frame();
    if (boundary === 'blur') h.s.window.emit('blur');
    else if (boundary === 'hidden') { h.s.document.hidden = true; h.s.document.emit('visibilitychange'); }
    else h.s.lifecycle.pause('orientation');
    assert.equal(h.s.lifecycle.paused, true); assert.deepEqual(h.s.input.read(), NEUTRAL);
    const elapsed = h.s.game.state.elapsed, reserve = h.s.game.state.nitro;
    h.frame(); assert.equal(h.s.game.state.elapsed, elapsed); assert.equal(h.s.game.state.nitro, reserve);
    h.down('boostBtn', 1); assert.deepEqual(h.s.input.read(), NEUTRAL);
    if (boundary === 'blur') h.s.window.emit('focus');
    else if (boundary === 'hidden') { h.s.document.hidden = false; h.s.document.emit('visibilitychange'); }
    else h.s.lifecycle.resume('orientation');
    h.s.lifecycle.resume('user'); h.s.screen = 'playing'; h.frame();
    assert.deepEqual(h.s.input.read(), NEUTRAL); assert.equal(h.s.game.state.boosting, false);
    assert.equal(h.s.game.state.throttle, 0); assert.equal(h.s.game.state.nitro, reserve);
  });
}

test('actual tick never advances gameplay on a non-playing screen or while paused', () => {
  for (const screen of ['hub', 'garage', 'results', 'paused']) {
    const h = harness(); h.down('boostBtn', 1); h.s.screen = screen;
    h.frame(); assert.equal(h.s.game.state.elapsed, 0); assert.equal(h.s.game.state.nitro, 60);
  }
  const h = harness(); h.s.lifecycle.pause('orientation');
  h.s.input.setTouch('boost', 'stale-test-source', true); h.frame();
  assert.equal(h.s.game.state.elapsed, 0); assert.equal(h.s.game.state.nitro, 60);
});

test('brake wins over touch nitro without draining energy; releasing brake restores the remaining hold', () => {
  const h = harness(), baseline = harness();
  h.down('boostBtn', 1); h.down('brakeBtn', 2); baseline.down('brakeBtn', 3);
  h.frame(); baseline.frame();
  assert.equal(h.s.game.state.braking, true); assert.equal(h.s.game.state.throttle, 0);
  assert.equal(h.s.game.state.boosting, false); closeTo(h.s.game.state.nitro, 60);
  closeTo(h.s.game.state.speed, baseline.s.game.state.speed);
  assert.ok(h.s.game.state.speed < 20); assert.equal(h.button('boostBtn').dataset.boostState, 'braking');
  h.up('brakeBtn', 2); h.frame();
  assert.equal(h.s.game.state.boosting, true); assert.equal(h.s.game.state.throttle, 1);
  closeTo(h.s.game.state.nitro, 60 - CONFIG.nitroDrain * .1);
});

test('a held touch nitro accelerates from rest without charge loss until the real speed threshold', () => {
  const h = harness({ speed: 0 }); h.down('boostBtn', 1); h.frame(1 / 120);
  assert.ok(h.s.game.state.speed > 0); assert.equal(h.s.game.state.throttle, 1);
  assert.equal(h.s.game.state.boosting, false); assert.equal(h.s.game.state.nitro, 60);
  assert.equal(h.button('boostBtn').dataset.boostState, 'too-slow');
  let frames = 1;
  while (!h.s.game.state.boosting && frames++ < 240) {
    const priorSpeed = h.s.game.state.speed, priorReserve = h.s.game.state.nitro;
    h.frame(1 / 120);
    if (priorSpeed <= 5) { assert.equal(h.s.game.state.boosting, false); closeTo(h.s.game.state.nitro, priorReserve); }
  }
  assert.ok(frames < 240, 'a sustained touch must eventually reach boost speed');
  assert.equal(h.s.game.state.boosting, true); assert.ok(h.s.game.state.nitro < 60);
  const edge = harness({ speed: 5 }); edge.down('boostBtn', 2); edge.frame(1 / 120);
  assert.equal(edge.s.game.state.boosting, false); closeTo(edge.s.game.state.nitro, 60);
  edge.frame(1 / 120); assert.equal(edge.s.game.state.boosting, true);
});

test('airborne touch nitro cannot add boost or extra energy drain to flight', () => {
  const falling = harness({ altitude: 1 }); falling.down('boostBtn', 1); falling.frame();
  assert.ok(falling.s.game.state.altitude > .2); assert.equal(falling.s.game.state.boosting, false);
  closeTo(falling.s.game.state.nitro, 60); assert.equal(falling.button('boostBtn').dataset.boostState, 'airborne');
  const nitro = harness(), baseline = harness();
  nitro.down('boostBtn', 1); nitro.down('flightBtn', 2);
  baseline.down('gasBtn', 3); baseline.down('flightBtn', 4);
  nitro.frame(); baseline.frame();
  assert.equal(nitro.s.game.state.flying, true); assert.equal(nitro.s.game.state.boosting, false);
  assert.ok(nitro.s.game.state.nitro < 60, 'flight uses its own energy budget');
  closeTo(nitro.s.game.state.nitro, baseline.s.game.state.nitro);
  closeTo(nitro.s.game.state.speed, baseline.s.game.state.speed);
  assert.equal(nitro.button('boostBtn').dataset.boostState, 'airborne');
});

test('tick disarms depleted touch nitro before HUD/telemetry and a real pickup cannot revive its stale owner', () => {
  const h = harness({ nitro: 1 });
  h.down('boostBtn', 1); h.down('boostBtn', 2, { isPrimary: false });
  const observations = [];
  h.s.telemetry = { event() {}, observe(state) { observations.push({ nitro: state.nitro, controls: h.s.input.read() }); } };
  h.frame();
  assert.equal(h.s.game.state.nitro, 0); assert.deepEqual(h.s.input.read(), NEUTRAL);
  assert.equal(h.s.input.held.size, 0); assert.deepEqual(observations[0], { nitro: 0, controls: NEUTRAL });
  assert.equal(h.button('boostBtn').disabled, true); assert.equal(h.button('boostBtn').dataset.boostState, 'empty');
  assert.equal(h.button('boostBtn').dataset.held, 'false'); assert.equal(h.button('boostBtn').getAttribute('aria-pressed'), 'false');
  h.down('boostBtn', 3); assert.deepEqual(h.s.input.read(), NEUTRAL, 'empty disabled button cannot acquire a new owner');
  h.s.game.state.pickups.push({ z: 1, lane: h.s.game.state.x, collected: false });
  h.frame();
  assert.equal(h.s.game.state.charges, 1); closeTo(h.s.game.state.nitro, CONFIG.nitroPickup);
  assert.equal(h.s.game.state.boosting, false); assert.equal(h.s.game.state.throttle, 0);
  assert.deepEqual(h.s.input.read(), NEUTRAL); assert.equal(h.button('boostBtn').disabled, false);
  assert.equal(h.button('boostBtn').dataset.boostState, 'ready');
  h.frame(); closeTo(h.s.game.state.nitro, CONFIG.nitroPickup); assert.equal(h.s.game.state.boosting, false);
  h.up('boostBtn', 1); h.up('boostBtn', 2); h.down('boostBtn', 4); h.frame();
  assert.equal(h.s.game.state.boosting, true); assert.ok(h.s.game.state.nitro < CONFIG.nitroPickup);
});

test('depletion removes touch boost only, preserving explicit gas, steering, mouse and keyboard owners', () => {
  const h = harness({ nitro: 1 });
  h.down('boostBtn', 1); h.down('boostBtn', 2, { pointerType: 'mouse' });
  h.down('gasBtn', 3); h.down('rightBtn', 4);
  h.s.document.emit('keydown', { code: 'Space' }); h.frame();
  assert.equal(h.s.input.held.has('pointer-1'), false);
  for (const source of ['pointer-2', 'pointer-3', 'pointer-4', 'Space']) assert.equal(h.s.input.held.has(source), true);
  assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: 1, throttle: 1, boost: true });
  h.up('boostBtn', 2); h.s.document.emit('keyup', { code: 'Space' });
  assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: 1, throttle: 1 });
  h.s.input.releaseEmptyTouchBoost(0); h.s.input.releaseEmptyTouchBoost(-1);
  assert.deepEqual(h.s.input.read(), { ...NEUTRAL, steer: 1, throttle: 1 });
  const fresh = new DrivingInput(); fresh.setTouch('boost', 'held', true); fresh.releaseEmptyTouchBoost(.001);
  assert.deepEqual(fresh.read(), { ...NEUTRAL, throttle: 1, boost: true });
});

test('same-update depletion and pickup disarm touch nitro before all subsequent physics substeps', () => {
  const h = harness({ speed: 20, nitro: .1, pickups: [{ lane: 1, z: 2.1 }] });
  h.down('boostBtn', 1);
  const substeps = [], game = h.s.game, step = game.step.bind(game);
  // Observe the real substeps without replacing their control normalization, event dispatch or physics.
  game.step = (dt, controls) => {
    step(dt, controls);
    substeps.push({ controls: { ...controls }, nitro: game.state.nitro, boosting: game.state.boosting, throttle: game.state.throttle });
  };
  h.frame(.1);
  assert.equal(substeps.length, 12);
  assert.deepEqual(h.effects.events.map(({ event }) => event), ['boost-empty', 'charge']);
  assert.equal(h.effects.events[0].elapsed, h.effects.events[1].elapsed, 'depletion and pickup occur in the same first substep');
  assert.equal(h.effects.events[0].nitro, 0);
  assert.deepEqual(h.effects.events[0].controls, NEUTRAL, 'the production onEvent branch clears touch ownership synchronously');
  closeTo(substeps[0].nitro, CONFIG.nitroPickup);
  assert.equal(substeps[0].controls.boost, true);
  for (const state of substeps.slice(1)) {
    assert.deepEqual(state.controls, NEUTRAL, 'main tick must resample real input for each remaining substep');
    assert.equal(state.boosting, false); assert.equal(state.throttle, 0);
    closeTo(state.nitro, CONFIG.nitroPickup);
  }
  assert.equal(game.state.charges, 1); assert.equal(h.s.input.held.size, 0);
  assert.equal(game.state.boosting, false); assert.equal(game.state.throttle, 0);
  closeTo(game.state.nitro, CONFIG.nitroPickup);
  assert.equal(h.button('boostBtn').disabled, false); assert.equal(h.button('boostBtn').dataset.boostState, 'ready');
  assert.equal(h.button('boostBtn').getAttribute('aria-pressed'), 'false');
  h.frame(.1);
  assert.deepEqual(h.s.input.read(), NEUTRAL); assert.equal(game.state.boosting, false);
  closeTo(game.state.nitro, CONFIG.nitroPickup);
});

test('same-update depletion preserves independent gas, W, Space and mouse ownership without restoring touch assistance', () => {
  const owners = [
    { source: 'pointer-3', action: 'gas', press: h => h.down('gasBtn', 3) },
    { source: 'KeyW', action: 'gas', press: h => h.s.document.emit('keydown', { code: 'KeyW' }) },
    { source: 'Space', action: 'boost', press: h => h.s.document.emit('keydown', { code: 'Space' }) },
    { source: 'pointer-4', action: 'boost', press: h => h.down('boostBtn', 4, { pointerType: 'mouse' }) },
  ];
  for (const retained of [...owners.map(owner => [owner]), owners]) {
    const h = harness({ speed: 20, nitro: .1, pickups: [{ lane: 1, z: 2.1 }] });
    h.down('boostBtn', 1);
    for (const owner of retained) owner.press(h);
    const expected = { ...NEUTRAL, throttle: Number(retained.some(owner => owner.action === 'gas')), boost: retained.some(owner => owner.action === 'boost') };
    h.frame(.1);
    assert.equal(h.s.game.state.charges, 1); assert.equal(h.s.input.held.has('pointer-1'), false);
    assert.equal(h.s.input.held.size, retained.length);
    for (const { source, action } of retained) assert.equal(h.s.input.held.get(source), action);
    assert.deepEqual(h.effects.events.find(({ event }) => event === 'boost-empty').controls, expected);
    assert.deepEqual(h.s.input.read(), expected);
    assert.equal(h.s.game.state.throttle, expected.throttle);
    assert.equal(h.s.game.state.boosting, Boolean(expected.throttle && expected.boost));
    if (expected.throttle && expected.boost) {
      closeTo(h.s.game.state.nitro, CONFIG.nitroPickup - CONFIG.nitroDrain * 11 / 120);
    } else {
      closeTo(h.s.game.state.nitro, CONFIG.nitroPickup, 'one remaining ordinary input cannot recreate touch gas+boost');
    }
    const reserve = h.s.game.state.nitro; h.frame(.1);
    assert.deepEqual(h.s.input.read(), expected);
    assert.equal(h.s.game.state.boosting, Boolean(expected.throttle && expected.boost));
    closeTo(h.s.game.state.nitro, reserve - (expected.throttle && expected.boost ? CONFIG.nitroDrain * .1 : 0));
  }
});

test('flight exhausting the shared reserve disarms touch nitro before a same-substep pickup refills it', () => {
  const fixture = () => ({ speed: 20, altitude: 1, nitro: .1, pickups: [{ lane: 1, z: 2.1 }] });
  const h = harness(fixture()), baseline = harness(fixture());
  h.down('boostBtn', 1); h.down('flightBtn', 2); baseline.down('flightBtn', 2);
  const game = h.s.game, substeps = [], step = game.step.bind(game), flightOnly = { ...NEUTRAL, flight: true };
  game.step = (dt, controls) => {
    step(dt, controls);
    substeps.push({ controls: { ...controls }, nitro: game.state.nitro, boosting: game.state.boosting, throttle: game.state.throttle });
  };
  h.frame(.1); baseline.frame(.1);
  assert.equal(substeps.length, 12);
  assert.deepEqual(h.effects.events.map(({ event }) => event), ['boost-empty', 'charge']);
  assert.equal(h.effects.events[0].nitro, 0);
  assert.equal(h.effects.events[0].elapsed, h.effects.events[1].elapsed);
  assert.deepEqual(h.effects.events[0].controls, flightOnly, 'flight depletion must clear touch assistance before collecting the refill');
  closeTo(substeps[0].nitro, CONFIG.nitroPickup);
  assert.equal(substeps[0].controls.boost, true); assert.equal(substeps[0].boosting, false);
  for (const state of substeps.slice(1)) {
    assert.deepEqual(state.controls, flightOnly); assert.equal(state.boosting, false); assert.equal(state.throttle, 0);
  }
  assert.equal(game.state.charges, 1); assert.equal(h.s.input.held.has('pointer-1'), false);
  assert.equal(h.s.input.held.get('pointer-2'), 'flight'); assert.equal(h.s.input.held.size, 1);
  assert.equal(game.state.boosting, false); assert.equal(game.state.throttle, 0);
  assert.ok(game.state.nitro > 0 && game.state.nitro < CONFIG.nitroPickup, 'only the still-held flight control consumes the refill');
  closeTo(game.state.nitro, baseline.s.game.state.nitro);
  assert.equal(h.button('boostBtn').getAttribute('aria-pressed'), 'false');
  h.frame(.1); baseline.frame(.1);
  assert.deepEqual(h.s.input.read(), flightOnly); assert.equal(game.state.boosting, false); assert.equal(game.state.throttle, 0);
  closeTo(game.state.nitro, baseline.s.game.state.nitro);
  h.up('flightBtn', 2); h.frame(.1); assert.deepEqual(h.s.input.read(), NEUTRAL);
  assert.equal(game.state.boosting, false); assert.equal(game.state.throttle, 0);
});

test('boost-empty is service-only for ground and flight depletion while a normal charge reaches feedback and telemetry', () => {
  for (const altitude of [0, 1]) {
    const h = harness({ speed: 20, altitude, nitro: .1, pickups: [{ lane: 1, z: 2.1 }] });
    const telemetryEvents = [], observations = [];
    h.s.telemetry = {
      event(event) { telemetryEvents.push(event); },
      observe(state) { observations.push({ nitro: state.nitro, controls: h.s.input.read() }); },
    };
    h.down('boostBtn', 1); if (altitude > 0) h.down('flightBtn', 2);
    h.frame(.1);
    assert.deepEqual(h.effects.events.map(({ event }) => event), ['boost-empty', 'charge']);
    assert.deepEqual(h.effects.audioEvents, ['charge'], 'internal depletion cannot play a new sound');
    assert.deepEqual(h.effects.visualEvents, ['charge'], 'internal depletion cannot trigger a visual effect');
    assert.deepEqual(telemetryEvents, ['charge'], 'internal depletion cannot become a gameplay telemetry event');
    assert.equal(observations.length, 1); assert.equal(observations[0].controls.boost, false);
    assert.equal(observations[0].controls.throttle, 0); assert.ok(observations[0].nitro > 0);
  }
});

test('boostPresentation and the real HUD distinguish effect, speed, brake, air and empty reserve', () => {
  const scenarios = [
    [{}, 'ready', 'УДЕРЖИВАЙ'],
    [{ speed: 0 }, 'too-slow', 'РАЗГОН'],
    [{ speed: 5 }, 'too-slow', 'РАЗГОН'],
    [{ boosting: true }, 'active', 'УСКОРЕНИЕ'],
    [{ altitude: .2 }, 'airborne', 'В ПОЛЁТЕ'],
    [{ flying: true, boosting: true }, 'airborne', 'В ПОЛЁТЕ'],
    [{ braking: true, boosting: true }, 'braking', 'ТОРМОЖЕНИЕ'],
    [{ nitro: 0, boosting: true, braking: true, flying: true }, 'empty', 'НЕТ ЗАРЯДА'],
  ];
  for (const [state, mode, label] of scenarios) {
    const h = harness(state); h.hud();
    assert.deepEqual(boostPresentation(h.s.game.state), { mode, label });
    assert.equal(h.button('boostBtn').dataset.boostState, mode); assert.equal(h.button('boostStatus').textContent, label);
    assert.equal(h.button('boostBtn').disabled, h.s.game.state.nitro <= 0);
  }
});
