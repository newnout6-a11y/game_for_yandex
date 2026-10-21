import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';
import { toyPhysicalParts } from './helpers/toy-components.mjs';

const candidate = process.env.TOY_ASSET_DIR;
const url = candidate ? pathToFileURL(resolve(candidate, 'toy-racecar.glb')) : new URL('../public/assets/garage/toy-racecar.glb', import.meta.url);
const { scene } = await loadRoadsterGeometry(url);
scene.updateMatrixWorld(true);
const byMaterial = name => {
  const meshes = [];
  scene.traverse(mesh => { if (mesh.isMesh && mesh.material.name === name) meshes.push(mesh); });
  return meshes;
};
const red = byMaterial('Toy racing red');
const { shell, tyres, red: redParts } = toyPhysicalParts(scene);
const length = new T.Box3().setFromObject(scene).getSize(new T.Vector3()).z;
const atlas = JSON.parse(await readFile(candidate ? pathToFileURL(resolve(candidate, 'mcqueen-decals.json')) : new URL('../art/garage/toy/mcqueen-decals.json', import.meta.url)));

/** Intersect the exported material batches, not generator dimensions or names. */
function cast(meshes, origin, direction) {
  return new T.Raycaster(new T.Vector3(...origin), new T.Vector3(...direction)).intersectObjects(meshes, false)[0]?.point;
}

test('toy front has raised fender crowns around a depressed hood, not a flat generic coupe nose', () => {
  for (const [z, minimumRise] of [[-.52, .015], [-.44, .025]]) {
    const center = cast(red, [0, 1, z], [0, -1, 0]);
    assert.ok(center);
    for (const side of [-1, 1]) {
      const shoulder = cast(red, [side * .24, 1, z], [0, -1, 0]);
      assert.ok(shoulder);
      assert.ok(shoulder.y - center.y >= minimumRise, `The ${side} fender crown must rise above the hood at z=${z}`);
    }
  }
});

test('all four toy wheels have tread width, a recessed red dish and a lip inside the rubber sidewall', () => {
  assert.equal(tyres.length, 4);
  for (const { box, center, size } of tyres) {
    const side = Math.sign(center.x);
    assert.ok(size.x >= .045 && size.x <= .08, 'Tyres are volumetric, not surface discs');
    assert.ok(size.y >= .22 && size.y <= .26);
    const sidewall = side > 0 ? box.max.x : -box.min.x;
    const sample = fraction => new T.Raycaster(
      new T.Vector3(side * (sidewall + .005), center.y + fraction * size.y / 2, center.z),
      new T.Vector3(-side, 0, 0), 0, size.x + .01
    ).intersectObjects(red, false)[0]?.point;
    const hub = sample(0);
    const lipPoints = Array.from({ length: 17 }, (_, i) => sample(.57 + i * .01)).filter(Boolean);
    const dishPoints = Array.from({ length: 16 }, (_, i) => sample(.18 + i * .01)).filter(Boolean);
    assert.ok(hub && lipPoints.length >= 8 && dishPoints.length >= 8);
    const lip = Math.max(...lipPoints.map(point => side * point.x));
    const bowl = Math.min(...dishPoints.map(point => side * point.x));
    assert.ok(sidewall - lip >= .001, 'Rim lip is seated inside the tyre sidewall');
    assert.ok(lip - side * hub.x >= size.x * .08, 'The hub must be visibly recessed behind the lip');
    assert.ok(lip - bowl >= size.x * .13, 'The radial dish has real depth, not a painted circle');
  }
});

test('red rim ventilation openings are actual through-holes rather than black marks on a solid disc', () => {
  for (const tyre of tyres) {
    const rim = redParts.find(part => Math.abs(part.center.y - tyre.center.y) < .01 && Math.abs(part.center.z - tyre.center.z) < .01 && Math.sign(part.center.x) === Math.sign(tyre.center.x) && part.size.y > tyre.size.y * .6 && part.size.y < tyre.size.y * .8);
    assert.ok(rim, 'Find the actual disconnected red rim bowl');
    const side = Math.sign(tyre.center.x);
    let open = 0;
    for (let index = 0; index < 10; index++) {
      const angle = (index + .5) * Math.PI * 2 / 10;
      const origin = new T.Vector3(side, tyre.center.y + Math.cos(angle) * tyre.size.y * .055 / .24, tyre.center.z + Math.sin(angle) * tyre.size.z * .055 / .24);
      if (!new T.Raycaster(origin, new T.Vector3(-side, 0, 0)).intersectObject(rim.mesh, false).length) open++;
    }
    assert.ok(open >= 8, `${open}/10 rim vents are genuinely open`);
  }
});

