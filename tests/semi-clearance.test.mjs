import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import*as T from '../public/vendor/three.js';
import{TRAFFIC_KINDS,installTrafficTemplates,createTrafficCar}from'../src/traffic.js';import{trafficDefinition}from'../src/traffic-catalog.js';
const models={};for(const k of TRAFFIC_KINDS){const file=k==='semi'&&process.env.SEMI_CLEARANCE_ASSET?process.env.SEMI_CLEARANCE_ASSET:`public/assets/traffic/${k}.glb`;const b=await readFile(file);models[k]=(await new T.GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}installTrafficTemplates(models);
/**
 * Check whether a scene node is the given ancestor or one of its descendants.
 * @param {T.Object3D|null} n - Node to walk upward without mutation.
 * @param {T.Object3D} p - Candidate ancestor.
 * @returns {boolean} Whether the parent chain reaches p.
 */
function within(n,p){for(;n;n=n.parent)if(n===p)return true;return false;}
/**
 * Collect unique cab and trailer vertices in their moving rig coordinates.
 * Updates world matrices, excludes low coupled tractor structure from the cab,
 * and keeps the high cab/sleeper/air-line triangles used by the clearance proof.
 * Vertices are deduplicated at six decimal places while retaining their rig.
 * @param {T.Object3D} car - Instantiated semi with runtime rig metadata.
 * @returns {object} Cab and trailer point arrays in metres, each with its group.
 */
function collect(car){const d=car.userData,cab=new Map(),trailer=new Map();car.updateMatrixWorld(true);
 car.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position,idx=n.geometry.index,out=within(n,d.trailer)?trailer:cab,group=within(n,d.trailerRig)?d.trailerRig:within(n,d.trailer)?d.trailer:d.bodyRig;
  if(out===cab&&!within(n,d.bodyRig))return;const inverse=group.matrixWorld.clone().invert().multiply(n.matrixWorld);
  for(let i=0;i<(idx?.count||a.count);i+=3){const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(a,idx?idx.getX(i+j):i+j));const world=vertices.map(v=>v.clone().applyMatrix4(n.matrixWorld));
   // Actual cab/sleeper and rear air lines above the chassis. The fifth wheel
   // and low tractor frame intentionally occupy the coupled trailer footprint.
   if(out===cab&&!(Math.max(...world.map(v=>v.y))>1.25&&Math.min(...world.map(v=>v.z))< -4.8))continue;
   for(const v of vertices){v.applyMatrix4(inverse);out.set(v.toArray().map(x=>x.toFixed(6)).join(',')+group.name,{x:v.x,y:v.y,z:v.z,group});}
  }
 });return{cab:[...cab.values()],trailer:[...trailer.values()]};
}
/**
 * Find the minimum z of a point over a symmetric articulation-angle interval.
 * Checks arc endpoints and the interior extremum analytically, not by sampling.
 * @param {number} x - Point lateral offset from the kingpin, in metres.
 * @param {number} z - Point longitudinal offset from the kingpin, in metres.
 * @param {number} limit - Maximum absolute rotation in radians.
 * @returns {number} Minimum rotated longitudinal offset in metres.
 */
function minArc(x,z,limit){let result=z*Math.cos(limit)-Math.abs(x)*Math.sin(limit);let a=Math.atan2(-x,z)+Math.PI;if(a>Math.PI)a-=2*Math.PI;if(Math.abs(a)<=limit)result=Math.min(result,-Math.hypot(x,z));return result;}
test('actual semi geometry clears the cab and air lines through the entire articulation and suspension envelope',()=>{
 const car=createTrafficCar('semi'),d=car.userData,spec=trafficDefinition('semi'),points=collect(car);assert.ok(points.cab.length>5000&&points.trailer.length>5000);
 let minimum=Infinity,worst;const step=.005;
 for(let pi=-10;pi<=10;pi++)for(let ri=-12;ri<=12;ri++){
  const pitch=pi*step,roll=ri*step;d.bodyRig.rotation.set(pitch,0,roll);d.trailerRig.rotation.set(pitch*.3,0,roll*.65);d.trailer.rotation.y=0;car.updateMatrixWorld(true);
  let cabZ=-Infinity,trailerZ=Infinity;
  for(const p of points.cab){const e=p.group.matrixWorld.elements;cabZ=Math.max(cabZ,e[2]*p.x+e[6]*p.y+e[10]*p.z+e[14]);}
  for(const p of points.trailer){const e=p.group.matrixWorld.elements,x=e[0]*p.x+e[4]*p.y+e[8]*p.z+e[12],z=e[2]*p.x+e[6]*p.y+e[10]*p.z+e[14]-spec.hitchZ;trailerZ=Math.min(trailerZ,spec.hitchZ+minArc(x,z,spec.maxArticulation));}
  if(trailerZ-cabZ<minimum){minimum=trailerZ-cabZ;worst={pitch,roll,cabZ,trailerZ};}
 }
 // Arc extrema above are analytic, not angle snapshots. A rotation-distance
 // Lipschitz bound covers every pitch/roll value between the 0.005 rad samples.
 const cabRadius=Math.max(...points.cab.map(p=>Math.hypot(p.x,p.y,p.z))),trailerRadius=Math.max(...points.trailer.filter(p=>p.group===d.trailerRig).map(p=>Math.hypot(p.x,p.y,p.z)));
 const betweenSamples=step*.5*(2*cabRadius+.95*trailerRadius)+.0001;
 const certified=minimum-betweenSamples;
 assert.ok(certified>.04,JSON.stringify({minimum,betweenSamples,certified,worst}));
 console.log('Semi swept clearance metres:',JSON.stringify({minimum,betweenSamples,certified,worst}));
});
test('exported trailer nose and rear agree with explicit collider metadata',()=>{
 const car=createTrafficCar('semi'),d=car.userData,s=trafficDefinition('semi'),b=new T.Box3().setFromObject(d.trailer);
 assert.ok(Math.abs(b.min.z-s.trailerFrontZ)<.025);assert.ok(Math.abs(b.max.z-s.trailerRearZ)<.025);assert.ok(s.trailerFrontZ<s.hitchZ,'real front overhang is retained');
});
