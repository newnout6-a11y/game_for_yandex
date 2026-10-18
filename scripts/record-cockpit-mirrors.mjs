import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from './serve.mjs';

// An initial safe fixture, then actual W/Z/X inputs and production simulation.
// Each output frame represents 1/24 s, not a measured real-time browser rate.
const out=path.resolve(process.env.COCKPIT_VIDEO_OUT||'output/cockpit-mirrors-video');
const rate=24,frames=96;await mkdir(path.join(out,'frames'),{recursive:true});
const bytes=await readFile('public/assets/roadster.glb'),assetSha256=createHash('sha256').update(bytes).digest('hex');
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const errors=[],samples=[];
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});page.setDefaultTimeout(120000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if((m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))||/object does not belong to this context|INVALID_OPERATION/i.test(m.text()))errors.push(m.text());});
 await page.route('**/public/assets/roadster.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
 await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
 await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js');window.__originalCockpitRender=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(s){window.__cw=this;window.__cs=s;};});
 const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+100));await page.locator('#playBtn').click();await page.clock.runFor(34);
 await page.evaluate(()=>{const w=window.__cw,s=window.__cs;w.setQuality('high');Object.assign(s,{distance:125,rearDistance:125,speed:26,nitro:100,nextSpawn:Infinity,nextEvent:Infinity,pickups:[],obstacles:[],roadEvent:null,traffic:[
  {id:950,kind:'sedan',lane:0,z:-9,speed:27,color:5,laneChangeCooldown:1000},
  {id:951,kind:'suv',lane:1,z:-17,speed:27,color:1,laneChangeCooldown:1000},
  {id:952,kind:'van',lane:2,z:-12,speed:28,color:3,laneChangeCooldown:1000},
  {id:953,kind:'boxtruck',lane:2,z:80,speed:24,color:0,laneChangeCooldown:1000}]});w.view={};w.time=0;});
 await page.keyboard.press('KeyC');await page.clock.runFor(34);
 // Exercise real context loss before recording, including the settled-pause path.
 await page.evaluate(()=>{const w=window.__cw,s=window.__cs;window.__originalCockpitRender.call(w,s,{menu:false,dt:.1});
  const ext=w.renderer.getContext().getExtension('WEBGL_lose_context');window.__videoRecovery={supported:!!ext};if(!ext)return;
  window.__videoOldTexture=w.rearCameraDisplay.texture;window.__videoLossExt=ext;w.wasPaused=true;w.pausedFor=1;w.needsRender=false;
  w.canvas.addEventListener('webglcontextlost',()=>{window.__videoRecovery.lost={unbound:w.rearCameraDisplay.texture===null,dirty:w.needsRender};},{once:true});
  w.canvas.addEventListener('webglcontextrestored',()=>{window.__videoRecovery.restored=true;},{once:true});ext.loseContext();
 });
 await page.clock.runFor(100);await page.waitForTimeout(1000);await page.evaluate(()=>window.__videoLossExt?.restoreContext());
 await page.clock.runFor(100);await page.waitForTimeout(2000);
 const recovery=await page.evaluate(()=>{const w=window.__cw,s=window.__cs,r=window.__videoRecovery;if(!r.supported)return r;
  r.dirty=w.needsRender;window.__originalCockpitRender.call(w,s,{menu:false,paused:true,dt:0});
  return{...r,newTexture:w.rearCameraDisplay.texture!==window.__videoOldTexture,live:!!w.rearCameraDisplay.texture,glError:w.renderer.getContext().getError()};
 });
 await writeFile(path.join(out,'context-recovery.json'),JSON.stringify(recovery,null,2));console.log('Context recovery',recovery);
 if(recovery.supported){assert.deepEqual(recovery.lost,{unbound:true,dirty:true});assert.equal(recovery.restored,true);assert.equal(recovery.dirty,true);assert.equal(recovery.newTexture,true);assert.equal(recovery.live,true);assert.equal(recovery.glError,0);}assert.deepEqual(errors,[]);
 await page.keyboard.down('KeyW');
 const keys=new Map([[10,['down','KeyX']],[44,['up','KeyX']],[57,['down','KeyZ']],[80,['up','KeyZ']]]);
 for(let frame=0;frame<frames;frame++){
  const key=keys.get(frame);if(key)await page.keyboard[key[0]](key[1]);
  await page.clock.runFor(Math.round((frame+1)*1000/rate)-Math.round(frame*1000/rate));
  const sample=await page.evaluate(dt=>{const w=window.__cw,s=window.__cs;w.renderer.info.autoReset=false;w.renderer.info.reset();window.__originalCockpitRender.call(w,s,{menu:false,dt});return{phase:s.phase,speed:s.speed,altitude:s.altitude,look:w.lookDirection,lookYaw:w.lookYaw,cameraMode:w.effectiveCameraMode,surface:[w.canvas.width,w.canvas.height],rearVehicles:s.traffic.filter(c=>c.z<0).map(c=>({id:c.id,lane:c.lane,z:c.z})),mirrors:w.playerMirrors.diagnostics,calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles};},1/rate);
  assert.equal(sample.phase,'playing');assert.equal(sample.cameraMode,'cockpit');assert.deepEqual(sample.surface,[1920,1080]);assert.equal(sample.mirrors.failedPasses,0);
  samples.push(sample);await page.screenshot({path:path.join(out,'frames',String(frame).padStart(4,'0')+'.png')});if(frame%24===0)console.log('frames',frame+'/'+frames,'speed',sample.speed.toFixed(2));
 }
 await page.keyboard.up('KeyW');assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'capture.json'),JSON.stringify({assetSha256,rate,frames,duration:frames/rate,method:'Controlled-time production gameplay, one safe initial traffic fixture followed by actual W/Z/X key events. Native1920×1080 render; not hardware FPS. Mirror targets refresh at their bounded independent cadence.',samples,recovery,errors},null,2));
 console.log('Recorded',frames,'frames',out);
}finally{await browser.close();await new Promise(r=>server.close(r));}
