import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScreenPlayer} from '../src/garage-screen-player.js';

/** Minimal controllable media element; never requests network or a real decoder. */
function fixture({play}={}){
 const listeners=new Map(),stats={created:0,plays:0,pauses:0,loads:0,changes:0,posterLoads:0};
 const video={paused:true,readyState:2,currentTime:0,volume:1,src:'',setAttribute(){},removeAttribute(name){if(name==='src')this.src='';},
  addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n),load(){stats.loads++;},
  play(){stats.plays++;if(play)return play(video);this.paused=false;return Promise.resolve();},pause(){stats.pauses++;this.paused=true;}};
 const poster=new T.Texture(),player=new GarageScreenPlayer({videoUrl:'/fixtures/roadster-screen-loop.mp4',document:{createElement:tag=>{assert.equal(tag,'video');stats.created++;return video;}},
  loadPoster:async()=>{stats.posterLoads++;return poster;},onChange:()=>stats.changes++});
 const room=new T.Group(),screen=new T.Mesh(new T.PlaneGeometry(4,2.25),new T.MeshStandardMaterial());screen.material.name='garage_screen_display';room.add(screen);
 const frame=new T.Mesh(new T.BoxGeometry(4.1,2.35,.1),new T.MeshStandardMaterial());frame.position.z=-.1;room.add(frame);room.updateMatrixWorld(true);
 return {player,room,screen,frame,poster,video,stats,listeners};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

for(const initialized of [false,true])test(`attach after disposal is a no-op before traversal, retention or resource allocation (initialized: ${initialized})`,async()=>{
 const f=fixture();if(initialized)await f.player.attach(f.room);f.player.dispose();
 const late=fixture(),original=late.screen.material,frame=late.frame.material;
 late.screen.material=[frame,original];late.screen.castShadow=true;late.screen.receiveShadow=true;
 const materials=late.screen.material,userData=late.screen.userData,ready=f.player.ready,material=f.player.material,stats={...f.stats};
 let traversals=0;const traverse=late.room.traverse.bind(late.room);late.room.traverse=visitor=>{traversals++;return traverse(visitor);};
 assert.equal(f.player.attach(late.room),ready,'A disposed attachment returns the existing readiness promise');
 assert.equal(traversals,0,'A late room must not even be traversed');assert.equal(f.player.rooms.size,0);assert.equal(f.player.room,null);
 assert.equal(f.player.material,material,'No owned material is created or replaced');assert.equal(f.player.video,null);assert.equal(f.player.videoTexture,null);
 assert.deepEqual(f.stats,stats,'No poster load, decoder creation or change notification is allowed');
 assert.equal(late.screen.material,materials);assert.deepEqual(materials,[frame,original]);assert.equal(late.frame.material,frame);
 assert.equal(late.screen.castShadow,true);assert.equal(late.screen.receiveShadow,true);assert.equal(late.screen.userData,userData);
 assert.equal(late.screen.userData.garageScreenOriginalMaterials,undefined,'The room owner keeps its untouched original materials');
 late.player.dispose();
});

test('late fallback poster completion releases its texture without reviving a disposed player or room',async()=>{
 const f=fixture();let resolve,posterDisposals=0,materialDisposals=0;
 f.player.loadPoster=()=>{f.stats.posterLoads++;return new Promise(done=>resolve=done);};
 f.poster.addEventListener('dispose',()=>posterDisposals++);
 const original=f.screen.material,ready=f.player.attach(f.room),material=f.player.material;
 material.addEventListener('dispose',()=>materialDisposals++);
 f.player.dispose();const stats={...f.stats};
 assert.equal(f.player.attach(f.room),ready);resolve(f.poster);await ready;f.player.dispose();
 assert.equal(posterDisposals,1);assert.equal(materialDisposals,1);assert.equal(f.player.rooms.size,0);assert.equal(f.player.room,null);
 assert.equal(f.player.poster,null);assert.equal(material.map,null);assert.equal(f.poster.flipY,true,'A released late texture is not configured or installed');
 assert.deepEqual(f.stats,stats,'A late result causes no notification, request or decoder allocation');
 assert.deepEqual(f.screen.userData.garageScreenOriginalMaterials,[original],'Original room ownership remains intact');
});

test('one original poster and one deferred silent decoder serve all tier screens without changing frames',async()=>{
 const f=fixture(),original=f.screen.material,frame=f.frame.material;
 await f.player.attach(f.room);assert.equal(f.stats.created,0);assert.equal(f.screen.material.map,f.poster);assert.equal(f.frame.material,frame);
 assert.equal(f.screen.userData.garageScreenOriginalMaterials[0],original);assert.equal(f.screen.castShadow,false);assert.equal(f.screen.material.toneMapped,false);assert.equal(f.poster.flipY,false,'Use glTF image coordinates, not the generic PlaneGeometry orientation');
 const next=f.room.clone(true);await f.player.attach(next);assert.equal(f.stats.posterLoads,1);assert.equal(next.children[0].material,f.screen.material);
 f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();
 assert.equal(f.stats.created,1);assert.equal(f.stats.plays,1);assert.equal(f.video.muted,true);assert.equal(f.video.volume,0);assert.equal(f.video.playsInline,true);assert.equal(f.video.loop,true);
 assert.match(f.video.src,/roadster-screen-loop\.mp4$/);assert.equal(f.player.videoTexture.generateMipmaps,false);assert.equal(f.player.videoTexture.flipY,false);f.player.dispose();
});

