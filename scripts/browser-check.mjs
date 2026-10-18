/**
 * Current Roadster garage browser smoke, against the unmodified source or --dist.
 * npm run test:browser -- [--dist] [--webkit]
 * CHROME_BIN overrides installed Chrome; SOFTWARE_WEBGL=1 opts into SwiftShader.
 * WebKit is tested only when explicitly requested and its binary is installed.
 *
 * This is entry/UI/accessibility coverage, not an FPS or long-drive benchmark.
 * Real touch physics, settlement and ad/orientation ownership remain covered by
 * scripts/garage-flow-qa.mjs; fleet/progression by scripts/garage-release-qa.mjs.
 * SDK callbacks below are an isolated readiness spy, not real platform traffic.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { startServer } from './serve.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv.includes('--dist') ? 'dist' : 'source';
const output = path.join(root, 'output/playwright', target);
const initialGarageAsset = '/public/assets/garage/tier1.glb';
const seed = new Date('2026-10-18T00:00:00Z');
const timeout = Number(process.env.BROWSER_CHECK_TIMEOUT_MS) || 180000;
const report = { completed: false, target, browsers: [], results: [], errors: [], expectedFailures: [], accessibility: [], webkit: process.argv.includes('--webkit') ? 'requested' : 'not requested' };
let server, browser, safari, url;
const paused = new WeakSet();
const intentionalTeardown = new WeakSet();
const integrityHeader = 'x-roadster-qa-fetch-id';
const integrityProofs = new Map(), abortedFetches = [], assetIntegrity = new Map();
/** Context destruction cancels in-flight browser fetch bookkeeping; only aborts after this explicit harness action are expected. */
async function closeContext(context){
  for(const page of context.pages()){
    // Finish proof already being hashed before destroying its document. Do not
    // wait for unfinished downloads: only our explicit teardown may cancel those.
    await page.evaluate(() => Promise.all(window.__browserCheckIntegrityPending || [])).catch(() => {});
    intentionalTeardown.add(page);
  }
  await context.close();
}
await mkdir(output, { recursive: true });
const pass = name => { report.results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
const save = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2));
const action = (page, key) => page.locator(`[data-gs-focus="${key}"]:visible`).first();

/**
 * Chromium 154 can emit ERR_ABORTED after FileLoader consumed an intact body.
 * Reconcile that exact request, never a URL-level retry or a general abort. The
 * standalone scripts/probe-glb-network.mjs proves EOF+SHA for both framing variants
 * and rejects a deliberately truncated body. Production loading is unchanged.
 */
async function reconcileCompletedFetches() {
  for (const candidate of abortedFetches) {
    const proof = integrityProofs.get(candidate.requestId);
    if (!proof || proof.page !== candidate.page || proof.url !== candidate.entry.url ||
        proof.status !== 200 || candidate.responseStatus !== 200 || !proof.eof || proof.error) continue;
    const address = new URL(proof.url);
    if (address.origin !== url || !/^\/public\/assets\/.*\.glb$/i.test(address.pathname)) continue;
    const servedRoot = target === 'dist' ? path.join(root, 'dist') : root;
    const file = path.resolve(servedRoot, '.' + decodeURIComponent(address.pathname));
    const relative = path.relative(servedRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    if (!assetIntegrity.has(file)) assetIntegrity.set(file, readFile(file).then(bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })));
    const expected = await assetIntegrity.get(file);
    if (proof.bytes !== expected.bytes || proof.sha256 !== expected.sha256) continue;
    const index = report.errors.indexOf(candidate.entry);
    if (index < 0) continue;
    report.errors.splice(index, 1);
    report.expectedFailures.push({ ...candidate.entry, kind: 'verified-complete-fetch', integrity: { requestId: candidate.requestId, status: 200, eof: true, ...expected } });
  }
}

