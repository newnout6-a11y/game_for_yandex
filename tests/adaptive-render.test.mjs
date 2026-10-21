import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoRenderPlan, createAutoRenderController } from '../src/adaptive-render.js';
import { renderDimensions, renderShadowSettings } from '../src/render-settings.js';
import { RoadRenderer } from '../src/world.js';
const phone={width:915,height:412,dpr:2.625,compact:true,deviceMemory:8,hardwareConcurrency:8};
/** Feed deterministic actual elapsed time, capturing budget changes. */
function feed(c,seconds,ms=1000/60,work=3){const changes=[];for(let i=0;i<Math.ceil(seconds*1000/ms);i++)if(c.observe(ms,work))changes.push(c.info().pixels);return changes;}

test('Auto detects capabilities as hints, not a blanket compact/phone classification',()=>{
 const capable=autoRenderPlan(phone),unknown=autoRenderPlan({...phone,deviceMemory:undefined,hardwareConcurrency:undefined}),weak=autoRenderPlan({...phone,deviceMemory:2,hardwareConcurrency:2});
 assert.equal(capable.levels[capable.index],2073600);assert.equal(unknown.levels[unknown.index],1600000);assert.equal(weak.levels[weak.index],1200000);
 assert.deepEqual(capable.levels,weak.levels,'weak hint does not permanently prevent a fast GPU from improving');
 const compactDesktop=autoRenderPlan({...phone,compact:true});assert.equal(compactDesktop.levels[compactDesktop.index],capable.levels[capable.index]);
});
test('Auto plans bounded finite surfaces for missing/bad/extreme values and GL limits',()=>{
 for(const config of [{},{width:NaN,height:Infinity,dpr:-2},{width:1e308,height:1e308,dpr:9},{...phone,maxEdge:512},{width:3840,height:2160,dpr:2,compact:false}]){
  const p=autoRenderPlan(config);assert.ok(p.levels.every(Number.isFinite));assert.ok(p.levels.every(x=>x>0));
  for(const pixels of p.levels){const s=renderDimensions(config.width,config.height,config.dpr,!!config.compact,'auto',false,{pixels,maxEdge:p.maxEdge,maxDpr:p.maxDpr});assert.ok(s.width<=p.maxEdge&&s.height<=p.maxEdge);assert.ok(s.width*s.height<=pixels+1);}
 }
});
test('Auto preserves at least one physical sample per CSS pixel at ordinary viewports',()=>{
 for(const [width,height,compact]of[[915,412,true],[1280,720,false],[1920,1080,false]]){
  const p=autoRenderPlan({width,height,dpr:2,compact});assert.ok(p.levels[0]>=width*height);
 }
});
test('actual adaptive dimensions bypass old 0.8M cap; manual and shadows unchanged',()=>{
 const p=createAutoRenderController(phone).info(),auto=renderDimensions(915,412,2.625,true,'auto',false,p);
 assert.ok(auto.width*auto.height>2000000);assert.ok(auto.width*auto.height>renderDimensions(915,412,2.625,true,'auto').width*renderDimensions(915,412,2.625,true,'auto').height*2);
 for(const q of ['high','ultra'])assert.deepEqual(renderDimensions(915,412,2.625,true,q,false,p),renderDimensions(915,412,2.625,true,q));
 assert.equal(renderShadowSettings('auto',true).mapSize,1024);
});
test('60 and 120Hz stable scenes move up slowly without demanding native120fps',()=>{
 for(const ms of [1000/60,1000/120]){
  const c=createAutoRenderController(phone),start=c.info().pixels;
  assert.deepEqual(feed(c,10,ms),[],'warmup and repeated windows first');
  const changes=feed(c,50,ms);assert.ok(changes.length>0);assert.ok(changes.length<=3);assert.ok(c.info().pixels>=start);
 }
});
test('single stall or small stutter window does not lower quality',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;
 feed(c,3);c.observe(180,3);feed(c,4);assert.equal(c.info().pixels,start);
});
test('sustained slow active frames initiate one bounded downscale trial and keep only a measured benefit',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;
 const changes=feed(c,11,33.333,3);assert.equal(changes.length,1);assert.ok(c.info().pixels<start);
 const low=c.info().pixels;feed(c,7,16.667,3);assert.equal(c.info().pixels,low);
 feed(c,35,16.667,3);assert.equal(c.info().pixels,low,'failed higher tier remains backed off, no ping-pong');
});
test('CPU work or 30Hz browser cap cannot walk Auto down to blur',()=>{
 const cpu=createAutoRenderController(phone),cpuStart=cpu.info().pixels;feed(cpu,90,33.333,28);assert.equal(cpu.info().pixels,cpuStart);
 const capped=createAutoRenderController(phone),start=capped.info().pixels;
 const changes=feed(capped,50,33.333,3);assert.deepEqual(changes,[1600000,start]);assert.equal(capped.status,'cadence-limited');assert.equal(capped.info().pixels,start);
});
test('genuinely slow100ms active cadence is not discarded as an outlier',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;const changes=feed(c,11,100,2);assert.equal(changes.length,1);assert.ok(c.info().pixels<start);
});
test('pause/loading/ad/context gap cancels pending probe and resets partial windows',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;feed(c,11,33.333);assert.ok(c.info().pixels<start);
 assert.equal(c.suspend(),true);assert.equal(c.info().pixels,start);
 for(let i=0;i<300;i++)c.suspend();assert.deepEqual(feed(c,5,33.333),[]);
 const d=createAutoRenderController(phone);feed(d,6,33.333);d.suspend();assert.deepEqual(feed(d,6,33.333),[]);
});
test('invalid timing cannot corrupt a budget or accumulate an active window',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;
 for(const ms of [NaN,Infinity,-1,0,1,5000]){c.observe(ms);assert.equal(c.info().pixels,start);}
 c.observe(16,Infinity);assert.equal(c.info().pixels,start);
});
test('world samples only loaded active Auto road rendering and not manual or showcase',()=>{
 const w=Object.create(RoadRenderer.prototype);let samples=0,suspends=0,resizes=0;
 Object.assign(w,{loaded:true,quality:'auto',showcase:false,autoContextLost:false,autoStatus:'balanced',autoController:{status:'balanced',observe(){samples++;return false;},suspend(){suspends++;return false;}},resize(){resizes++;}});
 w.observeAutoFrame(16,3,true);assert.equal(samples,1);
 for(const [key,value]of[['loaded',false],['quality','high'],['showcase',true],['autoContextLost',true]]){const old=w[key];w[key]=value;w.observeAutoFrame(16,3,true);w[key]=old;}
 w.observeAutoFrame(16,3,false);assert.equal(samples,1);assert.equal(suspends,5);assert.equal(resizes,0);
});
test('main wiring uses raw rAF, explicit lifecycle guards and no profile/cloud persistence',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),policy=readFileSync(new URL('../src/adaptive-render.js',import.meta.url),'utf8');
 assert.match(main,/const frameMs=time-previous/);assert.match(main,/autoActive&&autoFrameActive/);
 for(const guard of ['!lifecycle.paused','!orientationBlocked','!document.hidden','!busy','!loading.adPending','!renderer.autoContextLost'])assert.ok(main.includes(guard));
 assert.doesNotMatch(policy,/localStorage|fetch\(|XMLHttpRequest|userAgent|UNMASKED_RENDERER/);
});

