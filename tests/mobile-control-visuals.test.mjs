import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('styles/mobile-drive.css');
const ids = ['leftBtn', 'rightBtn', 'brakeBtn', 'gasBtn', 'boostBtn', 'flightBtn', 'rollLeftBtn', 'rollRightBtn', 'hornBtn', 'lookLeftBtn', 'lookRightBtn'];
function button(id) {
  const match = html.match(new RegExp('<button\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?<\\/button>'));
  assert.ok(match, id + ' exists');
  return match[0];
}
function face(id) {
  const match = button(id).match(/<span class="mobile-control-face" aria-hidden="true">([\s\S]*?)<\/span>/);
  assert.ok(match, id + ' has separate decorative mobile artwork');
  return match[1];
}

test('every driving control has original vector artwork without changing its accessible name', () => {
  for (const id of ids) {
    assert.match(button(id), /aria-label="[^"]+"/, id);
    assert.match(face(id), /<svg class="mobile-control-icon" viewBox="0 0 32 32" focusable="false">/, id);
    assert.match(face(id), /<path\b/, id);
    assert.doesNotMatch(face(id), /[←→↶↷‹›]|<text\b|<image\b|href=|font-family/, id);
  }
  assert.equal((html.match(/class="mobile-control-face"/g) || []).length, ids.length);
});

test('steering triangles are geometric mirrors, not font glyphs, and pedals have distinct ribbed silhouettes', () => {
  assert.match(face('leftBtn'), /d="M20\.5 6\.5 9 16l11\.5 9\.5Z"/);
  assert.match(face('rightBtn'), /d="m11\.5 6\.5 11\.5 9\.5-11\.5 9\.5Z"/);
  assert.match(face('brakeBtn'), /M8 10h16l3 12H5Z/);
  assert.match(face('brakeBtn'), /M10 14v4m4-4v4m4-4v4m4-4v4/);
  assert.match(face('gasBtn'), /M14 4h7a3 3/);
  assert.match(face('gasBtn'), /M15 9v13m5-13v10/);
});

