import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../public/vendor/three.js';
import { createThrusterEffects } from '../src/thrusters.js';

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
  const advance = (frames, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) {
      time += dt; state.distance += state.speed * dt;
      effects.update(state, dt, time);
    }
  };
  return { scene, player, effects, state, advance };
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
