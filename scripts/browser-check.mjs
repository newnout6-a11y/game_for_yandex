import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from 'playwright';
import { startServer } from './serve.mjs';
import { Game } from '../src/game.js';
import { seededRandom } from '../src/util.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'output/playwright');
await mkdir(output, { recursive: true });
const server = startServer({ port: 0, root: process.argv.includes('--dist') ? path.join(root, 'dist') : root });
await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port;
const errors = [], results = [];
let completed = false;
const seed = 1792022400000;
const fixture = new Game({ random: seededRandom(seed) }); fixture.start();
const browser = await chromium.launch({ ...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}), headless: true });
let safari;
/**
 * Append and print one completed browser-check result.
 * @param {string} name - Human-readable assertion group that has already passed.
 */
const pass = name => { results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };

/**
 * Open an instrumented page, wait for assets and pause its seeded clock.
 * Collects script, console, HTTP and external-runtime-request errors globally;
 * then installs state observation while preserving production rendering.
 * @param {object} context - Playwright browser context owned by the caller.
 * @returns {Promise<object>} Loaded page with a controlled clock and observed world.
 */
async function setup(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
  page.on('request', request => { const target = new URL(request.url()); if (target.protocol.startsWith('http') && !['127.0.0.1','localhost'].includes(target.hostname)) errors.push('External runtime request: ' + request.url()); });
  await page.clock.install({ time: new Date(seed) });
  await page.addInitScript(value => { /** Return the fixed millisecond seed used by game randomness; new Date still follows the controlled clock. */ Date.now = () => value; }, seed);
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#loadStatus').hidden, { timeout: 60000 });
  const readyTime = await page.evaluate(() => new Date().getTime());
  await page.clock.pauseAt(new Date(readyTime + 100));
  await observe(page); await frame(page,32);
  return page;
}
/**
 * Wrap the page renderer to expose the live state/world without suppressing draws.
 * Mutates only this test page's prototype; navigation discards the instrumentation.
 * @param {object} page - Loaded Playwright page with the production world module.
 */
async function observe(page) {
  await page.evaluate(async()=>{
    const {RoadRenderer}=await import('./src/world.js'); const render=RoadRenderer.prototype.render;
    /** Expose live state/world references, then forward every original render argument and return value. */ RoadRenderer.prototype.render=function(state,...rest){window.__driveState=state;window.__testWorld=this;return render.call(this,state,...rest);};
  });
}
/**
 * Dispatch one touch-control press/release through the real pointer handler.
 * Distinct pointer IDs keep simultaneous held controls independently releasable.
 * @param {object} page - Playwright page.
 * @param {string} id - Control element ID without '#'.
 * @param {boolean} down - True for pointerdown, false for pointerup.
 * @param {number} [pointerId=1] - Synthetic touch identity.
 */
async function hold(page,id,down,pointerId=1){await page.locator('#'+id).dispatchEvent(down?'pointerdown':'pointerup',{pointerId,pointerType:'touch'});}
/**
 * Require held gas/boost to remain active and drain energy between pickups.
 * Samples ten 16 ms updates, ignoring reward-caused energy increases, then
 * advances the remaining duration. Mutates simulation time and throws on failure.
 * @param {object} page - Observed page with gas and boost already held.
 * @param {number} ms - Total simulated milliseconds, expected to be at least 160.
 */
async function assertBoostDrain(page,ms) {
  let previous=await page.evaluate(()=>({nitro:window.__driveState.nitro,charges:window.__driveState.charges})), spent=false;
  for(let i=0;i<10;i++){
    await frame(page,16);
    const current=await page.evaluate(()=>({nitro:window.__driveState.nitro,charges:window.__driveState.charges,boosting:window.__driveState.boosting}));
    assert.equal(current.boosting,true,'Held gas + nitro must activate boost');
    if(current.charges===previous.charges&&current.nitro<previous.nitro)spent=true;previous=current;
  }
  assert.ok(spent,'Nitro must drain between pickup rewards');await frame(page,ms-160);
}
/**
 * Advance the controlled browser clock, including real game/input callbacks.
 * @param {object} page - Page whose clock is installed.
 * @param {number} ms - Simulated milliseconds, not an FPS or wall-time sample.
 */
async function frame(page, ms) { await page.clock.runFor(ms); }
/**
 * Assert the app's declared screen equals the requested UI state.
 * @param {object} page - Playwright page containing #app.
 * @param {string} expected - Expected data-screen value.
 */
