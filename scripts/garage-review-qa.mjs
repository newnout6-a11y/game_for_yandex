import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

/** Inspect a real interrupted wheel-to-overview drag, changed car and viewport without cloud writes. */
const root=path.resolve('.'),out=path.resolve('output/garage-review-qa');await mkdir(out,{recursive:true});
const profile=createProfile({id:'garage_review_camera'});profile.ownedVehicles=['rocket','hatch','sedan','suv','van'];
const source=await readFile('src/main.js','utf8');
const expose=`\nwindow.__reviewQA={get ready(){return assetsReady&&garageScene?.ready},get garage(){return garageScene},draw(seconds=0){renderer.resize();garageScene.advance(seconds,{visible:true,reducedMotion:false});garageScene.render(innerWidth,innerHeight,garageFraming());const g=garageScene,c=g.camera,region=garageFraming();return {inspection:g.inspection,vehicle:g.vehicleId,eye:c.position.toArray(),yaw:g.yaw,fov:c.fov,recovery:g.orbitRecovery,motion:g.cameraMotion.active,animating:g.animating,radius:Math.hypot(c.position.x-g.target.x,c.position.z-g.target.z),region,css:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height],points:g.cameraContext.points.map(p=>{const v=p.clone().project(c);return[(v.x+1)*innerWidth/2,(1-v.y)*innerHeight/2];})};}};`;
const sourceHashes=Object.fromEntries(await Promise.all(['src/garage-scene.js','src/garage-screen-player.js'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const report={sourceHashes,method:'Actual controls, prepared game models and native PNGs; isolated local inventory and controlled animation time, not a hardware FPS benchmark.',devices:[],errors:[]};
const server=startServer({root,port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
/** Wait only for the genuine async asset boundary while the animation clock is paused. */
async function ready(page){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(()=>window.__reviewQA?.ready))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Garage readiness timeout');}
/** Assert the real requested geometry remains within its unobstructed UI framing. */
function fits(frame){for(const [x,y]of frame.points){assert.ok(x>=frame.region.x-.1&&x<=frame.region.x+frame.region.width+.1);assert.ok(y>=frame.region.y-.1&&y<=frame.region.y+frame.region.height+.1);}}
/** Save one unscaled native viewport together with camera state for repeatable visual inspection. */
async function capture(page,name,seconds=0){const frame=await page.evaluate(s=>window.__reviewQA.draw(s),seconds);fits(frame);await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});console.log('CAPTURE',name,JSON.stringify(frame));return frame;}
try{
 for(const [device,viewport,mobile]of [['desktop',{width:1440,height:900},false],['mobile',{width:844,height:390},true]]){
  const page=await browser.newPage({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'no-preference'});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await ready(page);const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+5000));
  await page.locator('[data-gs-focus="navigate:garage:fleet"]:visible').first().click();await page.evaluate(()=>window.__reviewQA.draw(2));
  await page.locator('[data-gs-focus="inspectVehicle:wheels"]:visible').click();await page.evaluate(()=>window.__reviewQA.draw(2));
  await page.locator('[data-gs-focus="inspectVehicle:overview"]:visible').click();const interrupted=await page.evaluate(()=>window.__reviewQA.draw(.17));
  const r=interrupted.region,x=r.x+r.width*.5,y=r.y+r.height*.5;
  if(mobile){const session=await page.context().newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+24,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();}
  else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+24,y,{steps:3});await page.mouse.up();}
  const takeover=await capture(page,device+'-drag-takeover');assert.equal(takeover.motion,false);assert.ok(takeover.recovery);
  const recovered=await capture(page,device+'-overview-recovered',.5);assert.equal(recovered.recovery,null);assert.equal(recovered.animating,false);assert.ok(recovered.radius>takeover.radius+.5,'Interrupted close-up returns to overview distance');assert.equal(recovered.yaw,takeover.yaw);
  await page.locator('[data-gs-focus="selectVehicle:van"]:visible').click();const van=await capture(page,device+'-van-adaptive',.5);assert.equal(van.vehicle,'van');assert.equal(van.recovery,null);
  await page.setViewportSize(mobile?{width:740,height:390}:{width:1280,height:720});const resized=await page.evaluate(()=>window.__reviewQA.draw(.5));fits(resized);assert.equal(resized.recovery,null);
  report.devices.push({device,interrupted,takeover,recovered,van,resized});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await page.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('GARAGE REVIEW QA PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
