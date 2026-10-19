import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStorage, sanitizeSave, STORAGE_KEY } from '../src/storage.js';
import { UI, cameraShortcutAllowed } from '../src/ui.js';
import { vehicleDefinition } from '../src/progression-catalog.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');


/** Extract one real function using balanced braces, tolerating compact formatting. */
function applicationFunction(name) {
  const start = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(main);
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

/** Run a synchronous UI method with a minimal document, restoring the real global even on failure. */
function withDocument(elements, operation) {
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => elements[id] || null };
  try { return operation(); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}

/** A native-button-shaped fixture that retains attributes and text for accessible-state assertions. */
function button() {
  return { attributes: {}, textContent: '', setAttribute(name, value) { this.attributes[name] = value; } };
}

test('old and malformed saves default to chase, with an exact cockpit opt-in', () => {
  for (const value of [undefined, null, false, 1, {}, [], 'Cockpit', 'first-person', '__proto__', 'toString']) {
    assert.equal(sanitizeSave({ cameraMode: value }).cameraMode, 'chase');
  }
  assert.equal(sanitizeSave(null).cameraMode, 'chase');
  assert.equal(sanitizeSave({ best: { flow: 300 } }).cameraMode, 'chase');
  assert.equal(sanitizeSave({ cameraMode: 'chase' }).cameraMode, 'chase');
  assert.equal(sanitizeSave({ cameraMode: 'cockpit' }).cameraMode, 'cockpit');
});

test('camera preference survives reload and unrelated settings without changing progress or quality', () => {
  let raw = JSON.stringify({ best: { flow: 900, rush: 500 }, runs: 6, totalDistance: 2100, route: 'dawn', difficulty: 'rush', sound: true, renderQuality: 'ultra' });
  const provider = { getItem: () => raw, setItem(key, value) { assert.equal(key, STORAGE_KEY); raw = value; } };
  const store = createStorage(() => provider), before = store.get();
  store.settings({ cameraMode: 'cockpit' });
  assert.deepEqual(createStorage(() => provider).get(), { ...before, cameraMode: 'cockpit' });
  store.settings({ sound: false });
  assert.equal(createStorage(() => provider).get().cameraMode, 'cockpit');
  assert.equal(createStorage(() => provider).get().renderQuality, 'ultra');
  const snapshot = store.get(); snapshot.cameraMode = 'chase';
  assert.equal(store.get().cameraMode, 'cockpit');
  store.settings({ cameraMode: 'unknown' });
  assert.equal(createStorage(() => provider).get().cameraMode, 'chase');
});

test('blocked localStorage still supports camera changes for the current session', () => {
  const store = createStorage(() => { throw new Error('storage unavailable'); });
  assert.equal(store.get().cameraMode, 'chase');
  store.settings({ cameraMode: 'cockpit' });
  assert.equal(store.get().cameraMode, 'cockpit');
});

test('C is a once-per-press shortcut only during runs, outside dialogs and text entry', () => {
  const event = { code: 'KeyC', target: { closest: () => null } };
  assert.equal(cameraShortcutAllowed(event, 'playing', false), true);
  assert.equal(cameraShortcutAllowed(event, 'paused', false), true);
  // Physical KeyC works with a Russian keyboard layout as well as a shifted letter.
  assert.equal(cameraShortcutAllowed({ ...event, key: 'с', shiftKey: true }, 'playing', false), true);
  for (const screen of ['menu', 'results', 'unknown']) assert.equal(cameraShortcutAllowed(event, screen, false), false);
  for (const screen of ['playing', 'paused']) assert.equal(cameraShortcutAllowed(event, screen, true), false);
  for (const flag of ['repeat', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(cameraShortcutAllowed({ ...event, [flag]: true }, 'playing', false), false, flag);
  assert.equal(cameraShortcutAllowed({ ...event, code: 'KeyF' }, 'playing', false), false);
  assert.equal(cameraShortcutAllowed({ ...event, target: { isContentEditable: true } }, 'playing', false), false);
  assert.equal(cameraShortcutAllowed({ ...event, target: { closest(selector) { assert.equal(selector, 'input, textarea, select, [role="textbox"]'); return {}; } } }, 'playing', false), false);
  assert.equal(cameraShortcutAllowed({ ...event, target: null }, 'playing', false), true);
});

test('toolbar and pause buttons expose the requested mode, including automatic external roll fallback', () => {
  const elements = { cameraBtn: button(), pauseCameraBtn: button() }, ui = {};
  withDocument(elements, () => {
    UI.prototype.camera.call(ui, 'chase');
    assert.equal(elements.cameraBtn.attributes['aria-pressed'], 'false');
    assert.equal(elements.cameraBtn.attributes.title, 'Вид из кабины (C)');
    UI.prototype.camera.call(ui, 'cockpit');
    assert.equal(ui.cameraMode, 'cockpit');
    assert.equal(elements.cameraBtn.attributes['aria-pressed'], 'true');
    assert.equal(elements.cameraBtn.attributes.title, 'Внешняя камера (C)');
    assert.equal(elements.pauseCameraBtn.attributes['aria-pressed'], 'true');
    assert.equal(elements.pauseCameraBtn.textContent, 'Вид из кабины: включён');
    // The UI accepts only the preference, never a transient effectiveCameraMode from a renderer frame.
    UI.prototype.camera.call(ui, 'cockpit');
    assert.equal(elements.cameraBtn.attributes['aria-pressed'], 'true');
    UI.prototype.camera.call(ui, 'unsupported');
    assert.equal(ui.cameraMode, 'chase');
    assert.equal(elements.pauseCameraBtn.textContent, 'Вид из кабины: выключен');
    delete elements.pauseCameraBtn;
    assert.doesNotThrow(() => UI.prototype.camera.call(ui, 'cockpit'));
  });
});

test('toolbar camera visibility follows playing and paused, never menu or results', () => {
  const elements = Object.fromEntries(['menu', 'hud', 'pauseBtn', 'cameraBtn', 'helpBtn'].map(id => [id, {}]));
  const ui = { app: { dataset: {} }, bonusAnnouncements: { suspend() {} } };
  withDocument(elements, () => {
    for (const screen of ['menu', 'playing', 'paused', 'results']) {
      UI.prototype.setScreen.call(ui, screen);
      assert.equal(elements.cameraBtn.hidden, !['playing', 'paused'].includes(screen));
      assert.equal(elements.pauseBtn.hidden, elements.cameraBtn.hidden);
      assert.equal(ui.app.dataset.screen, screen);
    }
  });
});

test('pause has its own native toggle without releasing modal focus protection or duplicating graphics', () => {
  let markup;
  const renderSettings = {}, inserted = [];
  const ui = { cameraMode: 'cockpit', renderSettingsElement: renderSettings, open(type, html) { assert.equal(type, 'pause'); markup = html; } };
  withDocument({ pauseRenderSettings: { append: element => inserted.push(element) } }, () => UI.prototype.pause.call(ui));
  assert.match(markup, /id="pauseCameraBtn" data-action="camera" aria-label="Вид из кабины" aria-pressed="true"/);
  assert.match(markup, /Вид из кабины: включён/);
  assert.ok(markup.indexOf('data-action="resume"') < markup.indexOf('data-action="camera"'), 'resume remains the initial focused action');
  assert.deepEqual(inserted, [renderSettings]);
});

test('real application camera action persists and renders only its preference, with lifecycle and modal guards', () => {
  // Load the real shared settings path too; only UI, storage and cloud boundaries are synthetic.
  const action = ['toggleCamera', 'updateSettings', 'hydrateStoredSettings', 'changed'].map(applicationFunction).join('\n');
  assert.ok(action, 'application exposes one guarded camera action');
  const calls = [], profileCalls = [], cloudCalls = [];
  const profileSettings = { cameraMode: 'chase', sound: false, renderQuality: 'auto', route: 'ring', difficulty: 'flow' };
  const simulationState = new Proxy({ vehicleId: 'rocket' }, { get(target, key) { if (key === 'vehicleId') return target[key]; throw new Error('camera must not read simulation dynamics: ' + String(key)); }, set(target, key, value) { assert.equal(key, 'vehicleId'); target[key] = value; return true; } });
  const sandbox = {
    screen: 'playing', busy: false, settings: { ...profileSettings }, appliedSelectedId: 'rocket',
    appliedSettingsKey: JSON.stringify(profileSettings), garageDirty: false,
    storage: { settings: patch => calls.push(['save', patch.cameraMode]) },
    profileStore: {
      get: () => ({ selectedVehicleId: 'rocket', settings: { ...profileSettings } }),
      dispatch(action) { assert.equal(action.type, 'UPDATE_SETTINGS'); profileCalls.push(action.settings.cameraMode); Object.assign(profileSettings, action.settings); return { ok: true, changed: true }; },
    },
    platform: { queueSave: profile => cloudCalls.push(profile.settings.cameraMode) },
    refreshGarage() {}, garageUI: { notice() { assert.fail('accepted fixture preferences must not be rejected'); } },
    audio: { enabled: false },
    vehicleDefinition,
    renderer: { setCameraMode: mode => calls.push(['render', mode]), setQuality() {}, setRoute() {} },
    ui: { overlay: { hidden: true }, modalType: null, camera: mode => calls.push(['ui', mode]), sound() {}, notice: text => calls.push(['notice', text]) },
    game: new Proxy({}, { get(_target, key) { if (key === 'state') return simulationState; throw new Error('camera must not change simulation'); } }),
    input: new Proxy({}, { get() { throw new Error('camera must not access held input'); } }),
    lifecycle: new Proxy({}, { get() { throw new Error('camera must not change lifecycle'); } }),
  };
  vm.createContext(sandbox); vm.runInContext(action, sandbox);
  sandbox.toggleCamera();
  assert.equal(sandbox.settings.cameraMode, 'cockpit');
  assert.deepEqual(calls.slice(0, 3), [['render', 'cockpit'], ['save', 'cockpit'], ['ui', 'cockpit']]);
  assert.deepEqual(profileCalls, ['cockpit'], 'v2 profile and legacy preference both persist');
  assert.deepEqual(cloudCalls, ['cockpit'], 'accepted camera preference queues its current profile');
  calls.length = 0;
  sandbox.screen = 'paused'; sandbox.ui.overlay.hidden = false; sandbox.ui.modalType = 'pause';
  sandbox.toggleCamera();
  assert.equal(sandbox.settings.cameraMode, 'chase');
  assert.deepEqual(calls.slice(0, 3), [['render', 'chase'], ['save', 'chase'], ['ui', 'chase']]);
  assert.equal(calls[1][1], 'chase');
  assert.deepEqual(profileCalls, ['cockpit', 'chase']);
  assert.deepEqual(cloudCalls, ['cockpit', 'chase']);
  for (const scenario of [
    { screen: 'menu', modal: null, busy: false },
    { screen: 'results', modal: 'results', busy: false },
    { screen: 'paused', modal: 'help', busy: false },
    { screen: 'playing', modal: null, busy: true },
  ]) {
    calls.length = 0; profileCalls.length = 0; cloudCalls.length = 0;
    sandbox.screen = scenario.screen; sandbox.busy = scenario.busy;
    sandbox.ui.modalType = scenario.modal; sandbox.ui.overlay.hidden = !scenario.modal;
    sandbox.toggleCamera();
    assert.deepEqual(calls, [], JSON.stringify(scenario));
    assert.deepEqual(profileCalls, [], 'blocked camera actions cannot write v2 settings');
    assert.deepEqual(cloudCalls, [], 'blocked camera actions cannot queue cloud writes');
    assert.equal(sandbox.settings.cameraMode, 'chase');
  }
  sandbox.screen = 'playing'; sandbox.busy = false; sandbox.ui.overlay.hidden = true; sandbox.ui.modalType = null;
  for (const id of ['hatch', 'sedan', 'suv', 'van']) {
    calls.length = 0; profileCalls.length = 0; cloudCalls.length = 0; simulationState.vehicleId = id; sandbox.toggleCamera();
    assert.deepEqual(calls, [], id + ' has no authored cockpit'); assert.deepEqual(profileCalls, []);
    assert.deepEqual(cloudCalls, []);
    assert.equal(sandbox.settings.cameraMode, 'chase');
  }
});

test('focused camera button preserves native Enter/Space activation instead of sending Space to nitro', () => {
  const binding = main.match(/byId\('cameraBtn'\)\.addEventListener\('keydown', event => \{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(binding);
  let listener;
  vm.runInNewContext(binding, { byId(id) { assert.equal(id, 'cameraBtn'); return { addEventListener(type, handler) { assert.equal(type, 'keydown'); listener = handler; } }; } });
  for (const code of ['Enter', 'Space']) {
    let stopped = false;
    listener({ code, stopPropagation() { stopped = true; }, preventDefault() { assert.fail('native activation must stay enabled'); } });
    assert.equal(stopped, true);
  }
  listener({ code: 'KeyC', stopPropagation() { assert.fail('C should reach the global shortcut guard'); } });
});

test('camera controls are 44px minimum, keyboard-wired, discoverable on phones and honest about rolls', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');
  assert.match(html, /<button class="icon-button camera-button" id="cameraBtn" type="button" aria-label="Вид из кабины" aria-pressed="false" aria-keyshortcuts="C"/);
  assert.match(theme, /--control-size: 2\.75rem;/);
  assert.match(css, /\.camera-button \{[^}]*min-width: var\(--control-size\); min-height: var\(--control-size\);/);
  assert.match(css, /button:focus-visible/);
  assert.match(main, /cameraMode:\s*settings\.cameraMode/);
  assert.match(main, /byId\('cameraBtn'\)\.addEventListener\('click', toggleCamera\)/);
  assert.match(main, /cameraShortcutAllowed\(event, screen, !ui\.overlay\.hidden\)/);
  assert.match(html, /id="runHint"[^>]*>[^\n]*C — камера/);
  assert.match(html, /камера — кнопка вверху/);
  let help;
  UI.prototype.help.call({ open(type, markup) { assert.equal(type, 'help'); help = markup; } });
  assert.match(help, /Нажми C или кнопку с камерой вверху экрана/);
  assert.match(help, /На телефоне используй ту же кнопку/);
  assert.match(help, /Во время бокового кувырка камера временно переходит на внешний вид/);
  assert.match(help, /возвращается в кабину после выравнивания машины/);
});

test('narrow header fits the 280px floor without shrinking any of its four mobile buttons', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');
  const narrow = css.split('@media (max-width: 360px) {')[1]?.split('@media')[0];
  assert.ok(narrow, 'narrow layout has an explicit breakpoint');
  assert.match(narrow, /\.brand > span \{ display: none; \}/);
  assert.match(narrow, /\.brand \{[^}]*min-width: var\(--control-size\); min-height: var\(--control-size\);[^}]*flex-shrink: 0;/);
  assert.match(narrow, /\.toolbar, \.toolbar \.icon-button \{ flex-shrink: 0; \}/);
  assert.match(narrow, /\.topbar \{ gap: var\(--space-2\); \}/);
  assert.match(html, /<a class="brand"[^>]*aria-label="Roadster — главное меню"><svg/, 'logo keeps its accessible menu name');
  assert.match(css, /\.toolbar \{ gap: 0; \}/, 'phone toolbar has no inter-button gap');
  assert.match(css, /\.fullscreen-button \{ display: none; \}/, 'phone toolbar contains four controls, not five');
  /** Resolve only the scalar rem/px tokens used by the compact header at the default 16px root. */
  const tokenPixels = name => {
    const match = theme.match(new RegExp(name + ': ([\\d.]+)(rem|px);'));
    assert.ok(match, name + ' is a scalar theme token');
    return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
  };
  const buttonSize = tokenPixels('--control-size');
  assert.ok(buttonSize >= 44);
  const requiredWidth = 2 * tokenPixels('--page-gutter-narrow') + buttonSize + tokenPixels('--space-2') + 4 * buttonSize;
  assert.equal(requiredWidth, 256);
  assert.ok(requiredWidth <= tokenPixels('--viewport-min-width'), 'logo, gap, padding and all four full-sized controls fit');
});
