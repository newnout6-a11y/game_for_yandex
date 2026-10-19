import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GarageUI, GARAGE_TABS, normalizeGarageView, garageNumber, garagePrice } from '../src/garage-ui.js';
import { createProfile, deriveGarageView, reduceProgression } from '../src/progression.js';
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

test('garage accepts the real progression view without changing owned state or prices', () => {
  const profile = createProfile({ now: 123 }); const derived = deriveGarageView(profile); const before = structuredClone(derived);
  const view = normalizeGarageView({ ...derived, catalog: CATALOG, screen: 'garage' });
  assert.equal(view.selected.id, 'rocket'); assert.equal(view.selected.name, CATALOG.fleet.find(item => item.id === 'rocket').nameRu);
  assert.equal(view.balances.credits, 300); assert.equal(view.vehicles.length, 5);
  assert.equal(view.vehicles.find(item => item.id === 'hatch').price, 1400);
  assert.equal(view.garage.tiers[1].price, 900); assert.equal(view.garage.tiers[2].name, 'Испытательный цех');
  assert.deepEqual(derived, before); assert.equal(view.settings.runMode, 'standard');
});
test('unknown screen/tab and malformed display numbers are safe defaults', () => {
  const view = normalizeGarageView({ screen: '<script>', tab: 'unknown', balances: { credits: Infinity } });
  assert.equal(view.screen, 'hub'); assert.equal(view.tab, 'fleet'); assert.equal(view.balances.credits, 0);
  assert.equal(garageNumber(NaN), '0'); assert.equal(garageNumber(-9), '0');
  assert.equal(garagePrice(null), null); assert.equal(garagePrice(undefined), null); assert.equal(garagePrice(-1), null); assert.equal(garagePrice(Infinity), null);
  assert.equal(garagePrice({ credits: 1400 }), 1400); assert.equal(garagePrice(0), 0);
});
test('fallback workshop tiers show actual display and preset capacities', () => {
  const view = normalizeGarageView();
  assert.deepEqual(view.garage.tiers.map(tier => tier.displayCarSlots), [1, 2, 3, 3]);
  assert.deepEqual(view.garage.tiers.map(tier => tier.cosmeticPresetSlots), [1, 3, 6, 10]);
  assert.equal(view.garage.tiers[3].detail, 'Мест для машин: 3 · Пресетов: 10');
  const h = harness(); h.ui.render({ screen: 'garage', tab: 'engineering' });
  assert.ok(h.root.textContent.includes('Мест для машин: 3 · Пресетов: 10'));
});
test('every garage tab renders against the real catalog and keeps all five tab controls', () => {
  const h = harness(); const original = structuredClone(h.profile);
  for (const tab of GARAGE_TABS) { h.render({ tab: tab.id }); assert.equal(h.root.querySelectorAll('[role="tab"]').length, 5); assert.equal(h.root.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), `gs-tab-${tab.id}`); assert.ok(h.root.textContent.includes(tab.name)); }
  assert.deepEqual(h.profile, original); assert.equal(h.actions.length, 0);
});
test('first-entry hub starts immediately and exposes no forced authentication gate', () => {
  const h = harness(); h.render({ screen: 'hub' });
  assert.ok(h.root.textContent.includes('Можно играть сразу')); assert.ok(h.button('startDrive'));
  assert.equal(h.button('cloudConnect'), undefined); assert.equal(h.button('purchaseProduct'), undefined);
  h.click(h.button('startDrive')); assert.deepEqual(h.actions, [{ type: 'startDrive' }]);
});
test('preview is separate from buying, unaffordable purchase cannot dispatch', () => {
  const h = harness(); h.render({ tab: 'fleet', selectedVehicle: 'hatch' });
  assert.equal(h.ui.view.selected.id, 'hatch'); assert.equal(h.ui.view.selected.owned, false);
  assert.equal(h.button('purchaseVehicle').disabled, true); assert.ok(h.root.textContent.includes('1 400'));
  h.click(h.button('purchaseVehicle')); assert.equal(h.actions.length, 0);
  h.click(h.button('selectVehicle', action => action.id === 'sedan')); assert.deepEqual(h.actions, [{ type: 'selectVehicle', id: 'sedan' }]);
  assert.equal(h.profile.wallet.credits, 300);
});
test('research exposes real prices and level0..5 equip actions, not instant success', () => {
  let profile = createProfile({ now: 123 }); profile.wallet.credits = 5000;
  profile = reduceProgression(profile, { type: 'BUY_RESEARCH', branchId: 'drive' }).profile;
  const h = harness(profile); h.render({ tab: 'engineering' });
  const equip = h.button('equipEngineering', action => action.branch === 'drive' && action.level === 1);
  assert.equal(equip.disabled, false); h.click(equip);
  assert.deepEqual(h.actions.at(-1), { type: 'equipEngineering', branch: 'drive', level: 1 });
  assert.equal(h.button('equipEngineering', action => action.branch === 'drive' && action.level === 2).disabled, true);
  assert.equal(h.root.querySelectorAll('.gs-tier-row').length, 4);
  assert.equal(h.profile.loadouts.rocket.engineering.drive, 0, 'presenter must not equip for the core');
});
test('unavailable authored cosmetics explain their reason and cannot be sold', () => {
  const h = harness(); h.render({ tab: 'style' });
  const unavailable = deriveGarageView(h.profile).cosmetics.find(item => !item.available);
  assert.ok(unavailable); const button = h.button('buyCosmetic', action => action.id === unavailable.id);
  assert.equal(button.disabled, true); assert.ok(h.root.textContent.includes(unavailable.reason));
  const graphite = h.button('equipCosmetic', action => action.id === 'paint_graphite');
  assert.equal(graphite.disabled, false); h.click(graphite); assert.equal(h.actions.at(-1).id, 'paint_graphite');
});
test('each cosmetic slot can explicitly return to its factory variant without changing the profile', () => {
  const profile = createProfile({ now: 123 });
  profile.loadouts.rocket.cosmetics['body.paint'] = 'paint_graphite';
  const h = harness(profile); h.render({ tab: 'style' });
  const original = structuredClone(profile);
  const paint = h.button('resetCosmetic', action => action.slot === 'body.paint');
  assert.equal(paint.textContent, 'Серийный вариант'); assert.equal(paint.disabled, false);
  assert.equal(paint.getAttribute('aria-label'), 'Покрытие кузова: серийный вариант');
  assert.ok(h.root.textContent.includes('Стартовый цвет «Мел»'));
  h.click(paint); assert.deepEqual(h.actions.at(-1), { type: 'resetCosmetic', slot: 'body.paint' });
  assert.deepEqual(profile, original);
  const emptySlot = h.button('resetCosmetic', action => action.slot === 'body.addon');
  assert.equal(emptySlot.disabled, true); h.click(emptySlot); assert.equal(h.actions.length, 1);
  h.render({ tab: 'style', selectedVehicle: 'hatch' });
  assert.ok(h.root.querySelectorAll('[data-gs-action]').filter(button => JSON.parse(button.dataset.gsAction).type === 'resetCosmetic').every(button => button.disabled));
});
test('stock paint has no redundant reset and equipped body parts can be removed', () => {
  const h = harness(); h.render({ tab: 'style' });
  assert.equal(h.button('resetCosmetic', action => action.slot === 'body.paint').disabled, true);
  h.render({ tab: 'style', loadout: { cosmetics: { 'body.addon': 'owned_addon' } }, cosmetics: [{ id: 'owned_addon', slot: 'body.addon', owned: true, name: 'Проверенная деталь' }] });
  const reset = h.button('resetCosmetic', action => action.slot === 'body.addon');
  assert.equal(reset.disabled, false); h.click(reset);
  assert.deepEqual(h.actions.at(-1), { type: 'resetCosmetic', slot: 'body.addon' });
});
test('cosmetic state refresh preserves workbench scroll and keyboard focus', () => {
  const h = harness(); h.render({ tab: 'style' });
  h.root.querySelector('.gs-workbench').scrollTop = 487;
  const button = h.button('equipCosmetic', action => action.id === 'paint_graphite'); button.focus();
  h.render({ tab: 'style' });
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 487);
  assert.equal(h.doc.activeElement.dataset.gsFocus, button.dataset.gsFocus);
  h.render({ tab: 'fleet' }); assert.notEqual(h.root.querySelector('.gs-workbench').scrollTop, 487);
});
test('mobile drawer changes notify camera layout and Escape synchronizes accessibility state', () => {
  const h = harness(); h.render({ tab: 'fleet' });
  const events = []; h.root.addEventListener('garage-layout-change', event => events.push({ detail: event.detail, bubbles: event.bubbles }));
  const toggle = h.root.querySelector('.gs-drawer-toggle');
  h.click(toggle);
  assert.equal(h.root.dataset.drawer, 'open'); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(events.at(-1), { detail: { drawerOpen: true }, bubbles: true });
  h.ui.handleKey({ key: 'Escape', target: toggle, stopPropagation() {} });
  assert.equal(h.root.dataset.drawer, 'closed'); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(events.at(-1), { detail: { drawerOpen: false }, bubbles: true });
  assert.equal(h.actions.length, 0);
});
test('inspection controls live in the vehicle stage and dispatch only the four supported views', () => {
  const h = harness(); h.render({ inspection: 'rear' });
  const controls = h.root.querySelector('.gs-stage').querySelectorAll('.gs-inspection-button');
  assert.equal(h.root.querySelector('.gs-inspection').getAttribute('role'), 'group');
  assert.deepEqual(controls.map(node => node.textContent), ['Общий', 'Сзади', 'Диски', 'Салон']);
  assert.equal(new Set(controls.map(node => node.dataset.gsFocus)).size, 4);
  for (const view of ['overview', 'rear', 'wheels', 'cockpit']) {
    const button = h.button('inspectVehicle', action => action.view === view);
    assert.equal(button.type, 'button'); assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-pressed'), String(view === 'rear'));
    h.click(button);
    assert.deepEqual(h.actions.at(-1), { type: 'inspectVehicle', view });
  }
  const button = controls[0];
  button.dataset.gsAction = JSON.stringify({ type: 'inspectVehicle', view: 'wheels', id: 'untrusted', position: [1, 2, 3] });
  h.click(button); assert.deepEqual(h.actions.at(-1), { type: 'inspectVehicle', view: 'wheels' });
  for (const view of ['constructor', '__proto__', 'unknown', null, {}, 1]) {
    button.dataset.gsAction = JSON.stringify({ type: 'inspectVehicle', view }); h.click(button);
  }
  assert.equal(h.actions.length, 5);
});
test('inspection normalizes unsupported state and ground-vehicle cockpit cannot dispatch', () => {
  const h = harness();
  assert.equal(normalizeGarageView({ inspection: 'invalid' }).inspection, 'overview');
  for (const selectedVehicle of ['hatch', 'sedan', 'suv', 'van']) {
    h.render({ selectedVehicle, inspection: 'cockpit' });
    assert.equal(h.ui.view.inspection, 'overview');
    const cockpit = h.button('inspectVehicle', action => action.view === 'cockpit');
    assert.equal(cockpit.disabled, true); assert.match(cockpit.getAttribute('aria-label'), /только у родстера/);
    h.click(cockpit);
    const overview = h.button('inspectVehicle', action => action.view === 'overview');
    overview.dataset.gsAction = JSON.stringify({ type: 'inspectVehicle', view: 'cockpit' }); h.click(overview);
    for (const view of ['rear', 'wheels']) assert.equal(h.button('inspectVehicle', action => action.view === view).disabled, false);
  }
  assert.equal(h.actions.length, 0);
  h.render({ selectedVehicle: 'hatch', inspection: 'rear' });
  assert.equal(h.ui.view.inspection, 'rear');
  h.click(h.button('inspectVehicle', action => action.view === 'wheels'));
  assert.deepEqual(h.actions, [{ type: 'inspectVehicle', view: 'wheels' }]);
});
test('inspection preserves keyboard focus and scroll and obeys busy, modal, hidden and ad-pending guards', () => {
  const h = harness(); h.render({ tab: 'style' });
  h.root.querySelector('.gs-workbench').scrollTop = 190;
  h.button('inspectVehicle', action => action.view === 'rear').focus();
  h.render({ tab: 'style', inspection: 'rear' });
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 190);
  assert.equal(h.doc.activeElement.dataset.gsFocus, 'inspectVehicle:rear');
  assert.equal(h.doc.activeElement.getAttribute('aria-pressed'), 'true');
  h.ui.setBusy(true); h.click(h.button('inspectVehicle')); h.ui.setBusy(false);
  h.ui.setVisible(false); h.click(h.button('inspectVehicle')); h.ui.setVisible(true);
  h.click(h.button('_local', action => action.kind === 'openSettings'));
  h.click(h.button('inspectVehicle')); assert.equal(h.root.querySelector('.gs-layout').inert, true);
  h.click(h.button('_local', action => action.kind === 'closeSettings'));
  h.render({ platform: { conflict: { local: {}, cloud: {} } } }); h.click(h.button('inspectVehicle'));
  h.render({ loading: { adPending: true } });
  const pending = h.button('inspectVehicle'); assert.equal(pending.disabled, true);
  pending.disabled = false; h.click(pending);
  assert.equal(h.actions.length, 0);
  h.render(); h.click(h.button('inspectVehicle')); assert.deepEqual(h.actions, [{ type: 'inspectVehicle', view: 'overview' }]);
  h.render({ screen: 'hub' }); assert.equal(h.button('inspectVehicle'), undefined);
});
test('equipped season badge appears outside the season list only when owned and selected', () => {
  const profile = createProfile({ now: 123 });
  const h = harness(profile); h.render({ screen: 'hub' });
  assert.equal(h.root.querySelector('.gs-equipped-badge'), null);
  profile.season.badges = ['badge_first_altitude']; profile.season.equippedBadge = 'badge_first_altitude';
  const original = structuredClone(profile); h.render({ screen: 'hub' });
  const badges = h.root.querySelectorAll('.gs-equipped-badge');
  assert.equal(badges.length, 2);
  assert.equal(h.root.querySelector('.gs-header').querySelector('.gs-equipped-badge').textContent, 'Первая высота');
  assert.equal(h.root.querySelector('.gs-hub').querySelector('.gs-equipped-badge').getAttribute('aria-label'), 'Выбранный знак сезона: Первая высота');
  assert.deepEqual(profile, original); assert.equal(h.actions.length, 0);
  h.render({ tab: 'fleet' }); assert.equal(h.root.querySelectorAll('.gs-equipped-badge').length, 1);
  for (const badge of [
    { id: 'badge_first_altitude', owned: false, selected: true },
    { id: 'badge_first_altitude', owned: true, selected: false },
    { id: 'badge_first_altitude', selected: true },
    { id: 'badge_first_altitude', owned: 'true', selected: true },
  ]) {
    h.render({ screen: 'hub', badges: [badge] }); assert.equal(h.root.querySelector('.gs-equipped-badge'), null);
  }
  h.render({ screen: 'hub', badges: [{ id: 'badge_first_altitude', name: '<b>Знак</b>', owned: true, selected: true }] });
  const name = h.root.querySelector('.gs-equipped-badge span'); assert.equal(name.children.length, 0); assert.equal(name.textContent, '<b>Знак</b>');
});
test('inspection CSS keeps 44px touch targets and a compact short-landscape stage', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  const buttonRules = Array.from(css.matchAll(/\.garage-shell \.gs-inspection-button\s*\{([^}]+)\}/g), match => match[1]);
  assert.ok(buttonRules.some(rule => /min-width:\s*44px/.test(rule) && /min-height:\s*44px/.test(rule)));
  for (const rule of buttonRules) {
    for (const [, size] of rule.matchAll(/min-(?:width|height):\s*(\d+)px/g)) assert.ok(Number(size) >= 44);
  }
  assert.match(css, /\.gs-inspection\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(44px,\s*1fr\)\)/);
  assert.match(css, /@media \(max-height: 500px\) and \(min-width: 701px\)\s*\{[\s\S]*?\.gs-inspection-button\s*\{[^}]*min-height:\s*44px/);
  assert.equal(/\.gs-inspection(?:-button)?\s*\{[^}]*display:\s*none/.test(css), false);
});
test('automatic contracts show measured progress, and only completed claims dispatch', () => {
  const profile = createProfile({ now: 123 }); profile.stats.roadEventsCompleted = 10;
  const h = harness(profile); h.render({ tab: 'contracts' });
  assert.equal(h.button('acceptContract', (_action, node) => !node.disabled), undefined);
  const claim = h.button('claimContract', action => action.id === 'road_10'); assert.equal(claim.disabled, false);
  h.click(claim); assert.deepEqual(h.actions.at(-1), { type: 'claimContract', id: 'road_10' });
  assert.equal(profile.wallet.credits, 300);
});
test('season uses exact reward IDs and unavailable premium never becomes a purchase', () => {
  const profile = createProfile({ now: 123 }); profile.season.xp = 900;
  const h = harness(profile); h.render({ tab: 'season', platform: { payments: true } });
  const reward = h.button('claimSeason', action => action.id === 'v01_credit_01'); assert.equal(reward.disabled, false);
  h.click(reward); assert.deepEqual(h.actions.at(-1), { type: 'claimSeason', tier: 1, track: 'free', id: 'v01_credit_01' });
  assert.equal(h.button('purchaseProduct'), undefined); assert.ok(h.root.textContent.includes('недоступна'));
});
test('collapsed results detail distinguishes stock, tuned and continued without a telemetry route', () => {
  const profile = createProfile({ now: 123 }); profile.records.standard['rocket:flow'] = { score: 1234, distanceM: 678, runSequence: 1 };
  const h = harness(profile); h.render({ screen: 'results' });
  const detail = h.root.querySelector('.gs-results-records'); assert.ok(detail); assert.equal(detail.getAttribute('open'), null);
  assert.equal(normalizeGarageView({ tab: 'telemetry' }).tab, 'fleet');
  assert.ok(h.root.textContent.includes('1 234')); assert.ok(h.root.textContent.includes('678')); assert.ok(h.root.textContent.includes('Настроенная')); assert.ok(h.root.textContent.includes('С продолжением'));
  assert.equal(h.root.querySelectorAll('.gs-record-sheet').length, 3); assert.ok(h.root.textContent.includes('—'));
});
test('hide and busy remove interactive access, notice accepts text not markup, dispose cleans listeners', () => {
  const h = harness(); h.render({ tab: 'fleet' }); h.ui.setBusy(true, 'Проверяем');
  assert.equal(h.root.getAttribute('aria-busy'), 'true'); assert.ok(h.root.querySelectorAll('button').every(button => button.disabled));
  h.ui.setBusy(false); assert.equal(h.button('startDrive').disabled, false);
  h.ui.notice('<img src=x onerror=alert(1)>'); assert.equal(h.root.querySelector('.gs-notice').children.length, 0);
  assert.equal(h.root.querySelector('.gs-notice').textContent, '<img src=x onerror=alert(1)>');
  h.ui.setVisible(false); assert.equal(h.root.hidden, true); assert.equal(h.root.inert, true);
  h.ui.dispose(); assert.equal(h.root.children.length, 0); assert.deepEqual(h.root.listeners, {});
});
test('loading errors retry explicitly and progress preserves real input', () => {
  const h = harness(); h.render({ screen: 'loading', loading: { progressFraction: .42, error: 'Нет соединения' } });
  assert.equal(h.root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '42');
  h.click(h.button('retryLoad')); assert.deepEqual(h.actions, [{ type: 'retryLoad' }]);
});
test('replacement room errors expose a retry without removing the usable garage', () => {
  const h = harness(); h.render({ tab: 'engineering', loading: { error: 'Бокс не загрузился. Текущий бокс доступен.' } });
  assert.ok(h.root.querySelector('[role="tabpanel"]'));
  assert.equal(h.root.querySelector('.gs-load-error').querySelector('[role="alert"]').textContent, 'Бокс не загрузился. Текущий бокс доступен.');
  assert.equal(h.button('retryLoad').textContent, 'Повторить загрузку бокса');
  h.click(h.button('retryLoad')); assert.deepEqual(h.actions, [{ type: 'retryLoad' }]);
  h.render({ screen: 'hub', loading: { error: 'Нет сети' } }); assert.ok(h.button('retryLoad')); assert.ok(h.button('startDrive'));
  h.render({ screen: 'hub', loading: {} }); assert.equal(h.button('retryLoad'), undefined);
  assert.equal(h.root.querySelector('.gs-load-error'), null);
});
test('other-games hub section is absent without real supplied metadata and never appears in other screens', () => {
  const h = harness(); h.render({ screen: 'hub' });
  assert.equal(h.root.querySelector('.gs-other-games'), null);
  h.render({ screen: 'hub', otherGames: [{ appID: '12' }, { title: 'No ID' }, null, { appID: ' ', title: 'Blank ID' }] });
  assert.equal(h.root.querySelector('.gs-other-games'), null);
  for (const screen of ['garage', 'loading', 'results']) {
    h.render({ screen, otherGames: [{ appID: '12', title: 'Игра автора' }] });
    assert.equal(h.root.querySelector('.gs-other-games'), null);
  }
});
test('other-game buttons dispatch a verified metadata ID only, never a DOM destination URL', () => {
  const h = harness();
  h.render({ screen: 'hub', otherGames: [{ appID: 12, title: '<b>Игра автора</b>', url: 'https://ignored.example/' }, { appID: '12', title: 'Duplicate' }, { appID: '34', title: 'Вторая игра' }] });
  assert.equal(h.root.querySelectorAll('.gs-other-game').length, 2);
  assert.equal(h.root.querySelector('.gs-other-games').getAttribute('aria-labelledby'), 'gs-other-games-title');
  assert.equal(h.root.querySelector('.gs-other-game strong').children.length, 0);
  assert.equal(h.root.querySelector('.gs-other-game strong').textContent, '<b>Игра автора</b>');
  const button = h.button('openOtherGame', action => action.id === '12');
  assert.deepEqual(JSON.parse(button.dataset.gsAction), { type: 'openOtherGame', id: '12' });
  button.dataset.gsAction = JSON.stringify({ type: 'openOtherGame', id: '12', url: 'javascript:alert(1)' });
  h.click(button); assert.deepEqual(h.actions, [{ type: 'openOtherGame', id: '12' }]);
  button.dataset.gsAction = JSON.stringify({ type: 'openOtherGame', id: 'not-in-the-view' });
  h.click(button); assert.equal(h.actions.length, 1);
  h.ui.setBusy(true); h.click(h.button('openOtherGame', action => action.id === '34')); assert.equal(h.actions.length, 1);
});
test('result bonus requires explicit eligibility and actual platform capability', () => {
  const h = harness();
  h.render({ screen: 'results', platform: { rewarded: true }, runResult: { score: 123, bonusEligible: false } }); assert.equal(h.button('rewardedBonus'), undefined);
  h.render({ screen: 'results', platform: { rewarded: false }, runResult: { bonusEligible: true } }); assert.equal(h.button('rewardedBonus'), undefined);
  h.render({ screen: 'results', platform: { rewarded: true }, runResult: { settled: true, bonusEligible: true, bonusCredits: 25, credits: 100, xp: 15 } });
  assert.ok(h.button('rewardedBonus')); assert.ok(h.root.textContent.includes('+25')); h.click(h.button('rewardedBonus')); assert.deepEqual(h.actions.at(-1), { type: 'rewardedBonus' });
});
test('CSS is namespaced and contains portrait, landscape and reduced-motion rules', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.garage-shell[hidden]')); assert.ok(css.includes('max-width: 700px')); assert.ok(css.includes('max-height: 500px')); assert.ok(css.includes('prefers-reduced-motion'));
  assert.equal(/(?:^|\n)(?:body|html|button|#app|#hud|#scene)\s*\{/.test(css), false);
  const source = await readFile(new URL('../src/garage-ui.js', import.meta.url), 'utf8');
  assert.equal(source.includes('.innerHTML'), false); assert.equal(/\b(?:alert|confirm)\s*\(/.test(source), false); assert.equal(source.includes('localStorage'), false);
});

test('revive is an explicit eligible action and local label does not imply advertisement', () => {
  const h = harness(); h.render({ screen: 'results', runResult: { canRevive: true, reviveLabel: 'Тренировочное продолжение' } });
  const revive = h.button('revive'); assert.ok(revive); assert.equal(revive.textContent, 'Тренировочное продолжение');
  h.click(revive); assert.deepEqual(h.actions.at(-1), { type: 'revive' });
  h.render({ screen: 'results', runResult: { canRevive: true, bonusClaimed: true } }); assert.equal(h.button('revive'), undefined);
});
test('cloud conflict keeps snapshots separate and emits only the explicit choice', () => {
  const h = harness(); h.profile.stats.runs = 2;
  const cloud = createProfile({ now: 456, id: 'cloud' }); cloud.wallet.credits = 800; cloud.stats.runs = 7;
  const conflict = { reason: 'different-progress', source: 'sdk', local: structuredClone(h.profile), cloud };
  const before = structuredClone(conflict); h.render({ platform: { conflict } });
  assert.equal(h.root.querySelector('.gs-layout').inert, true); assert.ok(h.root.textContent.includes('300')); assert.ok(h.root.textContent.includes('800'));
  assert.equal(h.root.querySelectorAll('.gs-cloud-option').length, 2);
  assert.ok(h.button('resolveCloudConflict', action => action.choice === 'local'));
  assert.match(h.root.querySelector('#gs-cloud-title').textContent, /Два разных маршрута/);
  h.click(h.button('resolveCloudConflict', action => action.choice === 'cloud'));
  assert.deepEqual(h.actions.at(-1), { type: 'resolveCloudConflict', choice: 'cloud' }); assert.equal(h.profile.wallet.credits, 300);
  assert.deepEqual(conflict, before);
});
test('confirmed empty SDK cloud offers only explicit transfer of the existing whole profile', () => {
  const h = harness(); h.profile.stats.runs = 12;
  const conflict = { reason: 'local-unlinked', source: 'sdk', local: structuredClone(h.profile), cloud: null };
  const before = structuredClone(conflict); h.render({ platform: { conflict } });
  const dialog = h.root.querySelector('.gs-cloud-dialog');
  assert.equal(dialog.querySelector('#gs-cloud-title').textContent, 'В облаке пока нет сохранения');
  assert.equal(dialog.textContent.includes('Два разных маршрута'), false);
  assert.equal(dialog.textContent.includes('разный прогресс'), false);
  assert.match(dialog.textContent, /Текущий прогресс с этого устройства можно сохранить в облаке Яндекс Игр/);
  assert.equal(dialog.querySelectorAll('.gs-cloud-option').length, 1);
  assert.deepEqual(dialog.querySelectorAll('.gs-stat-value').map(node => node.textContent), ['300₵', '12']);
  assert.match(dialog.textContent, /Автомобилей: 1/);
  assert.equal(h.button('resolveCloudConflict', action => action.choice === 'cloud'), undefined);
  const transfer = h.button('resolveCloudConflict', action => action.choice === 'local');
  assert.equal(transfer.textContent, 'Создать облачное сохранение'); assert.equal(transfer.disabled, false);
  assert.equal(h.doc.activeElement, transfer); assert.equal(h.actions.length, 0);
  h.click(transfer); assert.deepEqual(h.actions, [{ type: 'resolveCloudConflict', choice: 'local' }]);
  assert.deepEqual(conflict, before); assert.equal(h.profile.wallet.credits, 300);
});
test('zero-balance zero-run profiles are real snapshots, not absent cloud saves', () => {
  const h = harness(); h.profile.wallet.credits = 0;
  const cloud = createProfile({ now: 456, id: 'cloud' }); cloud.wallet.credits = 0;
  const conflict = { reason: 'different-progress', source: 'sdk', local: h.profile, cloud };
  h.render({ platform: { conflict } });
  const dialog = h.root.querySelector('.gs-cloud-dialog');
  assert.equal(dialog.querySelector('#gs-cloud-title').textContent, 'Два разных маршрута');
  assert.deepEqual(dialog.querySelectorAll('.gs-stat-value').map(node => node.textContent), ['0₵', '0', '0₵', '0']);
  assert.equal(dialog.querySelectorAll('button:not(:disabled)').length, 2);
  h.render({ platform: { conflict: { ...conflict, reason: 'local-unlinked', cloud: null } } });
  assert.equal(h.button('resolveCloudConflict', action => action.choice === 'local').disabled, false);
});
test('missing display statistics do not turn a usable cloud profile into an empty cloud', () => {
  const h = harness(); const cloud = createProfile({ now: 456, id: 'cloud' }); delete cloud.stats;
  h.render({ platform: { conflict: { reason: 'different-progress', source: 'sdk', local: h.profile, cloud } } });
  assert.equal(h.root.querySelector('#gs-cloud-title').textContent, 'Два разных маршрута');
  assert.equal(h.button('resolveCloudConflict', action => action.choice === 'cloud').disabled, false);
  assert.equal(h.root.querySelectorAll('.gs-cloud-option')[1].querySelectorAll('.gs-stat-value')[1].textContent, '—');
});
test('profile aliases and wrapped display summaries retain full-profile choices', () => {
  const h = harness(); const cloud = createProfile({ now: 456, id: 'cloud' }); cloud.wallet.credits = 800;
  h.render({ platform: { conflict: { reason: 'different-progress', source: 'sdk', localProfile: { profile: h.profile, credits: 300, runs: 2 }, cloudProfile: { profile: cloud, credits: 800, runs: 7 } } } });
  assert.deepEqual(h.root.querySelector('.gs-cloud-dialog').querySelectorAll('.gs-stat-value').map(node => node.textContent), ['300₵', '2', '800₵', '7']);
  assert.equal(h.root.querySelector('.gs-cloud-dialog').querySelectorAll('button:not(:disabled)').length, 2);
});
test('missing, malformed and summary-only cloud data never offer restore or overwrite', () => {
  const h = harness(); const cloud = createProfile({ now: 456, id: 'cloud' });
  const malformed = [undefined, null, {}, [], 'invalid', { credits: 800, runs: 7 },
    { ...cloud, schemaVersion: 999 }, { ...cloud, revision: -1 }, { ...cloud, wallet: { credits: NaN } },
    { ...cloud, wallet: { credits: -1 } }, { ...cloud, wallet: { credits: '800' } }];
  for (const candidate of malformed) {
    h.render({ platform: { conflict: { reason: 'different-progress', source: 'sdk', local: h.profile, cloud: candidate } } });
    const dialog = h.root.querySelector('.gs-cloud-dialog');
    assert.equal(h.button('resolveCloudConflict'), undefined);
    assert.equal(dialog.querySelector('#gs-cloud-title').textContent, 'Облачное сохранение недоступно');
    assert.equal(h.doc.activeElement, dialog); assert.equal(dialog.tabIndex, -1);
    let prevented = false;
    h.ui.handleKey({ key: 'Tab', target: dialog, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.doc.activeElement, dialog);
  }
  // Missing data is not a successful read of an empty account, even with the empty-account reason.
  h.render({ platform: { conflict: { reason: 'local-unlinked', source: 'sdk', local: h.profile } } });
  assert.equal(h.button('resolveCloudConflict'), undefined);
  assert.equal(h.root.textContent.includes('В облаке пока нет сохранения'), false);
  // An explicit null cannot accidentally fall back to an unrelated legacy alias.
  h.render({ platform: { conflict: { reason: 'local-unlinked', source: 'sdk', local: h.profile, cloud: null, cloudProfile: cloud } } });
  assert.equal(h.button('resolveCloudConflict', action => action.choice === 'cloud'), undefined);
  assert.equal(h.actions.length, 0);
});
test('backend conflicts retain local stats but only offer the canonical cloud profile', () => {
  const h = harness(); const cloud = createProfile({ now: 456, id: 'cloud' }); cloud.wallet.credits = 800;
  const conflict = { reason: 'different-progress', source: 'backend', local: h.profile, cloud };
  h.render({ platform: { conflict } });
  assert.equal(h.button('resolveCloudConflict', action => action.choice === 'local'), undefined);
  assert.equal(h.root.querySelectorAll('.gs-cloud-option').length, 2);
  assert.match(h.root.querySelectorAll('.gs-cloud-option')[0].textContent, /300/);
  const restore = h.button('resolveCloudConflict', action => action.choice === 'cloud');
  assert.equal(restore.disabled, false); assert.equal(h.doc.activeElement, restore);
  h.click(restore); assert.deepEqual(h.actions, [{ type: 'resolveCloudConflict', choice: 'cloud' }]);
  h.render({ platform: { conflict: { ...conflict, reason: 'local-unlinked', cloud: null } } });
  assert.equal(h.button('resolveCloudConflict'), undefined);
  assert.equal(h.root.textContent.includes('В облаке пока нет сохранения'), false);
});
test('conflict focus survives rerenders and falls back when a cloud choice disappears', () => {
  const h = harness(); const cloud = createProfile({ now: 456, id: 'cloud' });
  const conflict = { reason: 'different-progress', source: 'sdk', local: h.profile, cloud };
  h.render({ platform: { conflict } }); h.button('resolveCloudConflict', action => action.choice === 'cloud').focus();
  h.render({ platform: { conflict } });
  assert.equal(h.doc.activeElement, h.button('resolveCloudConflict', action => action.choice === 'cloud'));
  const empty = { ...conflict, reason: 'local-unlinked', cloud: null };
  h.render({ platform: { conflict: empty } });
  const transfer = h.button('resolveCloudConflict', action => action.choice === 'local');
  assert.equal(h.doc.activeElement, transfer);
  for (const shiftKey of [false, true]) {
    let prevented = false;
    h.ui.handleKey({ key: 'Tab', target: transfer, shiftKey, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.doc.activeElement, transfer);
  }
  h.ui.setBusy(true); h.render({ platform: { conflict: empty } });
  assert.equal(h.doc.activeElement, h.root.querySelector('.gs-cloud-dialog'));
  h.ui.setBusy(false); h.render({ platform: { conflict: empty } });
  assert.equal(h.doc.activeElement, h.button('resolveCloudConflict', action => action.choice === 'local'));
});

test('integer loading progress is percentage, not accidentally a completed fraction', () => {
  const h = harness(); h.render({ screen: 'loading', loading: { progress: 1 } });
  assert.equal(h.root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '1');
  h.render({ screen: 'loading', loading: { progress: 85 } });
  assert.equal(h.root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '85');
});
test('blocked local persistence is not represented as a successful local save', () => {
  const h = harness(); h.render({ platform: { local: { localSaved: false }, cloudStatus: 'unavailable' } });
  assert.ok(h.root.textContent.includes('Прогресс только в этой сессии'));
});
test('healthy guest cloud still exposes explicit benefit-labelled Yandex ID sign-in', () => {
  const h = harness();
  h.render({ screen: 'hub', platform: { sdk: true, auth: 'guest', cloud: true, cloudConnected: true, authenticated: false }, cloud: { status: 'durable' } });
  const login = h.button('cloudConnect'); assert.ok(login); assert.equal(login.disabled, false);
  assert.match(login.textContent, /Яндекс ID/); assert.match(login.textContent, /прогресс на всех устройствах/);
  assert.equal(h.actions.length, 0); h.click(login); assert.deepEqual(h.actions, [{ type: 'cloudConnect' }]);
  h.render({ platform: { sdk: true, auth: 'pending', cloud: false, authenticated: false } });
  const pending = h.button('cloudConnect'); assert.ok(pending); assert.equal(pending.disabled, true); h.click(pending);
  assert.equal(h.actions.length, 1);
  h.ui.setBusy(true); h.ui.setBusy(false); assert.equal(pending.disabled, true);
});
test('authorized failed cloud read offers a retry, not another login or an automatic action', () => {
  const h = harness();
  for (const error of ['cloud-load-failed', 'invalid-cloud-response', 'invalid-cloud-profile', 'timeout']) {
    h.render({ platform: { sdk: true, auth: 'authorized', authenticated: true, cloud: true }, cloud: { available: true, status: 'error', error } });
    assert.equal(h.button('cloudConnect'), undefined); assert.ok(h.button('retryCloud'));
    assert.match(h.button('retryCloud').textContent, /Повторить загрузку из облака/);
    assert.equal(h.root.querySelector('.gs-cloud-dialog'), null);
    assert.equal(h.root.textContent.includes('В облаке пока нет сохранения'), false);
  }
  assert.equal(h.actions.length, 0); h.click(h.button('retryCloud')); assert.deepEqual(h.actions, [{ type: 'retryCloud' }]);
  for (const cloud of [{ status: 'durable' }, { status: 'loading' }, { status: 'error', error: 'cloud-write-failed' }]) {
    h.render({ platform: { sdk: true, auth: 'authorized', authenticated: true, cloud: true }, cloud });
    assert.equal(h.button('retryCloud'), undefined); assert.equal(h.button('cloudConnect'), undefined);
  }
});

test('navigation has five decorative miniature scenes without extra action targets', () => {
  const h = harness(); h.render({ tab: 'style' });
  const tabs = h.root.querySelectorAll('[role="tab"]');
  assert.equal(h.root.querySelectorAll('.gs-nav-scene').length, 5);
  for (const [index, tab] of tabs.entries()) {
    const scene = tab.querySelector('.gs-nav-scene');
    assert.equal(scene.getAttribute('aria-hidden'), 'true');
    assert.ok(scene.className.includes(`gs-scene-${GARAGE_TABS[index].id}`));
    assert.equal(scene.querySelector('svg').getAttribute('viewBox'), '0 0 96 64');
    assert.equal(scene.querySelectorAll('[data-gs-action]').length, 0);
    assert.equal(tab.querySelector('.gs-tab-name').textContent, GARAGE_TABS[index].name);
    assert.equal(tab.dataset.gsFocus, `navigate:garage:${GARAGE_TABS[index].id}`);
  }
  assert.equal(h.actions.length, 0);
  h.click(tabs[0].querySelector('.gs-nav-scene'));
  assert.deepEqual(h.actions, [{ type: 'navigate', screen: 'garage', tab: 'fleet' }]);
});
test('tactile paint samples preserve explicit buy, owned equip, and installed semantics', () => {
  const h = harness(); h.render({ tab: 'style' });
  const graphite = h.button('equipCosmetic', action => action.id === 'paint_graphite');
  const copper = h.button('buyCosmetic', action => action.id === 'paint_copper');
  const installed = h.button('equipCosmetic', action => action.id === 'paint_chalk');
  for (const button of [graphite, copper, installed]) {
    assert.ok(button.className.includes('gs-sample-card'));
    assert.equal(button.querySelector('.gs-material-sample').getAttribute('aria-hidden'), 'true');
    assert.equal(button.querySelectorAll('[data-gs-action]').length, 0);
    assert.ok(button.getAttribute('aria-label'));
  }
  assert.match(graphite.textContent, /Установить/);
  assert.match(copper.textContent, /Купить · 150 ₵/);
  assert.equal(installed.getAttribute('aria-pressed'), 'true');
  assert.match(installed.textContent, /Установлено/);
  assert.equal(installed.disabled, true);
  assert.equal(copper.querySelector('.gs-material-sample').style['--gs-sample-color'], '#F17740');
  assert.equal(h.actions.length, 0, 'rendering a palette must not buy or equip');
  h.click(copper.querySelector('.gs-sample-surface'));
  assert.deepEqual(h.actions, [{ type: 'buyCosmetic', slot: 'body.paint', id: 'paint_copper' }]);
  h.click(graphite.querySelector('.gs-sample-surface'));
  assert.deepEqual(h.actions.at(-1), { type: 'equipCosmetic', slot: 'body.paint', id: 'paint_graphite' });
  assert.equal(h.profile.wallet.credits, 300, 'presenter does not mutate wallet');
});
test('unaffordable material samples state the shortfall and remain guarded', () => {
  const h = harness(); h.render({ tab: 'style' });
  const satin = h.button('buyCosmetic', action => action.id === 'finish_satin');
  assert.ok(satin.querySelector('.gs-sample-finish'));
  assert.equal(satin.disabled, true); assert.match(satin.textContent, /Не хватает 20 ₵/);
  h.click(satin.querySelector('.gs-sample-surface')); assert.equal(h.actions.length, 0);
  h.ui.setBusy(true); h.ui.setBusy(false); assert.equal(satin.disabled, true);
  h.render({ tab: 'style', selectedVehicle: 'hatch' });
  const paint = h.button('equipCosmetic', action => action.id === 'paint_graphite');
  assert.equal(paint.disabled, true); assert.match(paint.textContent, /Сначала приобрети автомобиль/);
});
test('scene motion is finite, keyboard and touch selected, with reduced-motion coverage', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  const sceneRules = css.split('\n').filter(line => line.includes('animation: gs-') && line.includes('gs-scene'));
  assert.ok(sceneRules.length >= 5);
  for (const rule of sceneRules) {
    assert.ok(rule.includes(':focus-visible')); assert.ok(rule.includes("[aria-selected='true']"));
    assert.equal(rule.includes('infinite'), false);
  }
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.gs-nav-scene \*[\s\S]*animation: none !important/);
  assert.match(css, /\.gs-tab \{ min-height: 44px;/);
  assert.match(css, /--gs-editorial: Georgia, 'Times New Roman', serif/);
  assert.equal(/@import|fonts\.googleapis/.test(css), false);
});

test('atelier category controls filter visible parts locally without dispatching economy actions', () => {
  const h = harness(); h.render({ tab: 'style' });
  const categories = h.root.querySelectorAll('.gs-atelier-category');
  assert.deepEqual(categories.map(node => node.textContent), ['Кузов', 'Диски', 'Салон']);
  assert.equal(categories[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'body.paint').hidden, false);
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'wheels.finish').hidden, true);
  const wheels = h.button('_local', action => action.kind === 'atelierCategory' && action.id === 'wheels');
  wheels.focus(); h.click(wheels);
  assert.deepEqual(h.actions, [{ type: 'inspectVehicle', view: 'wheels' }]);
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'body.paint').hidden, true);
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'wheels.finish').hidden, false);
  assert.equal(h.doc.activeElement.dataset.gsFocus, wheels.dataset.gsFocus);
  h.render({ tab: 'style' }); assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'wheels.finish').hidden, false);
  h.ui.setBusy(true); h.click(h.button('_local', action => action.id === 'body')); assert.equal(h.ui.atelierSection, 'wheels');
});
test('garage removes ornamental section captions and has no telemetry navigation', () => {
  const h = harness(); h.render({ tab: 'style' });
  assert.deepEqual(GARAGE_TABS.map(tab => tab.id), ['fleet', 'style', 'engineering', 'contracts', 'season']);
  assert.equal(h.root.querySelector('.gs-panel-caption'), null);
  assert.equal(h.root.querySelector('.gs-stage-description'), null);
  assert.equal(h.root.querySelector('.gs-bay-stamp'), null);
  assert.equal(h.root.querySelector('.gs-tab-number'), null);
  assert.equal(h.root.textContent.includes('Характер в деталях'), false);
  assert.equal(h.root.textContent.includes('ТВОЙ АВТОМОБИЛЬ'), false);
  assert.equal(h.root.querySelector('.gs-panel-heading').textContent, 'Ателье');
});
test('engineering comparison shows supplied simulation values and never fabricates absent measurements', () => {
  const h = harness(); h.render({ tab: 'engineering', engineeringComparison: undefined });
  assert.equal(h.root.querySelector('.gs-engineering-comparison'), null);
  const comparison = [
    { id: 'speed', label: 'Предельная скорость', stock: 180, tuned: 201.6, unit: 'км/ч' },
    { id: 'drain', label: 'Расход энергии', stock: 1, tuned: .85, unit: '×' },
    { id: 'missing', label: 'Неизвестное значение', stock: null, tuned: undefined, unit: 'с' },
  ];
  const original = structuredClone(comparison);
  h.render({ tab: 'engineering', engineeringComparison: comparison });
  assert.match(h.root.querySelector('.gs-engineering-comparison').textContent, /Параметры игровой модели/);
  assert.equal(h.root.querySelector('[data-metric="speed"]').querySelector('.gs-comparison-stock').textContent, '180 км/ч');
  assert.equal(h.root.querySelector('[data-metric="speed"]').querySelector('.gs-comparison-tuned').textContent, '201,6 км/ч');
  assert.equal(h.root.querySelector('[data-metric="drain"]').querySelector('.gs-comparison-tuned').textContent, '0,85 ×');
  assert.equal(h.root.querySelector('[data-metric="missing"]').querySelector('.gs-comparison-stock').textContent, '—');
  assert.deepEqual(comparison, original); assert.equal(h.actions.length, 0);
});