/** Poll host time, so an intentionally paused browser clock cannot deadlock waits. */
async function until(check, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + description);
}
async function screen(page, expected) {
  await until(async () => await page.locator('#app').getAttribute('data-screen') === expected, 'screen ' + expected);
}
/** Freeze only after asynchronous loading settles; a two-second idle margin covers slow software-renderer transport, never a live drive. */
async function pauseClock(page) {
  if (paused.has(page)) return;
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 2000));
  paused.add(page);
}
async function resumeClock(page) {
  if (!paused.has(page)) return;
  await page.clock.resume();
  paused.delete(page);
}
async function capture(page, name) {
  if (paused.has(page)) await page.clock.runFor(34); // Two real production render callbacks, not a render mock.
  await page.screenshot({ path: path.join(output, name + '.png') });
}

/** Watch every page; only exact errors from our deliberate tier-1 503 are expected. */
async function openPage(context, label, { readySpy = false, failureFixture = false } = {}) {
  const page = await context.newPage();
  const responseStatuses = new WeakMap();
  page.setDefaultTimeout(timeout);
  const record = (kind, message, location = '') => {
    const deliberate = failureFixture && (
      kind === 'http' && message === '503' && new URL(location).pathname === initialGarageAsset ||
      kind === 'console' && message.startsWith('Interactive startup failed:') && message.includes('Garage asset unavailable') ||
      kind === 'console' && message.includes('Failed to load resource') && message.includes('503') && location && new URL(location).pathname === initialGarageAsset
    );
    const entry = { page: label, kind, message, url: location };
    (deliberate ? report.expectedFailures : report.errors).push(entry);
    return entry;
  };
  page.on('pageerror', error => record('pageerror', error.message));
  page.on('console', message => { if (message.type() === 'error') record('console', message.text(), message.location().url); });
  page.on('response', response => { responseStatuses.set(response.request(), response.status()); if (response.status() >= 400) record('http', String(response.status()), response.url()); });
  page.on('requestfailed', request => {
    const error = request.failure()?.errorText || 'failed';
    if (intentionalTeardown.has(page) && error === 'net::ERR_ABORTED') {
      report.expectedFailures.push({ page: label, kind: 'harness-teardown', message: error, url: request.url() });
    } else {
      const entry = record('requestfailed', error, request.url());
      const requestId = request.headers()[integrityHeader];
      if (error === 'net::ERR_ABORTED' && requestId) abortedFetches.push({ page, entry, requestId, responseStatus: responseStatuses.get(request) });
    }
  });
  page.on('request', request => {
    const address = new URL(request.url());
    if (['http:', 'https:'].includes(address.protocol) && address.origin !== url) record('external-request', request.url());
  });
  await page.clock.install({ time: seed });
  // Binding lives outside the document, so an explicit retry navigation cannot
  // overwrite proof for an earlier fetch with the same URL.
  await page.exposeBinding('__browserCheckIntegrityProof', ({ page: sourcePage }, proof) => { integrityProofs.set(proof.id, { ...proof, page: sourcePage }); });
  await page.addInitScript(({ header }) => {
    const streams = new WeakMap(), readers = new WeakMap();
    const pending = new Set();
    window.__browserCheckIntegrityPending = pending;
    const fetchOriginal = window.fetch;
    window.fetch = function (input, init) {
      const address = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (address.origin !== location.origin || !/^\/public\/assets\/.*\.glb$/i.test(address.pathname)) return Reflect.apply(fetchOriginal, this, arguments);
      const request = new Request(input, init), id = crypto.randomUUID();
      request.headers.set(header, id);
      return Reflect.apply(fetchOriginal, this, [request]).then(response => {
        if (response.status === 200 && response.body) streams.set(response.body, { id, url: request.url, status: response.status, bytes: 0, chunks: [] });
        return response;
      });
    };
    const getReader = ReadableStream.prototype.getReader;
    ReadableStream.prototype.getReader = function (...args) {
      const reader = Reflect.apply(getReader, this, args), proof = streams.get(this);
      if (proof) readers.set(reader, proof);
      return reader;
    };
    const read = ReadableStreamDefaultReader.prototype.read;
    ReadableStreamDefaultReader.prototype.read = function (...args) {
      const proof = readers.get(this);
      return Reflect.apply(read, this, args).then(result => {
        if (proof && !proof.eof) {
          if (!result.done) { proof.bytes += result.value.byteLength; proof.chunks.push(result.value.slice()); }
          else {
            proof.eof = true;
            const task = (async () => {
              const body = new Uint8Array(proof.bytes);
              let offset = 0;
              for (const chunk of proof.chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
              proof.chunks = [];
              const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), byte => byte.toString(16).padStart(2, '0')).join('');
              await window.__browserCheckIntegrityProof({ id: proof.id, url: proof.url, status: proof.status, bytes: proof.bytes, eof: true, sha256 });
            })().catch(() => {}).finally(() => pending.delete(task));
            pending.add(task);
          }
        }
        return result;
      });
    };
  }, { header: integrityHeader });
  if (readySpy) await page.addInitScript(() => {
    window.__browserCheckReady = 0;
    window.YaGames = { init: async () => ({
      on() {},
      features: { LoadingAPI: { ready() { window.__browserCheckReady++; } } },
    }) };
  });
  return page;
}
async function ready(page) {
  await screen(page, 'hub');
  assert.equal(await action(page, 'startDrive').isEnabled(), true);
  await pauseClock(page);
}

