import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './serve.mjs';

// Capture harness only. Production files and mechanics are unchanged.
// One safe initial traffic/fuel fixture; all later actions are actual key events.
const probe=Boolean(process.env.MOTION_PROBE);
const out = path.resolve(probe?'output/wheel-motion-review':'output/gameplay-wheel-motion');
await mkdir(out + '/frames', { recursive: true });
const server = startServer({ port: 0, root: process.cwd() });
await once(server, 'listening');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const samples = [], errors = [], consoleErrors = [];
const keyEvents = new Map([[0,['down','KeyW']],[45,['up','KeyW']]]);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /WebGL|THREE|shader/i.test(m.text())) consoleErrors.push(m.text()); });
  await page.clock.install();
  console.log('Loading latest production source');
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => document.querySelector('#loadStatus').hidden, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const { RoadRenderer } = await import('./src/world.js');
    window.__captureRender = RoadRenderer.prototype.render;
    RoadRenderer.prototype.render = function (state) { window.__driveState = state; window.__testWorld = this; };
  });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 10000));
  await page.locator('#playBtn').click();
  await page.clock.runFor(32);
  await page.screenshot({ animations: 'disabled' }); // Finish the menu-to-HUD fade before recording.
  assert.equal(await page.locator('.scene-shade').evaluate(e => getComputedStyle(e).opacity), '0');
  await page.evaluate(() => {
    const s = window.__driveState;
    Object.assign(s, { distance: 700, elapsed: 0, score: 0, speed: 18, nitro: 100,
      x: 1, heading: 0, steerAngle: 0, acceleration: 0, altitude: 0, flying: false,
      nextSpawn: Infinity, nextEvent: Infinity, pickups: [], obstacles: [], roadEvent: null });
    s.traffic = [
      {id:801,lane:0,z:27,speed:23,cruiseSpeed:28,kind:'semi',color:1},
      {id:802,lane:0,z:65,speed:18,cruiseSpeed:18,kind:'boxtruck',color:3},
      {id:803,lane:2,z:13,speed:22,cruiseSpeed:27,kind:'sedan',color:5},
      {id:804,lane:2,z:46,speed:18,cruiseSpeed:18,kind:'van',color:0},
      {id:805,lane:0,z:108,speed:20,cruiseSpeed:20,kind:'towtruck',color:3},
      {id:806,lane:2,z:130,speed:21,cruiseSpeed:21,kind:'firetruck',color:0},
      {id:807,lane:0,z:163,speed:22,cruiseSpeed:22,kind:'suv',color:4},
      {id:808,lane:2,z:184,speed:22,cruiseSpeed:22,kind:'hatch',color:2},
    ];
    const label=document.createElement('div');label.id='capture-caption';label.style.cssText='position:fixed;left:26px;bottom:155px;padding:10px 15px;border-radius:12px;background:rgba(20,32,40,.62);color:white;font:16px Arial;z-index:999;pointer-events:none';document.body.append(label);
    window.__testWorld.time = 0; window.__testWorld.view = {};
    window.__captureRender.call(window.__testWorld, s, { menu: false, dt: 1 });
    window.__rawDraw=window.__testWorld.renderer.render.bind(window.__testWorld.renderer);
  });
  if(probe)await page.evaluate(()=>{window.__testWorld.renderer.render=()=>{};});
  for (let frame = 0; frame < 360; frame++) {
    const event = keyEvents.get(frame);
    if (event) await page.keyboard[event[0]](event[1]);
    // 33/34 ms controlled increments average exactly 30 snapshots per second.
    const elapsed = Math.round((frame + 1) * 1000 / 30) - Math.round(frame * 1000 / 30);
    await page.clock.runFor(elapsed);
    const state = await page.evaluate(({frame,capture}) => {
      const s = window.__driveState,w=window.__testWorld;
      window.__captureRender.call(w,s,{menu:false,dt:1/30});
      const focus=w.traffic.get(frame<180?803:801),label=document.getElementById('capture-caption');
      if(frame>=90&&frame<270&&focus){
        w.camera.fov=42;w.camera.updateProjectionMatrix();
        const length=focus.userData.length;
        w.camera.position.set(focus.position.x+(frame<180?1:-1)*(length*.8+4),3.3,focus.position.z+length*.55+2);
        w.camera.lookAt(focus.position.x,1.25,focus.position.z);
        w.renderer.render(w.scene,w.camera);
      }
      label.textContent=frame<90||frame>=270?'Обычная игровая камера · движение потока' + (frame>=45?' · газ отпущен':' · разгон'):frame<180?'Обзор движения: седан · торможение и подвеска':'Обзор движения: фура · сцепка и колёса';
      if(capture)window.__rawDraw(w.scene,w.camera);
      return {elapsed:s.elapsed,distance:s.distance,speed:s.speed,phase:s.phase,
        traffic:s.traffic.map(t=>{const c=w.traffic.get(t.id);return {id:t.id,kind:t.kind,z:t.z,speed:t.speed,acceleration:t.acceleration,travelDistance:t.travelDistance,trailerAngle:t.trailerAngle,pitch:c?.userData.motion.pitch,roll:c?.userData.motion.roll,wheelSpin:c?.userData.wheels[0].rotation.x,steer:c?.userData.wheels[0].rotation.y};})};
    },{frame,capture:probe&&[0,89,120,180,240,359].includes(frame)});
    assert.equal(state.phase, 'playing');
    samples.push({ frame, videoSeconds: frame / 30, ...state });
    if(!probe||[0,89,120,180,240,359].includes(frame))await page.screenshot({ path: `${out}/frames/${String(frame).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (frame % 30 === 29) {
      console.log(`Captured ${frame + 1}/360 frames; ${(frame + 1) / 30}s; traffic=${state.traffic.length}`);
      await writeFile(out + '/progress.json', JSON.stringify({ frames: frame + 1, total: 360, ...state }, null, 2));
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  assert.ok(samples.every(s=>s.traffic.some(t=>t.id===801)),'semi remains present for whole clip');
  assert.ok(samples.some(s=>s.traffic.some(t=>t.acceleration<-.5)),'actual following braking');
  assert.ok(samples.some(s=>s.traffic.some(t=>Math.abs(t.pitch)>.002)),'load transfer visible in telemetry');
  const report={method:'12 seconds at 30 fps controlled-time capture of production simulation. Safe initial traffic fixture; W held for 1.5 seconds then released. First and last three seconds use normal gameplay camera; middle six seconds use labeled sedan and semi inspection cameras only. No per-frame vehicle state or animation is forced. Not hardware FPS.',frames:samples.length,fps:30,viewport:[1280,720],errors,consoleErrors,samples};
  await writeFile(out+'/telemetry.json',JSON.stringify(report,null,2));
  console.log('PASS motion recording',samples.length);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
