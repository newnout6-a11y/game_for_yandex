import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './serve.mjs';

// Capture harness only. Production files and mechanics are unchanged.
// One safe initial traffic/fuel fixture; all later actions are actual key events.
const probe=Boolean(process.env.MOTION_PROBE);
const out = path.resolve(probe?'output/steering-clearance-review':'output/gameplay-steering-clearance');
await mkdir(out + '/frames', { recursive: true });
const server = startServer({ port: 0, root: process.cwd() });
await once(server, 'listening');
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? {executablePath:process.env.CHROME_BIN} : {channel:'chrome'}), headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
});
const samples = [], errors = [], consoleErrors = [];
const keyEvents = new Map([[0,['down','KeyW']],[119,['up','KeyW']]]);
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
      x: 2, lane:2, safeLane:2, heading: 0, steerAngle: 0, acceleration: 0, altitude: 0, flying: false,
      nextSpawn: Infinity, nextEvent: Infinity, pickups: [], obstacles: [], roadEvent: null });
    s.traffic = [
      {id:901,lane:1,z:34,speed:22,cruiseSpeed:25,kind:'sedan',color:5,laneChangeCooldown:1,laneDecisionIn:0},
      {id:902,lane:1,z:61,speed:15,cruiseSpeed:15,kind:'boxtruck',color:3},
      {id:903,lane:1,z:300,speed:20,cruiseSpeed:23,kind:'semi',color:1,laneChangeCooldown:4,laneDecisionIn:0},
      {id:904,lane:1,z:340,speed:13,cruiseSpeed:13,kind:'firetruck',color:0},
    ];
    const label=document.createElement('div');label.id='capture-caption';label.style.cssText='position:fixed;left:26px;top:88px;height:max-content;padding:10px 15px;border-radius:12px;background:rgba(20,32,40,.62);color:white;font:16px Arial;z-index:999;pointer-events:none';document.body.append(label);
    window.__testWorld.time = 0; window.__testWorld.view = {};
    window.__captureRender.call(window.__testWorld, s, { menu: false, dt: 1 });
    window.__rawDraw=window.__testWorld.renderer.render.bind(window.__testWorld.renderer);
  });
  await page.evaluate(async()=>{
    window.__testWorld.renderer.render=()=>{};
    const T=await import('./public/vendor/three.js'),traffic=await import('./src/traffic.js'),physics=await import('./src/traffic-physics.js');
    window.__T=T;window.__traffic=traffic;window.__physics=physics;
    const w=window.__testWorld,scene=new T.Scene();scene.background=new T.Color('#b8cbd3');scene.environment=w.scene.environment;scene.environmentIntensity=w.scene.environmentIntensity;
    scene.add(new T.HemisphereLight('#dcecff','#a6a393',1.55));const sun=new T.DirectionalLight('#fff8ee',2.35);sun.position.set(-12,25,-10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:1,far:90});scene.add(sun,sun.target);
    const floor=new T.Mesh(new T.PlaneGeometry(180,180),new T.MeshStandardMaterial({color:'#80918c',roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.012;floor.receiveShadow=true;scene.add(floor);
    const grid=new T.GridHelper(120,60,'#99aaa5','#99aaa5');grid.position.y=-.008;scene.add(grid);
    const car=traffic.createTrafficCar('semi','#376684');scene.add(car);
    const paths=[];for(const color of ['#1c6cbd','#d7962b']){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(240*3),3));geometry.setDrawRange(0,0);const line=new T.Line(geometry,new T.LineBasicMaterial({color}));line.frustumCulled=false;scene.add(line);paths.push(line);}
    window.__turn={scene,car,paths,item:{kind:'semi',lane:1,x:1,z:0,speed:3,heading:0,travelDistance:0,acceleration:0,laneCurvature:1/16,lateralAcceleration:9/16,signal:1,signalTime:1},theta:0};
  });
  for (let frame = 0; frame < 360; frame++) {
    const event = keyEvents.get(frame);
    if (event) await page.keyboard[event[0]](event[1]);
    // 33/34 ms controlled increments average exactly 30 snapshots per second.
    const elapsed = Math.round((frame + 1) * 1000 / 30) - Math.round(frame * 1000 / 30);
    await page.clock.runFor(elapsed);
    const state = await page.evaluate(({frame,capture}) => {
      const s = window.__driveState,w=window.__testWorld;
      window.__captureRender.call(w,s,{menu:false,dt:1/30});
      const T=window.__T,label=document.getElementById('capture-caption');let turnMetrics=null;
      if(frame<120){
        const focus=w.traffic.get(frame<120?901:903);
        if(frame>=30&&focus){
          if(frame<120){const p=focus.getObjectByName('steering_wheel').getWorldPosition(new T.Vector3());w.camera.fov=34;w.camera.position.copy(p).add(new T.Vector3(.25,.45,-1.65).applyQuaternion(focus.quaternion));w.camera.lookAt(p.clone().add(new T.Vector3(0,.18,.35).applyQuaternion(focus.quaternion)));}
          else{w.camera.fov=48;w.camera.position.set(focus.position.x+14,7,focus.position.z+9);w.camera.lookAt(focus.position.x,1.3,focus.position.z);}
          w.camera.updateProjectionMatrix();
        }
        document.getElementById('hud').style.visibility=frame>=30?'hidden':'visible';
        label.textContent=frame<30?'Обычный игровой вид · разгон':frame<120?'Игровая симуляция · водитель, рычажок поворотника и руки на руле':'Игровая симуляция · фура на плавном перестроении';
        if(capture)window.__rawDraw(w.scene,w.camera);
      }else{
        const turn=window.__turn,car=turn.car,item=turn.item,P=window.__physics;
        const side=frame<240?1:-1,R=12,v=3.5;
        const step=()=>{
          const t=turn.age,u=Math.min(1,t),ramp=u*u*(3-2*u),k=side*ramp/R,dt=1/120;
          turn.heading+=v*k*dt;turn.rearX+=v*Math.sin(turn.heading)*dt;turn.rearZ-=v*Math.cos(turn.heading)*dt;
          item.x=1+turn.rearX/3.5;item.z=-3.965-turn.rearZ;item.heading=turn.heading;item.speed=v;item.travelDistance=v*t;item.laneCurvature=k;item.lateralAcceleration=v*v*k;item.signal=side;item.signalTime=1+t;
          P.updateTrailerKinematics(item,-385,dt);turn.age+=dt;
        };
        if(turn.side!==side){turn.side=side;turn.age=0;turn.heading=0;turn.rearX=0;turn.rearZ=0;delete item.trailerState;delete item.trailerAngle;item.trailerTravelDistance=0;window.__traffic.resetTrafficMotion(car);for(const p of turn.paths)p.geometry.setDrawRange(0,0);}
        for(let i=0;i<4;i++)step();
        const pose=P.trafficPose(item,-385);car.position.set(pose.x,car.userData.groundY,pose.z);car.rotation.y=pose.yaw;car.userData.trailer.rotation.y=P.trailerYaw(item,-385);window.__traffic.animateTrafficCar(car,item,-385,1/30);car.updateMatrixWorld(true);
        const state=item.trailerState,index=(frame-120)%120;for(const [i,p]of turn.paths.entries()){const a=p.geometry.attributes.position;a.setXYZ(index,i?state.axleX:state.hitchX,.035,i?state.axleZ:state.hitchZ);a.needsUpdate=true;p.geometry.setDrawRange(0,index+1);}
        w.camera.fov=43;w.camera.updateProjectionMatrix();const joint=new T.Vector3(state.hitchX,1.4,state.hitchZ);
        const offset=frame<240?new T.Vector3(12,7,-8):new T.Vector3(-8,19,8);offset.applyAxisAngle(new T.Vector3(0,1,0),pose.yaw);w.camera.position.copy(joint).add(offset);w.camera.lookAt(joint);
        label.textContent=frame<240?'Медленный правый поворот · видны управляемые колёса и свободная сцепка':'Медленный левый поворот · прицеп идёт по своей траектории';
        document.getElementById('hud').style.visibility='hidden';
        if(capture)window.__rawDraw(turn.scene,w.camera);
        turnMetrics={frontWheel:car.getObjectByName('wheel_fr').rotation.y,side,angle:item.trailerAngle,hitch:[state.hitchX,state.hitchZ],axle:[state.axleX,state.axleZ],axleDistance:Math.hypot(state.hitchX-state.axleX,state.hitchZ-state.axleZ),wheelDistance:item.trailerTravelDistance};
      }
      return {turn:turnMetrics,elapsed:s.elapsed,distance:s.distance,speed:s.speed,phase:s.phase,
        traffic:s.traffic.map(t=>{const c=w.traffic.get(t.id);return {id:t.id,kind:t.kind,z:t.z,speed:t.speed,acceleration:t.acceleration,x:t.x,heading:t.heading,signal:t.signal,lateralAcceleration:t.lateralAcceleration,laneChange:t.laneChange?.phase,travelDistance:t.travelDistance,trailerAngle:t.trailerAngle,pitch:c?.userData.motion.pitch,roll:c?.userData.motion.roll,gripError:c?.userData.driver?.maxGripError,gesture:c?.userData.driver?.wheel.userData.stalkGesture,steeringWheel:c?.userData.driver?.wheel.userData.angle,wheelSpin:c?.userData.wheels[0].rotation.x,steer:c?.userData.wheels[0].rotation.y};})};
    },{frame,capture:!probe||[0,35,40,60,90,119,120,150,210,239,240,300,359].includes(frame)});
    assert.equal(state.phase, 'playing');
    samples.push({ frame, videoSeconds: frame / 30, ...state });
    if(!probe||[0,35,40,60,90,119,120,150,210,239,240,300,359].includes(frame))await page.screenshot({ path: `${out}/frames/${String(frame).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (frame % 30 === 29) {
      console.log(`Captured ${frame + 1}/360 frames; ${(frame + 1) / 30}s; traffic=${state.traffic.length}`);
      await writeFile(out + '/progress.json', JSON.stringify({ frames: frame + 1, total: 360, ...state }, null, 2));
    }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  assert.ok(samples.every(s=>s.traffic.some(t=>t.id===903)),'semi remains present for whole clip');
  assert.ok(samples.some(s=>s.traffic.some(t=>t.acceleration<-.5)),'actual following braking');
  assert.ok(samples.some(s=>s.traffic.some(t=>Math.abs(t.pitch)>.002)),'load transfer visible in telemetry');
  assert.ok(samples.some(s=>s.traffic.some(t=>t.id===901&&t.laneChange)),'sedan begins actual planned lane change');
  assert.ok(samples.some(s=>s.turn&&Math.abs(s.turn.angle)>.3),'slow turn reveals independent trailer heading');
  assert.ok(samples.every(s=>!s.turn||Math.abs(s.turn.axleDistance-8.995)<1e-8),'fixed kingpin-to-bogie distance');
  assert.ok(samples.some(s=>s.traffic.some(t=>t.gesture>.9)),'actual stalk tap');
  assert.ok(samples.every(s=>s.traffic.every(t=>!(t.gripError>1e-4))),'hands stay attached to their targets');
  assert.ok(samples.some(s=>s.turn&&s.turn.frontWheel>.15)&&samples.some(s=>s.turn&&s.turn.frontWheel<-.15),'front wheels visibly steer in both directions');
  const report={method:'12 seconds at 30 fps controlled-time capture, not device FPS. First 4 seconds use production game simulation, a safe initial traffic fixture and actual W key; driver close-ups are inspection cameras. Last 8 seconds show right and left slow turns using the production rear-axle body pose, Ackermann wheel angles and hitch/axle solver with final Blender semi. Prescribed 3.5 m/s; curvature smoothly increases from straight to a 12 m rear-axle radius during the first second of each direction. Paths are kingpin (blue) and trailer bogie (amber). Not a new game mode or full rigid-body simulator',frames:samples.length,fps:30,viewport:[1280,720],errors,consoleErrors,samples};
  await writeFile(out+'/telemetry.json',JSON.stringify(report,null,2));
  console.log('PASS motion recording',samples.length);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
