import * as T from '../public/vendor/three.js';
const UP=new T.Vector3(0,1,0),
/**
 * Constrains a gesture, steering angle or IK distance to inclusive scalar bounds.
 * @param {number} x - Requested scalar value.
 * @param {number} a - Lower bound in matching units.
 * @param {number} b - Upper bound, at least a.
 * @returns {number} Bounded value; no rig state is changed.
 */
clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const INDICATOR_TOUCH_TIME=.18;
/**
 * Produces a cubic gesture envelope with zero slope at both endpoints.
 * @param {number} x - Normalized progress, clamped to [0, 1].
 * @returns {number} Smooth progress in [0, 1], without changing rig state.
 */
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
/**
 * Shapes the left-hand reach to the indicator stalk, hold and return to the grip.
 * The reach lasts 0.75 s for either signal direction and is zero outside the window.
 * @param {number} signal - Nonzero indicator direction; zero disables the gesture.
 * @param {number} time - Seconds since signalling began.
 * @returns {number} Grip-to-stalk interpolation weight in [0, 1].
 */
export function stalkGesture(signal,time){
 if(!signal||time<0||time>=.75)return 0;
 return time<.18?smooth(time/.18):time<.40?1:1-smooth((time-.40)/.35);
}
/**
 * Computes a brief mirror-check head yaw during the first 0.9 s of signalling.
 * @param {number} signal - -1 for left and +1 for right; zero disables the glance.
 * @param {number} time - Seconds since signalling began.
 * @returns {number} Local head yaw in radians, opposite the lane-direction sign
 * and bounded to a magnitude of 0.32; zero outside the gesture window.
 */
export function mirrorGlance(signal,time){
 if(!signal||time<0||time>=.9)return 0;
 const amount=time<.16?smooth(time/.16):time<.45?1:1-smooth((time-.45)/.45);
 return -Math.sign(signal)*.32*amount;
}
/**
 * Finds authored driver joints and caches bind poses, arm lengths and IK scratch.
 * Stores the rig on car.userData.driver; elbow bend poles are body-local, while
 * hand offsets preserve each authored grip orientation. Models without a steering
 * wheel are allowed, but a partial two-arm rig is rejected.
 * @param {T.Object3D} car - Prepared vehicle with userData.bodyRig and named joints.
 * @returns {?Object} Cached mutable driver rig, or null when no wheel exists.
 * @throws {Error} If a steering-wheel model lacks a required arm/grip joint.
 */
export function prepareDriverRig(car){
 const wheel=car.getObjectByName('steering_wheel'),body=car.userData.bodyRig;
 if(!wheel)return null;
 const arms=[];car.updateMatrixWorld(true);
 for(const side of ['l','r']){
  const shoulder=car.getObjectByName('driver_shoulder_'+side),elbow=car.getObjectByName('driver_elbow_'+side),hand=car.getObjectByName('driver_hand_'+side),grip=car.getObjectByName('grip_'+side);
  if(!shoulder||!elbow||!hand||!grip)throw new Error('Incomplete Blender driver rig: '+car.userData.kind+'/'+side);
  const pole=body.worldToLocal(elbow.getWorldPosition(new T.Vector3()));
  const gripQ=grip.getWorldQuaternion(new T.Quaternion()),handQ=hand.getWorldQuaternion(new T.Quaternion());
  arms.push({side,shoulder,elbow,hand,grip,pole,upper:elbow.position.length(),lower:hand.position.length(),handOffset:gripQ.invert().multiply(handQ)});
 }
 const head=car.getObjectByName('driver_head');
 const rig={head,headRest:head?.quaternion.clone(),headYaw:0,headPitch:0,wheel,body,arms,stalk:car.getObjectByName('indicator_stalk'),rest:wheel.quaternion.clone(),turn:new T.Quaternion(),axis:new T.Vector3(0,0,1),point:new T.Vector3(),shoulder:new T.Vector3(),elbow:new T.Vector3(),end:new T.Vector3(),pole:new T.Vector3(),direction:new T.Vector3(),bend:new T.Vector3(),local:new T.Vector3(),q:new T.Quaternion(),q2:new T.Quaternion(),maxGripError:0};
 car.userData.driver=rig;return rig;
}
/**
 * Rotates a joint's local +Y bone axis toward a world-space target.
 * Converts direction through the parent's inverse world rotation and refreshes
 * descendant matrices; rig scratch vectors/quaternions are overwritten.
 * @param {T.Object3D} joint - Parented joint to rotate in place.
 * @param {T.Vector3} target - World-space aim position in scene metres.
 * @param {Object} rig - Driver scratch storage from prepareDriverRig.
 * @returns {void}
 */
