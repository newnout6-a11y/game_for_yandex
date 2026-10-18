import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOrientationGate } from '../src/orientation-gate.js';
import { createLifecycle } from '../src/lifecycle.js';

class Target {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name, fields = {}) {
    const event = { type: name, target: this, cancelable: true, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...fields };
    for (const listener of this.listeners.get(name) || []) {
      listener(event);
      if (event.stopped) break;
    }
    return event;
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

class Element extends Target {
  children = [];
  attributes = new Map();
  dataset = {};
  hidden = false;
  inert = false;
  parentElement = null;
  constructor(tagName, document) { super(); this.tagName = tagName; this.document = document; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  get isConnected() { return this.document.documentElement.contains(this); }
  focus(options) {
    for (let node = this; node; node = node.parentElement) if (node.hidden || node.inert) return;
    this.focusOptions = options;
    this.document.activeElement = this;
    this.document.emit('focusin', { target: this });
  }
  getClientRects() { return this.visible === false ? [] : [{}]; }
}

/** Minimal injected DOM, with independent viewport and device capabilities. */
function environment({ width = 390, height = 844, touch = 5, coarse = true, userAgent = 'iPhone', platform = 'iPhone', mobile, reducedMotion = false, legacyMedia = false } = {}) {
  const document = new Target();
  document.createElement = tagName => new Element(tagName, document);
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  document.documentElement.appendChild(document.body);
  document.activeElement = document.body;
  const appRoot = document.createElement('main');
  appRoot.id = 'app';
  document.body.appendChild(appRoot);
  const button = document.createElement('button');
  appRoot.appendChild(button);
  document.getElementById = id => id === 'app' ? appRoot : null;
  const window = new Target();
  Object.assign(window, {
    innerWidth: width, innerHeight: height,
    navigator: { userAgent, platform, maxTouchPoints: touch, userAgentData: { mobile } },
    screen: { orientation: new Target() }, visualViewport: new Target(),
  });
  const media = new Map();
  window.matchMedia = query => {
    if (!media.has(query)) {
      const target = new Target();
      target.matches = query.includes('coarse') ? coarse : query.includes('reduced-motion') ? reducedMotion : height > width;
      if (legacyMedia) {
        target.addListener = callback => Target.prototype.addEventListener.call(target, 'change', callback);
        target.removeListener = callback => Target.prototype.removeEventListener.call(target, 'change', callback);
        target.addEventListener = undefined;
        target.removeEventListener = undefined;
      }
      media.set(query, target);
    }
    return media.get(query);
  };
  const changes = [];
  return { window, document, appRoot, button, media, changes,
    onChange: blocked => changes.push(blocked),
    rotate(width, height) { window.innerWidth = width; window.innerHeight = height; window.emit('resize'); },
  };
}

test('gate distinguishes actual phones/tablets from narrow desktop and fine-pointer touch laptops', () => {
  const cases = [
    [{}, true, 'iPhone portrait'],
    [{ width: 844, height: 390 }, false, 'iPhone landscape'],
    [{ width: 1024, height: 1366, userAgent: 'iPad', platform: 'iPad' }, true, 'large iPad portrait'],
    [{ userAgent: 'Mozilla Macintosh', platform: 'MacIntel' }, true, 'iPad desktop UA'],
    [{ userAgent: 'Android', platform: 'Linux', touch: 1, coarse: false }, true, 'Android with attached mouse'],
    [{ userAgent: '', platform: '', mobile: true, touch: 0, coarse: false }, true, 'UA Client Hints phone'],
    [{ userAgent: 'Generic', platform: '', touch: 1, coarse: true }, true, 'coarse-touch tablet'],
    [{ userAgent: 'Windows', platform: 'Win32', touch: 0, coarse: false }, false, 'narrow desktop'],
    [{ userAgent: 'Windows', platform: 'Win32', touch: 5, coarse: false }, false, 'touch laptop with fine primary pointer'],
    [{ userAgent: 'Windows', platform: 'Win32', touch: 0, coarse: true }, false, 'coarse pointer without touch'],
    [{ userAgent: 'Macintosh', platform: 'MacIntel', touch: 0, coarse: false }, false, 'narrow Mac desktop'],
    [{ width: 500, height: 500 }, false, 'square viewport is not portrait'],
  ];
  for (const [options, expected, label] of cases) {
    const env = environment(options);
    const gate = createOrientationGate(env);
    assert.equal(gate.blocked, expected, label);
    assert.equal(gate.root.hidden, !expected, label);
    assert.equal(env.appRoot.inert, expected, label);
    assert.deepEqual(env.changes, [expected], label);
    gate.dispose();
  }
});

test('mounts an accessible no-dismiss cue outside the application and restores prior focus', () => {
  const env = environment();
  env.button.focus();
  const gate = createOrientationGate(env);
  assert.equal(gate.root.parentElement, env.document.body);
  assert.equal(gate.root.getAttribute('role'), 'dialog');
  assert.equal(gate.root.getAttribute('aria-modal'), 'true');
  assert.equal(gate.root.getAttribute('aria-labelledby'), 'orientationGateTitle');
  assert.equal(gate.root.getAttribute('aria-describedby'), 'orientationGateMessage');
  assert.equal(env.document.activeElement, gate.root);
  assert.equal(env.appRoot.getAttribute('aria-hidden'), 'true');
  assert.equal(env.document.body.inert, false);
  assert.equal(gate.root.inert, false);
  const contents = gate.root.children[0].children;
  assert.equal(contents[1].textContent, 'Поверни устройство');
  assert.match(contents[2].textContent, /только в горизонтальном/);
  assert.equal(contents[2].getAttribute('role'), 'status');
  assert.equal(contents.some(child => child.tagName === 'button' || child.tagName === 'a'), false);
  env.rotate(844, 390);
  assert.equal(gate.blocked, false);
  assert.equal(env.appRoot.inert, false);
  assert.equal(env.appRoot.getAttribute('aria-hidden'), null);
  assert.equal(env.document.activeElement, env.button);
  assert.deepEqual(env.button.focusOptions, { preventScroll: true });
  gate.dispose();
});

test('orientation pause never releases independent ad or manual reasons', () => {
  const env = environment();
  const lifecycle = createLifecycle();
  lifecycle.pause('ad');
  lifecycle.pause('user');
  const gate = createOrientationGate({ ...env, onChange: blocked => blocked ? lifecycle.pause('orientation') : lifecycle.resume('orientation') });
  assert.deepEqual(lifecycle.reasons(), ['ad', 'user', 'orientation']);
  env.rotate(844, 390);
  assert.deepEqual(lifecycle.reasons(), ['ad', 'user']);
  assert.equal(lifecycle.paused, true);
  env.rotate(390, 844);
  gate.dispose();
  assert.deepEqual(lifecycle.reasons(), ['ad', 'user']);
});

test('captures game pointer/keyboard input but preserves browser and OS navigation defaults', () => {
  const env = environment();
  const gate = createOrientationGate(env);
  for (const name of ['pointerdown', 'click', 'touchstart', 'touchmove', 'wheel']) {
    const event = env.window.emit(name, { target: env.button });
    assert.equal(event.stopped, true, name);
    assert.equal(event.defaultPrevented, name === 'click', name);
  }
  for (const key of ['Tab', 'Enter', ' ', 'ArrowLeft']) {
    const event = env.window.emit('keydown', { target: gate.root, key });
    assert.equal(event.stopped, true, key);
    assert.equal(event.defaultPrevented, true, key);
  }
  for (const details of [{ key: 'Escape' }, { key: 'BrowserBack' }, { key: 'r', ctrlKey: true }, { key: 'ArrowLeft', altKey: true }, { key: 'l', metaKey: true }, { key: 'F6' }, { key: 'Tab', ctrlKey: true }]) {
    const event = env.window.emit('keydown', { target: gate.root, ...details });
    assert.equal(event.stopped, true);
    assert.equal(event.defaultPrevented, false, JSON.stringify(details));
  }
  assert.equal(env.window.emit('pointerdown', { target: gate.root, button: 3 }).defaultPrevented, false);
  env.rotate(844, 390);
  assert.equal(env.window.emit('keydown', { key: 'Enter' }).stopped, false);
  assert.equal(env.window.emit('click', { target: env.button }).stopped, false);
  gate.dispose();
});

test('focus cannot escape into the game; removed, disabled, hidden or already-inert focus is not restored', () => {
  for (const invalidate of [env => env.button.remove(), env => { env.button.disabled = true; }, env => { env.button.hidden = true; }, env => { env.button.visible = false; }, env => { env.button.inert = true; }]) {
    const env = environment();
    env.button.focus();
    const gate = createOrientationGate(env);
    env.document.emit('focusin', { target: env.button });
    assert.equal(env.document.activeElement, gate.root);
    invalidate(env);
    env.rotate(844, 390);
    assert.notEqual(env.document.activeElement, env.button);
    gate.dispose();
  }
});

test('preserves application inert and aria-hidden values owned by another modal', () => {
  for (const ariaHidden of [null, 'false', 'true']) {
    const env = environment();
    env.appRoot.inert = true;
    if (ariaHidden !== null) env.appRoot.setAttribute('aria-hidden', ariaHidden);
    const gate = createOrientationGate(env);
    env.rotate(844, 390);
    assert.equal(env.appRoot.inert, true);
    assert.equal(env.appRoot.getAttribute('aria-hidden'), ariaHidden);
    gate.dispose();
  }
});

test('reduced motion changes the cue to a static landscape phone without changing pause state', async () => {
  const env = environment({ reducedMotion: true });
  const gate = createOrientationGate(env);
  assert.equal(gate.root.dataset.reducedMotion, 'true');
  const preference = env.media.get('(prefers-reduced-motion: reduce)');
  preference.matches = false;
  preference.emit('change');
  assert.equal(gate.root.dataset.reducedMotion, 'false');
  assert.deepEqual(env.changes, [true]);
  const css = await readFile(new URL('../styles/orientation-gate.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.match(css, /data-reduced-motion='true'[\s\S]*animation: none/);
  assert.match(css, /background: #000/);
  assert.match(css, /transform: rotate\(-90deg\)/);
  gate.dispose();
});

test('uses layout viewport rather than soft keyboard or zoom visual viewport dimensions', () => {
  const env = environment();
  const gate = createOrientationGate(env);
  env.window.visualViewport.width = 390;
  env.window.visualViewport.height = 280;
  env.window.visualViewport.emit('resize');
  assert.equal(gate.blocked, true);
  assert.deepEqual(env.changes, [true]);
  gate.dispose();
});

test('screen, media and fullscreen events refresh without duplicate pause notifications', () => {
  const env = environment();
  const gate = createOrientationGate(env);
  env.window.emit('orientationchange');
  env.window.screen.orientation.emit('change');
  env.document.emit('fullscreenchange');
  env.media.get('(orientation: portrait)').emit('change');
  assert.deepEqual(env.changes, [true]);
  env.window.innerWidth = 844;
  env.window.innerHeight = 390;
  env.window.screen.orientation.emit('change');
  assert.deepEqual(env.changes, [true, false]);
  env.window.innerWidth = 390;
  env.window.innerHeight = 844;
  env.document.fullscreenElement = env.document.documentElement;
  env.document.emit('fullscreenchange');
  assert.equal(gate.root.parentElement, env.document.body);
  assert.deepEqual(env.changes, [true, false, true]);
  gate.dispose();
});

test('fullscreen application mounts overlay inside the subtree without making the overlay inert', () => {
  const env = environment();
  const gate = createOrientationGate(env);
  env.document.fullscreenElement = env.appRoot;
  env.document.emit('fullscreenchange');
  assert.equal(gate.root.parentElement, env.appRoot);
  assert.equal(env.appRoot.inert, false);
  assert.equal(env.button.inert, true);
  assert.equal(gate.root.inert, false);
  assert.equal(env.document.activeElement, gate.root);
  env.document.fullscreenElement = null;
  env.document.emit('fullscreenchange');
  assert.equal(gate.root.parentElement, env.document.body);
  assert.equal(env.button.inert, false);
  assert.equal(env.appRoot.inert, true);
  gate.dispose();
  assert.equal(env.appRoot.inert, false);
});

test('capability changes and legacy Safari media lists are observed and fully removed on dispose', () => {
  for (const legacyMedia of [false, true]) {
    const env = environment({ userAgent: 'Generic', platform: '', coarse: false, legacyMedia });
    const gate = createOrientationGate(env);
    assert.equal(gate.blocked, false);
    const coarse = env.media.get('(pointer: coarse)');
    coarse.matches = true;
    coarse.emit('change');
    assert.equal(gate.blocked, true);
    gate.dispose();
    gate.dispose();
    assert.equal(gate.blocked, false);
    assert.equal(gate.root.isConnected, false);
    assert.equal(env.window.listenerCount, 0);
    assert.equal(env.document.listenerCount, 0);
    assert.equal(env.window.screen.orientation.listenerCount, 0);
    assert.equal(env.window.visualViewport.listenerCount, 0);
    for (const query of env.media.values()) assert.equal(query.listenerCount, 0);
    assert.deepEqual(env.changes, [false, true, false]);
    assert.equal(gate.refresh(), false);
    env.rotate(400, 900);
    assert.deepEqual(env.changes, [false, true, false]);
  }
});
