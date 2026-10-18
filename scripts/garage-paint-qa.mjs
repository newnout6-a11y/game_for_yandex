import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { createProfile, reduceProgression } from '../src/progression.js';

/** Capture the real garage material shader at controlled times; no generated or composited vehicle imagery. */
const out = path.resolve('output/garage-paint-qa'); await mkdir(out, { recursive: true });
let fixture = createProfile({ id: 'paint_visual_fixture' }); fixture.wallet.credits = 5000; fixture.wallet.totalEarned = 4700;
fixture = reduceProgression(fixture, { type: 'BUY_COSMETIC', cosmeticId: 'paint_copper', vehicleId: 'rocket' }).profile;
const server = startServer({ port: 0 }); await once(server, 'listening');
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true, args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [] });
const source = await readFile('src/main.js', 'utf8');
const expose = `\nwindow.__paintQA={get garage(){return garageScene},get renderer(){return renderer},get ready(){return assetsReady&&garageScene?.ready},draw(){renderer.resize();const r=renderer.renderer;r.info.autoReset=false;r.info.reset();garageScene.render(innerWidth,innerHeight,garageFraming());const info={calls:r.info.render.calls,triangles:r.info.render.triangles,buffer:[r.domElement.width,r.domElement.height],textures:r.info.memory.textures};r.info.autoReset=true;return info;}};`;
const errors = [], report = { method: 'Actual production paint shader and UI controls. Isolated owned-paint test profile, controlled time, no FPS claim.', frames: [] };

/** Wait using host time while keeping the rendering clock under explicit capture control. */
async function wait(page, fn) { const end = Date.now() + 180000; while (Date.now() < end) { if (await page.evaluate(fn)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Paint inspection readiness timeout'); }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/src/main.js', r => r.fulfill({ body: source + expose, contentType: 'text/javascript' }));
  await page.addInitScript(p => localStorage.setItem('aerokrai.profile.v2', JSON.stringify(p)), fixture);
  await page.clock.install(); await page.goto(`http://127.0.0.1:${server.address().port}`); await wait(page, () => window.__paintQA?.ready);
  const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 50));
  const click = id => page.locator(`[data-gs-focus="${id}"]:visible`).first().click();
  await click('navigate:garage:fleet'); await click('navigate:garage:style');
  const shot = async name => { const metrics = await page.evaluate(() => window.__paintQA.draw()); await page.screenshot({ path: path.join(out, name + '.png') }); report.frames.push({ name, ...metrics }); console.log('capture', name); };
  await shot('atelier-before'); await click('equipCosmetic:paint_copper:body.paint');
  for (const progress of [0, .5, 1]) {
    await page.evaluate(value => window.__paintQA.garage.setPaintProgress(value), progress); await shot(`atelier-paint-${Math.round(progress * 100)}`);
  }
  await page.evaluate(() => window.__paintQA.garage.advance(0, { visible: false }));
  await page.setViewportSize({ width: 844, height: 390 }); await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await shot('atelier-landscape');
  if (process.env.RECORD_PAINT === '1') {
    await page.setViewportSize({ width: 1280, height: 720 }); await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await mkdir(path.join(out, 'frames'), { recursive: true });
    await page.locator('[data-gs-tab="fleet"]').hover();
    await page.evaluate(() => { window.__captureAnimations=document.getAnimations(); for(const animation of window.__captureAnimations)animation.pause(); });
    for (let index = 0; index < 60; index++) {
      if(index===12){await click('equipCosmetic:paint_graphite:body.paint');await page.evaluate(()=>{window.__captureAnimations=document.getAnimations();for(const animation of window.__captureAnimations)animation.pause();});}
      await page.evaluate(frame => { for(const animation of window.__captureAnimations||[])animation.currentTime=(frame<12?frame:frame-12)*1000/24; window.__paintQA.garage.advance(1 / 24, { visible: true, reducedMotion: false }); window.__paintQA.draw(); }, index);
      await page.screenshot({ path: path.join(out, 'frames', `${String(index).padStart(4, '0')}.png`) });
      if (index % 12 === 0) console.log('paint frames', index + 1, '/ 60');
    }
  }
  assert.deepEqual(errors, []); report.errors = errors; await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('PAINT QA PASS');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
