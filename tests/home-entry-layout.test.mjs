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
  assert.match(compact, /\.gs-hub-actions \{[^}]*grid-row: 2;[^}]*repeat\(2, minmax\(0, 1fr\)\)[^}]*margin: 0;/s);
  assert.match(compact, /\.gs-hub-actions \.gs-button \{[^}]*min-width: 44px; min-height: 48px;/s);
  assert.match(compact, /\.gs-hub-title \{[^}]*clip-path: inset\(50%\)/s);
  assert.match(compact, /\.gs-route-cell select \{[^}]*min-height: 44px;/s);
});

test('HOME markup retains the real start, garage and route actions without new persistence or SDK paths', async () => {
  const source = await readFile(new URL('../src/garage-ui.js', import.meta.url), 'utf8');
  const home = source.slice(source.indexOf('  renderHub() {'), source.indexOf('  renderOtherGames() {'));
  assert.match(home, /\{ type: 'startDrive' \}/);
  assert.match(home, /\{ type: 'navigate', screen: 'garage', tab: 'fleet' \}/);
  assert.match(home, /this\.settingSelect\('route', 'Маршрут'/);
  assert.doesNotMatch(home, /localStorage|sessionStorage|YaGames|fetch\(/);
});
