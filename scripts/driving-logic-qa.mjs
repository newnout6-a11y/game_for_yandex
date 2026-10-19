import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

// Isolated production-renderer/input QA. Simulation time is stepped explicitly;
// screenshot throughput is not gameplay FPS. Traffic fixtures are identified below.
const viewsOnly=process.env.QA_MODE==='views';
const out=path.resolve(viewsOnly?'output/driving-final-views':'output/driving-logic-qa');await mkdir(out,{recursive:true});
const source=await readFile('src/main.js','utf8');
const expose=`\nwindow.__drivingQA={get ready(){return assetsReady&&garageScene?.ready},get state(){return game.state},get controls(){return input.read()},get lights(){return renderer.player.userData.highBeams?.lights.map(l=>l.intensity)},get calls(){return {...renderer.renderer.info.render}},async start(){await startRun();Object.assign(game.state,{speed:28,nextSpawn:Infinity,nextEvent:Infinity,traffic:[],pickups:[],obstacles:[],safeCorridor:null});renderer.view={};},step(seconds){for(let i=0;i<Math.round(seconds*120);i++){game.update(1/120,input.read());telemetry?.observe(game.state,1/120);}ui.hud(game.state);return{phase:game.state.phase,x:game.state.x,heading:game.state.heading,speed:game.state.speed,steer:game.state.steerAngle,horn:game.state.hornTime};},draw(front=false){renderer.resize();renderer.render(game.state,{dt:.1,paused:false});if(front){renderer.camera.position.set(4.1,2.2,-5.8);renderer.camera.fov=45;renderer.camera.lookAt(renderer.player.position.x,.65,-.6);renderer.camera.updateProjectionMatrix();renderer.renderer.render(renderer.scene,renderer.camera);}},hornFixture(){clearInput();Object.assign(game.state,{phase:'playing',speed:23,x:1,lane:1,heading:0,steerAngle:0,curvature:0,lateralAcceleration:0,bodyRoll:0,bodyPitch:0,distance:700,hornTime:0,hornCooldown:0,hornHeld:false,hornSerial:0,playerAccelerationBound:8,safeCorridor:null,traffic:[{id:901,kind:'sedan',lane:1,z:85,speed:20,cruiseSpeed:20,color:5,laneChangeCooldown:0,laneDecisionIn:0}]});},async home(){screen='hub';inspection='overview';garageScene.setInspection('overview');applyScreen();refreshGarage();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});garageScene.render(innerWidth,innerHeight,garageFraming());},async mural(tier){screen='garage';tab='style';inspection='overview';await garageScene.setTier(tier);garageScene.setInspection('overview');applyScreen();refreshGarage();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});garageScene.render(innerWidth,innerHeight,garageFraming());}};`;
// Native CDP release differs by Chromium backend: legacy DispatchWebTouchEvent takes
// the lifted points in touchEnd; the synthetic-pointer backend rejects that form.
// Only its explicit validation error permits retrying with the remaining active
// points in touchMove. Releasing every finger still uses touchEnd with [].
async function releaseTouch(cdp,lifted,remaining){
 try{await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[lifted]});}
 catch(error){
  if(!/TouchEnd[^\n]*must not have any touch points/.test(error?.message||''))throw error;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:remaining});
 }
}
async function touchPoint(page,id,pointerId){
 const button=page.locator('#'+id),box=await button.boundingBox();assert.ok(box&&await button.isVisible()&&await button.isEnabled(),id+' is available');
 const viewport=page.viewportSize();assert.ok(box.width>=44&&box.height>=44&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,id+' is a visible 44px touch target');
 const point={x:box.x+box.width/2,y:box.y+box.height/2,id:pointerId};assert.equal(await button.evaluate((node,p)=>node.contains(document.elementFromPoint(p.x,p.y)),point),true,id+' receives real touches');return point;
}
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={method:viewsOnly?'Actual production3D HOME and all four garage murals, isolated synthetic profile, controlled render time; no real accounts, ads or driving fixture.':'Actual production input handlers and renderer, native CDP mobile multitouch arrows/pedals/nitro, isolated synthetic profile, controlled-time CPU integration with selected native PNGs. No real accounts or ads. Horn-yield fixture begins with a sedan85m ahead and a free adjacent lane; no object is moved after initialization except by production simulation.',devices:[],errors:[]};
try{
 for(const [width,height] of (viewsOnly?[[1280,720],[560,315],[844,390]]:[[1280,720],[844,390]])){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:width<900,hasTouch:width<900});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))report.errors.push(m.text());});
  await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));
  await page.addInitScript(profile=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(profile)),createProfile({id:'driving_qa_fixture'}));
  await page.clock.install({time:new Date('2026-10-18T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-18T12:01:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
  const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(()=>window.__drivingQA?.ready))break;await new Promise(r=>setTimeout(r,100));}assert.equal(await page.evaluate(()=>window.__drivingQA?.ready),true);
  if(viewsOnly){
   await page.evaluate(()=>window.__drivingQA.home());
   const buttons=await page.locator('.gs-hub-actions button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{text:node.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,hit:node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};}));
   assert.equal(buttons.length,2);for(const b of buttons){assert.ok(b.width>=44&&b.height>=44&&b.bottom<=height&&b.right<=width&&b.hit);}
   await page.screenshot({path:path.join(out,`home-${width}.png`)});
   if(width>900)for(const tier of [1,2,3,4]){await page.evaluate(tier=>window.__drivingQA.mural(tier),tier);await page.screenshot({path:path.join(out,`mural-tier${tier}.png`)});}
   report.devices.push({viewport:[width,height],buttons});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('VIEW PASS',width);await page.close();continue;
  }
  await page.evaluate(()=>window.__drivingQA.start());
  const device={viewport:[width,height]},cdp=width<900?await page.context().newCDPSession(page):null;
  if(width>900){
   await page.keyboard.down('KeyD');device.turn=await page.evaluate(()=>window.__drivingQA.step(.4));await page.keyboard.up('KeyD');device.release=await page.evaluate(()=>window.__drivingQA.step(.8));
   assert.ok(device.turn.x>1&&device.turn.heading>0);assert.ok((device.release.x-device.turn.x)*3.5<.75);
   await page.keyboard.down('KeyA');device.counter=await page.evaluate(()=>window.__drivingQA.step(.5));await page.keyboard.up('KeyA');assert.ok(device.counter.heading<0);
  }else{
   assert.equal(await page.locator('#app').getAttribute('data-mobile-controls'),'true');
   const gas=await touchPoint(page,'gasBtn',1),right=await touchPoint(page,'rightBtn',2),left=await touchPoint(page,'leftBtn',3),brake=await touchPoint(page,'brakeBtn',4),boost=await touchPoint(page,'boostBtn',5);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[gas,right]});
   device.held=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.held.throttle,1);assert.equal(device.held.steer,1);
   device.turn=await page.evaluate(()=>window.__drivingQA.step(.4));assert.ok(device.turn.x>1&&device.turn.heading>0);
   await releaseTouch(cdp,right,[gas]);device.arrowReleased=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.arrowReleased.steer,0);assert.equal(device.arrowReleased.throttle,1,'Releasing the arrow preserves the gas finger');
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});device.release=await page.evaluate(()=>window.__drivingQA.step(.8));assert.ok((device.release.x-device.turn.x)*3.5<.75);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[gas,left]});device.reverse=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.reverse.steer,-1);assert.equal(device.reverse.throttle,1);device.counter=await page.evaluate(()=>window.__drivingQA.step(.5));assert.ok(device.counter.heading<0);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[brake]});device.brake=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.brake.throttle,0);assert.equal(device.brake.brake,1);
   const speedBeforeBrake=await page.evaluate(()=>window.__drivingQA.state.speed);device.braking=await page.evaluate(()=>window.__drivingQA.step(.25));assert.ok(device.braking.speed<speedBeforeBrake);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});device.released=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.released.steer,0);assert.equal(device.released.throttle,0);assert.equal(device.released.brake,0);
   const beforeBoost=await page.evaluate(()=>({nitro:window.__drivingQA.state.nitro,speed:window.__drivingQA.state.speed}));assert.ok(beforeBoost.speed>5);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[boost]});device.nitroControls=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.nitroControls.throttle,1,'Touch nitro supplies its own gas');assert.equal(device.nitroControls.boost,true);await page.evaluate(()=>window.__drivingQA.step(.5));
   device.nitro=await page.evaluate(()=>({nitro:window.__drivingQA.state.nitro,speed:window.__drivingQA.state.speed,boosting:window.__drivingQA.state.boosting}));assert.equal(device.nitro.boosting,true);assert.ok(device.nitro.nitro<beforeBoost.nitro);assert.ok(device.nitro.speed>beforeBoost.speed);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});device.nitroReleased=await page.evaluate(()=>window.__drivingQA.controls);assert.equal(device.nitroReleased.boost,false);assert.equal(device.nitroReleased.throttle,0);

  }
  await page.evaluate(()=>window.__drivingQA.draw());await page.screenshot({path:path.join(out,`handling-${width}.png`)});
  const horn=await page.locator('#hornBtn').boundingBox();assert.ok(horn&&horn.width>=44&&horn.height>=44);device.hornBounds=horn;
  const hit=await page.evaluate(({x,y})=>document.querySelector('#hornBtn').contains(document.elementFromPoint(x,y)),{x:horn.x+horn.width/2,y:horn.y+horn.height/2});assert.equal(hit,true);
  await page.evaluate(()=>window.__drivingQA.hornFixture());
  if(width>900)await page.keyboard.down('KeyH');else await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[await touchPoint(page,'hornBtn',6)]});
  await page.evaluate(()=>window.__drivingQA.step(1/120));await page.evaluate(width=>window.__drivingQA.draw(width>900),width);
  device.lights=await page.evaluate(()=>window.__drivingQA.lights);assert.equal(device.lights.length,2);assert.ok(device.lights.every(x=>x>0));
  await page.screenshot({path:path.join(out,`horn-${width}.png`)});
  if(width>900)await page.keyboard.up('KeyH');else await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  for(let i=0;i<4;i++)await page.evaluate(()=>window.__drivingQA.step(1));
  device.yield=await page.evaluate(()=>{const s=window.__drivingQA.state,c=s.traffic[0];return{serial:s.hornSerial,phase:s.phase,car:c&&{lane:c.lane,x:c.x,z:c.z,signal:c.signal,reason:c.laneChange?.reason,phase:c.laneChange?.phase},guards:s.trafficDiagnostics.interventions}});
  assert.equal(device.yield.serial,1);assert.equal(device.yield.guards,0);assert.ok(device.yield.car.x<.9||device.yield.car.x>1.1,'safe horn response makes a real lateral maneuver');
  await page.evaluate(()=>window.__drivingQA.draw());await page.screenshot({path:path.join(out,`yield-${width}.png`)});
  await page.evaluate(()=>window.__drivingQA.step(1));await page.evaluate(()=>window.__drivingQA.draw());assert.ok((await page.evaluate(()=>window.__drivingQA.lights)).every(x=>x===0));
  device.render=await page.evaluate(()=>({drawingBuffer:[document.querySelector('#scene').width,document.querySelector('#scene').height],calls:window.__drivingQA.calls}));
  if(width>900){for(const tier of [1,4]){await page.evaluate(tier=>window.__drivingQA.mural(tier),tier);await page.screenshot({path:path.join(out,`mural-tier${tier}.png`)});}}
  report.devices.push(device);await writeFile(path.join(out,`report-${width}.json`),JSON.stringify(device,null,2));console.log('PASS',width,JSON.stringify(device));await page.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
