import test from 'node:test';
import assert from 'node:assert/strict';
import { obbManifold, sweepOBB, resolveContactImpulse, rectangleInertia } from '../src/contact-physics.js';

const box = (x = 0, z = 0, yaw = 0, halfWidth = 1, halfLength = 2) =>
  ({ x, z, yaw, halfWidth, halfLength });
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
const lerpBox = (a, b, t) => ({ ...a, x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t, yaw: a.yaw + (b.yaw - a.yaw) * t,
  halfWidth:a.halfWidth + (b.halfWidth - a.halfWidth) * t,
  halfLength:a.halfLength + (b.halfLength - a.halfLength) * t });

// Independent narrow-phase oracle projects explicit vertices onto edge normals.
// It does not call the production SAT or use its support-radius formula.
function vertices(shape) {
  const c = Math.cos(shape.yaw), s = Math.sin(shape.yaw);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) =>
    [shape.x + x * shape.halfWidth * c + z * shape.halfLength * s,
      shape.z - x * shape.halfWidth * s + z * shape.halfLength * c]);
}
function oracleGap(a, b) {
  const av = vertices(a), bv = vertices(b);
  let gap = -Infinity;
  for (const polygon of [av, bv]) for (let edge = 0; edge < 2; edge++) {
    const p = polygon[edge], q = polygon[edge + 1];
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nx = -(q[1] - p[1]) / length, nz = (q[0] - p[0]) / length;
    const ap = av.map(v => v[0] * nx + v[1] * nz), bp = bv.map(v => v[0] * nx + v[1] * nz);
    gap = Math.max(gap, Math.min(...bp) - Math.max(...ap), Math.min(...ap) - Math.max(...bp));
  }
  return gap;
}
function denseFirst(a0, a1, b0, b1, steps = 10000) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (oracleGap(lerpBox(a0,a1,t), lerpBox(b0,b1,t)) <= 0) return t;
  }
  return null;
}
function body(x, z, vx, vz, mass = 1200) {
  return { x,z,vx,vz,yawRate:0,invMass:1/mass,invInertia:1/rectangleInertia(mass,2,4) };
}
const energy = b => (b.vx*b.vx + b.vz*b.vz)/(2*b.invMass) + b.yawRate*b.yawRate/(2*b.invInertia);

test('manifold uses actual orientation, positive gaps never contact, and outputs are reusable', () => {
  const a = box(), b = box(0, 3.8), out = {};
  assert.equal(obbManifold(a,b,out), out);
  near(out.normalX,0); near(out.normalZ,1); near(out.penetration,.2);
  near(out.pointX,0); near(out.pointZ,1.9);
  assert.equal(obbManifold(a,box(0,4 + 1e-9),out),null);
  assert.ok(obbManifold(a,box(0,4),out));
  near(out.penetration,0);
  // Long thin diagonal rectangles have overlapping AABBs but separate OBBs.
  assert.equal(obbManifold(box(0,0,.6,.2,3),box(.7,-.5,.6,.2,3),out),null);
});

test('clipped bumper contact is centered in overlap, and normals reverse when shapes swap', () => {
  const a = box(), b = box(1.4,3.9);
  const ab = obbManifold(a,b), ba = obbManifold(b,a);
  near(ab.pointX,.7); near(ab.pointZ,1.95);
  near(ab.pointX,ba.pointX); near(ab.pointZ,ba.pointZ);
  near(ab.normalX,-ba.normalX); near(ab.normalZ,-ba.normalZ);
  near(Math.hypot(ab.normalX,ab.normalZ),1);
});

test('exact translation sweep catches between-step high-speed pass-through with earliest TOI', () => {
  const a0 = box(0,0), a1 = box(0,100), b = box(0,50), out = {};
  assert.equal(obbManifold(a0,b),null);
  assert.equal(obbManifold(a1,b),null);
  assert.equal(sweepOBB(a0,a1,b,b,out),out);
  near(out.time,.46); near(out.normalZ,1); near(out.pointX,0); near(out.pointZ,48);
  assert.equal(out.status,'hit'); assert.equal(out.initialOverlap,false);
  assert.equal(out.timeError,0);
  const reversed = sweepOBB(b,b,a0,a1);
  near(reversed.time,out.time); near(reversed.normalZ,-out.normalZ);
});

