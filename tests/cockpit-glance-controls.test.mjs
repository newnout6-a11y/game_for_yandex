import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { UI, CockpitGlanceControls, glanceShortcutAllowed } from '../src/ui.js';
import { DrivingInput } from '../src/input.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');


/** Extract one real function using balanced braces, tolerating compact formatting. */
function applicationFunction(name) {
  const start = new RegExp('function\\s+' + name + '\\s*\\(\\s*\\)\\s*\\{').exec(main);
  assert.ok(start, 'production function exists: ' + name);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let at = main.indexOf('{', start.index); at < main.length; at++) {
    const char = main[at], next = main[at + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; at++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = null; continue; }
    if (char === '/' && next === '/') { lineComment = true; at++; continue; }
    if (char === '/' && next === '*') { blockComment = true; at++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return main.slice(start.index, at + 1);
  }
  assert.fail('unterminated production function: ' + name);
}

/** Minimal event target for exercising the actual application bindings without WebGL. */
function element() {
  return {
    hidden: false, disabled: false, dataset: {}, attributes: {}, listeners: new Map(), captures: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setPointerCapture(id) { this.captures.push(id); },
    closest() { return null; },
    emit(type, properties = {}) {
      const event = { target: this, code: '', button: 0, pointerId: 1, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...properties };
      this.listeners.get(type)?.(event);
      return event;
    },
  };
}

/** Supply the real UI method with a small document only for the duration of its call. */
function withDocument(elements, operation) {
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => elements[id] };
  try { return operation(); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}

/** Run production eligibility/bindings against independently held driving and camera inputs. */
function harness() {
  const elements = Object.fromEntries(['glanceControls', 'lookLeftBtn', 'lookRightBtn'].map(id => [id, element()]));
  const changes = [];
  const renderer = { playerVehicleId: 'rocket', cameraMode: 'cockpit', effectiveCameraMode: 'cockpit', setLookDirection: direction => changes.push(direction) };
  const sandbox = {
    screen: 'playing', busy: false, renderer, glance: new CockpitGlanceControls(direction => renderer.setLookDirection(direction)),
    lifecycle: { paused: false }, game: { state: { phase: 'playing', rolling: false } }, input: new DrivingInput(),
    ui: { overlay: { hidden: true }, glance: (...args) => withDocument(elements, () => UI.prototype.glance(...args)) },
    byId: id => elements[id], document: element(), window: element(),
    glanceShortcutAllowed, cameraShortcutAllowed: () => false,
    toggleCamera() { assert.fail('glance must not toggle camera mode'); }, pauseRun() {}, startRun() {},
  };
  vm.createContext(sandbox);
  const sync = applicationFunction('syncGlanceControls');
  assert.ok(sync);
  vm.runInContext(sync, sandbox);
  vm.runInContext(main.slice(main.indexOf("document.addEventListener('keydown', event => {"), main.indexOf('const controlBindings =')), sandbox);
  const bindings = main.slice(main.indexOf('// Dedicated held glances'), main.indexOf('let gesture = null;'));
  vm.runInContext(bindings, sandbox);
  sandbox.syncGlanceControls();
  return { sandbox, elements, changes };
}