/** Read opaque computed button colors, not design tokens or screenshot heuristics. */
async function primaryButtonStates(page) {
  const button = action(page, 'startDrive');
  const states = [];
  const luminance = rgb => rgb.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  async function inspect(name) {
    const colors = await button.evaluate(element => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor, image: style.backgroundImage, outline: style.outlineStyle, outlineWidth: style.outlineWidth, focusVisible: element.matches(':focus-visible') };
    });
    const channels = value => {
      const parts = value.match(/[\d.]+/g).map(Number);
      assert.ok(parts.length === 3 || parts[3] === 1, 'Contrast fixture requires opaque colors: ' + value);
      return parts.slice(0, 3);
    };
    assert.equal(colors.image, 'none', 'Computed solid-color contrast must not ignore a background image');
    const light = luminance(channels(colors.foreground)), dark = luminance(channels(colors.background));
    const contrast = (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
    states.push({ name, ...colors, contrast });
    assert.ok(contrast >= 4.5, `${name} primary button text contrast ${contrast.toFixed(2)} < 4.5`);
    if (name === 'keyboard-focus') {
      assert.equal(colors.focusVisible, true);
      assert.notEqual(colors.outline, 'none');
      assert.ok(parseFloat(colors.outlineWidth) >= 2);
    }
  }
  await page.mouse.move(0, 0); await inspect('default');
  await button.hover(); await inspect('hover');
  await page.mouse.move(0, 0);
  await page.locator('.gs-hub-title').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gsFocus), 'startDrive', 'Primary action is keyboard reachable');
  await inspect('keyboard-focus');
  await button.hover(); await page.mouse.down();
  try { await inspect('active'); } finally { await page.mouse.move(0, 0); await page.mouse.up(); }
  await screen(page, 'hub');
  await save('button-states.json', states);
  pass('current primary action: default/hover/active contrast and real keyboard-visible focus');
}

/** Axe inspects the real document with all selected WCAG rules, with no rule exclusions. */
async function axeCheck(page, label) {
  await resumeClock(page); // axe owns asynchronous timers; the idle garage does not continually render.
  let result;
  try {
    if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
    result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
  } finally { await pauseClock(page); }
  await save('axe-' + label + '.json', result);
  const violations = result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }));
  report.accessibility.push({ page: label, violations, incomplete: result.incomplete.map(item => item.id) });
  if (violations.length) console.error(`FAIL axe ${label}: ${violations.map(item=>item.id).join(', ')}; collecting remaining panels before failing release`);
  else pass(`axe ${label}: no selected WCAG A/AA violations (automated, not a complete audit)`);
}

