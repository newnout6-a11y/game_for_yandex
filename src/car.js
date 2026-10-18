import * as T from '../public/vendor/three.js';
const legacyGlass = new T.MeshPhysicalMaterial({ color:'#485963',metalness:.25,roughness:.12,transparent:true,opacity:.76,depthWrite:false });
const legacyRims = new T.MeshStandardMaterial({ color:'#737b80',metalness:1,roughness:.27 });
const legacyRubber = new T.MeshStandardMaterial({ color:'#191b1c',roughness:.94 });

/**
 * Clone and ground the authored player without discarding its material maps or rig.
 * The source stays untouched. Geometry/textures are shared; mutable paint, glazing
 * settings and brake lights are isolated per instance. Root metadata is expressed
 * in exported metres and is scaled with the final 4.7-metre game envelope.
 * @param {T.Object3D} template - Loaded positive-length glTF scene, front -Z and +Y up.
 * @param {T.ColorRepresentation|null} [color=null] - Optional body-only tint; null retains authored paint.
 * @returns {T.Group} Grounded car exposing wheel carriers/spinners, measured radii and yoke.
 * @throws {TypeError} If the source is absent or has no finite positive length.
 */
export function createCar(template, color = null) {
  if (!template?.isObject3D) throw new TypeError('A loaded car model is required');
  const car = new T.Group(), model = template.clone(true), paintBySource = new Map(), glassBySource = new Map(), brakeBySource = new Map();
  let metadata = {}, paint;
  const brakeMaterial = new T.MeshStandardMaterial({color:'#8e1712',emissive:'#dc2517',emissiveIntensity:.05,roughness:.35});
  model.traverse(node => {
    if (Number.isFinite(node.userData?.wheelRadius)) metadata = node.userData;
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    const source = node.material, materialName = source?.name || '';
    if (/^body(?:_|$)/.test(node.name) || /^body(?:_|$)/.test(materialName)) {
      if (!paintBySource.has(source)) {
        const material = materialName ? source.clone() : new T.MeshPhysicalMaterial({metalness:.65,roughness:.26,clearcoat:1,clearcoatRoughness:.12});
        if (color !== null) material.color.set(color);
        material.side = source?.side ?? T.FrontSide;
        paintBySource.set(source, material); paint ||= material;
      }
      node.material = paintBySource.get(source);
    }
    if (/^lights_red(?:_|$)/.test(node.name) || /^lights_red(?:_|$)/.test(materialName)) {
      if (!brakeBySource.has(source)) brakeBySource.set(source, materialName ? source.clone() : brakeMaterial);
      node.material = brakeBySource.get(source);
    }
    const isWindow = node.name === 'glass' || (/glass|glazing/i.test(materialName) && (source.transparent || source.opacity < 1));
    if (isWindow) {
      if (!glassBySource.has(source)) {
        const material = materialName ? source.clone() : legacyGlass.clone();
        material.transparent = true; material.depthWrite = false; material.forceSinglePass = true;
        glassBySource.set(source, material);
      }
      node.material = glassBySource.get(source); node.castShadow = false;
    }
    // Preserve new authored wheel finishes; these fallbacks only serve old unnamed assets.
    if (!materialName && /^rim_|^chrome$/.test(node.name)) node.material = legacyRims;
    if (!materialName && node.name === 'tire') node.material = legacyRubber;
  });
  // Rotated merged hardware can have a much larger transformed local AABB than
  // its actual vertices. Precise bounds prevent that empty space shrinking or
  // lifting the whole car during one-time asset normalization.
  const box = new T.Box3().setFromObject(model, true), size = box.getSize(new T.Vector3());
  if (!Number.isFinite(size.z) || size.z <= 0) throw new TypeError('Car model has no finite length');
  const scale = 4.7 / size.z; model.scale.multiplyScalar(scale);
  const scaled = new T.Box3().setFromObject(model, true), center = scaled.getCenter(new T.Vector3());
  model.position.x -= center.x; model.position.z -= center.z; model.position.y -= scaled.min.y;
  car.add(model); car.updateMatrixWorld(true);
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(name => model.getObjectByName(name)).filter(Boolean);
  const wheelRest = wheels.map(carrier => {
    const spinner = carrier.getObjectByName(carrier.name.replace('wheel_', 'wheel_spin_')) || carrier;
    carrier.rotation.order = 'YXZ'; spinner.rotation.order = 'YXZ';
    const wheelSize = new T.Box3().setFromObject(spinner, true).getSize(new T.Vector3());
    const measured = Math.max(wheelSize.y, wheelSize.z) / 2;
    const radius = Number.isFinite(metadata.wheelRadius) && metadata.wheelRadius > .05
      ? metadata.wheelRadius * scale : Number.isFinite(measured) && measured > .05 ? measured : .34;
    return { carrier, spinner, radius, front: /^wheel_f/.test(carrier.name) };
  });
  const bodyParent = wheels[0]?.parent || model;
  const bodyRig = new T.Group(); bodyRig.name = 'player_sprung_body';
  const sprung = bodyParent.children.filter(node => !wheels.includes(node));
  bodyParent.add(bodyRig); for (const node of sprung) bodyRig.add(node);
  const frontZ = wheelRest.filter(w => w.front).reduce((v,w) => v+w.carrier.position.z,0) / (wheelRest.filter(w => w.front).length || 1);
  const rearZ = wheelRest.filter(w => !w.front).reduce((v,w) => v+w.carrier.position.z,0) / (wheelRest.filter(w => !w.front).length || 1);
  const bodyPivot = new T.Vector3(0, .55, (frontZ+rearZ)/2);
  for (const rest of wheelRest) { rest.center = rest.carrier.position.clone(); rest.distance = 0; }
  const yoke = model.getObjectByName('steering_yoke');
  const aero = [], fans = [];
  model.traverse(node => {
    if (node.userData?.aeroRole) {
      const offset = node.userData.aeroStowPositionOffset;
      const axis = node.userData.aeroStowAxis;
      const start = node.userData.aeroDeployStart, end = node.userData.aeroDeployEnd;
      const validRange = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1 && end > start;
      aero.push({ node, role: node.userData.aeroRole, position: node.position.clone(), rotation: node.quaternion.clone(),
        start: validRange ? start : node.userData.aeroRole === 'tip' ? .4 : 0,
        end: validRange ? end : node.userData.aeroRole === 'tip' ? .85 : 1,
        offset: new T.Vector3(...(Array.isArray(offset) && offset.length === 3 && offset.every(Number.isFinite) ? offset : [0, 0, 0])),
        axis: new T.Vector3(...(Array.isArray(axis) && axis.length === 3 && axis.every(Number.isFinite) && Math.hypot(...axis) > .001 ? axis : [1, 0, 0])).normalize(),
        angle: Number.isFinite(node.userData.aeroStowAngle) ? node.userData.aeroStowAngle : 0 });
    }
    if (/^fan_[0-3]$/.test(node.name)) fans.push({ node, rotation: node.quaternion.clone() });
  });
  car.userData = {
    ...car.userData, wheels, wheelRest, bodyRig, bodyPivot, bodyPose: {pitch:0,roll:0,heave:0,limit:1}, bodyScratch: new T.Vector3(), bodyTravelLimit: .018, bodyEnvelopeHalfWidth: 1.30, bodyEnvelopeHalfLength: 1.9, bodyEnvelopeHalfHeight: .55, bodyScale: scale * bodyParent.scale.x, wheelbase: Math.abs(rearZ-frontZ)*scale*bodyParent.scale.x, wheelTravel: null, bodyWheels: wheelRest.map(rest => ({center: rest.center, radius: rest.radius/(scale * bodyParent.scale.x)})), glazing: [...glassBySource.values()].map(material => ({ material, opacity: material.opacity, envMapIntensity: material.envMapIntensity })), paint: paint || new T.MeshPhysicalMaterial({ color: color ?? '#b62018' }),
    paints: [...paintBySource.values()], wheelRadius: wheelRest[0]?.radius || .34,
    brakeMaterial: brakeBySource.values().next().value || brakeMaterial,
    brakeMaterials: [...brakeBySource.values()], yoke, yokeRest: yoke?.quaternion.clone(), yokeTurn: new T.Quaternion(),
    yokeAxis: new T.Vector3(0, 0, 1), variant: metadata.variant || metadata.roadsterVariant || 'reference-roadster',
    aero, fans, aeroDeployment: 0, fanPhase: 0, aeroTurn: new T.Quaternion(), fanAxis: new T.Vector3(0, 0, 1),
  };
  car.updateMatrixWorld(true);
  return car;
}

