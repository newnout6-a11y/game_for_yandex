import test from 'node:test';
import assert from 'node:assert/strict';
import { createCar, setPlayerInteriorView, animatePlayerBody } from '../src/car.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
const { scene } = await loadRoadsterGeometry();

test('cockpit glazing is isolated, restrained and restores exact authored values', () => {
  const car = createCar(scene), other = createCar(scene), entries = car.userData.glazing;
  assert.ok(entries.length > 0);
  const source = [];
  scene.traverse(node => { if (node.isMesh) source.push([node, node.material, node.material.opacity, node.material.envMapIntensity]); });
  const objects = [];
  car.traverse(node => objects.push([node, node.visible, node.isMesh ? node.material : null]));
  setPlayerInteriorView(car, true);
  for (const entry of entries) {
    assert.equal(entry.material.opacity, Math.min(.10, entry.opacity));
    assert.equal(entry.material.envMapIntensity, Math.min(.15, entry.envMapIntensity));
    assert.equal(entry.material.depthWrite, false);
  }
  for (const entry of other.userData.glazing) assert.equal(entry.material.opacity, entry.opacity);
  for (const [node, material, opacity, intensity] of source) {
    assert.equal(node.material, material); assert.equal(material.opacity, opacity); assert.equal(material.envMapIntensity, intensity);
  }
  for (const [node, visible, material] of objects) { assert.equal(node.visible, visible); if (node.isMesh) assert.equal(node.material, material); }
  setPlayerInteriorView(car, false);
  for (const entry of entries) { assert.equal(entry.material.opacity, entry.opacity); assert.equal(entry.material.envMapIntensity, entry.envMapIntensity); }
});

test('repeated camera changes allocate no materials and do not alter world transforms', () => {
  const car = createCar(scene), before = new Map();
  car.traverse(node => before.set(node, [node.matrixWorld.elements.slice(), node.material]));
  for (let i = 0; i < 50; i++) setPlayerInteriorView(car, i % 2 === 0);
  car.traverse(node => { const [matrix, material] = before.get(node); assert.deepEqual(node.matrixWorld.elements, matrix); assert.equal(node.material, material); });
});

test('body travel bound also rejects nonfinite and excessively large poses safely', () => {
  const car = createCar(scene), d = car.userData;
  for (const value of [NaN, Infinity, -Infinity, 1e300, -1e300, Math.PI / 2]) {
    const pose = animatePlayerBody(car, {bodyPitch:value, bodyRoll:value, bodyHeave:value});
    const travel = Math.abs(pose.heave) + Math.abs(Math.sin(pose.pitch))*d.bodyEnvelopeHalfLength + Math.abs(Math.sin(pose.roll))*d.bodyEnvelopeHalfWidth + (1-Math.cos(pose.pitch)*Math.cos(pose.roll))*d.bodyEnvelopeHalfHeight;
    assert.ok(Number.isFinite(travel) && travel <= d.bodyTravelLimit + 1e-12);
  }
});
