import * as T from '../public/vendor/three.js';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const TAU = Math.PI * 2;

// Small original fallback used only while the Blender atlas is loading. Its feathered, irregular edge
// stays invisible as a quad; the same tiny texture serves both vapor and road wash.
function makeVaporTexture() {
  const size = 96, data = new Uint8Array(size * size * 4);
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + 18.17) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
    const b = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
    return a * (1 - sy) + b * sy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size;
    const coarse = noise(u * 5.3, v * 5.3);
    const detail = noise(u * 13 + 9, v * 13 + 4);
    const fine = noise(u * 29 + 13, v * 29 + 17);
    const dx = (u - .5) * 2, dy = (v - .5) * 2;
    const radius = Math.hypot(dx, dy);
    const fringe = clamp((1 - radius) * 3.1);
    const envelope = Math.exp(-radius * radius * 3.8) * fringe * fringe;
    const density = clamp((coarse * .58 + detail * .3 + fine * .12 - .17) * 1.7);
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = Math.round(215 + coarse * 40);
    data[offset + 3] = Math.round(255 * envelope * density);
  }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.name = 'original-cold-gas-condensation';
  texture.minFilter = T.LinearFilter; texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

/**
 * One bounded instanced draw for all four cold-gas jets and road-level wash.
 * Call update after positioning the car. Particles are detached world-space
 * wakes: rolling changes the nozzle direction, never already-emitted vapor.
 * The flight controller owns thrusterPower, including assisted descent/contact.
 */
