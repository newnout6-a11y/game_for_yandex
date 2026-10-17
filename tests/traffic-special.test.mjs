import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { trafficDefinition } from '../src/traffic-catalog.js';
import { buildSpecialVehicle } from '../src/traffic-special.js';

for (const [kind, axleCount] of [['towtruck', 2], ['firetruck', 3]]) {
  test(`${kind} has grounded catalog-sized geometry within the traffic render budget`, () => {
    const spec = trafficDefinition(kind), model = buildSpecialVehicle(kind, spec);
    const bounds = new T.Box3().setFromObject(model), size = bounds.getSize(new T.Vector3());
    assert.ok(size.x <= spec.width + .01, 'mirror, handle, and arch width');
    assert.ok(Math.abs(size.z - spec.length) < .015, 'bumper to bumper length');
    assert.ok(size.y > spec.height * .9 && bounds.max.y <= spec.height + .02, 'equipment roof height');
    assert.ok(bounds.min.y >= 0 && bounds.min.y < .025, 'tires touch the road');
    assert.ok(Math.abs(bounds.min.x + bounds.max.x) < .001, 'symmetric lateral envelope');
    assert.ok(Math.abs(bounds.min.z + bounds.max.z) < .001, 'centered longitudinal envelope');
    let meshes = 0, triangles = 0;
    model.traverse(node => {
      if (!node.isMesh) return;
      meshes++;
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
      for (const value of node.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      assert.ok(node.geometry.attributes.normal, 'all surfaces carry lighting normals');
    });
    assert.ok(meshes <= 28, `${meshes} draws`);
    assert.ok(triangles >= 8000 && triangles <= 18000, `${triangles} triangles`);
    assert.equal(model.userData.kind, kind);
    assert.equal(model.userData.category, 'special');
    assert.equal(model.userData.wheelRadius, spec.wheelRadius);
    assert.equal(model.children.filter(node => node.name.startsWith('wheel_')).length, axleCount * 2);
  });
  test(`${kind} keeps wheels independently animatable and brakes separate from fixed work lights`, () => {
    const model = buildSpecialVehicle(kind), left = model.getObjectByName('wheel_fl'), right = model.getObjectByName('wheel_fr');
    const position = left.position.clone();
    left.rotation.x = .72;
    assert.deepEqual(left.position.toArray(), position.toArray());
    assert.ok(Math.abs(right.rotation.x) < 1e-9);
    assert.equal(left.children[0].geometry, right.children[0].geometry, 'wheel geometry is reused');
    assert.ok(model.getObjectByName('lights_red'));
    assert.equal(left.userData.steering, true);
    assert.equal(model.getObjectByName('wheel_rl').userData.steering, false);
  });
}
test('recovery gear and fire equipment expose identity without introducing activities', () => {
  const tow = buildSpecialVehicle('towtruck'), fire = buildSpecialVehicle('firetruck');
  assert.deepEqual(tow.userData.equipment, ['winch', 'hydraulic-boom', 'wheel-lift']);
  assert.ok(tow.getObjectByName('body'), 'tow cab supports per-instance traffic paint');
  assert.deepEqual(fire.userData.equipment, ['crew-cab', 'equipment-lockers', 'hose-reel', 'roof-ladder']);
  assert.equal(fire.userData.fixedLivery, true);
  assert.ok(fire.getObjectByName('body_fixed'), 'fire service identity retains its original red paint');
  assert.equal(fire.getObjectByName('body'), undefined);
  assert.equal(fire.userData.activities, undefined);
  assert.throws(() => buildSpecialVehicle('sedan'), RangeError);
});

for (const kind of ['towtruck', 'firetruck']) {
  test(`${kind} Blender deliverable loads with exact wheel pivots, equipment anchors and a bounded draw count`, async () => {
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(new URL(`../public/assets/traffic/${kind}.glb`, import.meta.url));
    const gltf = await new T.GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const model = gltf.scene, spec = trafficDefinition(kind), wheelNames = [], equipment = [];
    const materials = new Set(); let draws = 0, triangles = 0;
    model.traverse(node => {
      if (node.name.startsWith('wheel_')) wheelNames.push(node.name);
      if (node.name.startsWith('equipment_')) equipment.push(node.name);
      if (node.isMesh) {
        draws++; materials.add(node.material.name);
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
      }
    });
    assert.deepEqual(wheelNames.sort(), (kind === 'towtruck'
      ? ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']
      : ['wheel_fl', 'wheel_fr', 'wheel_ml', 'wheel_mr', 'wheel_rl', 'wheel_rr']).sort());
    assert.equal(equipment.length, 3);
    assert.ok(materials.has('lights_red'));
    assert.ok(materials.has(kind === 'towtruck' ? 'body' : 'fixed_rescue_red'));
    assert.ok(draws <= 28); assert.ok(triangles <= 28000);
    const bounds = new T.Box3().setFromObject(model), size = bounds.getSize(new T.Vector3());
    assert.ok(size.x <= spec.width + .01 && Math.abs(size.z - spec.length) < .015);
    assert.ok(Math.abs(bounds.min.y - .004) < .0001, 'native Blender tires sit 4 mm above the road');
    for (const name of wheelNames) {
      const wheel = model.getObjectByName(name), wb = new T.Box3().setFromObject(wheel);
      assert.equal(wheel.children.filter(child => child.isMesh).length, 2, 'two material draws per commercial wheel');
      assert.ok(Math.abs(wheel.position.y - spec.wheelRadius - .004) < .0001);
      if (name.startsWith('wheel_f')) assert.ok(Math.max(Math.abs(wb.min.x), Math.abs(wb.max.x)) <= (kind === 'towtruck' ? 1.08 : 1.165), 'front tire fits its narrower cab fender');
      wheel.traverse(part => {
        if (!part.isMesh) return;
        const normal = part.geometry.attributes.normal, position = part.geometry.attributes.position;
        for (let i = 0; i < normal.count; i++) {
          const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
          assert.ok(Number.isFinite(length) && Math.abs(length - 1) < .001, 'finite unit wheel normals');
          const radial = Math.hypot(position.getY(i), position.getZ(i));
          if (part.material.name === 'tire_rubber' && radial > spec.wheelRadius * .95) {
            const facing = (position.getY(i) * normal.getY(i) + position.getZ(i) * normal.getZ(i)) / radial;
            assert.ok(facing > .70, 'tread normals face outward');
          }
        }
      });
    }
    assert.ok(materials.has('satin_wheel_steel'), 'recessed steel rim and lug finish');
    for (const name of ['special_cabin_finish', 'traffic_cab_glass', 'traffic_mirror_surface', 'indicator_left', 'indicator_right']) assert.ok(materials.has(name), name);
    let cabin, glazing, mirror;
    model.traverse(part => {
      if (!part.isMesh) return;
      if (part.material.name === 'special_cabin_finish') cabin = part;
      if (part.material.name === 'traffic_cab_glass') glazing = part;
      if (part.material.name === 'traffic_mirror_surface') mirror = part;
    });
    assert.ok(cabin.geometry.attributes.color && cabin.material.vertexColors, 'one vertex-colored cabin finish');
    assert.ok(glazing.material.transparent && glazing.material.opacity <= .25 && glazing.material.roughness < .1);
    assert.ok(!glazing.material.transmission, 'no per-car transmission/refraction');
    assert.ok(!mirror.material.transparent && mirror.material.metalness > .95 && mirror.material.roughness < .1, 'opaque environment-reflective mirror panes');
    model.updateMatrixWorld(true);
    for (const side of [-1, 1]) {
      const indicator = model.getObjectByName(side < 0 ? 'indicator_left' : 'indicator_right');
      const ib = new T.Box3().setFromObject(indicator);
      assert.ok(side < 0 ? ib.max.x < 0 : ib.min.x > 0, 'signal surfaces stay on their named side');
      assert.ok(ib.min.z < -spec.length * .4 && ib.max.z > spec.length * .4, 'each signal side has front and rear lenses');
      const normal = new T.Vector3(Math.sin(side * .22), 0, Math.cos(side * .22));
      const center = new T.Vector3(side * (kind === 'towtruck' ? 1.085 : 1.145), kind === 'towtruck' ? 1.65 : 1.86, kind === 'towtruck' ? -2.28 : -3.91).addScaledVector(normal, .052);
      const mirrorRay = new T.Raycaster(center.clone().addScaledVector(normal, .3), normal.clone().negate());
      assert.equal(mirrorRay.intersectObject(model, true)[0].object.material.name, 'traffic_mirror_surface', 'rearward/outward mirror pane is inset in front of its housing');
    }
    const ray = new T.Raycaster(new T.Vector3(0, kind === 'towtruck' ? 1.9 : 2.12, kind === 'towtruck' ? -4 : -5), new T.Vector3(0, 0, 1));
    const hits = ray.intersectObject(model, true);
    assert.equal(hits[0].object.material.name, 'traffic_cab_glass');
    const behindGlazing = hits.find(hit => hit.distance > hits[0].distance + .001);
    assert.equal(behindGlazing.object.material.name, 'special_cabin_finish', 'real open windshield, not glass over an opaque painted shell');
    const source = await readFile(new URL(`../art/traffic/${kind}.blend`, import.meta.url));
    assert.equal(source.subarray(0, 7).toString(), 'BLENDER');
    assert.ok(source.length > 100000, 'editable Blender project is included');
  });
}
