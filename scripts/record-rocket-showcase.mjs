import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startServer } from './serve.mjs';

// Inspection capture only: production controls, flight and geometry are unchanged.
const probe = Boolean(process.env.ROCKET_VIDEO_PROBE), landingDemo = Boolean(process.env.ROCKET_LANDING_DEMO);
const rate = 30, frames = landingDemo ? 420 : 360;
const out = path.resolve(process.env.ROCKET_VIDEO_OUT || (probe ? 'output/rocket-showcase-probe' : 'output/rocket-showcase'));
await mkdir(path.join(out, 'frames'), { recursive: true });
const bytes = await readFile('public/assets/roadster.glb');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const server = startServer({ port: 0, root: process.cwd() }); await once(server, 'listening');
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }),
  headless: true,
  args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [],
});
const samples = [], errors = [], consoleErrors = [];
const keys = new Map([[0, ['down', 'KeyW']], [60, ['down', 'KeyF']], [123, ['down', 'KeyE']],
  [130, ['up', 'KeyE']], [165, ['up', 'KeyF']], [255, ['down', 'Space']],
  [276, ['up', 'Space']], [frames - 1, ['up', 'KeyW']]]);
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await page.route('**/public/assets/roadster.glb', route => route.fulfill({ body: bytes, contentType: 'model/gltf-binary' }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /WebGL|THREE|shader/i.test(message.text())) consoleErrors.push(message.text());
  });
  await page.clock.install();
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => document.querySelector('#loadStatus').hidden, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const { RoadRenderer } = await import('./src/world.js');
    window.__rocketRender = RoadRenderer.prototype.render;
    /** Observe the actual run without drawing; the capture explicitly advances CPU animation per sample. */
    RoadRenderer.prototype.render = function (state) { window.__rocketState = state; window.__rocketWorld = this; };
  });
  const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 100));
  await page.locator('#playBtn').click(); await page.clock.runFor(32);
  await page.screenshot({ animations: 'disabled' });
  assert.equal(await page.locator('.scene-shade').evaluate(element => getComputedStyle(element).opacity), '0');
  await page.evaluate(async () => {
    const state = window.__rocketState, world = window.__rocketWorld;
    // One initial safe scenario. No subsequent forced altitude, rotation or speed.
    Object.assign(state, { distance: 125, speed: 26, nitro: 100, flightReady: true,
      nextEvent: Infinity, nextSpawn: Infinity, pickups: [], obstacles: [], roadEvent: null,
      traffic: [{ id: 81, lane: 0, z: 37, speed: 21, kind: 'suv', color: 1, laneChangeCooldown: 1000 },
        { id: 82, lane: 2, z: 70, speed: 23, kind: 'van', color: 0, laneChangeCooldown: 1000 },
        { id: 83, lane: 0, z: 140, speed: 24, kind: 'sedan', color: 5, laneChangeCooldown: 1000 }] });
    const T = await import('./public/vendor/three.js');
    window.__rocketOffset = new T.Vector3(); window.__rocketLook = new T.Vector3();
    world.view = {}; world.time = 0;
    window.__rocketRender.call(world, state, { menu: false, dt: 1 });
    const renderer = world.renderer, original = renderer.render.bind(renderer);
    /** Restore the real entrypoint during rendering, including lazy environment uploads. */
    window.__rocketDraw = () => {
      const previous = renderer.render; renderer.render = original;
      try { renderer.info.reset(); original(world.scene, world.camera); }
      finally { renderer.render = previous; }
    };
    /** Skip intermediate GPU submission only; physics and CPU animation still run. */
    renderer.render = () => {};
    renderer.info.autoReset = false;
    const caption = document.createElement('div'); caption.id = 'rocket-capture-caption';
    caption.style.cssText = 'position:fixed;left:20px;top:82px;max-width:550px;padding:9px 12px;border-radius:10px;background:rgba(12,25,34,.62);color:white;font:14px Arial;z-index:999;pointer-events:none';
    document.body.append(caption);
  });
  const snapshots = new Set([0, 59, 95, 122, 140, 165, 205, 239, 250, 265, 280, 330, frames - 1]);
  for (let frame = 0; frame < frames; frame++) {
    const key = keys.get(frame); if (key) await page.keyboard[key[0]](key[1]);
    await page.clock.runFor(Math.round((frame + 1) * 1000 / rate) - Math.round(frame * 1000 / rate));
    const capture = !probe || snapshots.has(frame);
    /**
     * Animate the actual run, optionally selecting a clearly labelled inspection camera.
     * Camera changes never alter vehicle position, steering, thrust or simulation state.
     * @param {object} options - Capture frame number, rate and GPU submission flag.
     * @returns {object} Real flight/mechanical telemetry for the rendered frame.
     */
    const sample = await page.evaluate(({ frame, rate, capture, landingDemo }) => {
      const state = window.__rocketState, world = window.__rocketWorld;
      window.__rocketRender.call(world, state, { menu: false, dt: 1 / rate });
      let inspection = false;
      if (frame < 60 || (landingDemo ? frame >= 190 : frame >= 240 && frame < 330)) {
        inspection = true;
        const offset = window.__rocketOffset.set(frame < 60 ? 4.4 : 4.7, 2.0, frame < 60 ? -6.0 : 6.4);
        offset.applyQuaternion(world.player.quaternion).add(world.player.position);
        const target = window.__rocketLook.copy(world.player.position); target.y += .65;
        world.camera.position.copy(offset); world.camera.lookAt(target); world.camera.fov = 43;
        world.camera.updateProjectionMatrix();
      }
      const label = frame < 60 ? 'Кузов и убранное крыло' : state.rolling ? 'Боковой оборот'
        : state.altitude > 0 ? (state.landing ? 'Мягкая посадка · крыло пока поднято' : 'Подъём и раскрытие крыла')
        : world.player.userData.aeroDeployment > 0 ? 'Касание земли · крыло складывается'
        : state.boosting ? 'Наземный буст · крыло остаётся убранным' : 'После посадки · крыло полностью убрано';
      document.getElementById('rocket-capture-caption').textContent = label
        + (inspection ? ' · инспекционный ракурс' : '') + ' · запись с управляемым временем';
      if (capture) window.__rocketDraw();
      return { frame, time: (frame + 1) / rate, phase: state.phase, distance: state.distance, speed: state.speed,
        throttle: state.throttle, altitude: state.altitude, verticalSpeed: state.verticalSpeed,
        roll: state.rollAngle, rolling: state.rolling, thrusterPower: state.thrusterPower, boosting: state.boosting,
        nitro: state.nitro, aeroDeployment: world.player.userData.aeroDeployment,
        atlasReady: world.flightEffects.mesh.userData.atlasReady, calls: capture ? world.renderer.info.render.calls : null,
        triangles: capture ? world.renderer.info.render.triangles : null };
    }, { frame, rate, capture, landingDemo });
    samples.push(sample); assert.equal(sample.phase, 'playing'); assert.equal(sample.atlasReady, true);
    if (capture) await page.screenshot({ path: path.join(out, 'frames', String(frame).padStart(4, '0') + '.png') });
    if (frame % 30 === 0) console.log(`frame ${frame}/${frames}: altitude ${sample.altitude.toFixed(2)}, speed ${sample.speed.toFixed(2)}`);
  }
  assert.ok(samples.some(sample => sample.altitude === 3.3));
  assert.ok(samples.some(sample => Math.abs(sample.roll) > 3));
  assert.ok(samples.some(sample => sample.time > 7 && sample.altitude === 0));
  assert.ok(samples.some(sample => sample.boosting && sample.altitude === 0));
  const touchdown = samples.find(sample => sample.time > 7 && sample.altitude === 0);
  assert.ok(samples.some(sample => sample.time > touchdown.time + 1 && sample.aeroDeployment === 0));
  for (const sample of samples.filter(sample => sample.time > touchdown.time + 1))
    assert.equal(sample.aeroDeployment, 0, 'highway speed and boost must not prevent landing stow');
  assert.equal(errors.length, 0); assert.equal(consoleErrors.length, 0);
  await writeFile(path.join(out, 'capture.json'), JSON.stringify({ sha256, bytes: bytes.length,
    assetLockedToCapturedBytes: true, method: `${frames / rate} seconds / 30 fps controlled-time capture, not measured hardware FPS. One initial safe scenario; real W/F/E/Space input and production simulation thereafter. Front/rear inspection cameras are labelled; no model substitution or forced flight pose.`,
    rate, frames, probe, landingDemo, errors, consoleErrors, samples }, null, 2));
  console.log('Verified capture', out);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
