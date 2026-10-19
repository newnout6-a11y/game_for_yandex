import * as T from '../public/vendor/three.js';
import { trafficDefinition } from './traffic-catalog.js';
import { trafficLateral } from './traffic-behavior.js';

export const DRIVING_BONUS_LIMIT = 8;
export const DRIVING_BONUS_LIFETIME = .72;
const ACCEPTED = new Set(['pass', 'near', 'charge', 'goal', 'event-clear']);
const VERTEX = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    // A real world-space source, billboarded independently for EACH camera.
    // In particular, a rear mirror never borrows the main camera's orientation.
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(modelMatrix[0].xyz);
    vec4 mvPosition = center + vec4(position.xy * size, 0.0, 0.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;
const FRAGMENT = /* glsl */`
  uniform vec3 accent;
  uniform float opacity;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(accent, opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One small four-segment halo, authored in metres, not screen pixels. */
function createCueGeometry() {
  const vertices = [];
  function quad(ax, ay, bx, by, cx, cy, dx, dy) {
    vertices.push(ax, ay, 0, bx, by, 0, dx, dy, 0, bx, by, 0, cx, cy, 0, dx, dy, 0);
  }
  // Deliberate gaps separate each quarter. No font, texture, icon atlas or text.
  for (let quarter = 0; quarter < 4; quarter++) {
    const start = quarter * Math.PI / 2 + .12, span = Math.PI / 2 - .24;
    for (let i = 0; i < 9; i++) {
      const a = start + i / 9 * span, b = start + (i + 1) / 9 * span;
      quad(Math.cos(a) * .22, Math.sin(a) * .22, Math.cos(b) * .22, Math.sin(b) * .22,
        Math.cos(b) * .245, Math.sin(b) * .245, Math.cos(a) * .245, Math.sin(a) * .245);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  // The shader only rotates this planar geometry. This sphere remains valid in
  // every camera and allows ordinary Three frustum/near-plane clipping.
  geometry.boundingSphere = new T.Sphere(new T.Vector3(), .246);
  return geometry;
}

/**
 * Copy only validated value data. Never retain an entity, pooled mesh, caller
 * anchor or gameplay state inside a cue. Optional pose offsets use vehicle-local
 * metres; the continuous lane coordinate follows its rear-axle datum.
 */
function copyAnchor(target, source) {
  if (!source || !Number.isFinite(source.lane) || !Number.isFinite(source.z)
    || !Number.isFinite(source.height) || !Number.isFinite(source.distance)
    || !Number.isFinite(source.elapsed) || !Number.isFinite(source.speed)) return false;
  target.lane = source.lane; target.z = source.z; target.height = source.height;
  target.distance = source.distance; target.elapsed = source.elapsed; target.speed = source.speed;
  target.heading = Number.isFinite(source.heading) ? source.heading : 0;
  target.offsetX = Number.isFinite(source.offsetX) ? source.offsetX : 0;
  target.offsetZ = Number.isFinite(source.offsetZ) ? source.offsetZ : 0;
  target.entityId = typeof source.entityId === 'string' || Number.isFinite(source.entityId) ? source.entityId : null;
  target.entityKind = typeof source.entityKind === 'string' ? source.entityKind : null;
  return true;
}

/**
 * Own a bounded, allocation-free-at-frame-time pool of understated spatial cues.
 * They share geometry, while each preallocated material owns just its fade. The
 * shader uses ordinary depth testing and camera projection, never screen clamps
 * or a substitute player position. Removing a source cannot retarget a recycled
 * mesh, and a new run/revive cannot inherit its old IDs.
 * @param {T.Scene} scene - Scene receiving the fixed cue group.
 * @param {{bend:function(number,number):number,reducedMotion?:boolean}} options - Existing road curvature and visual preference.
 */
export function createDrivingBonusEffects(scene, { bend, reducedMotion = false }) {
  const group = new T.Group(); group.name = 'driving-bonus-cues'; scene.add(group);
  const geometry = createCueGeometry(), slots = [], scratchAnchor = {};
  let stateRef = null, revives = null, suppressed = true, disposed = false, count = 0, serial = 0;
  for (let i = 0; i < DRIVING_BONUS_LIMIT; i++) {
    const material = new T.ShaderMaterial({ name: 'driving-bonus-halo',
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: { accent: { value: new T.Color('#e5e4ce') }, opacity: { value: 0 } },
      transparent: true, depthTest: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: true,
    });
    const mesh = new T.Mesh(geometry, material); mesh.name = 'driving-bonus-cue';
    mesh.visible = false; group.add(mesh);
    slots.push({ mesh, material, anchor: {}, age: 0, serial: 0, active: false, kind: null });
  }

  function clear() {
    const changed = count > 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]; slot.active = false; slot.mesh.visible = false;
      slot.material.uniforms.opacity.value = 0; slot.age = 0; slot.kind = null;
      slot.anchor.entityId = null; slot.anchor.entityKind = null;
    }
    count = 0;
    return changed;
  }

  /** Run before any render early return; return whether a visible frame needs clearing. */
  function sync(state, suppress = false) {
    if (disposed) return false;
    let changed = false;
    const nextRevives = state?.revives ?? 0;
    if (stateRef !== state || revives !== nextRevives) {
      changed = clear(); stateRef = state; revives = nextRevives;
    }
    suppressed = suppress || !state || state.phase !== 'playing';
    if (suppressed) changed = clear() || changed;
    return changed;
  }

  function place(slot, state) {
    const anchor = slot.anchor;
    let lane = anchor.lane, z = anchor.z + anchor.speed * (state.elapsed - anchor.elapsed) - (state.distance - anchor.distance);
    let heading = anchor.heading;
    if (anchor.entityId !== null && anchor.entityKind !== null) {
      const traffic = state.traffic;
      if (traffic) for (let i = 0; i < traffic.length; i++) {
        const item = traffic[i];
        if (item.id === anchor.entityId && item.kind === anchor.entityKind) {
          const liveLane = trafficLateral(item);
          if (Number.isFinite(liveLane) && Number.isFinite(item.z)) {
            lane = liveLane; z = item.z; heading = Number.isFinite(item.heading) ? item.heading : 0;
          }
          break;
        }
      }
    }
    if (anchor.entityKind !== null) {
      // Scalar equivalent of trafficPose: rotate around the measured rear axle,
      // then apply the captured nose/corner offset in the vehicle's local space.
      const rear = trafficDefinition(anchor.entityKind).rearAxleZ, axleZ = -z + rear;
      const roadYaw = -Math.atan((bend(axleZ - 1, state.distance) - bend(axleZ + 1, state.distance)) / 2);
      const c = Math.cos(heading), yaw = Math.atan2(Math.tan(roadYaw) * c - Math.sin(heading), c);
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      slot.mesh.position.set((lane - 1) * 3.5 + bend(axleZ, state.distance) - sy * rear + cy * anchor.offsetX + sy * anchor.offsetZ,
        anchor.height, axleZ - cy * rear - sy * anchor.offsetX + cy * anchor.offsetZ);
    } else {
      slot.mesh.position.set((lane - 1) * 3.5 + bend(-z, state.distance) + anchor.offsetX,
        anchor.height, -z + anchor.offsetZ);
    }
  }

  return {
    group,
    get activeCount() { return count; },
    sync,
    clear,
    /** Live accessibility changes apply immediately, even to a frozen paused cue. */
    setReducedMotion(value) {
      if (disposed || reducedMotion === Boolean(value)) return false;
      reducedMotion = Boolean(value);
      for (const slot of slots) {
        if (slot.active) slot.mesh.scale.setScalar(reducedMotion ? 1 : .88 + .2 * slot.age / DRIVING_BONUS_LIFETIME);
      }
      return count > 0;
    },
    /** Enqueue only accepted gameplay bonuses; callers suppress unsuccessful event-clear notifications. */
    emit(kind, anchor, state) {
      if (disposed || !ACCEPTED.has(kind)) return false;
      sync(state);
      if (suppressed || !Number.isFinite(state.distance) || !Number.isFinite(state.elapsed)) return false;
      // Validate into one fixed scratch anchor before disturbing a live cue.
      if (!copyAnchor(scratchAnchor, anchor)) return false;
      let slot = slots[0];
      for (let i = 0; i < slots.length; i++) {
        if (!slots[i].active) { slot = slots[i]; break; }
        if (slots[i].serial < slot.serial) slot = slots[i];
      }
      copyAnchor(slot.anchor, scratchAnchor);
      if (!slot.active) count++;
      slot.active = true; slot.age = 0; slot.serial = ++serial; slot.kind = kind;
      slot.mesh.visible = true; slot.mesh.scale.setScalar(reducedMotion ? 1 : .88);
      slot.material.uniforms.opacity.value = .82;
      place(slot, state);
      return true;
    },
    /** Pause freezes both source positions and visual age, even if a caller mutates its state. */
    update(state, dt = 0, paused = false) {
      if (disposed) return;
      sync(state, suppressed);
      if (suppressed || paused) return;
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]; if (!slot.active) continue;
        slot.age += step;
        if (slot.age >= DRIVING_BONUS_LIFETIME) {
          slot.active = false; slot.mesh.visible = false; slot.material.uniforms.opacity.value = 0; count--; continue;
        }
        const progress = slot.age / DRIVING_BONUS_LIFETIME;
        place(slot, state);
        slot.mesh.scale.setScalar(reducedMotion ? 1 : .88 + .2 * progress);
        slot.material.uniforms.opacity.value = .82 * (1 - progress) * (1 - progress);
      }
    },
    /** Release the only owned group, shared geometry and fixed materials exactly once. */
    dispose() {
      if (disposed) return;
      clear(); disposed = true; stateRef = null; group.removeFromParent();
      geometry.dispose();
      for (let i = 0; i < slots.length; i++) slots[i].material.dispose();
    },
  };
}
