import * as T from '../public/vendor/three.js';

// A real seated eye needs this field of view to include the authored tablet to
// its right. Portrait limits vertical FOV instead of moving the driver outside
// the seat or using an extreme fisheye to force every dashboard part onscreen.
export const COCKPIT_HORIZONTAL_FOV = 96;
export const COCKPIT_MAX_VERTICAL_FOV = 85;
export const COCKPIT_NEAR = .03;
export const COCKPIT_LOOK_DOWN = 4 * Math.PI / 180;
export const COCKPIT_RETURN_DELAY = .2;
export const COCKPIT_UPRIGHT_LIMIT = .12;
export const COCKPIT_GLANCE_YAW = .75;
const DEFAULT_OPTIONS = Object.freeze({});

/** Normalize persisted/user-facing camera selection, retaining chase by default. */
export function normalizeCameraMode(raw) {
  return raw === 'cockpit' ? 'cockpit' : 'chase';
}

/** Convert the horizontal cockpit lens to Three.js vertical degrees, bounded on phones. */
export function cockpitVerticalFov(aspect) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return Math.min(COCKPIT_MAX_VERTICAL_FOV,
    2 * Math.atan(Math.tan(COCKPIT_HORIZONTAL_FOV * Math.PI / 360) / ratio) * 180 / Math.PI);
}

/**
 * Resolve the authored seated eye in the same coordinates as the sprung cabin.
 * No scene nodes, materials, meshes or source metadata are changed. Positions
 * remain body-local so normalization, heading, flight and suspension all apply
 * exactly once. Scratch values are allocated here, never in the frame update.
 * @param {T.Object3D} player - The createCar player with driverDisplay metadata.
 * @returns {object} A reusable camera rig, including its .2-second roll return gate.
 */
export function createCockpitView(player) {
  if (!player?.isObject3D) throw new TypeError('A prepared player car is required');
  let authored;
  player.traverse(node => {
    const eye = node.userData?.driverDisplay?.reference_eye_game_m;
    if (!authored && Array.isArray(eye) && eye.length === 3 && eye.every(Number.isFinite)) authored = node;
  });
  if (!authored) throw new TypeError('The player has no authored driver-eye position');
  const frame = player.userData.bodyRig || authored;
  return {
    player, frame, eyeLocal: new T.Vector3(...authored.userData.driverDisplay.reference_eye_game_m),
    forwardLocal: new T.Vector3(0, -Math.sin(COCKPIT_LOOK_DOWN), -Math.cos(COCKPIT_LOOK_DOWN)),
    eyeWorld: new T.Vector3(), forwardWorld: new T.Vector3(), target: new T.Vector3(),
    returnDelay: 0, gazeAxis: new T.Vector3(0,1,0),
  };
}

/**
 * Keep barrel rolls in external chase through a short upright recovery interval.
 * Selection is separate: the renderer combines this with mode === 'cockpit'.
 * Pass the reusable rig and elapsed simulation time for hysteresis; zero dt
 * preserves a paused recovery. Menu/ready resets cannot inherit a flight delay.
 * Raw roll angle is intentional: 2π is the last roll frame, not early recovery.
 * @param {object} state - Simulation state; a missing roll angle means upright.
 * @param {boolean} [menu=false] - Decorative/menu rendering always uses chase.
 * @param {object|null} [rig=null] - Optional rig returned by createCockpitView.
 * @param {number} [dt=0] - Seconds advancing recovery; paused callers supply zero.
 * @returns {boolean} Whether first person is comfortable and safe this frame.
 */
export function shouldUseCockpit(state, menu = false, rig = null, dt = 0) {
  if (menu || state?.phase === 'menu') {
    if (rig) rig.returnDelay = 0;
    return false;
  }
  const angle = state?.rollAngle ?? 0;
  const rolling = Boolean(state?.rolling) || !Number.isFinite(angle) || Math.abs(angle) > COCKPIT_UPRIGHT_LIMIT;
  if (rolling) {
    if (rig) rig.returnDelay = COCKPIT_RETURN_DELAY;
    return false;
  }
  if (!rig) return true;
  if (state?.phase === 'ready') rig.returnDelay = 0;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, .1) : 0;
  rig.returnDelay = Math.max(0, rig.returnDelay - step);
  // Avoid one extra recovery frame due solely to 0.2 - 12 * (1/60) rounding.
  if (rig.returnDelay < 1e-9) rig.returnDelay = 0;
  return rig.returnDelay === 0;
}

/**
 * Put the actual camera at the actual driver eye, without chase lag or shake.
 * The complete body transform supplies position, including full flight altitude.
 * A world-up look preserves a level horizon; reduced motion also omits the tiny
 * sprung pitch from the gaze, but never disconnects the eye from the cabin.
 * No speed-FOV pumping or camera-position interpolation can clip the interior
 * after a mode change, resize or reset. The caller renders chase when this
 * function returns false, and owns the near/FOV restoration for that view.
 * @param {T.PerspectiveCamera} camera - Scene camera, outside the car hierarchy.
 * @param {object} rig - The reusable driver-eye rig.
 * @param {object} state - Current state, used to refuse unsafe inverted views.
 * @param {object} [options] - Aspect, reducedMotion and bounded local lookYaw radians. The eye remains seated.
 * @returns {boolean} True when cockpit pose was applied; false during menu/roll.
 */
export function updateCockpitCamera(camera, rig, state, options = DEFAULT_OPTIONS) {
  if (!shouldUseCockpit(state) || rig.returnDelay > 0) return false;
  const aspect = Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect
    : Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  const fov = cockpitVerticalFov(aspect);
  if (camera.fov !== fov || camera.near !== COCKPIT_NEAR || camera.aspect !== aspect) {
    camera.fov = fov; camera.near = COCKPIT_NEAR; camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  rig.frame.updateWorldMatrix(true, false);
  rig.eyeWorld.copy(rig.eyeLocal).applyMatrix4(rig.frame.matrixWorld);
  const gazeFrame = options.reducedMotion ? rig.player : rig.frame;
  const yaw = Number.isFinite(options.lookYaw) ? Math.max(-COCKPIT_GLANCE_YAW,Math.min(COCKPIT_GLANCE_YAW,options.lookYaw)) : 0;
  rig.forwardWorld.copy(rig.forwardLocal).applyAxisAngle(rig.gazeAxis,yaw).transformDirection(gazeFrame.matrixWorld);
  rig.target.copy(rig.eyeWorld).add(rig.forwardWorld);
  camera.position.copy(rig.eyeWorld);
  camera.up.set(0, 1, 0);
  camera.lookAt(rig.target);
  camera.updateMatrixWorld();
  return true;
}
