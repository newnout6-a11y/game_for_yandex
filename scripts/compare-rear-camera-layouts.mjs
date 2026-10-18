import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from './serve.mjs';

// Comparison only: production retains the user's separate right screen until
// they choose a layout. Both versions share camera, traffic, time and lighting.
const out=path.resolve(process.env.REAR_LAYOUT_OUT||'output/rear-camera-comparison');await mkdir(out,{recursive:true});
const bytes=await readFile('public/assets/roadster.glb'),assetSha256=createHash('sha256').update(bytes).digest('hex');
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const results=[];
try{
 for(const profile of [{name:'desktop',viewport:{width:1600,height:900},deviceScaleFactor:1},{name:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}]){
  const{name,...device}=profile,context=await browser.newContext({...device,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.setDefaultTimeout(120000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))errors.push(m.text());});
  await page.route('**/public/assets/roadster.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
  await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js');window.__abRender=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(s){window.__abWorld=this;window.__abState=s;};});
  const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+100));await page.locator('#playBtn').click();await page.clock.runFor(34);
  await page.evaluate(async()=>{
   const w=window.__abWorld,s=window.__abState;w.setQuality('high');Object.assign(s,{speed:22,distance:125,rearDistance:125,nitro:100,nextSpawn:Infinity,nextEvent:Infinity,pickups:[],obstacles:[],roadEvent:null,traffic:[{id:910,kind:'sedan',lane:0,z:-9,speed:22,color:5},{id:911,kind:'suv',lane:1,z:-15,speed:22,color:1},{id:912,kind:'van',lane:2,z:-11,speed:22,color:3},{id:913,kind:'boxtruck',lane:1,z:50,speed:22,color:0}]});
   const{createTabletCameraPreview}=await import('./src/tablet-camera-preview.js');window.__tabletPreview=createTabletCameraPreview(w.player);
  });
  await page.keyboard.press('KeyC');await page.clock.runFor(34);
  await page.evaluate(()=>{const w=window.__abWorld,s=window.__abState;w.setLookDirection(1);for(let i=0;i<2;i++){w.setLookDirection(1);w.needsRender=true;w.playerMirrors.invalidate();window.__abRender.call(w,s,{dt:.1,menu:false});}});
  const samples=[];
  for(const variant of ['A-separate','B-tablet']){
   const sample=await page.evaluate(variant=>{const w=window.__abWorld,s=window.__abState;window.__tabletPreview.setTexture(variant==='B-tablet'?w.playerMirrors.rightCameraTexture:null);w.needsRender=true;window.__abRender.call(w,s,{dt:0,menu:false});return{variant,eye:w.camera.position.toArray(),direction:w.camera.getWorldDirection(w.camera.position.clone()).toArray(),buffer:[w.canvas.width,w.canvas.height],tablet:w.cockpitDisplay.telemetry,preview:window.__tabletPreview.diagnostics,mirrors:w.playerMirrors.diagnostics,overflow:document.documentElement.scrollWidth>innerWidth};},variant);
   await page.screenshot({path:path.join(out,name+'-'+variant+'.png')});assert.equal(sample.overflow,false);assert.equal(sample.mirrors.rightCamera.active,true);samples.push(sample);console.log(name,variant);
  }
  assert.deepEqual(samples[0].eye,samples[1].eye);assert.deepEqual(samples[0].direction,samples[1].direction);assert.deepEqual(samples[0].tablet,samples[1].tablet);
  await page.evaluate(()=>{window.__tabletPreview.dispose();});assert.deepEqual(errors,[]);results.push({name,samples,errors});await context.close();
 }
 await writeFile(path.join(out,'comparison.json'),JSON.stringify({assetSha256,method:'Reversible actual-game material preview only. Same fixed rear traffic, real driver eye and right-glance pose; A separate right display, B additional central-tablet inset. Production default unchanged; not FPS.',results},null,2));console.log('Comparison passed',out);
}finally{await browser.close();await new Promise(r=>server.close(r));}
