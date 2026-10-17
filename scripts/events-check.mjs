// Isolated visual fixtures use the real simulation and renderer; they do not
// alter the app's active game or grant it events/rewards.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
const server=startServer({port:0,root:process.argv.includes('--dist')?path.resolve('dist'):process.cwd()});
await once(server,'listening');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('#loadStatus').hidden);
  const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(now+100);
  await page.evaluate(async()=>{const{RoadRenderer}=await import('./src/world.js'),render=RoadRenderer.prototype.render;/** Expose the renderer for isolated event fixtures while forwarding live-game render calls unchanged. */ RoadRenderer.prototype.render=function(...args){window.__eventWorld=this;return render.apply(this,args);};});
  await page.locator('#playBtn').click();await page.clock.runFor(1000);
  for(const type of ['roadworks','checkpoint','convoy']){
    /**
     * Build a separate seeded event state and render it through production APIs.
     * Moves obstacles/traffic with the prescribed travelled metres, settles 40 frames
     * and returns HUD/geometry/brake evidence. It does not award events to the active game.
     * @param {string} type - Roadworks, checkpoint or convoy fixture to inspect.
     */
    const result=await page.evaluate(async type=>{
      const{Game}=await import('./src/game.js'),{UI}=await import('./src/ui.js'),{seededRandom}=await import('./src/util.js');
      const game=new Game({random:seededRandom(123)});game.start();const s=game.state;
      s.traffic=[];s.pickups=[];s.nextSpawn=s.nextEvent=Infinity;s.speed=28;game.startEvent(type);
      const e=s.roadEvent,move=type==='convoy'?145:115;
      s.distance=move;s.elapsed=4;
      for(const o of s.obstacles)o.z-=move;
      for(const c of s.traffic)c.z-=move;
      if(type==='convoy')game.update(.1,{throttle:1});else game.updateEvent();
      const world=window.__eventWorld;for(let i=0;i<40;i++)world.render(s,{dt:1/60});UI.prototype.hud.call({},s);
      return {title:e.title,obstacles:world.hazards.size,gate:world.gate.visible,brakes:[...world.traffic.values()].map(c=>c.userData.brakeMaterial.emissiveIntensity)};
    },type);
    assert.equal(await page.locator('#eventTitle').textContent(),result.title);
    if(type==='roadworks')assert.equal(result.obstacles,10);
    if(type==='checkpoint')assert.equal(result.gate,true);
    if(type==='convoy'){assert.equal(result.brakes.length,4);assert.ok(result.brakes.every(n=>n>1));}
    await page.screenshot({path:'output/playwright/event-fixture-'+type+'.png'});
    console.log('PASS '+type+': real event geometry, HUD and signals');
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
