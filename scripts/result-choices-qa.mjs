import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

// Local isolated QA only: the SDK transport is a visibly reported test fixture, never shipped or contacted.
const out=path.resolve('output/result-choices-qa');await mkdir(out,{recursive:true});
const source=await readFile('src/main.js','utf8');
const expose=`\nwindow.__resultsQA={get ready(){return assetsReady&&garageScene?.ready},get profile(){return profileStore.get()},get result(){return runResult},get screen(){return screen},async crash(){await startRun();game.state.nextSpawn=game.state.nextEvent=Infinity;game.state.traffic=[];game.state.obstacles=[];for(let i=0;i<1000;i++){game.update(.05,{throttle:1});telemetry.observe(game.state,.05);}game.crash();showResults();},draw(){renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true});garageScene.render(innerWidth,innerHeight,garageFraming());}};`;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={method:'Actual presenter/controller/game integrator, isolated local profile, explicit mock SDK transport with manually confirmed reward callbacks. No real advertisement or account.',viewports:[],errors:[]};
try{
 for(const [width,height]of (process.env.QA_VIEWPORTS?JSON.parse(process.env.QA_VIEWPORTS):[[1440,900],[844,390],[667,375]])){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:width<900,hasTouch:width<900});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));
  await page.addInitScript(profile=>{localStorage.setItem('aerokrai.profile.v2',JSON.stringify(profile));window.__testAdRequests=0;window.YaGames={init:async()=>({adv:{showRewardedVideo(options){window.__testAdRequests++;window.__testAdCallbacks=options.callbacks;},showFullscreenAdv(options){options.callbacks.onClose(false);}}})};},createProfile({id:'result_qa_fixture'}));
  await page.clock.install({time:new Date('2026-10-18T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-18T12:01:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
  const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(()=>window.__resultsQA?.ready))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await page.evaluate(()=>window.__resultsQA?.ready),true);
  await page.evaluate(()=>window.__resultsQA.crash());await page.evaluate(()=>window.__resultsQA.draw());
  const layout=await page.evaluate(()=>{
    const free=document.querySelector('.gs-finish-free'),scroll=document.querySelector('.gs-settlement-scroll'),panel=document.querySelector('.gs-settlement'),box=free.getBoundingClientRect(),centre={x:box.x+box.width/2,y:box.y+box.height/2};
    const choices=[free,...['revive','rewardedBonus'].map(id=>document.querySelector('[data-gs-focus="'+id+'"]')).filter(Boolean)].map(e=>{const r=e.getBoundingClientRect();return{label:e.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}});return {choices,viewport:[innerWidth,innerHeight],free:{x:box.x,y:box.y,width:box.width,height:box.height},hit:free.contains(document.elementFromPoint(centre.x,centre.y)),freeOutsideScroll:!scroll.contains(free),firstPanelChild:panel.firstElementChild.className,result:window.__resultsQA.result};
  });
  assert.equal(layout.hit,true);assert.equal(layout.freeOutsideScroll,true);assert.equal(layout.firstPanelChild,'gs-result-free-choice');assert.ok(layout.free.y>=0&&layout.free.y+layout.free.height<=height);assert.ok(layout.free.height>=44);assert.equal(layout.choices.length,3);for(const choice of layout.choices){assert.ok(choice.hit,choice.label);assert.ok(choice.y>=0&&choice.y+choice.height<=height,choice.label);assert.ok(choice.height>=44,choice.label);}
  await page.screenshot({path:path.join(out,`results-${width}x${height}.png`),timeout:180000});
  await page.locator('[data-gs-focus="rewardedBonus"]').scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>({credits:window.__resultsQA.profile.wallet.credits,base:window.__resultsQA.result.receipt.baseCredits}));
  await page.locator('[data-gs-focus="rewardedBonus"]').click();
  assert.equal(await page.evaluate(()=>window.__testAdRequests),1);
  await page.evaluate(()=>{window.__testAdCallbacks.onRewarded();window.__testAdCallbacks.onClose(true);});
  assert.equal(await page.evaluate(()=>window.__resultsQA.profile.wallet.credits),before.credits+before.base);
  assert.equal(await page.evaluate(()=>window.__resultsQA.result.finalized),true);assert.equal(await page.locator('[data-gs-focus="rewardedBonus"]').count(),0);
  await page.evaluate(()=>window.__resultsQA.draw());await page.screenshot({path:path.join(out,`doubled-${width}x${height}.png`),timeout:180000});
  report.viewports.push(layout);await writeFile(path.join(out,`report-${width}x${height}.json`),JSON.stringify({...report,viewports:[layout]},null,2));console.log('PASS',width,height,JSON.stringify(layout.free));await page.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
