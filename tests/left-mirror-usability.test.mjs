import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { createCar, setPlayerAeroPose } from '../src/car.js';
import { createCockpitView, updateCockpitCamera } from '../src/camera-view.js';

// This fixture tests exported Blender triangles and the seated eye, not a
// renderer success counter or objects inserted only into a reflection pass.
const fixturePromise = (async () => {
  const [{ scene: template }, { scene: sedan }] = await Promise.all([
    loadRoadsterGeometry(),
    loadRoadsterGeometry(new URL('../public/assets/traffic/sedan.glb', import.meta.url)),
  ]);
  const player = createCar(template), rig = createCockpitView(player), camera = new T.PerspectiveCamera();
  setPlayerAeroPose(player, 0);
  updateCockpitCamera(camera, rig, { phase: 'playing' }, { aspect: 16 / 9 });
  player.updateMatrixWorld(true);
  const pane = player.getObjectByName('detail_mirror_left');
  const center = new T.Vector3(...pane.userData.mirrorPlane.point);
  const normal = new T.Vector3(...pane.userData.mirrorPlane.normal).normalize();
  const tangent = new T.Vector3(normal.z, 0, -normal.x).normalize();
  const up = new T.Vector3().crossVectors(normal, tangent);
  const inverse = pane.matrixWorld.clone().invert();
  const eye = camera.position.clone().applyMatrix4(inverse);
  const normalMatrix = new T.Matrix3().getNormalMatrix(pane.matrixWorld);
  const points = [], min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  const positions = pane.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const point = new T.Vector3().fromBufferAttribute(positions, i), offset = point.clone().sub(center);
    [offset.dot(tangent), offset.dot(up)].forEach((value, axis) => {
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    });
    points.push(point);
  }
  const opaque = [];
  player.traverse(node => {
    if (node.isMesh && !node.material.transparent && !node.userData.mirrorRole) opaque.push(node);
  });
  return { player, rig, camera, pane, center, normal, tangent, up, inverse, eye, normalMatrix, points, min, max, opaque, sedan };
})();

/** Reflect the eye-to-surface unit ray around the authored outward normal. */
function outgoing(point, normal, eye) {
  return point.clone().sub(eye).normalize().reflect(normal);
}

/** Intersect the actual tessellated glass, interpolating its exported normals. */
function surfaceSample(f, x, y) {
  const point = f.center.clone().addScaledVector(f.tangent, x).addScaledVector(f.up, y).applyMatrix4(f.pane.matrixWorld);
  const normal = f.normal.clone().applyNormalMatrix(f.normalMatrix).normalize();
  const hit = new T.Raycaster(point.clone().addScaledVector(normal, .2), normal.clone().negate(), 0, .4)
    .intersectObject(f.pane, false)[0];
  assert.ok(hit, 'the requested point must lie on actual exported glass triangles');
  return { point: hit.point, normal: (hit.normal ?? hit.face.normal).clone().applyNormalMatrix(f.normalMatrix).normalize() };
}

/** Bound actual vertices in CSS pixels, retaining viewport and depth visibility. */
function projectedBounds(points, matrix, camera, width, height) {
  const screen = points.map(point => {
    const ndc = point.clone().applyMatrix4(matrix).project(camera);
    return [(ndc.x + 1) * width / 2, (1 - ndc.y) * height / 2, ndc.z];
  });
  const min = [0, 1].map(axis => Math.min(...screen.map(p => p[axis])));
  const max = [0, 1].map(axis => Math.max(...screen.map(p => p[axis])));
  const inDepth = screen.every(p => p[2] >= -1 && p[2] <= 1);
  return {
    size: [0, 1].map(axis => max[axis] - min[axis]),
    visibleSize: [width, height].map((edge, axis) => inDepth ? Math.max(0, Math.min(edge, max[axis]) - Math.max(0, min[axis])) : 0),
    fullyVisible: inDepth && min[0] >= 0 && min[1] >= 0 && max[0] <= width && max[1] <= height,
  };
}

/** Historical aperture controls at the same seated viewing pose. */
function oldPanePoints(f, width, height, radius = null) {
  return [-1, 0, 1].flatMap(x => [-1, 0, 1].map(y => {
    const u = x * width / 2, v = y * height / 2;
    return f.center.clone().addScaledVector(f.tangent, u).addScaledVector(f.up, v)
      .addScaledVector(f.normal, radius ? Math.sqrt(radius * radius - u * u - v * v) - radius : 0);
  }));
}

