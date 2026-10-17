import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { createThrusterEffects } from '../src/thrusters.js';

/**
 * Build four named nozzle sockets and real vapor effects without WebGL.
 * Starts the player at cruise height and supplies mutable flight-state fields;
 * callers own disposal of the returned effect resources.
 * @param {boolean} [compact=false] - Select the reduced particle-capacity profile.
 * @returns {object} Scene, player, effects, state and a deterministic step helper.
 */
function fixture(compact = false) {
  const scene = new T.Scene(), player = new T.Group(); scene.add(player);
  player.position.set(0, 3.335, 0);
  for (const x of [-.67, .67]) for (const z of [-1.35, 1.35]) {
    const socket = new T.Object3D();
    socket.name = 'thruster_' + (z < 0 ? 'f' : 'r') + (x < 0 ? 'l' : 'r');
    socket.position.set(x, .16, z); player.add(socket);
  }
  const effects = createThrusterEffects(scene, player, { compact });
  const state = { phase: 'playing', altitude: 3.3, thrusterPower: .85, speed: 28, verticalSpeed: 0, distance: 0 };
  let time = 0;
  /**
   * Advance vapor, elapsed time and distance together for the requested frames.
   * A zero dt deliberately tests paused effects without changing travelled metres.
   * @param {number} frames - Number of update calls.
   * @param {number} [dt=1/60] - Simulated seconds per update.
   */
  const advance = (frames, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) {
      time += dt; state.distance += state.speed * dt;
      effects.update(state, dt, time);
    }
  };
  return { scene, player, effects, state, advance };
}

/**
 * Construct calibrated Blender-style aperture extras under a scaled model root.
 * Lift and boost sockets deliberately do not share an axis; socket articulation
 * and parent scaling remain observable without loading a GLB or creating WebGL.
 * @param {number} [scale=1] - Uniform model scale applied above every socket.
 * @returns {object} Mutable scene, car, model, sockets, effects and flight state.
 */
function authoredFixture(scale = 1) {
  const scene = new T.Scene(), player = new T.Group(), model = new T.Group();
  scene.add(player); player.add(model); player.position.y = 3.35; model.scale.setScalar(scale);
  const sockets = [];
  for (const role of ['lift', 'boost']) for (let i = 0; i < 4; i++) {
    const socket = new T.Object3D(); socket.name = `thruster_${role}_${i}`;
    socket.position.set((i - 1.5) * .32, role === 'lift' ? .16 : .54, role === 'lift' ? (i % 2 ? -1.1 : 1.1) : 2.36);
    socket.userData = { thrusterRole: role, thrusterDirection: role === 'lift' ? [0, -1, 0] : [0, 0, 1], apertureRadius: role === 'lift' ? .066 : .035 };
    model.add(socket); sockets.push(socket);
  }
  const effects = createThrusterEffects(scene, player);
  const state = { phase: 'playing', altitude: 3.3, thrusterPower: .85, speed: 0, distance: 0 };
  return { scene, player, model, sockets, effects, state };
}