/** Exercise five real section panels, keyboard tab semantics and the settings dialog. */
async function desktopUI(page) {
  await capture(page, 'hub-desktop');
  await primaryButtonStates(page); await axeCheck(page, 'hub-desktop');
  await action(page, 'navigate:garage:fleet').click(); await screen(page, 'garage');
  const sections = ['fleet', 'style', 'engineering', 'contracts', 'season'];
  assert.equal(await page.locator('[role="tab"]').count(), sections.length);
  for (const tab of sections) {
    await page.locator(`[data-gs-tab="${tab}"]`).click();
    assert.equal(await page.locator('#garageShell').getAttribute('data-tab'), tab);
    assert.equal(await page.locator(`[data-gs-tab="${tab}"]`).getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[role="tab"][aria-selected="true"]').count(), 1);
    assert.equal(await page.locator('#gs-workbench').getAttribute('aria-labelledby'), 'gs-tab-' + tab);
    assert.equal(await page.locator('#gs-workbench').isVisible(), true);
    assert.ok((await page.locator('#gs-workbench h2').first().textContent()).trim());
    await axeCheck(page, 'garage-' + tab);
  }
  await page.locator('[data-gs-tab="season"]').focus();
  for (const [key, tab] of [['Home', 'fleet'], ['ArrowRight', 'style'], ['End', 'season']]) {
    await page.keyboard.press(key);
    assert.equal(await page.locator('#garageShell').getAttribute('data-tab'), tab);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.gsTab), tab);
  }
  await capture(page, 'garage-desktop');
  await page.keyboard.press('Escape'); await screen(page, 'hub');
  pass('all five garage sections, selected-panel relationships, arrow/Home/End navigation and Escape');
  await action(page, 'openSettings').click();
  const dialog = page.getByRole('dialog', { name: 'Настрой свой выезд' });
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gsFocus), 'closeSettings');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.locator('button').last().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gsFocus), 'closeSettings');
  await dialog.locator('[data-gs-setting="difficulty"]').selectOption('rush');
  await axeCheck(page, 'settings-desktop');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.gsFocus), 'openSettings');
  await action(page, 'openSettings').click();
  assert.equal(await dialog.locator('[data-gs-setting="difficulty"]').inputValue(), 'rush');
  await dialog.locator('[data-gs-setting="difficulty"]').selectOption('flow');
  await page.keyboard.press('Escape');
  pass('settings native controls, focus containment, Escape restoration and retained selection');

  await action(page, 'startDrive').click(); await screen(page, 'playing');
  await page.clock.runFor(34);
  assert.equal(await page.locator('#garageShell').isHidden(), true);
  assert.equal(await page.locator('#hud').isVisible(), true);
  assert.equal(await page.locator('#speed').textContent(), '0');
  await page.keyboard.press('Escape'); await screen(page, 'paused');
  await page.locator('[data-action="menu"]').click(); await screen(page, 'hub');
  pass('real start action enters zero-speed play; keyboard pause and return restore the hub');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#orientationGate').isHidden(), true, 'Narrow fine-pointer desktop is not a phone');
  assert.equal(await page.locator('#app').evaluate(element => element.inert), false);
  assert.equal(await action(page, 'startDrive').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture(page, 'hub-narrow-desktop');
  pass('390×844 non-touch desktop remains an interactive hub, without portrait gate or horizontal overflow');
}

/** Touch capability and actual viewport rotation control the real black portrait gate. */
async function touchOrientation(engine, label) {
  const context = await engine.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  try {
    const page = await openPage(context, label, { readySpy: true });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await screen(page, 'hub'); // Assets can finish behind the gate, but interactive readiness must wait.
    await pauseClock(page);
    const gate = page.locator('#orientationGate');
    assert.equal(await gate.isVisible(), true);
    assert.equal(await gate.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)');
    assert.equal(await page.locator('#app').evaluate(element => element.inert), true);
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'orientationGate');
    await page.keyboard.press('Enter'); await screen(page, 'hub');
    await capture(page, label + '-portrait-gate'); await axeCheck(page, label + '-portrait-gate');
    await page.setViewportSize({ width: 844, height: 390 });
    await until(async () => await gate.isHidden(), label + ' landscape gate release');
    assert.equal(await page.locator('#app').evaluate(element => element.inert), false);
    assert.equal(await action(page, 'startDrive').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 1);
    await capture(page, label + '-landscape-hub'); await axeCheck(page, label + '-landscape-hub');
    await page.setViewportSize({ width: 390, height: 844 });
    await until(async () => await gate.isVisible(), label + ' portrait re-entry');
    await page.setViewportSize({ width: 844, height: 390 });
    await until(async () => await gate.isHidden(), label + ' second landscape entry');
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 1, 'SDK readiness is once per document');
    pass(`${label}: touch portrait black gate → landscape hub, inert/focus protection and exactly-once readiness`);
  } finally { await closeContext(context); }
}