test('full-size exported glass fills a useful visible area, unlike both rejected tiny panes', async () => {
  const f = await fixturePromise;
  assert.equal(f.pane.userData.mirrorCurvature?.type, 'spherical-convex');
  const worldScale = new T.Matrix3().setFromMatrix4(f.pane.matrixWorld);
  const actualMetres = [f.tangent, f.up].map((axis, i) => (f.max[i] - f.min[i]) * axis.clone().applyMatrix3(worldScale).length());
  assert.ok(actualMetres[0] >= .175 && actualMetres[1] >= .090,
    `measure at least 175 x 90 mm of in-game glass, not metadata or the housing: ${actualMetres}`);
  for (const [width, height, yaw, minimumWidth, minimumHeight] of [
    [1920, 1080, 0, 150, 65], [390, 844, .75, 55, 32],
  ]) {
    updateCockpitCamera(f.camera, f.rig, { phase: 'playing' }, { aspect: width / height, lookYaw: yaw });
    const bounds = projectedBounds(f.points, f.pane.matrixWorld, f.camera, width, height);
    const readable = ([w,h]) => w >= minimumWidth && h >= minimumHeight;
    assert.ok(bounds.fullyVisible, 'no offscreen, near-clipped or behind-camera area may count as readable');
    assert.ok(readable(bounds.visibleSize), `${width}x${height} actual visible glass is ${bounds.visibleSize.join(' x ')} CSS pixels`);
    for (const [w, h, radius] of [[.053, .014, null], [.075, .028, .32]]) {
      const control = projectedBounds(oldPanePoints(f, w, h, radius), f.pane.matrixWorld, f.camera, width, height);
      assert.equal(readable(control.visibleSize), false, `the rejected ${w * 1000}x${h * 1000} mm pane must fail`);
    }
  }
  // The narrow portrait forward view intentionally needs a left glance. A
  // large projection beyond the viewport is not evidence of mobile visibility.
  updateCockpitCamera(f.camera, f.rig, { phase: 'playing' }, { aspect: 390 / 844 });
  const portraitForward = projectedBounds(f.points, f.pane.matrixWorld, f.camera, 390, 844);
  assert.equal(portraitForward.fullyVisible, false);
  assert.equal(portraitForward.visibleSize[0], 0, 'do not report the offscreen portrait-forward mirror as visible');
  updateCockpitCamera(f.camera, f.rig, { phase: 'playing' }, { aspect: 16 / 9 });
});

test('full-size glass has actual opaque rear backing and a rim on all four sides', async () => {
  const f = await fixturePromise;
  const normal = f.normal.clone().applyNormalMatrix(f.normalMatrix).normalize(), inward = normal.clone().negate();
  // Real exported body triangles must back the whole pane, including near the
  // corners. A floating enlarged glass quad outside the old pod cannot pass.
  for (const fx of [-.95, -.5, 0, .5, .95]) for (const fy of [-.95, -.5, 0, .5, .95]) {
    // Avoid exact triangle-edge/vertex ties without changing any visible size.
    const sample = surfaceSample(f, fx === 0 ? 1e-7 : f.max[0] * fx, fy === 0 ? 1e-7 : f.max[1] * fy);
    const hit = new T.Raycaster(sample.point.clone().addScaledVector(inward, .0001), inward, 0, .08)
      .intersectObjects(f.opaque, false)[0];
    assert.equal(hit?.object.material.name, 'body', `opaque housing must back glass sample ${fx},${fy}`);
    assert.ok(hit.distance > .001, 'housing must sit behind, not intersect the optical surface');
  }
  for (const [x, y] of [[f.min[0] - .005, 0], [f.max[0] + .005, 0], [0, f.min[1] - .005], [0, f.max[1] + .005]]) {
    const point = f.center.clone().addScaledVector(f.tangent, x).addScaledVector(f.up, y).applyMatrix4(f.pane.matrixWorld);
    const hit = new T.Raycaster(point.addScaledVector(normal, .1), inward, 0, .18).intersectObjects(f.opaque, false)[0];
    assert.equal(hit?.object.material.name, 'body', `a real housing rim must extend beyond glass edge ${x},${y}`);
  }
});

test('dense actual-glass eye and outgoing rays clear the pod without hiding the car', async () => {
  const f = await fixturePromise, eye = f.camera.position.clone();
  let directBlocked = 0, podBlocked = 0, realBodyReflections = 0;
  const blockers = {};
  // 32x32 catches edge strips missed by the previous 10x10 sampling.
  for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) {
    const x = T.MathUtils.lerp(f.min[0], f.max[0], (i + .5) / 32);
    const y = T.MathUtils.lerp(f.min[1], f.max[1], (j + .5) / 32);
    const sample = surfaceSample(f, x, y), incoming = sample.point.clone().sub(eye);
    const distance = incoming.length(); incoming.normalize();
    const direct = new T.Raycaster(eye, incoming, .0001, distance - .00005).intersectObjects(f.opaque, false)[0];
    if (direct) directBlocked++;
    const reflected = incoming.clone().reflect(sample.normal);
    const hit = new T.Raycaster(sample.point.clone().addScaledVector(reflected, .0002), reflected, 0, 100)
      .intersectObjects(f.opaque, false)[0];
    if (hit?.distance < .15) {
      podBlocked++; blockers[hit.object.name] = (blockers[hit.object.name] ?? 0) + 1;
    } else if (hit) realBodyReflections++;
  }
  assert.equal(directBlocked, 0, 'every sampled glass point must be visible to the real seated eye');
  assert.equal(podBlocked, 0, 'no shallow recess/casing strip may obstruct outgoing rays: ' + JSON.stringify(blockers));
  // The inward part of a wide physical mirror should retain the real vehicle,
  // rather than passing this test by hiding the whole player from reflections.
  assert.ok(realBodyReflections >= 30 && realBodyReflections < 256, `${realBodyReflections}/1024 genuine inward-edge body reflections`);
  assert.ok(f.opaque.every(node => node.visible), 'test must not hide any player mesh');
});

