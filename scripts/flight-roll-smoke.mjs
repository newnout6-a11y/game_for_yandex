import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startServer } from './serve.mjs';
const out = process.env.FLIGHT_QA_OUT || 'output/flight-roll-qa'; await mkdir(out, { recursive: true });
const server = startServer({ port: 0, root: process.cwd() }); await once(server, 'listening');
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true,
  args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [] });
const results = [];
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 844 }]].filter(([name]) => !process.env.FLIGHT_QA_PROFILE || process.env.FLIGHT_QA_PROFILE === name)) {
    const mobile = name === 'mobile';
    const page = await browser.newPage({ viewport, deviceScaleFactor: mobile ? 2 : 1, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    const errors = [], consoleErrors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /WebGL|THREE|shader/i.test(m.text())) consoleErrors.push(m.text()); });
    await page.clock.install(); console.log(name, 'loading');
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => document.querySelector('#loadStatus').hidden, null, { timeout: 120000 });
    await page.evaluate(async () => {
      const { RoadRenderer } = await import('./src/world.js');
      const { UI } = await import('./src/ui.js');
      window.__captureHud = UI.prototype.hud;
      window.__captureRender = RoadRenderer.prototype.render;
      RoadRenderer.prototype.render = function (state) { window.__s = state; window.__w = this; };
    });
    const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 100));
    await page.locator('#playBtn').click(); await page.clock.runFor(32);
    await page.screenshot({ animations: 'disabled' }); // Complete menu fade before inspecting gameplay.
    assert.equal(await page.locator('.scene-shade').evaluate(e => getComputedStyle(e).opacity), '0');
    await page.evaluate(() => {
      Object.assign(window.__s, { distance: 125, speed: 26, nitro: 100, flightReady: true, nextEvent: Infinity, nextSpawn: Infinity, pickups: [], obstacles: [],
        traffic: [{ id: 51, lane: 0, z: 27, speed: 21, kind: 'suv', color: 1 }, { id: 52, lane: 2, z: 44, speed: 23, kind: 'van', color: 0 }, { id: 53, lane: 0, z: 95, speed: 24, kind: 'sedan', color: 5 }] });
      window.__w.view = {}; window.__w.renderer.info.autoReset = false;
      const renderer = window.__w.renderer, rawGpu = renderer.render.bind(renderer);
      window.__drawGpu = (...args) => {
        // Lazy background-to-cubemap uploads call renderer.render internally.
        // Keep that entry point real while drawing, not the CPU-only stub.
        const previous = renderer.render; renderer.render = rawGpu;
        try { return rawGpu(...args); } finally { renderer.render = previous; }
      };
      // Warm all lazy background/material GPU resources before CPU-only stepping.
      window.__captureRender.call(window.__w, window.__s, { menu: false, dt: 1 });
      renderer.render = () => {}; // Simulate every frame, draw only requested snapshots.
    });
    const advance = async seconds => {
      const frames = Math.ceil(seconds * 30);
      for (let i = 0; i < frames; i++) {
        await page.clock.runFor(Math.round((i + 1) * seconds * 1000 / frames) - Math.round(i * seconds * 1000 / frames));
        await page.evaluate(dt => { window.__w.renderer.info.reset(); window.__captureRender.call(window.__w, window.__s, { menu: false, dt }); }, seconds / frames);
      }
    };
    const capture = async label => {
      const data = await page.evaluate(() => {
        const s = window.__s, w = window.__w;
        window.__captureHud.call({}, s); // Keep the initial safe fixture HUD truthful too.
        w.renderer.info.reset(); window.__drawGpu(w.scene, w.camera);
        const controls = ['gasBtn', 'flightBtn', 'rollLeftBtn', 'rollRightBtn', 'boostBtn', 'brakeBtn'].map(id => {
          const r = document.getElementById(id).getBoundingClientRect(); return { id, x: r.x, y: r.y, width: r.width, height: r.height };
        });
        return { altitude: s.altitude, verticalSpeed: s.verticalSpeed, thrusterPower: s.thrusterPower, reserve: s.landingReserve,
          rolling: s.rolling, rollAngle: s.rollAngle, progress: s.rollProgress, cooldown: s.flightCooldown, speed: s.speed, throttle: s.throttle,
          nitro: s.nitro, phase: s.phase, overflow: document.documentElement.scrollWidth > innerWidth,
          calls: w.renderer.info.render.calls, triangles: w.renderer.info.render.triangles, textures: w.renderer.info.memory.textures,
          particleCount: w.scene.getObjectByName('cold-gas-thruster-vapor')?.userData.activeParticles,
          atlasReady: w.flightEffects.mesh.userData.atlasReady, controls };
      });
      assert.equal(data.phase, 'playing'); assert.equal(data.overflow, false);
      assert.equal(data.atlasReady, true, 'Blender-rendered smoke asset decoded before gameplay');
      await page.screenshot({ path: `${out}/${name}-${label}.png` }); console.log(name, label, JSON.stringify(data)); return data;
    };
    const key = async (action, down) => {
      if (mobile) {
        const ids = { gas: ['gasBtn', 1], flight: ['flightBtn', 2], roll: ['rollRightBtn', 3] };
        const [id, pointerId] = ids[action];
        await page.locator('#' + id).dispatchEvent(down ? 'pointerdown' : 'pointerup', { pointerId, pointerType: 'touch' });
      } else await page.keyboard[down ? 'down' : 'up']({ gas: 'KeyW', flight: 'KeyF', roll: 'KeyE' }[action]);
    };
    const ground = await capture('ground');
    await key('gas', true); await key('flight', true); await advance(1.6);
    const hover = await capture('hover'); assert.equal(hover.altitude, 3.3); assert.ok(hover.speed > ground.speed);
    await key('roll', true); await advance(.55);
    const roll = await capture('roll'); assert.equal(roll.rolling, true); assert.ok(Math.abs(roll.rollAngle) > 2.5);
    if (process.env.CAPTURE_UNDERSIDE && !mobile) {
      const style = await page.addStyleTag({ content: '#hud,.topbar {visibility:hidden!important}' });
      await page.evaluate(() => {
        const w = window.__w, c = w.camera;
        window.__savedInspectionCamera = { p: c.position.clone(), q: c.quaternion.clone() };
        c.position.set(3.8, 6.5, 6.4); c.lookAt(0, 4.1, 0);
        w.renderer.info.reset(); window.__drawGpu(w.scene, c);
      });
      await page.screenshot({ path: `${out}/desktop-underside-inspection.png` });
      await page.evaluate(() => { const c = window.__w.camera; c.position.copy(window.__savedInspectionCamera.p); c.quaternion.copy(window.__savedInspectionCamera.q); });
      await style.evaluate(e => e.remove());
    }
    await key('roll', false); await key('flight', false); await advance(.7);
    assert.equal((await page.evaluate(() => window.__s.rolling)), false);
    await advance(.8); const descent = await capture('descent'); assert.ok(descent.thrusterPower > .3);
    await advance(1.3); const flare = await capture('flare'); assert.ok(flare.thrusterPower > .55); assert.ok(flare.altitude < .3);
    await advance(.8); const landed = await capture('landed'); assert.equal(landed.altitude, 0); assert.ok(landed.cooldown > 0);
    const layouts = [];
    if (mobile) for (const size of [{ width: 844, height: 390 }, { width: 480, height: 320 }, { width: 280, height: 640 }]) {
      await page.setViewportSize(size); await advance(.034);
      const layout = await capture(`${size.width}x${size.height}`);
      for (const r of layout.controls) { assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.width <= size.width + 1 && r.y + r.height <= size.height + 1, `${size.width}×${size.height}: ${r.id} offscreen`); }
      layouts.push({ ...size, ...layout });
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
    results.push({ name, ground, hover, roll, descent, flare, landed, layouts, errors, consoleErrors }); await page.close();
  }
  await writeFile(`${out}/results.json`, JSON.stringify({ method: 'Controlled-time real keyboard/touch simulation. No forced altitude/roll after the initial safe driving fixture; not an FPS benchmark.', results }, null, 2));
  console.log('PASS all desktop/touch flight, roll, landing and layouts');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
