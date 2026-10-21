import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const [html, css] = await Promise.all([read('index.html'), read('styles/mobile-drive.css')]);
const button = id => html.match(new RegExp('<button\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?<\\/button>'))?.[0];
const section = (from, to) => css.slice(css.indexOf(from), css.indexOf(to) + to.length);
const reserve = section('/* A single shared reserve', '/* End shared-reserve artwork. */');
const rail = section('/* The distance milestone', '/* End top-edge distance milestone. */');
const active = '#app[data-mobile-controls="true"]:is([data-screen="playing"], [data-screen="paused"])';

// These are source/layout contracts. The native iframe harness measures actual
// rendered geometry, input targets, safe areas and WebGL screenshots separately.
test('mobile gauge CSS parses without warnings and does not add perpetual effects', async () => {
  const result = await transform(css, { loader: 'css' });
  assert.deepEqual(result.warnings, []);
  assert.doesNotMatch(reserve + rail, /@keyframes|animation:|will-change:|(?:linear|radial)-gradient\(|filter:|box-shadow:/);
  assert.doesNotMatch(reserve, /canvas|particle/i);
  assert.doesNotMatch(rail, /particle/i);
});

test('one shared accessible reserve describes both existing independent ability controls', () => {
  assert.equal((html.match(/id="sharedEnergyStatus"/g) || []).length, 1);
  assert.match(html, /id="sharedEnergyStatus" class="visually-hidden">Общий запас нитро и полёта:/);
  assert.doesNotMatch(html.match(/<span id="sharedEnergyStatus"[^>]*>/)?.[0] || '', /aria-live|role="status"/);
  for (const [id, originalDescription, key] of [['boostBtn', 'boostStatus', 'Space'], ['flightBtn', 'flightHint', 'F']]) {
    const markup = button(id);
    assert.ok(markup, id);
    assert.match(markup, new RegExp('aria-describedby="' + originalDescription + ' sharedEnergyStatus"'));
    assert.match(markup, new RegExp('aria-keyshortcuts="' + key + '"'));
    assert.match(markup, /<span class="mobile-control-face" aria-hidden="true"><i class="ability-reserve-fill"><\/i>/);
    assert.match(markup, /<svg class="mobile-control-icon" viewBox="0 0 32 32" focusable="false">/);
    assert.match(markup, /<g class="ability-glyph-outline"><path/);
    assert.equal((markup.match(/class="ability-reserve-fill"/g) || []).length, 1);
  }
  assert.equal((html.match(/class="ability-reserve-fill"/g) || []).length, 2, 'no extra reserve pool is drawn');
  for (const id of ['leftBtn', 'rightBtn', 'brakeBtn', 'gasBtn', 'rollLeftBtn', 'rollRightBtn', 'hornBtn', 'lookLeftBtn', 'lookRightBtn']) {
    assert.doesNotMatch(button(id), /ability-reserve-fill|sharedEnergyStatus/);
  }
});

test('water is clipped to the current circle and fills bottom-up from the common normalized property', () => {
  assert.match(reserve, /:is\(#boostBtn, #flightBtn\) \{ --reserve-level: \.6; \}/);
  assert.match(reserve, /\.mobile-control-face \{\s*overflow: hidden;\s*isolation: isolate;/);
  const fill = /\.ability-reserve-fill \{([^}]+)\}/.exec(reserve)?.[1];
  assert.ok(fill);
  assert.match(fill, /position: absolute;\s*right: 0;\s*bottom: 0;\s*left: 0;/);
  assert.match(fill, /height: calc\(clamp\(0, var\(--reserve-level\), 1\) \* 100%\)/);
  assert.match(fill, /border-top: calc\(clamp\(0, var\(--reserve-level\) \* 100, 1\) \* 1px\)/, 'zero reserve has no residual surface line');
  assert.match(fill, /pointer-events: none/);
  assert.match(reserve, /\.mobile-control-icon \{\s*position: relative;\s*z-index: 1;\s*color: #fff/);
  assert.match(reserve, /\.ability-glyph-outline \{ stroke: rgba\(9, 37, 45, \.86\); stroke-width: 4; \}/, 'thin dark under-stroke protects white icons on sky and full water');
  assert.doesNotMatch(reserve, /(?:--nitro-level|--flight-level)|\.ability-pair|\.touch-controls|font-size|scale\(|min-width|min-height/);
});

test('the accessible milestone is in the header, with actual selected-model canvas and checkered flag', () => {
  const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header?.includes('id="mobileGoalRail"'));
  assert.equal((html.match(/id="mobileGoalRail"/g) || []).length, 1);
  const markup = header.slice(header.indexOf('<div id="mobileGoalRail"'), header.indexOf('<nav class="toolbar"'));
  assert.match(markup, /role="progressbar" aria-label="Цель дистанции" aria-valuemin="0" aria-valuemax="1500" aria-valuenow="0"/);
  assert.match(markup, /aria-valuetext="0 из 1 500 метров" data-complete="false"/);
  assert.match(markup, /class="mobile-goal-track" aria-hidden="true"/);
  assert.match(markup, /<canvas id="mobileGoalVehicleCanvas" width="160" height="80" hidden>/);
  assert.match(markup, /<svg class="mobile-goal-flag"[^>]*focusable="false">/);
  assert.match(markup, /aria-describedby="mobileGoalVehicleLabel"/);
  assert.match(markup, /class="mobile-goal-flag-checks"/);
  assert.doesNotMatch(markup, /[←→↶↷‹›]|<text\b|<image\b|href=|font-family|aria-live|конец гонки|финиш заезда|race end/i);
  assert.ok(header.indexOf('class="brand"') < header.indexOf('id="mobileGoalRail"'));
  assert.ok(header.indexOf('id="mobileGoalRail"') < header.indexOf('<nav class="toolbar"'));
});

test('only playing and paused mobile runs replace the old upper energy and challenge displays', () => {
  assert.match(css.slice(0, css.indexOf('@media')), /\.mobile-goal-rail \{ display: none; \}/);
  assert.ok(rail.includes(active + ' :is(.nitro-block, .challenge) { display: none; }'));
  assert.ok(rail.includes(active + ' .mobile-goal-rail {'));
  assert.match(rail, /position: absolute;\s*top: calc\(env\(safe-area-inset-top, 0px\) \+ 3px\)/);
  assert.match(rail, /height: 20px;\s*pointer-events: none/);
  assert.doesNotMatch(rail, /\.game-hud|top:.*header-height|#cameraBtn|#pauseBtn|\.brand|\.toolbar|\.touch-controls|data-screen="(?:menu|hub|garage|results)"/);
  for (const id of ['challengeTitle', 'distance', 'challengeProgress', 'nitroValue', 'nitroFill']) assert.match(html, new RegExp('id="' + id + '"'));
});

test('car and traversed rail share the same clamped goal fraction and retain a quiet cyan completion state', () => {
  assert.match(rail, /--goal-progress: 0/);
  assert.match(rail, /\.mobile-goal-track::after \{ width: calc\(clamp\(0, var\(--goal-progress\), 1\) \* 100%\)/);
  assert.match(rail, /left: calc\(clamp\(0, var\(--goal-progress\), 1\) \* 100%\)/);
  assert.match(rail, /transform: translateX\(-50%\)/);
  assert.match(rail, /\.mobile-goal-rail\[data-complete="true"\] \.mobile-goal-track::after \{ background: #d4f9ff; \}/);
  assert.match(rail, /\.mobile-goal-track \{ position: relative; height: 100%; margin: 0 38px 0 20px; \}/);
});

test('safe-edge declaration bounds preserve the compact top rail at the supported landscape sizes', () => {
  assert.match(rail, /right: max\(calc\(env\(safe-area-inset-right, 0px\) \+ var\(--mobile-goal-clearance-right\)\), calc\(50% - 140px\)\)/);
  assert.match(rail, /left: max\(calc\(env\(safe-area-inset-left, 0px\) \+ var\(--mobile-goal-clearance-left\)\), calc\(50% - 140px\)\)/);
  assert.match(css, /--mobile-goal-clearance-left: 132px/);
  assert.match(css, /--mobile-goal-clearance-right: 152px/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-width: 600px\) \{\s*#app\[data-mobile-controls="true"\] \{ --mobile-goal-clearance-right: 108px/);
  assert.match(css, /max-width: 480px\)[\s\S]*?--mobile-goal-clearance-left: 64px/);
  assert.match(css, /max-width: 360px\)[\s\S]*?--mobile-goal-clearance-left: 12px/);
  for (const [width, height] of [[551, 360], [560, 315], [400, 240], [320, 240], [844, 390]]) {
    for (const [safeLeft, safeRight] of [[0, 0], [44, 0], [0, 44]]) {
      const left = Math.max(safeLeft + (width <= 360 ? 12 : width <= 480 ? 64 : 132), width / 2 - 140);
      const right = width - Math.max(safeRight + (width <= 600 ? 108 : 152), width / 2 - 140);
      assert.ok(right - left - 58 >= 80 && right - left <= 280, `${width}×${height}, safe ${safeLeft}/${safeRight}: actual marker travel, after both end reserves`);
      assert.ok(left >= safeLeft && right <= width - safeRight);
      assert.ok(right + (width <= 600 ? 88 : 132) + Math.max(12, safeRight) <= width, 'rail does not enter unchanged utility targets');
    }
  }
  assert.equal(280 - 12 - 108 - 58, 102, '280px floor retains over 80px of actual model travel, not merely outer rail width');
});

test('interpolation exists only during playing and is explicitly disabled for reduced motion', () => {
  const interpolation = [...(reserve + rail).matchAll(/([^{}]+)\{[^{}]*transition:[^{}]+\}/g)];
  assert.equal(interpolation.length, 3);
  for (const [, selector] of interpolation) assert.ok(selector.trim().startsWith('#app[data-mobile-controls="true"][data-screen="playing"]'), selector);
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  for (const selector of ['.ability-reserve-fill', '.mobile-goal-car', '.mobile-goal-track::after']) assert.ok(reduced.includes(selector));
  assert.match(reduced, /transition: none/);
});

test('shared reserve keeps the requested orange nitro and light-blue flight artwork',()=>{
 assert.match(css,/background: rgba\(82, 192, 244, \.52\)/);
 assert.match(css,/#boostBtn \.ability-reserve-fill \{ background: rgba\(255, 149, 51, \.58\)/);
 assert.match(css,/height: calc\(clamp\(0, var\(--reserve-level\), 1\) \* 100%\)/);
});
