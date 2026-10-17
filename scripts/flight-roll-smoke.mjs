import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './serve.mjs';
const out = process.env.FLIGHT_QA_OUT || 'output/flight-roll-qa'; await mkdir(out, { recursive: true });
const root = path.resolve(process.env.FLIGHT_QA_ROOT || process.cwd());
const playerBytes = await readFile(path.join(root,'public/assets/roadster.glb'));
const playerSha256 = createHash('sha256').update(playerBytes).digest('hex');
const server = startServer({ port: 0, root }); await once(server, 'listening');
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true,
  args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [] });
const results = [];
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 844 }]].filter(([name]) => !process.env.FLIGHT_QA_PROFILE || process.env.FLIGHT_QA_PROFILE === name)) {
    const mobile = name === 'mobile';
    const page = await browser.newPage({ viewport, deviceScaleFactor: mobile ? 2 : 1, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    // Fix one exact authoring candidate across all profiles while a later export may be running.
    await page.route('**/public/assets/roadster.glb',route=>route.fulfill({body:playerBytes,contentType:'model/gltf-binary'}));
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
      /** Observe live state/world without drawing; the test explicitly advances the saved animation/render method. */ RoadRenderer.prototype.render = function (state) { window.__s = state; window.__w = this; };
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
      /**
       * Draw using the saved GPU method while preserving nested renderer calls.
       * Temporarily restores the real renderer entrypoint for lazy background uploads,
       * and restores the prior method even when rendering throws.
       * @param {...*} args - Arguments forwarded to the bound WebGL renderer.
       * @returns {*} Original renderer return value.
       */
      window.__drawGpu = (...args) => {
        // Lazy background-to-cubemap uploads call renderer.render internally.
        // Keep that entry point real while drawing, not the CPU-only stub.
        const previous = renderer.render; renderer.render = rawGpu;
        try { return rawGpu(...args); } finally { renderer.render = previous; }
      };
      // Warm all lazy background/material GPU resources before CPU-only stepping.
      window.__captureRender.call(window.__w, window.__s, { menu: false, dt: 1 });
      /** Suppress intermediate GPU draws while leaving real game physics and CPU scene updates intact. */ renderer.render = () => {}; // Simulate every frame, draw only requested snapshots.
    });
    /**
     * Advance real input-driven simulation at approximately 30 capture steps/second.
     * Rounded millisecond clock increments sum to the requested time; CPU animation
     * uses seconds/frames while GPU draws remain suppressed between snapshots.
     * @param {number} seconds - Simulated time, not a physical-device performance sample.
     */
    const advance = async seconds => {
      const frames = Math.ceil(seconds * 30);
      for (let i = 0; i < frames; i++) {
        await page.clock.runFor(Math.round((i + 1) * seconds * 1000 / frames) - Math.round(i * seconds * 1000 / frames));
        await page.evaluate(dt => { window.__w.renderer.info.reset(); window.__captureRender.call(window.__w, window.__s, { menu: false, dt }); }, seconds / frames);
      }
    };
    /**
     * Draw the current scene/HUD and capture flight state, render counters and layout.
     * Asserts playing state, no horizontal overflow and decoded smoke atlas before
     * saving a profile-labelled PNG. Does not force altitude, roll or particle output.
     * @param {string} label - Snapshot stage used in the output filename.
     * @returns {Promise<object>} State/layout telemetry measured at the captured pose.
     */
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
    /**
     * Hold or release gas, flight, boost or right roll through real UI input handlers.
     * Mobile uses one independent pointer ID per action; desktop uses W, F or E.
     * @param {string} action - One of 'gas', 'flight', 'boost' or 'roll'.
     * @param {boolean} down - Whether to press rather than release the control.
     */
    const key = async (action, down) => {
      if (mobile) {
        const ids = { gas: ['gasBtn', 1], flight: ['flightBtn', 2], roll: ['rollRightBtn', 3], boost: ['boostBtn', 4] };
        const [id, pointerId] = ids[action];
        await page.locator('#' + id).dispatchEvent(down ? 'pointerdown' : 'pointerup', { pointerId, pointerType: 'touch' });
      } else await page.keyboard[down ? 'down' : 'up']({ gas: 'KeyW', flight: 'KeyF', roll: 'KeyE', boost: 'Space' }[action]);
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
    let boost;
    if (process.env.CAPTURE_ROCKET_BOOST) {
      await key('boost', true); await advance(.35);
      assert.equal(await page.evaluate(() => window.__s.boosting), true);
      await page.evaluate(() => {
        const w=window.__w,c=w.camera;
        window.__boostCamera={p:c.position.clone(),q:c.quaternion.clone()};
        c.position.set(4.6,2.2,7.8);c.lookAt(w.player.position.x,.65,0);
      });
      boost=await capture('boost-inspection');
      await page.evaluate(() => {const c=window.__w.camera;c.position.copy(window.__boostCamera.p);c.quaternion.copy(window.__boostCamera.q);});
      await key('boost',false);
    }
    const layouts = [];
    if (mobile) for (const size of [{ width: 844, height: 390 }, { width: 480, height: 320 }, { width: 280, height: 640 }]) {
      await page.setViewportSize(size); await advance(.034);
      const layout = await capture(`${size.width}x${size.height}`);
      for (const r of layout.controls) { assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.width <= size.width + 1 && r.y + r.height <= size.height + 1, `${size.width}×${size.height}: ${r.id} offscreen`); }
      layouts.push({ ...size, ...layout });
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
    results.push({ name, ground, hover, roll, descent, flare, landed, boost, layouts, errors, consoleErrors }); await page.close();
  }
  await writeFile(`${out}/results.json`, JSON.stringify({ playerSha256, assetLockedToCapturedBytes:true, method: 'Controlled-time real keyboard/touch simulation. No forced altitude/roll after the initial safe driving fixture; not an FPS benchmark.', results }, null, 2));
  console.log('PASS all desktop/touch flight, roll, landing and layouts');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
