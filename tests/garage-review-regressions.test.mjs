import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';

/** Use the production owner and camera with measured mock bodies, without GPU or platform state. */
function fixture(){
 const statuses=[],renderer={toneMappingExposure:1,render(){}},room=new T.Group();
 room.userData.garageCamera={interiorMin:[-30,-5,-30],interiorMax:[30,20,30],clearance:.25,orbitRadius:16,obstacles:[]};
 const scene=new GarageScene({renderer,onStatus:s=>statuses.push(s),makeVehicle:id=>{
  const car=new T.Group(),body=new T.Mesh(new T.BoxGeometry(1.8,1.2,id==='van'?6.4:4.7),new T.MeshStandardMaterial());body.position.y=.7;car.add(body);
  const wheel=new T.Mesh(new T.CylinderGeometry(.34,.34,.2),new T.MeshStandardMaterial());wheel.name='wheel_fl';wheel.rotation.z=Math.PI/2;wheel.position.set(-.92,.35,-1.4);car.add(wheel);return car;
 }});
 scene.rebuildEnvironment=()=>{};scene.room=room;scene.ready=true;scene.tier=1;scene.setVehicle('hatch');
 return {scene,room,statuses};
}
/** Draw the real camera policy at desktop, phone landscape or portrait aspect. */
function draw(scene,width=1440,height=900){scene.render(width,height,{x:width*.18,y:height*.14,width:width*.57,height:height*.7});}
/** Interrupt an actual close wheel-to-overview transition at its displayed intermediate distance. */
function interrupt(scene,mode='overview'){
 scene.setInspection(mode==='wheels'?'overview':'wheels');scene.advance(2);draw(scene);
 scene.setInspection(mode);scene.advance(.17);draw(scene);
 const shown=scene.camera.position.clone();scene.orbit(0,0);draw(scene);return shown;
}
/** A fresh scene at the same requested mode/orbit must match the recovered framing exactly. */
function expectedPose(scene,width=1440,height=900){
 const {scene:reference}=fixture();reference.setVehicle(scene.vehicleId);reference.setInspection(scene.inspection);reference.advance(2);
 reference.yaw=scene.yaw;reference.pitch=scene.pitch;reference.zoom=scene.zoom;draw(reference,width,height);
 const position=reference.camera.position.clone(),fov=reference.camera.fov;reference.dispose();return {position,fov};
}

test('disposed scene rejects new tier requests before starting loaders or status callbacks',async()=>{
 const {scene,statuses}=fixture();let loads=0;scene.loader.loadAsync=async()=>{loads++;return {scene:new T.Group()};};scene.dispose();const count=statuses.length;
 assert.equal(await scene.setTier(2),false);assert.equal(loads,0);assert.equal(statuses.length,count);assert.equal(scene.cache.size,0);
});

test('room resolving after scene disposal is released, never attached to the disposed TV',async()=>{
 const {scene}=fixture();let finish,attached=0,disposedGeometry=0;
 scene.loader.loadAsync=()=>new Promise(resolve=>{finish=resolve;});const attach=scene.screenDisplay.attach.bind(scene.screenDisplay);scene.screenDisplay.attach=room=>{attached++;return attach(room);};
 const pending=scene.setTier(2),room=new T.Group(),geometry=new T.BoxGeometry();geometry.addEventListener('dispose',()=>disposedGeometry++);room.add(new T.Mesh(geometry,new T.MeshStandardMaterial()));
 scene.dispose();finish({scene:room});assert.equal(await pending,false);await Promise.resolve();
 assert.equal(attached,0);assert.equal(scene.screenDisplay.rooms.size,0);assert.equal(scene.scene.children.length,0);assert.equal(disposedGeometry,1);
});

test('superseded tier load cannot attach its room or replace the newest active TV',async()=>{
 const {scene}=fixture(),pending=new Map(),attached=[];scene.loader.loadAsync=url=>new Promise(resolve=>pending.set(Number(/tier(\d)/.exec(url)[1]),resolve));
 const attach=scene.screenDisplay.attach.bind(scene.screenDisplay);scene.screenDisplay.attach=room=>{attached.push(room);return attach(room);};
 const old=scene.setTier(2),latest=scene.setTier(3),oldRoom=new T.Group(),newRoom=new T.Group();
 pending.get(3)({scene:newRoom});assert.equal(await latest,true);pending.get(2)({scene:oldRoom});assert.equal(await old,false);
 assert.deepEqual(attached,[newRoom]);assert.equal(scene.screenDisplay.room,newRoom);assert.equal(scene.screenDisplay.rooms.has(oldRoom),false);scene.dispose();
});

for(const mode of ['overview','wheels'])test(`interrupted ${mode} distance recovers finitely to the adaptive mode radius without an initial jump`,()=>{
 const {scene}=fixture(),shown=interrupt(scene,mode);assert.ok(scene.camera.position.distanceTo(shown)<1e-5);assert.equal(scene.cameraMotion.active,false);assert.equal(scene.animating,true);
 scene.orbit(8,0);draw(scene);const yaw=scene.yaw;
 for(let i=0;i<30;i++){scene.advance(1/60);draw(scene);}
 const expected=expectedPose(scene);assert.ok(scene.camera.position.distanceTo(expected.position)<1e-7);assert.ok(Math.abs(scene.camera.fov-expected.fov)<1e-7);assert.equal(scene.yaw,yaw);assert.equal(scene.animating,false);
 const final=scene.camera.position.clone();scene.advance(2);draw(scene);assert.ok(scene.camera.position.equals(final));scene.dispose();
});

test('vehicle replacement during orbit recovery recomputes its own length-based framing',()=>{
 const {scene}=fixture();interrupt(scene);scene.setVehicle('van');draw(scene);
 assert.ok(scene.camera.position.distanceTo(expectedPose(scene).position)<1e-7);assert.equal(scene.animating,false);scene.dispose();
});

test('interrupted orbit follows changed viewport and zoom rather than retaining the measured drag distance',()=>{
 const {scene}=fixture();interrupt(scene);scene.advance(.1);draw(scene,390,844);scene.zoom=.8;
 scene.advance(.4);draw(scene,390,844);assert.ok(scene.camera.position.distanceTo(expectedPose(scene,390,844).position)<1e-7);
 draw(scene,844,390);assert.ok(scene.camera.position.distanceTo(expectedPose(scene,844,390).position)<1e-7);scene.dispose();
});

for(const options of [{visible:false},{reducedMotion:true}])test(`orbit recovery settles immediately for ${JSON.stringify(options)}`,()=>{
 const {scene}=fixture();interrupt(scene);assert.equal(scene.advance(0,options),true);draw(scene);
 assert.equal(scene.animating,false);assert.ok(scene.camera.position.distanceTo(expectedPose(scene).position)<1e-7);scene.dispose();
});