test('actual exported convex normals provide a useful field instead of magnifying a flat image', async () => {
  const f = await fixturePromise;
  const ray = (x, y) => {
    const s = surfaceSample(f, x, y);
    return outgoing(s.point, s.normal, f.camera.position);
  };
  // A tiny inset avoids relying on a ray/triangle implementation's edge ties.
  const horizontal = ray(f.min[0] + 1e-6, 0).angleTo(ray(f.max[0] - 1e-6, 0)) * 180 / Math.PI;
  const vertical = ray(0, f.min[1] + 1e-6).angleTo(ray(0, f.max[1] - 1e-6)) * 180 / Math.PI;
  const useful = (h, v) => h > 35 && v > 17;
  assert.ok(useful(horizontal, vertical), `actual curved ray span ${horizontal} x ${vertical} degrees`);
  const flat = (x, y) => outgoing(f.center.clone().addScaledVector(f.tangent, x).addScaledVector(f.up, y), f.normal, f.eye);
  const oldH = flat(-.0265, 0).angleTo(flat(.0265, 0)) * 180 / Math.PI;
  const oldV = flat(0, -.007).angleTo(flat(0, .007)) * 180 / Math.PI;
  assert.equal(useful(oldH, oldV), false, 'historical flat slit must fail useful physical FOV');
});

test('the raised full-size mirror is physically aimed at rear-left traffic, not the sky', async () => {
  // A 0.1 micrometre inset avoids the center vertex's ray/triangle tie.
  const f = await fixturePromise, sample = surfaceSample(f, 1e-7, 1e-7);
  const reflected = outgoing(sample.point, sample.normal, f.camera.position);
  assert.ok(reflected.z > .8, 'the actual center normal must reflect toward the rear');
  const point = new T.Ray(sample.point, reflected).intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -12), new T.Vector3());
  assert.ok(point && Math.abs(point.x + 3.5) < .15 && Math.abs(point.y - .8) < .15,
    `center reflection at rear z=12 m must reach vehicle height in the left lane, not sky: ${point?.toArray()}`);
});

/** Convex angular outline using real opaque sedan vertices, never a box marker. */
function sedanOutline(f, z) {
  const bounds = new T.Box3().setFromObject(f.sedan, true);
  f.sedan.position.set(-3.4, .01 - bounds.min.y + f.sedan.position.y, z);
  f.sedan.updateMatrixWorld(true);
  const points = [];
  f.sedan.traverse(node => {
    if (!node.isMesh || node.material.transparent) return;
    const positions = node.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) points.push(new T.Vector3().fromBufferAttribute(positions, i)
      .applyMatrix4(node.matrixWorld).applyMatrix4(f.inverse));
  });
  const forward = points.reduce((sum, point) => sum.add(point), new T.Vector3()).multiplyScalar(1 / points.length).sub(f.center).normalize();
  const right = new T.Vector3(0, 1, 0).cross(forward).normalize(), up = forward.clone().cross(right);
  const unique = new Map();
  for (const point of points) {
    const d = point.clone().sub(f.center), depth = d.dot(forward);
    const item = { point, x: d.dot(right) / depth, y: d.dot(up) / depth };
    unique.set(item.x.toFixed(10) + ',' + item.y.toFixed(10), item);
  }
  const sorted = [...unique.values()].sort((a,b) => a.x - b.x || a.y - b.y);
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
  const chain = sequence => {
    const result = [];
    for (const point of sequence) {
      while (result.length >= 2 && cross(result.at(-2), result.at(-1), point) <= 0) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...chain(sorted), ...chain([...sorted].reverse())].map(item => item.point);
}

