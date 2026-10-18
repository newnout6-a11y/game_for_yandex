import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile,reduceProgression} from '../src/progression.js';
import {COSMETICS} from '../src/progression-catalog.js';

/** Controlled inspection uses production UI/reducer/models. The unlocked local save is an explicit isolated QA fixture, never a cloud grant. */
const out=path.resolve('output/garage-final-visual');await mkdir(out,{recursive:true});
let fixture=createProfile({id:'garage_visual_only'});fixture.wallet.credits=50000;fixture.wallet.totalEarned=49700;
const capabilities={'body.splitter':true,'body.louver':true,'wheels.turbine':true,'rims.copperAccent':true,'cockpit.stitch':true};
const dispatch=action=>{const r=reduceProgression(fixture,action,{capabilities});assert.ok(r.ok,JSON.stringify([action,r.reason]));fixture=r.profile;};
for(const vehicleId of ['hatch','sedan','suv','van'])dispatch({type:'BUY_VEHICLE',vehicleId});for(let n=0;n<3;n++)dispatch({type:'UPGRADE_GARAGE'});
for(const item of COSMETICS)if(!fixture.cosmetics.owned.includes(item.id))dispatch({type:'BUY_COSMETIC',cosmeticId:item.id,vehicleId:'rocket'});
for(const cosmeticId of ['paint_copper','finish_satin','body_louver','wheel_turbine','rim_copper','cockpit_amber','cockpit_stitch'])dispatch({type:'EQUIP_COSMETIC',cosmeticId,vehicleId:'rocket'});
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const errors=[],report={method:'Actual production UI/assets with isolated unlocked local test profile; native screenshots, controlled inspection, no FPS claim.',frames:[]};
const source=await readFile('src/main.js','utf8');
const expose='\nwindow.__garageQA={get game(){return game},get renderer(){return renderer},get garage(){return garageScene},get screen(){return screen},get assetsReady(){return assetsReady},get lifecycle(){return lifecycle},get input(){return input},get telemetry(){return telemetry},get profile(){return profileStore.get()},get orientationBlocked(){return orientationBlocked},framing:garageFraming};';
/** Wait against the host clock so a deliberately paused browser clock cannot stall inspection. */
async function wait(page,fn){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,150));}throw new Error('QA condition timeout: '+fn);}
async function prepare(page){page.setDefaultTimeout(30000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});await page.route('**/src/main.js',r=>r.fulfill({body:source+expose,contentType:'text/javascript'}));await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),fixture);await page.clock.install();console.log('loading viewport',await page.viewportSize());await page.goto('http://127.0.0.1:'+server.address().port);console.log('document loaded');await wait(page,()=>window.__garageQA?.assetsReady&&window.__garageQA.garage?.ready);console.log('assets ready');const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+50));}
async function click(page,id){await page.locator(`[data-gs-focus="${id}"]:visible`).first().click();console.log('action',id);}
async function shot(page,name){const metrics=await page.evaluate(()=>{const q=window.__garageQA,w=q.renderer;w.resize();const r=w.renderer;r.info.autoReset=false;r.info.reset();if(!q.orientationBlocked)q.garage.render(innerWidth,innerHeight,q.framing());let tag=document.querySelector('#qa-catalog');if(!tag){tag=document.createElement('div');tag.id='qa-catalog';tag.textContent='ОСМОТР РАЗБЛОКИРОВАННОГО КАТАЛОГА · ТЕСТОВОЕ СОХРАНЕНИЕ';tag.style.cssText='position:fixed;bottom:2px;left:8px;z-index:999;color:#d9e8ed;background:#162027bb;padding:3px 7px;font:9px sans-serif;pointer-events:none';document.body.append(tag);}const m={css:[innerWidth,innerHeight],buffer:[r.domElement.width,r.domElement.height],calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures,orientationBlocked:q.orientationBlocked};r.info.autoReset=true;return m;});await page.screenshot({path:path.join(out,name+'.png')});report.frames.push({name,...metrics});console.log('capture',name,JSON.stringify(metrics));}
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});await prepare(page);
 await click(page,'navigate:garage:fleet');await click(page,'navigate:garage:style');await shot(page,'desktop-style-overview');
 for(const view of ['rear','wheels','cockpit']){await click(page,'inspectVehicle:'+view);await shot(page,'desktop-inspection-'+view);}
 await click(page,'inspectVehicle:overview');await click(page,'navigate:garage:season');await shot(page,'desktop-season');
 await page.close();
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});await prepare(mobile);assert.ok(await mobile.locator('#orientationGate').isVisible());await shot(mobile,'mobile-portrait-gate');
 await mobile.setViewportSize({width:844,height:390});await mobile.evaluate(()=>window.dispatchEvent(new Event('resize')));await wait(mobile,()=>!window.__garageQA.orientationBlocked);await shot(mobile,'mobile-landscape-hub');
 await click(mobile,'navigate:garage:fleet');await click(mobile,'navigate:garage:style');await shot(mobile,'mobile-landscape-style');await click(mobile,'inspectVehicle:wheels');await shot(mobile,'mobile-landscape-wheels');
 await mobile.setViewportSize({width:932,height:430});await mobile.evaluate(()=>window.dispatchEvent(new Event('resize')));await click(mobile,'inspectVehicle:cockpit');await shot(mobile,'mobile-landscape-cockpit');
 report.overflow=await mobile.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(report.overflow.scroll<=report.overflow.w+1);await mobile.close();
 report.errors=errors;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log('GARAGE VISUAL PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));}