try {
  await access(path.join(root, target === 'dist' ? 'dist/index.html' : 'index.html'));
  server = startServer({ port: 0, root: target === 'dist' ? path.join(root, 'dist') : root });
  await once(server, 'listening'); url = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true, args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [] });
  report.browsers.push({ engine: 'Chromium', version: browser.version(), softwareWebGL: !!process.env.SOFTWARE_WEBGL });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  let release;
  try {
    const page = await openPage(desktop, 'desktop-held-asset', { readySpy: true });
    let requested = false;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**' + initialGarageAsset, async route => { requested = true; await held; await route.continue(); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await until(() => requested, 'real initial tier1 garage request');
    await screen(page, 'loading');
    assert.equal(await page.locator('.gs-loading [role="progressbar"]').isVisible(), true);
    assert.equal(await action(page, 'startDrive').count(), 0);
    assert.equal(await page.locator('#playBtn').isDisabled(), true, 'Legacy hidden start must also stay disabled');
    await page.keyboard.press('Enter'); await screen(page, 'loading');
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 0);
    release(); await ready(page);
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 1);
    assert.equal(await page.locator('#menu').isHidden(), true, 'Obsolete title menu remains hidden');
    pass('held real tier1 garage GLB blocks visible/legacy start and SDK ready; release reaches actual hub');
    await desktopUI(page);
  } finally { release?.(); await closeContext(desktop); }

  const failure = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  try {
    const page = await openPage(failure, 'failed-initial-garage', { readySpy: true, failureFixture: true });
    let fail = true, requests = 0;
    await page.route('**' + initialGarageAsset, route => { requests++; return fail ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Deliberate initial garage failure' }) : route.continue(); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await action(page, 'retryLoad').waitFor({ state: 'visible', timeout });
    await screen(page, 'loading');
    assert.equal(await page.locator('.gs-loading h1').textContent(), 'Не удалось открыть бокс');
    assert.equal(await page.locator('#playBtn').isDisabled(), true);
    assert.equal(await action(page, 'startDrive').count(), 0);
    await page.keyboard.press('Enter'); await screen(page, 'loading');
    assert.equal(requests, 1, 'A failed asset must not enter an automatic retry loop');
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 0);
    await capture(page, 'initial-garage-failure');
    fail = false;
    await action(page, 'retryLoad').click(); await ready(page);
    assert.equal(requests, 2, 'Explicit retry must request the real asset again');
    assert.equal(await page.evaluate(() => window.__browserCheckReady), 1);
    assert.equal(await action(page, 'retryLoad').count(), 0);
    assert.ok(report.expectedFailures.some(item => item.kind === 'http'), 'Controlled 503 must actually occur');
    pass('failed initial tier1 GLB blocks start/ready, presents explicit retry, and real reload recovers');
  } finally { await closeContext(failure); }

  await touchOrientation(browser, 'chromium-touch');
  if (process.argv.includes('--webkit')) {
    await access(webkit.executablePath()).catch(() => { throw new Error('--webkit requested but its browser binary is not installed; install Playwright WebKit before requesting this check'); });
    safari = await webkit.launch({ headless: true });
    report.browsers.push({ engine: 'WebKit', version: safari.version() });
    await touchOrientation(safari, 'webkit-touch');
    report.webkit = 'passed explicit touch-orientation smoke';
  }
  assert.deepEqual(report.accessibility.filter(item=>item.violations.length), [], 'Accessibility violations must all be corrected; see individual axe reports');
  await reconcileCompletedFetches();
  assert.deepEqual(report.errors, [], 'Unexpected browser script, console, HTTP, failed or external runtime requests');
  pass('no unexpected runtime/network errors; intentional failure/teardown and exact EOF+SHA-verified completed fetches only');
  report.completed = true;
} catch (error) {
  await reconcileCompletedFetches();
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await save('browser-report.json', report);
  await safari?.close(); await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
console.log(`Browser checks: ${report.results.length} passed (${target}); report: ${path.relative(root, output)}/browser-report.json`);