function aimJoint(joint,target,rig){
 joint.getWorldPosition(rig.point);rig.local.copy(target).sub(rig.point).normalize();
 joint.parent.getWorldQuaternion(rig.q).invert();rig.local.applyQuaternion(rig.q);
 joint.quaternion.setFromUnitVectors(UP,rig.local);joint.updateMatrixWorld(true);
}
/**
 * Updates wheel, mirror glance, acceleration nod and two-bone arm IK in place.
 * The left hand briefly reaches for the stalk; otherwise hands follow authored
 * grips. Reach is clamped to arm lengths and maximum reach error is recorded.
 * Does nothing when the car has no driver rig; simulation motion is read-only.
 * @param {T.Object3D} car - Vehicle prepared by prepareDriverRig.
 * @param {Object} item - Traffic state with signal, signalTime (s) and acceleration.
 * @param {number} roadWheelAngle - Signed front-wheel steering angle in radians;
 * steering ratio converts it to a cockpit-wheel angle clamped to +/-1.2 rad.
 * @param {number} [dt=1/60] - Elapsed seconds for head-pose damping.
 * @returns {void}
 */
export function animateTrafficDriver(car,item,roadWheelAngle,dt=1/60){
 const r=car.userData.driver;if(!r)return;
 const ratio=car.userData.category==='passenger'?14:18;
 const angle=clamp(roadWheelAngle*ratio,-1.2,1.2);
 r.wheel.quaternion.copy(r.rest).multiply(r.turn.setFromAxisAngle(r.axis,angle));
 if(r.head){
  const blend=1-Math.exp(-12*Math.max(0,dt));
  r.headYaw+=(mirrorGlance(item.signal,item.signalTime||0)-r.headYaw)*blend;
  r.headPitch+=(clamp((item.acceleration||0)*.008,-.045,.025)-r.headPitch)*blend;
  r.q.setFromAxisAngle(UP,r.headYaw);r.local.set(1,0,0);r.q2.setFromAxisAngle(r.local,r.headPitch);
  r.head.quaternion.copy(r.headRest).multiply(r.q).multiply(r.q2);
  r.head.userData.glance=r.headYaw;r.head.userData.nod=r.headPitch;
 }
 car.updateMatrixWorld(true);r.maxGripError=0;
 for(const arm of r.arms){
  arm.shoulder.getWorldPosition(r.shoulder);arm.grip.getWorldPosition(r.end);
  const gesture=arm.side==='l'&&r.stalk?stalkGesture(item.signal,item.signalTime||0):0;
  if(gesture){r.stalk.getWorldPosition(r.point);r.end.lerp(r.point,gesture);}
  r.direction.copy(r.end).sub(r.shoulder);const wanted=r.direction.length();
  const distance=clamp(wanted,Math.abs(arm.upper-arm.lower)+.0001,arm.upper+arm.lower-.0001);r.direction.normalize();
  r.body.localToWorld(r.pole.copy(arm.pole));r.bend.copy(r.pole).sub(r.shoulder);r.bend.addScaledVector(r.direction,-r.bend.dot(r.direction));
  if(r.bend.lengthSq()<1e-8)r.bend.set(0,-1,0).addScaledVector(r.direction,r.direction.y);
  r.bend.normalize();const along=(arm.upper*arm.upper-arm.lower*arm.lower+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,arm.upper*arm.upper-along*along));
  r.elbow.copy(r.shoulder).addScaledVector(r.direction,along).addScaledVector(r.bend,height);
  r.end.copy(r.shoulder).addScaledVector(r.direction,distance);
  aimJoint(arm.shoulder,r.elbow,r);aimJoint(arm.elbow,r.end,r);
  arm.grip.getWorldQuaternion(r.q);r.q.multiply(arm.handOffset);arm.hand.parent.getWorldQuaternion(r.q2).invert();arm.hand.quaternion.copy(r.q2.multiply(r.q));arm.hand.updateMatrixWorld(true);
  r.maxGripError=Math.max(r.maxGripError,Math.abs(wanted-distance));
 }
 r.wheel.userData.angle=angle;r.wheel.userData.stalkGesture=stalkGesture(item.signal,item.signalTime||0);
}
