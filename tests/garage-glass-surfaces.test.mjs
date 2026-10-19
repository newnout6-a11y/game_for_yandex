import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { GarageUI, garageNumber } from '../src/garage-ui.js';
import { createProfile, deriveGarageView } from '../src/progression.js';
import { CATALOG } from '../src/progression-catalog.js';

/** Small DOM double exercises presentation semantics without a browser/WebGL. */
class Node {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = {}; this.style = { setProperty(key, value) { this[key] = value; } };
    this.className = ''; this.listeners = {}; this._text = ''; this.disabled = false; this.hidden = false;
    this.scrollLeft = 0; this.scrollTop = 0;
    this.classList = { add: value => { this.className += ` ${value}`; }, remove: value => { this.className = this.className.split(' ').filter(item => item !== value).join(' '); } };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of nodes) node.parentElement = this; this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'id') this.id = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(key, handler) { this.listeners[key] = handler; }
  dispatchEvent(event) { this.listeners[event.type]?.(event); return true; }
  removeEventListener(key) { delete this.listeners[key]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; this.ownerDocument.onFocus?.(this, options); }
  /** Match the subset of DOM selectors used by the presenter, including ancestors. */
  matches(selector) {
    if (selector.includes(':not(:disabled)') && this.disabled) return false;
    selector = selector.replaceAll(':not(:disabled)', '');
    const segments = selector.trim().split(/\s+/); const last = segments.pop();
    const tag = last.match(/^[\w-]+/)?.[0]; if (tag && this.tagName !== tag.toUpperCase()) return false;
    const cls = last.match(/\.([\w-]+)/)?.[1]; if (cls && !this.className.split(' ').includes(cls)) return false;
    const id = last.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    const attr = last.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
    if (attr) { const value = attr[1].startsWith('data-') ? this.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.attributes[attr[1]]; if (value == null || attr[2] !== undefined && value !== attr[2]) return false; }
    if (segments.length) { let parent = this.parentElement; while (parent && !parent.matches(segments.join(' '))) parent = parent.parentElement; if (!parent) return false; }
    return true;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { const selectors = selector.split(','); const result = []; for (const child of this.children) { if (selectors.some(value => child.matches(value))) result.push(child); result.push(...child.querySelectorAll(selector)); } return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
/** Create a private presenter and a detached starter profile for each test. */
function harness(profile = createProfile({ now: 123 })) {
  const doc = { activeElement: null, createElement(tag) { return new Node(this, tag); }, createElementNS(_ns, tag) { return new Node(this, tag); } };
  const root = new Node(doc, 'div'); const actions = [];
  const ui = new GarageUI({ root, onAction: action => actions.push(action) });
  const view = extra => ({ ...deriveGarageView(profile), catalog: CATALOG, screen: 'garage', ...extra });
  const render = extra => ui.render(view(extra));
  const button = (type, filter = () => true) => root.querySelectorAll('[data-gs-action]').find(node => { const value = JSON.parse(node.dataset.gsAction); return value.type === type && filter(value, node); });
  const click = target => ui.handleClick({ target });
  return { doc, root, ui, profile, actions, render, button, click };
}

test('Fleet removes the starter wording without changing ownership, previews or authoritative prices', () => {
  const h = harness(); const before = structuredClone(h.profile); h.render({ tab: 'fleet' });
  const rows = h.root.querySelectorAll('.gs-vehicle-row');
  assert.equal(rows.length, 5);
  assert.doesNotMatch(h.root.textContent, /Стартовая машина/);
  const starter = rows.find(row => row.dataset.fleetId === 'rocket');
  assert.equal(starter.querySelector('.gs-vehicle-row-copy').children[1].textContent, 'В твоём гараже');
  assert.equal(starter.getAttribute('aria-pressed'), 'true');
  for (const car of h.ui.view.vehicles.filter(car => !car.owned)) {
    const row = rows.find(row => row.dataset.fleetId === car.id);
    assert.equal(row.querySelector('.gs-vehicle-row-copy').children[1].textContent, `${garageNumber(car.price)} ₵`);
    assert.deepEqual(JSON.parse(row.dataset.gsAction), { type: 'selectVehicle', id: car.id });
  }
  assert.ok(h.button('startDrive')); assert.equal(h.button('purchaseVehicle'), undefined);
  h.render({ selectedVehicle: 'hatch' });
  assert.equal(h.button('purchaseVehicle').disabled, true);
  h.click(h.button('purchaseVehicle')); assert.equal(h.actions.length, 0);
  h.click(h.button('selectVehicle', action => action.id === 'sedan'));
  assert.deepEqual(h.actions, [{ type: 'selectVehicle', id: 'sedan' }]);
  assert.deepEqual(h.profile, before);
});

test('all owned Fleet cards use the same ownership copy and catalog gaps remain explicit', () => {
  const h = harness();
  const input = { screen: 'garage', vehicles: [
    { id: 'rocket', name: 'Roadster Rocket', price: 0, owned: true },
    { id: 'hatch', name: 'Клин H2', price: 1400, owned: true },
    { id: 'future', name: 'Новая машина' },
  ] };
  const before = structuredClone(input); h.ui.render(input);
  assert.deepEqual(h.root.querySelectorAll('.gs-vehicle-row-copy').map(copy => copy.children[1].textContent), ['В твоём гараже', 'В твоём гараже', 'Скоро в каталоге']);
  assert.equal(h.root.querySelectorAll('.gs-car-miniature').length, 3);
  assert.deepEqual(input, before); assert.equal(h.actions.length, 0);
});

test('glass belongs only to the presenter and modal state follows actual settings/conflict visibility', () => {
  const h = harness(); const original = structuredClone(h.profile);
  assert.ok(h.root.className.split(' ').includes('gs-liquid-glass'));
  for (const screen of ['hub', 'garage', 'results', 'loading']) {
    h.render({ screen }); assert.equal(h.root.dataset.modal, 'closed'); assert.equal(h.root.querySelector('.gs-layout').inert, false);
  }
  h.render({ screen: 'garage' });
  h.click(h.root.querySelector('[data-gs-settings-open]'));
  assert.equal(h.root.dataset.modal, 'open'); assert.equal(h.root.querySelector('.gs-layout').inert, true);
  assert.equal(h.root.querySelector('.gs-settings-dialog').getAttribute('aria-modal'), 'true');
  h.click(h.button('_local', action => action.kind === 'closeSettings'));
  assert.equal(h.root.dataset.modal, 'closed'); assert.equal(h.root.querySelector('.gs-settings-dialog'), null);
  h.render({ platform: { conflict: { local: h.profile, cloud: createProfile({ now: 456 }) } } });
  assert.equal(h.root.dataset.modal, 'open'); assert.ok(h.root.querySelector('.gs-cloud-dialog'));
  h.render(); assert.equal(h.root.dataset.modal, 'closed');
  assert.deepEqual(h.profile, original); assert.equal(h.actions.length, 0);
  h.ui.dispose(); assert.ok(!h.root.className.split(' ').includes('gs-liquid-glass')); assert.equal(h.root.dataset.modal, undefined);
});

const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
const glass = css.slice(css.indexOf('/* LIQUID_GLASS_SURFACES:'), css.indexOf('/* LIQUID_GLASS_SURFACES_END */'));
const base = glass.slice(0, glass.indexOf('@media'));
function rules(source) {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(), declarations: Object.fromEntries(body.split(';').filter(value => value.trim()).map(value => {
      const colon = value.indexOf(':'); return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
    })),
  }));
}
const rule = selector => rules(base).find(rule => rule.selector === selector)?.declarations;

