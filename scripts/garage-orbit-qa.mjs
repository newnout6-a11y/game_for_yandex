import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

/** Capture actual workshop UI and pointer orbit from an isolated local inspection save, without cloud or economy writes. */
const root=path.resolve(process.env.ORBIT_QA_ROOT||'.'),label=process.env.ORBIT_QA_LABEL||'after',out=path.resolve(process.env.ORBIT_QA_OUT||`output/garage-orbit-${label}`);await mkdir(out,{recursive:true});
const materialsOnly=process.env.ORBIT_MATERIAL_ONLY==='1',screenVideo=process.env.ORBIT_SCREEN_VIDEO==='1';
const screenFixture=process.env.ORBIT_SCREEN_FIXTURE?await readFile(process.env.ORBIT_SCREEN_FIXTURE):null;
const source=await readFile(path.join(root,'src/main.js'),'utf8');
const fixture=createProfile({id:'orbit_geometry_inspection'});fixture.garage.level=1;fixture.wallet.credits=20000;fixture.ownedVehicles=['rocket','hatch','sedan','suv','van'];
const expose=`\nwindow.__orbitQA={get ready(){return assetsReady&&garageScene?.ready},get garage(){return garageScene},get blocked(){return orientationBlocked},get lifecycle(){return lifecycle},async setTier(t){while(profileStore.get().garage.level<t){const result=profileStore.dispatch({type:'UPGRADE_GARAGE'});if(!result.ok)throw new Error(result.reason);}await garageScene.setTier(t);refreshGarage();},draw(settle=true){renderer.resize();if(settle)garageScene.advance(2,{visible:true,reducedMotion:true});const r=renderer.renderer;r.info.autoReset=false;r.info.reset();garageScene.render(innerWidth,innerHeight,garageFraming());const g=garageScene,c=g.camera,v=g.vehicle;const info={inspection:g.inspection,tier:g.tier,camera:c.position.toArray(),quaternion:c.quaternion.toArray(),yaw:g.yaw,pitch:g.pitch,fov:c.fov,near:c.near,vehicle:v.position.toArray(),vehicleQuaternion:v.quaternion.toArray(),css:[innerWidth,innerHeight],buffer:[r.domElement.width,r.domElement.height],region:garageFraming(),calls:r.info.render.calls,triangles:r.info.render.triangles};r.info.autoReset=true;return info;}};`;
const server=startServer({root,port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={label,screenContent:screenFixture?'Original local decoder-test fixture, not the final requested official video':'Full user-supplied Tesla Kickflip video and matching poster, silent stream copy',method:'Actual production UI and pointer gestures. Isolated local inventory, native PNG, controlled render clock. No real-device FPS claim.',frames:[],errors:[]};
/** Wait for a real asynchronous asset boundary while the browser's animation clock is controlled. */
async function wait(page,fn){const until=Date.now()+180000;while(Date.now()<until){if(await page.evaluate(fn))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Garage orbit readiness timeout');}
/** Write each frame's measured eye/projection/buffer and save a progressively durable report. */
async function shot(page,name,settle=true){const data=await page.evaluate(s=>window.__orbitQA.draw(s),settle);data.screen=await page.evaluate(()=>{const s=window.__orbitQA.garage.screenDisplay;if(!s)return null;const v=s.video;return {onScreen:s.onScreen,active:s.active,failed:s.failed,frameChanges:s.frameChanges,paused:v?.paused??true,currentTime:v?.currentTime??0,readyState:v?.readyState??0,muted:v?.muted??null,videoMap:s.material?.map===s.videoTexture,loop:v?.loop??null};});data.surfaceMaps=await page.evaluate(()=>{const result=[],seen=new Set();window.__orbitQA.garage.room.traverse(node=>{for(const material of Array.isArray(node.material)?node.material:[node.material])if(material&&!seen.has(material)&&/architectural concrete|mottled concrete/i.test(material.name)){seen.add(material);const row={material:material.name,normalScale:material.normalScale?.toArray(),roughness:material.roughness,maps:{}};for(const key of ['map','normalMap','roughnessMap']){const texture=material[key];if(texture)row.maps[key]={name:texture.name,width:texture.image?.width,height:texture.image?.height,anisotropy:texture.anisotropy,minFilter:texture.minFilter};}result.push(row);}});return result;});await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});if(process.env.ORBIT_SURFACE_CROPS==='1'&&name==='desktop-tier1-rear'){for(const [part,clip] of [['wall',{x:255,y:145,width:390,height:145}],['floor',{x:360,y:635,width:690,height:100}]])await page.screenshot({path:path.join(out,name+'-'+part+'-native-crop.png'),clip,timeout:180000});}report.frames.push({name,...data});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name,JSON.stringify(data));return data;}
/** Exercise the actual canvas pointer handlers, staying clear of the menu overlays. */
async function drag(page,dx,dy=0,mobile=false){const r=await page.evaluate(()=>window.__orbitQA.draw().region);const x=r.x+r.width*.5,y=r.y+r.height*.5;if(mobile){const session=await page.context().newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=8;step++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/8,y:y+dy*step/8}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();}else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();}}
/** Decode the actual local film and inspect frames plus independent lifecycle stops; no ad or media success is mocked. */
async function inspectScreenPlayback(page,device){
 const tick=()=>page.evaluate(()=>{const q=window.__orbitQA;const changed=q.garage.advance(1/12,{visible:true,reducedMotion:false,mediaActive:!q.lifecycle.paused});q.draw(false);return changed;});
 const state=()=>page.evaluate(()=>{const s=window.__orbitQA.garage.screenDisplay,v=s.video;return {onScreen:s.onScreen,active:s.active,paused:v?.paused??true,time:v?.currentTime??0,ready:v?.readyState??0,failed:s.failed,frames:s.frameChanges,videoMap:s.material?.map===s.videoTexture};});
 await tick();await wait(page,()=>{const s=window.__orbitQA.garage.screenDisplay;return s.failed||s.video?.readyState>=2&&!s.video.paused;});
 let first=await state();assert.equal(first.failed,false);assert.equal(first.paused,false);assert.equal(first.onScreen,true);
 await tick();await shot(page,device+'-tv-playing-a',false);
 await new Promise(resolve=>setTimeout(resolve,750));await tick();await shot(page,device+'-tv-playing-b',false);
 const playing=await state();assert.ok(playing.frames>=2);assert.equal(playing.videoMap,true);
 if(!screenFixture){
  await page.evaluate(()=>{window.__orbitQA.garage.screenDisplay.video.currentTime=14.2;});await wait(page,()=>{const v=window.__orbitQA.garage.screenDisplay.video;return !v.seeking&&v.readyState>=2;});assert.ok(Math.abs((await state()).time-14.2)<2,'Real decoder seeks to supplied stunt');await tick();await shot(page,device+'-tv-stunt',false);
  await page.evaluate(()=>{const v=window.__orbitQA.garage.screenDisplay.video;v.currentTime=v.duration-.5;});await wait(page,()=>{const v=window.__orbitQA.garage.screenDisplay.video;return !v.seeking&&v.currentTime>v.duration-1;});await wait(page,()=>{const v=window.__orbitQA.garage.screenDisplay.video;return !v.paused&&!v.seeking&&v.currentTime<2;});
  report.actualFullVideoLoop=true;
 }

 await page.evaluate(()=>window.__orbitQA.lifecycle.pause('platform'));const stopped=await state();assert.equal(stopped.paused,true);
 await new Promise(resolve=>setTimeout(resolve,200));assert.ok(Math.abs((await state()).time-stopped.time)<.05,'Platform pause stops the real decoder');
 await page.evaluate(()=>window.__orbitQA.lifecycle.pause('ad'));await page.evaluate(()=>window.__orbitQA.lifecycle.resume('platform'));await tick();assert.equal((await state()).paused,true,'One resume cannot release another pause owner');
 await page.evaluate(()=>window.__orbitQA.lifecycle.resume('ad'));await tick();await wait(page,()=>!window.__orbitQA.garage.screenDisplay.video.paused);
 await page.evaluate(()=>window.__orbitQA.garage.advance(0,{visible:true,reducedMotion:true}));assert.equal((await state()).paused,true);assert.equal((await state()).videoMap,false);
 await page.locator('[data-gs-focus="inspectVehicle:overview"]:visible').click();await page.evaluate(()=>window.__orbitQA.draw());await tick();assert.equal((await state()).onScreen,false);assert.equal((await state()).paused,true,'Front overview does not decode a rear-wall film');
 await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();await page.evaluate(()=>window.__orbitQA.draw());
 report.screenPlayback||=[];report.screenPlayback.push({device,playing,platformPause:true,independentPauseOwners:true,reducedMotionPoster:true,offscreenPause:true,method:'Real local MP4 decoder; controlled scene clock, wall-time media; not a real-device FPS benchmark.'});
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
try{
 for(const [device,viewport,mobile] of [['desktop',{width:1440,height:900},false],['mobile',{width:844,height:390},true]]){
  if(process.env.ORBIT_DEVICE&&process.env.ORBIT_DEVICE!==device)continue;
  const page=await browser.newPage({viewport,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,reducedMotion:screenVideo?'no-preference':'reduce'});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  if(screenFixture){
   await page.route('**/roadster-screen-loop.mp4',r=>r.fulfill({body:screenFixture,contentType:'video/mp4'}));
   await page.route('**/src/garage-screen-media.js',r=>r.fulfill({body:`export const GARAGE_SCREEN_MEDIA={status:'local-decoder-fixture-only',poster:new URL('../public/assets/garage/roadster-screen-poster.jpg',import.meta.url).href,video:new URL('../public/assets/garage/roadster-screen-loop.mp4',import.meta.url).href};`,contentType:'text/javascript'}));
  }
  await page.route('**/src/main.js',r=>r.fulfill({body:source+expose,contentType:'text/javascript'}));await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),fixture);
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await wait(page,()=>window.__orbitQA?.ready);const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+5000));
  await page.locator('[data-gs-focus="navigate:garage:fleet"]:visible').first().click();
  if(!materialsOnly)await shot(page,device+'-tier1-overview');
  if(!materialsOnly&&label==='after'&&device==='desktop')await page.evaluate(()=>{window.__orbitQA.garage.reducedMotion=false;});
  await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();if(!materialsOnly&&label==='after'&&device==='desktop'){await page.evaluate(()=>window.__orbitQA.garage.advance(.425,{visible:true,reducedMotion:false}));await shot(page,'desktop-overview-rear-transition-mid',false);}const rear=await shot(page,device+'-tier1-rear');
  if(screenVideo)await inspectScreenPlayback(page,device);
  if(process.env.ORBIT_SURFACE_SEQUENCE==='1'&&device==='desktop'){
   const r=rear.region,x=r.x+r.width*.5,y=r.y+r.height*.5;
   await page.mouse.move(x,y);await page.mouse.down();
   for(let frame=0;frame<16;frame++){await page.mouse.move(x+frame*1.25,y);await shot(page,'desktop-surface-motion-'+String(frame).padStart(3,'0'));}
   await page.mouse.up();await page.locator('[data-gs-focus="inspectVehicle:overview"]:visible').click();await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();
  }
  if(process.env.ORBIT_MATERIAL_ORBIT==='1'){await drag(page,20,0,mobile);await shot(page,device+'-tier1-surface-orbit-right');await drag(page,-40,0,mobile);await shot(page,device+'-tier1-surface-orbit-left');await page.locator('[data-gs-focus="inspectVehicle:overview"]:visible').click();await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();}
  if(!materialsOnly){await drag(page,110,0,mobile);const right=await shot(page,device+'-tier1-drag-right');
  assert.deepEqual(right.vehicle,rear.vehicle);assert.deepEqual(right.vehicleQuaternion,rear.vehicleQuaternion);
  await drag(page,-220,45,mobile);await shot(page,device+'-tier1-drag-left-high');}
  if(label==='after'&&(device==='desktop'||process.env.ORBIT_ALL_TIERS_MOBILE==='1')&&process.env.ORBIT_FULL==='1'){
   for(const tier of [2,3,4]){await page.evaluate(t=>window.__orbitQA.setTier(t),tier);await page.locator('[data-gs-focus="inspectVehicle:overview"]:visible').click();if(!materialsOnly)await shot(page,`${device}-tier${tier}-overview`);await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();await shot(page,`${device}-tier${tier}-rear`);}
   if(!materialsOnly){await page.locator('[data-gs-focus="inspectVehicle:wheels"]:visible').click();await shot(page,device+'-rims');await page.locator('[data-gs-focus="inspectVehicle:cockpit"]:visible').click();await shot(page,device+'-cockpit');
   await page.locator('[data-gs-focus="selectVehicle:van"]:visible').click();await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();await shot(page,device+'-van-rear');}
  }
  if(mobile){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await wait(page,()=>window.__orbitQA.blocked);assert.ok(await page.locator('#orientationGate').isVisible());report.portraitGate=true;}
  await page.close();
 }
 assert.deepEqual(report.errors,[]);
 if(process.env.ORBIT_COMPARE_REPORT){
  const baseline=JSON.parse(await readFile(process.env.ORBIT_COMPARE_REPORT,'utf8'));
  for(const frame of report.frames){const before=baseline.frames.find(item=>item.name===frame.name);assert.ok(before,'Matched baseline '+frame.name);for(const key of ['camera','quaternion','vehicle','vehicleQuaternion','css','buffer']){assert.equal(frame[key].length,before[key].length);frame[key].forEach((value,index)=>assert.ok(Math.abs(value-before[key][index])<1e-7,frame.name+' '+key));}assert.ok(Math.abs(frame.fov-before.fov)<1e-7,frame.name+' projection');}
  report.matchedCameraAndProjection=true;
 }
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('GARAGE ORBIT QA PASS',label);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