test('cold-gas vapor uses one bounded instanced batch, one material and a safe loading fallback', async () => {
  for (const compact of [false, true]) {
    const f = fixture(compact), { effects } = f;
    f.advance(1200);
    assert.equal(effects.mesh.geometry.isInstancedBufferGeometry, true);
    assert.equal(f.scene.children.filter(n => n.isMesh).length, 1);
    assert.equal(Array.isArray(effects.mesh.material), false);
    assert.equal(effects.mesh.material.depthWrite, false);
    assert.equal(effects.mesh.material.depthTest, true);
    assert.equal(effects.mesh.material.blending, T.NormalBlending);
    assert.equal(effects.mesh.castShadow, false);
    assert.equal(effects.mesh.userData.capacity, compact ? 112 : 160);
    assert.ok(effects.mesh.geometry.instanceCount > 30);
    assert.ok(effects.mesh.geometry.instanceCount <= effects.mesh.userData.capacity);
    const coreFlags = effects.mesh.geometry.attributes.particleCore.array;
    assert.equal(Array.from(coreFlags.slice(0, effects.mesh.geometry.instanceCount)).filter(value => value === 1).length, 8, 'two continuous feathered core layers per nozzle share the same batch');
    assert.equal(effects.mesh.material.uniforms.vaporMap.value.image.width, 96, 'Node-only loading fallback, not the runtime atlas');
    effects.dispose();
  }
  const source = await readFile(new URL('../src/thrusters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new T\.(?:ConeGeometry|Sprite)\s*\(/);
});

test('vapor persists through controlled descent, deflects above asphalt and fades after contact', () => {
  const f = fixture(); f.advance(90);
  f.player.position.y = .35;
  Object.assign(f.state, { flying: false, altitude: .315, landing: true, verticalSpeed: -.5, thrusterPower: .97 });
  f.advance(120);
  const count = f.effects.mesh.geometry.instanceCount;
  assert.ok(count > 40, 'descent continues to emit although flying is false');
  const centers = f.effects.mesh.geometry.attributes.particleCenter;
  for (let i = 0; i < count; i++) assert.ok(centers.getY(i) >= .035, 'gas cannot pass through the road');
  Object.assign(f.state, { altitude: 0, thrusterPower: 0, landing: false });
  f.advance(5); assert.ok(f.effects.mesh.geometry.instanceCount > 0, 'remaining mist does not blink off at contact');
  f.advance(115); assert.equal(f.effects.mesh.geometry.instanceCount, 0); assert.equal(f.effects.mesh.visible, false);
  f.effects.dispose();
});

test('rotated sockets stay finite; inverted car emits sparse correction wisps, not four lift jets', () => {
  const f = fixture(); f.advance(180);
  const cruise = f.effects.mesh.geometry.instanceCount;
  f.effects.clear();
  f.player.position.set(2, 4.4, -.2); f.player.rotation.set(.035, -.2, Math.PI);
  Object.assign(f.state, { rolling: true, rollProgress: .5, rollAngularSpeed: 10 });
  f.advance(180);
  const count = f.effects.mesh.geometry.instanceCount;
  assert.ok(count > 0 && count < cruise / 2);
  for (const attribute of Object.values(f.effects.mesh.geometry.attributes)) {
    assert.ok(Array.from(attribute.array).every(Number.isFinite));
  }
  const centers = f.effects.mesh.geometry.attributes.particleCenter;
  assert.ok(centers.getX(0) > 0, 'emission follows the translated car, not cached world coordinates');
  assert.ok(centers.getY(0) > 3, 'rotated emitter starts above the car ground origin');
  f.effects.dispose();
});

test('pause freezes vapor, menu clears it, disposal is idempotent and scene reset has no old wake', () => {
  const f = fixture(); f.advance(120);
  const centers = f.effects.mesh.geometry.attributes.particleCenter;
  const snapshot = centers.array.slice(); f.advance(60, 0);
  assert.deepEqual(centers.array, snapshot);
  f.state.distance = -100; f.advance(1);
  assert.equal(f.effects.mesh.geometry.instanceCount, 0, 'distance reset removes stale particles');
  f.advance(120); assert.ok(f.effects.mesh.geometry.instanceCount > 0);
  f.state.phase = 'menu'; f.advance(1);
  assert.equal(f.effects.mesh.geometry.instanceCount, 0); assert.equal(f.effects.mesh.visible, false);
  f.effects.dispose(); f.effects.dispose(); assert.equal(f.scene.children.length, 1);
  assert.doesNotThrow(() => f.effects.update(f.state, 1 / 60, 1));
});

test('authored aperture transforms anchor each pressure root and scale its actual bore', () => {
  const f = authoredFixture(.5); f.effects.update(f.state, .1, .1);
  const a = f.effects.mesh.geometry.attributes, count = f.effects.mesh.geometry.instanceCount;
  const records = f.effects.mesh.userData.emitters;
  assert.equal(records.length, 8); assert.equal(f.effects.mesh.userData.pressureLayers, 8);
  for (let emitter = 0; emitter < 4; emitter++) {
    assert.ok(Math.abs(records[emitter].radius - .033) < 1e-9);
    const socketWorld = f.sockets[emitter].getWorldPosition(new T.Vector3());
    for (let layer = 0; layer < 2; layer++) {
      const index = count - 8 + emitter * 2 + layer;
      const center = new T.Vector3().fromBufferAttribute(a.particleCenter, index);
      const direction = new T.Vector3().fromBufferAttribute(a.particleDirection, index);
      const length = a.particleShape.getY(index), width = a.particleShape.getX(index);
      const root = center.addScaledVector(direction, -length * .5 - .008);
      assert.ok(root.distanceTo(socketWorld) < 1e-6, 'pressure root is exactly the authored aperture, not a guessed chassis point');
      assert.ok(Math.abs(width * a.particleProfile.getX(index) - .066) < 1e-6, 'ribbon root width equals the world bore diameter');
    }
  }
  // A socket moved/rotated by animated nozzle hardware is read again, not cached.
  f.sockets[0].position.x += .4; f.sockets[0].rotation.z = Math.PI / 4;
  f.effects.update(f.state, 0, .1);
  const expected = new T.Vector3(0, -1, 0).transformDirection(f.sockets[0].matrixWorld);
  assert.ok(new T.Vector3(...records[0].direction).distanceTo(expected) < 1e-9);
  assert.ok(new T.Vector3(...records[0].position).distanceTo(f.sockets[0].getWorldPosition(new T.Vector3())) < 1e-9);
  f.effects.dispose();
});

test('rear boost has its own authored axis and never inherits hover or landing output', () => {
  const f = authoredFixture();
  for (let i = 0; i < 40; i++) f.effects.update(f.state, 1 / 60, i / 60);
  const records = f.effects.mesh.userData.emitters;
  assert.ok(records.filter(r => r.role === 'lift').every(r => r.power > .8));
  assert.ok(records.filter(r => r.role === 'boost').every(r => r.power === 0));
  f.effects.clear(); f.player.position.y = .04;
  Object.assign(f.state, { thrusterPower: 0, altitude: 0, boosting: true });
  for (let i = 0; i < 90; i++) f.effects.update(f.state, 1 / 60, i / 60);
  assert.ok(records.filter(r => r.role === 'boost').every(r => r.power > .85 && r.direction[2] === 1));
  assert.ok(records.filter(r => r.role === 'lift').every(r => r.power === 0));
  assert.equal(f.effects.mesh.userData.pressureLayers, 8);
  const { particleCore, particleDirection, particleProfile } = f.effects.mesh.geometry.attributes;
  for (let i = 0; i < f.effects.mesh.geometry.instanceCount; i++) {
    assert.equal(particleProfile.getW(i), 0, 'horizontal rear exhaust cannot create detached road wash');
    if (particleCore.getX(i)) assert.equal(particleDirection.getZ(i), 1);
  }
  f.state.boostThrusterPower = 0;
  for (let i = 0; i < 120; i++) f.effects.update(f.state, 1 / 60, i / 60);
  assert.equal(f.effects.mesh.geometry.instanceCount, 0, 'explicit boost power can override boosting without reviving lift');
  f.effects.dispose();
});

test('world-space wake does not move with socket articulation and high hover reaches the road', () => {
  const f = authoredFixture();
  for (let i = 0; i < 55; i++) f.effects.update(f.state, 1 / 60, i / 60);
  const attributes = f.effects.mesh.geometry.attributes, count = f.effects.mesh.geometry.instanceCount;
  assert.ok(Array.from(attributes.particleProfile.array).filter((v, i) => i % 4 === 3 && v === 1).length > 0, 'actual downward parcels expand into a grounded cloud from full cruise height');
  const centers = attributes.particleCenter.array.slice(), directions = attributes.particleDirection.array.slice();
  f.player.position.x = 4; f.player.rotation.z = .4;
  f.effects.update(f.state, 0, 55 / 60);
  for (let i = 0; i < count - 8; i++) {
    assert.deepEqual(Array.from(attributes.particleCenter.array.slice(i * 3, i * 3 + 3)), Array.from(centers.slice(i * 3, i * 3 + 3)));
    assert.deepEqual(Array.from(attributes.particleDirection.array.slice(i * 3, i * 3 + 3)), Array.from(directions.slice(i * 3, i * 3 + 3)));
  }
  assert.notEqual(attributes.particleCenter.getX(count - 1), centers[(count - 1) * 3], 'only the current pressure layers follow the moved nozzle');
  f.effects.dispose();
});

test('missing apertures never generate guessed jets and simultaneous roles keep the fixed capacity', () => {
  const scene = new T.Scene(), car = new T.Group(); scene.add(car);
  const empty = createThrusterEffects(scene, car);
  empty.update({ phase: 'playing', altitude: 3, thrusterPower: 1, boosting: true }, .1, 1);
  assert.equal(empty.mesh.geometry.instanceCount, 0); assert.deepEqual(empty.mesh.userData.emitters, []); empty.dispose();
  const f = authoredFixture(); f.state.boosting = true;
  for (let i = 0; i < 1000; i++) f.effects.update(f.state, i % 2 ? .1 : .016, i * .06);
  assert.equal(f.effects.mesh.userData.capacity, 160);
  assert.ok(f.effects.mesh.geometry.instanceCount <= 160);
  assert.equal(f.effects.mesh.userData.pressureLayers, 16);
  for (const attribute of Object.values(f.effects.mesh.geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite));
  f.effects.clear(); assert.equal(f.effects.mesh.userData.pressureLayers, 0);
  assert.ok(f.effects.mesh.userData.emitters.every(record => record.power === 0)); f.effects.dispose();
});

test('shipping Rocket GLB supplies separate lift and aft-boost apertures in the agreed coordinate system', async () => {
  const bytes = await readFile(new URL('../public/assets/roadster.glb', import.meta.url));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  // Reconstruct only the authored transform graph. No material, mesh, texture or
  // WebGL dependency is needed to validate the emitter integration contract.
  const nodes = gltf.nodes.map(node => {
    const object = new T.Object3D(); object.name = node.name || ''; object.userData = node.extras || {};
    if (node.matrix) object.applyMatrix4(new T.Matrix4().fromArray(node.matrix));
    else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  gltf.nodes.forEach((node, index) => { for (const child of node.children || []) nodes[index].add(nodes[child]); });
  const scene = new T.Scene(), player = new T.Group(); scene.add(player); player.position.y = 3.4;
  for (const index of gltf.scenes[gltf.scene || 0].nodes) player.add(nodes[index]);
  const effects = createThrusterEffects(scene, player);
  effects.update({ phase: 'playing', altitude: 3.3, thrusterPower: .8, boostThrusterPower: .8 }, .1, .1);
  const records = effects.mesh.userData.emitters;
  assert.equal(records.filter(record => record.role === 'lift').length, 4);
  assert.equal(records.filter(record => record.role === 'boost').length, 4);
  for (const record of records) {
    assert.ok(record.radius > .02 && record.radius < .09, record.name + ' uses a calibrated bore, not the chassis scale');
    assert.ok(record.role === 'lift' ? record.direction[1] < -.99 : record.direction[2] > .99, record.name + ' points out of its authored aperture');
  }
  effects.dispose();
});

test('Blender smoke atlas has eight shaded RGBA variants, transparent tile edges and no black halos', async () => {
  const { inflateSync } = await import('node:zlib');
  const { createHash } = await import('node:crypto');
  const png = await readFile(new URL('../public/assets/cold-gas-smoke-atlas.png', import.meta.url));
  const metadata = JSON.parse(await readFile(new URL('../art/smoke/provenance.json', import.meta.url), 'utf8'));
  assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 512);
  assert.equal(png[24], 8); assert.equal(png[25], 6, '8-bit straight RGBA PNG');
  assert.ok(png.length < 1024 * 1024, 'compressed atlas stays below 1 MiB');
  assert.equal(createHash('sha256').update(png).digest('hex'), metadata.sha256);
  assert.match(metadata.renderer, /Blender Cycles/);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), name = png.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks)), width = 1024, height = 512, stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  /**
   * Choose the PNG Paeth predictor from already reconstructed neighbor bytes.
   * Used only to decode the known 8-bit RGBA smoke atlas for alpha/color checks.
   * @param {number} a - Left byte, or zero at the first pixel.
   * @param {number} b - Above byte, or zero on the first row.
   * @param {number} c - Upper-left byte, or zero at an image boundary.
   * @returns {number} Selected neighboring byte before residual addition.
   */
  const paeth = (a, b, c) => {
    const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1), filter = raw[start];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= 4 ? pixels[at - 4] : 0;
      const b = y > 0 ? pixels[at - stride] : 0, c = x >= 4 && y > 0 ? pixels[at - stride - 4] : 0;
      const predicted = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[at] = raw[start + x + 1] + predicted;
    }
  }
  let translucent = 0, strong = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, alpha = pixels[at + 3];
    if (x % 256 === 0 || x % 256 === 255 || y % 256 === 0 || y % 256 === 255) assert.equal(alpha, 0);
    if (alpha === 0) assert.ok(pixels[at] > 200 && pixels[at + 1] > 200 && pixels[at + 2] > 200);
    if (alpha > 10 && alpha < 245) translucent++;
    if (alpha > 140) strong++;
  }
  assert.ok(translucent > width * height * .12, 'cloudy volume, not a few faint dots');
  assert.ok(strong > 1000, 'enough visible body to read against bright asphalt');
});
