import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

/** Real production models, controls and renderer; private local save, no SDK writes. */
const out=path.resolve(process.env.FLEET_QA_OUT||'output/garage-live-miniatures');await mkdir(out,{recursive:true});
const source=await readFile('src/main.js','utf8');
const profile=createProfile({id:'fleet_miniature_native_qa'});profile.ownedVehicles=['rocket','hatch','sedan','suv','van'];profile.loadouts.hatch={cosmetics:{'body.paint':'paint_graphite'}};
const expose=`\nwindow.__fleetQA={get ready(){return assetsReady&&garageScene?.ready&&fleetMiniatures},get blocked(){return orientationBlocked},get profile(){return profileStore.get()},state(){return {active:fleetMiniatures.activeId,visible:fleetMiniatures.visible,paused:fleetMiniatures.paused,scope:fleetMiniatures.scopeKey,pending:!!fleetMiniatures.pending,async:fleetMiniatures.asyncReadback,records:[...fleetMiniatures.records.values()].map(r=>({id:r.id,yaw:r.yaw,visible:r.visible,ready:!!r.pixels,failed:r.failed,appearance:r.appearance,triangles:r.vehicle?(()=>{let n=0;r.vehicle.traverseVisible(m=>{if(m.isMesh)n+=(m.geometry.index?.count||m.geometry.attributes.position.count)/3});return n})():0})),pixelRatio:renderer.renderer.getPixelRatio(),devicePixelRatio,buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height]}}};`;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={method:'Actual native production UI and shared-renderer GLB clones. Real pointer/focus/touch controls; software rendering, not a hardware FPS benchmark.',frames:[],errors:[]};
/** Wait for a bounded observable state, not a presumed load duration. */
async function wait(page,fn){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Fleet QA readiness timeout: '+await page.evaluate(()=>JSON.stringify(window.__fleetQA?.state())));}
/** Snapshot pixels, native row layout, real model yaw and render readiness together. */
async function shot(page,name){const data=await page.evaluate(()=>({state:window.__fleetQA.state(),rows:[...document.querySelectorAll('[data-fleet-id]')].map(n=>{const r=n.getBoundingClientRect(),c=n.querySelector('canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let solid=0,hash=0;for(let i=0;i<p.length;i+=4){if(p[i+3]>32)solid++;hash=(Math.imul(hash,31)+p[i]+p[i+1]*3+p[i+2]*7+p[i+3])>>>0}return {id:n.dataset.fleetId,x:r.x,y:r.y,width:r.width,height:r.height,canvas:[c.width,c.height],solid,hash,status:c.parentElement.dataset.state,text:n.textContent}}),overflow:document.documentElement.scrollWidth-innerWidth,title:document.querySelector('.gs-vehicle-title').textContent}));assert.ok(data.overflow<=1);await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...data});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name,JSON.stringify(data));return data;}
try{
 for(const mobile of (process.env.FLEET_ONLY_MOBILE?[true]:[false,true])){
  const page=await browser.newPage({viewport:mobile?{width:844,height:390}:{width:1440,height:900},deviceScaleFactor:mobile?Number(process.env.FLEET_MOBILE_DPR||1):1,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/main.js',r=>r.fulfill({body:source+expose,contentType:'text/javascript'}));await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
  await page.goto('http://127.0.0.1:'+server.address().port);await wait(page,()=>!!window.__fleetQA?.ready);
  await page.locator('[data-gs-focus="navigate:garage:fleet"]:visible').first().click();if(mobile)await page.locator('[data-fleet-id="rocket"]').scrollIntoViewIfNeeded();
  await wait(page,()=>window.__fleetQA.state().records.some(r=>r.visible)&&window.__fleetQA.state().records.filter(r=>r.visible).every(r=>r.ready));
  const before=await shot(page,(mobile?'mobile':'desktop')+'-fleet-idle');
  for(const r of before.rows.filter(r=>r.status==='ready'))assert.ok(r.solid>1000,'Real nonempty model '+r.id);
  const saved=await page.evaluate(()=>window.__fleetQA.profile);
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(!mobile){
   await page.locator('[data-fleet-id="rocket"]').hover();await wait(page,()=>window.__fleetQA.state().records.find(r=>r.id==='rocket')?.yaw>.27&&!window.__fleetQA.state().pending);
   const hovered=await shot(page,'desktop-rocket-hover');assert.notEqual(hovered.rows[0].hash,before.rows[0].hash);assert.deepEqual(await page.evaluate(()=>window.__fleetQA.profile),saved);
   await page.locator('[data-fleet-id="hatch"]').focus();await page.mouse.move(600,100);await wait(page,()=>window.__fleetQA.state().active==='hatch'&&window.__fleetQA.state().records.find(r=>r.id==='hatch')?.yaw>.27);
   await shot(page,'desktop-hatch-keyboard');assert.deepEqual(await page.evaluate(()=>window.__fleetQA.profile),saved);await page.locator('[data-fleet-id="van"]').scrollIntoViewIfNeeded();await wait(page,()=>window.__fleetQA.state().records.find(r=>r.id==='van')?.ready);await shot(page,'desktop-all-five-models');
  }else{
   await page.locator('[data-fleet-id="hatch"]').tap();await wait(page,()=>document.querySelector('.gs-vehicle-title').textContent==='Клин H2');await wait(page,()=>window.__fleetQA.state().records.filter(r=>r.visible).every(r=>r.ready));await wait(page,()=>window.__fleetQA.state().records.find(r=>r.id==='hatch')?.yaw>.20);await shot(page,'mobile-hatch-selected');await wait(page,()=>window.__fleetQA.state().active===null&&window.__fleetQA.state().records.find(r=>r.id==='hatch')?.yaw<-.57);await page.locator('[data-fleet-id="sedan"]').tap();await wait(page,()=>window.__fleetQA.state().records.find(r=>r.id==='sedan')?.yaw>.20);await wait(page,()=>window.__fleetQA.state().active===null&&window.__fleetQA.state().records.find(r=>r.id==='sedan')?.yaw<-.57);report.successiveTouchReturns=true;
   await page.locator('[data-fleet-id="van"]').scrollIntoViewIfNeeded();await wait(page,()=>window.__fleetQA.state().records.find(r=>r.id==='van')?.ready);await shot(page,'mobile-fleet-lower');
   await page.setViewportSize({width:390,height:844});await wait(page,()=>window.__fleetQA.blocked);assert.ok(await page.locator('#orientationGate').isVisible());await wait(page,()=>window.__fleetQA.state().paused);report.portraitPause=true;
  }
  await page.close();
 }
 assert.deepEqual(report.errors,[]);console.log('LIVE FLEET MINIATURE QA PASS');await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