test('translation honors relative motion, separating velocity, edge grazing and positive clearance', () => {
  const a0 = box(), a1 = box(0,40), b0 = box(0,20), b1 = box(0,30);
  near(sweepOBB(a0,a1,b0,b1).time,16/30);
  const out = {};
  assert.equal(sweepOBB(a0,box(0,-40),b0,b1,out),null);
  assert.equal(out.status,'miss');
  assert.equal(sweepOBB(box(0,-10),box(0,10),box(2.01),box(2.01),out),null);
  assert.equal(out.status,'miss');
  assert.ok(sweepOBB(box(0,-10),box(0,10),box(2),box(2)));
  const initial = sweepOBB(a0,box(0,-100),box(0,3),box(0,3));
  assert.equal(initial.time,0); assert.equal(initial.initialOverlap,true);
});

test('translation sweep is independent of splitting into tiny simulation timesteps', () => {
  const a0 = box(-3,-20,.31), a1 = box(2,40,.31);
  const b0 = box(.4,1,-.19), b1 = box(.4,5,-.19);
  const whole = sweepOBB(a0,a1,b0,b1);
  assert.ok(whole);
  for (const steps of [2, 12, 120, 1000]) {
    let time;
    for (let i = 0; i < steps; i++) {
      const part = sweepOBB(lerpBox(a0,a1,i/steps),lerpBox(a0,a1,(i+1)/steps),
        lerpBox(b0,b1,i/steps),lerpBox(b0,b1,(i+1)/steps));
      if (part) { time = (i + part.time)/steps; break; }
    }
    near(time,whole.time,2e-12);
  }
});

test('rotating sweep finds intermediate contact even with clear endpoints, not an envelope hit', () => {
  const a0 = box(0,0,-Math.PI/2,.18,3), a1 = box(0,0,Math.PI/2,.18,3);
  const b = box(0,2.8,0,.2,.2), out = {};
  assert.equal(obbManifold(a0,b),null); assert.equal(obbManifold(a1,b),null);
  assert.ok(sweepOBB(a0,a1,b,b,out));
  assert.equal(out.status,'hit');
  assert.ok(out.time > 0 && out.time < .5);
  assert.ok(oracleGap(lerpBox(a0,a1,out.time),b) <= 1e-14);
  const dense = denseFirst(a0,a1,b,b);
  assert.ok(out.time <= dense + 1e-8 && out.time >= dense - 1/10000 - 1e-8);
  assert.ok(out.timeError < 2e-8);
  assert.ok(out.iterations < 2048);
});

test('rotational one-centimetre near-graze is proved clear and never inflated into impact', () => {
  const a0 = box(0,0,-.6,.8,2.4), a1 = box(0,0,.6,.8,2.4);
  // Entire rotating box fits inside this radius; B starts 1 cm outside it.
  const radius = Math.hypot(a0.halfWidth,a0.halfLength);
  const b = box(0,radius + .01 + .2,0,.3,.2), out = {};
  assert.equal(denseFirst(a0,a1,b,b,4000),null);
  assert.equal(sweepOBB(a0,a1,b,b,out),null);
  assert.equal(out.status,'miss');
  assert.ok(out.iterations < 2048);
});

test('small-angle high-speed corner crossing has an actual contact, while near lateral pass stays clear', () => {
  const a0 = box(0,-14,.12), a1 = box(.7,12,.137);
  const b0 = box(2.3,0,-.08), b1 = box(2.3,.1,-.077), out = {};
  const dense = denseFirst(a0,a1,b0,b1);
  assert.notEqual(dense,null);
  assert.ok(sweepOBB(a0,a1,b0,b1,out));
  assert.ok(oracleGap(lerpBox(a0,a1,out.time),lerpBox(b0,b1,out.time)) <= 1e-13);
  assert.ok(out.time >= dense - .0001001 && out.time <= dense + 1e-8);
  assert.ok(out.iterations < 2048);
  const far0 = {...b0,x:3.5}, far1 = {...b1,x:3.5};
  assert.equal(denseFirst(a0,a1,far0,far1,4000),null);
  assert.equal(sweepOBB(a0,a1,far0,far1,out),null);
  assert.equal(out.status,'miss');
});

