import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {runInNewContext} from 'node:vm';
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const [html, css, main] = await Promise.all(['index.html', 'styles/desktop-drive.css', 'src/main.js'].map(read));
const button = id => html.match(new RegExp('<button\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?<\\/button>'))?.[0];
const desktop = '#app:not([data-mobile-controls="true"])';
const active = desktop + ':is([data-screen="playing"], [data-screen="paused"])';

test('desktop presentation parses and is loaded after the unchanged mobile artwork', async () => {
  assert.ok(html.indexOf('./styles/desktop-drive.css') > html.indexOf('./styles/mobile-drive.css'));
  assert.deepEqual((await transform(css, {loader: 'css'})).warnings, []);
  assert.doesNotMatch(css, /@keyframes|animation:|will-change:|(?:linear|radial)-gradient\(|filter:/);
  // Non-desktop rules only hide added keyboard badges or style shared Pause actions.
  for (const [, selector] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    const value = selector.trim();
    assert.ok(value.startsWith(desktop) || value.startsWith('@media') || value.startsWith('.desktop-control-key') || value.startsWith('#app[data-screen="paused"] .pause-mobile-utilities'), value);
  }
});

test('desktop removes exactly the obsolete HUD panels without hiding action descriptions', () => {
  assert.ok(css.includes(active + ' .toolbar :is(#soundBtn, #helpBtn),'));
  assert.ok(css.includes(active + ' :is(.nitro-block, .challenge) { display: none; }'));
  const status = /#flightStatus \{([^}]+)\}/.exec(css)?.[1];
  assert.ok(status);
  assert.match(status, /width: 1px;\s*height: 1px/);
  assert.match(status, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(status, /display:|visibility:|content-visibility:/);
  for (const id of ['flightAnnouncement', 'rollAnnouncement']) assert.match(html, new RegExp('id="' + id + '"[^>]*aria-live="polite"'));
  assert.match(css, /\.score-block > strong \{ font-size: 24px/);
});

test('desktop retains original controls, keys and one shared reserve without enabling touch steering', () => {
  assert.ok(css.includes(active + ' .touch-controls > :is(.steer-pair, .pedal-pair) { display: none; }'));
  for (const [id, key, visibleKey] of [['rollLeftBtn', 'Q', 'Q'], ['rollRightBtn', 'E', 'E'], ['flightBtn', 'F', 'F'], ['boostBtn', 'Space', 'SPACE']]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
    assert.match(button(id), new RegExp('aria-keyshortcuts="' + key + '"'));
    assert.ok(button(id).includes('<kbd class="desktop-control-key" aria-hidden="true">' + visibleKey + '</kbd>'));
  }
  assert.match(css, /^\/\*[\s\S]*?\.desktop-control-key \{ display: none; \}/);
  assert.equal((html.match(/class="ability-reserve-fill"/g) || []).length, 2);
  assert.match(css, /height: calc\(clamp\(0, var\(--reserve-level\), 1\) \* 100%\)/);
  assert.match(css, /right: 0; bottom: 0; left: 0;/);
  assert.match(css, /background: rgba\(82, 192, 244, \.52\)/);
  assert.match(css, /#boostBtn \.ability-reserve-fill \{ background: rgba\(255, 149, 51, \.58\)/);
  assert.match(css, /\[data-flight="false"\] \.touch-controls :is\(#flightBtn, \.roll-button\) \{ display: none; \}/);
  assert.match(button('flightBtn'), /aria-describedby="flightHint sharedEnergyStatus"/);
  assert.match(button('boostBtn'), /aria-describedby="boostStatus sharedEnergyStatus"/);
});

test('desktop uses the same bounded real-car milestone and lifecycle guards, never a replacement marker', () => {
  assert.equal((html.match(/id="mobileGoalVehicleCanvas"/g) || []).length, 1);
  assert.match(css, /top: calc\(env\(safe-area-inset-top, 0px\) \+ 3px\)/);
  assert.match(css, /\.mobile-goal-track \{ position: relative; height: 100%; margin: 0 38px 0 20px; \}/);
  assert.match(css, /\.mobile-goal-car \{[^}]*left: calc\(clamp\(0, var\(--goal-progress\), 1\) \* 100%\)/);
  assert.match(css, /\.mobile-goal-car canvas\[hidden\] \{ display: none; \}/);
  const activities = [...main.matchAll(/routeVehicleMarker\?\.(?:setActivity|update)\([^;]+/g)].map(m => m[0]);
  assert.equal(activities.length, 2);
  for (const activity of activities) {
    assert.doesNotMatch(activity, /visible:mobileControls/);
    assert.match(activity, /visible:!orientationBlocked&&!document.hidden&&\['playing','paused'\]\.includes\(screen\)/);
    assert.match(activity, /paused:screen!=='playing'\|\|lifecycle.paused\|\|busy\|\|!!loading.adPending/);
  }
});

test('desktop water and route interpolation only run while playing, with reduced-motion opt-out', () => {
  for (const [, selector, value] of css.matchAll(/([^{}]+)\{[^{}]*transition:\s*([^;]+);[^{}]*\}/g)) {
    if (value.trim() !== 'none') assert.ok(selector.trim().startsWith(desktop + '[data-screen="playing"]'), selector);
  }
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  for (const selector of ['.ability-reserve-fill', '.mobile-goal-car', '.mobile-goal-track::after']) assert.ok(reduced.includes(selector));
  assert.match(reduced, /transition: none/);
});


test('desktop ready mode has a distinct cue before active and disabled overrides', () => {
  const ready = css.indexOf('button[data-mode="ready"]');
  const active = css.indexOf('button:is(:active,');
  const disabled = css.indexOf('button:is(:disabled,');
  assert.ok(ready > 0 && active > ready && disabled > active);
  assert.match(css.slice(ready, active), /--control-ring: #ffd38a/);
});


test('desktop ready QA honors the configured browser path with the existing fallback', async () => {
  const source = await read('scripts/desktop-ready-qa.mjs');
  const launch = source.match(/const browser=await (chromium\.launch\([^;]+\));/)?.[1];
  assert.ok(launch);
  for (const custom of [undefined, '', '/configured/browser']) {
    let options;
    runInNewContext(launch, {process:{env:{CHROME_BIN:custom}}, chromium:{launch(value){options=value;}}});
    assert.equal(options.executablePath, custom || '/usr/bin/chromium');
    assert.equal(options.headless, true);
  }
});
