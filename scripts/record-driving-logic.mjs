import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

// Six seconds of actual production Game/renderer under explicitly controlled
// simulation time. Safe initial traffic is a named fixture, not a live session.
// No subsequent traffic position or intent is assigned by this capture script.
const out=path.resolve('output/driving-logic-demo');await mkdir(out+'/frames',{recursive:true});
const source=await readFile('src/main.js','utf8');
const expose=`\nwindow.__demo={get ready(){return assetsReady&&garageScene?.ready},async prepare(){await startRun();Object.assign(game.state,{speed:32,x:1,lane:1,distance:700,nextSpawn:Infinity,nextEvent:Infinity,obstacles:[],pickups:[],safeCorridor:null,traffic:[{id:901,kind:'sedan',lane:1,z:190,speed:20,cruiseSpeed:20,color:5,laneChangeCooldown:0,laneDecisionIn:0},{id:902,kind:'van',lane:0,z:35,speed:18,cruiseSpeed:18,color:2},{id:903,kind:'boxtruck',lane:2,z:290,speed:16,cruiseSpeed:16,color:3}]});renderer.view={};renderer.resize();},frame(){game.update(1/24,input.read());telemetry.observe(game.state,1/24);ui.hud(game.state);renderer.render(game.state,{dt:1/24,paused:false});const s=game.state,c=s.traffic.find(c=>c.id===901);return{elapsed:s.elapsed,phase:s.phase,x:s.x,speed:s.speed,heading:s.heading,horn:s.hornTime,serial:s.hornSerial,guards:s.trafficDiagnostics.interventions,car:c&&{z:c.z,x:c.x,lane:c.lane,signal:c.signal,phase:c.laneChange?.phase,reason:c.laneChange?.reason},render:{...renderer.renderer.info.render}};}};`;
const server=startServer({port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
const samples=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});page.setDefaultTimeout(180000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));
 const profile=createProfile({id:'driving_video_fixture'});profile.settings.sound=false;
 await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
 await page.clock.install({time:new Date('2026-10-18T12:00:00Z')});await page.clock.pauseAt(new Date('2026-10-18T12:01:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
 const end=Date.now()+180000;while(Date.now()<end){if(await page.evaluate(()=>window.__demo?.ready))break;await new Promise(r=>setTimeout(r,100));}assert.equal(await page.evaluate(()=>window.__demo?.ready),true);
 await page.evaluate(()=>window.__demo.prepare());
 await page.keyboard.down('KeyW');await page.keyboard.down('KeyH');
 for(let frame=0;frame<144;frame++){
  if(frame===12)await page.keyboard.up('KeyH');if(frame===18)await page.keyboard.down('KeyD');if(frame===36)await page.keyboard.up('KeyD');
  const sample=await page.evaluate(()=>window.__demo.frame());assert.equal(sample.phase,'playing');assert.equal(sample.guards,0);samples.push(sample);
  await page.screenshot({path:path.join(out,'frames',String(frame).padStart(4,'0')+'.png'),timeout:180000});
  if(frame%24===0)console.log('FRAME',frame,JSON.stringify(sample));
 }
 await page.keyboard.up('KeyW');assert.ok(samples.some(s=>s.car?.reason==='yield-horn'));assert.equal(samples.at(-1).car.lane,0);assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'report.json'),JSON.stringify({method:'Controlled-time production gameplay, 6seconds/24fps at native1280×720; real W/D/H key events, initial safe fixture explicitly set. Muted. Capture frame rate is not measured hardware FPS.',samples,errors},null,2));console.log('COMPLETE',samples.length);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
