import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { integratePlayerArc, updatePlayerPath, updatePlayerDynamics, PLAYER_WHEELBASE as L, PLAYER_REAR_OFFSET as A, PLAYER_MAX_LATERAL_ACCELERATION } from '../src/player-motion.js';
import { updateChase } from '../src/motion.js';
/** Start a deterministic unobstructed run without spawning or unrelated events. */
function fixture(speed=25){const game=new Game();game.start();Object.assign(game.state,{speed,traffic:[],pickups:[],nextSpawn:Infinity,nextEvent:Infinity});return game;}
/** Advance a fixed requested interval using real game controls at a chosen rate. */
function run(game,seconds,controls,hz=120){for(let i=0;i<Math.round(seconds*hz);i++)game.update(1/hz,controls);return game.state;}

test('rear-axle arc has exact straight and circular endpoints in metres',()=>{
 const straight=integratePlayerArc(0,20,0,.1);assert.equal(straight.x,0);assert.equal(straight.forward,2);assert.equal(straight.rearDistance,2);
 const k=.06,dt=.2,speed=8,h=.13,a=integratePlayerArc(h,speed,k,dt),d=speed*dt/Math.hypot(1,A*k);
 assert.ok(Math.abs(a.heading-h-d*k)<1e-12);assert.ok(Math.abs(a.x-((Math.cos(h)-Math.cos(a.heading))/k+A*(Math.sin(a.heading)-Math.sin(h))))<1e-12);
 assert.ok(Math.abs(a.forward-((Math.sin(a.heading)-Math.sin(h))/k+A*(Math.cos(a.heading)-Math.cos(h))))<1e-12);
});
test('every wheel velocity is tangent to its own Ackermann direction in both turns',()=>{
 for(const speed of [4,18,52])for(const sign of [-1,1]){
  const k=sign*Math.min(.07,10/(speed*speed)),h=.17,dt=1e-7,arc=integratePlayerArc(h,speed,k,dt);
  for(const x of [-.89584,.89584])for(const z of [0,L]){
   const point=(heading,cx,cz)=>[cx+Math.cos(heading)*x+Math.sin(heading)*(z-A),cz-Math.sin(heading)*x+Math.cos(heading)*(z-A)];
   const before=point(h,0,0),after=point(arc.heading,arc.x,arc.forward),vx=(after[0]-before[0])/dt,vz=(after[1]-before[1])/dt;
   const wheel=h+(z?Math.atan(L*k/(1-x*k)):0),slip=vx*Math.cos(wheel)-vz*Math.sin(wheel);
   assert.ok(Math.abs(slip)<1e-5,`${speed}/${sign}/${x}/${z}: lateral slip ${slip}`);
  }
 }
});
test('constant-curvature arc composes independently of step partition',()=>{
 const all=integratePlayerArc(.2,30,.004,.8);let h=.2,x=0,z=0,d=0;
 for(let i=0;i<96;i++){const a=integratePlayerArc(h,30,.004,.8/96);h=a.heading;x+=a.x;z+=a.forward;d+=a.rearDistance;}
 for(const [a,b]of[[h,all.heading],[x,all.x],[z,all.forward],[d,all.rearDistance]])assert.ok(Math.abs(a-b)<1e-10);
});
test('standstill steering changes the wheels but cannot translate or yaw',()=>{
 const s={x:1,speed:0,heading:0,steerAngle:0};for(let i=0;i<120;i++)assert.equal(updatePlayerPath(s,1,1/120),0);
 assert.equal(s.x,1);assert.equal(s.heading,0);assert.ok(s.steerAngle>.29);assert.equal(s.rearDistance,0);
});
test('steering requests are rate-limited and high-speed lateral acceleration stays bounded',()=>{
 for(const speed of [4,18,52,70])for(const sign of [-1,1]){
  const s={x:1,speed,heading:0,steerAngle:0};let prior=0;
  for(let i=0;i<50;i++){updatePlayerPath(s,sign,1/120);assert.ok(Math.abs(s.steerAngle-prior)<=1.25/120+1e-12);assert.ok(Math.abs(s.lateralAcceleration)<=PLAYER_MAX_LATERAL_ACCELERATION+1e-8);prior=s.steerAngle;}
 }
});
test('heading recovery countersteers rather than sliding with straight wheels',()=>{
 const g=fixture(28);run(g,.4,{throttle:1,steer:1});assert.ok(g.state.heading>0);run(g,.16,{throttle:1});
 assert.ok(g.state.steerAngle<0,'front wheels steer back toward road direction');assert.ok(g.state.heading>0,'heading cannot snap upright');run(g,2,{throttle:1});assert.ok(Math.abs(g.state.heading)<.001);
});
test('traffic scroll uses the exact player centre displacement, including centre-offset rotation',()=>{
 const g=fixture(25);g.state.heading=.1;g.state.traffic=[{id:1,kind:'sedan',lane:0,z:100,speed:25,cruiseSpeed:25}];
 const z=g.state.traffic[0].z,d=g.state.distance;g.update(1/120,{throttle:.2,steer:.5});
 const car=g.state.traffic[0];assert.ok(Math.abs((car.z-z)+(g.state.distance-d)-car.speed/120)<1e-10);
});
test('simulation-owned body pose is quiet on a smooth straight road at constant speed',()=>{
 const s={acceleration:0,lateralAcceleration:0,altitude:0};for(let i=0;i<360;i++)updatePlayerDynamics(s,1/120);
 assert.equal(s.bodyPitch,0);assert.equal(s.bodyRoll,0);assert.equal(s.bodyHeave,0);
});
test('acceleration raises the nose, braking lowers it, and lateral transfer follows the turn',()=>{
 const s={acceleration:7,lateralAcceleration:5,altitude:0};for(let i=0;i<120;i++)updatePlayerDynamics(s,1/120);
 assert.ok(s.bodyPitch>0);assert.ok(s.bodyRoll>0);s.acceleration=-15;s.lateralAcceleration=-5;
 for(let i=0;i<120;i++)updatePlayerDynamics(s,1/120);assert.ok(s.bodyPitch<0);assert.ok(s.bodyRoll<0);
});
test('a touchdown pulse compresses then settles without a recurring bounce',()=>{
 const s={altitude:0,touchdownPulse:1};for(let i=0;i<12;i++)updatePlayerDynamics(s,1/120);assert.ok(s.bodyHeave<0);
 s.touchdownPulse=0;for(let i=0;i<360;i++)updatePlayerDynamics(s,1/120);assert.ok(Math.abs(s.bodyHeave)<1e-10);
});
test('body springs are frame-rate independent for constant acceleration targets',()=>{
 const a={altitude:0,acceleration:5,lateralAcceleration:-3},b={...a};for(let i=0;i<30;i++)updatePlayerDynamics(a,1/30);for(let i=0;i<120;i++)updatePlayerDynamics(b,1/120);
 for(const key of ['bodyPitch','bodyRoll','bodyHeave'])assert.ok(Math.abs(a[key]-b[key])<1e-12,key);
});
test('airborne body transfer relaxes while flight and barrel roll remain independent',()=>{
 const s={bodyPitch:.01,bodyRoll:.01,bodyHeave:-.01,altitude:3.3,rolling:true,rollAngle:Math.PI};for(let i=0;i<240;i++)updatePlayerDynamics(s,1/120);
 assert.ok(Math.abs(s.bodyPitch)<1e-9);assert.ok(Math.abs(s.bodyRoll)<1e-9);assert.equal(s.rollAngle,Math.PI);
});
test('pause cannot advance simulation suspension and reset clears every response clock',()=>{
 const g=fixture(20);run(g,.2,{throttle:1,steer:.5});const before=[g.state.bodyPitch,g.state.bodyRoll,g.state.distance];g.state.phase='paused';g.update(1,{brake:1});assert.deepEqual([g.state.bodyPitch,g.state.bodyRoll,g.state.distance],before);
 g.reset();for(const key of ['bodyPitch','bodyRoll','bodyHeave','yawRate','curvature','rearDistance','wheelDistance'])assert.equal(g.state[key],0,key);
});
test('chase inertia is bounded by measured accelerations, not steering or idle time',()=>{
 const view={};for(let i=0;i<600;i++)updateChase(view,{speed:40,acceleration:-50,lateralAcceleration:100},{dt:1/60});assert.ok(Math.abs(view.x)<=.09);assert.ok(Math.abs(view.z-9.2)<=.120000001);
 const plain={};updateChase(plain,{speed:40,acceleration:-50,lateralAcceleration:100},{reducedMotion:true});assert.equal(plain.x,0);assert.equal(plain.z,9.2);
});
test('actual game path and body state agree at 60 and120 Hz',()=>{
 const a=fixture(18),b=fixture(18);run(a,.5,{throttle:1,steer:.5},60);run(b,.5,{throttle:1,steer:.5},120);
 for(const key of ['x','distance','heading','bodyPitch','bodyRoll','rearDistance'])assert.ok(Math.abs(a.state[key]-b.state[key])<1e-9,key);
});
test('malformed arc values cannot create nonfinite travel',()=>{
 for(const args of [[NaN,Infinity,NaN,-1],[0,-2,0,0]])for(const value of Object.values(integratePlayerArc(...args)))assert.ok(Number.isFinite(value));
});