test('results highlight only supplied current-run metrics and retain cumulative records separately', () => {
  const h = harness(); h.render({ screen: 'results', runResult: { metrics: { roadEventsCompleted: 3, airborneOvertakes: 2, precisionLandings: 1, landings: 4, airSeconds: 12, peakSpeedMps: 50 } } });
  const highlights = h.root.querySelector('.gs-run-highlights'); assert.ok(highlights);
  assert.match(highlights.textContent, /180км\/ч/);
  assert.match(highlights.textContent, /ДОРОЖНЫЕ СОБЫТИЯ3/);
  assert.match(highlights.textContent, /ОБГОНЫ В ВОЗДУХЕ2/);
  assert.match(highlights.textContent, /ТОЧНЫЕ ПОСАДКИ \/ ВСЕ1 \/ 4/);
  assert.match(h.root.querySelector('.gs-result-stats').textContent, /В НЕБЕ12с/);
  assert.ok(h.root.querySelector('.gs-results-records'));
  h.render({ screen: 'results', runResult: {} }); assert.equal(h.root.querySelector('.gs-run-highlights'), null);
  h.render({ screen: 'loading' });
  assert.equal(h.root.textContent.includes('Без рекламы до первого заезда'), false);
  assert.match(h.root.textContent, /Вход в аккаунт не обязателен/);
});

