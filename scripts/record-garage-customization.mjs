/** Record actual finite rim-camera travel and local-Z recoloring; controlled 24 Hz, not a real-time FPS benchmark. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';
import {COSMETICS} from '../src/progression-catalog.js';
const out=path.resolve('output/garage-customization-video');await mkdir(path.join(out,'frames'),{recursive:true});
const profile=createProfile({id:'recorded_customization_fixture'});profile.wallet.credits=5000;profile.wallet.totalEarned=4700;profile.cosmetics.owned=COSMETICS.map(item=>item.id);profile.garage.level=4;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const source=await readFile('src/main.js','utf8'),errors=[];
const hook=`\nwindow.__garageFilm={get ready(){return assetsReady&&garageScene?.ready},get garage(){return garageScene},draw(){renderer.resize();garageScene.render(innerWidth,innerHeight,garageFraming());}};`;
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});page.setDefaultTimeout(180000);
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/src/main.js',route=>route.fulfill({body:source+hook,contentType:'text/javascript'}));await page.addInitScript(value=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(value)),profile);
 await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const deadline=Date.now()+180000;while(!await page.evaluate(()=>window.__garageFilm?.ready)){assert.ok(Date.now()<deadline,'Assets must finish loading');await new Promise(resolve=>setTimeout(resolve,100));}
 const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+2000));
 const click=id=>page.locator(`[data-gs-focus="${id}"]:visible`).first().click();
 await click('navigate:garage:fleet');await click('navigate:garage:style');await page.evaluate(()=>window.__garageFilm.garage.advance(2));await click('_local:wheels:atelierCategory');
 for(let frame=0;frame<108;frame++){
  if(frame===24)await click('equipCosmetic:rim_rose:wheels.finish');
  if(frame===60){await click('_local:cockpit:atelierCategory');await click('equipCosmetic:steering_round:cockpit.steering');}
  await page.evaluate(()=>{for(const animation of document.getAnimations())animation.pause();window.__garageFilm.garage.advance(1/24,{visible:true,reducedMotion:false});window.__garageFilm.draw();});
  await page.screenshot({path:path.join(out,'frames',`${String(frame).padStart(4,'0')}.png`),timeout:180000});
  if(frame%12===0)console.log(`customization frames ${frame+1}/108`);
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({method:'Actual production UI/material shader and camera; isolated owned-cosmetics fixture; controlled 24 Hz, not measured FPS.',frames:108,fps:24,durationSeconds:4.5,viewport:[1280,720],errors},null,2));console.log('CUSTOMIZATION VIDEO FRAMES PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
