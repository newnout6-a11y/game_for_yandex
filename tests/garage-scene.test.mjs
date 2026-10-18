import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';

/** Exercise the actual async scene owner without requesting a WebGL context. */
function fixture(){
 const listeners=new Map(),statuses=[],renderer={toneMappingExposure:1,domElement:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},render(){}};
 const scene=new GarageScene({renderer,makeVehicle:()=>{const car=new T.Group();car.add(new T.Mesh(new T.BoxGeometry(2,1.3,4.7),new T.MeshStandardMaterial()));return car;},onStatus:s=>statuses.push(s)});
 scene.rebuildEnvironment=()=>{scene.environmentDirty=false;};return {scene,statuses,listeners,renderer};
}
test('failed tier retains usable old room and requires an explicit retry',async()=>{
 const {scene}=fixture(),first=new T.Group();let attempts=0;
 scene.loader.loadAsync=async()=>{attempts++;if(attempts===2)throw new Error('missing');return {scene:first};};
 assert.equal(await scene.setTier(1),true);assert.equal(await scene.setTier(2),false);assert.equal(scene.ready,true);assert.equal(scene.tier,1);assert.equal(scene.room,first);assert.equal(scene.failedTier,2);assert.equal(attempts,2);
 assert.equal(await scene.setTier(2),true);assert.equal(scene.failedTier,null);assert.equal(scene.tier,2);scene.dispose();
});
test('stale async tier cannot replace newer selection and parallel same-tier request is coalesced',async()=>{
 const {scene}=fixture(),pending=new Map();let calls=0;
 scene.loader.loadAsync=url=>{calls++;return new Promise(resolve=>pending.set(Number(/tier(\d)/.exec(url)[1]),resolve));};
 const a=scene.setTier(1),b=scene.setTier(2);assert.equal(await scene.setTier(2),false);assert.equal(calls,2);
 const second=new T.Group();pending.get(2)({scene:second});assert.equal(await b,true);pending.get(1)({scene:new T.Group()});assert.equal(await a,false);assert.equal(scene.room,second);assert.equal(scene.tier,2);scene.dispose();
});
test('side cars fit only real owned parking slots and remain excluded from room ownership',async()=>{
 const {scene}=fixture();scene.loader.loadAsync=async()=>({scene:new T.Group()});scene.setVehicle('rocket');
 const records=['hatch','sedan','van','suv'].map(id=>({id}));scene.setParking(records);assert.equal(scene.parkedVehicles.length,0);
 await scene.setTier(2);assert.equal(scene.parkedVehicles.length,1);assert.equal(scene.parkedVehicles[0].position.x,-6.2);
 await scene.setTier(4);assert.equal(scene.parkedVehicles.length,2);assert.equal(scene.parkedVehicles[1].position.x,6.2);scene.dispose();
});
test('mobile camera fits full car into the actual visible inspection rectangle',async()=>{
 const {scene}=fixture();scene.loader.loadAsync=async()=>({scene:new T.Group()});await scene.setTier(1);scene.setVehicle('rocket');
 const region={x:18,y:205,width:354,height:190};scene.render(390,844,region);
 const box=new T.Box3().setFromObject(scene.vehicle,true);for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new T.Vector3(x,y,z).project(scene.camera),px=(p.x+1)*195,py=(1-p.y)*422;assert.ok(px>=region.x-2&&px<=region.x+region.width+2);assert.ok(py>=region.y-2&&py<=region.y+region.height+2);}
 scene.dispose();
});
test('context restore invalidates room reflections and render failures restore shared exposure',async()=>{
 const {scene,listeners,renderer}=fixture();scene.loader.loadAsync=async()=>({scene:new T.Group()});await scene.setTier(1);scene.setVehicle('rocket');listeners.get('webglcontextrestored')();assert.equal(scene.environmentDirty,true);
 renderer.render=()=>{throw new Error('GPU unavailable');};assert.throws(()=>scene.render(900,600),/GPU/);assert.equal(renderer.toneMappingExposure,1);assert.equal(scene.environmentDirty,false);scene.dispose();assert.equal(listeners.has('webglcontextrestored'),false);
});

test('inspection views use actual wheel and driver geometry and reset for ground cars',async()=>{
 const {scene}=fixture();scene.loader.loadAsync=async()=>({scene:new T.Group()});await scene.setTier(1);scene.setVehicle('rocket');scene.vehicle.userData.ownedVehicleId='rocket';
 const wheel=new T.Mesh(new T.CylinderGeometry(.35,.35,.2),new T.MeshStandardMaterial());wheel.name='wheel_fl';wheel.position.set(-.8,.35,-1.4);scene.vehicle.add(wheel);
 const metadata=new T.Group();metadata.userData.driverDisplay={reference_eye_game_m:[-.43,1.04,.33],inspection_eye_game_m:[-.32,1.08,.35],center_game_m:[.04,.925,-.3]};scene.vehicle.add(metadata);
 scene.setInspection('rear');scene.render(1440,900);assert.ok(scene.camera.position.z>0);
 scene.setInspection('wheels');scene.advance(2);scene.render(1440,900);assert.ok(scene.camera.position.distanceTo(wheel.position)<2.1);
 scene.setInspection('cockpit');scene.advance(2);scene.render(1440,900,{x:230,y:150,width:700,height:500});assert.ok(scene.camera.position.distanceTo(new T.Vector3(-.43,1.046,.33))<.01);assert.equal(scene.camera.near,.025);
 scene.setVehicle('hatch');assert.equal(scene.inspection,'overview');scene.render(1440,900);assert.equal(scene.camera.near,.08);assert.equal(scene.camera.fov,38);scene.dispose();
});
