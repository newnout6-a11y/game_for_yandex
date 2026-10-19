import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
const compact = css.slice(css.indexOf('/* HOME_ENTRY_COMPACT:'));

test('compact HOME uses the landscape iframe dimensions without a 600/701px width floor', () => {
  assert.match(compact, /@media \(orientation: landscape\) and \(max-height: 620px\), \(orientation: landscape\) and \(max-width: 900px\)/);
  assert.doesNotMatch(compact, /min-width:\s*(?:600|701)px/);
  assert.doesNotMatch(compact, /device-width|device-height|screen\./);
});

test('every compact HOME rule is screen-scoped, leaving garage and results unchanged', () => {
  const uncommented = compact.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...uncommented.matchAll(/([^{}]+)\{[^{}]*\}/g)];
  assert.ok(rules.length > 20);
  for (const [, selectors] of rules) {
    for (const selector of selectors.trim().split(/,\s*(?=\.garage-shell)/)) {
      assert.ok(selector.startsWith(".garage-shell[data-screen='hub']"), selector);
    }
  }
});

test('entry actions have a reserved non-scrolling row and minimum touch targets', () => {
  assert.match(compact, /\.gs-hub \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto[^}]*overflow: clip;/s);
  assert.match(compact, /\.gs-hub-actions \{[^}]*grid-row: 2;[^}]*repeat\(2, minmax\(0, max-content\)\)[^}]*margin: 0;/s);
  assert.match(compact, /\.gs-hub-actions \.gs-button \{[^}]*min-width: 44px; min-height: 44px;/s);
  assert.match(compact, /\.gs-hub-title \{[^}]*clip-path: inset\(50%\)/s);
  assert.match(compact, /\.gs-route-cell select \{[^}]*min-height: 44px;/s);
});

test('compact controls fit their content instead of stretching across the car', () => {
  const actions = compact.match(/\.gs-hub-actions \{([^}]+)\}/s)[1];
  const button = compact.match(/\.gs-hub-actions \.gs-button \{([^}]+)\}/s)[1];
  const dock = compact.match(/\.gs-hub-dock \{([^}]+)\}/s)[1];
  const route = compact.match(/\.gs-route-cell select \{([^}]+)\}/s)[1];
  assert.match(actions, /width: max-content; max-width: min\(100%, 400px\);/);
  assert.match(actions, /gap: 6px;/);
  assert.doesNotMatch(actions, /\b1fr\b|480px/);
  assert.match(button, /width: auto; justify-content: center; padding: 8px 10px; gap: 6px;/);
  assert.match(button, /font-size: 12px; line-height: 1\.2; overflow-wrap: normal;/);
  assert.doesNotMatch(button, /(?:^|;)\s*height:|white-space: nowrap|text-overflow|overflow:\s*hidden|transform:|zoom:/);
  assert.match(compact, /\.gs-hub-actions svg \{ width: 16px; height: 16px; \}/);
  assert.match(dock, /width: max-content; max-width: min\(49%, 260px\);/);
  assert.match(route, /min-width: 44px; min-height: 44px; width: auto; max-width: 100%;/);
  assert.doesNotMatch(compact, /text-size-adjust:\s*none|transform:\s*scale|zoom:/);
});

test('compact controls preserve the accepted header and guest footer budget', () => {
  assert.match(compact, /\.gs-header \{ flex: 0 0 52px; min-width: 0; padding: 4px 14px; gap: 10px; \}/);
  assert.match(compact, /\.gs-emblem \{ width: 34px; height: 34px; \}/);
  assert.match(compact, /\.gs-footer \{ flex: 0 0 28px;/);
  assert.match(compact, /\.gs-footer:has\(\.gs-footer-connect\) \{ flex-basis: 44px; \}/);
  assert.match(compact, /\.gs-footer-connect \{ min-height: 44px;/);
});

test('HOME markup retains the real start, garage and route actions without new persistence or SDK paths', async () => {
  const source = await readFile(new URL('../src/garage-ui.js', import.meta.url), 'utf8');
  const home = source.slice(source.indexOf('  renderHub() {'), source.indexOf('  renderOtherGames() {'));
  assert.match(home, /\{ type: 'startDrive' \}/);
  assert.match(home, /\{ type: 'navigate', screen: 'garage', tab: 'fleet' \}/);
  assert.match(home, /this\.settingSelect\('route', 'Маршрут'/);
  assert.doesNotMatch(home, /localStorage|sessionStorage|YaGames|fetch\(/);
});