async function screen(page, expected) { assert.equal(await page.locator('#app').getAttribute('data-screen'), expected); }
/**
 * Write a PNG under the browser-check output directory.
 * @param {object} page - Playwright page to capture.
 * @param {string} name - Output basename without extension.
 * @param {boolean} [fullPage=false] - Capture the whole document instead of viewport.
 */
async function screenshot(page, name, fullPage = false) { await page.screenshot({ path: path.join(output, name + '.png'), fullPage }); }
/**
 * Exercise default, hover, focus and active states of the primary play button.
 * Asserts 4.5:1 computed-color contrast and a non-none focus outline, then saves
 * measurements. This does not model transparency/compositing or all WCAG criteria.
 * @param {object} page - Menu page; focus and pointer state are changed by the check.
 */
async function buttonStates(page) {
  const button = page.locator('#playBtn');
  const states = [];
  /**
   * Read current button colors, assert contrast/focus and append measurements.
   * @param {string} name - State label; 'focus' additionally requires an outline.
   */
  async function inspect(name) {
    const colors = await button.evaluate(el => {
      const style = getComputedStyle(el);
      return { foreground: style.color, background: style.backgroundColor, outline: style.outlineStyle };
    });
    /**
     * Extract the first three channels of a computed rgb()/rgba() color.
     * @param {string} value - Browser-computed color string, not an arbitrary CSS token.
     * @returns {number[]} Red, green and blue in 0–255 units; alpha is ignored.
     */
    const rgb = value => value.match(/[\d.]+/g).slice(0,3).map(Number);
    /**
     * Convert computed sRGB channels to WCAG relative luminance.
     * @param {string} value - Opaque computed rgb()/rgba() color used by this fixture.
     * @returns {number} Linear-light weighted luminance in the range 0–1.
     */
    const luminance = value => rgb(value).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i], 0);
    const a = luminance(colors.foreground), b = luminance(colors.background);
    const contrast = (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
    states.push({ name, ...colors, contrast });
    assert.ok(contrast >= 4.5, name + ' primary button contrast');
    if (name === 'focus') assert.notEqual(colors.outline, 'none');
  }
  await inspect('default');
  await button.hover(); await inspect('hover');
  await page.mouse.move(0,0); await button.focus(); await inspect('focus');
  await button.hover(); await page.mouse.down(); await inspect('active');
  await page.mouse.move(0,0); await page.mouse.up();
  await writeFile(path.join(output, 'button-states.json'), JSON.stringify(states, null, 2));
  pass('primary button default/hover/focus/active contrast and visible focus');
}
/**
 * Run the selected WCAG A/AA axe rules and assert there are no violations.
 * Temporarily resumes timers required by axe, pauses the clock afterward and
 * writes the full JSON report; automated checks are not a full accessibility audit.
 * @param {object} page - Loaded Playwright page to inspect.
 * @param {string} label - Report filename suffix and pass-result label.
 */
async function axe(page, label) {
  // axe uses timers internally; it must run with the virtual clock ticking.
  await page.clock.resume();
  await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') });
  const report = await page.evaluate(async () => await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
  const clockTime = await page.evaluate(() => new Date().getTime());
  await page.clock.pauseAt(new Date(clockTime + 100));
  await writeFile(path.join(output, 'axe-' + label + '.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), []);
  pass('axe ' + label + ': no violations in selected WCAG rules');
}
/**
 * Estimate player center from red-dominant pixels in the lower WebGL buffer.
 * This color heuristic assumes the red player fixture and can include other red
 * pixels; it checks rendered steering movement, not exact geometry bounds.
 * @param {object} page - Page whose canvas exposes a readable WebGL2 buffer.
 * @returns {Promise<number>} Mean horizontal CSS-pixel coordinate, or -1 if absent.
 */
async function playerX(page) {
  return await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * Math.floor(canvas.height * .52) * 4);
    context.readPixels(0, 0, canvas.width, Math.floor(canvas.height * .52), context.RGBA, context.UNSIGNED_BYTE, pixels);
    const data = { data: pixels };
    let total = 0, count = 0;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i] > 110 && data.data[i] > data.data[i + 1] * 1.5 && data.data[i] > data.data[i + 2] * 1.4) { total += (i / 4) % canvas.width; count++; }
    }
    return count ? total / count / (canvas.width / canvas.clientWidth) : -1;
  });
}
/**
 * Drive toward the nearest ahead traffic using actual held keyboard events.
 * Uses heading-aware 0.3-second steering prediction, stopping when results appears
 * or throwing after 220 × 350 ms of controlled time. Held keys remain page state.
 * @param {object} page - Observed game page; mutates inputs and simulation state.
 */
