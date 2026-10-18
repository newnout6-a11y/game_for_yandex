import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GarageUI, GARAGE_TABS, normalizeGarageView, garageNumber } from '../src/garage-ui.js';
import { createProfile, deriveGarageView } from '../src/progression.js';

/** Only the DOM primitives needed by the real header presenter, not a second UI. */
function headerFixture(input) {
  const doc = {
    createElement(tagName) {
      return {
        tagName, className: '', dataset: {}, attributes: {}, children: [], _text: '',
        set textContent(value) { this._text = String(value); this.children = []; },
        get textContent() { return this._text + this.children.map(child => child.textContent).join(''); },
        append(...children) { this.children.push(...children); },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
      };
    },
    createElementNS(_namespace, tagName) { return this.createElement(tagName); },
  };
  const ui = Object.assign(Object.create(GarageUI.prototype), { doc, view: normalizeGarageView(input) });
  return { ui, header: ui.renderHeader() };
}
const hasClass = (node, name) => node.className.split(/\s+/).includes(name);
const find = (node, name) => hasClass(node, name) ? node : node.children.map(child => find(child, name)).find(Boolean);

test('every garage tab retains the real Roadster mark, authoritative wallet and labeled controls', () => {
  const profile = createProfile({ now: 123 });
  profile.wallet.credits = 1234567;
  const input = { ...deriveGarageView(profile), screen: 'garage' };
  const snapshot = structuredClone(input);
  for (const tab of GARAGE_TABS) {
    const { header } = headerFixture({ ...input, tab: tab.id });
    assert.equal(header.tagName, 'header');
    const brand = find(header, 'gs-brand');
    assert.equal(brand.getAttribute('aria-label'), 'Roadster');
    assert.equal(find(brand, 'gs-brand-type').children[0].textContent, 'Roadster');
    const account = find(header, 'gs-account');
    const balance = find(account, 'gs-balance');
    assert.equal(balance.children[1].textContent, garageNumber(1234567));
    assert.equal(balance.getAttribute('aria-label'), `Баланс: ${garageNumber(1234567)} кредитов`);
    const settings = account.children.find(node => node.dataset.gsSettingsOpen === 'true');
    assert.equal(settings.getAttribute('aria-label'), 'Настройки');
    assert.equal(settings.dataset.gsFocus, 'openSettings');
    assert.deepEqual(JSON.parse(settings.dataset.gsAction), { type: '_local', kind: 'openSettings' });
    const back = find(header, 'gs-mobile-home');
    assert.equal(back.getAttribute('aria-label'), 'На главную');
    assert.deepEqual(JSON.parse(back.dataset.gsAction), { type: 'navigate', screen: 'hub' });
    assert.ok(header.children.indexOf(brand) < header.children.indexOf(account));
  }
  assert.deepEqual(input, snapshot, 'Header presentation must not mutate the authoritative snapshot');
});

test('the center badge remains in the presenter snapshot rather than changing earned ownership', () => {
  const badges = [{ id: 'earned', name: 'Первая высота', owned: true, selected: true }];
  const input = { screen: 'garage', badges, balances: { credits: 300 } };
  const snapshot = structuredClone(input);
  const { header } = headerFixture(input);
  assert.equal(find(header, 'gs-header-context').children.at(-1).textContent, 'Первая высота');
  assert.deepEqual(input, snapshot, 'Clearing the header center is visual only, not an equip/unequip action');
});

/** Read declaration-only blocks without pretending this is a layout/browser test. */
function rulesFor(css, selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.trim() === selector)
    .map(([, , body]) => Object.fromEntries(body.trim().split(';').filter(part => part.trim()).map(part => {
      const colon = part.indexOf(':');
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })));
}

test('the garage-only header override removes the strip without changing layout or hit targets', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  const rules = rulesFor(css, ".garage-shell[data-screen='garage'] .gs-header");
  assert.ok(rules.length, 'The transparency change must be scoped to garage, not hub or results');
  const override = Object.assign({}, ...rules);
  assert.equal(override.background, 'transparent', 'No continuous header gradient or solid fill');
  assert.equal(override['border-bottom-color'], 'transparent', 'No edge-to-edge divider remains');
  assert.deepEqual(Object.keys(override).sort(), ['background', 'border-bottom-color'],
    'This visual-only change must preserve dimensions, spacing, pointer targets and responsive rules');
  const normalHeaders = rulesFor(css, '.garage-shell .gs-header');
  assert.equal(normalHeaders[0].flex, '0 0 82px');
  assert.equal(normalHeaders[0]['pointer-events'], 'auto');
  assert.equal(normalHeaders[0]['border-bottom'], '1px solid var(--gs-line)',
    'Transparent divider retains its original geometry and therefore the camera framing');
  const globalTheme = normalHeaders.at(-1);
  assert.match(globalTheme.background, /^linear-gradient\(/, 'Hub/results retain their existing background');
  assert.equal(globalTheme['border-color'], '#b4a7c526');
});

test('garage edge-label readability uses text shadow only, not new backplates across the center', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  const rules = rulesFor(css, ".garage-shell[data-screen='garage'] .gs-header :is(.gs-brand-type, .gs-balance)");
  assert.ok(rules.length);
  const override = Object.assign({}, ...rules);
  assert.ok(override['text-shadow'] && override['text-shadow'] !== 'none');
  assert.deepEqual(Object.keys(override), ['text-shadow'], 'Readability must not add or expand any opaque panel');
});

test('garage selected title docks inside the stage opposite controls and wraps by available width', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  const row = Object.assign({}, ...rulesFor(css, ".garage-shell[data-screen='garage'] .gs-stage-bottom"));
  assert.equal(row.display,'flex');assert.equal(row['flex-wrap'],'wrap');
  const dock = Object.assign({}, ...rulesFor(css, ".garage-shell[data-screen='garage'] .gs-vehicle-title-dock"));
  assert.equal(dock.flex,'1 0 auto');assert.equal(dock['text-align'],'right');assert.equal(dock.position,undefined);assert.equal(dock['max-width'],'100%');
  const title = Object.assign({}, ...rulesFor(css, ".garage-shell[data-screen='garage'] .gs-vehicle-title-dock > .gs-vehicle-title"));
  assert.equal(title.margin,'0');assert.equal(title.font,undefined);assert.equal(title.transform,undefined);
  assert.match(css,/font: italic 400 clamp\(28px, 3vw, 47px\)\/1\.08 var\(--gs-editorial, Georgia, serif\)/);
  assert.equal(Object.assign({}, ...rulesFor(css, ".garage-shell[data-screen='garage'] .gs-title-reservation")).visibility,'hidden');
  assert.equal(css.includes('.gs-workbench-column'),false,'Workbench retains its original full-height column');
});