test('upscale that loses60fps headroom is rolled back even above the overload floor',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;const up=feed(c,15,16.6667,4);assert.equal(up.length,1);assert.ok(c.info().pixels>start);
 const down=feed(c,9,22.222,4);assert.deepEqual(down,[start]);feed(c,60,16.6667,4);assert.equal(c.info().pixels,start);
});
test('resolution-insensitive cap is remembered, not retried into blur every minute',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;const changes=feed(c,300,33.333,3);assert.deepEqual(changes,[1600000,start]);
});
test('improved workload on120Hz need not maintain120fps to retain a sharper surface',()=>{
 const c=createAutoRenderController(phone);feed(c,15,8.3333,3);const sharper=c.info().pixels;feed(c,9,13.333,3);assert.equal(c.info().pixels,sharper);
});

test('adaptive resize is deferred until before next render, never clears an already drawn frame',()=>{
 const w=Object.create(RoadRenderer.prototype);let resizes=0;
 Object.assign(w,{loaded:true,quality:'auto',showcase:false,autoContextLost:false,autoController:{observe:()=>true,status:'measuring',suspend:()=>false},resize(){resizes++;},bonusEffects:null});
 w.observeAutoFrame(16,3,true);assert.equal(resizes,0);assert.equal(w.autoResizePending,true);assert.equal(w.needsRender,true);
 Object.defineProperty(w,'playerState',{get(){throw Error('drawing boundary');}});
 assert.throws(()=>w.render({},{}),/drawing boundary/);assert.equal(resizes,1);assert.equal(w.autoResizePending,false);
 const source=readFileSync(new URL('../src/world.js',import.meta.url),'utf8');const render=source.slice(source.indexOf('  render(state,'));
 assert.ok(render.indexOf('if(this.autoResizePending)')<render.indexOf('this.renderer.render(this.scene,this.camera)'));
});

