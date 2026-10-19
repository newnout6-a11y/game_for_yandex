import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadHomeQaSource} from './home-qa-source.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'output/home-cleanup-native');
await mkdir(out,{recursive:true});
const capture=await loadHomeQaSource(root),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=Object.fromEntries(await Promise.all(['src/main.js','src/garage-ui.js','src/home-framing.js','styles/garage.css','index.html'].map(async file=>[file,sha(await readFile(path.join(root,file)))])));
const report={source,frames:[],errors:[],method:'Actual production HOME and authored GLBs in isolated local profile; controlled software renders, not physical-device performance.'};
const expose=`\nwindow.__homeQA={get ready(){return assetsReady&&garageScene?.ready},async show(id='rocket',scale=1){profileStore.dispatch({type:'SELECT_VEHICLE',vehicleId:id});screen='hub';previewId=id;inspection='overview';garageScene.setInspection('overview');garageScene.yaw=-.63;garageScene.pitch=.24;applyScreen();refreshGarage();if(${Boolean(process.env.HOME_GUEST)})garageUI.render({...garageUI.view,platform:{sdk:true,cloud:true,auth:'guest'}});if(scale!==1){const nodes=[...document.querySelectorAll('.garage-shell,.garage-shell *')],sizes=nodes.map(n=>parseFloat(getComputedStyle(n).fontSize));nodes.forEach((n,i)=>n.style.fontSize=sizes[i]*scale+'px');}await document.fonts.ready;renderer.resize();garageScene.advance(2,{visible:true,reducedMotion:true,mediaActive:false});garageScene.render(innerWidth,innerHeight,garageFraming());return this.measure();},measure(){const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};const g=garageScene,c=g.camera;let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;const point=g.target.clone();g.vehicle.updateWorldMatrix(true,true);g.vehicle.traverse(n=>{if(!n.isMesh)return;for(let p=n;p;p=p.parent)if(!p.visible)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld).project(c);const px=(point.x+1)*innerWidth/2,py=(1-point.y)*innerHeight/2;x=Math.min(x,px);y=Math.min(y,py);right=Math.max(right,px);bottom=Math.max(bottom,py);}});return{viewport:[innerWidth,innerHeight],buffer:[renderer.renderer.domElement.width,renderer.renderer.domElement.height],region:garageFraming(),vehicle:{id:g.vehicleId,x,y,right,bottom,width:right-x,height:bottom-y},camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov},header:rect(document.querySelector('.gs-header')),route:rect(document.querySelector('.gs-route-cell')),label:rect(document.querySelector('.gs-hero-vehicle')),footer:rect(document.querySelector('.gs-footer')),actions:[...document.querySelectorAll('.gs-hub-actions button')].map(n=>({...rect(n),text:n.textContent.trim(),hit:n.contains(document.elementFromPoint(n.getBoundingClientRect().x+3,n.getBoundingClientRect().y+3)),overflow:n.scrollWidth-n.clientWidth})),pageOverflow:document.documentElement.scrollWidth-innerWidth};}};`;
const overlap=(a,b)=>a&&b&&a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;
let server,browser;
try{
 server=capture.startServer();await once(server,'listening');
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
 const page=await browser.newPage({viewport:{width:551,height:360},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.route('**/src/main.js',r=>r.fulfill({body:capture.main.replaceAll('requestAnimationFrame(tick);','/* Native QA owns render scheduling. */')+expose,contentType:'text/javascript'}));
 const profile=capture.createProfile({id:'isolated_home_cleanup_qa'});profile.ownedVehicles=['rocket','hatch','sedan','suv','van'];profile.stats.runs=2;profile.settings.route='dawn';
 await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__homeQA?.ready);
 for(const [width,height,scale,id] of [[551,360,1,'rocket'],[1440,900,1,'rocket'],[560,315,1,'van'],[320,180,1,'rocket'],[560,315,1.5,'rocket']]){
  await page.setViewportSize({width,height});
  const info=await page.evaluate(({scale,id})=>window.__homeQA.show(id,scale),{scale,id});
  const clean=await page.evaluate(()=>{
   const shell=document.querySelector('.garage-shell'),header=shell.querySelector('.gs-header'),c=getComputedStyle(header),heading=shell.querySelector('[data-gs-heading]');
   const forbidden=['ДОРОГА НАЧИНАЕТСЯ ЗДЕСЬ','НЕБО БЛИЖЕ','ДЕРЖИ ТРАССУ','ЗАБИРАЙ НЕБО','Твой родстер.','Можно играть сразу','В ТВОЁМ БОКСЕ'];
   const settings=shell.querySelector('[data-gs-settings-open]'),r=settings.getBoundingClientRect();
   return{removed:forbidden.every(t=>!shell.textContent.includes(t)),removedNodes:!shell.querySelector('.gs-hub-title,.gs-hub-copy,.gs-hero-vehicle,.gs-hub-intro'),background:c.backgroundImage,color:c.backgroundColor,border:c.borderBottomWidth,shadow:c.boxShadow,backdrop:c.backdropFilter,heading:heading.textContent,headingClip:getComputedStyle(heading).clipPath,settingsHit:settings.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),dockCards:shell.querySelector('.gs-hub-dock').children.length,routeValue:shell.querySelector('[data-gs-setting="route"]').value};
  });
  assert.equal(clean.removed,true);assert.equal(clean.removedNodes,true);assert.equal(clean.background,'none');assert.equal(clean.color,'rgba(0, 0, 0, 0)');assert.equal(clean.border,'0px');assert.equal(clean.shadow,'none');assert.equal(clean.backdrop,'none');assert.equal(clean.heading,'Главная');assert.equal(clean.headingClip,'inset(50%)');assert.equal(clean.settingsHit,true);assert.equal(clean.dockCards,3);assert.equal(clean.routeValue,'dawn');assert.equal(info.label,null);
  for(const b of info.actions){assert.ok(b.width>=44&&b.height>=44&&b.hit&&b.overflow<=1,'reachable entry action');assert.ok(b.y>=info.header.bottom&&b.bottom<=height,'action inside viewport');if(width<900)assert.ok(!overlap(info.vehicle,b),'mobile car/action clearance');}
  if(width<900){assert.ok(info.region,'measured mobile region');assert.ok(!overlap(info.vehicle,info.route),'mobile route clearance');assert.ok(info.vehicle.y>=info.header.bottom&&info.vehicle.bottom<=height,'complete mobile car');}
  if(width===551&&height===360&&scale===1){
   const widthFraction=info.vehicle.width/width,centerFraction=(info.vehicle.x+info.vehicle.right)/(2*width);
   assert.ok(widthFraction>=.475,'freed HOME center should give the actual car meaningful visual size');
   assert.ok(centerFraction>=.52&&centerFraction<=.62,'HOME car should use the middle, not the old right-side hero reservation');
  }
  assert.ok(info.pageOverflow<=1);const name=`home-${width}x${height}-${id}${scale===1?'':'-font150'}`;
  await page.screenshot({path:path.join(out,name+'.png'),timeout:180000});report.frames.push({name,...info,clean});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('CAPTURE',name);
 }
 // Real settings remain operable with a pointer-transparent header background.
 await page.locator('[data-gs-settings-open]').click();assert.ok(await page.locator('.gs-settings-backdrop').isVisible());report.settingsReachable=true;
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{try{await browser?.close();}finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections?.();});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}}
