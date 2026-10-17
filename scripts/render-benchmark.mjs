import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';
const stage=process.argv[2]||'after';
const root=process.env.BENCHMARK_ROOT?path.resolve(process.env.BENCHMARK_ROOT):stage==='before'?path.resolve('output/perf-baseline'):process.cwd();
const out=`output/optimization/${stage}`;await mkdir(out,{recursive:true});
const server=startServer({port:0,root});await once(server,'listening');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const results=[];
try{
const profiles=[['desktop',{width:1440,height:900},1],['mobile',{width:390,height:844},2]];
for(const [name,size,dpr]of(process.env.CAPTURE_MOTION?profiles.slice(0,1):profiles)){
 const page=await browser.newPage({viewport:size,deviceScaleFactor:dpr,reducedMotion:'reduce',...(name==='mobile'?{isMobile:true,hasTouch:true}:{})});const errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))consoleErrors.push(m.text());});
 await page.clock.install(); page.setDefaultTimeout(120000);
 console.log(stage,name,'loading');await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden,null,{timeout:120000});
 await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js');const{UI}=await import('./src/ui.js');window.__captureHud=UI.prototype.hud;const original=RoadRenderer.prototype.render;window.__originalRender=original;RoadRenderer.prototype.render=function(s){window.__world=this;window.__state=s;};});
 const clockNow=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(clockNow+10000));
 await page.locator('#playBtn').click();await page.clock.runFor(32);await page.waitForFunction(()=>window.__world);
 await page.screenshot({animations:'disabled'});
 const result=await page.evaluate(showFleet=>{
   const world=window.__world,r=world.renderer,original=window.__originalRender;
   const state={...window.__state,distance:125,score:125,elapsed:4,speed:28,flightReady:true,x:1,heading:0,steerAngle:0,acceleration:0,altitude:0,flying:false,braking:false,invincible:0,pickups:[],obstacles:[],roadEvent:null,traffic:[{id:501,lane:0,z:28,kind:'suv',color:1,speed:18},{id:502,lane:2,z:43,kind:'van',color:0,speed:16},{id:503,lane:1,z:72,kind:'sedan',color:3,speed:21}]};
   if(showFleet)state.traffic=[{id:601,lane:0,z:24,kind:'semi',color:1,speed:17},{id:602,lane:2,z:30,kind:'firetruck',color:0,speed:18},{id:603,lane:0,z:62,kind:'towtruck',color:3,speed:16},{id:604,lane:2,z:75,kind:'boxtruck',color:1,speed:17},{id:605,lane:1,z:90,kind:'sedan',color:4,speed:21},{id:606,lane:0,z:106,kind:'hatch',color:5,speed:20},{id:607,lane:2,z:125,kind:'suv',color:6,speed:19},{id:608,lane:1,z:152,kind:'van',color:0,speed:18}];
   window.__captureHud.call({},state);
   world.menuDistance=0;world.time=0;world.view={};
   original.call(world,state,{menu:false,dt:1});
   r.info.autoReset=false;const rawDraw=r.render.bind(r);const draw=(...args)=>{r.info.reset();rawDraw(...args);};r.render=()=>{};const cpu=[];
   for(let sample=0;sample<5;sample++){const start=performance.now();for(let i=0;i<60;i++){state.distance=125+i*.4;original.call(world,state,{menu:false,dt:1/60});}cpu.push((performance.now()-start)/60);}
   r.render=draw;state.distance=125;world.time=0;world.view={};original.call(world,state,{menu:false,dt:1});
   const gl=r.getContext();gl.finish();const rendered=[];for(let i=0;i<3;i++){const start=performance.now();draw(world.scene,world.camera);gl.finish();rendered.push(performance.now()-start);}
   window.__benchmarkState=state;window.__drawFinal=()=>draw(world.scene,world.camera);
   const attributes=gl.getContextAttributes();return{viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,renderSurface:[r.domElement.width,r.domElement.height],pixels:r.domElement.width*r.domElement.height,drawCallsIncludeShadows:true,drawCalls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures,context:{antialias:attributes.antialias,preserveDrawingBuffer:attributes.preserveDrawingBuffer},maxAnisotropy:r.capabilities.getMaxAnisotropy(),cpuUpdateMs:null,softwareRenderSubmissionMs:null,horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
 },Boolean(process.env.FLEET_SHOWCASE));
 await page.evaluate(()=>window.__drawFinal());await page.screenshot({path:`${out}/${name}.png`});
 if(process.env.CAPTURE_LAKE_DETAIL && name==='desktop'){
   await page.evaluate(()=>{const c=window.__world.camera;window.__savedCamera={p:c.position.clone(),q:c.quaternion.clone()};c.position.set(40,5,5);c.lookAt(135,-3,-190);window.__drawFinal();});
   await page.screenshot({path:`${out}/desktop-lake-detail.png`});
   const cleanStyle=await page.addStyleTag({content:'#hud,.topbar {visibility:hidden!important}'});
   await page.evaluate(()=>window.__drawFinal());await page.screenshot({path:`${out}/desktop-lake-clean.png`});await cleanStyle.evaluate(e=>e.remove());
   await page.evaluate(()=>{const c=window.__world.camera;c.position.copy(window.__savedCamera.p);c.quaternion.copy(window.__savedCamera.q);});
 }
if(process.env.CAPTURE_MOTION){
   await mkdir(`${out}/frames`,{recursive:true});
   await page.evaluate(async()=>{const{UI}=await import('./src/ui.js');const hud=UI.prototype.hud;UI.prototype.hud=function(){hud.call(this,window.__benchmarkState);};});
   const frameCount=Number(process.env.MOTION_FRAMES)||24,rate=Number(process.env.MOTION_RATE)||12;
   for(let frame=0;frame<frameCount;frame++){
     await page.evaluate(rate=>{const s=window.__benchmarkState;s.distance+=28/rate;s.elapsed+=1/rate;s.score=s.distance;s.flightReady=true;for(const t of s.traffic)t.z-=(28-t.speed)/rate;window.__originalRender.call(window.__world,s,{menu:false,dt:1/rate});},rate);
     await page.screenshot({path:`${out}/frames/${String(frame).padStart(3,'0')}.png`});
   }
 }
 results.push({name,...result,errors,consoleErrors});console.log(name,JSON.stringify({...result,errors,consoleErrors}));if(errors.length||consoleErrors.length)throw new Error('Browser rendering errors: '+JSON.stringify({errors,consoleErrors}));await page.close();
}
await writeFile(`${out}/metrics.json`,JSON.stringify({stage,method:'Same deterministic distance=125m scene, viewport and DPR. Real production render surface; no screenshot-only resolution override. Controlled page clock is paused for stable captures; timing fields are intentionally null. This records render counters, not hardware/device FPS. renderer.info counters are reset before the complete render, including shadow submissions.',results},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