/** Exercise the production resize method without allocating a browser/WebGL context. */
function withAutoWorld(operation){
 const names=['innerWidth','innerHeight','devicePixelRatio','matchMedia'],old=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 try{
  Object.assign(globalThis,{innerWidth:915,innerHeight:412,devicePixelRatio:2.625,matchMedia:()=>({matches:true})});
  const w=Object.create(RoadRenderer.prototype);Object.assign(w,{quality:'auto',autoDevice:{deviceMemory:8,hardwareConcurrency:8,maxEdge:4096},canvas:{width:0,height:0,style:{}},renderer:{setSize(width,height){Object.assign(w.canvas,{width,height});}},camera:{updateProjectionMatrix(){}}});w.resize();operation(w);
 }finally{for(const n of names)if(old[n])Object.defineProperty(globalThis,n,old[n]);else delete globalThis[n];}
}
test('production resize preserves a measured downshift and its recovery holdoff across address-bar changes',()=>withAutoWorld(w=>{
 const c=w.autoController;feed(c,11,33.333,3);feed(c,7,16.667,3);assert.equal(c.info().pixels,1600000);
 globalThis.innerHeight=420;w.resize();assert.equal(w.autoController,c);assert.equal(c.info().pixels,1600000);assert.ok(w.canvas.width*w.canvas.height<=1600000);
 feed(c,40,16.667,3);assert.equal(c.info().pixels,1600000,'resize cannot discard learned higher-tier backoff');
}));
test('resize rolls back an unfinished probe and keeps no-benefit cadence memory',()=>withAutoWorld(w=>{
 const c=w.autoController,start=c.info().pixels;feed(c,11,33.333,3);assert.ok(c.info().pixels<start);
 globalThis.innerHeight=414;w.resize();assert.equal(c.info().pixels,start);assert.equal(c.status,'calibrating');
 feed(c,50,33.333,3);assert.equal(c.status,'cadence-limited');
 globalThis.innerHeight=416;w.resize();assert.equal(c.status,'cadence-limited');assert.deepEqual(feed(c,180,33.333,3),[],'same30Hz cap does not get another blur experiment after resize');
}));
test('viewport/DPR reconfiguration clamps to new bounds and discards old partial timing windows',()=>withAutoWorld(w=>{
 const c=w.autoController;feed(c,6,33.333,3);
 globalThis.innerHeight=414;w.resize();assert.deepEqual(feed(c,6,33.333,3),[],'two partial overload windows cannot straddle viewport geometry');
 globalThis.innerWidth=360;globalThis.innerHeight=300;globalThis.devicePixelRatio=1;w.resize();assert.equal(w.autoController,c);assert.ok(w.canvas.width<=360&&w.canvas.height<=300);assert.equal(c.info().pixels,108000);
 globalThis.innerWidth=1080;globalThis.innerHeight=1920;globalThis.devicePixelRatio=3;w.resize();assert.equal(w.autoController,c);assert.ok(w.canvas.width<=3840&&w.canvas.height<=3840);assert.ok(c.info().pixels>=1600000&&c.info().pixels<=3686400);
}));

test('retained native-size tier cannot create a too-small downprobe that hides pixel-sensitive overload',()=>{
 const c=createAutoRenderController({...phone,height:344});const retained=c.info().pixels;
 assert.equal(retained,915*344*2.625**2);c.reconfigure(phone);assert.equal(c.info().pixels,retained);
 const transitions=[];
 for(let i=0;i<1200;i++){
  const frameMs=33.333*c.info().pixels/retained;
  if(c.observe(frameMs,3))transitions.push(c.info().pixels);
 }
 assert.ok(transitions.length>0);assert.ok(transitions[0]<=retained/1.12,'first probe must have a meaningful possible benefit');
 assert.ok(c.info().pixels<retained);assert.notEqual(c.status,'cadence-limited','pixel-sensitive workload is not misclassified by an adjacent near-duplicate level');
});

