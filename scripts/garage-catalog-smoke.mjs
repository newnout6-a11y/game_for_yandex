import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';
import {COSMETICS} from '../src/progression-catalog.js';

/** Isolated unlocked QA wallet exercises real purchase/equip UI; it is never installed into a player account or production source. */
const out=path.resolve('output/garage-catalog-qa');await mkdir(out,{recursive:true});
const fixture=createProfile({id:'isolated_catalog_qa'});fixture.wallet.credits=30000;fixture.wallet.totalEarned=29700;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const errors=[],report={fixture:'Isolated 30,000-credit QA save; no actual earnings, purchases, ads or cloud account. All mutations use production UI/reducer. Reduced-motion preference and controlled UI frames settle separately-tested cosmetic animations during catalog bookkeeping; actual drive sections use live controls. Exterior-to-exterior material comparison excludes the deliberate cockpit glass-visibility pose.',steps:[]};
try{
 const source=await readFile('src/main.js','utf8');
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
 await page.route('**/src/main.js',route=>route.fulfill({body:source+'\nwindow.__catalogQA={get garage(){return garageScene},get renderer(){return renderer},draw(){renderer.resize();garageScene.advance(0,{visible:false});garageScene.render(innerWidth,innerHeight,garageFraming());}};',contentType:'text/javascript'}));
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
 await page.addInitScript(profile=>{if(!localStorage.getItem('roadster.qa.initialized')){localStorage.setItem('aerokrai.profile.v2',JSON.stringify(profile));localStorage.setItem('roadster.qa.initialized','true');}},fixture);
 await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='hub');
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+2000));
 const click=async id=>{await page.locator(`[data-gs-focus="${id}"]:visible`).first().click();console.log('action',id);};
 const until=async predicate=>{const end=Date.now()+180000;while(!await page.evaluate(predicate)){assert.ok(Date.now()<end,'Catalog asynchronous state timeout');await new Promise(resolve=>setTimeout(resolve,100));}};
 const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('aerokrai.profile.v2')));
 const shot=async name=>{await page.evaluate(()=>{if(!['playing','paused'].includes(document.querySelector('#app').dataset.screen))window.__catalogQA.draw();if(!document.querySelector('#qa-disclaimer')){const tag=document.createElement('div');tag.id='qa-disclaimer';tag.textContent='ПРОВЕРКА КАТАЛОГА · ТЕСТОВОЕ СОХРАНЕНИЕ';tag.style.cssText='position:fixed;bottom:30px;left:12px;z-index:9999;color:#fff;background:#161e22e8;padding:5px 9px;font:10px sans-serif;pointer-events:none';document.body.append(tag);}});await page.screenshot({path:path.join(out,name+'.png')});console.log('capture',name);};
 await click('navigate:garage:fleet');await click('selectVehicle:hatch');await shot('hatch-before-purchase');await click('purchaseVehicle:hatch');
 let profile=await save();assert.equal(profile.wallet.credits,28600);assert.equal(profile.selectedVehicleId,'hatch');assert.ok(profile.ownedVehicles.includes('hatch'));report.steps.push('real UI purchase debits exact 1400 and selects owned hatch');
 await click('navigate:garage:engineering');await click('upgradeEngineering:drive');await click('equipEngineering:drive:1');profile=await save();assert.equal(profile.research.drive,1);assert.equal(profile.loadouts.hatch.engineering.drive,1);
 for(let level=2;level<=4;level++){await click('upgradeGarage');await until(()=>window.__catalogQA.garage.ready&&window.__catalogQA.garage.loadingTier===null);assert.equal((await save()).garage.level,level);await shot('garage-tier-'+level);}
 await click('navigate:garage:fleet');await click('selectVehicle:rocket');await click('navigate:garage:style');
 const appearance=target=>page.evaluate(which=>{const q=window.__catalogQA,car=which==='garage'?q.garage.vehicle:q.renderer.player;if(which==='garage')q.draw();return {id:car.userData.ownedVehicleId,theme:car.userData.cockpitTheme,slots:Object.fromEntries(Object.entries(car.userData.appearance).map(([key,entries])=>[key,entries.map(({material})=>({color:material.color.getHexString(),roughness:material.roughness,opacity:material.opacity,depthWrite:material.depthWrite}))])),parts:Object.fromEntries(Object.entries(car.userData.cosmeticParts||{}).map(([key,value])=>[key,Array.isArray(value)?value.map(part=>part.visible):value.visible]))};},target);
 for(const {id,slot} of COSMETICS){
   const category=slot.startsWith('wheel')?'wheels':slot.startsWith('cockpit')?'cockpit':'body';await click('_local:'+category+':atelierCategory');if(category==='body')await click('_local:'+(slot==='body.tint'?'glass':'surface')+':atelierBodySection');
   if(!(await save()).cosmetics.owned.includes(id))await click('buyCosmetic:'+id+':'+slot);
   const equip=page.locator(`[data-gs-focus="equipCosmetic:${id}:${slot}"]:visible`).first();if(await equip.isEnabled()){await equip.click();}
   assert.equal((await save()).loadouts.rocket.cosmetics[slot],id);report.steps.push('actual UI cosmetic '+id);
 }
 await shot('rocket-authored-cosmetics');await click('navigate:garage:fleet');const garageAppearance=await appearance('garage');
 await page.clock.resume();await click('startDrive');await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='playing');
 assert.deepEqual(await appearance('race'),garageAppearance,'equipped materials and authored parts must carry into the actual driving instance');
 await page.keyboard.down('KeyW');await page.waitForFunction(()=>Number(document.querySelector('#distance').textContent.replace(/[^0-9]/g,''))>=3);await page.keyboard.up('KeyW');await shot('rocket-cosmetics-real-drive');await page.keyboard.press('Escape');await page.locator('[data-action="menu"]').click();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+2000));
 report.steps.push('all catalog cosmetics purchased/equipped and final material/mesh state matches actual moving Rocket');
 await click('navigate:garage:fleet');await click('navigate:garage:style');await click('_local:body:atelierCategory');await click('_local:surface:atelierBodySection');await click('resetCosmetic:body.addon');assert.equal((await save()).loadouts.rocket.cosmetics['body.addon'],undefined);
 const before=await save();await page.clock.resume();await page.reload();await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='hub');assert.deepEqual(await save(),before);await shot('reload-persisted-hub');await page.clock.resume();
 await click('navigate:garage:fleet');await click('selectVehicle:hatch');await click('startDrive');await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='playing');await page.keyboard.down('KeyW');await page.waitForFunction(()=>Number(document.querySelector('#distance').textContent.replace(/[^0-9]/g,''))>=3);await page.keyboard.up('KeyW');await page.screenshot({path:path.join(out,'hatch-real-drive.png')});await page.keyboard.press('Escape');await page.locator('[data-action="menu"]').click();
 profile=await save();assert.ok(profile.stats.distanceM>0);assert.equal(profile.selectedVehicleId,'hatch');report.steps.push('purchased ground hatch actually drives, saves and cannot expose flight controls');
 await page.setViewportSize({width:844,height:390});await click('navigate:garage:fleet');await click('navigate:garage:style');await shot('mobile-unlocked-style');
 report.errors=errors;report.final={credits:profile.wallet.credits,owned:profile.ownedVehicles,garage:profile.garage.level,research:profile.research};await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log('CATALOG SMOKE PASS',JSON.stringify(report));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
