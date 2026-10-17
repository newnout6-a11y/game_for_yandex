import * as T from '../public/vendor/three.js';

/**
 * Bound a scalar effect control without allocating temporary objects.
 * @param {number} value - Scalar to constrain.
 * @param {number} [low=0] - Inclusive lower limit.
 * @param {number} [high=1] - Inclusive upper limit.
 * @returns {number} Clamped value; callers sanitize nonfinite inputs separately.
 */
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
/**
 * Use an effect input only when it is a finite number.
 * @param {*} value - Candidate state/timing value.
 * @param {number} [fallback=0] - Safe value for missing, NaN or infinite input.
 * @returns {number} The original finite number or fallback, without coercion.
 */
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const TAU = Math.PI * 2;

// Small original fallback used only while the Blender atlas is loading. Its feathered, irregular edge
// stays invisible as a quad; the same tiny texture serves both vapor and road wash.
/**
 * Generate the small procedural condensation fallback used until the atlas loads.
 * @returns {T.DataTexture} New 96-pixel-square RGBA texture with feathered alpha; the effects owner disposes it.
 */
function makeVaporTexture() {
  const size = 96, data = new Uint8Array(size * size * 4);
  /**
   * Hash a noise-grid coordinate into a repeatable fractional value.
   * @param {number} x - Horizontal grid coordinate, not scene position.
   * @param {number} y - Vertical grid coordinate.
   * @returns {number} Deterministic value in [0, 1).
   */
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + 18.17) * 43758.5453;
    return n - Math.floor(n);
  };
  /**
   * Smoothly interpolate four deterministic lattice samples for the vapor mask.
   * @param {number} x - Horizontal noise-space coordinate.
   * @param {number} y - Vertical noise-space coordinate.
   * @returns {number} Smooth scalar density in [0, 1).
   */
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
 * Attach one bounded instanced draw for authored cold-gas apertures and road wash.
 * Call update after positioning the car. Emitted vapor is a detached world-space wake: rolling
 * changes new nozzle directions, not existing particles. The flight controller owns power.
 * The returned owner manages its geometry, shader, fallback/atlas textures and disposal race.
 * @param {T.Scene} scene - Scene receiving the effect mesh, separate from the player hierarchy.
 * @param {T.Object3D} player - Vehicle with optional named thruster sockets in local metre coordinates.
 * @param {Object} [options] - Particle budget and accessibility controls.
 * @param {boolean} [options.compact=false] - Use capacity 112 instead of 160, including reserved jet layers.
 * @param {boolean} [options.reducedMotion=false] - Reduce turbulence and suppress core pulsation.
 * @returns {Object} update, clear, dispose, mesh and ready; ready resolves whether the atlas became active.
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
  const profiles = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('particleCenter', centers);
  geometry.setAttribute('particleDirection', directions);
  geometry.setAttribute('particleShape', shapes);
  geometry.setAttribute('particleColor', colors);
  geometry.setAttribute('particleCore', cores);
  geometry.setAttribute('particleProfile', profiles);
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
      attribute vec4 particleProfile;
      uniform vec2 atlasGrid;
      varying vec4 vVaporUv;
      varying float vVariantMix;
      varying vec2 vJetUv;
      varying float vCore;
      varying vec4 vVaporColor;
      varying float vWorldHeight;
      varying vec4 vProfile;
      void main() {
        vec4 center = viewMatrix * vec4(particleCenter, 1.0);
        vec3 viewDirection = mat3(viewMatrix) * particleDirection;
        vec2 axis = viewDirection.xy;
        axis = length(axis) > 0.001 ? normalize(axis) : vec2(0.0, 1.0);
        float c = cos(particleShape.w), s = sin(particleShape.w);
        axis = mat2(c, -s, s, c) * axis;
        vec2 across = vec2(axis.y, -axis.x);
        vec3 offset;
        if (particleCore > 0.5) {
          // A camera-facing ribbon around the actual 3D nozzle axis, not a screen-
          // stretched sprite. Root and tip stay attached even in a rear-on view.
          float taper = mix(particleProfile.x, 1.0, uv.y);
          offset = vec3(across * position.x * particleShape.x * taper, 0.0)
            + viewDirection * position.y * particleShape.y;
          offset.xy += axis * position.y * particleShape.x
            * (1.0 - smoothstep(0.0, .18, length(viewDirection.xy)));
        } else {
          offset = vec3(across * position.x * particleShape.x + axis * position.y * particleShape.y, 0.0);
        }
        center.xyz += offset;
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
        vJetUv = uv; vCore = particleCore; vProfile = particleProfile;
        vVaporColor = vec4(particleColor.rgb, particleShape.z);
        // Analytic road fade avoids hard ground intersections without a depth
        // texture, another render pass, or a mobile-unfriendly soft-particle FBO.
        vWorldHeight = particleCenter.y + viewMatrix[1][0] * offset.x
          + viewMatrix[1][1] * offset.y + viewMatrix[1][2] * offset.z;
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
      varying vec4 vProfile;
      void main() {
        vec4 vapor = mix(texture2D(vaporMap, vVaporUv.xy), texture2D(vaporMap, vVaporUv.zw), vVariantMix);
        float axial = vJetUv.y, crossJet = vJetUv.x * 2.0 - 1.0;
        // Subtle pressure-cell condensation and ragged entrainment are visual
        // approximations of the reference, not flame/shock-diamond emissive cones.
        float cells = pow(max(0.0, sin(axial * 24.0 - vProfile.y)), 5.0);
        float waviness = sin(axial * 36.0 + vProfile.y) * axial * .055;
        float edgeNoise = .8 + vapor.a * .4;
        float radial = (crossJet + waviness) / edgeNoise;
        float pressureShape = exp(-radial * radial * mix(4.2, 2.8, axial))
          * smoothstep(0.0, .035, axial) * (1.0 - smoothstep(.52, 1.0, axial))
          * (1.0 - smoothstep(.68, 1.0, abs(crossJet)));
        float jetDensity = pressureShape * mix(.56 + cells * .44, .36 + vapor.a * .7, vProfile.z);
        float density = mix(vapor.a, jetDensity, vCore);
        float alpha = density * vVaporColor.a * smoothstep(0.035, 0.16, vWorldHeight);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(vVaporColor.rgb * mix(vapor.rgb, vec3(1.0), vCore * .94), alpha);
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
  player.traverse(socket => {
    const data = socket.userData;
    const legacyLift = /^thruster_(fl|fr|rl|rr)$/.test(socket.name);
    const oldRole = { lift_nozzle: 'lift', rear_nozzle: 'boost', roll_nozzle: 'roll' }[data.socketType];
    const role = data.thrusterRole || oldRole || (['lift', 'boost', 'roll'].includes(data.socketType) ? data.socketType : null)
      || (legacyLift ? 'lift' : null);
    if (!['lift', 'boost', 'roll'].includes(role) || emitters.length >= 12) return;
    const supplied = data.thrusterDirection || data.direction;
    const vector = Array.isArray(supplied) && supplied.length === 3 && supplied.every(Number.isFinite)
      ? supplied : role === 'boost' ? [0, 0, 1] : [0, -1, 0];
    const localDirection = new T.Vector3(...vector);
    if (localDirection.lengthSq() < .0001) return;
    // No guessed vehicle coordinates: a missing socket produces no phantom jet.
    // Legacy assets have named apertures but lack radius extras; only their size
    // falls back. New Blender sockets carry their calibrated local bore radius.
    emitters.push({ socket, role, localDirection: localDirection.normalize(),
      aperture: clamp(finite(data.apertureRadius, .066), .008, .25), radius: .066,
      local: new T.Vector3(), world: new T.Vector3(), direction: new T.Vector3(),
      carry: 0, washCarry: 0, power: 0, clearance: 0, index: emitters.length });
  });
  const scale = new T.Vector3();
  const inversePlayer = new T.Matrix4();
  const coreCapacity = emitters.length * 2;
  const pool = Array.from({ length: capacity - coreCapacity }, () => ({
    age: 1, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    dx: 0, dy: -1, dz: 0, seed: 0, width: 0, length: 0,
    opacity: 0, ground: false, size: 1, landing: false, frame: 0, fresh: false,
  }));
  let cursor = 0, smoothedPower = 0, smoothedBoost = 0, previousAltitude = 0, previousDistance = null, disposed = false;
  let randomSeed = 0x6d2b79f5;
  /**
   * Advance the effect-local xorshift generator used to vary recycled particles.
   * @returns {number} Pseudorandom value in [0, 1), mutating only the enclosing randomSeed.
   */
  const random = () => {
    randomSeed ^= randomSeed << 13; randomSeed ^= randomSeed >>> 17; randomSeed ^= randomSeed << 5;
    return (randomSeed >>> 0) / 4294967296;
  };
  /**
   * Overwrite the next fixed-pool slot with a jet puff or near-road wash particle.
   * Uses the current world nozzle direction and ground-frame velocity; never allocates a mesh
   * or expands the pool, so saturation deliberately replaces the oldest cursor slot.
   * @param {Object} emitter - Socket record with its current world-space position in metres.
   * @param {number} power - Normalized effective nozzle power controlling density and jet velocity.
   * @param {number} speed - Vehicle forward speed in metres per second.
   * @param {boolean} wash - Emit a low radial road cloud instead of a directed jet.
   * @param {number} stagger - Seconds already elapsed since this emission within the current step.
   * @param {boolean} [landing=false] - Increase spread/lifetime for landing support.
   * @returns {void} Mutates the selected particle and ring cursor.
   */
  function spawn(emitter, power, speed, wash, stagger, landing = false) {
    const direction = emitter.direction;
    const p = pool[cursor]; cursor = (cursor + 1) % pool.length;
    p.seed = random() * TAU; p.size = .8 + random() * .4; p.frame = Math.floor(random() * 8);
    p.age = 0; p.ground = wash; p.landing = landing; p.fresh = true;
    p.life = (wash ? .7 + random() * .24 : .58 + random() * .16) + (landing ? .08 : 0);
    p.opacity = (wash ? .58 : .9) * (.35 + power * .65) * (landing ? 1.08 : 1);
    const spread = wash ? .3 : emitter.radius * .35;
    p.x = emitter.world.x + (random() - .5) * spread;
    p.y = wash ? .24 : emitter.world.y + direction.y * .014;
    p.z = emitter.world.z + (random() - .5) * spread;
    if (wash) {
      const angle = random() * TAU;
      const radial = (landing ? 4.2 : 3.3) + random() * 1.6;
      p.x += direction.x * emitter.clearance;
      p.z += direction.z * emitter.clearance;
      p.vx = Math.cos(angle) * radial; p.vy = .04 + random() * .1;
      p.vz = Math.sin(angle) * radial - speed * .45;
      p.dx = 0; p.dy = 1; p.dz = 0;
      p.width = landing ? 1.05 : .8; p.length = landing ? .52 : .4;
    } else {
      const velocity = 5.6 + power * 4.1 + random() * .8;
      p.vx = direction.x * velocity + (random() - .5) * .2;
      p.vy = direction.y * velocity;
      p.vz = direction.z * velocity - speed * .965;
      p.dx = direction.x; p.dy = direction.y; p.dz = direction.z;
      p.width = emitter.radius * (landing ? 3.1 : 2.5); p.length = .46 + power * .25;
    }
    // Distribute emissions through the timestep instead of creating synchronized
    // rings at low frame rates. No allocation or mesh creation occurs in update.
    p.age = stagger;
    // Newly spawned particles have already travelled for their stagger, so update
    // must not integrate them by another full timestep (visible at low FPS).
    p.x += p.vx * stagger; p.y += p.vy * stagger; p.z += (p.vz + speed) * stagger;
  }

  /**
   * Expire all pooled particles and reset accumulated emissions and scroll tracking.
   * @returns {void} Hides the mesh and clears diagnostics without releasing reusable GPU resources.
   */
  function clear() {
    for (const p of pool) p.age = p.life;
    for (const emitter of emitters) emitter.carry = emitter.washCarry = emitter.power = 0;
    smoothedPower = smoothedBoost = 0; previousDistance = null; geometry.instanceCount = 0; mesh.visible = false;
    mesh.userData.activeParticles = 0; mesh.userData.thrusterPower = mesh.userData.boostPower = 0;
    mesh.userData.pressureLayers = 0;
    for (const record of mesh.userData.emitters) record.power = 0;
  }

  /**
   * Advance existing vapor and write the active instanced billboards after player placement.
   * Clamps integration to 0..0.1 seconds, detects route discontinuities and applies exact distance
   * scroll when supplied. Uses fixed buffers/pool and two layers per authored aperture; no
   * particle meshes or per-particle objects are allocated. Disposed owners ignore future calls.
   * @param {Object} [state] - Flight/game state with altitude/distance in metres, speeds in metres per second,
   *  normalized thrusterPower/rollProgress, radian-per-second rollAngularSpeed and phase flags.
   *  Rear apertures use boosting or an explicit boostThrusterPower; they never inherit lift power.
   * @param {number} [dt=0] - Elapsed seconds; zero refreshes placement without integrating particles.
   * @param {number} [time=0] - Animation clock in seconds for turbulence and core pulsation.
   * @returns {void} Mutates effect particles, emitter carries, GPU attributes and mesh diagnostics.
   */
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
    const boost = state.phase === 'crashed' ? 0 : clamp(finite(state.boostThrusterPower, state.boosting ? .88 : 0));
    smoothedBoost += (boost - smoothedBoost) * (1 - Math.exp(-step * (boost > smoothedBoost ? 30 : 15)));
    if (smoothedBoost < .003) smoothedBoost = 0;
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
    inversePlayer.copy(player.matrixWorld).invert();
    const supportingLanding = Boolean(state.landing || velocity < -.08 || state.touchdownPulse > 0);
    const landingStrength = supportingLanding ? 1.45 : 1;
    for (const emitter of emitters) {
        // Updating socket ancestry avoids traversing every body/cabin mesh a
        // second time before the renderer. Articulating parent pivots still work.
        emitter.socket.updateWorldMatrix(true, false);
        emitter.world.setFromMatrixPosition(emitter.socket.matrixWorld);
        emitter.local.copy(emitter.world).applyMatrix4(inversePlayer);
        emitter.direction.copy(emitter.localDirection).transformDirection(emitter.socket.matrixWorld);
        emitter.socket.getWorldScale(scale);
        emitter.radius = emitter.aperture * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        const direction = emitter.direction;
        emitter.clearance = direction.y < -.2 ? Math.max(.025, (emitter.world.y - .065) / -direction.y) : Infinity;
        // Upright jets carry the car. During the full longitudinal roll they
        // feather off, with only brief alternating correction puffs; an upside-
        // down car must not appear to fire four full-power jets into the sky.
        const upright = clamp((-direction.y - .15) / .85);
        const rollPhase = finite(state.rollProgress) * TAU;
        const correctionSide = Math.sign(finite(state.rollAngularSpeed, 1)) * Math.sign(emitter.local.x);
        const correctionPulse = Math.sin(rollPhase * 3 + correctionSide * 1.8) > .72 ? .2 : 0;
        const angularPower = state.rolling ? Math.max(upright, correctionPulse * (1 - upright)) : 1;
        const emitterPower = emitter.role === 'boost' ? smoothedBoost
          : emitter.role === 'roll' ? clamp(finite(state.rollThrusterPower, state.rolling ? correctionPulse : 0))
          : smoothedPower * angularPower;
        emitter.power = emitterPower;
        const record = mesh.userData.emitters[emitter.index];
        emitter.world.toArray(record.position); direction.toArray(record.direction);
        record.radius = emitter.radius; record.power = emitterPower;
        if (emitterPower < .025) { emitter.carry = emitter.washCarry = 0; continue; }
        const landing = supportingLanding && emitter.role === 'lift';
        const rate = (compact ? 32 : 50) * (.3 + emitterPower * .7) * (emitter.role === 'boost' ? .72 : 1);
        emitter.carry += step * rate;
        while (emitter.carry >= 1) {
          emitter.carry -= 1;
          spawn(emitter, emitterPower, speed, false, emitter.carry / rate, landing);
        }
        // Road wash comes only from downward-facing, nearby jets. In a roll,
        // upward/sideways jets cannot create a disconnected cloud on the road.
        const proximity = clamp(1 - emitter.clearance / 2.1);
        const washRate = (compact ? 7 : 10) * proximity * emitterPower * landingStrength * clamp((-direction.y - .35) / .65);
        emitter.washCarry += step * washRate;
        while (emitter.washCarry >= 1) {
          emitter.washCarry -= 1;
          spawn(emitter, emitterPower * proximity, speed, true, emitter.washCarry / washRate, landing);
        }
    }
    let count = 0;
    for (const p of pool) {
      if (p.age >= p.life) continue;
      const advance = p.fresh ? 0 : step; p.fresh = false;
      p.age += advance;
      if (p.age >= p.life) continue;
      let progress = p.age / p.life;
      if (advance > 0) {
        const turbulence = (reducedMotion ? .4 : .85) * progress * progress;
        p.vx += Math.sin(p.seed + finite(time) * 9) * turbulence * advance;
        p.vz *= Math.exp(-advance * (p.ground ? 2.1 : 1.25));
        if (!p.ground) p.vy *= Math.exp(-advance * .36);
        p.x += p.vx * advance; p.y += p.vy * advance; p.z += p.vz * advance + travelled;
      }
      if (p.y < .095 && !p.ground && p.vy < 0) {
        // Impact turns the same parcel into a longer-lived radial ground cloud.
        // Resetting its expansion age prevents high-hover gas dying on contact;
        // the bounded pool is unchanged and no separate effect is spawned.
        p.ground = true; p.y = .24; p.vy = .09;
        p.vx += Math.sin(p.seed) * (p.landing ? 4.3 : 3.1); p.vz += Math.cos(p.seed) * 2.6;
        p.width = p.landing ? .95 : .72; p.length = p.landing ? .48 : .38;
        p.opacity *= .64; p.life = p.landing ? .82 : .72; p.age = .055; progress = p.age / p.life;
        p.dx = 0; p.dy = 1; p.dz = 0;
      }
      const fadeIn = clamp(p.age / .035);
      const fadeOut = Math.pow(1 - progress, p.ground ? 1.15 : 1.25);
      const alpha = p.opacity * fadeIn * fadeOut;
      if (alpha < .004 || p.y < .035) continue;
      const expansion = Math.pow(progress, p.ground ? .72 : 1.2);
      const width = (p.width + (p.ground ? 2.65 : (p.landing ? 1.08 : .88)) * expansion) * p.size;
      const length = (p.length + (p.ground ? .48 : 1.12) * expansion) * p.size;
      centers.setXYZ(count, p.x, p.y, p.z);
      directions.setXYZ(count, p.dx, p.dy, p.dz);
      shapes.setXYZW(count, width, length, alpha, p.ground ? 0 : Math.sin(p.seed + p.age * 3) * .22 * progress);
      // Pale, non-emissive condensation with a slightly warmer dusty road wash.
      cores.setX(count, 0);
      colors.setXYZW(count, p.ground ? .9 : .97, p.ground ? .92 : .985, p.ground ? .93 : 1, p.frame + progress * .8);
      profiles.setXYZW(count, 1, p.seed, 0, p.ground ? 1 : 0);
      count++;
    }
    // Each authored aperture reserves two continuous pressure/entrainment layers.
    // Their root is the bore, their axis is the socket, and length is clipped at
    // the road. No solid cone or full-bright emissive flame is drawn.
    let coreCount = 0;
    for (const emitter of emitters) {
      if (emitter.power < .035) continue;
      const feather = Math.pow(emitter.power, .55);
      const direction = emitter.direction;
      const diameter = emitter.radius * 2;
      for (let layer = 0; layer < 2; layer++) {
        const length = Math.min((layer ? 17 : 10) * diameter * (.65 + feather * .35), emitter.clearance);
        const offset = .008 + length * .5;
        centers.setXYZ(count, emitter.world.x + direction.x * offset, emitter.world.y + direction.y * offset, emitter.world.z + direction.z * offset);
        directions.setXYZ(count, direction.x, direction.y, direction.z);
        const pulse = reducedMotion ? 1 : .96 + Math.sin(finite(time) * 23 + emitter.index * 2.1) * .04;
        const width = diameter + length * (layer ? .3 : .14);
        shapes.setXYZW(count, width, length, (layer ? .52 : .88) * feather * pulse, 0);
        colors.setXYZW(count, .975, .99, 1, (emitter.index + layer * 3) % 8 + (finite(time) * .2 % .85));
        profiles.setXYZW(count, diameter / width, reducedMotion ? emitter.index : finite(time) * 13 + emitter.index * 1.7, layer, 0);
        cores.setX(count, 1); count++; coreCount++;
      }
    }
    geometry.instanceCount = count; mesh.visible = count > 0;
    if (count) { centers.needsUpdate = directions.needsUpdate = shapes.needsUpdate = colors.needsUpdate = cores.needsUpdate = profiles.needsUpdate = true; }
    mesh.userData.activeParticles = count;
    mesh.userData.thrusterPower = smoothedPower;
    mesh.userData.boostPower = smoothedBoost; mesh.userData.pressureLayers = coreCount;
  }

  /**
   * Remove the effect and release its owned geometry, shader and active textures once.
   * @returns {void} Idempotent; a later atlas completion is disposed instead of reviving the effect.
   */
  function dispose() {
    if (disposed) return;
    disposed = true; scene.remove(mesh);
    geometry.dispose(); material.dispose(); texture.dispose();
    if (material.uniforms.vaporMap.value !== texture) material.uniforms.vaporMap.value.dispose();
  }
  mesh.userData.capacity = capacity;
  mesh.userData.emitters = emitters.map(emitter => ({ name: emitter.socket.name, role: emitter.role,
    position: [0, 0, 0], direction: [0, -1, 0], radius: emitter.radius, power: 0 }));
  mesh.userData.pressureLayers = 0;
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
