import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';

/** Construct the actual light owner without allocating a WebGL context. */
function scene(){return new GarageScene({renderer:{toneMappingExposure:1,render(){}},makeVehicle:()=>new T.Group()});}

test('workshop key is a local single-face ceiling fixture with a matched soft cone and cached shadow',()=>{
 const g=scene(),key=g.key;g.scene.updateMatrixWorld(true);key.shadow.updateMatrices(key);
 assert.equal(key.isSpotLight,true);assert.equal(key.isDirectionalLight,undefined);assert.equal(key.decay,2);assert.ok(key.intensity>50&&key.intensity<200);
 assert.equal(key.shadow.camera.isPerspectiveCamera,true);assert.equal(key.shadow.focus,1);assert.equal(key.shadow.getViewportCount(),1);
 assert.ok(key.penumbra>=.5);assert.equal(key.shadow.camera.fov,2*key.angle*180/Math.PI);assert.equal(key.shadow.camera.far,key.distance);
 assert.deepEqual(key.shadow.mapSize.toArray(),[1024,1024]);assert.equal(key.shadow.autoUpdate,false);
 assert.equal(g.scene.children.filter(n=>n.isLight&&n.castShadow).length,1);g.dispose();
});

for(const tier of [1,2,3,4])test(`tier${tier} actual ceiling lies above the key and cannot shadow the receiver-to-light rays`,async()=>{
 const g=scene(),key=g.key,room=(await loadRoadsterGeometry(new URL(`../public/assets/garage/tier${tier}.glb`,import.meta.url))).scene;room.updateMatrixWorld(true);
 const bounds=new T.Box3().setFromObject(room,true);assert.ok(bounds.containsPoint(key.position));
 const ray=new T.Raycaster(),up=new T.Vector3(0,1,0);ray.set(key.position,up);const ceiling=ray.intersectObject(room,true).find(hit=>hit.point.y>6.3);assert.ok(ceiling&&ceiling.point.y>key.position.y+.5);
 // These are the wall/floor regions on opposite sides of the old clipped
 // directional-map edge. Every segment to the real lamp stays below the roof.
 for(const point of [[9.875,1,0],[9.875,3,0],[6,.03,0],[0,.03,0]]){
  const p=new T.Vector3(...point),to=key.position.clone().sub(p),distance=to.length();ray.near=.02;ray.far=distance-.02;ray.set(p,to.normalize());
  const hits=ray.intersectObject(room,true);assert.equal(hits.some(hit=>hit.point.y>=6.4),false,'No roof is between room receiver and local lamp');
 }
 g.scene.updateMatrixWorld(true);key.shadow.updateMatrices(key);const frustum=new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(key.shadow.camera.projectionMatrix,key.shadow.camera.matrixWorldInverse));
 const direction=key.target.position.clone().sub(key.position).normalize();
 for(let y=.1;y<=4;y+=.65)for(let z=-7;z<=6;z+=1.3){const p=new T.Vector3(9.875,y,z),v=p.clone().sub(key.position);if(v.length()<key.distance&&v.normalize().dot(direction)>Math.cos(key.angle)+.0001)assert.ok(frustum.containsPoint(p),'Every illuminated wall point has matching shadow coverage');}
 g.dispose();
});
