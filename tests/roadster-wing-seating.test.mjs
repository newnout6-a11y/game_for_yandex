import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { createCar, setPlayerAeroPose } from '../src/car.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const { scene } = await loadRoadsterGeometry();
const car = createCar(scene);
setPlayerAeroPose(car, 0);
car.updateMatrixWorld(true);
const root = car.getObjectByName('Roadster');
const inverse = root.matrixWorld.clone().invert();

/** Intersect real indexed triangles with an authored longitudinal section. */
function section(mesh, z) {
  const g = mesh.geometry, matrix = inverse.clone().multiply(mesh.matrixWorld), points = [];
  for (let i = 0; i < g.index.count; i += 3) {
    const triangle = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(g.attributes.position, g.index.getX(i+k)).applyMatrix4(matrix));
    for (let k = 0; k < 3; k++) {
      const a = triangle[k], b = triangle[(k+1)%3];
      if (Math.min(a.z,b.z) > z || Math.max(a.z,b.z) < z || Math.abs(b.z-a.z) < 1e-12) continue;
      const p = a.clone().lerp(b, (z-a.z)/(b.z-a.z));
      if (p.y >= .70 && p.y <= .95) points.push(p);
    }
  }
  return points;
}

test('stowed blade, caps and folding hinges remain inside the actual tapered rear quarters', () => {
  const body = car.getObjectByName('body');
  const moving = ['wing_pivot_body','wing_pivot_dark_alloy','wing_tip_l_body','wing_tip_r_body','wing_tip_l_dark_alloy','wing_tip_r_dark_alloy'].map(name => car.getObjectByName(name));
  for (const z of [2.10, 2.20, 2.30, 2.32]) {
    const bodyPoints = section(body, z), wingPoints = moving.flatMap(mesh => section(mesh, z));
    assert.ok(bodyPoints.length > 10 && wingPoints.length > 10, `Actual upper quarter and aero triangles at z=${z}`);
    for (const sign of [-1, 1]) {
      const quarter = Math.max(...bodyPoints.map(p => sign*p.x));
      const wing = Math.max(...wingPoints.map(p => sign*p.x));
      assert.ok(wing <= quarter-.006, `Physical side seam at z=${z}, side=${sign}: wing ${wing}, quarter ${quarter}; former constant-width blade overhung by up to 49 mm`);
      assert.ok(quarter-wing < .03, 'Keep a narrow seated side seam rather than shrinking the entire wing arbitrarily');
    }
  }
});

test('each tapered fence folds around its real slanted hinge without runtime scale or visibility tricks', () => {
  for (const side of ['l','r']) {
    const part = car.userData.aero.find(part => part.node.name === `wing_tip_${side}`);
    assert.ok(part && Math.abs(part.axis.x) > .12 && Math.abs(part.axis.x) < .14);
    assert.ok(Math.abs(part.axis.y) < 1e-7 && part.axis.z > .99);
    assert.equal(Math.sign(part.axis.x), side === 'l' ? 1 : -1);
  }
  for (const amount of [0,.25,.5,.75,1]) {
    setPlayerAeroPose(car, amount);
    for (const part of car.userData.aero) {
      assert.equal(part.node.visible, true);
      assert.deepEqual(part.node.scale.toArray(), [1,1,1]);
    }
  }
});
