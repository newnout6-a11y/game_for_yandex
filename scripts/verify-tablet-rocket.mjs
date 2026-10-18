/**
 * Capture the production tablet from the normal driver eye and an explicitly
 * labelled inspection camera. TABLET_ASSET pins a prior GLB for matched before/
 * after captures. No player geometry or UI pixels are substituted in the browser.
 * CHROME_BIN selects an executable; otherwise use installed Chrome. Controlled
 * state screenshots verify pixels and readouts, not real-device FPS.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from './serve.mjs';
const out=path.resolve(process.env.TABLET_OUT||'output/tablet-rocket-after');await mkdir(out,{recursive:true});
const bytes=await readFile(process.env.TABLET_ASSET||'public/assets/roadster.glb');
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const reports=[],errors=[];
try{
 for(const profile of [{name:'desktop',viewport:{width:1920,height:1080},deviceScaleFactor:1},{name:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}]){
  if(process.env.TABLET_PROFILE && process.env.TABLET_PROFILE!==profile.name)continue;
  const{name,...options}=profile,context=await browser.newContext({...options,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))errors.push(m.text());});
  await page.route('**/public/assets/roadster.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
  await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js');window.__trRender=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(s){window.__trWorld=this;window.__trState=s;};});
  const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+100));await page.locator('#playBtn').click();await page.clock.runFor(34);
  await page.evaluate(()=>{const w=window.__trWorld,s=window.__trState;w.setQuality('high');Object.assign(s,{phase:'playing',distance:125,rearDistance:125,speed:22,nitro:82,nextSpawn:Infinity,nextEvent:Infinity,pickups:[],obstacles:[],roadEvent:null,traffic:[{id:910,kind:'sedan',lane:0,z:-9,speed:22,color:5},{id:911,kind:'suv',lane:1,z:-15,speed:22,color:1},{id:912,kind:'van',lane:2,z:-11,speed:22,color:3},{id:913,kind:'boxtruck',lane:2,z:60,speed:22,color:0}]});w.view={};w.time=0;});
  if(profile.isMobile)await page.locator('#cameraBtn').tap();else await page.keyboard.press('KeyC');await page.clock.runFor(34);
  const sample=await page.evaluate(()=>{const w=window.__trWorld,s=window.__trState;w.setLookDirection(0);w.playerMirrors.invalidate();w.needsRender=true;for(let i=0;i<4;i++)window.__trRender.call(w,s,{menu:false,dt:.1});return{eye:w.camera.position.toArray(),buffer:[w.canvas.width,w.canvas.height],tablet:w.cockpitDisplay.telemetry,mirror:w.playerMirrors.diagnostics,overflow:document.documentElement.scrollWidth>innerWidth,glError:w.renderer.getContext().getError(),geometries:w.renderer.info.memory.geometries,textures:w.renderer.info.memory.textures};});
  await page.screenshot({path:path.join(out,name+'-driver.png')});
  assert.equal(sample.tablet.speed,'79');assert.equal(sample.tablet.energy,'82%');assert.equal(sample.tablet.distance,'0.13 KM');assert.equal(sample.overflow,false);assert.equal(sample.glError,0);assert.equal(sample.mirror.failedPasses,0);
  if(name==='desktop'){
   const data=await page.evaluate(()=>window.__trWorld.cockpitDisplay.texture.image.toDataURL('image/png'));await writeFile(path.join(out,'tablet-live-texture.png'),Buffer.from(data.split(',')[1],'base64'));
   await page.addStyleTag({content:'#menu,.topbar,#hud,.scene-shade,#overlay{display:none!important}'});
   const close=await page.evaluate(async()=>{const T=await import('./public/vendor/three.js'),w=window.__trWorld,screen=w.player.getObjectByName('detail_rc_ui'),box=new T.Box3().setFromObject(screen),target=box.getCenter(new T.Vector3()),q=w.camera.position.clone().sub(target).normalize();w.camera.position.copy(target).addScaledVector(q,.58);w.camera.lookAt(target);w.camera.fov=32;w.camera.aspect=innerWidth/innerHeight;w.camera.updateProjectionMatrix();w.playerMirrors.invalidate();w.playerMirrors.update(w.camera,{dt:0,mode:'cockpit',quality:w.quality,compact:false,force:true});w.renderer.info.autoReset=false;w.renderer.info.reset();w.renderer.render(w.scene,w.camera);return{eye:w.camera.position.toArray(),target:target.toArray(),fov:w.camera.fov,calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles,glError:w.renderer.getContext().getError()};});
   await page.screenshot({path:path.join(out,'desktop-tablet-inspection.png')});assert.equal(close.glError,0);sample.inspection=close;
  }
  if(name==='mobile'){
   await page.locator('#lookRightBtn').dispatchEvent('pointerdown',{pointerId:91,pointerType:'touch',isPrimary:true,button:0,buttons:1});await page.clock.runFor(34);
   const glance=await page.evaluate(()=>{const w=window.__trWorld,s=window.__trState;w.playerMirrors.invalidate();w.needsRender=true;for(let i=0;i<4;i++)window.__trRender.call(w,s,{menu:false,dt:.1});return{look:w.lookDirection,lookYaw:w.lookYaw,eye:w.camera.position.toArray(),tablet:w.cockpitDisplay.telemetry,glError:w.renderer.getContext().getError(),mirror:w.playerMirrors.diagnostics,pressed:document.querySelector('#lookRightBtn').getAttribute('aria-pressed')};});
   await page.screenshot({path:path.join(out,'mobile-tablet-right-glance.png')});assert.equal(glance.look,1);assert.equal(glance.pressed,'true');assert.equal(glance.glError,0);assert.equal(glance.mirror.failedPasses,0);assert.equal(glance.tablet.energy,'82%');
   await page.locator('#lookRightBtn').dispatchEvent('pointercancel',{pointerId:91,pointerType:'touch',isPrimary:true,button:0,buttons:0});await page.clock.runFor(34);
   assert.equal(await page.locator('#lookRightBtn').getAttribute('aria-pressed'),'false');sample.rightGlance=glance;
  }
  reports.push({name,...sample});console.log(name,JSON.stringify(sample));await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'review.json'),JSON.stringify({assetSha256:createHash('sha256').update(bytes).digest('hex'),method:'Matched production driver view plus explicitly non-playable tablet inspection camera; actual authored UI and live game instruments. Fixed controlled scene, not FPS measurement.',reports,errors},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