test('65 m/s, 120 Hz diagonal near-pass regression is not a collision', () => {
  // Captured from the previous enlarged-midpoint implementation's false crash:
  // Rocket heading -asin(4.2/65), sedan 18 m/s at lane 1.5605714, z 5.135.
  // Both endpoints include the real curved-road model poses, not lane boxes.
  const a0 = box(0,0,.06466043243494653,1.18,2.35);
  const a1 = {...a0,x:-.03500000000000003};
  const b0 = box(1.9620066042866613,-5.134999999997152,-.000002024302425018796,.97,2.325);
  const b1 = box(1.9619999999999997,-4.74446528531668,-4.518838691965384e-19,.97,2.325);
  const out = {};
  assert.equal(denseFirst(a0,a1,b0,b1),null);
  assert.equal(sweepOBB(a0,a1,b0,b1,out),null);
  assert.equal(out.status,'miss');
  // A real bumper/corner collision nearby must not be lost with the old false hit.
  const close0 = {...b0,z:b0.z+.2}, close1 = {...b1,z:b1.z+.2};
  assert.notEqual(denseFirst(a0,a1,close0,close1),null);
  assert.ok(sweepOBB(a0,a1,close0,close1,out));
  assert.ok(oracleGap(lerpBox(a0,a1,out.time),lerpBox(close0,close1,out.time)) <= 1e-12);
});

test('rotational query has a strict bounded work budget and reports uncertainty, never a false impact', () => {
  const a0 = box(0,0,-1.2,.1,3), a1 = box(0,0,1.2,.1,3);
  const b = box(0,2.9,0,.1,.1), out = {};
  assert.equal(sweepOBB(a0,a1,b,b,out,{maxIterations:8}),null);
  assert.equal(out.status,'unresolved');
  assert.ok(out.iterations <= 8);
  assert.ok(out.earliestPossibleTime >= 0 && out.earliestPossibleTime < 1);
  assert.ok(out.uncertainStart <= out.uncertainEnd);
  assert.ok(out.uncertainEnd <= 1);
});

test('linearly expanding extents hit at actual first contact, not at an inflated starting box', () => {
  const a0 = box(0,0,0,1,1), a1 = {...a0,halfWidth:3}, b = box(3,0,0,1,1), out = {};
  assert.ok(sweepOBB(a0,a1,b,b,out));
  near(out.time,.5,1e-8);
  near(out.normalX,1); near(out.pointX,2); near(out.pointZ,0);
  assert.ok(oracleGap(lerpBox(a0,a1,out.time),b) <= 0);
  assert.equal(obbManifold(a0,b),null);
  const gap = box(4.01,0,0,1,1);
  assert.equal(sweepOBB(a0,a1,gap,gap,out),null);
  assert.equal(out.status,'miss');
  // Growth can belong to B's longitudinal extent as well as A's width.
  const long0 = box(0,5,0,1,1), long1 = {...long0,halfLength:4.5};
  assert.ok(sweepOBB(a0,a0,long0,long1,out));
  near(out.time,3/3.5,1e-8);
  assert.ok(oracleGap(a0,lerpBox(long0,long1,out.time)) <= 0);
});

test('shrinking extents preserve a real contact and prove a moving positive-gap control clear', () => {
  const a0 = box(0,0,0,2,1), a1 = {...a0,halfWidth:1};
  const b0 = box(5,0,0,1,1), b1 = {...b0,x:1.5}, out = {};
  assert.ok(sweepOBB(a0,a1,b0,b1,out));
  near(out.time,.8,1e-8);
  assert.ok(oracleGap(lerpBox(a0,a1,out.time),lerpBox(b0,b1,out.time)) <= 1e-14);
  const wider0 = {...a0,halfWidth:3}, safe1 = {...b0,x:3};
  // Both bodies close by exactly the shrinking extent, maintaining a 1 m gap.
  // Using the maximum width throughout would incorrectly report a collision.
  assert.equal(sweepOBB(wider0,a1,b0,safe1,out),null);
  assert.equal(out.status,'miss');
  near(oracleGap(wider0,b0),1); near(oracleGap(a1,safe1),1);
});

test('rotation plus changing extents agrees with actual interpolated vertex geometry', () => {
  const a0 = box(-.3,-7,-.2,.6,2), a1 = box(.4,6,.22,1.4,1.8);
  const b0 = box(2.1,0,.14,.9,2.1), b1 = box(2.1,.2,.1,.7,2.3), out = {};
  const dense = denseFirst(a0,a1,b0,b1);
  assert.notEqual(dense,null);
  assert.ok(sweepOBB(a0,a1,b0,b1,out));
  assert.ok(out.time >= dense-.0001001 && out.time <= dense+1e-8);
  assert.ok(oracleGap(lerpBox(a0,a1,out.time),lerpBox(b0,b1,out.time)) <= 1e-12);
  const safe0 = {...b0,x:4}, safe1 = {...b1,x:4};
  assert.equal(denseFirst(a0,a1,safe0,safe1,4000),null);
  assert.equal(sweepOBB(a0,a1,safe0,safe1,out),null);
  assert.equal(out.status,'miss');
  assert.ok(out.iterations <= 2048);
});