test('TV front face and real unobstructed UI region gate media rather than camera mode names',async()=>{
 const f=fixture();await f.player.attach(f.room);f.player.setRoom(f.room);
 const camera=new T.PerspectiveCamera(60,16/9,.08,30);camera.position.set(0,0,6);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 assert.equal(f.player.updateVisibility(camera,1600,900),true);
 assert.equal(f.player.updateVisibility(camera,1600,900,{x:0,y:0,width:20,height:20}),false);
 camera.position.z=-6;camera.lookAt(0,0,0);camera.updateMatrixWorld();assert.equal(f.player.updateVisibility(camera,1600,900),false);
 camera.position.z=6;camera.lookAt(0,0,12);camera.updateMatrixWorld();assert.equal(f.player.updateVisibility(camera,1600,900),false);
 f.player.advance(.1);assert.equal(f.stats.created,0);f.player.dispose();
});

for(const options of [{visible:false},{mediaActive:false},{reducedMotion:true}])test(`hidden/platform/reduced-motion TV pauses independently: ${JSON.stringify(options)}`,async()=>{
 const f=fixture();await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();
 assert.equal(f.video.paused,false);f.player.advance(.1,options);assert.equal(f.video.paused,true);assert.equal(f.player.active,false);
 if(options.reducedMotion)assert.equal(f.player.material.map,f.poster);
 const count=f.stats.plays;for(let i=0;i<10;i++)f.player.advance(.1,options);assert.equal(f.stats.plays,count);f.player.dispose();
});

test('offscreen room and late autoplay completion cannot restart a hidden film',async()=>{
 let resolve;const f=fixture({play:video=>new Promise(done=>{resolve=()=>{video.paused=false;done();};})});await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();
 f.player.setRoom(new T.Group());resolve();await flush();assert.equal(f.video.paused,true);assert.equal(f.player.active,false);f.player.dispose();
});

test('autoplay rejection or a synchronous decoder error stays a static poster without retry spam',async()=>{
 for(const play of [()=>Promise.reject(new Error('policy')),()=>{throw new Error('decoder');}]){
  const f=fixture({play});await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();
  for(let i=0;i<30;i++)f.player.advance(.1);await flush();assert.equal(f.stats.plays,1);assert.equal(f.player.material.map,f.poster);f.player.dispose();
 }
});

test('a media error restores the poster and stops decoding without invalidating the garage',async()=>{
 const f=fixture();await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();
 f.listeners.get('error')();assert.equal(f.video.paused,true);assert.equal(f.player.failed,true);assert.equal(f.player.material.map,f.poster);assert.equal(f.player.advance(.1),false);f.player.dispose();
});

test('scene refresh is bounded to twelve fps and requires newly decoded media, not an always-animating flag',async()=>{
 const f=fixture();await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.001);await flush();
 let changed=0;for(let n=1;n<=120;n++){f.video.currentTime=n/120;if(f.player.advance(1/120))changed++;}
 assert.ok(changed<=12&&changed>=11,`${changed} updates per second`);
 for(let n=0;n<120;n++)assert.equal(f.player.advance(1/120),false,'Frozen decoder never burns scene frames');
 f.player.onScreen=false;f.player.advance(.1);assert.equal(f.video.paused,true);f.player.dispose();
});

test('dispose releases each exclusive GPU/media owner once, and late poster completion is harmless',async()=>{
 const f=fixture();await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();
 const released={poster:0,video:0,material:0};for(const [key,obj] of [['poster',f.poster],['video',f.player.videoTexture],['material',f.player.material]])obj.addEventListener('dispose',()=>released[key]++);
 f.player.dispose();f.player.dispose();assert.deepEqual(released,{poster:1,video:1,material:1});assert.equal(f.video.src,'');assert.equal(f.listeners.size,0);assert.equal(f.stats.loads,1);
 let resolve;const late=new T.Texture();let disposed=0;late.addEventListener('dispose',()=>disposed++);
 const pending=new GarageScreenPlayer({document:{createElement(){}},loadPoster:()=>new Promise(done=>resolve=done)});const room=new T.Group(),mesh=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial());mesh.material.name='garage_screen_display';room.add(mesh);
 const promise=pending.attach(room);pending.dispose();resolve(late);await promise;assert.equal(disposed,1);
});


test('embedded authored poster is reused without another request or duplicate GPU ownership',async()=>{
 const f=fixture(),embedded=new T.Texture();let disposed=0;embedded.addEventListener('dispose',()=>disposed++);f.screen.material.map=embedded;
 await f.player.attach(f.room);assert.equal(f.stats.posterLoads,0);assert.equal(f.player.material.map,embedded);
 f.player.setRoom(f.room);f.player.onScreen=true;f.player.advance(.1);await flush();f.listeners.get('error')();
 assert.equal(f.player.material.map,embedded);f.player.dispose();assert.equal(disposed,0,'The GLB room remains the owner');
});


test('an unconfigured media source stays explicitly disabled without a missing-asset request',async()=>{
 const f=fixture();f.player.videoUrl=null;await f.player.attach(f.room);f.player.setRoom(f.room);f.player.onScreen=true;
 for(let n=0;n<30;n++)assert.equal(f.player.advance(.1),false);
 assert.equal(f.stats.created,0);assert.equal(f.stats.plays,0);assert.equal(f.player.material.map,f.poster);f.player.dispose();
});