async function waitForCrash(page) {
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 220; i++) {
    if (await page.locator('#app').getAttribute('data-screen') === 'results') return;
    const direction=await page.evaluate(()=>{
      const s=window.__driveState,car=s.traffic.filter(c=>c.z>0).sort((a,b)=>a.z-b.z)[0];
      if(!car||s.phase!=='playing')return 0;
      const error=car.lane-(s.x+Math.sin(s.heading)*s.speed*.3/3.5);return Math.abs(error)>.05?Math.sign(error):0;
    });
    await page.keyboard.up('KeyA');await page.keyboard.up('KeyD');
    if(direction)await page.keyboard.down(direction<0?'KeyA':'KeyD');
    await frame(page, 350);
  }
  throw Error('No collision while driving toward traffic after 77 simulated seconds');
}
/**
 * Estimate the red player's CSS-pixel center from a composited screenshot.
 * Uses the lower image band for WebKit, where direct WebGL pixel reads can differ
 * from visible output. Fewer than 101 qualifying pixels is treated as no player.
 * @param {object} page - Playwright page to screenshot without writing a file.
 * @returns {Promise<number>} Mean horizontal CSS-pixel coordinate, or -1.
 */
async function compositedPlayerX(page) {
  const png = await page.screenshot();
  return await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, Math.floor(image.height * .48), image.width, Math.floor(image.height * .49)).data;
    let total = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 110 && pixels[i] > pixels[i+1] * 1.5 && pixels[i] > pixels[i+2] * 1.4) { total += i/4 % image.width; count++; }
    return count > 100 ? total/count/image.width*innerWidth : -1;
  }, 'data:image/png;base64,' + png.toString('base64'));
}

