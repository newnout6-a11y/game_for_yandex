import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { renderDimensions, renderShadowSettings } from '../src/render-settings.js';
import { startServer } from './serve.mjs';

// Run against real production UI/settings and drawing-buffer sizes. The paused
// clock makes screenshots reproducible; software WebGL is not an FPS benchmark.
const out = path.resolve(process.env.RENDER_QUALITY_OUT || 'output/render-quality-qa');
await mkdir(out, { recursive: true });
const server = startServer({ port: 0 }); await once(server, 'listening');
let browser;
const results = [];
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }),
    headless: true,
    args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [],
  });
  const profiles = [
    { name: 'desktop-4k', viewport: { width: 3840, height: 2160 }, dpr: 1, compact: false },
    { name: 'compact-portrait', viewport: { width: 390, height: 844 }, dpr: 3, compact: true },
  ].filter(profile => !process.env.RENDER_QUALITY_PROFILE || profile.name === process.env.RENDER_QUALITY_PROFILE);
  assert.ok(profiles.length, 'RENDER_QUALITY_PROFILE must name a supported profile');
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: profile.viewport, deviceScaleFactor: profile.dpr,
      ...(profile.compact ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce',
    });
    const page = await context.newPage(), errors = [], gpuErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /WebGL|THREE|shader/i.test(message.text())) gpuErrors.push(message.text()); });
    page.setDefaultTimeout(120000); await page.clock.install();
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => document.querySelector('#loadStatus').hidden);
    await page.evaluate(async () => {
      const { RoadRenderer } = await import('./src/world.js');
      const original = RoadRenderer.prototype.render;
      // Observe the live renderer without replacing its production draw path.
      RoadRenderer.prototype.render = function (...args) { window.__qualityWorld = this; return original.apply(this, args); };
    });
    const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 100));
    await page.clock.runFor(34); await page.waitForFunction(() => Boolean(window.__qualityWorld));
    await page.evaluate(() => {
      const world = window.__qualityWorld, original = world.renderer.setSize.bind(world.renderer);
      window.__qualityResizeCount = 0;
      world.renderer.setSize = (...args) => { window.__qualityResizeCount++; return original(...args); };
    });
    await page.locator('#renderSettings > summary').click();
    const captures = [];
    for (const quality of ['auto', 'high', 'ultra']) {
      await page.locator('#renderQuality').selectOption(quality);
      await page.clock.runFor(34);
      const actual = await page.evaluate(() => {
        const world = window.__qualityWorld, canvas = world.canvas, shadow = world.sun.shadow;
        return {
          quality: world.quality, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
          compact: world.compact, buffer: [canvas.width, canvas.height], shadow: shadow.mapSize.toArray(),
          shadowTarget: shadow.map ? [shadow.map.width, shadow.map.height] : null,
          displayedResolution: document.querySelector('#renderResolution').textContent,
          hint: document.querySelector('#renderQualityHint').textContent,
          overflow: document.documentElement.scrollWidth > innerWidth,
          resizeCount: window.__qualityResizeCount,
          textures: world.renderer.info.memory.textures,
          antialias: world.renderer.getContext().getContextAttributes().antialias,
        };
      });
      const expected = renderDimensions(...actual.viewport, actual.dpr, profile.compact, quality);
      const shadow = renderShadowSettings(quality, profile.compact).mapSize;
      assert.equal(actual.quality, quality); assert.equal(actual.compact, profile.compact);
      assert.deepEqual(actual.buffer, [expected.width, expected.height]);
      assert.deepEqual(actual.shadow, [shadow, shadow]); assert.deepEqual(actual.shadowTarget, [shadow, shadow]);
      assert.equal(actual.displayedResolution, `${expected.width} × ${expected.height}`);
      assert.equal(actual.overflow, false);
      if (profile.compact && quality === 'ultra') assert.match(actual.hint, /не 4K/);
      const stable = await page.evaluate(() => {
        const world = window.__qualityWorld, map = world.sun.shadow.map, before = window.__qualityResizeCount;
        world.resize(); world.resize(); world.setQuality(world.quality);
        return { reallocated: window.__qualityResizeCount !== before, sameMap: map === world.sun.shadow.map };
      });
      assert.deepEqual(stable, { reallocated: false, sameMap: true });
      await page.screenshot({ path: path.join(out, `${profile.name}-${quality}.png`) });
      captures.push(actual); console.log(profile.name, quality, JSON.stringify(actual));
    }
    // Profile selection must survive a real browser reload, not merely one UI instance.
    await page.clock.resume();
    await page.reload(); await page.waitForFunction(() => document.querySelector('#loadStatus').hidden);
    assert.equal(await page.locator('#renderQuality').inputValue(), 'ultra');
    if (profile.compact) {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => document.querySelector('#renderResolution').textContent === '1688 × 780', null, {polling:100});
      const orientation = await page.locator('#renderResolution').textContent();
      assert.equal(orientation, '1688 × 780');
      await page.screenshot({ path: path.join(out, `${profile.name}-landscape.png`) });
    }
    assert.deepEqual(errors, []); assert.deepEqual(gpuErrors, []);
    results.push({ name: profile.name, captures, persistence: true, errors, gpuErrors });
    await context.close();
  }
  await writeFile(path.join(out, 'metrics.json'), JSON.stringify({
    method: 'Production graphics selector, live WebGL canvas and shadow render targets. A controlled clock stabilizes captures. No screenshot-only resolution changes, postprocessing, or hardware FPS claims.',
    results,
  }, null, 2));
  console.log('Render-quality verification passed: ' + out);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
