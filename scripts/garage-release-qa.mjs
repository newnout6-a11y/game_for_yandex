import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { createProfile, reduceProgression } from '../src/progression.js';

/** Exercise the complete fleet and non-driving sections using an explicitly isolated, unlocked local QA save. */
const out = path.resolve('output/garage-release-qa');
await mkdir(out, { recursive: true });
let fixture = createProfile({ id: 'release_qa_not_a_player_account' });
fixture.wallet.credits = 50000; fixture.wallet.totalEarned = 49700; fixture.season.xp = 9000;
for (const vehicleId of ['hatch', 'sedan', 'suv', 'van']) {
  const result = reduceProgression(fixture, { type: 'BUY_VEHICLE', vehicleId });
  assert.ok(result.ok); fixture = result.profile;
}
const server = startServer({ port: 0 }); await once(server, 'listening');
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true, args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [] });
const source = await readFile('src/main.js', 'utf8');
const expose = `\nwindow.__release={get game(){return game},get renderer(){return renderer},get garage(){return garageScene},get profile(){return profileStore.get()},get screen(){return screen},get ready(){return assetsReady&&garageScene?.ready},step(n){for(let i=0;i<n;i++){if(screen==='playing'&&!lifecycle.paused){game.update(1/60,input.read());telemetry?.observe(game.state,1/60);}}ui.hud(game.state);},draw(){renderer.resize();if(screen==='playing')renderer.render(game.state,{dt:0,paused:true});else garageScene.render(innerWidth,innerHeight,garageFraming());}};`;
const report = { method: 'Actual UI, control events and physics with controlled time; isolated unlocked local wallet/XP, never earned or paid account data. No FPS claim.', fleet: [], errors: [] };

/** Poll the real host clock while the browser's simulation clock is deliberately held. */
async function wait(page, condition) {
  const end = Date.now() + 180000;
  while (Date.now() < end) { if (await page.evaluate(condition)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Condition timeout: ${condition}`);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/src/main.js', route => route.fulfill({ body: source + expose, contentType: 'text/javascript' }));
  await page.addInitScript(profile => localStorage.setItem('aerokrai.profile.v2', JSON.stringify(profile)), fixture);
  await page.clock.install(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await wait(page, () => window.__release?.ready); const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 50));
  const click = id => page.locator(`[data-gs-focus="${id}"]:visible`).first().click();
  const capture = async name => {
    await page.evaluate(() => { window.__release.draw(); let tag = document.getElementById('qa-fixture'); if (!tag) { tag = document.createElement('div'); tag.id = 'qa-fixture'; tag.textContent = 'ПРОВЕРКА СИСТЕМ · ИЗОЛИРОВАННОЕ ТЕСТОВОЕ СОХРАНЕНИЕ'; tag.style.cssText = 'position:fixed;bottom:2px;left:8px;background:#182226df;color:#fff;padding:4px;font:10px sans-serif;z-index:999;pointer-events:none'; document.body.append(tag); } });
    await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('capture', name);
  };
  await click('navigate:garage:fleet'); await click('navigate:garage:contracts');
  assert.ok(await page.locator('.gs-contract').count() >= 10); await capture('desktop-contracts');
  await click('navigate:garage:season');
  const claim = page.locator('[data-gs-focus^="claimSeason:"]:enabled').first(); await claim.click();
  assert.equal(await page.evaluate(() => window.__release.profile.season.claims.length), 1);
  await click('navigate:garage:style'); await page.locator('[data-gs-focus^="savePreset"]:enabled').click();
  const presetId = await page.evaluate(() => window.__release.profile.cosmetics.presets[0].id);
  await click(`applyPreset:${presetId}`);
  for (const id of ['rocket', 'hatch', 'sedan', 'suv', 'van']) {
    await click('navigate:garage:fleet'); await click(`selectVehicle:${id}`); await click('startDrive');
    await wait(page, () => window.__release.screen === 'playing');
    await page.evaluate(() => { const state = window.__release.game.state; state.nextSpawn = state.nextEvent = Infinity; state.traffic = []; state.obstacles = []; state.pickups = []; });
    await page.keyboard.down('KeyW'); await page.evaluate(() => window.__release.step(180)); await page.keyboard.up('KeyW');
    const actual = await page.evaluate(() => { const q = window.__release; return { id: q.renderer.playerVehicleId, distance: q.game.state.distance, speed: q.game.state.speed, phase: q.game.state.phase, altitude: q.game.state.altitude, flightUnavailable: q.game.state.flightAllowed === false, flightControlHidden: getComputedStyle(document.getElementById('flightBtn')).display === 'none', bodyId: q.renderer.player.userData.ownedVehicleId }; });
    assert.equal(actual.id, id); assert.ok(actual.distance > 20 && actual.speed > 5); assert.equal(actual.phase, 'playing');
    if (id !== 'rocket') { assert.equal(actual.altitude, 0); assert.equal(actual.flightUnavailable, true); assert.equal(actual.flightControlHidden, true); }
    report.fleet.push(actual); await capture(`drive-${id}`);
    if (id === 'rocket') {
      await page.keyboard.down('KeyW'); await page.evaluate(() => window.__release.step(120)); await page.keyboard.up('KeyW');
      await capture('roadster-original-roadside-poster');
    }
    await page.keyboard.press('Escape'); await page.locator('[data-action="menu"]').click();
  }
  await click('navigate:garage:fleet'); await click('navigate:garage:engineering'); await capture('desktop-engineering-comparison');
  const state = await page.evaluate(() => ({ runs: window.__release.profile.stats.runs, claims: window.__release.profile.season.claims.length, presets: window.__release.profile.cosmetics.presets.length, performance: performance.getEntriesByType('resource').reduce((out, item) => ({ requests: out.requests + 1, encodedBytes: out.encodedBytes + (item.encodedBodySize || 0) }), { requests: 0, encodedBytes: 0 }) }));
  assert.equal(state.runs, 5); assert.equal(state.claims, 1); assert.equal(state.presets, 1); report.final = state;
  assert.deepEqual(report.errors, []); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('GARAGE RELEASE PASS', JSON.stringify(report));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