test('the complete tyre width is enclosed by the local fender, not just its centre ray or global body box', () => {
  assert.ok(shell); assert.equal(tyres.length, 4);
  for (const { mesh, box, size, center } of tyres) {
    let samples = 0, uncovered = 0, minimumGap = Infinity;
    for (let ix = 0; ix < 17; ix++) for (let iz = 0; iz < 25; iz++) {
      const x = box.min.x + (ix + .5) * size.x / 17;
      const z = box.min.z + (iz + .5) * size.z / 25;
      const top = cast([mesh], [x, 1, z], [0, -1, 0]);
      if (!top || top.y < center.y) continue;
      samples++;
      const roof = cast([shell.mesh], [x, top.y + 1e-5, z], [0, 1, 0]);
      if (!roof) uncovered++; else minimumGap = Math.min(minimumGap, roof.y - top.y);
    }
    assert.ok(samples > 300, 'Exercise the full tread and both rounded shoulders');
    assert.equal(uncovered, 0, `${uncovered}/${samples} tyre footprint samples protrude outside the local shell at ${center.toArray()}`);
    assert.ok(minimumGap > .001, 'The covering arch must not intersect the tyre');
  }
});

test('wheelbase and tyre proportions match the bounded diecast-reference construction, not the rejected wide track', () => {
  assert.equal(tyres.length, 4);
  const front = tyres.filter(part => part.center.z < 0), rear = tyres.filter(part => part.center.z > 0);
  assert.equal(front.length, 2); assert.equal(rear.length, 2);
  const spacing = rear[0].center.z - front[0].center.z;
  assert.ok(spacing / length >= .55 && spacing / length <= .62, 'Perspective references justify a range, not an invented exact factory ratio');
  for (const tyre of tyres) {
    assert.ok(tyre.size.y / length >= .17 && tyre.size.y / length <= .205);
    assert.ok(tyre.size.x / tyre.size.y >= .21 && tyre.size.x / tyre.size.y <= .30, 'Compact but genuinely volumetric tyres');
  }
});

test('the painted rocker has a small diecast ground gap instead of a raised body on exposed wheels', () => {
  assert.ok(shell); assert.equal(tyres.length, 4);
  const middle = tyres.reduce((sum, tyre) => sum + tyre.center.z, 0) / tyres.length;
  const diameter = tyres.reduce((sum, tyre) => sum + tyre.size.y, 0) / tyres.length;
  const ground = Math.min(...tyres.map(tyre => tyre.box.min.y));
  const positions = shell.mesh.geometry.attributes.position;
  const used = new Set(shell.mesh.geometry.index.array);
  let lowest = Infinity, count = 0;
  for (const index of used) {
    const point = new T.Vector3().fromBufferAttribute(positions, index).applyMatrix4(shell.mesh.matrixWorld);
    if (Math.abs(point.z - middle) > length * .07) continue;
    count++; lowest = Math.min(lowest, point.y);
  }
  assert.ok(count > 20);
  const clearance = (lowest - ground) / diameter;
  assert.ok(clearance >= .04 && clearance <= .22, `Painted rocker clearance is ${clearance.toFixed(3)} tyre diameters`);
});

test('flush printed triangles retain receiver-facing winding and consistent shading normals', () => {
  let tested = 0, inverted = 0;
  for (const mesh of byMaterial('Toy McQueen printed decals')) {
    const { position, normal } = mesh.geometry.attributes, index = mesh.geometry.index;
    const normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const points = ids.map(id => new T.Vector3().fromBufferAttribute(position, id).applyMatrix4(mesh.matrixWorld));
      const face = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      const shading = ids.reduce((sum, id) => sum.add(new T.Vector3().fromBufferAttribute(normal, id)), new T.Vector3()).applyMatrix3(normalMatrix).normalize();
      tested++;
      if (face.dot(shading) < -1e-4) inverted++;
    }
  }
  assert.ok(tested > 100, 'Check the actual printed surface, not atlas metadata alone');
  assert.equal(inverted, 0, `${inverted}/${tested} print triangles have inverted smooth normals`);
});

test('each side print belongs to its intended physical half instead of copied hidden opposite faces', () => {
  const count = { side_left: 0, side_right: 0 };
  for (const mesh of byMaterial('Toy McQueen printed decals')) {
    const { position, uv } = mesh.geometry.attributes, index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const location = ids.reduce((sum, id) => sum.add(new T.Vector3().fromBufferAttribute(position, id)), new T.Vector3()).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      const texel = ids.reduce((sum, id) => sum.add(new T.Vector2().fromBufferAttribute(uv, id)), new T.Vector2()).multiplyScalar(1 / 3);
      for (const [name, side] of [['side_left', -1], ['side_right', 1]]) {
        const [x, y, width, height] = atlas.regions[name].uv_rect_top_left;
        if (texel.x < x || texel.x > x + width || texel.y < y || texel.y > y + height) continue;
        count[name]++;
        assert.ok(location.x * side > 0, `${name} copied onto the opposite side at ${location.toArray()}`);
      }
    }
  }
  assert.ok(count.side_left > 100 && count.side_right > 100, 'Exercise both real atlas regions');
});
