import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';
import {COSMETICS} from '../src/progression-catalog.js';

/** Inspect actual cosmetic assets and finite camera/material transitions, using an isolated local inventory fixture. */
const out=path.resolve('output/garage-customization-qa');await mkdir(out,{recursive:true});
const fixture=createProfile({id:'customization_inspection'});fixture.wallet.credits=5000;fixture.wallet.totalEarned=4700;fixture.cosmetics.owned=COSMETICS.map(item=>item.id);fixture.garage.level=4;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const source=await readFile('src/main.js','utf8'),errors=[],report={method:'Actual UI and geometry, controlled finite time, isolated unlocked local cosmetics fixture. No FPS claim.',frames:[]};
const expose=`\nwindow.__customQA={get garage(){return garageScene},get ready(){return assetsReady&&garageScene?.ready},draw(){renderer.resize();const r=renderer.renderer;r.info.autoReset=false;r.info.reset();garageScene.render(innerWidth,innerHeight,garageFraming());const info={calls:r.info.render.calls,triangles:r.info.render.triangles,buffer:[r.domElement.width,r.domElement.height],textures:r.info.memory.textures,camera:garageScene.camera.position.toArray(),inspection:garageScene.inspection};r.info.autoReset=true;return info;}};`;
async function wait(page,fn){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Customization ready timeout');}
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));await page.addInitScript(profile=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(profile)),fixture);
 await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}`);await wait(page,()=>window.__customQA?.ready);console.log('assets ready');
 const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+2000));console.log('clock paused');
 const click=id=>page.locator(`[data-gs-focus="${id}"]:visible`).first().click();
 const draw=()=>page.evaluate(()=>window.__customQA.draw());
 const shot=async name=>{const metrics=await draw();console.log('draw',name);await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});
  if(metrics.inspection==='cockpit'){
    const fit=await page.evaluate(()=>{const q=window.__customQA.garage,points=[];q.vehicle.userData.yoke.traverseVisible(node=>{if(!node.isMesh)return;node.geometry.computeBoundingBox();const b=node.geometry.boundingBox;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=b.min.clone().set(x,y,z).applyMatrix4(node.matrixWorld).project(q.camera);points.push({x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2});}});const top=document.querySelector('.gs-stage-heading').getBoundingClientRect().bottom,bottom=document.querySelector('.gs-stage-bottom').getBoundingClientRect().top;return {minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),top,bottom};});
    assert.ok(fit.minY>=fit.top&&fit.maxY<=fit.bottom,'Whole steering wheel stays between heading and inspection controls');metrics.wheelFit=fit;
  }
  report.frames.push({name,...metrics});console.log('capture',name);};
 const advance=seconds=>page.evaluate(dt=>window.__customQA.garage.advance(dt,{visible:true,reducedMotion:false}),seconds);
 if(process.env.COCKPIT_ONLY==='1'){
  await click('navigate:garage:fleet');await click('navigate:garage:style');await click('_local:cockpit:atelierCategory');await advance(2);await click('equipCosmetic:steering_round:cockpit.steering');await shot('final-desktop-cockpit');
  await page.setViewportSize({width:844,height:390});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await advance(2);await shot('final-landscape-cockpit');
 }else{
 await click('navigate:garage:fleet');await click('navigate:garage:style');await advance(2);await shot('desktop-atelier-board');
 await click('_local:wheels:atelierCategory');await shot('rims-camera-start');await advance(.425);await shot('rims-camera-mid');await advance(1);await shot('rims-camera-close');
 assert.equal(await page.evaluate(()=>window.__customQA.garage.inspection),'wheels');
 await click('equipCosmetic:rim_rose:wheels.finish');await page.evaluate(()=>window.__customQA.garage.setRimProgress(.5));await shot('rims-paint-mid');
 await page.evaluate(()=>{window.__customQA.garage.setRimProgress(null);window.__customQA.garage.advance(2);});await shot('rims-paint-finished');
 await click('_local:cockpit:atelierCategory');await advance(2);await shot('cockpit-stock');
 for(const id of ['steering_round','steering_yoke']){const button=page.locator(`[data-gs-focus="equipCosmetic:${id}:cockpit.steering"]:visible`);if(await button.count()&&await button.isEnabled()){await button.click();await shot('cockpit-'+id);}else report.unavailable=(report.unavailable||[]).concat(id);}
 await click('_local:body:atelierCategory');await advance(2);await click('_local:glass:atelierBodySection');await click('equipCosmetic:tint_smoke:body.tint');await shot('body-glass-tint');
 await page.setViewportSize({width:844,height:390});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await click('_local:wheels:atelierCategory');await advance(2);await shot('landscape-rims');
 await click('_local:cockpit:atelierCategory');await advance(2);await shot('landscape-cockpit');
 }
 report.errors=errors;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log('CUSTOMIZATION QA PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));}
