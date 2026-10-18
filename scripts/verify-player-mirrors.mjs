import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {startServer} from './serve.mjs';

const out=path.resolve(process.env.MIRROR_QA_OUT||'output/player-mirrors-qa');
await mkdir(out,{recursive:true});
const bytes=await readFile('public/assets/roadster.glb'),assetSha256=createHash('sha256').update(bytes).digest('hex');
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const probe=Boolean(process.env.MIRROR_PROBE);
const profiles=[{name:'desktop',viewport:{width:1600,height:900},deviceScaleFactor:1},{name:'mobile',viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}],results=[];
try{
 for(const {name,...profile} of (probe?profiles.slice(0,1):profiles)){
  const context=await browser.newContext({...profile,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))errors.push(m.text());});
  await page.route('**/public/assets/roadster.glb',r=>r.fulfill({body:bytes,contentType:'model/gltf-binary'}));
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
  await page.evaluate(async()=>{const{UI}=await import('./src/ui.js');const hud=UI.prototype.hud;UI.prototype.hud=function(s){window.__mirrorUI=this;return hud.call(this,s);};const{RoadRenderer}=await import('./src/world.js');window.__mirrorRender=RoadRenderer.prototype.render;RoadRenderer.prototype.render=function(s){window.__mirrorWorld=this;window.__mirrorState=s;};});
  const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+100));await page.locator('#playBtn').click();await page.clock.runFor(34);
  await page.evaluate(()=>{
   const w=window.__mirrorWorld,s=window.__mirrorState;w.setQuality('high');
   Object.assign(s,{phase:'playing',speed:22,distance:125,rearDistance:125,nitro:100,nextSpawn:Infinity,nextEvent:Infinity,pickups:[],obstacles:[],roadEvent:null,traffic:[
    {id:910,kind:'sedan',lane:0,z:-9,speed:22,color:5},
    {id:911,kind:'suv',lane:1,z:-15,speed:22,color:1},
    {id:912,kind:'van',lane:2,z:-11,speed:22,color:3},
    {id:913,kind:'boxtruck',lane:1,z:50,speed:22,color:0}]});
   w.renderer.info.autoReset=false;
  });
  await page.keyboard.press('KeyC'); await page.clock.runFor(34);
  const samples=[];
  for(const [label,look,altitude,rolling,rollAngle,move] of [['center',0,0,false,0,0],['center-repeat',0,0,false,0,0],['left',-1,0,false,0,0],['right',1,0,false,0,0],['center-return',0,0,false,0,0],['rear-moved',0,0,false,0,.25],['hover',0,3.3,false,0,0],['roll-external',0,3.3,true,Math.PI,0],['returned',0,0,false,0,0]]){
   const record=await page.evaluate(({label,look,altitude,rolling,rollAngle,move})=>{
    const w=window.__mirrorWorld,s=window.__mirrorState;Object.assign(s,{altitude,rolling,rollAngle,flying:altitude>0});s.traffic[1].lane=1+move;
    w.setLookDirection(look);w.needsRender=true;w.playerMirrors.invalidate();w.renderer.info.reset();
    for(let i=0;i<(label==='returned'?4:1);i++)window.__mirrorRender.call(w,s,{dt:.1,menu:false});
    window.__mirrorUI?.hud(s);const T=w.playerMirrors.diagnostics;
    const refreshed={calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles};w.renderer.info.reset();w.needsRender=true;window.__mirrorRender.call(w,s,{dt:0,menu:false});const cached={calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles};
    return{label,cameraMode:w.effectiveCameraMode,requested:w.cameraMode,look:w.lookDirection,camera:w.camera.position.toArray(),direction:w.camera.getWorldDirection(w.camera.position.clone()).toArray(),mirrors:T,refreshed,cached,render:{calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles,textures:w.renderer.info.memory.textures},buffer:[w.canvas.width,w.canvas.height],overflow:document.documentElement.scrollWidth>innerWidth};
   },{label,look,altitude,rolling,rollAngle,move});
   await page.screenshot({path:path.join(out,name+'-'+label+'.png')});samples.push(record);console.log(name,label,JSON.stringify(record));
   assert.equal(record.mirrors.paneCount,3);assert.deepEqual(record.mirrors.rejected,[]);assert.equal(record.mirrors.failedPasses,0);assert.equal(record.overflow,false);
   assert.equal(record.cameraMode,rolling?'chase':'cockpit');
  }
  const roles=new Set(samples.flatMap(s=>s.mirrors.panes.filter(p=>p.active).map(p=>p.role)));assert.ok(roles.has('left')&&roles.has('center'));assert.ok(samples.some(s=>s.mirrors.rightCamera?.active),'Separate right screen must receive a real rear camera frame');
  let recovery=null;
  if(process.env.MIRROR_CONTEXT && name==='desktop'){
    await page.evaluate(()=>{
     const w=window.__mirrorWorld,gl=w.renderer.getContext(),ext=gl.getExtension('WEBGL_lose_context');
     window.__recovery={supported:!!ext};if(!ext)return;
     window.__oldRightTexture=w.rearCameraDisplay.texture;window.__lossExt=ext;
     w.wasPaused=true;w.pausedFor=1;w.needsRender=false;
     w.canvas.addEventListener('webglcontextlost',()=>{window.__recovery.lost={unbound:w.rearCameraDisplay.texture===null,dirty:w.needsRender,lost:w.playerMirrors.diagnostics.contextLost};},{once:true});
     w.canvas.addEventListener('webglcontextrestored',()=>{window.__recovery.restoredEvent=true;},{once:true});
     ext.loseContext();
    });
    await page.clock.runFor(100);await page.waitForTimeout(1000);
    console.log('loss event',await page.evaluate(()=>window.__recovery));
    await page.evaluate(()=>window.__lossExt?.restoreContext());
    await page.clock.runFor(100);await page.waitForTimeout(2000);
    recovery=await page.evaluate(()=>{
     const w=window.__mirrorWorld,s=window.__mirrorState,r=window.__recovery;
     if(!r.supported||!r.restoredEvent)return r;
     r.restoredDirty=w.needsRender;window.__mirrorRender.call(w,s,{dt:0,paused:true,menu:false});
     return {...r,newTexture:w.rearCameraDisplay.texture!==window.__oldRightTexture,live:!!w.rearCameraDisplay.texture,diagnostics:w.playerMirrors.diagnostics};
    });
    console.log('context recovery',recovery);
    await writeFile(path.join(out,name+'-context.json'),JSON.stringify(recovery,null,2));
    if(recovery.supported){assert.deepEqual(recovery.lost,{unbound:true,dirty:true,lost:true});assert.equal(recovery.restoredEvent,true);assert.equal(recovery.restoredDirty,true);assert.equal(recovery.newTexture,true);assert.equal(recovery.live,true);}
  }
  const layouts=[];
  if(profile.isMobile){
   for(const viewport of [{width:280,height:640},{width:844,height:390},{width:480,height:320}]){
    await page.setViewportSize(viewport); await page.clock.runFor(40);
    const box=await page.locator('#lookRightBtn').boundingBox();assert.ok(box&&box.width>=44&&box.height>=44);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.clock.runFor(34);
    const held=await page.evaluate(()=>{const w=window.__mirrorWorld,s=window.__mirrorState;window.__mirrorRender.call(w,s,{dt:.1,menu:false});return{look:w.lookDirection,overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(held.look,1);assert.equal(held.overflow,false);await page.screenshot({path:path.join(out,`layout-${viewport.width}x${viewport.height}.png`)});
    await page.mouse.up();await page.clock.runFor(34);assert.equal(await page.evaluate(()=>window.__mirrorWorld.lookDirection),0);layouts.push({viewport,button:box,...held});
   }
  }
  assert.deepEqual(errors,[]);results.push({name,samples,layouts,recovery,errors});await context.close();
 }
 await writeFile(path.join(out,'qa.json'),JSON.stringify({assetSha256,method:'Actual production camera/player/traffic and mirror materials. Fixed rear-traffic scenario, controlled time, no hidden body; actual left/center planar reflection and user-selected digital right rear screen. Statistics include mirror and main passes, not hardware FPS.',results},null,2));
 console.log('Mirror browser verification passed',out);
}finally{await browser.close();await new Promise(r=>server.close(r));}