test('seeded rotating sweeps agree with independent vertex SAT at and before every confirmed impact', () => {
  let seed = 51924;
  const random = () => { seed = (1664525*seed + 1013904223) >>> 0; return seed/2**32; };
  let hits = 0, misses = 0;
  for (let i = 0; i < 45; i++) {
    const a0 = box((random()-.5)*1.5,-8,(random()-.5)*.8,.8,2.2);
    const a1 = {...a0,x:a0.x+(random()-.5)*2,z:7,yaw:a0.yaw+(random()-.5)*.6};
    const b0 = box((random()-.5)*8,0,(random()-.5)*.7,.9,2);
    const b1 = {...b0,x:b0.x+(random()-.5),z:.3,yaw:b0.yaw+(random()-.5)*.2};
    const out = {}, result = sweepOBB(a0,a1,b0,b1,out);
    const dense = denseFirst(a0,a1,b0,b1,1500);
    assert.ok(out.iterations <= 2048);
    assert.notEqual(out.status,'unresolved',`unexpected unresolved case ${i}`);
    if (result) {
      hits++;
      assert.ok(oracleGap(lerpBox(a0,a1,out.time),lerpBox(b0,b1,out.time)) <= 1e-12);
      assert.ok(out.timeError <= 5e-8);
      if (dense !== null) assert.ok(out.time >= dense-1/1500-1e-8 && out.time <= dense+1e-8);
      if (out.time > 1e-6) assert.ok(oracleGap(lerpBox(a0,a1,out.time-1e-6),lerpBox(b0,b1,out.time-1e-6)) > 0);
    } else { misses++; assert.equal(dense,null); }
  }
  assert.ok(hits > 10 && misses > 5,`${hits} hits, ${misses} misses`);
});

test('centered bumper impulse conserves momentum and gives no fake lateral kick or yaw', () => {
  const a = body(0,0,0,30), b = body(0,4,0,10);
  const contact = obbManifold(box(),box(0,4));
  const before = (a.vz+b.vz)/a.invMass;
  const result = resolveContactImpulse(a,b,contact,{restitution:.2,friction:.5});
  near(result.closingSpeed,20); near(result.normalImpulse,14400);
  near(a.vz,18); near(b.vz,22);
  near(a.vx,0); near(b.vx,0); near(a.yawRate,0); near(b.yawRate,0);
  near((a.vz+b.vz)/a.invMass,before,1e-7);
});

test('millimetre near-plane bumper patch prevents tiny road-tangent differences from creating large yaw', () => {
  const a0 = box(0,0,0,1.18,2.35), a1 = {...a0,z:4};
  for (const yaw of [-.0006,.0006]) {
    const b = box(0,7,yaw,.97,2.325);
    const contact = sweepOBB(a0,a1,b,b);
    assert.ok(contact);
    // At exact TOI, strict vertex-only clipping picks ±0.97 m here. Both
    // bumper endpoints are within 3 mm, so use their actual near-plane span.
    assert.ok(Math.abs(contact.pointX) < .003, `near-flat patch x=${contact.pointX}`);
    const aBody = body(0,4*contact.time,0,40), bBody = body(0,7,0,15);
    resolveContactImpulse(aBody,bBody,contact,{restitution:.12,friction:.45});
    assert.ok(Math.abs(aBody.yawRate) < .03);
    assert.ok(Math.abs(bBody.yawRate) < .03);
    // The same local patch tolerance must not inflate the collision geometry.
    const separated = {...b,z:b.z + .001};
    const atContact = lerpBox(a0,a1,contact.time);
    assert.equal(obbManifold(atContact,separated),null);
  }
});

test('measured centered Game rear-end uses its complete 2.43 mm near-contact bumper span', () => {
  // Actual Game pose immediately before its first centered 40 -> 15 m/s hit:
  // throttle=1, dt=1/120, sedan lane=1,z=7 initially, road distance starts at 0.
  const a0 = box(0,0,0,1.18,2.35), a1 = {...a0,z:-.3377139438844958};
  const b0 = box(.003808352711026697,-4.684196851931791,-.0012539440169500793,.97,2.325);
  const b1 = box(.003440546054891415,-4.8091969869119975,-.001173950350555256,.97,2.325);
  const hit = sweepOBB(a0,a1,b0,b1);
  assert.ok(hit);
  near(2*b0.halfWidth*Math.abs(Math.sin(b0.yaw)),.002432650755376256,1e-12);
  assert.ok(Math.abs(hit.pointX) < .003, `measured bumper patch x=${hit.pointX}`);
  const aPose = lerpBox(a0,a1,hit.time), bPose = lerpBox(b0,b1,hit.time);
  const aBody = body(aPose.x,aPose.z,0,(a1.z-a0.z)*120);
  const bBody = body(bPose.x,bPose.z,(b1.x-b0.x)*120,(b1.z-b0.z)*120);
  bBody.yawRate = (b1.yaw-b0.yaw)*120;
  resolveContactImpulse(aBody,bBody,hit,{restitution:.12,friction:.22});
  assert.ok(Math.abs(aBody.yawRate) < .03, `measured player yawRate=${aBody.yawRate}`);
  assert.ok(Math.abs(bBody.yawRate) < .03, `measured sedan yawRate=${bBody.yawRate}`);
});

