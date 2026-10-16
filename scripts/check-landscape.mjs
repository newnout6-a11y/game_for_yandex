import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { startServer } from './serve.mjs';
const server = startServer({ port: 0, root: process.argv.includes('--dist') ? path.resolve('dist') : process.cwd() });
await once(server, 'listening');
try {
  for (const [name, engine, options] of [['chrome',chromium,{channel:'chrome'}],['webkit',webkit,{}]]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => document.querySelector('#loadStatus').hidden);
      await page.locator('#playBtn').tap();
      const nitro = await page.locator('.nitro-block').boundingBox(), boost = await page.locator('#boostBtn').boundingBox();
      assert.ok(nitro.y + nitro.height < 390 * .4, 'Nitro meter stays above the driving area');
      assert.ok(boost.x > 844 * .7, 'Boost control leaves the player car clear');
      assert.equal(await page.locator('#runHint').isVisible(), false);
      await page.screenshot({ path: 'output/playwright/game-' + name + '-landscape.png' });
      console.log('PASS ' + name + ' landscape: controls and nitro leave the car and center of road clear');
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
