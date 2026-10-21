import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';
import {GarageToyProp,GARAGE_TOY_POSITION} from '../src/garage-toy-prop.js';

/** Independent disposable GLB-shaped asset with shared resources to detect double release. */
function asset(){const root=new T.Group(),geometry=new T.BoxGeometry(1,.6,1.3),material=new T.MeshStandardMaterial(),texture=new T.Texture(),counts={geometry:0,material:0,texture:0};material.map=texture;
 for(const [name,value]of Object.entries({geometry,material,texture}))value.addEventListener('dispose',()=>counts[name]++);
 root.add(new T.Mesh(geometry,material),new T.Mesh(geometry,material));return {scene:root,counts};}

test('toy request is coalesced, positioned once and owns no second renderer or animation loop',async()=>{
 const model=asset();let calls=0;const toy=new GarageToyProp({async loadAsync(url){calls++;assert.match(url,/assets\/garage\/toy-racecar\.glb$/);return model;}});
 const a=toy.load(),b=toy.load();assert.equal(a,b);assert.equal(await a,model.scene);assert.equal(calls,1);
 assert.deepEqual(model.scene.position.toArray(),GARAGE_TOY_POSITION);assert.ok(toy.bounds().containsPoint(model.scene.position));
 model.scene.traverse(n=>{if(n.isMesh)assert.ok(n.castShadow&&n.receiveShadow);});toy.dispose();toy.dispose();assert.deepEqual(model.counts,{geometry:1,material:1,texture:1});assert.equal(await toy.load(),null);
});
test('disposing before the deferred request prevents a network call',async()=>{let calls=0;const toy=new GarageToyProp({loadAsync(){calls++;return Promise.resolve(asset());}});const pending=toy.load();toy.dispose();assert.equal(await pending,null);assert.equal(calls,0);});
test('late toy load after disposal releases resources without repopulating the room',async()=>{
 let finish;const model=asset(),toy=new GarageToyProp({loadAsync:()=>new Promise(resolve=>{finish=resolve;})});const pending=toy.load();await Promise.resolve();toy.dispose();finish(model);assert.equal(await pending,null);assert.equal(toy.root,null);assert.deepEqual(model.counts,{geometry:1,material:1,texture:1});
});
test('decorative load failure is reported once and cannot create an automatic retry loop',async()=>{let calls=0,errors=0;const toy=new GarageToyProp({loadAsync:async()=>{calls++;throw new Error('offline');}},{onError:()=>errors++});assert.equal(await toy.load(),null);assert.equal(await toy.load(),null);assert.equal(calls,1);assert.equal(errors,1);toy.dispose();});

test('only flush toy graphics receive a bounded depth offset without disabling occlusion',async()=>{
 const model=asset(),body=model.scene.children[0].material;
 const print=new T.MeshStandardMaterial({name:'Toy McQueen printed decals',transparent:true,depthWrite:false,side:T.DoubleSide});
 const canopy=new T.MeshStandardMaterial({name:'Toy opaque painted windshield'});
 const glass=new T.MeshStandardMaterial({name:'Other transparent surface',transparent:true});
 model.scene.children[0].material=[body,print,canopy,glass];
 const toy=new GarageToyProp({loadAsync:async()=>model});await toy.load();
 assert.equal(print.polygonOffset,true);assert.equal(print.polygonOffsetFactor,-2);assert.equal(print.polygonOffsetUnits,-2);
 assert.equal(print.depthTest,true);assert.equal(print.depthWrite,false);assert.equal(print.transparent,true);assert.equal(print.side,T.DoubleSide);
 for(const material of [body,canopy,glass])assert.equal(material.polygonOffset,false,'Opaque surfaces and unrelated transparency remain unchanged');
 assert.ok(model.scene.children.every(n=>n.castShadow&&n.receiveShadow));toy.dispose();
});

test('owned image bitmaps close once and a disposed toy does not retain its resolved root promise',async()=>{
 const model=asset();let closed=0;const image={close(){closed++;}},extra=new T.Texture(image);
 model.scene.children[0].material.map.image=image;model.scene.children[0].material.normalMap=extra;
 const toy=new GarageToyProp({loadAsync:async()=>model});await toy.load();toy.dispose();toy.dispose();
 assert.equal(closed,1,'Shared decoded pixels are released once across owned textures');assert.equal(toy.promise,null);assert.equal(toy.root,null);assert.equal(await toy.load(),null);
});
test('a bitmap arriving after disposal is closed without retaining or adopting its model',async()=>{
 const model=asset();let finish,closed=0;model.scene.children[0].material.map.image={close(){closed++;}};
 const toy=new GarageToyProp({loadAsync:()=>new Promise(resolve=>{finish=resolve;})});const pending=toy.load();await Promise.resolve();toy.dispose();finish(model);
 assert.equal(await pending,null);assert.equal(closed,1);assert.equal(toy.promise,null);assert.equal(toy.root,null);
});


test('late decorative arrival wakes a settled garage exactly once and enters camera obstacles',async()=>{
 const statuses=[],scene=new GarageScene({renderer:{render(){},toneMappingExposure:1},makeVehicle:()=>{const car=new T.Group();car.add(new T.Mesh(new T.BoxGeometry(2,1,4),new T.MeshStandardMaterial()));return car;},onStatus:s=>statuses.push(s)});
 scene.ready=true;scene.room=new T.Group();scene.rebuildEnvironment=()=>{scene.environmentDirty=false;};scene.setVehicle('rocket');
 const model=asset();scene.loader.loadAsync=async()=>model;
 assert.equal(await scene.prepareToy(),true);assert.equal(model.scene.parent,scene.scene);assert.ok(scene.environmentDirty);assert.equal(statuses.filter(s=>s.toyReady).length,1);
 scene.render(560,315,{x:0,y:44,width:300,height:220});assert.equal(scene.cameraContext.limits.obstacles.length,1);assert.ok(scene.cameraContext.limits.obstacles[0].equals(scene.toyProp.bounds()));
 assert.equal(await scene.prepareToy(),true);assert.equal(statuses.filter(s=>s.toyReady).length,1);scene.dispose();assert.deepEqual(model.counts,{geometry:1,material:1,texture:1});
});
