import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { GarageUI, normalizeGarageView } from '../src/garage-ui.js';

const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
const compact = css.slice(css.indexOf('/* RESULTS_COMPACT:'), css.indexOf('/* RESULTS_COMPACT_END */'));
const root = ".garage-shell[data-screen='results']";
const media = compact.slice(compact.indexOf('@media'));
const rules = [...media.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.trim().split(/,\s*(?=\.garage-shell)/),
  declarations: Object.fromEntries(body.split(';').filter(part => part.trim()).map(part => {
    const colon = part.indexOf(':'); return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  })),
}));
const declarations = suffix => Object.assign({}, ...rules.filter(rule => rule.selectors.includes(`${root}${suffix ? ` ${suffix}` : ''}`)).map(rule => rule.declarations));

// Intentionally only a presentation DOM: no SDK, browser storage or gameplay.
class Node {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.className = ''; this._text = ''; this.disabled = false; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  prepend(...children) { for (const child of children) child.parentElement = this; this.children.unshift(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if (selector === '[data-gs-action]') return !!this.dataset.gsAction;
    return this.tagName.toLowerCase() === selector;
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(selector.split(',').some(part => child.matches(part.trim())) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function harness(runResult, extra = {}) {
  const doc = { createElement(tag) { return new Node(this, tag); }, createElementNS(_ns, tag) { return new Node(this, tag); } };
  const ui = Object.create(GarageUI.prototype), actions = [];
  ui.doc = doc; ui.view = normalizeGarageView({ screen: 'results', platform: { rewarded: true }, runResult, ...extra });
  ui.notice = () => {}; ui.onAction = action => actions.push(action); ui.root = new Node(doc, 'div'); ui.root.append(ui.renderResults());
  const find = selector => ui.root.querySelector(selector);
  const button = type => ui.root.querySelectorAll('[data-gs-action]').find(node => JSON.parse(node.dataset.gsAction).type === type);
  return { ui, actions, find, button };
}
const normal = { score: 5611, distance: 1323, flightTime: 12, settled: true, canRevive: true, bonusEligible: true, bonusCredits: 279, receipt: { credits: 479, baseCredits: 279, xp: 67 }, metrics: { peakSpeedMps: 65.83, roadEventsCompleted: 1, airborneOvertakes: 2, precisionLandings: 3, landings: 4 } };

test('compact CSS is valid and bounded to landscape results, including the 551px iframe', async () => {
  const parsed = await transform(css, { loader: 'css' }); assert.deepEqual(parsed.warnings, []);
  assert.match(media, /^@media \(orientation: landscape\) and \(max-height: 620px\) and \(max-width: 1100px\)/);
  assert.doesNotMatch(media, /min-width:\s*600px/);
  for (const rule of rules) for (const selector of rule.selectors) assert.ok(selector === root || selector.startsWith(`${root} `), selector);
  assert.doesNotMatch(media, /data-screen=['"](?:hub|garage)|transform:\s*scale|zoom:|text-size-adjust:\s*none/);
  assert.equal(declarations()['--gs-compact-results'], '1');
});

test('compact-only additions are hidden outside the compact media scope', () => {
  const desktop = compact.slice(0, compact.indexOf('@media'));
  for (const selector of ['.gs-results-stage', '.gs-result-compact-rewards', '.gs-result-compact-status', '.gs-result-compact-label']) assert.ok(desktop.includes(selector));
  assert.match(desktop, /display:\s*none/);
  assert.doesNotMatch(desktop, /\.gs-header|\.gs-result-intro|\.gs-settlement\s*\{/);
});

test('small result pages reserve a real transparent car rectangle and pinned new-run action', () => {
  const h = harness(normal), intro = h.find('.gs-result-intro'), stage = h.find('.gs-results-stage'), retry = h.find('.gs-result-retry');
  assert.equal(stage.getAttribute('aria-hidden'), 'true'); assert.equal(stage.children.length, 0);
  assert.equal(stage.parentElement, intro); assert.equal(intro.children.at(-3), stage); assert.equal(intro.children.at(-2), h.find('.gs-result-compact-status')); assert.equal(intro.children.at(-1), retry);
  assert.equal(declarations('.gs-header').flex, '0 0 44px');
  assert.equal(declarations('.gs-results')['grid-template-columns'], 'minmax(0, 1fr) var(--gs-results-panel)');
  assert.equal(declarations('.gs-results').overflow, 'hidden');
  assert.equal(declarations('.gs-results-stage').flex, '1 0 56px'); assert.equal(declarations('.gs-results-stage')['min-height'], '56px'); assert.equal(declarations('.gs-results-stage').background, 'transparent');
  assert.equal(declarations('.gs-result-retry .gs-button')['min-height'], '44px');
  assert.equal(declarations('.gs-settlement .gs-button')['min-height'], '44px');
});

test('earned credits and XP stay outside collapsed details with authoritative values', () => {
  const h = harness(normal), rewards = h.find('.gs-result-compact-rewards'), free = h.find('.gs-result-free-choice');
  assert.equal(free.contains(rewards), true); assert.equal(h.find('.gs-result-details').contains(rewards), false);
  assert.match(rewards.textContent, /КРЕДИТЫ\+479₵/); assert.match(rewards.textContent, /ОПЫТ СЕЗОНА\+67XP/);
  assert.match(h.find('.gs-double-basis').textContent, /279 → 558 ₵ за вождение\. Без XP\./);
  assert.equal(h.find('.gs-run-highlights').children.length, 4); assert.equal(h.find('.gs-result-stats').children.length, 3);
  assert.equal(h.actions.length, 0); assert.deepEqual(normal.receipt, { credits: 479, baseCredits: 279, xp: 67 });
});

test('compact labels retain exactly one action per choice and the original accessible action meaning', () => {
  const h = harness(normal), scroll = h.find('.gs-settlement-scroll');
  for (const type of ['finishRun', 'startDrive', 'revive', 'rewardedBonus']) {
    const button = h.button(type); assert.ok(button, type); assert.equal(scroll.contains(button), false);
    assert.equal(h.ui.root.querySelectorAll('[data-gs-action]').filter(node => JSON.parse(node.dataset.gsAction).type === type).length, 1);
    h.ui.handleClick({ target: button }); assert.deepEqual(h.actions.at(-1), { type });
  }
  assert.match(h.button('rewardedBonus').getAttribute('aria-label'), /×2 и завершить · \+279/);
  assert.match(h.button('revive').getAttribute('aria-label'), /продолжить заезд/);
});

test('pending and failed saves are visible without opening reward details', () => {
  const pending = harness({ ...normal, settled: false, receipt: { ...normal.receipt, pending: true }, canRevive: false, bonusEligible: false });
  assert.match(pending.find('.gs-result-compact-status').textContent, /ещё не подтверждён.*после сохранения/);
  const failed = harness({ ...normal, saveMessage: 'Учтено в этой сессии. Локальное сохранение недоступно.' });
  assert.match(failed.find('.gs-result-compact-status').textContent, /Локальное сохранение недоступно/);
  for (const h of [pending, failed]) assert.equal(h.find('.gs-result-details').contains(h.find('.gs-result-compact-status')), false);
});

test('recovery, training continuation and finalized choices keep existing eligibility semantics', () => {
  const recovered = harness({ ...normal, recovered: true, recoveryKind: 'result', canRevive: false });
  assert.match(recovered.find('.gs-recovery-note').textContent, /После перезагрузки продолжение недоступно/); assert.equal(recovered.button('revive'), undefined);
  const training = harness({ ...normal, trainingContinue: true, bonusEligible: false }, { platform: { rewarded: false } });
  assert.equal(training.button('revive').querySelector('.gs-result-compact-label').textContent, 'Продолжить без видео'); assert.equal(training.button('rewardedBonus'), undefined);
  const finalized = harness({ ...normal, finalized: true, bonusClaimed: true });
  assert.equal(finalized.button('revive'), undefined); assert.equal(finalized.button('rewardedBonus'), undefined); assert.equal(finalized.button('finishRun'), undefined);
  assert.match(finalized.find('.gs-result-compact-status').textContent, /Удвоение получено/); assert.deepEqual(JSON.parse(finalized.button('navigate').dataset.gsAction), { type: 'navigate', screen: 'garage', tab: 'fleet' });
});

test('busy state still disables every choice while ad recovery remains a separate reachable action', () => {
  const h = harness(normal, { loading: { adPending: true, error: 'Ждём подтверждения платформы.' } });
  h.ui.root.append(h.ui.renderLoadError()); h.ui.busy = true; h.ui.busyMessage = 'Ждём подтверждения платформы…'; h.ui.applyBusy();
  for (const type of ['finishRun', 'startDrive', 'revive', 'rewardedBonus']) { assert.equal(h.button(type).disabled, true); h.ui.handleClick({ target: h.button(type) }); }
  assert.equal(h.actions.length, 0); assert.equal(h.button('retryLoad').disabled, false);
  assert.equal(declarations('.gs-load-error').position, 'absolute'); assert.equal(declarations('.gs-load-error > .gs-button')['min-height'], '44px');
  h.ui.handleClick({ target: h.button('retryLoad') }); assert.deepEqual(h.actions, [{ type: 'retryLoad' }]);
});


test('text enlargement cannot wrap current-run figures into the reserved car stage', () => {
  assert.equal(declarations('.gs-result-stats .gs-stat-value')['font-size'], '20px');
  assert.equal(declarations('.gs-result-stats .gs-stat-value')['white-space'], 'nowrap');
  assert.equal(declarations('.gs-result-intro').gap, '2px');
  assert.equal(declarations('.gs-result-vehicle').position, 'absolute');
  assert.equal(declarations('.gs-result-vehicle')['clip-path'], 'inset(50%)');
  assert.equal(declarations('.gs-run-highlights')['min-height'], '0');
  assert.equal(declarations('.gs-run-highlights')['max-height'], '52px');
  assert.equal(declarations('.gs-run-highlights')['overflow-y'], 'auto');
  assert.equal(harness(normal).find('.gs-run-highlights').tabIndex, 0);
});


test('pending-ad recovery resets inherited mobile row wrapping and paragraph flex basis', () => {
  assert.equal(declarations('.gs-load-error')['flex-direction'], 'column');
  assert.equal(declarations('.gs-load-error')['flex-wrap'], 'nowrap');
  assert.equal(declarations('.gs-load-error > .gs-small-note').flex, '0 0 auto');
});