/** Invert the physical spherical specular law, not the runtime probe camera. */
function sphericalGlassPoint(f, target) {
  const radius = f.pane.userData.mirrorCurvature.radius;
  const sample = (x, y) => {
    const z = Math.sqrt(radius * radius - x * x - y * y);
    assert.ok(Number.isFinite(z), 'inverse reflection must remain on the front spherical cap');
    const point = f.center.clone().addScaledVector(f.tangent, x).addScaledVector(f.up, y).addScaledVector(f.normal, z - radius);
    const normal = f.tangent.clone().multiplyScalar(x).addScaledVector(f.up, y).addScaledVector(f.normal, z).divideScalar(radius);
    const difference = outgoing(point, normal, f.eye).sub(target.clone().sub(point).normalize());
    return { point, difference, residual: [difference.dot(f.tangent), difference.dot(f.up)] };
  };
  let x = 0, y = 0;
  for (let iteration = 0; iteration < 15; iteration++) {
    const current = sample(x, y), [a,b] = current.residual;
    if (Math.hypot(a,b) < 1e-11) break;
    const step = 1e-6, dx = sample(x + step, y).residual, dy = sample(x, y + step).residual;
    const j00 = (dx[0]-a)/step, j10 = (dx[1]-b)/step, j01 = (dy[0]-a)/step, j11 = (dy[1]-b)/step;
    const det = j00*j11 - j01*j10;
    assert.ok(Math.abs(det) > 1e-8, 'inverse reflection Jacobian must not be degenerate');
    x -= (j11*a - j01*b) / det; y -= (-j10*a + j00*b) / det;
  }
  assert.ok(sample(x,y).difference.length() < 1e-7, 'actual three-dimensional outgoing ray must reach the sedan vertex');
  return [x,y];
}

test('actual rear-left sedan silhouettes fit at 9m and 14m with useful native screen sizes', async () => {
  const f = await fixturePromise;
  const fits = ([x,y]) => x >= f.min[0] && x <= f.max[0] && y >= f.min[1] && y <= f.max[1];
  for (const z of [9, 14]) {
    const outline = sedanOutline(f, z);
    assert.ok(outline.length >= 20, 'use the real detailed opaque-car outline, not four invented bounding-box points');
    const footprint = outline.map(target => sphericalGlassPoint(f, target));
    assert.ok(footprint.every(fits), `every actual sedan silhouette extremum at ${z}m must map inside the glass`);
    const reflectedPoints = footprint.map(([x, y], index) => {
      const sample = surfaceSample(f, x, y), target = outline[index].clone().applyMatrix4(f.pane.matrixWorld);
      const reflected = outgoing(sample.point, sample.normal, f.camera.position);
      const direction = target.sub(sample.point), distance = direction.length();
      // The finite triangular cap and exported custom normals approximate the
      // analytic sphere. Require agreement within 0.01 degree (~2.5 mm at 14 m).
      assert.ok(reflected.angleTo(direction.normalize()) < .01 * Math.PI / 180,
        'exported interpolated curved normals must agree with the inverse physical reflection');
      const blocked = new T.Raycaster(sample.point.clone().addScaledVector(reflected, .0002), reflected, 0, distance - .001)
        .intersectObjects(f.opaque, false)[0];
      assert.equal(blocked, undefined, `the real player must not hide the reflected sedan silhouette at ${z}m`);
      return sample.point.clone().applyMatrix4(f.inverse);
    });
    for (const [width, height, yaw, minWidth, minHeight] of [
      [1920, 1080, 0, z === 9 ? 55 : 35, z === 9 ? 30 : 20],
      [390, 844, .75, z === 9 ? 22 : 13, z === 9 ? 14 : 9],
    ]) {
      updateCockpitCamera(f.camera, f.rig, { phase: 'playing' }, { aspect: width / height, lookYaw: yaw });
      const bounds = projectedBounds(reflectedPoints, f.pane.matrixWorld, f.camera, width, height);
      assert.ok(bounds.fullyVisible, 'the whole reflected sedan must lie inside the real viewport');
      assert.ok(bounds.visibleSize[0] >= minWidth && bounds.visibleSize[1] >= minHeight,
        `actual ${z}m sedan at ${width}x${height} is ${bounds.visibleSize.join(' x ')} CSS pixels`);
    }
    const virtual = f.eye.clone().addScaledVector(f.normal, -2 * f.eye.clone().sub(f.center).dot(f.normal));
    const flatFits = outline.every(target => {
      const direction = target.clone().sub(virtual);
      const point = virtual.clone().addScaledVector(direction, f.center.clone().sub(virtual).dot(f.normal) / direction.dot(f.normal));
      const offset = point.sub(f.center);
      return Math.abs(offset.dot(f.tangent)) <= .0265 && Math.abs(offset.dot(f.up)) <= .007;
    });
    assert.equal(flatFits, false, 'old 53x14mm planar aperture cannot fit the real sedan envelope');
  }
  updateCockpitCamera(f.camera, f.rig, { phase: 'playing' }, { aspect: 16 / 9 });
});