try {
  const loadingContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await loadingContext.addInitScript(() => {
    window.__readyCalls = 0;
    window.YaGames = { /** Resolve a loading-only SDK mock used to count ready notifications while an asset is held. */ init: async () => ({ features: { LoadingAPI: { /** Count readiness calls without contacting Yandex. */ ready: () => window.__readyCalls++ } } }) };
  });
  const loadingPage = await loadingContext.newPage();
  let releaseCar;
  const heldCar = new Promise(resolve => { releaseCar = resolve; });
  await loadingPage.route('**/public/assets/roadster.glb', async route => { await heldCar; await route.continue(); });
  await loadingPage.goto(url);
  await loadingPage.waitForFunction(() => document.querySelector('#playBtn').textContent.includes('Загрузка'));
  assert.equal(await loadingPage.locator('#playBtn').isDisabled(), true);
  await loadingPage.keyboard.press('Enter'); await screen(loadingPage, 'menu');
  assert.equal(await loadingPage.evaluate(() => window.__readyCalls), 0);
  releaseCar();
  await loadingPage.waitForFunction(() => document.querySelector('#loadStatus').hidden, { timeout: 60000 });
  await loadingPage.waitForFunction(() => window.__readyCalls === 1);
  await loadingPage.locator('#playBtn').click(); await screen(loadingPage, 'playing');
  pass('slow artist model blocks start and SDK ready until every asset is loaded');
  await loadingContext.close();

  const failureContext = await browser.newContext();
  const failurePage = await failureContext.newPage();
  let failSky = true;
  await failurePage.route('**/public/assets/daylight.hdr', route => failSky ? route.fulfill({ status: 503, body: 'Controlled asset failure' }) : route.continue());
  failurePage.on('pageerror', error => errors.push(error.message));
  await failurePage.goto(url);
  await failurePage.waitForFunction(() => document.querySelector('#playBtn').textContent === 'Повторить загрузку');
  await screen(failurePage, 'menu');
  assert.equal(await failurePage.locator('#loadStatus').isVisible(), true);
  failSky = false;
  await failurePage.locator('#playBtn').click();
  await failurePage.waitForFunction(() => document.querySelector('#loadStatus').hidden, { timeout: 60000 });
  pass('failed asset has a visible retry state; retry reloads a complete scene');
  await failureContext.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await setup(desktop);
  await screen(page, 'menu');
  await screenshot(page, 'menu-desktop-final');
  await buttonStates(page);
  await axe(page, 'menu-desktop');
  for (const route of ['neon', 'dawn', 'ring']) {
    await page.locator('[data-route="' + route + '"]').click();
    assert.equal(await page.locator('[data-route="' + route + '"]').getAttribute('aria-pressed'), 'true');
    await frame(page, 32); await screenshot(page, 'route-' + route);
  }
  await page.locator('[data-difficulty="rush"]').click();
  await page.reload(); await page.waitForFunction(() => document.querySelector('#loadStatus').hidden); await observe(page); await frame(page, 100);
  assert.equal(await page.locator('[data-difficulty="rush"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-difficulty="flow"]').click();
  await page.locator('#soundBtn').click(); assert.equal(await page.locator('#soundBtn').getAttribute('aria-pressed'), 'true');
  await page.locator('#soundBtn').click(); assert.equal(await page.locator('#soundBtn').getAttribute('aria-pressed'), 'false');
  pass('routes, difficulty persistence, sound toggle');
  await page.locator('#helpBtn').click();
  assert.equal(await page.locator('#dialogTitle').textContent(), 'Управление');
  await axe(page, 'help-dialog'); await screenshot(page, 'help-desktop');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#overlay').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'helpBtn');
  pass('help modal, Escape, focus restoration');
  await page.locator('#fullscreenBtn').click();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true);
  await page.locator('#fullscreenBtn').click();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  pass('fullscreen enter/exit');

  await page.locator('#playBtn').click(); await frame(page, 1000); await screen(page, 'playing');
  assert.equal(await page.locator('#speed').textContent(),'0');assert.equal(await page.locator('#distance').textContent(),'0 м');
  assert.equal(await page.locator('#combo').isVisible(),false);
  assert.equal(await page.locator('.speed-dial').isVisible(),true);
  assert.equal(await page.locator('#speedNeedle').getAttribute('transform'),'rotate(-90 110 120)');
  await axe(page,'driving-desktop');
  await page.keyboard.down('KeyW');await frame(page,4000);assert.ok(parseInt(await page.locator('#speed').textContent())>90);
  const dial=await page.evaluate(()=>({speed:window.__driveState.speed,angle:document.querySelector('#speedNeedle').getAttribute('transform'),arc:document.querySelector('#speedArc').style.strokeDashoffset}));
  assert.equal(dial.angle,'rotate('+(-90+Math.min(1,dial.speed*3.6/300)*180)+' 110 120)');
  assert.ok(Math.abs(Number(dial.arc)-(100-Math.min(1,dial.speed*3.6/300)*100))<.001,'Speed scale follows actual speed');
  pass('instrument HUD starts at zero, hides inactive combo and follows actual vehicle speed');
  const center = await playerX(page); assert.ok(center > 600 && center < 840);
  await page.keyboard.down('KeyA'); await frame(page, 800);await page.keyboard.up('KeyA');
  const left = await playerX(page); assert.ok(left < center - 100);
  const samples=[];await page.keyboard.down('KeyD');for(let i=0;i<50;i++){await frame(page,16);samples.push(await playerX(page));}await page.keyboard.up('KeyD');await frame(page,250);
  assert.ok(samples.slice(1).every((x,i)=>Math.abs(x-samples[i])<15),'No frame teleports during steering');
  const view=await page.evaluate(()=>window.__testWorld.view);assert.ok(Math.abs(view.x)<.001&&Math.abs(view.lookX)<.001,'Camera remains centered during steering');
  await page.keyboard.down('Space'); await assertBoostDrain(page,700); await page.keyboard.up('Space');
  assert.ok(parseInt(await page.locator('#speed').textContent()) > 110);
  await screenshot(page, 'game-desktop-final');
  assert.equal(await page.locator('#eventBanner').isVisible(),true);assert.equal(await page.locator('#eventTitle').textContent(),'Дорожные работы');
  assert.ok(await page.evaluate(()=>window.__testWorld.hazards.size>=8),'Roadworks have real rendered obstacles');
  pass('manual gas, continuous steering without frame teleports, stationary chase camera, nitro and rendered roadworks');
  const fastSpeed=parseInt(await page.locator('#speed').textContent());await page.keyboard.up('KeyW');await page.keyboard.down('KeyS');await frame(page,800);await page.keyboard.up('KeyS');
  assert.ok(parseInt(await page.locator('#speed').textContent())<fastSpeed-30);pass('keyboard brake slows the car independently of steering');
  await page.evaluate(async () => {
    const { RoadRenderer } = await import('./src/world.js');
    const original = RoadRenderer.prototype.render;
    /** Refresh the observed renderer instance while preserving the original draw behavior. */ RoadRenderer.prototype.render = function (...args) { window.__testWorld = this; return original.apply(this, args); };
  });
  await frame(page, 32);
  const resources = await page.evaluate(state => {
    const world = window.__testWorld;
    /**
     * Render a fresh set of IDs while reusing the cloned simulation fixture.
     * Mutates distance, two traffic entries and one pickup to exercise recycling;
     * 0.1-second render updates also age crash particles before resource assertions.
     * @param {number} index - Unique batch index and 15 m distance multiplier.
     */
    const renderBatch = index => {
      state.distance = index * 15;
      state.traffic = [0,2].map(lane => ({ id: 'test-car-' + index + '-' + lane, lane, z: 80 + lane * 25, color: lane }));
      state.pickups = [{ id: 'test-pickup-' + index, lane: 1, z: 35 }];
      world.render(state, { dt: .1 });
    };
    renderBatch(0); world.effect('crash');
    for (let i = 1; i < 15; i++) renderBatch(i);
    const before = world.renderer.info.memory.geometries;
    const beforeCars=world.traffic.size+[...world.trafficPool.values()].reduce((sum,pool)=>sum+pool.length,0),beforePickups=world.pickups.size+world.pickupPool.length;
    for (let i = 15; i < 40; i++) renderBatch(i);
    return { before, after: world.renderer.info.memory.geometries, beforeCars, beforePickups, cars: world.traffic.size + [...world.trafficPool.values()].reduce((sum,pool)=>sum+pool.length,0), pickups: world.pickups.size + world.pickupPool.length, particles: world.particles.length };
  }, structuredClone(fixture.state));
  assert.equal(resources.after, resources.before);
  assert.equal(resources.cars,resources.beforeCars);assert.equal(resources.pickups,resources.beforePickups);assert.equal(resources.particles, 0);
  await frame(page, 32);
  pass('traffic, pickups and collision particles reuse GPU geometry across repeated spawns');

  await page.locator('#pauseBtn').click(); await screen(page, 'paused');
  const pausedScore = await page.locator('#score').textContent(); await frame(page, 3000);
  assert.equal(await page.locator('#score').textContent(), pausedScore);
  await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'menu');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'resume');
  await axe(page, 'pause-dialog'); await screenshot(page, 'pause-desktop');
  await page.locator('[data-action="resume"]').click(); await screen(page, 'playing');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await screen(page, 'paused');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await screen(page, 'paused'); await page.locator('[data-action="resume"]').click();
  pass('pause freezes simulation, traps focus, and tab restore waits for explicit resume');

  await waitForCrash(page); await screen(page, 'results');
  await screenshot(page, 'results-desktop'); await axe(page, 'results-dialog');
  assert.match(await page.locator('[data-action="revive"]').textContent(), /бесплатно/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('potok.v1')));
  assert.equal(saved.runs, 1); assert.ok(saved.best.flow > 0);
  await page.locator('[data-action="revive"]').click(); await screen(page, 'playing');
  await waitForCrash(page);
  assert.equal(await page.locator('[data-action="revive"]').count(), 0);
  const continued = await page.evaluate(() => JSON.parse(localStorage.getItem('potok.v1')));
  assert.equal(continued.runs, 1); assert.ok(continued.totalDistance > saved.totalDistance);
  await page.locator('[data-action="retry"]').click(); await screen(page, 'playing');
  await page.keyboard.press('Escape'); await screen(page, 'paused');
  pass('keyboard pause immediately after retry leaves no focus in hidden dialog');
  await page.locator('[data-action="menu"]').click();
  assert.equal(await page.locator('#menuBest').textContent(), Math.floor(continued.best.flow).toLocaleString('ru-RU'));
  pass('collision, records, one free revive, repeat collision, retry, menu, no duplicate run count');
  await desktop.close();

  for (const [width, height] of [[280,720],[320,780],[390,844],[414,896],[768,1024],[844,390],[1920,1080]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 900, reducedMotion: 'reduce' });
    const mobile = await setup(context);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Horizontal overflow at ' + width);
    for (const selector of ['#playBtn', '[data-route="ring"]', '[data-route="neon"]', '[data-route="dawn"]']) {
      const bounds = await mobile.locator(selector).boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, selector + ' at ' + width);
    }
    await screenshot(mobile, 'menu-' + width, true);
    if (width <= 414) {
      await mobile.locator('#helpBtn').click();
      const dialogBounds = await mobile.locator('#dialog').boundingBox();
      assert.ok(dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= height + 1, 'Dialog outside viewport at ' + width);
      await mobile.locator('[data-action="closeHelp"]').click();
    }
    if (width === 390) {
      await axe(mobile, 'menu-mobile');
      await mobile.locator('#playBtn').click(); await frame(mobile, 1000);
      await axe(mobile,'driving-mobile');
      const nitroBounds = await mobile.locator('.nitro-block').boundingBox();
      assert.ok(nitroBounds.y + nitroBounds.height < height * .4, 'Mobile nitro must leave the car unobstructed');
      await hold(mobile,'gasBtn',true,1);await frame(mobile,4000);
      const before = await playerX(mobile);await hold(mobile,'leftBtn',true,2);await frame(mobile,800);await hold(mobile,'leftBtn',false,2);
      const after = await playerX(mobile); assert.ok(after >= 0 && after < before - 40);
      await hold(mobile,'rightBtn',true,2);await frame(mobile,800);await hold(mobile,'rightBtn',false,2);await frame(mobile,250);
      await hold(mobile,'boostBtn',true,3);await assertBoostDrain(mobile,400);await hold(mobile,'boostBtn',false,3);
      await screenshot(mobile, 'game-mobile-final');
      const mobileSpeed=parseInt(await mobile.locator('#speed').textContent());await hold(mobile,'brakeBtn',true,4);await frame(mobile,700);await hold(mobile,'brakeBtn',false,4);
      assert.ok(parseInt(await mobile.locator('#speed').textContent())<mobileSpeed-30,'Brake has priority over held gas');
      await mobile.locator('#gasBtn').dispatchEvent('pointercancel',{pointerId:1});await frame(mobile,16);
      assert.equal(await mobile.locator('#gasBtn').getAttribute('data-held'),'false');
      pass('mobile multi-touch gas, steering, brake priority, nitro and pointer cancellation');
      // Actual pointer sequence exercises the canvas gesture handler.
      const canvasBounds = await mobile.locator('#scene').boundingBox();
      await mobile.mouse.move(260, canvasBounds.height * .55); await mobile.mouse.down();
      await mobile.mouse.move(170, canvasBounds.height * .55, { steps: 4 }); await mobile.mouse.up();
      const swipeBefore=await playerX(mobile);await frame(mobile,650);assert.ok(await playerX(mobile)<swipeBefore-15);
      pass('mobile canvas swipe');
    }
    if(width!==390){await mobile.locator('#playBtn').click();await frame(mobile,100);}
    const instrumentBoxes=await mobile.locator('.score-block,.speed-block,.nitro-block,.challenge').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {name:el.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for(let i=0;i<instrumentBoxes.length;i++){
      const a=instrumentBoxes[i];assert.ok(a.x>=0&&a.y>=0&&a.right<=width+1&&a.bottom<=height+1,a.name+' stays on screen at '+width);
      for(const b of instrumentBoxes.slice(i+1))assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,a.name+' overlaps '+b.name+' at '+width);
    }
    if(width<900){
      for(const id of ['leftBtn','rightBtn','gasBtn','brakeBtn','boostBtn']){
        const b=await mobile.locator('#'+id).boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1,id+' stays on screen at '+width);
      }
    }
    pass('responsive menu and non-overlapping HUD ' + width + '×' + height);
    await context.close();
  }

  const platform = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await platform.addInitScript(() => {
    window.__sdkCalls = []; window.__platformEvents = {};
    window.YaGames = { /** Resolve the page-local SDK mock with manually driven platform/ad callbacks. */ init: async () => ({
      /** Store a platform listener by event name for explicit pause/resume dispatch in the test. */ on: (name, callback) => { window.__platformEvents[name] = callback; },
      features: { LoadingAPI: { /** Record loading-ready notifications for exactly-once assertions. */ ready: () => window.__sdkCalls.push('ready') }, GameplayAPI: { /** Record gameplay-start notifications without calling the external SDK. */ start: () => window.__sdkCalls.push('start'), /** Record gameplay-stop notifications without calling the external SDK. */ stop: () => window.__sdkCalls.push('stop') } },
      adv: { /** Save rewarded-ad callbacks so skipped and earned rewards can be tested independently. */ showRewardedVideo: ({ callbacks }) => { window.__adCallbacks = callbacks; }, /** Close the fake interstitial immediately with the not-shown flag. */ showFullscreenAdv: ({ callbacks }) => callbacks.onClose(false) },
    }) };
  });
  const sdkPage = await setup(platform);
  assert.deepEqual(await sdkPage.evaluate(() => window.__sdkCalls), ['ready']);
  await sdkPage.locator('#playBtn').click(); await frame(sdkPage, 100);
  await sdkPage.evaluate(() => window.__platformEvents.game_api_pause()); await screen(sdkPage, 'paused');
  await sdkPage.evaluate(() => window.dispatchEvent(new Event('focus'))); await screen(sdkPage, 'paused');
  await sdkPage.evaluate(() => window.__platformEvents.game_api_resume());
  await sdkPage.locator('[data-action="resume"]').click();
  await waitForCrash(sdkPage);
  await sdkPage.locator('[data-action="revive"]').click();
  assert.equal(await sdkPage.locator('#dialog').getAttribute('aria-busy'), 'true');
  await sdkPage.evaluate(() => window.__adCallbacks.onClose());
  await screen(sdkPage, 'results'); assert.equal(await sdkPage.locator('[data-action="revive"]').isEnabled(), true);
  await sdkPage.locator('[data-action="revive"]').click();
  await sdkPage.evaluate(() => { window.__adCallbacks.onRewarded(); window.__adCallbacks.onClose(); });
  await screen(sdkPage, 'playing');
  assert.equal(await sdkPage.evaluate(() => window.__sdkCalls.filter(x => x === 'ready').length), 1);
  pass('mocked Yandex SDK: ready, gameplay, independent platform pause, no reward on skipped ad, confirmed rewarded continuation');
  await platform.close();

  safari = await webkit.launch({ headless: true });
  const ios = await safari.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  const iosPage = await setup(ios);
  await screenshot(iosPage, 'menu-webkit-iphone');
  await iosPage.locator('#playBtn').tap(); await frame(iosPage, 1000); await screen(iosPage, 'playing');
  const iosBefore = await compositedPlayerX(iosPage); assert.ok(iosBefore > 100 && iosBefore < 280, 'WebKit screenshot must contain the rendered car');
  await hold(iosPage,'gasBtn',true,1);await frame(iosPage,4000);await hold(iosPage,'rightBtn',true,2);await frame(iosPage,650);await hold(iosPage,'rightBtn',false,2);await hold(iosPage,'gasBtn',false,1);
  assert.ok(await compositedPlayerX(iosPage) > iosBefore + 40, 'WebKit composited car must move after held steering and gas');
  await iosPage.locator('#pauseBtn').tap(); await screen(iosPage, 'paused');
  await iosPage.locator('[data-action="resume"]').tap(); await frame(iosPage, 200); await screen(iosPage, 'playing');
  await screenshot(iosPage, 'game-webkit-iphone');
  pass('WebKit with iPhone 13 emulation: composited car pixels, touch steering, pause, resume');
  await iosPage.setViewportSize({ width: 844, height: 390 }); await frame(iosPage, 200);
  assert.ok(await compositedPlayerX(iosPage) > 0, 'WebKit car must remain visible after rotation');
  await screenshot(iosPage, 'game-webkit-landscape');
  await iosPage.setViewportSize({ width: 390, height: 664 }); await frame(iosPage, 200);
  assert.ok(await compositedPlayerX(iosPage) > 0, 'WebKit car must remain visible after rotating back');
  pass('WebKit portrait/landscape/portrait preserves the composited 3D scene');
  await ios.close();

  assert.deepEqual(errors, [], 'Browser console/network errors');
  pass('zero runtime console, page and HTTP errors');
  completed = true;
} finally {
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ completed, target: process.argv.includes('--dist') ? 'dist' : 'source', results, errors }, null, 2));
  await browser.close(); if (safari) await safari.close(); server.close();
}
console.log('Browser checks: ' + results.length + '/' + results.length + ' passed');
