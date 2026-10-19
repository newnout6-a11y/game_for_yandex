import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadHomeQaSource} from './home-qa-source.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.resolve(root,process.env.STABLE_ORBIT_OUTPUT||'output/stable-orbit-native');
await mkdir(path.join(out,'orbit-frames'),{recursive:true});
const capture=await loadHomeQaSource(root),source={};
for(const file of ['src/main.js','src/garage-scene.js','src/garage-camera-motion.js','src/garage-stable-orbit.js','src/home-framing.js','src/results-framing.js','styles/garage.css',...['1','2','3','4'].map(t=>`public/assets/garage/tier${t}.glb`)])source[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const report={source,frames:[],orbit:[],errors:[],method:'Actual prepared game models and GarageScene, isolated inventory. Production orbit method drives full-circle controlled frames; native touch gesture is checked separately. Software rendering is not phone FPS.'};
const expose=`\nwindow.__stableOrbitQA={get ready(){return assetsReady&&garageScene?.ready},async show(id='rocket',tier=1,mode='hub',scale=1){document.querySelectorAll('.garage-shell,.garage-shell *').forEach(n=>n.style.fontSize='');profileStore.dispatch({type:'SELECT_VEHICLE',vehicleId:id});while(profileStore.get().garage.level<tier){const r=profileStore.dispatch({type:'UPGRADE_GARAGE'});if(!r.ok)throw new Error(r.reason);}screen=mode;previewId=id;tab='fleet';inspection='overview';garageScene.setInspection('overview');garageScene.yaw=-.63;garageScene.pitch=.24;await garageScene.setTier(tier);applyScreen();refreshGarage();await garageScene.prepareToy();await document.fonts.ready;if(scale!==1){const ns=[...document.querySelectorAll('.garage-shell,.garage-shell *')],sizes=ns.map(n=>parseFloat(getComputedStyle(n).fontSize));ns.forEach((n,i)=>n.style.fontSize=sizes[i]*scale+'px');}renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});this.draw();if(mode==='garage'){refreshFleetVisibility();for(let i=0;i<60;i++){fleetMiniatures?.update(.1,{visible:true,paused:false,reducedMotion:true});await new Promise(r=>setTimeout(r,25));if(!fleetMiniatures.pending&&[...fleetMiniatures.records.values()].filter(r=>r.visible).every(r=>r.pixels&&!r.dirty))break;}}return this.draw();},draw(bounds=true){const g=garageScene,r=renderer.renderer;r.info.autoReset=false;r.info.reset();g.render(innerWidth,innerHeight,garageFraming());const c=g.camera,info={viewport:[innerWidth,innerHeight],region:garageFraming(),tier:g.tier,model:g.vehicleId,yaw:g.yaw,pitch:g.pitch,camera:c.position.toArray(),target:g.target.toArray(),radius:c.position.distanceTo(g.target),fov:c.fov,near:c.near,offset:c.view?.enabled?[c.view.offsetX,c.view.offsetY]:null,calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures};r.info.autoReset=true;if(bounds){let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;const p=g.target.clone();g.vehicle.updateWorldMatrix(true,true);g.vehicle.traverseVisible(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld).project(c);const xx=(p.x+1)*innerWidth/2,yy=(1-p.y)*innerHeight/2;x=Math.min(x,xx);y=Math.min(y,yy);right=Math.max(right,xx);bottom=Math.max(bottom,yy);}});info.vehicle={x,y,right,bottom,width:right-x,height:bottom-y};}return info;},orbit(dx,dy=0,bounds=true){garageScene.orbit(dx,dy);return this.draw(bounds);}};`;
function invariant(a,b){for(const key of ['radius','fov','near'])assert.ok(Math.abs(a[key]-b[key])<1e-8,`${key} changed during orbit: ${a[key]} -> ${b[key]}`);assert.deepEqual(a.target,b.target);assert.deepEqual(a.offset,b.offset);}
let server,browser;
try{
 server=capture.startServer();await once(server,'listening');browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
 const page=await browser.newPage({viewport:{width:551,height:360},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(180000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/src/main.js',r=>r.fulfill({body:capture.main.replaceAll('requestAnimationFrame(tick);','/* QA controls finite captures. */')+expose,contentType:'text/javascript'}));
 const profile=capture.createProfile({id:'isolated_stable_orbit'});profile.ownedVehicles=['rocket','van','suv','hatch','sedan'];profile.wallet.credits=1000000;profile.stats.runs=2;await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__stableOrbitQA?.ready);
 async function shot(name,info){if(info.region&&info.vehicle){const v=info.vehicle,r=info.region;assert.ok(v.x>=r.x-.05&&v.right<=r.x+r.width+.05&&v.y>=r.y-.05&&v.bottom<=r.y+r.height+.05,'whole actual car in measured region '+name);}await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...info});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name);}
 if(process.env.STABLE_ORBIT_MURAL_COMPARE){
  const baselinePath=path.resolve(process.env.STABLE_ORBIT_MURAL_COMPARE),oldAsset=await readFile(baselinePath);
  report.comparison={scope:'Same final camera/runtime/UI, only tier2 room asset changes. Not a whole-baseline screenshot.',baselineAssetSha256:createHash('sha256').update(oldAsset).digest('hex')};
  await page.setViewportSize({width:1440,height:900});
  await page.route('**/public/assets/garage/tier2.glb',r=>r.fulfill({body:oldAsset,contentType:'model/gltf-binary'}));
  await shot('tier2-old-placement-same-camera',await page.evaluate(()=>window.__stableOrbitQA.show('rocket',2,'garage')));
  await page.unroute('**/public/assets/garage/tier2.glb');
  await page.reload();await page.waitForFunction(()=>window.__stableOrbitQA?.ready);
  await shot('tier2-new-placement-same-camera',await page.evaluate(()=>window.__stableOrbitQA.show('rocket',2,'garage')));
  assert.deepEqual(report.frames[0].camera,report.frames[1].camera);assert.deepEqual(report.frames[0].target,report.frames[1].target);assert.equal(report.frames[0].fov,report.frames[1].fov);
 }else{
 const initial=await page.evaluate(()=>window.__stableOrbitQA.show());await shot('551-home-front',initial);
 // Use browser-generated touch pointer events, not direct synthetic DOM dispatch.
 const {region}=initial,x=region.x+region.width*.5,y=region.y+region.height*.5,session=await page.context().newCDPSession(page);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+48*i/8,y:y+12*i/8}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();const touched=await page.evaluate(()=>window.__stableOrbitQA.draw());invariant(initial,touched);assert.ok(Math.abs(touched.yaw-initial.yaw)>.05);report.realTouch={before:initial,after:touched};
 await page.evaluate(()=>window.__stableOrbitQA.show());
 const steps=Number(process.env.STABLE_ORBIT_STEPS||60),delta=2*Math.PI/(steps*.004);
 for(let i=0;i<=steps;i++){
  const info=await page.evaluate(({i,delta})=>i?window.__stableOrbitQA.orbit(delta,0,false):window.__stableOrbitQA.draw(false),{i,delta});invariant(initial,info);report.orbit.push(info);
  await page.screenshot({path:path.join(out,'orbit-frames',String(i).padStart(3,'0')+'.png'),timeout:180000});
  if([Math.round(steps/4),Math.round(steps/2),steps].includes(i))await shot('551-home-orbit-'+i,await page.evaluate(()=>window.__stableOrbitQA.draw()));
 }
 for(const [width,height,id,tier,mode,scale=1] of [[560,315,'van',1,'hub'],[320,180,'rocket',1,'hub'],[560,315,'rocket',1,'hub',1.5],[1440,900,'rocket',1,'hub'],[1440,900,'rocket',2,'garage'],[551,360,'rocket',4,'garage'],[1440,900,'van',4,'garage']]){
  await page.setViewportSize({width,height});let info=await page.evaluate(({id,tier,mode,scale})=>window.__stableOrbitQA.show(id,tier,mode,scale),{id,tier,mode,scale});await shot(`${width}-${mode}-tier${tier}-${id}${scale===1?'':'-font150'}-front`,info);
  const reverse=await page.evaluate(()=>window.__stableOrbitQA.orbit(Math.PI/.004));invariant(info,reverse);await shot(`${width}-${mode}-tier${tier}-${id}${scale===1?'':'-font150'}-rear`,reverse);if(tier===2){const clear=await page.evaluate(()=>window.__stableOrbitQA.orbit((2.05527425583192-window.__stableOrbitQA.draw(false).yaw)/.004));invariant(info,clear);await shot('1440-tier2-former-lift-blocker',clear);}
 }
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{try{await browser?.close();}finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections?.();});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}}
