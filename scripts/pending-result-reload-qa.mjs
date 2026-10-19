import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

// Isolated local browser profile. Only the SDK transport is mocked; no live ad/account is contacted.
const out=path.resolve(process.env.QA_OUTPUT||'output/pending-result-reload-qa');await mkdir(out,{recursive:true});
const source=await readFile('src/main.js','utf8');
const expose=`\nwindow.__recoveryQA={get ready(){return assetsReady&&garageScene?.ready},get profile(){return profileStore.get()},get result(){return runResult},get screen(){return screen},get phase(){return game.state.phase},get busy(){return busy},get paused(){return lifecycle.has('ad')},async crash(){await startRun();game.state.nextSpawn=game.state.nextEvent=Infinity;game.state.traffic=[];game.state.obstacles=[];for(let i=0;i<1000;i++){game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}game.crash();showResults();},draw(){renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true});garageScene.render(innerWidth,innerHeight,garageFraming());}};`;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={method:'Actual local app, real page.reload and localStorage, production controller/game/results/renderer; only SDK rewarded callback transport is synthetic. No real account or ads.',viewports:[],errors:[]};
/** Wait for real model loading without advancing the deliberately paused render clock. */
async function ready(page){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(()=>window.__recoveryQA?.ready))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Assets not ready');}
/** Inspect viewport hit targets, actual rendered notes and receipt without modifying them. */
async function inspect(page){return page.evaluate(()=>{const qa=window.__recoveryQA;return{screen:qa.screen,phase:qa.phase,profile:qa.profile,result:qa.result,requests:window.__testAdRequests,note:document.querySelector('.gs-result-free-choice .gs-small-note')?.textContent,noteVisible:(()=>{const e=document.querySelector('.gs-recovery-note'),r=e?.getBoundingClientRect();return !!e&&getComputedStyle(e).display!=='none'&&r.height>0&&r.y>=0&&r.bottom<=innerHeight;})(),choices:[...document.querySelectorAll('.gs-finish-free,[data-gs-focus="rewardedBonus"]')].map(e=>{const r=e.getBoundingClientRect();return{label:e.textContent,x:r.x,y:r.y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};});}
/** Reload the document, preserving its isolated storage and verifying the real new controller starts. */
async function reload(page){await page.reload();await ready(page);await page.evaluate(()=>window.__recoveryQA.draw());}
try{
 for(const [width,height]of (process.env.QA_VIEWPORTS?JSON.parse(process.env.QA_VIEWPORTS):[[1440,900],[667,375]])){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:width<900,hasTouch:width<900});page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));
  await page.addInitScript(profile=>{if(!localStorage.getItem('aerokrai.profile.v2'))localStorage.setItem('aerokrai.profile.v2',JSON.stringify(profile));window.__testAdRequests=0;window.YaGames={init:async()=>({adv:{showRewardedVideo(options){window.__testAdRequests++;window.__testAdCallbacks=options.callbacks;},showFullscreenAdv(options){options.callbacks.onClose(false);}}})};},createProfile({id:'isolated_reload_fixture'}));
  await page.clock.install({time:new Date('2026-10-18T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-18T12:01:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);await ready(page);
  await page.evaluate(()=>window.__recoveryQA.crash());const before=await page.evaluate(()=>window.__recoveryQA.profile);await reload(page);
  const restored=await inspect(page);assert.equal(restored.screen,'results');assert.equal(restored.phase,'ready');assert.deepEqual(restored.profile,before);assert.equal(restored.result.recovered,true);assert.equal(restored.result.canRevive,false);assert.equal(restored.result.bonusEligible,true);assert.match(restored.note,/После перезагрузки продолжение недоступно/);assert.equal(restored.requests,0);assert.equal(restored.noteVisible,true);assert.equal(await page.locator('[data-gs-focus="revive"]').count(),0);
  assert.equal(restored.choices.length,2);for(const c of restored.choices){assert.ok(c.hit,c.label);assert.ok(c.y>=0&&c.y+c.height<=height,c.label);assert.ok(c.height>=44,c.label);}
  await page.screenshot({path:path.join(out,`restored-${width}x${height}.png`),timeout:180000});console.log('Restored visible',width,height);
  await page.locator('[data-gs-focus="rewardedBonus"]').click();assert.equal(await page.evaluate(()=>window.__testAdRequests),1);await page.evaluate(()=>{window.__testAdCallbacks.onOpen();window.__testAdCallbacks.onRewarded();window.__testAdCallbacks.onClose(true);});
  const doubled=await page.evaluate(()=>window.__recoveryQA.profile);assert.equal(doubled.wallet.credits,before.wallet.credits+restored.result.bonusCredits);assert.deepEqual(doubled.stats,before.stats);assert.equal(doubled.ledger.activeRun,null);
  await reload(page);assert.equal(await page.evaluate(()=>window.__recoveryQA.screen),'hub');assert.deepEqual(await page.evaluate(()=>window.__recoveryQA.profile),doubled);
  if(width===1440){
   await page.evaluate(()=>window.__recoveryQA.crash());await page.locator('[data-gs-focus="revive"]').click();await page.evaluate(()=>{window.__testAdCallbacks.onRewarded();window.__testAdCallbacks.onClose(true);});
   assert.equal(await page.evaluate(()=>window.__recoveryQA.screen),'playing');const continued=await page.evaluate(()=>window.__recoveryQA.profile);assert.equal(continued.ledger.activeRun.resultPending,false);await reload(page);
   const interrupted=await inspect(page);assert.equal(interrupted.result.recoveryKind,'interrupted');assert.equal(interrupted.result.canRevive,false);assert.equal(interrupted.result.bonusEligible,false);assert.deepEqual(interrupted.profile,continued);
   await page.screenshot({path:path.join(out,'interrupted-1440x900.png'),timeout:180000});
   await page.locator('.gs-finish-free').click();const finished=await page.evaluate(()=>window.__recoveryQA.profile);await reload(page);assert.equal(await page.evaluate(()=>window.__recoveryQA.screen),'hub');assert.deepEqual(await page.evaluate(()=>window.__recoveryQA.profile),finished);
   await page.evaluate(()=>window.__recoveryQA.crash());const pending=await page.evaluate(()=>window.__recoveryQA.profile);await page.locator('[data-gs-focus="rewardedBonus"]').click();await page.evaluate(()=>window.__testAdCallbacks.onOpen());await reload(page);
   assert.deepEqual(await page.evaluate(()=>window.__recoveryQA.profile),pending);assert.equal(await page.evaluate(()=>window.__recoveryQA.result.bonusEligible),true);assert.equal(await page.evaluate(()=>window.__testAdRequests),0);assert.equal(await page.evaluate(()=>window.__recoveryQA.busy||window.__recoveryQA.paused),false);
  }
  report.viewports.push(restored);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('PASS',width,height);await page.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({...report,passed:true},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