test('all settings selects keep explicit accessible names even when their visual label is hidden', () => {
  const h = harness();
  const names = { route: 'Маршрут', runMode: 'Класс заезда', difficulty: 'Плотность трафика', cameraMode: 'Камера', renderQuality: 'Качество графики' };
  const seen = new Set();
  for (const view of [{ screen: 'hub' }, { tab: 'fleet' }, { tab: 'engineering' }]) {
    h.render(view);
    for (const select of h.root.querySelectorAll('select')) {
      select.parentElement.querySelector('span').hidden = true;
      assert.equal(select.getAttribute('aria-label'), names[select.dataset.gsSetting]);
      seen.add(select.dataset.gsSetting);
    }
  }
  h.click(h.button('_local', action => action.kind === 'openSettings'));
  for (const select of h.root.querySelectorAll('select')) {
    select.parentElement.querySelector('span').hidden = true;
    assert.equal(select.getAttribute('aria-label'), names[select.dataset.gsSetting]);
    seen.add(select.dataset.gsSetting);
  }
  assert.deepEqual([...seen].sort(), Object.keys(names).sort());
});

test('panel muted text exceeds AA contrast on plain, selected and material surfaces', async () => {
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  const foreground = [...css.matchAll(/--gs-panel-muted:\s*(#[\da-f]{6})/gi)].at(-1)?.[1]; assert.ok(foreground);
  const luminance = hex => {
    const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const background of ['#252533', '#413348', '#303043', '#403248', '#3c3349', '#4a354e']) {
    const ratio = (luminance(foreground) + .05) / (luminance(background) + .05);
    assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio}`);
  }
  assert.match(css, /\.gs-list-index \{ color: var\(--gs-panel-muted\); font-size: 10px; \}/);
});
test('initial unavailable or guest player errors expose cloud-read retry before optional login', () => {
  const h = harness();
  for (const auth of ['unavailable', 'guest', 'authorized']) {
    h.render({ screen: 'hub', platform: { sdk: true, auth, cloud: false, authenticated: auth === 'authorized' }, cloud: { available: false, status: 'error', error: 'cloud-load-failed' } });
    const retry = h.button('retryCloud'); assert.ok(retry); assert.equal(retry.disabled, false);
    assert.equal(h.button('cloudConnect'), undefined);
    assert.match(h.root.querySelector('.gs-save-status').textContent, /облако не подтверждено/);
    assert.equal(h.actions.length, 0);
  }
  h.click(h.button('retryCloud')); assert.deepEqual(h.actions, [{ type: 'retryCloud' }]);
  for (const platform of [
    { sdk: false, auth: 'unavailable' },
    { sdk: true, auth: 'pending' },
    { sdk: true, auth: 'unavailable', conflict: { local: {}, cloud: {} } },
  ]) {
    h.render({ platform, cloud: { status: 'error', error: 'cloud-load-failed' } });
    assert.equal(h.button('retryCloud'), undefined);
  }
  h.render({ platform: { sdk: true, auth: 'guest', cloud: true }, cloud: { status: 'durable' } });
  assert.ok(h.button('cloudConnect')); assert.equal(h.button('retryCloud'), undefined);
  h.render({ platform: { sdk: true, auth: 'unavailable' }, cloud: { status: 'error', error: 'cloud-write-failed' } });
  assert.equal(h.button('retryCloud'), undefined);
});

test('scrollable workbench is focusable even with no enabled panel controls and preserves tab navigation', () => {
  const h = harness();
  for (const tab of ['contracts', 'season']) {
    h.render({ tab }); const panel = h.root.querySelector('[role="tabpanel"]');
    for (const control of panel.querySelectorAll('button')) control.disabled = true;
    assert.equal(panel.tabIndex, 0); assert.equal(panel.dataset.gsFocus, 'workbench');
    panel.focus(); h.render({ tab }); assert.equal(h.doc.activeElement.dataset.gsFocus, 'workbench');
    assert.equal(h.root.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), `gs-tab-${tab}`);
  }
  const season = h.root.querySelector('[data-gs-tab="season"]');
  h.ui.handleKey({ target: season, key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(h.actions.at(-1), { type: 'navigate', screen: 'garage', tab: 'fleet' });
});
test('results use functional headings and keep actions separate from scrollable rewards and optional offers', async () => {
  const h = harness(); h.render({ screen: 'results', runResult: { newRecord: true, credits: 12, xp: 3, onboarding: 200, canRevive: true } });
  assert.equal(h.root.querySelector('.gs-result-intro h1').textContent, 'Новый рекорд');
  assert.equal(h.root.querySelector('.gs-settlement h2').textContent, 'Награды за заезд');
  assert.equal(h.root.querySelector('.gs-result-intro').querySelector('.gs-kicker'), null);
  const scroll = h.root.querySelector('.gs-settlement-scroll');
  const actions = h.root.querySelector('.gs-result-actions');
  assert.equal(scroll.contains(h.button('revive')), false);
  assert.equal(h.root.querySelector('.gs-result-optional').contains(h.button('revive')), true);
  assert.equal(scroll.contains(h.root.querySelector('.gs-results-records')), true);
  assert.match(scroll.textContent, /первый рубеж · \+200 ₵/);
  assert.equal(scroll.contains(actions), false);
  assert.equal(actions.parentElement, h.root.querySelector('.gs-result-intro'));
  assert.equal(actions.contains(h.button('startDrive')), true);
  h.render({ screen: 'results', runResult: {} }); assert.equal(h.root.querySelector('.gs-result-intro h1').textContent, 'Результат заезда');
  const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
  assert.match(css, /\.gs-settlement-scroll \{ flex: 1 1 auto; min-height: 0; overflow-y: auto/);
  assert.match(css, /\.gs-result-actions \{ flex: 0 0 auto; margin: 0; padding: 9px 12px;/);
  assert.match(css, /\.gs-result-actions \.gs-button \{ min-height: 44px;/);
});

test('category selection requests the matching camera immediately, never mutates cosmetics and respects overlays', () => {
  const h = harness(); h.render({ tab: 'style' });
  const original = structuredClone(h.profile);
  for (const [id, view] of [['wheels', 'wheels'], ['cockpit', 'cockpit'], ['body', 'overview']]) {
    h.click(h.button('_local', action => action.kind === 'atelierCategory' && action.id === id));
    assert.deepEqual(h.actions.at(-1), { type: 'inspectVehicle', view });
    assert.equal(h.ui.atelierSection, id);
    assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 0);
  }
  assert.deepEqual(h.profile, original);
  h.ui.setVisible(false); h.click(h.button('_local', action => action.id === 'wheels')); h.ui.setVisible(true);
  h.click(h.button('_local', action => action.kind === 'openSettings'));
  h.click(h.button('_local', action => action.id === 'wheels'));
  h.click(h.button('_local', action => action.kind === 'closeSettings'));
  h.render({ tab: 'style', loading: { adPending: true } }); h.click(h.button('_local', action => action.id === 'wheels'));
  assert.equal(h.actions.length, 3); assert.equal(h.ui.atelierSection, 'body');
});

test('real glass tint entries live below Body → Glass and retain actual catalog prices and actions', () => {
  const h = harness();
  const cosmetics = [
    { id: 'paint_fixture', slot: 'body.paint', name: 'Краска', price: 0, owned: true, color: '#68739c' },
    { id: 'tint_fixture', slot: 'body.tint', name: 'Дымчатое стекло', price: 160, tintColor: '#63668a', visual: { opacity: .65 } },
  ];
  const original = structuredClone(cosmetics);
  h.render({ tab: 'style', cosmetics });
  assert.deepEqual(h.root.querySelectorAll('.gs-body-section').map(node => node.textContent), ['Покрытие и детали', 'Стёкла']);
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'body.tint').hidden, true);
  h.click(h.button('_local', action => action.kind === 'atelierBodySection' && action.id === 'glass'));
  assert.deepEqual(h.actions, [{ type: 'inspectVehicle', view: 'overview' }]);
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'body.tint').hidden, false);
  assert.equal(h.root.querySelectorAll('.gs-item-group').find(node => node.dataset.gsSlot === 'body.paint').hidden, true);
  assert.equal(h.root.querySelector('.gs-material-feature').textContent, 'На машинеСерийное стекло');
  const tint = h.button('buyCosmetic', action => action.id === 'tint_fixture');
  assert.match(tint.textContent, /Купить · 160 ₵/); assert.equal(tint.disabled, false);
  assert.equal(tint.querySelector('.gs-sample-glass').style['--gs-glass-opacity'], .65);
  assert.equal(tint.querySelector('.gs-sample-glass').style['--gs-sample-color'], '#63668a');
  h.click(tint); assert.deepEqual(h.actions.at(-1), { type: 'buyCosmetic', id: 'tint_fixture', slot: 'body.tint' });
  assert.deepEqual(cosmetics, original);
});

test('steering variants come only from the supplied catalog and capability gates stay authoritative', () => {
  const h = harness();
  const cosmetics = [
    { id: 'fixture_round', slot: 'cockpit.steering', name: 'Круглый', price: 650, owned: true, visual: { variant: 'round' } },
    { id: 'fixture_yoke', slot: 'cockpit.steering', name: 'Штурвал', price: 850, available: false, reason: 'Геометрия ещё загружается', visual: { variant: 'yoke' } },
  ];
  h.render({ tab: 'style', cosmetics });
  assert.equal(h.root.querySelectorAll('.gs-sample-card').length, 2);
  assert.equal(h.root.querySelectorAll('.gs-body-section').length, 0);
  const round = h.button('equipCosmetic', action => action.id === 'fixture_round');
  assert.equal(round.querySelector('.gs-sample-steering').dataset.variant, 'round'); assert.equal(round.disabled, false);
  const yoke = h.button('buyCosmetic', action => action.id === 'fixture_yoke');
  assert.equal(yoke.querySelector('.gs-sample-steering').dataset.variant, 'yoke'); assert.equal(yoke.disabled, true);
  assert.match(yoke.textContent, /Геометрия ещё загружается/); h.click(yoke); assert.equal(h.actions.length, 0);
  h.click(round); assert.deepEqual(h.actions, [{ type: 'equipCosmetic', id: 'fixture_round', slot: 'cockpit.steering' }]);
  h.render({ tab: 'style', cosmetics: [] });
  assert.equal(h.root.querySelectorAll('.gs-sample-card').length, 0);
  assert.equal(h.root.querySelector('.gs-material-feature'), null);
});

test('material feature displays only the authoritative installed item and is never itself a buy action', () => {
  const h = harness();
  h.render({ tab: 'style', loadout: { cosmetics: { 'body.paint': 'paint_graphite' } } });
  const feature = h.root.querySelector('.gs-material-feature');
  assert.equal(feature.textContent, 'На машинеГрафит');
  assert.equal(feature.querySelectorAll('[data-gs-action]').length, 0);
  assert.equal(feature.querySelector('.gs-material-sample').getAttribute('aria-hidden'), 'true');
  h.render({ tab: 'style', loadout: { cosmetics: { 'body.paint': 'paint_chalk' } } });
  assert.equal(h.root.querySelector('.gs-material-feature').textContent, 'На машинеМел');
});

test('upgrade buttons retain the displayed next-level intent rather than silently buying a later tier',()=>{
 const profile=createProfile({id:'upgrade_intents'});profile.wallet.credits=10000;profile.research.drive=2;profile.garage.level=2;
 const h=harness(profile);h.render({tab:'engineering'});
 h.click(h.button('upgradeEngineering',action=>action.branch==='drive'));
 assert.deepEqual(h.actions.at(-1),{type:'upgradeEngineering',branch:'drive',expectedLevel:3});
 h.click(h.button('upgradeGarage'));assert.deepEqual(h.actions.at(-1),{type:'upgradeGarage',expectedLevel:3});
});

test('selected car heading remains dynamic and accessible in the lower-right title dock', () => {
  const h=harness();
  for(const selectedVehicle of ['rocket','hatch','sedan','suv','van']) {
    h.render({screen:'garage',tab:'fleet',selectedVehicle});
    const title=h.root.querySelector('[data-gs-heading]'),dock=h.root.querySelector('.gs-vehicle-title-dock');
    assert.ok(dock.contains(title));assert.equal(title.tagName,'H1');assert.equal(title.tabIndex,-1);
    assert.equal(title.textContent,h.ui.view.selected.name);assert.equal(h.root.querySelectorAll('[data-gs-heading]').length,1);
    const spacer=h.root.querySelector('.gs-title-reservation');assert.equal(spacer.getAttribute('aria-hidden'),'true');assert.equal(spacer.textContent,title.textContent);
    const stage=h.root.querySelector('.gs-stage');assert.ok(stage.querySelector('.gs-stage-bottom').contains(dock));assert.equal(h.root.querySelector('.gs-workbench-column'),null);assert.equal(h.root.querySelector('.gs-garage').children[2],h.root.querySelector('.gs-workbench'));assert.equal(h.root.querySelectorAll('.gs-vehicle-title').length,1);
    assert.ok(h.root.querySelector('.gs-brand').textContent.includes('Roadster'));
  }
});

test('fleet cards expose five real-model canvases rather than reused car icons', () => {
  const h=harness();let targets;h.ui.onMiniatures=value=>{targets=value;};h.render({tab:'fleet'});
  assert.deepEqual(targets.map(x=>x.id),['rocket','hatch','sedan','suv','van']);
  for(const target of targets){assert.equal(target.canvas.tagName,'CANVAS');assert.equal(target.canvas.width,320);assert.equal(target.canvas.height,180);assert.equal(target.canvas.parentElement.querySelector('svg'),null);assert.equal(target.canvas.parentElement.getAttribute('aria-hidden'),'true');}
  assert.equal(h.root.querySelectorAll('[data-fleet-id]').length,5);assert.equal(h.actions.length,0);
});
test('fleet miniature appearance is saved owned equipment, while locked cars remain stock', () => {
  const profile=createProfile({now:123});profile.cosmetics.owned.push('paint_copper','rim_copper');profile.loadouts.rocket.cosmetics={'body.paint':'paint_copper','wheels.finish':'rim_copper'};profile.loadouts.hatch={cosmetics:{'body.paint':'paint_copper'}};
  const h=harness(profile);h.render({tab:'fleet'});const targets=h.ui.getFleetMiniatureTargets();
  assert.deepEqual(targets[0].appearance,profile.loadouts.rocket.cosmetics);assert.notEqual(targets[0].appearance,profile.loadouts.rocket.cosmetics);assert.deepEqual(targets[1].appearance,{});assert.equal(h.actions.length,0);
});
test('fleet hover, keyboard focus and touch request visual turns without acquiring or selecting cars', () => {
  const h=harness();const calls=[];h.ui.onMiniatureInteraction=(...value)=>calls.push(value);h.render({tab:'fleet'});calls.length=0;
  const row=h.root.querySelector('[data-fleet-id="hatch"]'),canvas=row.querySelector('canvas');
  h.ui.handleMiniatureInteraction({type:'pointerover',pointerType:'mouse',target:canvas});assert.deepEqual(calls.at(-1),['hatch','hover']);
  const count=calls.length;h.ui.handleMiniatureInteraction({type:'pointerout',pointerType:'mouse',target:canvas,relatedTarget:row});assert.equal(calls.length,count);
  h.ui.handleMiniatureInteraction({type:'pointerout',pointerType:'mouse',target:row});assert.deepEqual(calls.at(-1),[null,'hover']);
  h.ui.handleMiniatureInteraction({type:'focusin',target:row});assert.deepEqual(calls.at(-1),['hatch','focus']);
  h.ui.handleMiniatureInteraction({type:'focusout',target:row});assert.deepEqual(calls.at(-1),[null,'focus']);
  h.ui.handleMiniatureInteraction({type:'pointerdown',pointerType:'touch',target:canvas});assert.deepEqual(calls.at(-1),['hatch','touch']);assert.equal(h.actions.length,0);
});
test('fleet interaction respects overlays and clears models when the catalog unmounts', () => {
  const h=harness();const turns=[],targets=[];h.ui.onMiniatureInteraction=id=>turns.push(id);h.ui.onMiniatures=value=>targets.push(value);h.render({tab:'fleet'});
  const row=h.root.querySelector('[data-fleet-id="rocket"]'),event={type:'pointerover',target:row};const count=turns.length;
  h.ui.setBusy(true);h.ui.handleMiniatureInteraction(event);assert.equal(turns.length,count);h.ui.setBusy(false);
  h.ui.settingsOpen=true;h.ui.handleMiniatureInteraction(event);assert.equal(turns.length,count);h.ui.settingsOpen=false;
  h.ui.setVisible(false);assert.equal(turns.at(-1),null);h.ui.handleMiniatureInteraction(event);assert.equal(turns.at(-1),null);
  h.ui.setVisible(true);h.render({tab:'style'});assert.deepEqual(targets.at(-1),[]);assert.equal(turns.at(-1),null);
  h.ui.dispose();assert.deepEqual(targets.at(-1),[]);for(const key of ['pointerover','pointerout','pointerdown','focusin','focusout'])assert.equal(h.root.listeners[key],undefined);
});

test('earned free finish precedes both video choices and remains outside the result scroll',()=>{
  const h=harness();h.render({screen:'results',platform:{rewarded:true},runResult:{settled:true,receipt:{credits:321,baseCredits:121,xp:25},onboarding:200,canRevive:true,bonusEligible:true,bonusCredits:121}});
  const panel=h.root.querySelector('.gs-settlement'),free=h.root.querySelector('.gs-result-free-choice'),scroll=h.root.querySelector('.gs-settlement-scroll');
  assert.equal(panel.children[0],free);assert.ok(free.contains(h.button('finishRun')));assert.equal(scroll.contains(h.button('finishRun')),false);
  assert.match(free.textContent,/Твои \+321 ₵ · уже начислены/);assert.match(h.button('finishRun').textContent,/Завершить и забрать/);
  assert.match(h.button('rewardedBonus').textContent,/×2 и завершить · \+121/);assert.match(h.root.querySelector('.gs-result-optional').textContent,/121 → 242 ₵ за вождение/);
  assert.match(scroll.textContent,/Первый рубеж, контракты, награды сезона и XP не удваиваются/);
  h.click(h.button('finishRun'));assert.deepEqual(h.actions.at(-1),{type:'finishRun'});
});

for(const result of [
  {bonusReason:'no-base-reward',receipt:{credits:0,baseCredits:0}},
  {bonusReason:'wallet-cap',receipt:{credits:12,baseCredits:12}},
  {bonusReason:'continue-chosen',receipt:{credits:50,baseCredits:50}},
  {settled:false},
])test(`free finish is available without a video offer for ${result.bonusReason||'an unsettled result'}`,()=>{
  const h=harness();h.render({screen:'results',platform:{rewarded:false},runResult:result});
  assert.ok(h.button('finishRun'));assert.equal(h.button('finishRun').disabled,false);assert.ok(h.button('startDrive'));assert.equal(h.button('rewardedBonus'),undefined);
});

test('finalized and doubled results expose no continuation or duplicate reward claims',()=>{
  const h=harness();h.render({screen:'results',platform:{rewarded:true},runResult:{settled:true,finalized:true,bonusClaimed:true,canRevive:true,bonusEligible:true,receipt:{credits:442,baseCredits:121}}});
  assert.equal(h.button('finishRun'),undefined);assert.equal(h.button('rewardedBonus'),undefined);assert.equal(h.button('revive'),undefined);
  const free=h.root.querySelector('.gs-result-free-choice');assert.match(free.textContent,/удвоение получено/);assert.match(free.textContent,/В гараж/);
});

test('busy ad requests disable result choices instead of offering an unsafe second operation',()=>{
  const h=harness();h.render({screen:'results',platform:{rewarded:true},runResult:{settled:true,canRevive:true,bonusEligible:true,bonusCredits:100}});h.ui.setBusy(true);
  for(const action of ['finishRun','startDrive','revive','rewardedBonus']){const button=h.button(action);assert.equal(button.disabled,true);h.click(button);}
  assert.equal(h.actions.length,0);
});


test('compact result hierarchy keeps both optional choices before expandable reward details',()=>{
  const h=harness();h.render({screen:'results',platform:{rewarded:true},runResult:{settled:true,receipt:{credits:479,baseCredits:279,xp:67},canRevive:true,bonusEligible:true,bonusCredits:279}});
  const panel=h.root.querySelector('.gs-settlement'),free=h.root.querySelector('.gs-result-free-choice'),choices=h.root.querySelector('.gs-result-optional'),scroll=h.root.querySelector('.gs-settlement-scroll'),details=h.root.querySelector('.gs-result-details');
  assert.deepEqual(panel.children,[free,choices,scroll]);assert.ok(choices.contains(h.button('revive')));assert.ok(choices.contains(h.button('rewardedBonus')));
  assert.equal(details.open,undefined);assert.equal(details.querySelector('summary').textContent,'Награды и условия ↓');
  assert.ok(details.contains(h.root.querySelector('.gs-settlement-rewards')));assert.equal(details.contains(h.button('revive')),false);assert.equal(details.contains(h.button('rewardedBonus')),false);
  assert.match(choices.textContent,/279 → 558 ₵ за вождение/);assert.match(choices.textContent,/Без XP/);
});

for(const recoveryKind of ['result','interrupted'])test(`recovered ${recoveryKind} explains unavailable continuation without claiming a failed save is durable`,()=>{
 const h=harness();h.render({screen:'results',platform:{rewarded:true},runResult:{recovered:true,recoveryKind,settled:true,canRevive:false,bonusEligible:recoveryKind==='result',bonusCredits:60,receipt:{credits:260,baseCredits:60,xp:12},saveMessage:'Награда учтена в этой сессии. Локальное сохранение недоступно.'}});
 assert.equal(h.root.querySelector('[data-gs-heading]').textContent,recoveryKind==='result'?'Сохранённый результат':'Прерванный заезд');
 const free=h.root.querySelector('.gs-result-free-choice');assert.match(free.textContent,/После перезагрузки продолжение недоступно/);assert.doesNotMatch(free.textContent,/Награда сохранена/);
 assert.match(h.root.querySelector('.gs-settlement-scroll').textContent,/Локальное сохранение недоступно/);
 assert.equal(h.button('revive'),undefined);assert.equal(!!h.button('rewardedBonus'),recoveryKind==='result');assert.ok(h.button('finishRun'));
});

test('recovered result without SDK has no empty video-choice heading or fabricated training continuation',()=>{
 const h=harness();h.render({screen:'results',platform:{rewarded:false},runResult:{recovered:true,recoveryKind:'result',settled:true,canRevive:false,bonusEligible:true,bonusCredits:60,receipt:{credits:60,baseCredits:60}}});
 assert.equal(h.root.querySelector('.gs-result-optional'),null);assert.equal(h.button('revive'),undefined);assert.equal(h.button('rewardedBonus'),undefined);assert.ok(h.button('finishRun'));
});

// Scroll coordinates are deterministic DOM state here; native iframe QA proves
// the corresponding selected-control visibility and hitboxes at phone sizes.
const garageHorizontalStrips = ['.gs-tabs', '.gs-inspection', '.gs-atelier-categories', '.gs-body-sections'];

test('garage refresh restores horizontal strips and vertical panel before preventScroll focus', () => {
  const h = harness(); h.render({ tab: 'style' });
  const offsets = [173.5, 91, 27, 34];
  const previous = garageHorizontalStrips.map((selector, index) => {
    const node = h.root.querySelector(selector); assert.ok(node, selector); node.scrollLeft = offsets[index]; return node;
  });
  h.root.querySelector('.gs-workbench').scrollTop = 487;
  h.button('inspectVehicle', action => action.view === 'cockpit').focus();
  let focused;
  h.doc.onFocus = (node, options) => {
    focused = { id: node.dataset.gsFocus, options, horizontal: garageHorizontalStrips.map(selector => h.root.querySelector(selector).scrollLeft), vertical: h.root.querySelector('.gs-workbench').scrollTop };
  };
  h.render({ tab: 'style', inspection: 'cockpit' });
  for (const [index, selector] of garageHorizontalStrips.entries()) assert.notEqual(h.root.querySelector(selector), previous[index], 'A genuinely replaced strip was restored');
  assert.deepEqual(focused, { id: 'inspectVehicle:cockpit', options: { preventScroll: true }, horizontal: offsets, vertical: 487 });
  assert.equal(h.doc.activeElement.getAttribute('aria-pressed'), 'true');
});

test('garage tabs preserve horizontal navigation across panels while panel scroll resets independently', () => {
  const h = harness(); h.render({ tab: 'style' });
  h.root.querySelector('.gs-tabs').scrollLeft = 205;
  h.root.querySelector('.gs-inspection').scrollLeft = 77;
  h.root.querySelector('.gs-atelier-categories').scrollLeft = 22;
  h.root.querySelector('.gs-body-sections').scrollLeft = 19;
  h.root.querySelector('.gs-workbench').scrollTop = 300;
  h.render({ tab: 'season' });
  assert.equal(h.root.querySelector('.gs-tabs').scrollLeft, 205);
  assert.equal(h.root.querySelector('.gs-inspection').scrollLeft, 77);
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 0);
  assert.equal(h.root.querySelector('.gs-atelier-categories'), null);
  h.render({ tab: 'style' });
  assert.equal(h.root.querySelector('.gs-tabs').scrollLeft, 205);
  assert.equal(h.root.querySelector('.gs-inspection').scrollLeft, 77);
  assert.equal(h.root.querySelector('.gs-atelier-categories').scrollLeft, 0);
  assert.equal(h.root.querySelector('.gs-body-sections').scrollLeft, 0);
});

test('Atelier selection retains the scrolled navigation but resets removed Body strips and vertical content', () => {
  const h = harness(); h.render({ tab: 'style' });
  h.root.querySelector('.gs-atelier-categories').scrollLeft = 26;
  h.root.querySelector('.gs-body-sections').scrollLeft = 31;
  h.root.querySelector('.gs-workbench').scrollTop = 240;
  const glass = h.button('_local', action => action.kind === 'atelierBodySection' && action.id === 'glass'); glass.focus(); h.click(glass);
  assert.equal(h.ui.atelierBodySection, 'glass');
  assert.equal(h.root.querySelector('.gs-body-sections').scrollLeft, 31);
  assert.equal(h.root.querySelector('.gs-atelier-categories').scrollLeft, 26);
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 0, 'Existing category content reset is unchanged');
  assert.equal(h.doc.activeElement.dataset.gsFocus, glass.dataset.gsFocus);
  assert.deepEqual(h.doc.activeElement.focusOptions, { preventScroll: true });
  h.click(h.button('_local', action => action.kind === 'atelierCategory' && action.id === 'cockpit'));
  assert.equal(h.root.querySelector('.gs-atelier-categories').scrollLeft, 26);
  assert.equal(h.root.querySelector('.gs-body-sections'), null);
  h.click(h.button('_local', action => action.kind === 'atelierCategory' && action.id === 'body'));
  assert.equal(h.root.querySelector('.gs-atelier-categories').scrollLeft, 26);
  assert.equal(h.root.querySelector('.gs-body-sections').scrollLeft, 0, 'Reintroduced strips start fresh rather than reviving stale offsets');
});

test('changing selected vehicle resets its inspection and Atelier offsets but preserves global tabs', () => {
  const h = harness(); h.render({ tab: 'style' });
  for (const [index, selector] of garageHorizontalStrips.entries()) h.root.querySelector(selector).scrollLeft = 40 + index;
  h.render({ tab: 'style', selectedVehicle: 'hatch' });
  assert.equal(h.root.querySelector('.gs-tabs').scrollLeft, 40);
  assert.equal(h.root.querySelector('.gs-inspection').scrollLeft, 0);
  assert.equal(h.root.querySelector('.gs-atelier-categories').scrollLeft, 0);
  assert.equal(h.root.querySelector('.gs-body-sections').scrollLeft, 0);
});

test('leaving garage clears horizontal history without changing independent HOME vertical scroll', () => {
  const h = harness(); h.render({ tab: 'style' });
  for (const selector of garageHorizontalStrips) h.root.querySelector(selector).scrollLeft = 120;
  h.root.querySelector('.gs-workbench').scrollTop = 270;
  h.render({ screen: 'hub' });
  assert.equal(h.root.querySelector('.gs-inspection'), null);
  h.root.querySelector('.gs-hub').scrollTop = 164;
  h.render({ screen: 'hub' });
  assert.equal(h.root.querySelector('.gs-hub').scrollTop, 164);
  h.render({ tab: 'style' });
  for (const selector of garageHorizontalStrips) assert.equal(h.root.querySelector(selector).scrollLeft, 0, selector);
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 0);
});

test('non-finite horizontal offsets are ignored rather than carried into replacement DOM', () => {
  const h = harness(); h.render({ tab: 'style' });
  for (const [index, selector] of garageHorizontalStrips.entries()) h.root.querySelector(selector).scrollLeft = [NaN, Infinity, -Infinity, undefined][index];
  h.root.querySelector('.gs-workbench').scrollTop = 95;
  h.render({ tab: 'style' });
  for (const selector of garageHorizontalStrips) assert.equal(h.root.querySelector(selector).scrollLeft, 0, selector);
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 95);
});

test('Fleet list retains the fifth car through selection and refresh independently of its workbench', () => {
  const h = harness(); h.render({ tab: 'fleet' });
  const id = CATALOG.fleet.at(-1).id;
  const previous = h.root.querySelector('.gs-vehicle-list'); previous.scrollTop = 67.5;
  h.root.querySelector('.gs-workbench').scrollTop = 93;
  h.root.querySelector('.gs-tabs').scrollLeft = 42;
  const fifth = h.button('selectVehicle', action => action.id === id); fifth.focus(); h.click(fifth);
  assert.deepEqual(h.actions.at(-1), { type: 'selectVehicle', id });
  let focused;
  h.doc.onFocus = (node, options) => {
    focused = { id: node.dataset.gsFocus, options, list: h.root.querySelector('.gs-vehicle-list').scrollTop, panel: h.root.querySelector('.gs-workbench').scrollTop };
  };
  const miniatureOffsets = [];
  h.ui.onMiniatures = () => miniatureOffsets.push(h.root.querySelector('.gs-vehicle-list').scrollTop);
  h.render({ tab: 'fleet', selectedVehicle: id });
  assert.notEqual(h.root.querySelector('.gs-vehicle-list'), previous);
  assert.deepEqual(focused, { id: `selectVehicle:${id}`, options: { preventScroll: true }, list: 67.5, panel: 93 });
  assert.equal(h.doc.activeElement.getAttribute('aria-pressed'), 'true');
  assert.equal(h.root.querySelector('.gs-tabs').scrollLeft, 42);
  assert.deepEqual(miniatureOffsets, [67.5], 'Miniature visibility sees the restored list viewport');
  h.render({ tab: 'fleet', selectedVehicle: id });
  assert.equal(h.root.querySelector('.gs-vehicle-list').scrollTop, 67.5);
  assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 93);
});

test('Fleet list does not retain a stale offset after a screen or panel change', () => {
  for (const destination of [{ screen: 'hub' }, { tab: 'style' }]) {
    const h = harness(); h.render({ tab: 'fleet' });
    h.root.querySelector('.gs-vehicle-list').scrollTop = 111;
    h.render(destination);
    assert.equal(h.root.querySelector('.gs-vehicle-list'), null);
    h.render({ tab: 'fleet' });
    assert.equal(h.root.querySelector('.gs-vehicle-list').scrollTop, 0);
  }
});

test('Fleet list ignores non-finite offsets without resetting independent panel scroll', () => {
  for (const offset of [NaN, Infinity, -Infinity, undefined]) {
    const h = harness(); h.render({ tab: 'fleet' });
    h.root.querySelector('.gs-vehicle-list').scrollTop = offset;
    h.root.querySelector('.gs-workbench').scrollTop = 55;
    h.render({ tab: 'fleet' });
    assert.equal(h.root.querySelector('.gs-vehicle-list').scrollTop, 0);
    assert.equal(h.root.querySelector('.gs-workbench').scrollTop, 55);
  }
});
