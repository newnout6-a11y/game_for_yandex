import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

// Actual production HOME and GLBs in an isolated synthetic profile. A controlled
// render clock gives matched native PNGs, not an FPS benchmark or a live account.
const baseline=process.env.HOME_BASELINE_ROOT,label=baseline?'before':'after';
const out=path.resolve(process.env.HOME_COMPOSITION_OUT||`output/home-composition-${label}`);await mkdir(out,{recursive:true});
const source=await readFile(path.join(baseline||'.','src/main.js'),'utf8');
const css=baseline?await readFile(path.join(baseline,'styles/garage.css'),'utf8'):null;
const expose=`\nwindow.__homeQA={get ready(){return assetsReady&&garageScene?.ready},async show(id='rocket',scale=1){profileStore.dispatch({type:'SELECT_VEHICLE',vehicleId:id});screen='hub';previewId=id;inspection='overview';garageScene.setInspection('overview');garageScene.yaw=-.63;garageScene.pitch=.24;applyScreen();refreshGarage();if(scale!==1){const nodes=[...document.querySelectorAll('.garage-shell,.garage-shell *')],sizes=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));nodes.forEach((n,i)=>n.style.fontSize=sizes[i]*scale+'px');}await document.fonts.ready;renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});garageScene.render(innerWidth,innerHeight,garageFraming());return this.measure();},measure(){const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const g=garageScene,c=g.camera;let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;const point=g.target.clone();g.vehicle.updateWorldMatrix(true,true);g.vehicle.traverse(n=>{if(!n.isMesh)return;for(let p=n;p;p=p.parent)if(!p.visible)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld).project(c);const px=(point.x+1)*innerWidth/2,py=(1-point.y)*innerHeight/2;x=Math.min(x,px);y=Math.min(y,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}});return{viewport:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height],region:garageFraming(),vehicle:{id:g.vehicleId,x,y,right,bottom,width:right-x,height:bottom-y},camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov},header:rect(document.querySelector('.gs-header')),route:rect(document.querySelector('.gs-route-cell')),label:rect(document.querySelector('.gs-hero-vehicle')),footer:rect(document.querySelector('.gs-footer')),actions:[...document.querySelectorAll('.gs-hub-actions button')].map(n=>({...rect(n),text:n.textContent.trim(),hit:n.contains(document.elementFromPoint(n.getBoundingClientRect().x+3,n.getBoundingClientRect().y+3)),overflow:n.scrollWidth-n.clientWidth})),pageOverflow:document.documentElement.scrollWidth-innerWidth};}};`;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const report={label,method:'Production main, GarageUI, GarageScene and authored GLBs. Isolated local profile; controlled time; native CSS-pixel PNG and measured render-buffer dimensions. No real-device FPS claim.',frames:[],errors:[]};
/** Test rectangular screen-space separation against actual visible vehicle vertices. */
const overlaps=(a,b)=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;
try{
 const page=await browser.newPage({viewport:{width:560,height:315},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|THREE|shader/i.test(m.text()))report.errors.push(m.text());});
 await page.route('**/src/main.js',r=>r.fulfill({body:source+expose,contentType:'text/javascript'}));if(css)await page.route('**/styles/garage.css',r=>r.fulfill({body:css,contentType:'text/css'}));
 const profile=createProfile({id:'home_composition_qa'});profile.ownedVehicles=['rocket','hatch','sedan','suv','van'];
 await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
 await page.clock.install({time:new Date('2026-10-19T03:00:00Z')});await page.clock.pauseAt(new Date('2026-10-19T03:01:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
 const until=Date.now()+180000;while(Date.now()<until){if(await page.evaluate(()=>window.__homeQA?.ready))break;await new Promise(r=>setTimeout(r,100));}assert.equal(await page.evaluate(()=>window.__homeQA?.ready),true);
 const sizes=process.env.HOME_QUICK?[[560,315]]:[[560,315],[667,375],[844,390],[1440,900]];
 for(const [width,height]of sizes){await page.setViewportSize({width,height});
  for(const id of baseline||process.env.HOME_QUICK||width>900?['rocket']:['rocket','hatch','sedan','suv','van']){
   const info=await page.evaluate(id=>window.__homeQA.show(id),id),name=`home-${width}x${height}-${id}`;
   if(!baseline&&width<900){for(const b of info.actions){assert.ok(b.width>=44&&b.height>=44&&b.hit&&b.overflow<=1,name+' action');assert.ok(!overlaps(info.vehicle,b),name+' car/action overlap');}assert.ok(!overlaps(info.vehicle,info.route),name+' car/route overlap');assert.ok(!overlaps(info.vehicle,info.label),name+' car/title overlap');assert.ok(info.vehicle.y>=info.header.bottom&&info.vehicle.bottom<=info.footer.y,name+' complete car visible');assert.ok(info.pageOverflow<=1);}
   await page.screenshot({path:path.join(out,name+'.png')});report.frames.push({name,...info});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name,JSON.stringify(info));
  }
 }
 if(!baseline&&!process.env.HOME_QUICK){await page.setViewportSize({width:560,height:315});const info=await page.evaluate(()=>window.__homeQA.show('rocket',1.5));for(const b of info.actions)assert.ok(b.width>=44&&b.height>=44&&b.hit&&b.overflow<=1);assert.ok(!overlaps(info.vehicle,info.route));assert.ok(!overlaps(info.vehicle,info.label));await page.screenshot({path:path.join(out,'home-560x315-rocket-font150.png')});report.frames.push({name:'home-560x315-rocket-font150',...info});}
 assert.deepEqual(report.errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('HOME COMPOSITION PASS',label);
}finally{await browser.close();await new Promise(r=>server.close(r));}
