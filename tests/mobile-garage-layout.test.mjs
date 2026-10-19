import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const css = await readFile(new URL('../styles/garage.css', import.meta.url), 'utf8');
const start = css.indexOf('/* MOBILE_GARAGE_COMPACT:');
const end = css.indexOf('/* MOBILE_GARAGE_COMPACT_END */');
const compact = css.slice(start, end);
const root = ".garage-shell[data-screen='garage']";

// Declaration contracts complement native iframe/count checks; they are not a
// CSS layout engine. Select only applicable media blocks, in authored order,
// so a later density override cannot accidentally leave a stale test green.
function mediaBlocks() {
  const source = compact.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  for (const match of source.matchAll(/@media\s+([^{}]+)\{/g)) {
    let depth = 1; let cursor = match.index + match[0].length;
    const contentStart = cursor;
    while (depth && cursor < source.length) {
      if (source[cursor] === '{') depth++;
      if (source[cursor] === '}') depth--;
      cursor++;
    }
    assert.equal(depth, 0, 'Balanced compact media block');
    blocks.push({ query: match[1].trim(), content: source.slice(contentStart, cursor - 1) });
  }
  return blocks;
}
function activeSource(width = 560, height = 315) {
  return mediaBlocks().filter(({ query }) => {
    if (query.includes('orientation: landscape') && width <= height) return false;
    return [...query.matchAll(/(min|max)-(width|height):\s*(\d+)px/g)].every(([, limit, axis, value]) => {
      const actual = axis === 'width' ? width : height;
      return limit === 'min' ? actual >= Number(value) : actual <= Number(value);
    });
  }).map(block => block.content).join('\n');
}
function rules(source = compact) {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selectors, declarations]) => ({
      selectors: selectors.trim().split(/,\s*(?=\.garage-shell)/),
      declarations: Object.fromEntries(declarations.split(';').filter(part => part.trim()).map(part => {
        const colon = part.indexOf(':');
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
      })),
    }));
}
function declarations(suffix, width = 560, height = 315) {
  return Object.assign({}, ...rules(activeSource(width, height))
    .filter(rule => rule.selectors.includes(`${root}${suffix ? ` ${suffix}` : ''}`)).map(rule => rule.declarations));
}

test('compact CSS parses and stays before the separate HOME overrides', async () => {
  assert.ok(start > 0 && end > start);
  assert.ok(end < css.indexOf('/* HOME_ENTRY_COMPACT:'));
  const output = await transform(css, { loader: 'css' });
  assert.deepEqual(output.warnings, []);
  assert.ok(output.code.length > 0);
});

test('every mobile media block is bounded to landscape game iframes, not desktop', () => {
  for (const { query } of mediaBlocks()) {
    assert.match(query, /orientation: landscape/);
    assert.match(query, /max-height: (?:300|620)px/);
    assert.match(query, /max-width: (?:400|500|1100)px/);
  }
  for (const [w, h] of [[320, 240], [480, 270], [560, 315], [667, 375], [844, 270], [844, 390], [1024, 600], [1100, 620]]) {
    assert.ok(activeSource(w, h), `${w}×${h} is compact`);
  }
  for (const [w, h] of [[393, 852], [700, 700], [1024, 768], [1101, 620], [1101, 700], [1440, 900], [1920, 1080]]) {
    assert.equal(activeSource(w, h), '', `${w}×${h} retains its original CSS`);
  }
});

