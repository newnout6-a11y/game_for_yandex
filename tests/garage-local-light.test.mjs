import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';

/** Construct the actual light owner without allocating a WebGL context. */
function scene(){return new GarageScene({renderer:{toneMappingExposure:1,render(){}},makeVehicle:()=>new T.Group()});}

test('workshop key is a local single-face ceiling fixture with a matched soft cone and cached shadow',()=>{
 const g=scene(),key=g.key;g.scene.updateMatrixWorld(true);key.shadow.updateMatrices(key);
 assert.equal(key.isSpotLight,true);assert.equal(key.isDirectionalLight,undefined);assert.equal(key.decay,2);assert.ok(key.intensity>=40&&key.intensity<200);
 assert.equal(key.shadow.camera.isPerspectiveCamera,true);assert.equal(key.shadow.focus,1);assert.equal(key.shadow.getViewportCount(),1);
 assert.ok(key.penumbra>=.25&&key.penumbra<=.5);assert.ok(Math.abs(key.shadow.camera.fov-2*key.angle*180/Math.PI)<1e-9);assert.equal(key.shadow.camera.far,key.distance);
 assert.deepEqual(key.shadow.mapSize.toArray(),[1024,1024]);assert.equal(key.shadow.autoUpdate,false);
 assert.equal(g.scene.children.filter(n=>n.isLight&&n.castShadow).length,1);g.dispose();
});

for(const tier of [1,2,3,4])test(`tier${tier} actual room fixtures do not intercept the key-to-contact rays`,async()=>{
 const g=scene(),key=g.key,room=(await loadRoadsterGeometry(new URL(`../public/assets/garage/tier${tier}.glb`,import.meta.url))).scene;room.updateMatrixWorld(true);
 const bounds=new T.Box3().setFromObject(room,true);assert.ok(bounds.containsPoint(key.position));
 const ray=new T.Raycaster(),up=new T.Vector3(0,1,0);ray.set(key.position,up);const ceiling=ray.intersectObject(room,true).find(hit=>hit.point.y>6.3);assert.ok(ceiling&&ceiling.point.y>key.position.y+.2);
 // Actual floor pixels that exposed the old suspended-fixture stripe, plus
 // parking and toy contacts. This checks real exported triangles, not roof bounds.
 for(const point of [[4.58348,.03,-3.9141],[2.36403,.03,-4.27058],[.12555,.03,-3.78961],[-.5911,.03,-3.67962],[-7.3,.03,-3.6],[7.3,.03,-3.6],[-3,.03,4.8],[0,.03,0]]){
  const p=new T.Vector3(...point),to=key.position.clone().sub(p),distance=to.length();ray.near=.03;ray.far=distance-.01;ray.set(p,to.normalize());
  assert.equal(ray.intersectObject(room,true).length,0,'The local proxy is below every suspended casing on useful receiver rays');
 }
 g.scene.updateMatrixWorld(true);key.shadow.updateMatrices(key);const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(key.shadow.camera.projectionMatrix,key.shadow.camera.matrixWorldInverse));
 const direction=key.target.position.clone().sub(key.position).normalize();
 let litSamples=0;
 for(let x=-9;x<=9;x+=1.5)for(let y=.02;y<=4;y+=.65)for(let z=-7;z<=7;z+=1.3){const p=new T.Vector3(x,y,z),v=p.clone().sub(key.position);if(v.length()<key.distance&&v.normalize().dot(direction)>Math.cos(key.angle)+.0001){litSamples++;assert.ok(frustum.containsPoint(p),'Every lit floor/contact/room point has matching shadow coverage');}}
 assert.ok(litSamples>100,'Coverage proof is non-vacuous for the actual narrowed cone');
 g.dispose();
});

// Pin useful texel density as well as avoiding the former hard coverage edge.
test('centered showroom cone spends the fixed map on vehicle contact footprints, not distant empty space',()=>{
 const g=scene(),k=g.key;g.scene.updateMatrixWorld(true);k.shadow.updateMatrices(k);
 const direction=k.target.position.clone().sub(k.position).normalize();
 for(const x of [-7.3,-6.2,-1.5,0,1.5,6.2,7.3])for(const z of [-3.8,-.8,2.2]){
  const p=new T.Vector3(x,0,z),v=p.clone().sub(k.position),depth=v.dot(direction);
  assert.ok(v.clone().normalize().dot(direction)>Math.cos(k.angle),'Actual useful floor envelope remains within the physical light');
  assert.ok(2*depth*Math.tan(k.angle)/k.shadow.mapSize.x<.021,'Floor shadow texel <=21mm with only1024 samples');
 }
 assert.equal(k.shadow.focus,1);assert.equal(k.shadow.mapSize.x,1024);assert.ok(k.penumbra>.2);
 assert.ok(k.position.y<4.573&&k.position.y>4.4,'Emitter is below the lowest actual suspended diffuser in all tiers');g.dispose();
});
