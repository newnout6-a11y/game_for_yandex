import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';

/** Exercise the real entry, garage and drive controller; fixture wallets are never installed in production. */
const out=path.resolve(process.env.GARAGE_QA_OUT||'output/garage-milestone');await mkdir(out,{recursive:true});
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const errors=[],report={method:'Actual browser UI. No production source changes or fake purchase callbacks.',screens:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
  page.on('console',m=>{if(m.type()==='error'){console.log('CONSOLE',m.text());if(!/favicon/.test(m.text()))errors.push(m.text());}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='hub');
  await page.screenshot({path:path.join(out,'desktop-hub.png')});console.log('desktop hub captured');
  await page.locator('[data-gs-focus="navigate:garage:fleet"]').first().click();
  await page.screenshot({path:path.join(out,'desktop-fleet.png')});console.log('fleet captured');
  for(const tab of (process.env.QUICK_GARAGE_QA?[]:['style','engineering','contracts','season','telemetry'])){
    await page.locator(`[data-gs-focus="navigate:garage:${tab}"]`).first().click();
    await page.screenshot({path:path.join(out,`desktop-${tab}.png`)});report.screens.push(tab);console.log(tab,'captured');
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-fleet.png')});console.log('mobile fleet captured');
  await page.locator('[data-gs-focus="navigate:hub"]:visible').first().click();await page.screenshot({path:path.join(out,'mobile-hub.png')});console.log('mobile hub captured');
  await page.setViewportSize({width:1440,height:900});
  console.log('starting actual drive');await page.locator('[data-gs-focus="startDrive"]:visible').first().click();console.log('drive clicked');
  await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='playing');
  await page.keyboard.down('KeyW');await page.waitForFunction(()=>Number(document.querySelector('#distance').textContent.replace(/[^0-9]/g,''))>=3);console.log('actual driving distance reached');await page.keyboard.up('KeyW');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#app').getAttribute('data-screen'),'paused');
  await page.screenshot({path:path.join(out,'desktop-drive-pause.png')});
  await page.locator('[data-action="menu"]').click();await page.waitForFunction(()=>document.querySelector('#app').dataset.screen==='hub');
  const profile=await page.evaluate(()=>JSON.parse(localStorage.getItem('aerokrai.profile.v2')));assert.equal(profile.selectedVehicleId,'rocket');assert.ok(profile.stats.runs>=1);assert.ok(profile.stats.distanceM>0);report.profile={credits:profile.wallet.credits,runs:profile.stats.runs,distanceM:profile.stats.distanceM};
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-hub.png')});
  await page.locator('[data-gs-focus="navigate:garage:fleet"]').first().click();await page.screenshot({path:path.join(out,'mobile-fleet.png')});
  report.overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(report.overflow.scroll<=report.overflow.width+1);
  report.errors=errors;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log('GARAGE SMOKE PASS',JSON.stringify(report));
}finally{await browser.close();await new Promise(r=>server.close(r));}