test('Z/X are fresh physical-key holds, distinct from steering and roll and excluded from edits/modals', () => {
  for (const code of ['KeyZ', 'KeyX']) {
    const event = { code, target: { closest: () => null } };
    assert.equal(glanceShortcutAllowed(event, 'playing', false), true);
    assert.equal(glanceShortcutAllowed({ ...event, key: 'я', shiftKey: true }, 'playing', false), true);
    for (const screen of ['paused', 'menu', 'results', 'unknown']) assert.equal(glanceShortcutAllowed(event, screen, false), false);
    assert.equal(glanceShortcutAllowed(event, 'playing', true), false);
    for (const flag of ['repeat', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(glanceShortcutAllowed({ ...event, [flag]: true }, 'playing', false), false);
    assert.equal(glanceShortcutAllowed({ ...event, target: { isContentEditable: true } }, 'playing', false), false);
    assert.equal(glanceShortcutAllowed({ ...event, target: { closest: () => ({}) } }, 'playing', false), false);
  }
  for (const code of ['KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'Space']) assert.equal(glanceShortcutAllowed({ code }, 'playing', false), false);
});

test('independent same-side sources and opposing holds release without dropping other controls', () => {
  const calls = [], glance = new CockpitGlanceControls(value => calls.push(value)), driving = new DrivingInput();
  driving.key('KeyW', true); driving.key('KeyA', true); driving.key('KeyF', true); driving.key('KeyQ', true);
  const before = driving.read();
  glance.set(-1, 'key-KeyZ', true);
  assert.equal(glance.direction, 0, 'disabled by default');
  glance.setEnabled(true);
  glance.set(-1, 'key-KeyZ', true); glance.set(-1, 'pointer-1', true);
  glance.release('pointer-1');
  assert.equal(glance.direction, -1, 'a held keyboard source survives pointer release');
  glance.set(1, 'pointer-2', true); assert.equal(glance.direction, 0, 'opposing holds recenter');
  glance.release('key-KeyZ'); assert.equal(glance.direction, 1, 'release restores the independently held other side');
  glance.release('pointer-2'); assert.equal(glance.direction, 0);
  assert.deepEqual(calls, [-1, 0, 1, 0]);
  assert.deepEqual(driving.read(), before);
});

test('real Z/X key bindings preserve gas, steering and rolls, and release even inside a modal', () => {
  const { sandbox: s } = harness();
  s.input.key('KeyW', true); s.input.key('KeyD', true); s.input.key('KeyE', true);
  const before = s.input.read();
  assert.equal(s.document.emit('keydown', { code: 'KeyZ' }).prevented, true);
  assert.equal(s.glance.direction, -1);
  s.document.emit('keydown', { code: 'KeyX' }); assert.equal(s.glance.direction, 0);
  s.document.emit('keyup', { code: 'KeyZ' }); assert.equal(s.glance.direction, 1);
  s.ui.overlay.hidden = false;
  s.document.emit('keyup', { code: 'KeyX' }); assert.equal(s.glance.direction, 0);
  assert.deepEqual(s.input.read(), before);
  s.ui.overlay.hidden = true;
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { target: { isContentEditable: true } }]) {
    assert.equal(s.document.emit('keydown', { code: 'KeyZ', ...extra }).prevented, false);
    assert.equal(s.glance.direction, 0);
  }
});

test('pointer up, cancellation, lost capture and off-button release clear only the matching finger', () => {
  const { sandbox: s, elements } = harness();
  s.input.set('gas', 'pointer-10', true); s.input.set('left', 'pointer-11', true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    elements.lookLeftBtn.emit('pointerdown', { pointerId: 20 });
    elements.lookLeftBtn.emit('pointerdown', { pointerId: 21 });
    assert.equal(s.glance.direction, -1);
    elements.lookLeftBtn.emit(type, { pointerId: 20 });
    assert.equal(s.glance.direction, -1);
    elements.lookLeftBtn.emit(type, { pointerId: 21 });
    assert.equal(s.glance.direction, 0);
    assert.equal(s.input.read().throttle, 1); assert.equal(s.input.read().steer, -1);
  }
  elements.lookRightBtn.emit('pointerdown', { pointerId: 22 });
  s.window.emit('pointerup', { pointerId: 22 });
  assert.equal(s.glance.direction, 0); assert.equal(s.input.read().throttle, 1);
  elements.lookRightBtn.emit('pointerdown', { pointerId: 23 });
  s.window.emit('pointercancel', { pointerId: 23 });
  assert.equal(s.glance.direction, 0); assert.equal(s.input.read().steer, -1);
  elements.lookRightBtn.emit('pointerdown', { pointerId: 24, button: 2 });
  assert.equal(s.glance.direction, 0, 'right mouse button never starts a glance');
});

test('focused hold buttons support Enter/Space, stop nitro propagation and clear on focus loss', () => {
  const { sandbox: s, elements } = harness();
  for (const code of ['Enter', 'Space']) {
    const press = elements.lookLeftBtn.emit('keydown', { code });
    assert.equal(press.prevented, true); assert.equal(press.stopped, true);
    assert.equal(s.glance.direction, -1);
    elements.lookLeftBtn.emit('keydown', { code, repeat: true });
    elements.lookLeftBtn.emit('keyup', { code });
    assert.equal(s.glance.direction, 0);
    elements.lookRightBtn.emit('keydown', { code });
    assert.equal(s.glance.direction, 1);
    elements.lookRightBtn.emit('blur');
    assert.equal(s.glance.direction, 0);
    assert.equal(s.input.read().boost, false);
  }
});

test('pause, modal, menu, result, crash, roll and external-camera boundaries forget held glances', () => {
  const scenarios = [
    s => { s.screen = 'paused'; }, s => { s.screen = 'menu'; }, s => { s.screen = 'results'; },
    s => { s.lifecycle.paused = true; }, s => { s.busy = true; }, s => { s.ui.overlay.hidden = false; },
    s => { s.game.state.phase = 'crashed'; }, s => { s.game.state.rolling = true; },
    s => { s.renderer.cameraMode = 'chase'; }, s => { s.renderer.effectiveCameraMode = 'chase'; },
  ];
  for (const block of scenarios) {
    const { sandbox: s, elements } = harness();
    s.document.emit('keydown', { code: 'KeyX' });
    elements.lookLeftBtn.emit('pointerdown', { pointerId: 2 });
    block(s); s.syncGlanceControls();
    assert.equal(s.glance.direction, 0); assert.equal(s.glance.sources.size, 0);
    assert.equal(elements.lookLeftBtn.disabled, true); assert.equal(elements.lookRightBtn.disabled, true);
    s.screen = 'playing'; s.busy = false; s.lifecycle.paused = false; s.ui.overlay.hidden = true;
    s.game.state.phase = 'playing'; s.game.state.rolling = false;
    s.renderer.cameraMode = s.renderer.effectiveCameraMode = 'cockpit'; s.syncGlanceControls();
    s.document.emit('keydown', { code: 'KeyX', repeat: true });
    assert.equal(s.glance.direction, 0, 'resuming cannot resurrect a previously held key');
    s.document.emit('keyup', { code: 'KeyX' });
    s.document.emit('keydown', { code: 'KeyX' }); assert.equal(s.glance.direction, 1);
  }
});

test('actual lifecycle clear resets gaze along with held driving controls at blur/visibility boundaries', () => {
  const { sandbox: s } = harness();
  let releases = 0, orbitCancels = 0;
  s.garageOrbitInput = { cancel() { orbitCancels++; } };
  s.game.releaseControls = () => { releases++; };
  const clear = applicationFunction('clearInput');
  assert.ok(clear); vm.runInContext(clear, s);
  s.input.key('KeyW', true); s.input.setTouch('boost','pointer-55',true); s.document.emit('keydown', { code: 'KeyZ' });
  s.clearInput();
  assert.equal(s.glance.direction, 0); assert.equal(s.glance.sources.size, 0);
  assert.equal(s.input.read().throttle, 0); assert.equal(s.input.read().boost, false); assert.equal(releases, 1); assert.equal(orbitCancels, 1);
  assert.match(main, /window\.addEventListener\('blur', \(\) => \{ clearInput\(\); gesture = null; pauseRun\('blur'\); \}\)/);
  assert.match(main, /if \(document\.hidden\) \{ clearInput\(\); gesture = null; pauseRun\('hidden'\); \}/);
  assert.match(main, /const\s+lifecycle\s*=\s*createLifecycle\(\(\)\s*=>\s*\{\s*clearInput\(\)/);
  assert.match(main, /screen\s*=\s*'hub';\s*clearInput\(\)/);
});

test('glance buttons are cockpit-only, accessible 44px holds, with concise mirror help and no new video overlay', () => {
  const { sandbox: s, elements } = harness();
  assert.equal(elements.glanceControls.hidden, false); assert.equal(elements.lookLeftBtn.disabled, false);
  elements.lookLeftBtn.emit('pointerdown');
  assert.equal(elements.lookLeftBtn.attributes['aria-pressed'], 'true');
  assert.equal(elements.lookRightBtn.attributes['aria-pressed'], 'false');
  s.renderer.cameraMode = 'chase'; s.syncGlanceControls();
  assert.equal(elements.glanceControls.hidden, true);
  s.renderer.cameraMode = 'cockpit'; s.screen = 'paused'; s.syncGlanceControls();
  assert.equal(elements.glanceControls.hidden, false); assert.equal(elements.lookLeftBtn.disabled, true);
  s.screen = 'results'; s.syncGlanceControls(); assert.equal(elements.glanceControls.hidden, true);
  for (const [id, key, label] of [['lookLeftBtn', 'Z', 'левое'], ['lookRightBtn', 'X', 'правое']]) {
    assert.match(html, new RegExp('id="' + id + '" type="button" aria-label="Удерживать взгляд в ' + label + ' зеркало" aria-describedby="glanceHint" aria-keyshortcuts="' + key + '" aria-pressed="false" disabled'));
  }
  assert.match(css, /\.glance-button \{[^}]*min-width: var\(--control-size\); min-height: var\(--control-size\);/);
  assert.match(theme, /--control-size: 2\.75rem;/);
  assert.match(css, /\.glance-button \{[^}]*touch-action: none;/);
  assert.match(css, /\.game-hud:has\(\.glance-controls:not\(\[hidden\]\)\) \.flight-status \{ bottom: calc\(var\(--space-24\) \+ var\(--control-size\) \+ var\(--space-2\)\); \}/);
  assert.deepEqual([...html.matchAll(/<canvas\b[^>]*\bid="([^"]+)"/g)].map(match=>match[1]), ['scene','mobileGoalVehicleCanvas'], 'only the game surface and bounded selected-route model, never a mirror overlay');
  assert.doesNotMatch(html, /<video\b/);
  let help;
  UI.prototype.help.call({ open(type, markup) { help = markup; } });
  assert.match(help, /удерживай Z \/ X/); assert.match(help, /кнопки «Взгляд»/); assert.match(help, /руль и газ не меняются/);
  assert.match(main, /new CockpitGlanceControls\(direction\s*=>\s*renderer\.setLookDirection\(direction\)\)/);
});


test('ground-only fleet cars have no cockpit glances even if the saved camera preference is cockpit', () => {
  for (const id of ['hatch', 'sedan', 'suv', 'van']) {
    const { sandbox: s, elements } = harness();
    s.input.key('KeyW', true); s.input.key('KeyA', true);
    s.document.emit('keydown', { code: 'KeyZ' }); assert.equal(s.glance.direction, -1);
    s.renderer.playerVehicleId = id; s.syncGlanceControls();
    assert.equal(s.glance.direction, 0); assert.equal(s.glance.sources.size, 0);
    assert.equal(elements.glanceControls.hidden, true); assert.equal(elements.lookLeftBtn.disabled, true);
    s.document.emit('keydown', { code: 'KeyX' }); elements.lookRightBtn.emit('pointerdown');
    assert.equal(s.glance.direction, 0); assert.equal(s.input.read().throttle, 1); assert.equal(s.input.read().steer, -1);
    assert.equal(s.renderer.cameraMode, 'cockpit', 'unsupported vehicle must not overwrite the saved Rocket preference');
  }
});
