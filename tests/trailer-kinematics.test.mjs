import test from 'node:test';import assert from 'node:assert/strict';
import {integrateTrailerYaw,updateTrailerKinematics,trafficHitch,trafficYaw,trailerYaw,trafficCollisionParts} from '../src/traffic-physics.js';
import {trafficDefinition}from'../src/traffic-catalog.js';
const L=trafficDefinition('semi').trailerAxleDistance;
test('a trailer axle follows a circular hitch path with geometric offtracking, not matching tractor heading',()=>{
 const R=25,step=1/240,omega=.32;let angle=0,yaw=Math.PI,hx=R,hz=0,ax=hx+L*Math.sin(yaw),az=hz+L*Math.cos(yaw),maxSlip=0;
 for(let i=0;i<240*45;i++){
  angle+=omega*step;const nx=R*Math.cos(angle),nz=R*Math.sin(angle),oldYaw=yaw;
  yaw=integrateTrailerYaw(yaw,nx-hx,nz-hz,L);const bx=nx+L*Math.sin(yaw),bz=nz+L*Math.cos(yaw),mid=(yaw+oldYaw)/2;
  maxSlip=Math.max(maxSlip,Math.abs((bx-ax)*Math.cos(mid)-(bz-az)*Math.sin(mid)));
  assert.ok(Math.abs(Math.hypot(bx-nx,bz-nz)-L)<1e-12);hx=nx;hz=nz;ax=bx;az=bz;
 }
 assert.ok(Math.abs(Math.hypot(ax,az)-Math.sqrt(R*R-L*L))<.003);
 assert.ok(R-Math.hypot(ax,az)>1.6,'rear bogie cuts inside the hitch path');
 assert.ok(maxSlip<1e-7,'axle has negligible lateral sliding');
});
test('changing tractor heading around a fixed kingpin does not drag trailer heading with it',()=>{
 const distance=-385,car={kind:'semi',lane:1,x:1,z:50,speed:1,heading:0};
 updateTrailerKinematics(car,distance,1/120);const old={...car.trailerState},yaw=.2,hitchZ=trafficDefinition('semi').hitchZ;
 car.heading=-yaw;car.z=-(old.hitchZ-Math.cos(yaw)*hitchZ);car.x=1+(old.hitchX-Math.sin(yaw)*hitchZ)/3.5;
 updateTrailerKinematics(car,distance,1/120);
 assert.ok(Math.abs(car.trailerState.yaw-old.yaw)<1e-10);
 assert.ok(Math.abs(trailerYaw(car,distance)+yaw)<1e-10);
 assert.ok(Math.abs(car.trailerState.axleX-old.axleX)<1e-10);
});
test('straight travel keeps correct axle distance and independent wheel odometry; a stopped trailer does not straighten',()=>{
 const car={kind:'semi',lane:1,z:20,speed:10,heading:0},d=-385;updateTrailerKinematics(car,d,1/120);
 for(let i=0;i<1200;i++){car.z+=10/120;updateTrailerKinematics(car,d,1/120);}
 assert.ok(Math.abs(car.trailerTravelDistance-100)<1e-8);assert.ok(Math.abs(car.trailerAngle)<1e-8);
 car.trailerAngle=.15;car.speed=0;const travel=car.trailerTravelDistance;updateTrailerKinematics(car,d,1/120);assert.equal(car.trailerAngle,.15);assert.equal(car.trailerTravelDistance,travel);
});
test('articulated collision follows the same kingpin and trailer yaw as the axle solver',()=>{
 const car={kind:'semi',lane:1,x:.6,z:80,speed:15,heading:-.12},d=800;updateTrailerKinematics(car,d,1/120);
 for(let i=0;i<240;i++){car.z+=15/120;car.x-=.0004;updateTrailerKinematics(car,d,1/120);}
 const h=trafficHitch(car,d),yaw=trafficYaw(car,d)+trailerYaw(car,d),parts=trafficCollisionParts(car,d),p=parts[1];
 assert.ok(Math.abs(p.x-(h.x+Math.sin(yaw)*p.halfLength))<1e-10);
 assert.ok(Math.abs(p.z-(h.z+Math.cos(yaw)*p.halfLength))<1e-10);
 assert.ok(Math.abs(car.trailerState.axleX-(h.x+Math.sin(yaw)*L))<1e-10);
 assert.ok(Math.abs(car.trailerState.axleZ-(h.z+Math.cos(yaw)*L))<1e-10);
});