test('material viewport change invalidates old no-benefit evidence but a new fixed cap is tried only once',()=>withAutoWorld(w=>{
 const c=w.autoController,start=c.info().pixels;feed(c,50,33.333,3);assert.equal(c.status,'cadence-limited');
 globalThis.innerWidth=1280;globalThis.innerHeight=720;globalThis.matchMedia=()=>({matches:false});w.resize();
 assert.equal(c.info().pixels,start);assert.equal(c.status,'calibrating');
 const changes=feed(c,300,34,3);assert.deepEqual(changes,[1600000,start],'changed workload gets one new trial, not endless blur');
}));
test('material DPR change invalidates no-benefit evidence even if learned pixel budget stays the same',()=>withAutoWorld(w=>{
 globalThis.devicePixelRatio=2;w.resize();const c=w.autoController;feed(c,50,33.333,3);const pixels=c.info().pixels;globalThis.devicePixelRatio=2.625;w.resize();assert.equal(c.info().pixels,pixels);
 assert.equal(c.status,'calibrating');assert.equal(feed(c,11,34,3).length,1);
}));
test('small toolbar resizes preserve evidence, cumulative material changes are compared with the measured viewport',()=>withAutoWorld(w=>{
 const c=w.autoController;feed(c,50,33.333,3);
 for(const height of [416,420,424]){globalThis.innerHeight=height;w.resize();assert.equal(c.status,'cadence-limited');assert.deepEqual(feed(c,30,33.333,3),[]);}
 for(const height of [440,460,480,500,520]){globalThis.innerHeight=height;w.resize();}
 assert.equal(c.status,'calibrating');assert.equal(feed(c,11,34,3).length,1);
}));
test('materially changed workload can now retain a useful lower budget at the previously blocked cadence',()=>withAutoWorld(w=>{
 const c=w.autoController;feed(c,50,33.333,3);
 globalThis.innerWidth=1280;globalThis.innerHeight=720;globalThis.matchMedia=()=>({matches:false});w.resize();
 assert.deepEqual(feed(c,11,34,3),[1600000]);feed(c,7,20,3);
 assert.equal(c.info().pixels,1600000);assert.equal(c.status,'balanced');
}));

test('one isolated valid hitch cannot reject a useful downscale experiment',()=>{
 const c=createAutoRenderController(phone);feed(c,11,33.333,3);const lower=c.info().pixels;
 feed(c,3,30,3);c.observe(900,3);feed(c,3,30,3);
 assert.equal(c.info().pixels,lower);assert.equal(c.status,'balanced');
});
test('one isolated valid hitch cannot reject an otherwise healthy upscale experiment',()=>{
 const c=createAutoRenderController(phone);feed(c,15,16.667,3);const higher=c.info().pixels;
 feed(c,3,17,3);c.observe(900,3);feed(c,3,17,3);
 assert.equal(c.info().pixels,higher);assert.equal(c.status,'balanced');
});
test('sustained slow probe frames are not trimmed away as isolated hitches',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;feed(c,15,16.667,3);feed(c,9,100,3);
 assert.equal(c.info().pixels,start);
 const d=createAutoRenderController(phone),initial=d.info().pixels;feed(d,11,100,3);feed(d,9,100,3);assert.equal(d.info().pixels,initial);assert.equal(d.status,'cadence-limited');
});

test('accepted upscale invalidates no-benefit evidence measured at the previous tier pair',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;feed(c,150,33.333,3);assert.equal(c.info().pixels,start);assert.equal(c.status,'cadence-limited');
 feed(c,24,16.667,3);assert.ok(c.info().pixels>start);assert.equal(c.status,'balanced');
 const changes=feed(c,18,33.333,3);assert.ok(changes.length>0,'new higher-to-lower tier pair must be measured, not blocked by old cadence');
});
test('rejected upscale preserves no-benefit memory for the unchanged stable tier pair',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;feed(c,150,33.333,3);
 feed(c,15,16.667,3);assert.ok(c.info().pixels>start);feed(c,9,33.333,3);assert.equal(c.info().pixels,start);
 assert.deepEqual(feed(c,90,33.333,3),[],'failed upward experiment must not re-enable repetitive blur at the original tier');
});
test('accepted downscale also invalidates no-benefit evidence from a previous tier pair',()=>{
 const c=createAutoRenderController(phone),start=c.info().pixels;feed(c,50,33.333,3);
 feed(c,11,45,3);assert.ok(c.info().pixels<start);feed(c,7,25,3);const lower=c.info().pixels;assert.equal(c.status,'balanced');
 const changes=feed(c,25,33.333,3);assert.ok(changes.some(pixels=>pixels<lower),'new lower tier pair is independently eligible');
});