test('desktop labels and icons remain intact and new artwork is hidden outside landscape mobile eligibility', () => {
  const prefix = css.slice(0, css.indexOf('@media'));
  assert.match(prefix, /\.mobile-control-face\s*\{\s*display: none;\s*\}/);
  assert.doesNotMatch(prefix, /#app|width:|height:|position:/);
  for (const [id, glyph] of [['leftBtn', '←'], ['rightBtn', '→'], ['rollLeftBtn', '↶'], ['rollRightBtn', '↷']]) {
    assert.ok(button(id).includes('aria-hidden="true">' + glyph + '</span>'), id);
    assert.match(button(id), /class="[^"]*control-desktop/, id);
  }
  for (const [id, label] of [['gasBtn', 'ГАЗ'], ['brakeBtn', 'ТОРМОЗ'], ['boostBtn', 'НИТРО'], ['flightBtn', 'ПОЛЁТ'], ['hornBtn', 'СИГНАЛ']]) {
    assert.ok(button(id).includes('<span class="control-label">' + label + '</span>'), id);
  }
  assert.match(css, /#app\[data-mobile-controls="true"\] \.control-desktop \{ display: none; \}/);
});

test('mobile surfaces are thin transparent circles rather than filled tiles or gradient trays', () => {
  assert.match(css, /--control-ring: rgba\(255, 255, 255, \.22\)/);
  assert.match(css, /--control-glyph: rgba\(255, 255, 255, \.70\)/);
  assert.match(css, /--control-wash: rgba\(8, 14, 20, \.10\)/);
  assert.match(css, /border: 1px solid var\(--control-ring\);\s*border-radius: 50%/);
  assert.match(css, /--control-face-size: min\(48px, var\(--mobile-drive-size\)\)/);
  assert.match(css, /--control-face-size: 36px/);
  assert.match(css, /stroke-width: 2;\s*stroke-linecap: round;\s*stroke-linejoin: round/);
  assert.doesNotMatch(css, /(?:linear|radial)-gradient\(|backdrop-filter:|filter:\s*blur/);
  for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) assert.equal(value.trim(), 'none');
});

test('actual boost gets its own cyan effect while accessible feedback and independent hit areas remain', () => {
  assert.match(button('boostBtn'), /aria-describedby="boostStatus"/);
  assert.match(button('boostBtn'), /<small id="boostStatus">УДЕРЖИВАЙ<\/small>/);
  assert.match(face('boostBtn'), /class="nitro-bolt"/);
  assert.match(face('boostBtn'), /class="boost-plume"/);
  assert.match(css, /\.boost-plume \{ opacity: 0; \}/);
  assert.match(css, /#boostBtn:is\(\[data-boost-state="active"\], \[data-boost-state="boosting"\]\) \.boost-plume \{ opacity: 1; \}/);
  assert.match(css, /#boostBtn\[data-held="true"\]:not\(\[data-boost-state="ready"\]\) #boostStatus/);
  assert.match(css, /min-width: 44px;\s*min-height: 44px/);
  assert.match(css, /grid-template-columns: 44px 44px 44px 64px/);
  assert.match(css, /\.ability-pair button \{\s*position: relative;\s*inset: auto;/, 'relative artwork must not reactivate the desktop nitro bottom offset');
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /:focus-visible \.mobile-control-face/);
  assert.match(button('flightBtn'), /aria-describedby="flightHint"/);
  for (const id of ['rollLeftBtn', 'rollRightBtn']) assert.match(button(id), /aria-describedby="rollHint"/);
});

test('only the four mobile utility surfaces share 36px circles inside unchanged 44px targets', () => {
  const utility = /\/\* Mobile utility artwork:[\s\S]*?\*\/([\s\S]*?)\/\* End mobile utility artwork\. \*\//.exec(css)?.[1];
  assert.ok(utility, 'bounded mobile-only utility styling exists');
  const selectors = [...utility.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim());
  assert.equal(selectors.length, 6);
  for (const selector of selectors) {
    assert.ok(selector.startsWith('#app[data-mobile-controls="true"] .toolbar :is(#soundBtn, #helpBtn, #cameraBtn, #pauseBtn)'), selector);
  }
  assert.doesNotMatch(utility, /#fullscreenBtn|\.topbar|\.score-block|\.challenge/);
  assert.match(css, /\.toolbar \.icon-button \{ width: 44px; height: 44px; flex-shrink: 0; \}/);
  assert.match(utility, /min-width: 44px;\s*min-height: 44px/);
  assert.match(utility, /border: 0;\s*background: none;\s*box-shadow: none/);
  assert.match(utility, /inset: 4px;\s*border: 1px solid var\(--utility-ring\);\s*border-radius: 50%/);
  assert.match(utility, /--utility-wash: rgba\(8, 14, 20, \.10\)/);
  assert.match(utility, /:is\(:active, \[aria-pressed="true"\]\)/);
  assert.match(utility, /:focus-visible::before/);
});

test('annotated HUD removals apply only in mobile playing or paused and preserve flight accessibility', () => {
  const hud = /\/\* Annotated mobile race HUD:[\s\S]*?\*\/([\s\S]*?)\/\* End annotated mobile race HUD\. \*\//.exec(css)?.[1];
  assert.ok(hud, 'bounded annotated HUD rules exist');
  const withoutComments = hud.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector] of withoutComments.matchAll(/([^{}]+)\{/g)) {
    assert.ok(selector.trim().startsWith('#app[data-mobile-controls="true"]:is([data-screen="playing"], [data-screen="paused"])'), selector);
  }
  assert.match(hud, /\.toolbar :is\(#soundBtn, #helpBtn\) \{ display: none; \}/);
  assert.doesNotMatch(hud, /#cameraBtn|#pauseBtn|#flightBtn|#rollLeftBtn|#rollRightBtn|\.brand|\.speed-block|\.touch-controls/);
  const status = /#flightStatus \{([^}]+)\}/.exec(hud)?.[1];
  assert.ok(status, 'only the information panel is visually clipped');
  assert.match(status, /width: 1px;\s*height: 1px/);
  assert.match(status, /clip-path: inset\(50%\)/);
  assert.doesNotMatch(status, /display:|visibility:|content-visibility:/);
  assert.match(button('flightBtn'), /aria-describedby="flightHint"/);
  assert.match(html, /id="flightAnnouncement"[^>]*aria-live="polite"/);
  assert.match(html, /id="rollAnnouncement"[^>]*aria-live="polite"/);
  assert.match(hud, /\.score-block > strong \{ font-size: 20px/);
  assert.match(hud, /\.nitro-block \{ width: 76px/);
  assert.match(hud, /\.challenge \{ top: 38px; width: min\(54%, 240px\); font-size: 10px/);
  assert.match(hud, /:is\(\.score-block, \.nitro-block, \.challenge\) \{\s*padding: 3px 5px;\s*box-shadow: none/);
  assert.doesNotMatch(hud, /scale\(|zoom:/);
});

test('moved utility actions use two compact 44px buttons only inside mobile pause', () => {
  assert.match(css, /#app\[data-mobile-controls="true"\]\[data-screen="paused"\] \.pause-mobile-utilities \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*gap: 8px;\s*margin: 0;/);
  assert.match(css, /#app\[data-mobile-controls="true"\]\[data-screen="paused"\] \.pause-mobile-utilities > \.button \{\s*min-width: 0;\s*min-height: 44px;\s*margin: 0;\s*padding: 8px;/);
});