/**
 * Position the reconstructed telescopic wing without hiding or scaling geometry.
 * Authored parts start deployed. Lift stages move first; hinged tip fences only
 * unfold in their authored clearance interval, therefore fold before the blade
 * returns to its pocket. Legacy tip metadata defaults to 40–85% lift.
 * @param {T.Group} car - Instance prepared by createCar; no source mutation.
 * @param {number} deployment - Continuous 0=stowed through 1=deployed pose.
 * @returns {void} Updates annotated aero nodes and the instance pose value.
 */
export function setPlayerAeroPose(car, deployment) {
  const data = car.userData, amount = Math.max(0, Math.min(1, Number.isFinite(deployment) ? deployment : 0));
  data.aeroDeployment = amount;
  for (const part of data.aero) {
    const linear = Math.max(0, Math.min(1, (amount - part.start) / (part.end - part.start)));
    const t = linear * linear * (3 - 2 * linear);
    part.node.position.copy(part.position).addScaledVector(part.offset, 1 - t);
    part.node.quaternion.copy(part.rotation).multiply(data.aeroTurn.setFromAxisAngle(part.axis, part.angle * (1 - t)));
  }
}

/**
 * Animate reference-led aero and fan hardware from arcade driving state.
 * The flight wing stays raised through descent, then retracts smoothly after
 * confirmed ground contact. Speed, braking, boost and residual touchdown thrust
 * cannot keep it raised. Menu/reset returns it to its stowed pose immediately;
 * zero dt otherwise preserves a paused pose. These are requested game rules,
 * not Tesla's unpublished aero law or measured rotor RPM.
 * @param {T.Group} car - Prepared player with optional aero/fan pivots.
 * @param {object} state - Speed in m/s, altitude in metres, flying/rolling flags and thrust.
 * @param {number} dt - Nonnegative frame seconds; zero preserves a paused pose.
 * @returns {void} Applies mechanical transforms without spawning meshes or textures.
 */
