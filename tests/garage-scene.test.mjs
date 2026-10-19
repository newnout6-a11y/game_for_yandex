import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene,GARAGE_PARKING_BAYS} from '../src/garage-scene.js';

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
 await scene.setTier(2);assert.equal(scene.parkedVehicles.length,1);assert.equal(scene.parkedVehicles[0].position.x,GARAGE_PARKING_BAYS[0].x);assert.equal(scene.parkedVehicles[0].position.z,GARAGE_PARKING_BAYS[0].z);
 await scene.setTier(4);assert.equal(scene.parkedVehicles.length,2);assert.equal(scene.parkedVehicles[1].position.x,GARAGE_PARKING_BAYS[1].x);scene.dispose();
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
 scene.setVehicle('hatch');assert.equal(scene.inspection,'overview');scene.render(1440,900);assert.equal(scene.camera.near,.08);assert.equal(scene.camera.fov,scene.orbitRig.fov);assert.ok(scene.camera.fov>=38);scene.dispose();
});

for(const [compact,cap,expected] of [[false,16,8],[true,16,4],[false,2,2],[true,undefined,1]])test(`garage texture sampling is bounded for ${compact?'compact':'desktop'} capability ${cap}`,async()=>{
 const {scene,renderer}=fixture();scene.dispose();renderer.capabilities={getMaxAnisotropy:()=>cap};
 const garage=new GarageScene({renderer,compact,makeVehicle:()=>new T.Group()});garage.rebuildEnvironment=()=>{};
 const colour=new T.Texture(),normal=new T.Texture(),renderTarget=new T.Texture();renderTarget.isRenderTargetTexture=true;
 colour.colorSpace=T.SRGBColorSpace;const material=new T.MeshStandardMaterial({map:colour,normalMap:normal,envMap:renderTarget});
 const room=new T.Group();room.add(new T.Mesh(new T.BoxGeometry(),[material,material]));
 garage.loader.loadAsync=async()=>({scene:room});await garage.setTier(1);
 assert.equal(colour.anisotropy,expected);assert.equal(normal.anisotropy,expected);
 assert.equal(colour.colorSpace,T.SRGBColorSpace);assert.equal(normal.colorSpace,T.NoColorSpace);
 assert.equal(colour.minFilter,T.LinearMipmapLinearFilter);assert.equal(colour.magFilter,T.LinearFilter);
 assert.equal(colour.version,1,'Shared material texture configured once');assert.equal(renderTarget.anisotropy,1,'Reflection target untouched');
 garage.dispose();
});


test('a moving TV reuses garage shadows; geometry, cabin visibility and restored GPU invalidate them',async()=>{
 const {scene,listeners,renderer}=fixture();scene.loader.loadAsync=async()=>({scene:new T.Group()});await scene.setTier(1);scene.setVehicle('rocket');
 assert.equal(scene.key.shadow.autoUpdate,false);assert.equal(scene.key.shadow.needsUpdate,true);
 renderer.render=()=>{scene.key.shadow.needsUpdate=false;};scene.render(1440,900);assert.equal(scene.key.shadow.needsUpdate,false);
 scene.screenDisplay.advance=()=>true;scene.advance(1/12);assert.equal(scene.key.shadow.needsUpdate,false,'Video pixels do not move shadow casters');
 scene.orbit(20,0);scene.render(1440,900);assert.equal(scene.key.shadow.needsUpdate,false,'View orbit preserves the same light-space map');
 scene.setInspection('rear');assert.equal(scene.key.shadow.needsUpdate,true);scene.render(1440,900);
 scene.setVehicle('hatch');assert.equal(scene.key.shadow.needsUpdate,true);scene.render(1440,900);
 scene.tier=2;scene.setParking([{id:'van'}]);assert.equal(scene.key.shadow.needsUpdate,true);scene.render(1440,900);
 listeners.get('webglcontextrestored')();assert.equal(scene.key.shadow.needsUpdate,true);scene.dispose();
});


test('TV visibility retains the transparent heading strip above a landscape phone car-fit region',async()=>{
 const {scene}=fixture();scene.loader.loadAsync=async()=>({scene:new T.Group()});await scene.setTier(1);scene.setVehicle('rocket');
 scene.render(844,390,{x:153,y:139,width:401,height:126});
 assert.deepEqual(scene.screenRegion,{x:153,y:0,width:401,height:390});scene.dispose();
});