test('near-plane averaging preserves narrow corner features and truly offset bumper yaw', () => {
  const a0 = box(), a1 = {...a0,z:5};
  const angled = box(0,7,.05);
  const corner = sweepOBB(a0,a1,angled,angled);
  assert.ok(corner);
  // This bumper's opposite corner is centimetres, not millimetres, away.
  assert.ok(Math.abs(corner.pointX) > .8, `real corner x=${corner.pointX}`);
  const aBody = body(0,5*corner.time,0,40), bBody = body(0,7,0,15);
  resolveContactImpulse(aBody,bBody,corner,{friction:0});
  assert.ok(Math.abs(aBody.yawRate) > 1);
  // A near-parallel but laterally offset impact still has an offset patch,
  // because clipping to the reference face sides is never relaxed.
  const offset = box(1.4,7,.0006);
  const glancing = sweepOBB(a0,a1,offset,offset);
  assert.ok(glancing);
  assert.ok(glancing.pointX > .65 && glancing.pointX < .75);
  const offsetA = body(0,5*glancing.time,0,40), offsetB = body(1.4,7,0,15);
  resolveContactImpulse(offsetA,offsetB,glancing,{friction:0});
  assert.ok(Math.abs(offsetA.yawRate) > 1);
});

test('off-center impulse produces physical yaw with consistent energy and angular momentum', () => {
  const a = body(0,0,0,30), b = body(1.4,4,0,10);
  const contact = obbManifold(box(),box(1.4,4));
  const beforeEnergy = energy(a)+energy(b);
  const angularMomentum = shape => shape.yawRate/shape.invInertia
    + (shape.z*shape.vx-shape.x*shape.vz)/shape.invMass;
  const beforeAngular = angularMomentum(a)+angularMomentum(b);
  resolveContactImpulse(a,b,contact,{restitution:1,friction:0,bounceThreshold:0});
  assert.ok(a.yawRate > 0); assert.ok(b.yawRate > 0);
  // With offset centers and a common contact point, both spin in the same
  // direction. Total orbital + spin angular momentum still remains unchanged.
  near(angularMomentum(a)+angularMomentum(b),beforeAngular,1e-7);
  near(energy(a)+energy(b),beforeEnergy,1e-6);
});

test('Coulomb friction is clamped, dissipates energy, and leaves static bodies unchanged', () => {
  const a = body(0,0,12,25), b = body(0,4,0,0);
  const before = energy(a)+energy(b);
  const contact = obbManifold(box(),box(0,4));
  const out = resolveContactImpulse(a,b,contact,{restitution:0,friction:.2});
  assert.ok(Math.abs(out.tangentImpulse) <= .2*out.normalImpulse + 1e-8);
  assert.ok(energy(a)+energy(b) <= before);
  const moving = body(0,0,3,20), wall = {x:0,z:4,vx:0,vz:0,yawRate:0,invMass:0,invInertia:0};
  const snapshot = {...wall};
  resolveContactImpulse(moving,wall,contact,{restitution:0,friction:.5});
  assert.deepEqual(wall,snapshot);
  assert.ok(moving.vz < 20);
});

test('separating contacts add no impulse or energy, and zero mass does not divide by zero', () => {
  const a = body(0,0,0,-10), b = body(0,4,0,10);
  const snapshot = [{...a},{...b}], contact = obbManifold(box(),box(0,4));
  assert.equal(resolveContactImpulse(a,b,contact).normalImpulse,0);
  assert.deepEqual([a,b],snapshot);
  const fixedA = {...a,invMass:0,invInertia:0,vz:10};
  const fixedB = {...b,invMass:0,invInertia:0,vz:0};
  assert.equal(resolveContactImpulse(fixedA,fixedB,contact).normalImpulse,0);
  assert.ok(Number.isFinite(fixedA.vz));
});
