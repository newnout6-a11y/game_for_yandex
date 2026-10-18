/**
 * Compare the real left-mirror aperture at native desktop/portrait sizes.
 * Uses a controlled production scene with actual rear vehicles at 9 and 14 m;
 * this is a visibility/projection check, not simulated driving or an FPS test.
 * CHROME_BIN selects an executable; otherwise installed Chrome is used.
 * Optional LEFT_ASSET / LEFT_BASELINE_MODULE pin a prior asset and renderer for
 * matched comparisons. LEFT_OUT chooses the PNG and diagnostic output folder.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from './serve.mjs';
const out=path.resolve(process.env.LEFT_OUT||'output/left-mirror-usability');await mkdir(out,{recursive:true});
const bytes=await readFile(process.env.LEFT_ASSET||'public/assets/roadster.glb');
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN ? {executablePath:process.env.CHROME_BIN} : {channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const reports=[],errors=[];
try{
for(const profile of [{name:'desktop',viewport:{width:1920,height:1080},deviceScaleFactor:1},{name:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}]){
 if(process.env.LEFT_PROFILE && process.env.LEFT_PROFILE!==profile.name)continue;
 const {name,...options}=profile,context=await browser.newContext({...options,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))errors.push(m.text());});
 await page.route('**/public/assets/roadster.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
 if(process.env.LEFT_BASELINE_MODULE)await page.route('**/src/player-mirrors.js',async r=>r.fulfill({body:await readFile(process.env.LEFT_BASELINE_MODULE),contentType:'text/javascript'}));
 await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
 await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js');window.__lmRender=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(s){window.__lmWorld=this;window.__lmState=s;};});
 const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+100));await page.locator('#playBtn').click();await page.clock.runFor(34);
 await page.evaluate(()=>{const w=window.__lmWorld,s=window.__lmState;w.setQuality('high');Object.assign(s,{phase:'playing',distance:125,rearDistance:125,speed:22,nitro:100,nextSpawn:Infinity,nextEvent:Infinity,pickups:[],obstacles:[],roadEvent:null,traffic:[{id:910,kind:'sedan',lane:0,z:-9,speed:22,color:5},{id:911,kind:'suv',lane:1,z:-15,speed:22,color:1},{id:912,kind:'van',lane:2,z:-11,speed:22,color:3},{id:913,kind:'boxtruck',lane:2,z:60,speed:22,color:0}]});w.view={};w.time=0;});
 await page.keyboard.press('KeyC');await page.clock.runFor(34);
 const samples=[];
 for(const [label,look,z] of [['forward',0,-9],['left',-1,-9],['left-moved',-1,-14]]){
  if(process.env.LEFT_SAMPLE && process.env.LEFT_SAMPLE!==label)continue;
  const sample=await page.evaluate(async({look,z})=>{const T=await import('./public/vendor/three.js'),w=window.__lmWorld,s=window.__lmState;s.traffic[0].z=z;w.setLookDirection(look);w.playerMirrors.invalidate();w.needsRender=true;w.renderer.info.autoReset=false;w.renderer.info.reset();
   for(let i=0;i<4;i++)window.__lmRender.call(w,s,{menu:false,dt:.1});
   let pane;w.player.traverse(n=>{if(n.userData.mirrorRole==='left'&&n.isMesh)pane=n;});
   const p=pane.geometry.attributes.position,pts=[];for(let i=0;i<p.count;i++){const q=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(pane.matrixWorld).project(w.camera);pts.push([(q.x+1)*innerWidth/2,(1-q.y)*innerHeight/2]);}
   const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
   return {controlledRenderCount:4,look,z,buffer:[w.canvas.width,w.canvas.height],bounds,curvature:pane.userData.mirrorCurvature||null,camera:w.camera.position.toArray(),mirror:w.playerMirrors.diagnostics,glError:w.renderer.getContext().getError(),calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles};
  },{look,z});
  await page.screenshot({path:path.join(out,name+'-'+label+'.png')});console.log(name,label,JSON.stringify(sample));assert.equal(sample.glError,0);assert.equal(sample.mirror.failedPasses,0);samples.push({label,...sample});
 }
 reports.push({name,samples});await context.close();
}
assert.deepEqual(errors,[]);await writeFile(path.join(out,'review.json'),JSON.stringify({assetSha256:createHash('sha256').update(bytes).digest('hex'),method:'Production player mirror, driver eye and actual traffic models. Controlled initial safe rear traffic scenario; no fake reflected objects or hidden player body. Main native PNGs, not FPS measurement.',reports,errors},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
