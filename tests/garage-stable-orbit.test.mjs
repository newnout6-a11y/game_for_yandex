import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {GarageScene} from '../src/garage-scene.js';
import {createOwnedVehicle} from '../src/owned-vehicles.js';
import {installTrafficTemplates,TRAFFIC_KINDS} from '../src/traffic.js';
import {garageBoxCorners,garageCameraLimits,garageNearPlaneCorners,constrainGarageCamera} from '../src/garage-camera-motion.js';
import {garageOrbitBlockedInterval,garageOrbitDistance,GARAGE_ORBIT_DISTANCE_FACTOR} from '../src/garage-stable-orbit.js';
import {GARAGE_TOY_POSITION,GARAGE_TOY_YAW} from '../src/garage-toy-prop.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';

const assets={car:(await loadRoadsterGeometry()).scene,traffic:{}};
for(const id of TRAFFIC_KINDS)assets.traffic[id]=(await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`,import.meta.url))).scene;
installTrafficTemplates(assets.traffic);
const rooms=await Promise.all([1,2,3,4].map(async tier=>(await loadRoadsterGeometry(new URL(`../public/assets/garage/tier${tier}.glb`,import.meta.url))).scene));
const toyTemplate=(await loadRoadsterGeometry(new URL('../public/assets/garage/toy-racecar.glb',import.meta.url))).scene;
const ids=['rocket','hatch','sedan','suv','van'];
const views=[[551,360,{x:82.65,y:108,width:454.35,height:194}],[1440,900,{x:248,y:198,width:800,height:560}],[844,390,{x:173,y:129.3125,width:361,height:139.59375}]];
function fixture(id='rocket',tier=1){
  const scene=new GarageScene({renderer:{toneMappingExposure:1,render(){}},makeVehicle:(id,appearance)=>createOwnedVehicle(assets,id,appearance)});
  scene.room=rooms[tier-1];scene.ready=true;scene.tier=tier;scene.setVehicle(id);scene.setParking([{id:'van'},{id:'suv'}]);
  const toy=toyTemplate.clone(true);toy.position.set(...GARAGE_TOY_POSITION);toy.rotation.y=GARAGE_TOY_YAW;toy.updateMatrixWorld(true);scene.toyProp.root=toy;return scene;
}
function meshPoints(car){const values=[],point=new T.Vector3();car.updateWorldMatrix(true,true);car.traverseVisible(node=>{const position=node.isMesh&&node.geometry?.attributes.position;if(!position)return;for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(node.matrixWorld);values.push(point.x,point.y,point.z);}});return new Float64Array(values);}
function pixelBounds(points,camera,width,height){const m=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let i=0;i<points.length;i+=3){const x=points[i],y=points[i+1],z=points[i+2],w=m[3]*x+m[7]*y+m[11]*z+m[15],px=((m[0]*x+m[4]*y+m[8]*z+m[12])/w+1)*width/2,py=(1-(m[1]*x+m[5]*y+m[9]*z+m[13])/w)*height/2;left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}return {left,right,top,bottom};}

// Independent direct projection of every real visible mesh vertex, not the
// meridian helper's own support points or a mock body. All pitch extremes plus
// 24 yaw angles validate the analytic continuous envelope and frozen optics.
test('all five actual GLBs fit fixed mobile/desktop optics through full yaw and elevation without breathing',()=>{
  for(const id of ids){const scene=fixture(id),points=meshPoints(scene.vehicle);
    for(const [width,height,region] of views){scene.yaw=-.63;scene.pitch=.24;scene.render(width,height,region);const rig=scene.orbitRig,target=scene.target.clone(),projection=scene.camera.projectionMatrix.clone();
      for(const pitch of [.13,.24,.48])for(let step=0;step<24;step++){
        scene.yaw=step*Math.PI/12;scene.pitch=pitch;scene.render(width,height,region);const label=`${id}/${width}/${pitch}/${step}`;
        assert.equal(scene.orbitRig,rig,`${label}: no angular cache rebuild`);assert.ok(Math.abs(scene.camera.position.distanceTo(target)-rig.distance)<1e-9,`${label}: fixed true radius`);
        assert.deepEqual(scene.camera.projectionMatrix.elements,projection.elements,`${label}: lens, near and principal point are unchanged`);assert.ok(scene.camera.userData.garageLookTarget.equals(target),`${label}: fixed world pivot`);
        const b=pixelBounds(points,scene.camera,width,height);
        assert.ok(b.left>=region.x-.001&&b.right<=region.x+region.width+.001&&b.top>=region.y-.001&&b.bottom<=region.y+region.height+.001,`${label}: actual mesh cropped ${JSON.stringify(b)}`);
      }
    }
  }
});

test('all occupied room tiers provide a continuously clear accepted full spherical orbit for all models',()=>{
  for(let tier=1;tier<=4;tier++)for(const id of ids){const scene=fixture(id,tier);scene.render(...views[0]);const {limits,vehicleBounds}=scene.cameraContext,distance=scene.orbitRig.distance;
    assert.ok(Math.abs(distance-6*GARAGE_ORBIT_DISTANCE_FACTOR)<1e-9);
    for(const [index,box] of limits.obstacles.entries()){const interval=garageOrbitBlockedInterval(box,scene.target,.43);assert.ok(!interval||distance<interval[0]||distance>interval[1],`tier${tier}/${id}: continuous orbit intersects obstacle${index} interval${interval}`);}
    const body=garageOrbitBlockedInterval(vehicleBounds,scene.target,.30);assert.ok(!body||distance>body[1],`tier${tier}/${id}: selected body clearance`);
    for(const pitch of [.13,.48])for(let step=0;step<48;step++){scene.yaw=step*Math.PI/24;scene.pitch=pitch;scene.render(...views[2]);for(const point of [scene.camera.position,...garageNearPlaneCorners(scene.camera)]){assert.ok(limits.bounds.containsPoint(point));assert.ok(!vehicleBounds.containsPoint(point));for(const obstacle of limits.obstacles)assert.ok(!obstacle.containsPoint(point));}}
  }
});

test('an interior finite obstacle is not an infinite collision wall for a larger clear orbit',()=>{
  const pivot=new T.Vector3(0,1,0),box=new T.Box3(new T.Vector3(3,.1,-.2),new T.Vector3(3.3,2,.2)),interval=garageOrbitBlockedInterval(box,pivot,.43);
  assert.ok(interval[0]<4&&interval[1]<5);const limits={bounds:new T.Box3(new T.Vector3(-10,0,-10),new T.Vector3(10,8,10)),obstacles:[box]},body=new T.Box3(new T.Vector3(-1,.1,-2),new T.Vector3(1,1.5,2));
  assert.equal(garageOrbitDistance(6.167,limits,pivot,body),6.167);
});

test('explicit zoom chooses one safe whole-orbit distance and remains invariant throughout drag',()=>{
  const scene=fixture('van',2);scene.zoom=.8;scene.render(...views[0]);const radius=scene.orbitRig.distance,projection=scene.camera.projectionMatrix.clone();
  for(let step=0;step<48;step++){scene.yaw=step*Math.PI/24;scene.render(...views[0]);assert.ok(Math.abs(scene.camera.position.distanceTo(scene.target)-radius)<1e-9);assert.deepEqual(scene.camera.projectionMatrix.elements,projection.elements);}
});

test('non-orbitable Results explicitly retains the checkpoint current-pose projection',()=>{
  for(const id of ids){const scene=fixture(id),[width,height,region]=[551,360,{x:115,y:138,width:295,height:104}];scene.render(width,height,region,{stableOrbit:false});
    const camera=new T.PerspectiveCamera(38,width/height,.08,80),bounds=new T.Box3().setFromObject(scene.vehicle,true),radius=Math.min(scene.vehicleLength*1.75,scene.cameraContext.limits.orbitRadius);
    camera.position.copy(scene.target).add(new T.Vector3(Math.sin(scene.yaw)*radius,Math.sin(scene.pitch)*radius,-Math.cos(scene.yaw)*radius));
    constrainGarageCamera(camera,{limits:scene.cameraContext.limits,pivot:scene.target,target:scene.target,vehicleBounds:bounds,points:garageBoxCorners(bounds),width,height,region,minimumFov:38});
    assert.ok(scene.camera.position.distanceTo(camera.position)<1e-9);assert.deepEqual(scene.camera.projectionMatrix.elements,camera.projectionMatrix.elements);assert.equal(scene.camera.userData.garageStableOrbit,null);
  }
});

test('material-only appearance retains the hull, geometry cosmetics invalidate it',()=>{
  const scene=fixture();scene.render(...views[0]);const installed=scene.orbitEnvelope;scene.setVehicle('rocket',{'body.paint':'paint_red'});scene.render(...views[0]);assert.equal(scene.orbitEnvelope,installed,'the first paint-only edit reuses the installed geometry');const first=scene.orbitEnvelope;
  scene.setVehicle('rocket',{'body.paint':'paint_black'});scene.render(...views[0]);assert.equal(scene.orbitEnvelope,first);
  scene.setVehicle('rocket',{'body.paint':'paint_black','wheels.geometry':'wheel_turbine'});assert.equal(scene.orbitEnvelope,null);scene.render(...views[0]);assert.notEqual(scene.orbitEnvelope,first);
});