test('every override is GARAGE-only with an explicit camera marker and no page scaling', () => {
  for (const rule of rules()) for (const selector of rule.selectors) {
    assert.ok(selector === root || selector.startsWith(`${root} `), selector);
  }
  assert.equal(declarations('')['--gs-compact-garage'], '1');
  assert.equal(declarations('')['--gs-compact-panel'], 'clamp(190px, 42%, 320px)');
  assert.doesNotMatch(compact, /data-screen=['"](?:hub|results)|\.gs-hub|\.gs-results|transform:\s*scale|zoom:|text-size-adjust:\s*none/);
});

test('all compact sizes share one measured header/navigation band', () => {
  for (const [w, h] of [[320, 240], [480, 270], [560, 315], [667, 375], [844, 390]]) {
    const layout = declarations('.gs-layout', w, h);
    assert.equal(layout.display, 'grid');
    assert.equal(layout['grid-template-rows'], '44px minmax(0, 1fr) auto');
    assert.equal(declarations('.gs-layout > .gs-header', w, h).display, 'contents');
    assert.equal(declarations('.gs-layout > .gs-garage', w, h).display, 'contents');
    assert.equal(declarations('.gs-header .gs-mobile-home', w, h)['grid-column'], '1');
    assert.equal(declarations('.gs-header .gs-account', w, h).width, undefined, 'Measure the actual wallet, including enlarged text');
  }
  assert.equal(declarations('.gs-layout')['grid-template-columns'], '44px max-content minmax(0, 1fr) max-content');
  assert.equal(declarations('.gs-header .gs-brand').display, 'flex');
  assert.equal(declarations('.gs-rail > .gs-tabs')['grid-column'], '3');
  assert.equal(declarations('.gs-header .gs-account')['grid-column'], '4');
  assert.equal(declarations('.gs-layout', 320, 240)['grid-template-columns'], '44px minmax(0, 1fr) max-content');
  assert.equal(declarations('.gs-header .gs-brand', 320, 240).display, 'none');
  assert.equal(declarations('.gs-rail > .gs-tabs', 320, 240)['grid-column'], '2');
  assert.equal(declarations('.gs-header .gs-account', 320, 240)['grid-column'], '3');
});

test('the shared grid carries all safe-area insets with zero-inset parity', () => {
  const layout = declarations('.gs-layout');
  assert.equal(layout['box-sizing'], 'border-box');
  assert.equal(layout.padding, 'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)');
});

test('stage and workbench stay side by side in either old drawer state', () => {
  const stage = declarations('.gs-garage > .gs-stage');
  const panel = declarations('.gs-garage > .gs-workbench');
  for (const item of [stage, panel]) {
    assert.equal(item['grid-column'], '1 / -1');
    assert.equal(item['grid-row'], '2');
    assert.equal(item['min-height'], '0');
  }
  assert.equal(stage['justify-self'], 'start');
  assert.equal(stage.width, 'calc(100% - var(--gs-compact-panel))');
  assert.equal(panel['justify-self'], 'end');
  assert.equal(panel.width, 'calc(var(--gs-compact-panel) - 4px)');
  assert.equal(panel['overflow-y'], 'auto');
  assert.equal(panel['max-height'], '100%');
  assert.equal(declarations('.gs-stage-bottom > .gs-drawer-toggle').display, 'none');
  assert.doesNotMatch(compact, /data-drawer|minmax\((?:120|150|155|225)px/);
});

test('guest authentication retains its 44px target without trapping the workbench below a footer', () => {
  assert.equal(declarations('.gs-layout > .gs-footer').height, '24px');
  assert.equal(declarations('.gs-layout > .gs-footer:has(.gs-footer-connect)').height, '44px');
  assert.equal(declarations('.gs-footer .gs-footer-connect')['min-height'], '44px');
  for (const [w, h] of [[320, 240], [480, 270], [560, 315], [667, 375], [844, 390]]) {
    assert.ok(h - 44 - 44 >= 152, `${w}×${h} has a real guest work row`);
    assert.ok(w - Math.max(190, Math.min(w * .42, 320)) >= 130);
  }
});

test('all animated navigation scenes and readable labels remain in 44px targets', () => {
  const tab = declarations('.gs-tabs > .gs-tab');
  assert.equal(tab['min-width'], '44px');
  assert.equal(tab['min-height'], '44px');
  assert.equal(tab['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(tab['grid-template-rows'], '18px auto');
  assert.equal(declarations('.gs-tab .gs-nav-scene').width, '20px');
  assert.equal(declarations('.gs-tab .gs-nav-scene').height, '18px');
  assert.equal(declarations('.gs-tab .gs-tab-name')['font-size'], '10px');
  assert.equal(declarations('.gs-rail > .gs-tabs')['overflow-x'], 'auto');
  assert.doesNotMatch(compact, /animation:\s*none|\.gs-nav-scene[^{}]*\{[^}]*display:\s*none/);
});

test('inspection keeps intrinsic text width and real 32px targets with horizontal scrolling', () => {
  assert.equal(declarations('.gs-stage-actions > .gs-inspection')['grid-template-columns'], 'repeat(4, minmax(max-content, 1fr))');
  assert.equal(declarations('.gs-stage-actions > .gs-inspection')['overflow-x'], 'auto');
  assert.equal(declarations('.gs-inspection > .gs-inspection-button')['min-height'], '32px');
  assert.equal(declarations('.gs-stage > .gs-stage-heading').display, 'none');
  assert.equal(declarations('.gs-stage-heading > .gs-title-reservation').display, 'none');
  const title = declarations('.gs-stage .gs-vehicle-title-dock > .gs-vehicle-title');
  assert.equal(title['font-size'], '18px');
  assert.equal(title.font, undefined);
  assert.equal(title['white-space'], 'nowrap');
  assert.equal(title['overflow-x'], 'auto');
  assert.equal(title['pointer-events'], 'auto');
  assert.equal(title['touch-action'], 'pan-x');
});

test('secondary and dense Fleet actions retain 32px targets, other primary actions remain 44px', () => {
  assert.equal(declarations('.gs-workbench .gs-button')['min-height'], '44px');
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail > .gs-button')['min-height'], '32px');
  for (const selector of ['.gs-workbench .gs-setting select', '.gs-workbench .gs-atelier-category', '.gs-workbench .gs-body-section', '.gs-workbench .gs-cosmetic-reset .gs-small-button', '.gs-workbench .gs-season-track > button']) {
    assert.equal(declarations(selector)['min-height'], '32px', selector);
  }
  assert.equal(declarations('.gs-workbench .gs-level-button')['min-height'], '44px');
  assert.equal(declarations('.gs-workbench .gs-level-controls')['overflow-x'], 'auto');
});

test('duplicate panel headings are visually clipped but remain accessible', () => {
  const heading = declarations('.gs-workbench .gs-panel-heading');
  assert.equal(heading.position, 'absolute');
  assert.equal(heading.width, '1px');
  assert.equal(heading.height, '1px');
  assert.equal(heading['clip-path'], 'inset(50%)');
  assert.equal(heading.display, undefined);
});

test('Atelier uses two dense paint columns without removing samples, reset or subcategories', () => {
  assert.equal(declarations('.gs-workbench .gs-color-palette')['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
  assert.equal(declarations('.gs-workbench .gs-color-choice')['min-height'], '44px');
  assert.equal(declarations('.gs-workbench .gs-color-choice')['grid-template-columns'], '16px minmax(0, 1fr)');
  assert.equal(declarations('.gs-workbench .gs-color-choice').padding, '3px');
  assert.equal(declarations('.gs-workbench .gs-color-palette').padding, '0');
  assert.equal(declarations(".gs-workbench .gs-color-choice[data-owned='false'] .gs-sample-action")['font-family'], 'var(--gs-body)');
  assert.equal(declarations('.gs-workbench .gs-color-choice .gs-sample-caption')['grid-column'], '2');
  assert.equal(declarations('.gs-workbench .gs-color-choice .gs-sample-reason')['grid-column'], '1 / -1');
  assert.equal(declarations('.gs-workbench .gs-atelier-categories')['grid-template-columns'], 'repeat(3, minmax(max-content, 1fr))');
  assert.equal(declarations('.gs-workbench .gs-atelier-categories')['overflow-x'], 'auto');
  assert.equal(declarations('.gs-workbench .gs-body-sections')['overflow-x'], 'auto');
  assert.equal(declarations('.gs-workbench .gs-body-section')['white-space'], 'nowrap');
  assert.doesNotMatch(compact, /(?:\.gs-item-group|\.gs-sample-grid|\.gs-body-sections|\.gs-atelier-categories|\.gs-cosmetic-reset)\s*\{[^}]*display:\s*none/);
});

test('Fleet shows a two-by-two actual miniature grid whose internal scroll budget grows with text', () => {
  const list = declarations('.gs-workbench .gs-vehicle-list');
  assert.equal(list.display, 'grid');
  assert.equal(list['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
  assert.equal(list['grid-auto-rows'], 'minmax(max-content, 4.15em)');
  assert.equal(list['max-height'], 'calc(8.3em + 2px)');
  assert.equal(list['overflow-y'], 'auto');
  assert.equal(list.height, undefined);
  assert.equal(declarations('.gs-workbench .gs-vehicle-row')['min-height'], '50px');
  assert.equal(declarations('.gs-workbench .gs-car-thumb').width, '30px');
  assert.doesNotMatch(compact, /\.gs-car-miniature\s*\{/, 'Real GLB canvas rendering is untouched');
  assert.doesNotMatch(compact, /(?:\.gs-stat|\.gs-setting|\.gs-vehicle-row|\.gs-vehicle-list)\s*\{[^}]*display:\s*none/);
});

test('Fleet retains sticky primary action, stats, run class and purchase eligibility', () => {
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail').display, 'contents');
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail > .gs-description').display, 'none');
  const action = declarations('.gs-workbench .gs-vehicle-detail > .gs-button');
  assert.equal(action.order, '0');
  assert.equal(action.position, 'sticky');
  assert.equal(action.top, '0');
  assert.equal(action['box-shadow'], '0 -10px 0 #252533, 0 1px 0 #252533', 'The lower sticky mask fits inside the dense 2px gap, not over the catalogue label');
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail > .gs-button:disabled').opacity, '1');
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail > .gs-small-note').order, '1');
  assert.equal(declarations('.gs-workbench .gs-panel-body > .gs-vehicle-list').order, '2');
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail > .gs-spec-row').order, '3');
  assert.equal(declarations('.gs-workbench .gs-vehicle-detail > .gs-setting').order, '4');
  assert.equal(declarations('.gs-workbench:has(.gs-vehicle-list)')['scroll-padding-top'], '50px');
});

test('Engineering reduces table padding, not real parameter rows or units', () => {
  assert.equal(declarations('.gs-workbench .gs-comparison-row').padding, '2px 0');
  assert.equal(declarations('.gs-workbench .gs-comparison-row')['grid-template-columns'], 'minmax(0, 1fr) 54px 54px');
  assert.equal(declarations('.gs-workbench .gs-comparison-row > strong')['line-height'], '1.2');
  assert.equal(declarations('.gs-workbench .gs-comparison-row small')['font-size'], '9px');
  assert.equal(declarations('.gs-workbench .gs-panel-body:has(> .gs-engineering-comparison) > .gs-setting')['flex-direction'], 'row');
  assert.doesNotMatch(compact, /(?:\.gs-comparison-row|\.gs-comparison-label|\.gs-comparison-row small)\s*\{[^}]*display:\s*none/);
});

test('Contracts keeps two complete data-rich cards side by side with 44px actions', () => {
  assert.equal(declarations('.gs-workbench .gs-panel-body:has(> .gs-contract)')['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
  assert.equal(declarations('.gs-workbench .gs-contract').display, 'flex');
  assert.equal(declarations('.gs-workbench .gs-contract').padding, '3px');
  assert.equal(declarations('.gs-workbench .gs-contract h3').margin, '2px 0');
  assert.equal(declarations('.gs-workbench .gs-contract > .gs-button')['margin-top'], 'auto');
  assert.doesNotMatch(compact, /(?:\.gs-contract|\.gs-contract-state|\.gs-contract-reward|\.gs-contract \.gs-description|\.gs-contract \.gs-progress-wrap)\s*\{[^}]*display:\s*none/);
});

test('Season fits six reward tiles without dropping real reward names, XP or payment availability', () => {
  assert.equal(declarations('.gs-workbench .gs-panel-body:has(> .gs-season-name)')['grid-template-columns'], 'repeat(3, minmax(0, 1fr))');
  assert.equal(declarations('.gs-workbench .gs-season-tier').padding, '3px');
  assert.equal(declarations('.gs-workbench .gs-season-track').gap, '2px');
  assert.equal(declarations('.gs-workbench .gs-panel-body:has(> .gs-season-name) > :not(.gs-season-tier)')['grid-column'], '1 / -1');
  assert.equal(declarations('.gs-workbench .gs-panel-body:has(> .gs-season-name) > .gs-description').display, 'none');
  for (const selector of ['.gs-workbench .gs-season-track', '.gs-workbench .gs-season-track > strong', '.gs-workbench .gs-season-track > .gs-kicker', '.gs-workbench .gs-progress-wrap', '.gs-workbench .gs-platform-note']) {
    assert.notEqual(declarations(selector).display, 'none', selector);
  }
  assert.equal(declarations('.gs-workbench .gs-season-track > .gs-small-note')['grid-column'], '1');
});


test('narrow and enlarged Season eligibility labels wrap inside their tile instead of crossing rewards', () => {
  for (const [width, height] of [[320, 240], [480, 270], [560, 315]]) {
    const label = declarations('.gs-workbench .gs-season-track > .gs-kicker', width, height);
    assert.equal(label['overflow-wrap'], 'anywhere');
    assert.equal(label['white-space'], undefined, 'Allow actual text growth, never clip eligibility');
  }
});


test('Atelier material subcategories preserve desktop choice density and visible eligibility', () => {
  assert.equal(declarations('.gs-workbench .gs-material-choice')['min-height'], '32px');
  assert.equal(declarations('.gs-workbench .gs-material-choice')['grid-template-columns'], '24px max-content minmax(0, 1fr)');
  assert.equal(declarations('.gs-workbench .gs-material-choice .gs-sample-caption').display, 'contents');
  assert.equal(declarations('.gs-workbench .gs-material-choice .gs-sample-action')['grid-row'], '2');
  const reason = declarations('.gs-workbench .gs-material-choice .gs-sample-reason');
  assert.equal(reason['grid-column'], '3');
  assert.equal(reason['grid-row'], '2');
  assert.equal(reason['overflow-wrap'], 'anywhere');
  assert.equal(reason.display, undefined);
  assert.equal(declarations(".gs-workbench .gs-item-group[data-gs-slot='wheels.finish'] > .gs-material-list")['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
  assert.equal(declarations(".gs-workbench .gs-item-group[data-gs-slot='wheels.finish'] .gs-material-choice")['min-height'], '44px');
  assert.equal(declarations('.gs-workbench .gs-material-choice .gs-material-sample').width, '24px');
  assert.equal(declarations('.gs-workbench .gs-cosmetic-reset > .gs-small-note')['flex-basis'], '70px');
});


test('compact workbench removes the proven header-clipping shadow but retains its visible border', () => {
  for (const [w, h] of [[320, 240], [560, 315], [844, 390], [1100, 620]]) {
    const panel = declarations('.gs-garage > .gs-workbench', w, h);
    assert.equal(panel['box-shadow'], 'none');
    assert.equal(panel.border, '1px solid #8c78943d');
    assert.equal(panel.background, undefined, 'Keep the authored panel background');
  }
});
