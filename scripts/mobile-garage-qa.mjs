import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadHomeQaSource} from './home-qa-source.mjs';

// Every runtime import/asset is served from one complete source tree. All saves
// and clicks belong to this disposable local fixture, never the user's account.
const baseline=process.env.GARAGE_BASELINE_ROOT,capture=await loadHomeQaSource(baseline||undefined);
const paint=!!process.env.GARAGE_PAINT;
const finishing=!!process.env.GARAGE_FINISHING||paint;
const out=path.resolve(process.env.GARAGE_MOBILE_OUT||'output/mobile-garage-after');await mkdir(out,{recursive:true});
const {COSMETICS}=await import(pathToFileURL(path.join(capture.root,'src/progression-catalog.js')).href);
const fixture=capture.createProfile({id:'mobile_garage_layout_qa'});if(!process.env.GARAGE_STARTER){fixture.ownedVehicles=['rocket','hatch','sedan','suv','van'];fixture.wallet.credits=5000;fixture.stats.distanceM=600;fixture.stats.maxRunDistanceM=600;fixture.season.xp=900;fixture.cosmetics.owned=COSMETICS.map(item=>item.id);}
const expose=`\nwindow.__garageQA={get ready(){return assetsReady&&garageScene?.ready},get profile(){return profileStore.get()},get inspection(){return inspection},get blocked(){return orientationBlocked},get pending(){return !!fleetMiniatures?.pending},async show(next='fleet',id='rocket',scale=1,guest=false){screen='garage';tab=next;inspection='overview';garageUI.atelierSection='body';garageUI.atelierBodySection='surface';garageScene.setInspection('overview');garageScene.yaw=-.63;garageScene.pitch=.24;previewId=id;profileStore.dispatch({type:'SELECT_VEHICLE',vehicleId:id});applyScreen();refreshGarage();if(guest)garageUI.render({...garageUI.view,platform:{sdk:true,cloud:true,auth:'guest'}});this.font(scale);await document.fonts.ready;},guest(){garageUI.render({...garageUI.view,platform:{sdk:true,cloud:true,auth:'guest'}});},font(scale){const nodes=[...document.querySelectorAll('.garage-shell,.garage-shell *')];nodes.forEach(n=>n.style.removeProperty('font-size'));if(scale!==1){const sizes=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));nodes.forEach((n,i)=>n.style.fontSize=sizes[i]*scale+'px');}},async draw(){renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});garageScene.render(innerWidth,innerHeight,garageFraming());refreshFleetVisibility();fleetMiniatures.update(.1,{visible:tab==='fleet',paused:false,reducedMotion:true});return this.measure();},measure(){const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const fullyVisible=n=>{const r=n.getBoundingClientRect();for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){const c=getComputedStyle(p),b=p.getBoundingClientRect();if(c.display==='contents')continue;if(['auto','scroll','hidden','clip'].includes(c.overflowX)&&(r.left<b.left-1||r.right>b.right+1))return false;if(['auto','scroll','hidden','clip'].includes(c.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))return false;}return r.width>0&&r.height>0;};const control=n=>({...rect(n),fullyVisible:fullyVisible(n),text:n.textContent.trim(),focus:n.dataset.gsFocus,disabled:n.disabled,hit:n.contains(document.elementFromPoint(n.getBoundingClientRect().x+n.getBoundingClientRect().width/2,n.getBoundingClientRect().y+n.getBoundingClientRect().height/2))});const stage=document.querySelector('.gs-stage'),panel=document.querySelector('.gs-workbench'),g=garageScene,c=g.camera;let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;const point=g.target.clone();g.vehicle.updateWorldMatrix(true,true);g.vehicle.traverseVisible(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld).project(c);const px=(point.x+1)*innerWidth/2,py=(1-point.y)*innerHeight/2;x=Math.min(x,px);y=Math.min(y,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}});return{viewport:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height],screen,tab,inspection,region:garageFraming(),vehicle:{id:g.vehicleId,x,y,right,bottom},stage:rect(stage),panel:{...rect(panel),scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,scrollTop:panel.scrollTop,overflow:getComputedStyle(panel).overflowY},heading:rect(panel.querySelector('.gs-panel-heading')),header:rect(document.querySelector('.gs-header')),nav:rect(document.querySelector('.gs-tabs')),footer:rect(document.querySelector('.gs-footer')),title:rect(document.querySelector('.gs-vehicle-title')),controls:rect(document.querySelector('.gs-stage-bottom')),tabs:[...document.querySelectorAll('.gs-tab')].map(control),inspectionButtons:[...document.querySelectorAll('.gs-inspection-button')].map(control),panelButtons:[...panel.querySelectorAll('button')].map(control),panelSelects:[...panel.querySelectorAll('select')].map(n=>({...rect(n),fullyVisible:fullyVisible(n),value:n.value})),content:[...panel.querySelectorAll('.gs-vehicle-row,.gs-sample-card,.gs-contract,.gs-season-tier,.gs-upgrade-branch,.gs-comparison-row')].filter(n=>n.getClientRects().length).map(n=>({...rect(n),fullyVisible:fullyVisible(n),kind:n.className,text:n.textContent.slice(0,160)})),miniatures:[...fleetMiniatures.records.values()].map(r=>({id:r.id,visible:r.visible,ready:!!r.pixels,yaw:r.yaw})),overflow:document.documentElement.scrollWidth-innerWidth};}};`;
const server=capture.startServer();await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={source:{...capture.provenance,garageCssSha256:createHash('sha256').update(await readFile(path.join(capture.root,'styles/garage.css'))).digest('hex')},baseline:!!baseline,starter:!!process.env.GARAGE_STARTER,guest:!!process.env.GARAGE_GUEST,method:'Complete production tree inside a narrower iframe; isolated starter or unlocked fixture; real GLBs and controls. Controlled render time, software WebGL, not a device FPS measurement.',frames:[],layout:[],errors:[]};
/** Wait for actual observable asset/state readiness, bounded by a failure deadline. */
async function wait(frame,fn,clock){const end=Date.now()+180000;while(Date.now()<end){if(await frame.evaluate(fn))return;if(clock)await clock.runFor(20);await new Promise(r=>setTimeout(r,100));}throw Error('Garage QA readiness timeout');}
/** Assert the tray is in the same viewport, not an unreachable row below the car. */
function check(m){assert.ok(m.overflow<=1,'page horizontal overflow');assert.ok(m.panel.y>=m.header.bottom-.5&&m.panel.bottom<=m.footer.y+.5,'panel outside header/footer');assert.ok(m.panel.x>=m.stage.right-.5,'panel not beside stage');assert.ok(m.panel.y>=m.nav.bottom-.5&&m.stage.y>=m.nav.bottom-.5,'stage or panel covered by tab band');assert.ok(m.panel.height>=70,'no useful panel area');assert.ok(m.panel.height-m.heading.height>=40,'only panel heading visible');assert.equal(m.panel.overflow,'auto');assert.ok(m.region&&m.region.width>0&&m.region.height>0,'no clear vehicle region');assert.ok(m.region.x>=m.stage.x-.5&&m.region.x+m.region.width<=m.stage.right+.5&&m.region.y>=m.stage.y-.5&&m.region.y+m.region.height<=Math.min(m.controls.y,m.stage.bottom)+.5,'camera region crosses controls or stage');for(const b of m.inspectionButtons)assert.ok(b.width>=32&&b.height>=32,'inspection hit size');assert.ok(m.title.right<=m.stage.right+.5&&m.title.bottom<=m.footer.y+.5,'dynamic title escaped stage');}
/** Count semantic first-screen choices, not decorative pixels or offscreen descendants. */
function density(m){
 const inside=n=>n.fullyVisible!==false&&n.height>0&&n.x>=m.panel.x-1&&n.right<=m.panel.right+1&&n.y>=m.panel.y-1&&n.bottom<=m.panel.bottom+1;
 const kind={fleet:'gs-vehicle-row',style:'gs-color-choice',engineering:'gs-comparison-row',contracts:'gs-contract',season:'gs-season-tier'}[m.tab];
 return {items:m.content.filter(n=>n.kind.includes(kind)&&!n.kind.includes('gs-comparison-head')&&inside(n)).length,actions:m.panelButtons.filter(inside).map(n=>n.focus),selects:m.panelSelects.filter(inside).length};
}
/** Normal phone viewports retain the concrete choices visible in the desktop reference. */
function checkDensity(m){
 const d=density(m),minimum={fleet:4,style:4,engineering:5,contracts:2,season:5}[m.tab];
 assert.ok(d.items>=minimum,m.tab+' first-screen choice count '+d.items+' < '+minimum);
 if(m.tab==='style')assert.ok(d.actions.includes('resetCosmetic:body.paint'),'paint reset visible');
 if(m.tab==='fleet'){assert.ok(d.actions.includes('startDrive'),'Drive visible');assert.ok(d.selects>=1,'run class visible');}
 if(m.tab==='engineering')assert.ok(d.selects>=1,'engineering class visible');
 if(m.tab==='season')assert.ok(d.actions.filter(s=>s.startsWith('claimSeason:')).length>=6,'six desktop-visible reward actions');
 return d;
}
/** Check the real initial desktop subcategory actions, including reset and theme. */
function checkSubcategory(m,category){
 const visible=new Set(m.panelButtons.filter(n=>n.fullyVisible&&n.y>=m.panel.y-1&&n.bottom<=m.panel.bottom+1).map(n=>n.focus));
 const expected=category==='wheels'?['equipCosmetic:rim_graphite:wheels.finish','equipCosmetic:rim_copper:wheels.finish','equipCosmetic:rim_titanium:wheels.finish','equipCosmetic:rim_rose:wheels.finish']:category==='cockpit'?['equipCosmetic:steering_round:cockpit.steering','equipCosmetic:steering_yoke:cockpit.steering','resetCosmetic:cockpit.steering','equipCosmetic:cockpit_amber:cockpit.theme']:['equipCosmetic:tint_light:body.tint','equipCosmetic:tint_smoke:body.tint','resetCosmetic:body.tint'];
 for(const action of expected)assert.ok(visible.has(action),category+' initial action hidden: '+action);
 return expected;
}
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))report.errors.push(m.text());});
 await page.route('**/__garage-host',r=>r.fulfill({body:`<html><body style="margin:0;background:#111"><iframe id="game" src="/" style="border:0;width:560px;height:315px"></iframe></body></html>`,contentType:'text/html'}));
 await page.route('**/src/main.js',r=>r.fulfill({body:capture.main+expose,contentType:'text/javascript'}));await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),fixture);
 await page.clock.install({time:new Date('2026-10-19T05:00:00Z')});await page.clock.pauseAt(new Date('2026-10-19T05:01:00Z'));await page.goto(origin+'/__garage-host');const frame=page.frames().find(f=>f.url()===origin+'/');await wait(frame,()=>window.__garageQA?.ready);
 const size=async(w,h)=>{await page.locator('#game').evaluate((n,{w,h})=>{n.style.width=w+'px';n.style.height=h+'px';},{w,h});};
 const shot=async name=>{let m=await frame.evaluate(()=>window.__garageQA.draw());for(let i=0;i<6&&m.tab==='fleet';i++){await wait(frame,()=>!window.__garageQA.pending,page.clock);m=await frame.evaluate(()=>window.__garageQA.draw());}if(!baseline&&m.viewport[0]<=1100)check(m);await page.locator('#game').screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...m});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name,JSON.stringify(m));if(!baseline&&m.viewport[0]>=560&&m.viewport[0]<=844&&m.inspection==='overview'&&/^garage-\d+x\d+-(fleet|style|engineering|contracts|season)$/.test(name))report.frames.at(-1).density=checkDensity(m);return m;};
 const click=async id=>{const n=frame.locator(`[data-gs-focus="${id}"]:visible`).first();await n.scrollIntoViewIfNeeded();await n.tap();};
 for(const[w,h]of(finishing?[]:process.env.GARAGE_DESKTOP?[[1440,900]]:baseline?[[560,315],[1440,900]]:process.env.GARAGE_QUICK?[[560,315]]:process.env.GARAGE_DENSITY?(process.env.GARAGE_MOBILE_ONLY?[[560,315],[667,375],[844,390]]:[[1440,900],[560,315],[667,375],[844,390]]):[[1440,900],[560,315],[667,375],[844,390],[480,270],[320,240]])){
  await size(w,h);for(const next of(!process.env.GARAGE_DENSITY&&(process.env.GARAGE_DESKTOP||baseline||process.env.GARAGE_QUICK)?['style']:['fleet','style','engineering','contracts','season'])){
   await frame.evaluate(([next,guest])=>window.__garageQA.show(next,'rocket',1,guest),[next,!!process.env.GARAGE_GUEST&&w<1100]);await shot(`garage-${w}x${h}-${next}`);
   if(!baseline&&!process.env.GARAGE_QUICK&&w<=1100){const buttons=frame.locator('.gs-workbench button:enabled:visible');if(await buttons.count()){const last=buttons.last();await last.scrollIntoViewIfNeeded();const reachable=await last.evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.gs-workbench').getBoundingClientRect();return r.height>=32&&r.width>=32&&r.top>=p.top-1&&r.bottom<=p.bottom+1&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.ok(reachable,`${w}/${next} final action reachable`);}}
  }

 }
 if(!finishing&&!baseline&&!process.env.GARAGE_STARTER&&!process.env.GARAGE_DESKTOP&&!process.env.GARAGE_DENSITY){await size(560,315);await frame.evaluate(()=>window.__garageQA.show('style'));await click('_local:wheels:atelierCategory');await shot('garage-560-rims');await click('equipCosmetic:rim_rose:wheels.finish');assert.equal(await frame.evaluate(()=>window.__garageQA.profile.loadouts.rocket.cosmetics['wheels.finish']),'rim_rose');await click('_local:cockpit:atelierCategory');await shot('garage-560-cockpit');await click('equipCosmetic:steering_round:cockpit.steering');assert.equal(await frame.evaluate(()=>window.__garageQA.profile.loadouts.rocket.cosmetics['cockpit.steering']),'steering_round');await click('_local:body:atelierCategory');await click('_local:glass:atelierBodySection');await shot('garage-560-glass');await click('equipCosmetic:tint_smoke:body.tint');assert.equal(await frame.evaluate(()=>window.__garageQA.profile.loadouts.rocket.cosmetics['body.tint']),'tint_smoke');
 await click('navigate:garage:engineering');const upgrade=frame.locator('[data-gs-focus^="upgradeEngineering:drive"]:visible');await upgrade.scrollIntoViewIfNeeded();await upgrade.click();assert.equal(await frame.evaluate(()=>window.__garageQA.profile.research.drive),1);
 await click('navigate:garage:contracts');const claim=frame.locator('[data-gs-focus^="claimContract:"]:enabled:visible').first();await claim.scrollIntoViewIfNeeded();await claim.click();assert.ok(Object.keys(await frame.evaluate(()=>window.__garageQA.profile.contracts.claims)).length>0);
 await click('navigate:garage:season');const reward=frame.locator('[data-gs-focus^="claimSeason:"]:enabled:visible').first();await reward.scrollIntoViewIfNeeded();await reward.click();assert.equal((await frame.evaluate(()=>window.__garageQA.profile.season.claims)).length,1);
 await click('navigate:garage:fleet');await click('selectVehicle:hatch');assert.equal(await frame.evaluate(()=>window.__garageQA.profile.selectedVehicleId),'hatch');report.functionalActions=true;}
 if(!finishing&&!baseline&&!process.env.GARAGE_QUICK&&!process.env.GARAGE_DESKTOP&&!process.env.GARAGE_DENSITY){
  for(const[w,h]of[[560,315],[667,375],[844,390],[480,270],[844,270],[320,240]])for(const scale of[1,1.25,1.5])for(const next of['fleet','style','engineering','contracts','season']){await size(w,h);await frame.evaluate(([next,scale])=>window.__garageQA.show(next,'rocket',scale,true),[next,scale]);const m=await frame.evaluate(render=>render?window.__garageQA.draw():window.__garageQA.measure(),scale===1.5&&next==='style');check(m);if(scale===1&&w>=560&&h>=315)m.density=checkDensity(m);if(scale===1.5&&next==='style'){assert.ok(m.vehicle.x>=m.region.x-1&&m.vehicle.right<=m.region.x+m.region.width+1&&m.vehicle.y>=m.region.y-1&&m.vehicle.bottom<=m.region.y+m.region.height+1,'enlarged-text real vehicle stays clear');}for(const fixed of ['.gs-mobile-home','.gs-account button']){const nodes=frame.locator(fixed+':visible');for(let i=0;i<await nodes.count();i++)assert.ok(await nodes.nth(i).evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=32&&r.height>=32&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'header action remains reachable');}for(const sel of['.gs-tab','.gs-inspection-button']){const nodes=frame.locator(sel+':visible');for(let i=0;i<await nodes.count();i++){const n=nodes.nth(i);await n.evaluate(n=>n.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}));assert.ok(await n.evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=32&&r.height>=32&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))&&n.scrollWidth<=n.clientWidth+1;}),next+'/'+scale+' '+sel+' reachable text/hit');}}report.layout.push({scale,...m});}
  await size(320,240);await frame.evaluate(()=>window.__garageQA.show('style'));await click('inspectVehicle:cockpit');assert.ok(await frame.locator('[data-gs-focus="inspectVehicle:cockpit"]').evaluate(n=>{const r=n.getBoundingClientRect(),p=n.closest('.gs-inspection').getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'selected cockpit remains visible after rerender');report.inspectionScrollPreserved=true;
  for(const id of ['rocket','hatch','sedan','suv','van']){await size(560,315);await frame.evaluate(id=>window.__garageQA.show('style',id),id);const m=await shot('garage-560-car-'+id);assert.ok(m.vehicle.x>=m.region.x-1&&m.vehicle.right<=m.region.x+m.region.width+1&&m.vehicle.y>=m.region.y-1&&m.vehicle.bottom<=m.region.y+m.region.height+1,id+' native authored geometry stays clear');}
  await size(667,375);await frame.evaluate(()=>window.__garageQA.show('style','rocket',1.5,true));await shot('garage-667-font150-guest');await size(390,844);await wait(frame,()=>window.__garageQA.blocked);assert.ok(await frame.locator('#orientationGate').isVisible());await size(667,375);await wait(frame,()=>!window.__garageQA.blocked);report.portraitGate=true;await frame.addStyleTag({content:".garage-shell[data-screen='garage'] .gs-layout{padding:0 20px 10px 20px!important;}"});await frame.evaluate(()=>window.__garageQA.show('style'));const safe=await frame.evaluate(()=>window.__garageQA.draw());check(safe);assert.ok(safe.stage.x>=20&&safe.panel.right<=647,'synthetic safe-area content insets');report.safeArea=safe;
 }
 if(finishing&&!paint){
  report.compositorFrameAdvanceMs=32;
  await size(844,390);for(const next of['fleet','style','engineering','contracts','season']){await frame.evaluate(next=>window.__garageQA.show(next,'rocket',1,true),next);await page.clock.runFor(32);await shot('garage-844x390-'+next+'-final');}
  report.subcategories=[];
  for(const[w,h]of[[1440,900],[560,315],[667,375],[844,390]])for(const category of['wheels','cockpit','glass']){
   await size(w,h);await frame.evaluate(()=>window.__garageQA.show('style'));await click('_local:'+(category==='glass'?'body':category)+':atelierCategory');if(category==='glass')await click('_local:glass:atelierBodySection');if(w<1100)await frame.evaluate(()=>window.__garageQA.guest());
   const m=await shot('garage-'+w+'-'+category+'-final');report.subcategories.push({viewport:[w,h],category,actions:checkSubcategory(m,category)});
  }
  report.finalLayout=[];
  for(const[w,h]of[[560,315],[667,375],[844,390],[480,270],[844,270],[320,240]])for(const scale of[1,1.25,1.5])for(const next of['fleet','style','engineering','contracts','season']){await size(w,h);await frame.evaluate(([next,scale])=>window.__garageQA.show(next,'rocket',scale,true),[next,scale]);const m=await frame.evaluate(()=>window.__garageQA.measure());check(m);if(scale===1&&w>=560&&h>=315)m.density=checkDensity(m);report.finalLayout.push({scale,...m});}
  for(const scale of[1,1.5]){await size(320,240);await frame.evaluate(scale=>window.__garageQA.show('season','rocket',scale,true),scale);await shot('garage-320-season-font'+Math.round(scale*100)+'-final');assert.ok(await frame.locator('.gs-season-track > .gs-kicker').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),'season eligibility label overflows tile');}
 }
 if(paint){
  // Normal RAF and a fresh page distinguish first-paint defects from a paused
  // screenshot clock. Never capture a nav element before the first full frame.
  await size(844,390);await frame.evaluate(()=>window.__garageQA.show('engineering','rocket',1,true));await page.clock.resume();
  report.livePaint={clock:'running',cssOverrides:false,frames:[]};
  for(const next of ['engineering','style','contracts','season','fleet']){
   if(next!=='engineering')await click('navigate:garage:'+next);
   await new Promise(resolve=>setTimeout(resolve,250));
   const name='garage-live-844-'+next,m=await shot(name);
   const initial=await readFile(path.join(out,name+'.png'));
   // The element snapshot forces only a subsequent paint. Compare its following
   // full frame with the already-retained first frame; do not accept a repaired
   // screenshot as proof that the initial navigation was visible.
   await frame.locator('.gs-tabs').screenshot({path:path.join(out,name+'-nav-reference.png')});
   const repainted=await page.locator('#game').screenshot({path:path.join(out,name+'-repaint.png')});
   const mismatch=await page.evaluate(async({a,b,nav})=>{
    const pixels=async data=>{const bitmap=await createImageBitmap(await(await fetch('data:image/png;base64,'+data)).blob());const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const result=ctx.getImageData(0,0,bitmap.width,bitmap.height);bitmap.close();return result;};
    const before=await pixels(a),after=await pixels(b);let changed=0,total=0;
    for(let y=Math.ceil(nav.y)+2;y<Math.floor(nav.bottom)-2;y++)for(let x=Math.ceil(nav.x)+2;x<Math.floor(nav.right)-2;x++){
     const i=(y*before.width+x)*4;total++;if(Math.max(...[0,1,2].map(c=>Math.abs(before.data[i+c]-after.data[i+c])))>16)changed++;
    }
    return{changed,total,ratio:changed/total};
   },{a:initial.toString('base64'),b:repainted.toString('base64'),nav:m.nav});
   assert.ok(mismatch.ratio<.03,'First navigation paint differs from forced repaint: '+next+' '+JSON.stringify(mismatch));
   report.livePaint.frames.push({tab:next,...mismatch});
  }
 }
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('MOBILE GARAGE QA PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));}