export function animatePlayerHardware(car, state, dt) {
  const data = car.userData, step = Math.min(.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const speed = Number.isFinite(state.speed) ? Math.max(0, state.speed) : 0;
  const menu = state.phase === 'menu';
  const airborne = Number.isFinite(state.altitude) && state.altitude > 0;
  const target = !menu && (airborne || state.flying || state.rolling) ? 1 : 0;
  const deployment = menu ? 0 : data.aeroDeployment + Math.max(-step * 1.5, Math.min(step * 1.5, target - data.aeroDeployment));
  setPlayerAeroPose(car, deployment);
  const demand = menu ? 0 : Math.max(Math.min(1, speed / 45), Math.min(1, state.thrusterPower || 0));
  data.fanPhase = (data.fanPhase + step * demand * 23) % (Math.PI * 2);
  for (const fan of data.fans) fan.node.quaternion.copy(fan.rotation).multiply(data.aeroTurn.setFromAxisAngle(data.fanAxis, data.fanPhase));
}

/**
 * Animate authored wheel carriers, tire spinners and the cockpit yoke in place.
 * Positive distance is forward (-Z), requiring negative local-X tire rotation so
 * the contact patch rolls backward relative to the chassis. Separate carriers
 * keep calipers from spinning; YXZ also preserves steering on legacy wheel rigs.
 * @param {T.Group} car - Player prepared by createCar; source geometry is never changed.
 * @param {number} distance - Accumulated rear-axle travel in metres when curvature is supplied.
 * @param {number} steerAngle - Signed game steering angle in radians, positive right.
 * @param {boolean} [braking=false] - Intensify the authored rear lamp material.
 * @param {number|null} [curvature=null] - Rear-axle path curvature in inverse metres; null retains legacy steering.
 * @returns {void} Mutates only instance transforms and its isolated brake material.
 */
export function animatePlayerCar(car, distance, steerAngle, braking = false, curvature = null) {
  const steer = Number.isFinite(steerAngle) ? steerAngle : 0;
  const travel = Number.isFinite(distance) ? distance : 0;
  const data = car.userData;
  const k = Number.isFinite(curvature) ? curvature : null;
  const delta = data.wheelTravel === null || travel < data.wheelTravel ? 0 : travel - data.wheelTravel;
  for (const rest of data.wheelRest) {
    const lateral = rest.center.x * data.bodyScale;
    rest.carrier.rotation.y = rest.front ? (k === null ? -steer : -Math.atan(data.wheelbase*k/(1-lateral*k))) : 0;
    if (rest.spinner !== rest.carrier) rest.carrier.rotation.x = 0;
    if (k === null) rest.distance = travel;
    else if (data.wheelTravel === null || travel < data.wheelTravel) rest.distance = travel;
    else rest.distance += delta * Math.hypot(1-lateral*k, rest.front ? data.wheelbase*k : 0);
    rest.spinner.rotation.x = -(rest.distance / rest.radius) % (Math.PI * 2);
  }
  data.wheelTravel = travel;
  if (data.yoke) data.yoke.quaternion.copy(data.yokeRest).multiply(data.yokeTurn.setFromAxisAngle(data.yokeAxis, Math.max(-1.2, Math.min(1.2, -steer * 12))));
  for (const material of data.brakeMaterials.length ? data.brakeMaterials : [data.brakeMaterial]) material.emissiveIntensity = braking ? 2 : .55;
}

/**
 * Animate only sprung panels/cabin/hardware; tyre carriers remain on the road.
 * The authored-coordinate pivot is applied without changing the neutral rest pose.
 * @param {T.Group} car - Player instance from createCar.
 * @param {object} state - Simulation-owned bodyPitch/bodyRoll radians and bodyHeave metres.
 * @returns {object} Current owned bounded body motion.
 */
export function animatePlayerBody(car, state) {
  const d = car.userData;
  const finite = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  let pitch = finite(state.bodyPitch), roll = finite(state.bodyRoll), heave = finite(state.bodyHeave);
  // |sin(a)| <= |a| and 1-cos(p)cos(r) <= (p²+r²)/2 give a
  // conservative bound that remains valid after scaling, even for invalid poses.
  const travel = Math.abs(heave) + Math.abs(pitch)*d.bodyEnvelopeHalfLength + Math.abs(roll)*d.bodyEnvelopeHalfWidth + .5*(pitch*pitch+roll*roll)*d.bodyEnvelopeHalfHeight;
  const limit = travel > d.bodyTravelLimit ? d.bodyTravelLimit/travel : 1;
  pitch *= limit; roll *= limit; heave *= limit;
  d.bodyRig.rotation.set(pitch, 0, roll, 'XYZ');
  d.bodyScratch.copy(d.bodyPivot).applyEuler(d.bodyRig.rotation);
  d.bodyRig.position.copy(d.bodyPivot).sub(d.bodyScratch);
  d.bodyRig.position.y += heave / d.bodyScale;
  Object.assign(d.bodyPose, {pitch,roll,heave,limit});
  return d.bodyPose;
}

/** Restore the player's independent body and wheel clocks at a new-run boundary. */
export function resetPlayerMotion(car) {
  car.userData.wheelTravel = null;
  animatePlayerBody(car, { phase: 'ready' }, 0);
}

/**
 * Use a restrained instance-only cabin glazing preset, restoring exact exterior
 * values outside. This is a visibility approximation, not physical refraction.
 * @param {T.Group} car - Prepared player; template materials remain untouched.
 * @param {boolean} inside - Whether the effective camera is inside the cabin.
 * @returns {void} Changes two uniforms only; no hidden geometry or new pass.
 */
export function setPlayerInteriorView(car, inside) {
  for (const entry of car.userData.glazing || []) {
    entry.material.opacity = inside ? Math.min(.10, entry.opacity) : entry.opacity;
    entry.material.envMapIntensity = inside ? Math.min(.15, entry.envMapIntensity) : entry.envMapIntensity;
  }
}
