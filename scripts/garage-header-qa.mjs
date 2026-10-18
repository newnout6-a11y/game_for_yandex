import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

/** Native production garage captures; only a local tier-four inspection save and read-only diagnostics are injected. */
const out=path.resolve(process.env.HEADER_QA_OUT||'output/garage-header');await mkdir(out,{recursive:true});
const current=await readFile('styles/garage.css','utf8'),baseline=process.env.HEADER_BASELINE_CSS?await readFile(process.env.HEADER_BASELINE_CSS,'utf8'):null;
const source=await readFile('src/main.js','utf8');
const fixture=createProfile({id:'header_visual_qa'});fixture.garage.level=4;
const expose='\nwindow.__headerQA={get ready(){return assetsReady&&garageScene?.ready},get blocked(){return orientationBlocked},get profile(){return profileStore.get()},draw(){renderer.resize();garageScene.render(innerWidth,innerHeight,garageFraming());return {css:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height]};}};';
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={method:'Native PNGs of the actual production garage, same frozen scene and viewport before/after stylesheet. Isolated tier-four local inspection save; no cloud grant, model change or FPS claim.',frames:[],errors:[]};
/** Poll readiness against the host clock because the browser simulation clock is deliberately paused. */
async function wait(page,fn){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,120));}throw new Error('Header QA readiness timeout');}
/** Read computed chrome and geometry rather than inferring transparency from source selectors. */
async function metrics(page){return page.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const header=document.querySelector('.gs-header'),css=getComputedStyle(header);return {...window.__headerQA.draw(),header:rect(header),brand:rect(header.querySelector('.gs-brand')),account:rect(header.querySelector('.gs-account')),title:rect(document.querySelector('.gs-vehicle-title')),titleFont:getComputedStyle(document.querySelector('.gs-vehicle-title')).font,background:css.backgroundImage,color:css.backgroundColor,border:css.borderBottomColor,shadow:css.boxShadow,backdrop:css.backdropFilter,overflow:document.documentElement.scrollWidth-innerWidth,controls:[...header.querySelectorAll('button')].filter(x=>x.getBoundingClientRect().width).map(x=>({name:x.getAttribute('aria-label'),...rect(x)}))};});}
/** Save only a real rendered frame, retaining the exact buffer and element bounds alongside it. */
async function shot(page,name){const info=await metrics(page);await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...info});console.log('capture',name,JSON.stringify(info));return info;}
/** Check that opening the roof did not remove controls, shift layout or expose portrait gameplay. */
function verify(info){assert.equal(info.background,'none');assert.equal(info.color,'rgba(0, 0, 0, 0)');assert.equal(info.border,'rgba(0, 0, 0, 0)');assert.equal(info.shadow,'none');assert.equal(info.backdrop,'none');assert.ok(info.overflow<=1);assert.ok(info.brand.right<info.account.x);assert.ok(info.title.y-info.brand.bottom>=20,'Car name retains breathing space beneath the game wordmark');for(const c of info.controls){assert.ok(c.width>=44&&c.height>=44,c.name);assert.ok(c.x>=0&&c.right<=info.css[0]+1,c.name);}}
try{
 for(const [name,viewport,mobile] of [['desktop',{width:1440,height:900},false],['mobile',{width:844,height:390},true]]){
  let after=!baseline;const page=await browser.newPage({viewport,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/main.js',r=>r.fulfill({body:source+expose,contentType:'text/javascript'}));
  await page.route('**/styles/garage.css*',r=>r.fulfill({body:after?current:baseline,contentType:'text/css'}));
  await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),fixture);await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);
  await wait(page,()=>window.__headerQA?.ready);const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+50));
  const hubBackground=await page.locator('.gs-header').evaluate(el=>getComputedStyle(el).backgroundImage);assert.notEqual(hubBackground,'none');
  await page.locator('[data-gs-focus="navigate:garage:fleet"]:visible').first().click();await page.locator('[data-gs-focus="navigate:garage:style"]:visible').first().click();
  const before=baseline?await shot(page,name+'-before'):null;
  if(baseline){after=true;await page.evaluate(()=>{document.querySelector('link[href*="styles/garage.css"]').href+='?header-after';});await wait(page,()=>getComputedStyle(document.querySelector('.gs-header')).backgroundImage==='none');}
  const updated=await shot(page,name+'-after');verify(updated);
  if(before){for(const key of ['header','brand','account','controls'])assert.deepEqual(updated[key],before[key],'unchanged header layout: '+key);assert.equal(updated.title.y,before.title.y-(viewport.height<=500?8:20));for(const key of ['x','width','height'])assert.equal(updated.title[key],before.title[key]);assert.equal(updated.titleFont,before.titleFont);}
  const profile=await page.evaluate(()=>window.__headerQA.profile);await page.getByRole('button',{name:'Настройки',exact:true}).click();assert.ok(await page.locator('.gs-settings-dialog').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('.gs-settings-dialog').count(),0);assert.deepEqual(await page.evaluate(()=>window.__headerQA.profile),profile);
  if(mobile){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await wait(page,()=>window.__headerQA.blocked);assert.ok(await page.locator('#orientationGate').isVisible());
   await page.setViewportSize({width:667,height:375});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await wait(page,()=>!window.__headerQA.blocked);verify(await metrics(page));assert.equal(await page.locator('.garage-shell').getAttribute('data-screen'),'garage');report.portraitGate=true;report.smallLandscape=true;}
  await page.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('GARAGE HEADER QA PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
