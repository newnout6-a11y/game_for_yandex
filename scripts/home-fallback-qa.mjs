import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadHomeQaSource} from './home-qa-source.mjs';

// Complete-source native comparison, with no live account or simulation/FPS claim.
const root=fileURLToPath(new URL('../',import.meta.url));
const baseline=process.env.HOME_BASELINE_ROOT;
const capture=await loadHomeQaSource(baseline||root);
const out=path.resolve(root,process.env.HOME_FALLBACK_OUT||'output/home-fallback-after');await mkdir(out,{recursive:true});
const report={source:capture.provenance,baseline:Boolean(baseline),frames:[],errors:[],method:'Actual production controller, authored Rocket and DOM. One complete trusted tree per run; isolated local profile and frozen render clock. Native screenshots, not an FPS benchmark.'};
const expose=`\nwindow.__homeFallbackQA={get ready(){return assetsReady&&garageScene?.ready},get blocked(){return orientationBlocked},draw(missing=false){if(missing)document.querySelector('.gs-hero-vehicle')?.remove();garageScene.setInspection('overview');garageScene.yaw=-.63;garageScene.pitch=.24;renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});const region=garageFraming();garageScene.render(innerWidth,innerHeight,region);const camera=garageScene.camera;const points=garageScene.cameraContext.points.map(p=>p.clone().project(camera));return{region,blocked:orientationBlocked,viewport:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height],vehicle:{x:Math.min(...points.map(p=>(p.x+1)*innerWidth/2)),right:Math.max(...points.map(p=>(p.x+1)*innerWidth/2)),y:Math.min(...points.map(p=>(1-p.y)*innerHeight/2)),bottom:Math.max(...points.map(p=>(1-p.y)*innerHeight/2))},camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov}};}};`;
let server,browser;
try{
 server=capture.startServer();await once(server,'listening');
 browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
 for(const mobile of [false,true]){
  const page=await browser.newPage({viewport:mobile?{width:560,height:315}:{width:600,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.route('**/src/main.js',route=>route.fulfill({body:capture.main+expose,contentType:'text/javascript'}));
  await page.addInitScript(profile=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(profile)),capture.createProfile({id:'home_fallback_fixture'}));
  await page.clock.install({time:new Date('2026-10-19T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-20T00:00:00Z'));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(()=>window.__homeFallbackQA?.ready))break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(await page.evaluate(()=>window.__homeFallbackQA?.ready),true);
  for(const [name,width,height,missing]of mobile?[['mobile',560,315,false],['missing-measurement',667,375,true]]:[['narrow-desktop',600,900,false],['desktop',1440,900,false]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
   const info=await page.evaluate(missing=>window.__homeFallbackQA.draw(missing),missing);assert.equal(info.blocked,false);
   if(name==='narrow-desktop'||missing){
    assert.deepEqual(info.region,baseline?null:{x:18,y:height*.29,width:width-36,height:height*.265});
    if(!baseline){const r=info.region,v=info.vehicle;assert.ok(v.x>=r.x-.01&&v.right<=r.x+r.width+.01&&v.y>=r.y-.01&&v.bottom<=r.y+r.height+.01);}
   }else if(name==='mobile'){assert.ok(info.region&&info.region.x>18);}
   else assert.equal(info.region,null);
   await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...info});console.log('CAPTURE',name,JSON.stringify(info));
   await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  }
  if(mobile){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));assert.equal(await page.evaluate(()=>window.__homeFallbackQA.blocked),true);assert.ok(await page.locator('#orientationGate').isVisible());report.portraitGate=true;}
  await page.close();
 }
 assert.deepEqual(report.errors,[]);console.log('HOME FALLBACK QA PASS');
}finally{
 try{await browser?.close();}finally{if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
