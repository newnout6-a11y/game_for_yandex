import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { startServer } from './serve.mjs';

const out=path.resolve(process.env.COCKPIT_QA_OUT||'output/cockpit-recovered'),probe=Boolean(process.env.COCKPIT_PROBE);
await mkdir(out,{recursive:true});
const assetBytes=await readFile('public/assets/roadster.glb'),assetSha256=createHash('sha256').update(assetBytes).digest('hex');
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const results=[];
try{
 for(const profile of [{name:'desktop',viewport:{width:1280,height:720},deviceScaleFactor:1},{name:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}]){
  const {name, ...device} = profile;
  const context=await browser.newContext({...device,reducedMotion:'reduce'}),page=await context.newPage(),errors=[],consoleErrors=[];
  await page.route('**/public/assets/roadster.glb',route=>route.fulfill({body:assetBytes,contentType:'model/gltf-binary'}));
  page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))consoleErrors.push(m.text());});
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
  await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js');window.__originalViewRender=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(state){window.__viewWorld=this;window.__viewState=state;};});
  const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+100));
  await page.locator('#playBtn').click();await page.clock.runFor(34);await page.screenshot({animations:'disabled'});
  await page.evaluate(()=>{
   const state=window.__viewState,w=window.__viewWorld;Object.assign(state,{distance:125,speed:26,nitro:100,flightReady:true,nextSpawn:Infinity,nextEvent:Infinity,pickups:[],obstacles:[],roadEvent:null,traffic:[{id:801,kind:'suv',lane:0,z:38,speed:21,color:1,laneChangeCooldown:1000},{id:802,kind:'van',lane:2,z:78,speed:22,color:0,laneChangeCooldown:1000}]});
   w.setQuality('ultra');w.view={};w.time=0;window.__originalViewRender.call(w,state,{dt:1,menu:false});
   const r=w.renderer,draw=r.render.bind(r);window.__viewDraw=()=>{const prior=r.render;r.render=draw;try{r.info.autoReset=false;r.info.reset();w.playerMirrors?.update(w.camera,{dt:0,mode:w.effectiveCameraMode,quality:w.quality,compact:w.compact,force:true});w.rearCameraDisplay?.setTexture(w.effectiveCameraMode==='cockpit'?w.playerMirrors.rightCameraTexture:null);draw(w.scene,w.camera);}finally{r.render=prior;}};r.render=()=>{};
  });
  if(profile.isMobile)await page.locator('#cameraBtn').tap();else await page.keyboard.press('KeyC');await page.clock.runFor(34);
  const capture=async(label,dt=0)=>{
   const sample=await page.evaluate(({label,dt})=>{const w=window.__viewWorld,s=window.__viewState;window.__originalViewRender.call(w,s,{menu:false,dt});window.__viewDraw();return{label,phase:s.phase,speed:s.speed,altitude:s.altitude,rolling:s.rolling,roll:s.rollAngle,requested:w.cameraMode,effective:w.effectiveCameraMode,near:w.camera.near,surface:[w.canvas.width,w.canvas.height],position:w.camera.position.toArray(),overflow:document.documentElement.scrollWidth>innerWidth,tablet:w.cockpitDisplay.telemetry,look:w.lookDirection,lookYaw:w.lookYaw,mirrors:w.playerMirrors.diagnostics};},{label,dt});
   await page.screenshot({path:path.join(out,profile.name+'-'+label+'.png')});return sample;
  };
  const samples=[await capture('drive',1/30)];assert.equal(samples[0].effective,'cockpit');assert.equal(samples[0].near,.03);
  if(!probe){
   const keys=new Map([[0,['down','KeyW']],[10,['down','KeyD']],[16,['up','KeyD']],[20,['down','KeyZ']],[24,['up','KeyZ']],[26,['down','KeyX']],[30,['up','KeyX']],[35,['down','KeyF']],[97,['down','KeyE']],[103,['up','KeyE']],[150,['up','KeyF']],[329,['up','KeyW']]]),shots=new Map([[16,'steer'],[22,'look-left'],[28,'look-right'],[90,'hover'],[113,'roll-comfort'],[148,'recovered'],[275,'landed'],[329,'final']]);
   for(let frame=0;frame<330;frame++){
    const key=keys.get(frame);if(key)await page.keyboard[key[0]](key[1]);await page.clock.runFor(Math.round((frame+1)*1000/30)-Math.round(frame*1000/30));
    const label=shots.get(frame),sample=label?await capture(label,1/30):await page.evaluate(()=>{const w=window.__viewWorld,s=window.__viewState;window.__originalViewRender.call(w,s,{menu:false,dt:1/30});return{phase:s.phase,altitude:s.altitude,rolling:s.rolling,roll:s.rollAngle,requested:w.cameraMode,effective:w.effectiveCameraMode,overflow:document.documentElement.scrollWidth>innerWidth};});
    samples.push(sample);assert.equal(sample.phase,'playing');assert.equal(sample.overflow,false);if(sample.rolling)assert.equal(sample.effective,'chase');
    if(frame%60===0)console.log(profile.name,frame,JSON.stringify(sample));
   }
   assert.ok(samples.some(s=>s.altitude===3.3));assert.ok(samples.some(s=>s.rolling));assert.equal(samples.at(-1).altitude,0);assert.equal(samples.at(-1).effective,'cockpit');
   await page.locator('#pauseBtn').click();await page.clock.runFor(250);assert.equal(await page.locator('#overlay').evaluate(el=>el.hidden),false);
   const before=await page.evaluate(()=>window.__viewWorld.cameraMode);await page.keyboard.press('KeyC');await page.clock.runFor(34);assert.equal(await page.evaluate(()=>window.__viewWorld.cameraMode),before,'modal C must not change view');
   await page.locator('#pauseCameraBtn').click();await page.clock.runFor(34);assert.equal(await page.evaluate(()=>window.__viewWorld.cameraMode),'chase');
   await capture('paused-chase');await page.locator('#pauseCameraBtn').click();await page.clock.runFor(34);assert.equal(await page.evaluate(()=>window.__viewWorld.cameraMode),'cockpit');await capture('paused-cockpit');
   await page.clock.resume();await page.addScriptTag({content:await readFile('node_modules/axe-core/axe.min.js','utf8')});
   const violations=await page.evaluate(async()=>{const r=await axe.run('#dialog',{runOnly:['aria-valid-attr','aria-valid-attr-value','button-name','label']});return r.violations;});assert.deepEqual(violations,[]);
  }else await page.clock.resume();
  await page.reload();await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);await page.locator('#playBtn').click();assert.equal(await page.locator('#cameraBtn').getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);results.push({name:profile.name,samples,errors,consoleErrors,persistence:true});await context.close();
 }
 await writeFile(path.join(out,'qa.json'),JSON.stringify({assetSha256,method:'Actual C/touch/pause controls and production camera; one initial safe scenario followed by real keyboard flight/roll. Controlled time, not measured hardware FPS.',results},null,2));console.log('Cockpit verification passed',out);
}finally{await browser.close();await new Promise(r=>server.close(r));}
