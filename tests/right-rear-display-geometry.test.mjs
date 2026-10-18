import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const loaded = loadRoadsterGeometry();

/** The separate display is authored in Blender, never constructed by runtime. */
test('right rear display is a separate front-facing flat 2:1 authored surface', async () => {
  const { scene } = await loaded;
  const display = scene.getObjectByName('detail_right_rear_display');
  assert.ok(display?.isMesh);
  assert.equal(display.material.name, 'RC_Right_Rear_Camera');
  assert.equal(display.material.side, T.FrontSide);
  assert.equal(display.userData.display_role, 'separate_right_rear_camera');
  const meta = display.userData.rightRearDisplay;
  assert.deepEqual(meta.active_dimensions_m, [.18, .09]);
  const center = new T.Vector3(...meta.point), normal = new T.Vector3(...meta.normal).normalize();
  const right = new T.Vector3(...meta.right), up = new T.Vector3(...meta.up);
  const position = display.geometry.attributes.position, index = display.geometry.index;
  assert.equal(index.count, 6);
  for (let i = 0; i < position.count; i++) {
    const delta = new T.Vector3().fromBufferAttribute(position, i).sub(center);
    assert.ok(Math.abs(delta.dot(normal)) < 1e-7);
    assert.ok(Math.abs(Math.abs(delta.dot(right)) - .09) < 1e-7);
    assert.ok(Math.abs(Math.abs(delta.dot(up)) - .045) < 1e-7);
  }
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(position, index.getX(i + k)));
    assert.ok(b.sub(a).cross(c.sub(a)).normalize().dot(normal) > .99999);
  }
  assert.ok(new T.Vector3(-.43, 1.04, .33).sub(center).normalize().dot(normal) > .99999);
  assert.notEqual(display.geometry, scene.getObjectByName('detail_rc_ui').geometry);
});

test('right display UV maps its whole active area top-left to bottom-right exactly once', async () => {
  const { scene } = await loaded, display = scene.getObjectByName('detail_right_rear_display');
  const meta = display.userData.rightRearDisplay, center = new T.Vector3(...meta.point);
  const right = new T.Vector3(...meta.right), up = new T.Vector3(...meta.up);
  const position = display.geometry.attributes.position, uv = display.geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const delta = new T.Vector3().fromBufferAttribute(position, i).sub(center);
    assert.ok(Math.abs(uv.getX(i) - (delta.dot(right) / .18 + .5)) < 1e-6);
    assert.ok(Math.abs(uv.getY(i) - (.5 - delta.dot(up) / .09)) < 1e-6);
  }
});

test('actual authored eye sees all 100 right display samples with real opaque backing', async () => {
  const { scene } = await loaded, root = scene.getObjectByName('Roadster');
  scene.updateMatrixWorld(true);
  const display = scene.getObjectByName('detail_right_rear_display'), meta = display.userData.rightRearDisplay;
  const center = new T.Vector3(...meta.point), right = new T.Vector3(...meta.right), up = new T.Vector3(...meta.up);
  const normal = new T.Vector3(...meta.normal).transformDirection(display.matrixWorld);
  const eye = new T.Vector3(-.43, 1.04, .33).applyMatrix4(root.matrixWorld), opaque = [];
  scene.traverse(mesh => { if (mesh.isMesh && !mesh.material.transparent) opaque.push(mesh); });
  const closedBackGap = .0078 * new T.Vector3().setFromMatrixScale(display.matrixWorld).x;
  let closedBackSamples = 0;
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    const point = center.clone().addScaledVector(right, ((x + .5) / 10 - .5) * .18)
      .addScaledVector(up, ((y + .5) / 10 - .5) * .09).applyMatrix4(display.matrixWorld);
    const direction = point.clone().sub(eye), distance = direction.length();
    const hit = new T.Raycaster(eye, direction.normalize(), .00001, distance + .0001).intersectObjects(opaque, false)[0];
    assert.equal(hit?.object, display, `display sample ${x},${y} hidden by ${hit?.object.name}`);
    const backing = new T.Raycaster(point.clone().addScaledVector(normal, -.0001), normal.clone().negate(), .00001, .012)
      .intersectObjects(opaque.filter(mesh => mesh !== display), false)[0];
    assert.equal(backing?.object.name, 'detail_rc_black');
    const gap = backing.distance + .0001;
    if (Math.abs(gap - closedBackGap) < 1e-6) closedBackSamples++;
    else {
      // The real upper-right bracket supports one grid point 5.780 mm behind
      // the face; all other points hit the closed back 7.696 mm behind it.
      assert.ok(x >= 7 && y >= 7, 'only the upper-right mount can precede the back');
      assert.ok(gap > .0057 && gap < closedBackGap, `unexpected bracket gap ${gap}`);
    }
  }
  assert.ok(closedBackSamples >= 99, 'the complete closed backing must remain behind the display');
});