export function createThrusterEffects(scene, player, { compact = false, reducedMotion = false } = {}) {
  const capacity = compact ? 112 : 160;
  const geometry = new T.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new T.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  const centers = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage);
  const directions = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage);
  const shapes = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage);
  const colors = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage);
  const cores = new T.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('particleCenter', centers);
  geometry.setAttribute('particleDirection', directions);
  geometry.setAttribute('particleShape', shapes);
  geometry.setAttribute('particleColor', colors);
  geometry.setAttribute('particleCore', cores);
  geometry.instanceCount = 0;
  const texture = makeVaporTexture();
  const material = new T.ShaderMaterial({
    name: 'cold-gas-vapor', transparent: true, depthWrite: false, depthTest: true,
    blending: T.NormalBlending, toneMapped: true,
    uniforms: { vaporMap: { value: texture }, atlasGrid: { value: new T.Vector2(1, 1) } },
    vertexShader: `
      attribute vec3 particleCenter;
      attribute vec3 particleDirection;
      attribute vec4 particleShape;
      attribute vec4 particleColor;
      attribute float particleCore;
      uniform vec2 atlasGrid;
      varying vec4 vVaporUv;
      varying float vVariantMix;
      varying vec2 vJetUv;
      varying float vCore;
      varying vec4 vVaporColor;
      varying float vWorldHeight;
      void main() {
        vec4 center = viewMatrix * vec4(particleCenter, 1.0);
        vec3 viewDirection = mat3(viewMatrix) * particleDirection;
        vec2 axis = viewDirection.xy;
        axis = length(axis) > 0.001 ? normalize(axis) : vec2(0.0, 1.0);
        float c = cos(particleShape.w), s = sin(particleShape.w);
        axis = mat2(c, -s, s, c) * axis;
        vec2 across = vec2(axis.y, -axis.x);
        vec2 offset = across * position.x * particleShape.x + axis * position.y * particleShape.y;
        center.xy += offset;
        gl_Position = projectionMatrix * center;
        float frameCount = atlasGrid.x * atlasGrid.y;
        float frame = mod(floor(particleColor.w), frameCount);
        float nextFrame = mod(frame + 3.0, frameCount);
        // Inset by one texel so adjacent atlas tiles cannot bleed at the edge.
        vec2 tileUv = mix(vec2(1.0 / 256.0), vec2(255.0 / 256.0), uv);
        vec2 tile = vec2(mod(frame, atlasGrid.x), floor(frame / atlasGrid.x));
        vec2 nextTile = vec2(mod(nextFrame, atlasGrid.x), floor(nextFrame / atlasGrid.x));
        vVaporUv = vec4((tileUv + tile) / atlasGrid, (tileUv + nextTile) / atlasGrid);
        vVariantMix = fract(particleColor.w);
        vJetUv = uv; vCore = particleCore;
        vVaporColor = vec4(particleColor.rgb, particleShape.z);
        // Analytic road fade avoids hard ground intersections without a depth
        // texture, another render pass, or a mobile-unfriendly soft-particle FBO.
        vWorldHeight = particleCenter.y + viewMatrix[1][0] * offset.x + viewMatrix[1][1] * offset.y;
      }
    `,
    fragmentShader: `
      uniform sampler2D vaporMap;
      varying vec4 vVaporUv;
      varying float vVariantMix;
      varying vec2 vJetUv;
      varying float vCore;
      varying vec4 vVaporColor;
      varying float vWorldHeight;
      void main() {
        vec4 vapor = mix(texture2D(vaporMap, vVaporUv.xy), texture2D(vaporMap, vVaporUv.zw), vVariantMix);
        vec2 pressureUv = vJetUv * 2.0 - 1.0;
        float pressureShape = exp(-pressureUv.x * pressureUv.x * 5.5)
          * (1.0 - smoothstep(0.35, 1.0, abs(pressureUv.y)))
          * (1.0 - smoothstep(0.7, 1.0, abs(pressureUv.x)));
        // A continuous, translucent pressure core connects the turbulent puffs.
        // Both its width and ends are feathered; there is no solid cone surface.
        float density = mix(vapor.a, pressureShape * (.8 + vapor.a * .2), vCore);
        float alpha = density * vVaporColor.a * smoothstep(0.035, 0.16, vWorldHeight);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(vVaporColor.rgb * mix(vapor.rgb, vec3(1.0), vCore * .9), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'cold-gas-thruster-vapor'; mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
  scene.add(mesh);

  player.updateWorldMatrix(true, true);
  const emitters = [];
  for (const x of [-.67, .67]) for (const z of [-1.35, 1.35]) {
    const socket = player.getObjectByName('thruster_' + (z < 0 ? 'f' : 'r') + (x < 0 ? 'l' : 'r'));
    const local = socket ? player.worldToLocal(socket.getWorldPosition(new T.Vector3())) : new T.Vector3(x, .16, z);
    emitters.push({ local, world: new T.Vector3(), carry: 0, washCarry: 0, power: 0 });
  }
  const direction = new T.Vector3();
  const pool = Array.from({ length: capacity - 8 }, () => ({
    age: 1, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    dx: 0, dy: -1, dz: 0, seed: 0, width: 0, length: 0,
    opacity: 0, ground: false, size: 1, landing: false, frame: 0,
  }));
  let cursor = 0, smoothedPower = 0, previousAltitude = 0, previousDistance = null, disposed = false;
  let randomSeed = 0x6d2b79f5;
  const random = () => {
    randomSeed ^= randomSeed << 13; randomSeed ^= randomSeed >>> 17; randomSeed ^= randomSeed << 5;
    return (randomSeed >>> 0) / 4294967296;
  };
  function spawn(emitter, power, speed, wash, stagger, landing = false) {
    const p = pool[cursor]; cursor = (cursor + 1) % pool.length;
    p.seed = random() * TAU; p.size = .8 + random() * .4; p.frame = Math.floor(random() * 8);
    p.age = 0; p.ground = wash; p.landing = landing;
    p.life = (wash ? .62 + random() * .24 : .48 + random() * .2) + (landing ? .1 : 0);
    p.opacity = (wash ? .45 : .68) * (.3 + power * .7) * (landing ? (wash ? 1.15 : 1.1) : 1);
    const spread = wash ? .3 : .03;
    p.x = emitter.world.x + (random() - .5) * spread;
    p.y = wash ? .3 : emitter.world.y + direction.y * .035;
    p.z = emitter.world.z + (random() - .5) * spread;
    if (wash) {
      const angle = random() * TAU;
      const radial = (landing ? 4.6 : 3) + random() * 2.1;
      p.x += direction.x * Math.min(1.5, emitter.world.y);
      p.z += direction.z * Math.min(1.5, emitter.world.y);
      p.vx = Math.cos(angle) * radial; p.vy = .04 + random() * .1;
      p.vz = Math.sin(angle) * radial - speed * .28;
      p.dx = 0; p.dy = 1; p.dz = 0;
      p.width = landing ? 1.1 : .85; p.length = landing ? .56 : .44;
    } else {
      const velocity = 4.4 + power * 3 + random() * .9;
      p.vx = direction.x * velocity + (random() - .5) * .2;
      p.vy = direction.y * velocity;
      p.vz = direction.z * velocity - speed * .965;
      p.dx = direction.x; p.dy = direction.y; p.dz = direction.z;
      p.width = landing ? .3 : .25; p.length = landing ? .48 : .4;
    }
    // Distribute emissions through the timestep instead of creating synchronized
    // rings at low frame rates. No allocation or mesh creation occurs in update.
    p.age = stagger;
    p.x += p.vx * stagger; p.y += p.vy * stagger; p.z += (p.vz + speed) * stagger;
  }

  function clear() {
    for (const p of pool) p.age = p.life;
    for (const emitter of emitters) emitter.carry = emitter.washCarry = emitter.power = 0;
    smoothedPower = 0; previousDistance = null; geometry.instanceCount = 0; mesh.visible = false;
    mesh.userData.activeParticles = 0; mesh.userData.thrusterPower = 0;
  }

  function update(state = {}, dt = 0, time = 0) {
    if (disposed) return;
    const step = clamp(finite(dt), 0, .1);
    const altitude = Math.max(0, finite(state.altitude));
    if (state.phase === 'ready' || state.phase === 'menu') {
      clear(); previousAltitude = altitude; return;
    }
    const velocity = finite(state.verticalSpeed, step > 0 ? (altitude - previousAltitude) / step : 0);
    const fallback = state.flying ? .78 : altitude > .025 ? .45 + .35 * (1 - clamp(altitude / 2)) : 0;
    const power = state.phase === 'crashed' ? 0 : clamp(finite(state.thrusterPower, fallback));
    const response = power > smoothedPower ? 30 : 13;
    smoothedPower += (power - smoothedPower) * (1 - Math.exp(-step * response));
    if (smoothedPower < .003) smoothedPower = 0;
    previousAltitude = altitude;
    const speed = Math.max(0, finite(state.speed));
    // The game keeps the car at Z=0 and scrolls the world by distance. Store gas
    // velocity in the ground frame, then apply that exact scroll displacement;
    // it must not swim with the car when braking or leave dust fixed under it.
    let travelled = step > 0 ? speed * step : 0;
    if (Number.isFinite(state.distance)) {
      if (previousDistance !== null && step > 0) travelled = state.distance - previousDistance;
      if (travelled < -.01 || travelled > Math.max(6, speed * .25)) { clear(); travelled = 0; }
      previousDistance = state.distance;
    }
    player.updateWorldMatrix(true, false);
    direction.set(0, -1, 0).transformDirection(player.matrixWorld);
    const supportingLanding = Boolean(state.landing || velocity < -.08 || state.touchdownPulse > 0);
    const landingStrength = supportingLanding ? 1.45 : 1;
    for (const emitter of emitters) emitter.power = 0;
    if (smoothedPower > .025) {
      for (const emitter of emitters) {
        emitter.world.copy(emitter.local).applyMatrix4(player.matrixWorld);
        // Upright jets carry the car. During the full longitudinal roll they
        // feather off, with only brief alternating correction puffs; an upside-
        // down car must not appear to fire four full-power jets into the sky.
        const upright = clamp((-direction.y - .15) / .85);
        const rollPhase = finite(state.rollProgress) * TAU;
        const correctionSide = Math.sign(finite(state.rollAngularSpeed, 1)) * Math.sign(emitter.local.x);
        const correctionPulse = Math.sin(rollPhase * 3 + correctionSide * 1.8) > .72 ? .2 : 0;
        const angularPower = state.rolling ? Math.max(upright, correctionPulse * (1 - upright)) : 1;
        const emitterPower = smoothedPower * angularPower;
        emitter.power = emitterPower;
        if (emitterPower < .025) { emitter.carry = 0; continue; }
        const rate = (compact ? 32 : 50) * (.3 + emitterPower * .7);
        emitter.carry += step * rate;
        while (emitter.carry >= 1) {
          emitter.carry -= 1;
          spawn(emitter, emitterPower, speed, false, emitter.carry / rate, supportingLanding);
        }
        // Road wash comes only from downward-facing, nearby jets. In a roll,
        // upward/sideways jets cannot create a disconnected cloud on the road.
        const proximity = clamp(1 - emitter.world.y / 1.65);
        const washRate = (compact ? 7 : 10) * proximity * emitterPower * landingStrength * clamp((-direction.y - .35) / .65);
        emitter.washCarry += step * washRate;
        while (emitter.washCarry >= 1) {
          emitter.washCarry -= 1;
          spawn(emitter, emitterPower * proximity, speed, true, emitter.washCarry / washRate, supportingLanding);
        }
      }
    }
    let count = 0;
    for (const p of pool) {
      if (p.age >= p.life) continue;
      p.age += step;
      if (p.age >= p.life) continue;
      const progress = p.age / p.life;
      if (step > 0) {
        const turbulence = (reducedMotion ? .35 : .7) * progress;
        p.vx += Math.sin(p.seed + finite(time) * 11) * turbulence * step;
        p.vz *= Math.exp(-step * (p.ground ? 3.5 : 2.3));
        if (!p.ground) p.vy *= Math.exp(-step * .9);
        p.x += p.vx * step; p.y += p.vy * step; p.z += p.vz * step + travelled;
        if (p.y < .09 && !p.ground && p.vy < 0) {
          // Deflect the actual gas at the ground; never continue through asphalt.
          p.ground = true; p.y = .28; p.vy = .12;
          p.vx += Math.sin(p.seed) * (p.landing ? 3.8 : 2.8); p.vz += Math.cos(p.seed) * 1.8;
          p.width = p.landing ? .95 : .72; p.length = p.landing ? .5 : .4; p.opacity *= .75;
          p.dx = 0; p.dy = 1; p.dz = 0;
        }
      }
      const fadeIn = clamp(p.age / .035);
      const fadeOut = Math.pow(1 - progress, p.ground ? 1.15 : 1.25);
      const alpha = p.opacity * fadeIn * fadeOut;
      if (alpha < .004 || p.y < .035) continue;
      const expansion = Math.pow(progress, .8);
      const width = (p.width + (p.ground ? 2.8 : (p.landing ? 1.35 : 1.15)) * expansion) * p.size;
      const length = (p.length + (p.ground ? .55 : 1.05) * expansion) * p.size;
      centers.setXYZ(count, p.x, p.y, p.z);
      directions.setXYZ(count, p.dx, p.dy, p.dz);
      shapes.setXYZW(count, width, length, alpha, p.ground ? 0 : Math.sin(p.seed + p.age * 3) * .5 * progress);
      // Pale, non-emissive condensation with a slightly warmer dusty road wash.
      cores.setX(count, 0);
      colors.setXYZW(count, p.ground ? .8 : .94, p.ground ? .84 : .97, p.ground ? .86 : 1, p.frame + progress * .8);
      count++;
    }
    // Eight persistent near-field billboards share the same geometry/material
    // and reserved pool capacity. They are a continuous jet, not more smoke balls.
    for (const emitter of emitters) {
      if (emitter.power < .035) continue;
      const feather = Math.pow(emitter.power, .55);
      for (let layer = 0; layer < 2; layer++) {
        const clearance = direction.y < -.2 ? Math.max(.06, (emitter.world.y - .07) / -direction.y) : 10;
        const offset = Math.min(layer ? .61 : .23, clearance * .55);
        centers.setXYZ(count, emitter.world.x + direction.x * offset, emitter.world.y + direction.y * offset, emitter.world.z + direction.z * offset);
        directions.setXYZ(count, direction.x, direction.y, direction.z);
        const pulse = reducedMotion ? 1 : .95 + Math.sin(finite(time) * 23 + emitter.local.z * 4) * .05;
        shapes.setXYZW(count, (layer ? .46 : .21) * (.6 + feather * .4), Math.min(layer ? 1.3 : .68, clearance * 1.25), (layer ? .43 : .68) * feather * pulse, 0);
        colors.setXYZW(count, .96, .985, 1, layer + (finite(time) * .2 % .85));
        cores.setX(count, 1); count++;
      }
    }
    geometry.instanceCount = count; mesh.visible = count > 0;
    if (count) { centers.needsUpdate = directions.needsUpdate = shapes.needsUpdate = colors.needsUpdate = cores.needsUpdate = true; }
    mesh.userData.activeParticles = count;
    mesh.userData.thrusterPower = smoothedPower;
  }

  function dispose() {
    if (disposed) return;
    disposed = true; scene.remove(mesh);
    geometry.dispose(); material.dispose(); texture.dispose();
    if (material.uniforms.vaporMap.value !== texture) material.uniforms.vaporMap.value.dispose();
  }
  mesh.userData.capacity = capacity;
  mesh.userData.atlasReady = false;
  // Eight original Cycles-rendered volume variants, two blended samples in the
  // same draw. Loading replaces the temporary fallback without adding a pass.
  const ready = typeof document !== 'undefined' && typeof document.createElementNS === 'function'
    ? new Promise(resolve => {
      new T.TextureLoader().load(new URL('../public/assets/cold-gas-smoke-atlas.png', import.meta.url).href, loaded => {
        if (disposed) { loaded.dispose(); resolve(false); return; }
        loaded.name = 'original-blender-cold-gas-smoke-atlas';
        loaded.colorSpace = T.SRGBColorSpace;
        loaded.minFilter = T.LinearFilter; loaded.magFilter = T.LinearFilter;
        loaded.generateMipmaps = false;
        material.uniforms.vaporMap.value = loaded;
        material.uniforms.atlasGrid.value.set(4, 2);
        texture.dispose();
        mesh.userData.atlasReady = true; mesh.userData.atlasSize = [1024, 512];
        resolve(true);
      }, undefined, () => { mesh.userData.atlasError = true; resolve(false); });
    }) : Promise.resolve(false);
  return { update, dispose, clear, mesh, ready };
}
