import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

/** Inspect the real open header and lower-right selected-car title without cloud/account writes. */
const out=path.resolve(process.env.HEADER_QA_OUT||'output/garage-header');await mkdir(out,{recursive:true});
const source=await readFile('src/main.js','utf8'),baseline=process.env.HEADER_COMPARE_REPORT?JSON.parse(await readFile(process.env.HEADER_COMPARE_REPORT,'utf8')):null;
const fixture=createProfile({id:'header_visual_qa'});fixture.garage.level=1;fixture.ownedVehicles=['rocket','hatch','sedan','suv','van'];
const expose='\nwindow.__headerQA={get ready(){return assetsReady&&garageScene?.ready},get blocked(){return orientationBlocked},get profile(){return profileStore.get()},draw(){renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true});garageScene.render(innerWidth,innerHeight,garageFraming());return {css:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height],camera:garageScene.camera.position.toArray(),quaternion:garageScene.camera.quaternion.toArray(),region:garageFraming()};}};';
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={method:'Native production UI, real buttons, local inspection save and controlled scene time; not measured FPS.',frames:[],errors:[]};
/** Poll real loading while the scene clock is controlled. */
async function wait(page,fn){const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,120));}throw new Error('Header QA readiness timeout');}
/** Measure real layout boxes, single-heading semantics and projection for regression evidence. */
async function metrics(page){return page.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const header=document.querySelector('.gs-header'),css=getComputedStyle(header),title=document.querySelector('.gs-vehicle-title');return {...window.__headerQA.draw(),header:rect(header),brand:rect(header.querySelector('.gs-brand')),account:rect(header.querySelector('.gs-account')),title:{...rect(title),text:title.textContent},titleFont:getComputedStyle(title).font,panel:rect(document.querySelector('.gs-workbench')),footer:rect(document.querySelector('.gs-footer')),stage:rect(document.querySelector('.gs-stage')),background:css.backgroundImage,color:css.backgroundColor,border:css.borderBottomColor,overflow:document.documentElement.scrollWidth-innerWidth,headings:document.querySelectorAll('[data-gs-heading]').length,controls:[...header.querySelectorAll('button'),...document.querySelectorAll('.gs-inspection-button')].filter(x=>x.getBoundingClientRect().width).map(x=>({name:x.getAttribute('aria-label'),...rect(x)}))};});}
/** Assert nonoverlap rather than accepting a visually plausible overlay. */
function verify(info){assert.equal(info.background,'none');assert.equal(info.color,'rgba(0, 0, 0, 0)');assert.equal(info.border,'rgba(0, 0, 0, 0)');assert.ok(info.overflow<=1);assert.equal(info.headings,1);assert.ok(info.brand.right<info.account.x);assert.ok(info.title.right<=info.panel.x-8,'Title stays left of the full-height workbench');assert.ok(info.title.bottom<=info.footer.y-3,'Title clears save/auth footer');assert.ok(info.title.x>=info.stage.x&&info.title.right<=info.stage.right-8,'Title stays inside the open stage');assert.ok(info.stage.right-info.title.right<40,'Title is anchored at the right stage edge');assert.ok(info.title.right<=info.css[0]-4);assert.ok(info.title.y>info.css[1]*.7);for(const c of info.controls){assert.ok(c.width>=44&&c.height>=44,c.name);assert.ok(c.x>=0&&c.right<=info.css[0]+1,c.name);assert.ok(c.right<=info.title.x||c.x>=info.title.right||c.bottom<=info.title.y||c.y>=info.title.bottom,'No title/control overlap: '+c.name);}}
/** Persist an actual rendered image and its measured layout together. */
async function shot(page,name){const info=await metrics(page);verify(info);await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...info});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name,JSON.stringify(info));return info;}
try{
 for(const [device,viewport,mobile] of [['desktop',{width:1440,height:900},false],['narrow-desktop',{width:1101,height:700},false],['mobile',{width:844,height:390},true]]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/main.js',r=>r.fulfill({body:source+expose,contentType:'text/javascript'}));await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),fixture);
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await wait(page,()=>window.__headerQA?.ready);const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+50));
  await page.locator('[data-gs-focus="navigate:garage:fleet"]:visible').first().click();await page.locator('[data-gs-focus="inspectVehicle:rear"]:visible').click();
  const frame=await shot(page,device+'-title-lower-right');
  if(baseline&&device!=='narrow-desktop'){const before=baseline.frames.find(f=>f.name===device+'-tier1-rear');assert.ok(before);for(const key of ['camera','quaternion','buffer'])frame[key].forEach((v,i)=>assert.ok(Math.abs(v-before[key][i])<1e-7,'Unchanged '+device+' '+key));for(const key of ['x','y','width'])assert.ok(Math.abs(frame.region[key]-before.region[key])<.1,'Unchanged car-fit '+key);if(device==='desktop')assert.ok(Math.abs(frame.region.height-before.region.height)<2,'Desktop car-fit retained');}
  await page.locator('.gs-workbench').evaluate(node=>{node.scrollTop=node.scrollHeight;});assert.equal((await metrics(page)).title.y,frame.title.y,'Catalog scroll never moves the title');
  await page.locator('[data-gs-focus="selectVehicle:hatch"]').click();assert.equal(await page.locator('.gs-vehicle-title').textContent(),'Клин H2');assert.equal(await page.locator('[data-gs-heading]').count(),1);
  await page.locator('[data-gs-focus="navigate:garage:style"]').click();verify(await metrics(page));assert.equal(await page.locator('.gs-vehicle-title').textContent(),'Клин H2');
  const profile=await page.evaluate(()=>window.__headerQA.profile);await page.getByRole('button',{name:'Настройки',exact:true}).click();assert.ok(await page.locator('.gs-settings-dialog').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('.gs-settings-dialog').count(),0);assert.deepEqual(await page.evaluate(()=>window.__headerQA.profile),profile);
  if(mobile){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await wait(page,()=>window.__headerQA.blocked);assert.ok(await page.locator('#orientationGate').isVisible());await page.setViewportSize({width:667,height:375});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await wait(page,()=>!window.__headerQA.blocked);await shot(page,'small-landscape-title');report.portraitGate=true;report.smallLandscape=true;}
  await page.close();
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('GARAGE HEADER/TITLE QA PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