test('glass CSS parses and changes material only, never accepted geometry, text size or scrolling', async () => {
  assert.ok(glass); const parsed = await transform(css, { loader: 'css' }); assert.deepEqual(parsed.warnings, []);
  const visual = new Set(['background', 'background-clip', 'border-radius', 'border-color', 'border-top-color', 'color', 'box-shadow', '-webkit-backdrop-filter', 'backdrop-filter', 'outline', 'outline-offset']);
  for (const { selector, declarations } of rules(glass)) {
    assert.ok(selector.startsWith('.garage-shell.gs-liquid-glass'), selector);
    for (const property of Object.keys(declarations)) assert.ok(property.startsWith('--gs-') || visual.has(property), `${selector}: ${property} would change geometry or behavior`);
  }
  assert.doesNotMatch(glass, /(?:\.gs-car-miniature|canvas|\.gs-stage\s*\{|\.gs-header\s*\{|\.gs-layout\s*\{)/);
  assert.ok(css.indexOf('/* MOBILE_GARAGE_COMPACT_END */') < css.indexOf('/* LIQUID_GLASS_SURFACES:'));
});

test('panels, popups and controls have clearly rounded radii with rose/plum gradients', () => {
  assert.equal(rule('.garage-shell.gs-liquid-glass .gs-garage > .gs-workbench')['border-radius'], '18px');
  assert.equal(rule('.garage-shell.gs-liquid-glass .gs-settings-dialog')['border-radius'], '20px');
  assert.equal(rule('.garage-shell.gs-liquid-glass :is(.gs-button, .gs-setting select)')['border-radius'], '8px');
  assert.match(rule('.garage-shell.gs-liquid-glass')['--gs-glass-panel'], /^linear-gradient\(135deg,/);
  assert.match(glass, /\.gs-garage > \.gs-workbench \{ border-radius: 14px; \}/);
  assert.doesNotMatch(glass, /#f17740|#ff9666|#172024|#161a17/);
});

test('glass admits background light and uses one light edge rather than padded double outlines', () => {
  const tokens = rule('.garage-shell.gs-liquid-glass');
  for (const stop of colors(tokens['--gs-glass-panel'])) {
    const alpha = rgba(stop)[3];
    assert.ok(alpha >= .65 && alpha <= .72, `${stop}: panel opacity must retain visible background light`);
  }
  assert.equal(tokens['--gs-glass-edge'], 'inset 0 1px 0 #fff0fb14');
  assert.doesNotMatch(glass, /inset (?:2|3)px 0|inset 0 -1px/);
  assert.match(glass, /\.gs-tabs > \.gs-tab:not\(\[aria-selected='true'\]\),[\s\S]*?background: transparent; border-color: transparent; box-shadow: none;/);
  assert.match(glass, /\.gs-header \.gs-icon-button \{[\s\S]*?background: transparent; border-color: transparent; box-shadow: none;/);
  assert.equal(rule('.garage-shell.gs-liquid-glass .gs-tabs > .gs-tab')['border-radius'], '6px');
});

test('blur is bounded to one workbench or dialog and the scrim leaves the 3D scene unblurred', () => {
  const blurred = rules(glass).filter(({ declarations }) => /blur\(/.test(declarations['backdrop-filter'] || ''));
  assert.equal(blurred.length, 2);
  assert.ok(blurred.every(({ selector }) => /\.gs-workbench|\.gs-settings-dialog/.test(selector)));
  assert.equal(rule('.garage-shell.gs-liquid-glass :is(.gs-rail, .gs-hub-dock, .gs-settings-backdrop)')['backdrop-filter'], 'none');
  assert.equal(rule(".garage-shell.gs-liquid-glass[data-modal='open'] .gs-workbench")['backdrop-filter'], 'none');
  assert.doesNotMatch(glass, /will-change|animation:|filter:\s*(?:blur\((?:1[1-9]|[2-9]\d)px|url\()/);
});

test('transparency, unsupported-backdrop and forced-color fallbacks preserve legible controls and selected state', () => {
  assert.match(glass, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  const reduced = glass.slice(glass.indexOf('@media (prefers-reduced-transparency: reduce)'), glass.indexOf('@media (forced-colors: active)'));
  assert.match(reduced, /\.gs-garage > \.gs-workbench,[\s\S]*?\.gs-settings-dialog \{ -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
  for (const declaration of rules(reduced)) for (const [property, value] of Object.entries(declaration.declarations)) {
    if (property.startsWith('--gs-glass-')) assert.doesNotMatch(value, /#[\da-f]{8}\b/i, `${property} must be opaque`);
  }
  const forced = glass.slice(glass.indexOf('@media (forced-colors: active)'));
  assert.match(forced, /background: Canvas; color: CanvasText; border-color: CanvasText/);
  assert.match(forced, /outline: 2px solid Highlight; outline-offset: -2px/);
  assert.match(forced, /\.gs-garage > \.gs-workbench,[\s\S]*?\.gs-settings-dialog \{ -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
  assert.doesNotMatch(forced, /forced-color-adjust:\s*none/);
});

const rgba = hex => [1, 3, 5, 7].map((offset, index) => index === 3 && hex.length < 9 ? 1 : parseInt(hex.slice(offset, offset + 2), 16) / 255);
const over = (hex, background) => { const [r, g, b, a] = rgba(hex); return [r, g, b].map((value, index) => value * a + background[index] * (1 - a)); };
const luminance = rgb => rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const colors = value => value.match(/#[\da-f]{6}(?:[\da-f]{2})?\b/gi);

test('small panel text exceeds AA across translucent gradient extremes, including a white scene behind it', () => {
  const tokens = rule('.garage-shell.gs-liquid-glass');
  const foreground = rule('.garage-shell.gs-liquid-glass .gs-garage > .gs-workbench')['--gs-panel-muted'];
  const ink = luminance(rgba(foreground).slice(0, 3));
  const tileStops = ['--gs-glass-tile', '--gs-glass-selected'].flatMap(name => colors(tokens[name]));
  tileStops.push('#624663a6', '#45374fd9'); // Hover material.
  for (const scene of [[0, 0, 0], [1, 1, 1]]) for (const panel of colors(tokens['--gs-glass-panel'])) {
    const background = over(panel, scene);
    for (const surface of [background, ...tileStops.map(color => over(color, background))]) {
      const ratio = (ink + .05) / (luminance(surface) + .05);
      assert.ok(ratio >= 4.5, `${foreground} over ${panel}: contrast ${ratio.toFixed(2)}`);
    }
  }
});

// These are direct color declarations, not inherited --gs-muted consumers.
// Check their real selector/state cascade independently of the token-only test.
function directRules(source, suffix) {
  return rules(source).flatMap(({ selector, declarations }) => selector.split(/,\s*(?=\.garage-shell)/)
    .filter(selector => selector.endsWith(suffix) && declarations.color)
    .map(selector => ({ selector, color: declarations.color })));
}
function selectorWeight(selector) {
  assert.doesNotMatch(selector, /:is\(|:where\(/, 'Direct-label cascade uses ordinary selectors only');
  return (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
}

test('direct catalog labels override legacy small-text colors, including selected and unowned sample states', () => {
  const panelInk = rule('.garage-shell.gs-liquid-glass .gs-garage > .gs-workbench')['--gs-panel-muted'];
  const targets = [
    ['.gs-material-count', 'var(--gs-panel-muted)'], ['.gs-feature-label', 'var(--gs-panel-muted)'],
    ['.gs-effect', '#eee4f6'], ['.gs-comparison-label', '#eee4f6'], ['.gs-comparison-tuned', '#eee4f6'],
    ['.gs-sample-action', '#f5deed'],
  ];
  const tokens = rule('.garage-shell.gs-liquid-glass');
  const panelStops = colors(tokens['--gs-glass-panel']);
  const tileStops = ['--gs-glass-tile', '--gs-glass-selected'].flatMap(name => colors(tokens[name]));
  tileStops.push('#624663a6', '#45374fd9', '#2d2b3de8'); // Hover and unavailable cards.
  for (const [suffix, expected] of targets) {
    const declarations = directRules(css, suffix);
    const winner = declarations.at(-1);
    assert.equal(winner.color, expected, suffix);
    assert.ok(winner.selector.startsWith('.garage-shell.gs-liquid-glass .gs-workbench '));
    for (const older of declarations.slice(0, -1)) assert.ok(selectorWeight(winner.selector) >= selectorWeight(older.selector), `${winner.selector} must beat ${older.selector}`);
    const color = expected.startsWith('var(') ? panelInk : expected;
    const ink = luminance(rgba(color).slice(0, 3));
    for (const scene of [[0, 0, 0], [1, 1, 1]]) for (const panel of panelStops) {
      const background = over(panel, scene);
      const surfaces = suffix === '.gs-sample-action' || suffix === '.gs-feature-label'
        ? tileStops.map(tile => over(tile, background))
        : [background];
      for (const surface of surfaces) {
        const ratio = (ink + .05) / (luminance(surface) + .05);
        assert.ok(ratio >= 4.5, `${suffix} ${color}: contrast ${ratio.toFixed(3)}`);
      }
    }
  }
  const h = harness(); h.render({ tab: 'style' });
  const actions = h.root.querySelectorAll('.gs-sample-action');
  assert.ok(actions.length > 1);
  assert.equal(h.root.querySelectorAll('.gs-sample-card .gs-sample-action').length, actions.length,
    'The final stronger selector covers every real action label, not a synthetic class');
  assert.ok(actions.some(node => node.closest('.gs-sample-card').getAttribute('aria-pressed') === 'true'));
  assert.ok(actions.some(node => node.closest('.gs-sample-card').dataset.owned === 'false'));
});
