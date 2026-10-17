import {chromium} from 'playwright';
import {mkdir,rename,writeFile} from 'node:fs/promises';
await mkdir('output/playwright/video',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:'output/playwright/video',size:{width:1280,height:720}}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{/** Use the fixed millisecond seed for repeatable game randomness without replacing the real recording clock. */ Date.now=()=>1792022400000;});
  await page.goto('http://127.0.0.1:4173');
  await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
  await page.evaluate(async()=>{
    const {RoadRenderer}=await import('./src/world.js'),render=RoadRenderer.prototype.render;
    /** Expose the live driving state to the input planner and preserve production rendering. */ RoadRenderer.prototype.render=function(s,...rest){window.__recordState=s;return render.call(this,s,...rest);};
  });
  await page.locator('#playBtn').click();await page.waitForTimeout(600);
  await page.keyboard.down('KeyW');
  const began=performance.now(),captured=new Set();
  let lastDirection=0;
  while(performance.now()-began<52000){
    if(await page.locator('#app').getAttribute('data-screen')!=='playing')break;
    /**
     * Choose keyboard steering/braking from current traffic and event state.
     * This recording-only heuristic predicts 0.3 seconds ahead and does not mutate
     * vehicle state; it is not a production autopilot or a collision-safety guarantee.
     */
    const drive=await page.evaluate(()=>{
      const s=window.__recordState;if(!s)return null;
      let target=Math.round(s.x),brake=false;
      const e=s.roadEvent,closed=e?.type==='roadworks'?e.lane:-1;
      const upcoming=s.traffic.filter(c=>c.z>-5&&c.z<80).sort((a,b)=>a.z-b.z),first=upcoming[0];
      const occupied=first?upcoming.filter(c=>Math.abs(c.z-first.z)<18).map(c=>Math.round(c.lane)):[];
      const choices=[0,1,2].filter(l=>l!==closed&&!occupied.includes(l));
      if(choices.length)target=choices.sort((a,b)=>Math.abs(a-s.x)-Math.abs(b-s.x))[0];
      else {target=closed===0?2:0;brake=Boolean(first&&first.z<45);}
      if(e?.type==='checkpoint'&&e.remaining<115){target=e.lane;brake=upcoming.some(c=>Math.abs(c.lane-target)<.6&&c.z<30);}
      const crossing=upcoming.some(c=>c.z>-8&&c.z<48&&c.lane>=Math.min(s.x,target)-.65&&c.lane<=Math.max(s.x,target)+.65);
      if(crossing&&Math.abs(target-s.x)>.18){target=Math.round(s.x);brake=true;}
      if(closed>=0&&Math.abs(s.x-closed)<.5&&s.obstacles.some(o=>o.z>0&&o.z<35))brake=true;
      const error=target-(s.x+Math.sin(s.heading)*s.speed*.3/3.5);
      return {direction:Math.abs(error)>.055?Math.sign(error):0,brake,event:e?.type,remaining:e?.remaining,speed:s.speed,events:s.eventsCompleted};
    });
    if(!drive)continue;
    if(drive.direction!==lastDirection){
      await page.keyboard.up('KeyA');await page.keyboard.up('KeyD');
      if(drive.direction)await page.keyboard.down(drive.direction<0?'KeyA':'KeyD');lastDirection=drive.direction;
    }
    if(drive.brake)await page.keyboard.down('KeyS');else await page.keyboard.up('KeyS');
    if(performance.now()-began>6000&&performance.now()-began<7200)await page.keyboard.down('Space');else await page.keyboard.up('Space');
    if(drive.event&&!captured.has(drive.event)&&drive.remaining<65){captured.add(drive.event);await page.screenshot({path:'output/playwright/drive-'+drive.event+'.png'});}
    await page.waitForTimeout(100);
  }
  await page.screenshot({path:'output/playwright/3d-drive-final.png'});
  const state=await page.evaluate(()=>({screen:document.querySelector('#app').dataset.screen,distance:window.__recordState?.distance,eventsCompleted:window.__recordState?.eventsCompleted}));
  const video=page.video();await context.close();await rename(await video.path(),'output/playwright/video/potok-drive.webm');
  await writeFile('output/playwright/drive-report.json',JSON.stringify({captured:[...captured],state,errors},null,2));
  console.log(JSON.stringify({recorded:'output/playwright/video/potok-drive.webm',captured:[...captured],state,errors}));
} finally {await browser.close();}
