import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from './serve.mjs';

// Deterministic visual smoke: real input handlers + simulation, controlled time.
// Intermediate GPU draws are skipped while advancing the clock, not game logic.
// Captures are scripted scenes; this is not a physical-device FPS benchmark.
await mkdir('output/playwright', { recursive:true });
const server=startServer({port:0,root:process.argv.includes('--dist')?path.resolve('dist'):process.cwd()});
await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const results=[];
try {
  for(const [name,size] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
    const page=await browser.newPage({viewport:size,deviceScaleFactor:name==='mobile'?2:1,reducedMotion:'reduce',...(name==='mobile'?{isMobile:true,hasTouch:true}:{})});
    const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('ERROR',error.message);});
    await page.clock.install();
    console.log(name,'loading');
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden,null,{timeout:120000});
    await page.evaluate(async()=>{
      const {RoadRenderer}=await import('./src/world.js');const original=RoadRenderer.prototype.render;
      window.__captureRender=original;
      /** Observe state/world without rendering intermediate frames; explicit captures call the saved production renderer. */ RoadRenderer.prototype.render=function(state,...args){window.__driveState=state;window.__testWorld=this;};
    });
    const time=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(time+100));
    console.log(name,'loaded');
    await page.screenshot({path:`output/playwright/${name}-menu.png`});
    await page.locator('#playBtn').click();await page.clock.runFor(32);
    await page.evaluate(()=>{
      const s=window.__driveState;s.speed=28;s.traffic=[{id:501,lane:0,z:28,kind:'suv',color:1,speed:18},{id:502,lane:2,z:43,kind:'van',color:0,speed:16},{id:503,lane:1,z:72,kind:'sedan',color:3,speed:21}];s.nextEvent=s.nextSpawn=Infinity;
      window.__captureRender.call(window.__testWorld,s,{menu:false,dt:1});
    });
    await page.clock.runFor(32);
    await page.screenshot({path:`output/playwright/${name}-drive.png`});console.log(name,'drive');
    if(name==='mobile'){
      await page.locator('#gasBtn').dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch'});
      await page.locator('#flightBtn').dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch'});
    }else{await page.keyboard.down('KeyW');await page.keyboard.down('KeyF');}
    await page.clock.runFor(1500);
    const flight=await page.evaluate(()=>({altitude:window.__driveState.altitude,flying:window.__driveState.flying,nitro:window.__driveState.nitro,phase:window.__driveState.phase,held:document.querySelector('#flightBtn').dataset.held}));
    assert.ok(flight.altitude>3,JSON.stringify(flight));assert.equal(flight.flying,true);assert.equal(flight.held,'true');assert.ok(flight.nitro<41);
    await page.evaluate(()=>window.__captureRender.call(window.__testWorld,window.__driveState,{menu:false,dt:1}));
    await page.screenshot({path:`output/playwright/${name}-hover.png`});console.log(name,'hover');
    if(name==='mobile')await page.locator('#flightBtn').dispatchEvent('pointerup',{pointerId:2,pointerType:'touch'});else await page.keyboard.up('KeyF');
    await page.clock.runFor(2600);
    const landed=await page.evaluate(()=>({altitude:window.__driveState.altitude,cooldown:window.__driveState.flightCooldown}));assert.equal(landed.altitude,0);assert.ok(landed.cooldown>0);
    const geometry=await page.evaluate(()=>({renderSurface:[window.__testWorld.canvas.width,window.__testWorld.canvas.height],drawCalls:window.__testWorld.renderer.info.render.calls,triangles:window.__testWorld.renderer.info.render.triangles,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}));assert.equal(geometry.horizontalOverflow,false);assert.deepEqual(errors,[]);
    let rotation;
    if(name==='mobile'){
      await page.setViewportSize({width:844,height:390});await page.clock.runFor(32);
      await page.evaluate(()=>window.__captureRender.call(window.__testWorld,window.__driveState,{menu:false,dt:1}));
      rotation=await page.evaluate(()=>({surface:[window.__testWorld.canvas.width,window.__testWorld.canvas.height],aspect:window.__testWorld.camera.aspect,overflow:document.documentElement.scrollWidth>innerWidth}));
      assert.ok(Math.abs(rotation.surface[0]/rotation.surface[1]-844/390)<.005);assert.equal(rotation.overflow,false);
      await page.screenshot({path:'output/playwright/mobile-landscape.png'});
    }
    results.push({name,viewport:size,flight,landed,...geometry,rotation,errors});await page.close();
  }
  await writeFile('output/playwright/visual-smoke.json',JSON.stringify({captureType:'Scripted scenes with controlled time, real input handlers and unchanged game physics. Not an FPS benchmark.',results},null,2));
  console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
