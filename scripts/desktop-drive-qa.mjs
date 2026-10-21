import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadHomeQaSource} from './home-qa-source.mjs';

// Run through the single native-preview owner, not concurrently with another capture.
// Controlled software frames verify presentation and interaction, not device FPS.
const root = fileURLToPath(new URL('../', import.meta.url));
const capture = await loadHomeQaSource(root);
const out = path.join(root, 'output/desktop-drive-native');
await mkdir(out, {recursive: true});
const files = ['index.html', 'styles/desktop-drive.css', 'styles/mobile-drive.css', 'src/ui.js', 'src/main.js'];
const report = {method: 'Production HUD, selected-car snapshot and keyboard/pause paths in an isolated local profile. No real account or save is changed.',
  source: Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')]))), frames: [], errors: []};
const hook = `window.__desktopHudQA = {
 get ready() { return assetsReady && garageScene?.ready && routeVehicleMarker; },
 async start(id = 'rocket') { clearInput(); const result = profileStore.dispatch({type:'SELECT_VEHICLE', vehicleId:id}); if (!result.ok) throw Error('Isolated vehicle selection rejected'); await startRun(); this.set(50, 750); },
 set(nitro, distance) { clearInput(); Object.assign(game.state, {speed:80/3.6,nitro,distance,goalReached:distance>=1500,elapsed:20,score:15728,combo:5,traffic:[],pickups:[],obstacles:[],nextSpawn:Infinity,nextEvent:Infinity}); ui.hud(game.state); },
 pump() { tick(previous+16); renderer.renderer.getContext().finish(); return byId('mobileGoalVehicle').dataset.state; },
 draw() { renderer.resize(); syncMobileControls(); syncGlanceControls(); ui.hud(game.state); renderer.render(game.state,{dt:0,paused:true}); renderer.renderer.getContext().finish(); },
 input() { return input.read(); },
 camera() { toggleCamera(); },
 inspect() {
  const box = n => { const r=n.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
  const control = n => { const b=box(n); return {id:n.id,...b,visible:b.w>0&&b.h>0,hit:n.contains(document.elementFromPoint(b.x+b.w/2,b.y+b.h/2)),display:getComputedStyle(n).display}; };
  const rail=byId('mobileGoalRail'),track=rail.querySelector('.mobile-goal-track'),canvas=byId('mobileGoalVehicleCanvas');
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let ink=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])ink++;
  return {size:[innerWidth,innerHeight],mobile:byId('app').dataset.mobileControls,screen:byId('app').dataset.screen,flight:byId('app').dataset.flight,phase:game.state.phase,
   actualVehicle:renderer.playerVehicleId,selectedVehicle:routeVehicleSelection.id,markerState:byId('mobileGoalVehicle').dataset.state,canvasInk:ink,canvasHidden:canvas.hidden,
   rail:{...box(rail),progress:Number(rail.style.getPropertyValue('--goal-progress')),value:rail.getAttribute('aria-valuenow'),track:box(track),marker:box(byId('mobileGoalVehicle')),flag:box(rail.querySelector('.mobile-goal-flag'))},
   brand:box(document.querySelector('.brand')),score:box(document.querySelector('.score-block')),scoreSize:getComputedStyle(byId('score')).fontSize,speed:box(document.querySelector('.speed-block')),
   removed:['soundBtn','helpBtn'].map(id=>control(byId(id))),oldEnergy:getComputedStyle(document.querySelector('.nitro-block')).display,oldGoal:getComputedStyle(document.querySelector('.challenge')).display,
   status:{...box(byId('flightStatus')),clip:getComputedStyle(byId('flightStatus')).clipPath,display:getComputedStyle(byId('flightStatus')).display},
   utilities:['cameraBtn','pauseBtn'].map(id=>control(byId(id))),pedals:['leftBtn','rightBtn','brakeBtn','gasBtn'].map(id=>control(byId(id))),
   actions:['boostBtn','flightBtn','rollLeftBtn','rollRightBtn','hornBtn','lookLeftBtn','lookRightBtn'].map(id=>control(byId(id))),
   reserves:['boostBtn','flightBtn'].map(id=>{const b=byId(id),f=b.querySelector('.ability-reserve-fill');return {id,level:Number(b.style.getPropertyValue('--reserve-level')),fill:box(f),face:box(f.parentElement),innerHeight:f.parentElement.clientHeight,color:getComputedStyle(f).backgroundColor,transition:getComputedStyle(f).transitionDuration,key:getComputedStyle(b.querySelector('.desktop-control-key')).display};}),
   overflow:document.documentElement.scrollWidth-innerWidth};
 }
};`;
const profile = capture.createProfile({id:'isolated_desktop_hud_qa'});
profile.ownedVehicles=['rocket','sedan'];profile.loadouts.sedan=structuredClone(profile.loadouts.rocket);
let server, browser;
try {
  server=capture.startServer();await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
  let page=await browser.newPage({viewport:{width:1366,height:768},deviceScaleFactor:1,hasTouch:false});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
  await page.route('**/src/main.js',route=>route.fulfill({body:capture.main.replaceAll('requestAnimationFrame(tick);','/* Native QA owns scheduling. */')+hook,contentType:'text/javascript'}));
  await page.goto(origin);await page.waitForFunction(()=>window.__desktopHudQA?.ready,null,{timeout:180000});
  await page.evaluate(()=>window.__desktopHudQA.start());
  await page.waitForFunction(()=>window.__desktopHudQA.pump()==='ready',null,{polling:250,timeout:180000});
  async function frame(name,nitro=50,distance=750,{screenshot=true,flight=true,mobile=false}={}) {
    await page.evaluate(({nitro,distance})=>{window.__desktopHudQA.set(nitro,distance);window.__desktopHudQA.draw();},{nitro,distance});
    await page.waitForFunction(nitro=>Math.abs(document.querySelector('#boostBtn .ability-reserve-fill').getBoundingClientRect().height/document.querySelector('#boostBtn .mobile-control-face').clientHeight-nitro/100)<.025,nitro);
    await page.waitForFunction(distance=>{const rail=document.getElementById('mobileGoalRail'),track=rail.querySelector('.mobile-goal-track').getBoundingClientRect(),car=document.getElementById('mobileGoalVehicle').getBoundingClientRect();return Math.abs((car.x+car.width/2-track.x)/track.width-Math.min(1,distance/1500))<.03;},distance);
    const state=await page.evaluate(()=>window.__desktopHudQA.inspect());
    assert.equal(state.mobile,String(mobile));assert.equal(state.overflow,0);assert.equal(state.markerState,'ready');assert.ok(state.canvasInk>0);assert.equal(state.canvasHidden,false);assert.equal(state.actualVehicle,state.selectedVehicle);
    assert.equal(state.oldEnergy,'none');assert.equal(state.oldGoal,'none');assert.ok(state.removed.every(x=>!x.visible));assert.ok(state.pedals.every(x=>x.visible===mobile));
    assert.equal(state.status.w,flight?1:0);if(flight)assert.match(state.status.clip,/inset\(50%\)/);
    assert.ok(state.rail.y>=0&&state.rail.y<=12);if(state.brand.w>0)assert.ok(state.rail.x>=state.brand.right+2);assert.ok(state.rail.right<=state.utilities[0].x-2);
    assert.ok(state.rail.marker.x>=state.rail.x-.5&&state.rail.marker.right<=state.rail.right+.5);
    assert.ok(Math.abs((state.rail.marker.x+state.rail.marker.w/2-state.rail.track.x)/state.rail.track.w-Math.min(1,distance/1500))<.03);
    for(const item of state.utilities)assert.ok(item.visible&&item.hit&&item.w>=44&&item.h>=44,item.id);
    for(const item of state.actions.filter(x=>x.visible)) { assert.ok(item.w>=44&&item.h>=44,item.id);if(nitro>0)assert.ok(item.hit,item.id+' hit'); }
    const actions=[...state.actions,...state.pedals].filter(x=>x.visible);for(let i=0;i<actions.length;i++)for(let j=i+1;j<actions.length;j++){const a=actions[i],b=actions[j];assert.ok(a.right<=b.x+.5||b.right<=a.x+.5||a.bottom<=b.y+.5||b.bottom<=a.y+.5,a.id+' overlaps '+b.id);}
    for(const item of state.reserves.filter(x=>x.face.w>0)){assert.equal(item.level,nitro/100);assert.equal(item.key,mobile?'none':'block');assert.ok(Math.abs(item.fill.h/item.innerHeight-nitro/100)<.025);}
    assert.equal(state.reserves[0].color,'rgba(255, 149, 51, 0.58)');assert.equal(state.reserves[1].color,'rgba(82, 192, 244, 0.52)');
    if(screenshot)await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,state});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name);
  }
  for(const [w,h] of [[3840,2160],[1920,1080],[1366,768],[1024,768],[844,390],[800,600],[600,400],[400,300]]) { await page.setViewportSize({width:w,height:h});await frame(w+'-desktop'); }
  await page.setViewportSize({width:1366,height:768});
  await frame('1366-empty-start',0,0);await frame('1366-full-goal',100,1700);
  await page.evaluate(()=>window.__desktopHudQA.camera());await frame('1366-cockpit');await page.evaluate(()=>window.__desktopHudQA.camera());
  for(const [key,property,value]of[['w','throttle',1],['Space','boost',true],['f','flight',true],['q','roll',-1],['e','roll',1]]) { await page.keyboard.down(key);assert.equal((await page.evaluate(()=>window.__desktopHudQA.input()))[property],value);await page.keyboard.up(key); }
  await page.locator('#pauseBtn').click();await page.locator('#pauseSoundBtn').waitFor();assert.equal(await page.locator('[data-action="pauseHelp"]').count(),1);
  const paused=await page.evaluate(()=>({state:window.__desktopHudQA.inspect(),inert:document.getElementById('hud').inert,modal:document.getElementById('dialog').textContent}));assert.equal(paused.state.screen,'paused');assert.equal(paused.inert,true);assert.ok(paused.state.reserves.every(x=>x.transition==='0s'));report.paused=paused;
  await page.locator('[data-action="pauseHelp"]').click();await page.keyboard.press('Escape');await page.locator('#pauseSoundBtn').waitFor();assert.equal(await page.evaluate(()=>document.getElementById('app').dataset.screen),'paused');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.getElementById('app').dataset.screen),'playing');
  await page.emulateMedia({reducedMotion:'reduce'});const reduced=await page.evaluate(()=>window.__desktopHudQA.inspect());assert.ok(reduced.reserves.every(x=>x.transition==='0s'));report.reducedMotion=true;
  await page.evaluate(()=>window.__desktopHudQA.start('sedan'));await page.waitForFunction(()=>window.__desktopHudQA.pump()==='ready',null,{polling:250,timeout:180000});await frame('1366-sedan',50,750,{flight:false});
  const sedan=report.frames.at(-1).state;for(const id of ['flightBtn','rollLeftBtn','rollRightBtn'])assert.equal(sedan.actions.find(x=>x.id===id).visible,false);
  await page.close();
  page=await browser.newPage({viewport:{width:844,height:390},deviceScaleFactor:1,hasTouch:true,isMobile:true});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
  await page.route('**/src/main.js',route=>route.fulfill({body:capture.main.replaceAll('requestAnimationFrame(tick);','/* Native QA owns scheduling. */')+hook,contentType:'text/javascript'}));
  await page.goto(origin);await page.waitForFunction(()=>window.__desktopHudQA?.ready,null,{timeout:180000});
  await page.evaluate(()=>window.__desktopHudQA.start());await page.waitForFunction(()=>window.__desktopHudQA.pump()==='ready',null,{polling:250,timeout:180000});
  for(const [w,h] of [[844,390],[551,360],[320,240]]) {
    await page.setViewportSize({width:w,height:h});
    for(const [reserve,distance] of [[0,0],[50,750],[100,1700]])await frame(w+'-mobile-'+reserve,reserve,distance,{mobile:true});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
} finally { try { await browser?.close(); } finally { if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)); } }
