import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createThumbDrive, thumbControlsFromOffset } from '../src/thumb-drive.js';

const NEUTRAL = { steer: 0, throttle: 0, brake: 0 };
class Target {
  listeners = new Map();
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler); }
  emit(name, fields = {}) {
    const event = { target: this, type: name, pointerId: 1, pointerType: 'touch', clientX: 172, clientY: 239, button: 0, buttons: 1, cancelable: true,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const handler of this.listeners.get(name) || []) handler(event);
    return event;
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, value) => sum + value.size, 0); }
}
class Element extends Target {
  children = [];
  attributes = new Map();
  dataset = {};
  captures = new Set();
  classes = new Set();
  properties = new Map();
  classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
  style = { setProperty: (name, value) => this.properties.set(name, value), removeProperty: name => this.properties.delete(name) };
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { left: 100, top: 200, width: 144, height: 78 }; }
  setPointerCapture(id) { if (this.captureFails) throw new Error('Capture unavailable'); this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.emit('lostpointercapture', { pointerId: id }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
function setup() {
  const document = new Target(), window = new Target(), samples = [];
  document.createElement = tag => new Element(tag, document);
  const root = document.createElement('div');
  const controller = createThumbDrive({ root, window, onControls: controls => samples.push(controls) });
  return { controller, root, pad: controller.pad, document, window, samples, last: () => samples.at(-1) };
}
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);

test('held displacement produces normalized steering, gas, coast transition and brake', () => {
  assert.deepEqual(thumbControlsFromOffset(), { steer: 0, throttle: 1, brake: 0 });
  assert.deepEqual(thumbControlsFromOffset({ dx: 1, dy: 1 }), { steer: 0, throttle: 1, brake: 0 });
  approx(thumbControlsFromOffset({ dx: 144 * .32 * .53 }).steer, .5);
  approx(thumbControlsFromOffset({ dx: -144 * .32 * .53 }).steer, -.5);
  approx(thumbControlsFromOffset({ dy: 78 * .42 * .31 }).throttle, .5);
  const coast = thumbControlsFromOffset({ dy: 78 * .42 * .46 });
  approx(coast.throttle, 0); approx(coast.brake, 0);
  assert.deepEqual(thumbControlsFromOffset({ dx: 1000, dy: 1000 }), { steer: 1, throttle: 0, brake: 1 });
  assert.deepEqual(thumbControlsFromOffset({ dx: -1000, dy: -1000 }), { steer: -1, throttle: 1, brake: 0 });
});

test('all axes are finite/clamped, pedals never conflict, and pad sizes normalize equally', () => {
  for (const dx of [-1e6, -40, 0, 50, 1e6, NaN, Infinity]) {
    for (const dy of [-1e6, 0, 5, 10, 20, 1e6, NaN, Infinity]) {
      const axes = thumbControlsFromOffset({ dx, dy });
      assert.ok(Number.isFinite(axes.steer) && axes.steer >= -1 && axes.steer <= 1);
      assert.ok(Number.isFinite(axes.throttle) && axes.throttle >= 0 && axes.throttle <= 1);
      assert.ok(Number.isFinite(axes.brake) && axes.brake >= 0 && axes.brake <= 1);
      assert.equal(axes.throttle * axes.brake, 0);
    }
  }
  assert.deepEqual(thumbControlsFromOffset({ dx: 20, dy: 12 }), thumbControlsFromOffset({ dx: 40, dy: 24, width: 288, height: 156 }));
  for (const dimension of [0, -1, NaN, Infinity]) {
    const axes = thumbControlsFromOffset({ dx: 100, dy: 100, width: dimension, height: dimension });
    assert.deepEqual(axes, { steer: 1, throttle: 0, brake: 1 });
  }
});

test('starts disabled and cannot drive while paused; enable requires a fresh hold', () => {
  const f = setup();
  assert.equal(f.pad.disabled, true);
  assert.deepEqual(f.last(), NEUTRAL);
  assert.equal(f.pad.emit('pointerdown').defaultPrevented, false);
  assert.deepEqual(f.last(), NEUTRAL);
  f.controller.setEnabled(true);
  assert.equal(f.pad.disabled, false);
  assert.equal(f.pad.emit('pointerdown').defaultPrevented, true);
  assert.deepEqual(f.last(), { steer: 0, throttle: 1, brake: 0 });
  f.controller.setEnabled(false);
  assert.deepEqual(f.last(), NEUTRAL);
  assert.equal(f.pad.captures.size, 0);
  f.window.emit('pointermove', { clientX: 222 });
  f.pad.emit('pointerdown');
  assert.deepEqual(f.last(), NEUTRAL);
  f.controller.setEnabled(true);
  f.window.emit('pointermove', { clientX: 222 });
  assert.deepEqual(f.last(), NEUTRAL);
});

test('one pointer accelerates and continuously steers or brakes; release never leaves auto-gas', () => {
  const f = setup(); f.controller.setEnabled(true);
  f.pad.emit('pointerdown');
  f.pad.emit('pointermove', { clientX: 195 });
  assert.ok(f.last().steer > .4 && f.last().steer < .6);
  assert.equal(f.last().throttle, 1);
  f.window.emit('pointermove', { clientX: 122, clientY: 300 });
  assert.deepEqual(f.last(), { steer: -1, throttle: 0, brake: 1 });
  f.window.emit('pointermove', { clientX: 172, clientY: 239 });
  assert.deepEqual(f.last(), { steer: 0, throttle: 1, brake: 0 });
  f.window.emit('pointerup');
  assert.deepEqual(f.last(), NEUTRAL);
  assert.equal(f.pad.getAttribute('aria-pressed'), 'false');
  assert.equal(f.pad.captures.size, 0);
  f.window.emit('pointermove', { clientX: 1000 });
  assert.deepEqual(f.last(), NEUTRAL);
});

test('secondary pointers cannot take over, move, release or cancel the owning thumb', () => {
  const f = setup(); f.controller.setEnabled(true);
  // isPrimary=false is legitimate when another finger already holds flight elsewhere.
  f.pad.emit('pointerdown', { pointerId: 7, isPrimary: false });
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    f.pad.emit(name, { pointerId: 8, clientX: 1000, clientY: 1000 });
    assert.deepEqual(f.last(), { steer: 0, throttle: 1, brake: 0 });
  }
  f.window.emit('pointerup', { pointerId: 7 });
  assert.deepEqual(f.last(), NEUTRAL);
  f.pad.emit('pointerdown', { pointerId: 8 });
  assert.deepEqual(f.last(), { steer: 0, throttle: 1, brake: 0 });
});

