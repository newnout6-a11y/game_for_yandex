import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

const file = path => new URL(`../${path}`, import.meta.url);
const expectedMin = [-9.88, .02, -8.97], expectedMax = [9.88, 6.45, 7.57];
const assets = await Promise.all([1, 2, 3, 4].map(async tier => ({ tier,
  ...await loadRoadsterGeometry(file(`public/assets/garage/tier${tier}.glb`)),
  source: await readFile(file(`art/garage/tier${tier}.blend`)),
  report: JSON.parse(await readFile(file(`art/garage/tier${tier}-report.json`), 'utf8')),
})));

for (const { tier, scene, json, source, report } of assets) {
  test(`tier ${tier}: source preserves editable four-sided interior and rear artwork`, () => {
    const text = source.toString('latin1');
    for (const name of ['Interior front structural wall', 'Interior right front return',
      'Interior left front return', 'Interior insulated ceiling panel',
      'Interior entrance sectional leaf', 'Interior service door leaf',
      'Interior surface electrical conduit', 'Interior entrance luminaire casing',
      'Interior electrical cabinet', 'Original rose velocity wall paint']) {
      assert.ok(text.includes(`OB${name}\0`), `Authored, editable source contains ${name}`);
    }
    assert.equal(report.interior_completion_version, 1);
    assert.match(report.preserved_rear_geometry_sha256, /^[a-f0-9]{64}$/,
      'Upgrade audits exact original mesh positions, topology, transforms, UVs and material assignment');
    assert.equal(report.draw_batches, json.materials.length);
    assert.ok(report.bytes < 5_500_000, 'Complete functional interior stays within the audited 5.5 MB budget');
  });

  test(`tier ${tier}: exported camera contract describes real shell and overhead hazards`, () => {
    const contract = scene.userData.garageCamera;
    assert.equal(contract.version, 1);
    assert.deepEqual(contract.interiorMin, expectedMin);
    assert.deepEqual(contract.interiorMax, expectedMax);
    assert.equal(contract.clearance, .25);
    assert.equal(contract.orbitRadius, 6);
    assert.deepEqual(scene.getObjectByName(`GARAGE_TIER_0${tier}`).userData.garageCamera, contract);
    assert.equal(JSON.stringify(report.camera_interior), JSON.stringify(contract));
    assert.ok(contract.obstacles.length > 20 && contract.obstacles.length < 500);
    assert.ok(contract.obstacles.some(item => item.name.startsWith('Exposed roof beam')));
    assert.ok(contract.obstacles.some(item => /fixture casing|luminaire frame|perimeter light rail/.test(item.name)));
    for (const item of contract.obstacles) {
      assert.ok(item.name && item.min.length === 3 && item.max.length === 3);
      assert.ok([...item.min, ...item.max].every(Number.isFinite));
      assert.ok(item.min.every((value, axis) => value < item.max[axis]));
    }
  });

  test(`tier ${tier}: horizontal and upward rays never escape into a flat empty background`, () => {
    const ray = new T.Raycaster(), origin = new T.Vector3(), dir = new T.Vector3();
    // Authored front, returns and ceiling must work from the entire showroom,
    // not only from a single promotional camera. Painted decals are not a shell.
    const meshes = [];
    scene.traverse(node => { if (node.isMesh && node.userData.collision_role !== 'none') meshes.push(node); });
    for (const [x, y, z] of [[0, 1.5, 0], [-6.2, 1.5, -.8], [6.2, 1.5, -.8], [0, 3.6, -4.5]]) {
      origin.set(x, y, z);
      for (let degree = 0; degree < 360; degree += 5) {
        const angle = degree * Math.PI / 180;
        dir.set(Math.sin(angle), 0, Math.cos(angle)); ray.set(origin, dir);
        ray.near = 0; ray.far = 30;
        const hit = ray.intersectObjects(meshes, false)[0];
        assert.ok(hit, `No empty azimuth ${degree}° from (${x},${y},${z})`);
        assert.ok(hit.point.x >= -9.881 && hit.point.x <= 9.881);
        assert.ok(hit.point.z >= -8.971 && hit.point.z <= 7.571);
      }
      for (const dx of [-.5, 0, .5]) for (const dz of [-.5, 0, .5]) {
        dir.set(dx, 1, dz).normalize(); ray.set(origin, dir);
        const hit = ray.intersectObjects(meshes, false)[0];
        assert.ok(hit, `Real ceiling above (${x},${y},${z}), not empty world background`);
        assert.ok(hit.point.y <= 6.451);
      }
    }
  });
}