test('cancel, lost capture, blur, rotation, hidden document and explicit clear release input', () => {
  for (const name of ['pointercancel', 'lostpointercapture', 'blur', 'resize', 'orientationchange', 'visibilitychange', 'clear']) {
    const f = setup(); f.controller.setEnabled(true); f.pad.emit('pointerdown');
    if (name === 'clear') f.controller.clear();
    else if (name === 'visibilitychange') { f.document.hidden = true; f.document.emit(name); }
    else if (['pointercancel', 'lostpointercapture'].includes(name)) f.pad.emit(name);
    else f.window.emit(name);
    assert.deepEqual(f.last(), NEUTRAL, name);
    f.window.emit('pointermove', { clientX: 222 });
    assert.deepEqual(f.last(), NEUTRAL, name + ' stays released');
    assert.equal(f.pad.captures.size, 0, name);
  }
});

test('window fallback releases outside pad when capture is unavailable and mouse loss is safe', () => {
  const f = setup(); f.controller.setEnabled(true); f.pad.captureFails = true;
  assert.doesNotThrow(() => f.pad.emit('pointerdown'));
  f.window.emit('pointermove', { clientX: 2000 });
  assert.deepEqual(f.last(), { steer: 1, throttle: 1, brake: 0 });
  f.window.emit('pointerup');
  assert.deepEqual(f.last(), NEUTRAL);
  f.pad.emit('pointerdown', { pointerType: 'mouse', button: 2 });
  assert.deepEqual(f.last(), NEUTRAL);
  f.pad.emit('pointerdown', { pointerType: 'mouse' });
  f.window.emit('pointermove', { pointerType: 'mouse', buttons: 0 });
  assert.deepEqual(f.last(), NEUTRAL);
});

test('identical bubbling samples are deduplicated and disposal removes every listener', () => {
  const f = setup(); f.controller.setEnabled(true); f.pad.emit('pointerdown');
  const count = f.samples.length;
  f.pad.emit('pointermove'); f.window.emit('pointermove');
  assert.equal(f.samples.length, count);
  f.samples.at(-1).steer = 100;
  f.pad.emit('pointermove');
  assert.equal(f.samples.length, count, 'consumer mutation does not change cached state');
  f.controller.dispose();
  assert.deepEqual(f.last(), NEUTRAL);
  assert.equal(f.pad.listenerCount + f.window.listenerCount + f.document.listenerCount, 0);
  assert.equal(f.root.children.length, 0);
  assert.doesNotThrow(() => { f.controller.dispose(); f.controller.clear(); f.controller.setEnabled(true); });
  assert.equal(f.pad.disabled, true);
});

test('pad supplies Russian directions without duplicating existing global keyboard bindings', () => {
  const f = setup();
  assert.equal(f.root.children[1].textContent, 'Держи: газ · в стороны: руль · вниз: тормоз');
  assert.match(f.pad.getAttribute('aria-label'), /Отпусти/);
  assert.equal(f.pad.listeners.has('keydown'), false);
  assert.equal(f.window.listeners.has('keydown'), false);
  assert.equal(f.document.listeners.has('keydown'), false);
});

test('landscape-only CSS scopes legacy hiding and reserves space for reachable airborne controls', async () => {
  const css = await readFile(new URL('../styles/thumb-drive.css', import.meta.url), 'utf8');
  assert.match(css, /\.thumb-drive\s*\{\s*display:\s*none/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /any-pointer:\s*coarse/);
  assert.match(css, /#app\[data-thumb-drive="true"\] \.touch-controls > \.steer-pair/);
  assert.match(css, /#app\[data-thumb-drive="true"\] \.touch-controls > \.pedal-pair/);
  assert.match(css, /height:\s*106px/);
  assert.match(css, /bottom:\s*114px/);
  assert.match(css, /min-height:\s*44px; min-width:\s*44px/);
});
