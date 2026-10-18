import { pathToFileURL } from 'node:url';
import { integratePlayerArc, updatePlayerPath, PLAYER_WHEELBASE, PLAYER_REAR_OFFSET } from '../src/player-motion.js';
import { thumbControlsFromOffset } from '../src/thumb-drive.js';
import { Game } from '../src/game.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
/** Frozen accepted cffae42 controller, retained only to make the before/after reproducible. */
export function acceptedPlayerPath(state, steering, dt) {
  let remaining = Math.min(dt, .1), travelled = 0;
  while (remaining > 1e-9) {
    const step = Math.min(remaining, 1 / 120), speed = state.speed;
    const targetHeading = steering * .201 / (1 + Math.max(0, speed - 30) * .012);
    const maxCurvature = Math.min(Math.tan(.3) / PLAYER_WHEELBASE, 10 / Math.max(1, speed * speed));
    const wantedCurvature = speed > .15 ? (targetHeading - (state.heading || 0)) * 5 / speed : steering * maxCurvature;
    const targetAngle = Math.atan(clamp(wantedCurvature, -maxCurvature, maxCurvature) * PLAYER_WHEELBASE);
    const rate = 1.25 / (1 + speed / 25), oldAngle = state.steerAngle || 0;
    state.steerAngle = clamp(oldAngle + clamp(targetAngle - oldAngle, -rate * step, rate * step),
      -Math.atan(maxCurvature * PLAYER_WHEELBASE), Math.atan(maxCurvature * PLAYER_WHEELBASE));
    state.curvature = Math.tan(state.steerAngle) / PLAYER_WHEELBASE;
    const arc = integratePlayerArc(state.heading || 0, speed, state.curvature, step, PLAYER_REAR_OFFSET);
    state.x += arc.x / 3.5; state.heading = arc.heading; state.yawRate = arc.yawRate;
    state.lateralAcceleration = speed * arc.yawRate;
    travelled += arc.forward; remaining -= step;
  }
  return travelled;
}

/** Keep an unobstructed measurement road centred without changing heading or wheel dynamics. */
function rig(step, speed, hz) {
  const state = { x: 1, speed, heading: 0, steerAngle: 0 };
  let time = 0, sideways = 0, forward = 0, maximumAcceleration = 0;
  return {
    state,
    sample(input) {
      const previousX = sideways;
      forward += step(state, input, 1 / hz);
      sideways += (state.x - 1) * 3.5; state.x = 1; time += 1 / hz;
      maximumAcceleration = Math.max(maximumAcceleration, Math.abs(state.lateralAcceleration));
      return { time, sideways, forward, dx: sideways - previousX, maximumAcceleration };
    },
  };
}

/** Quantify a 0.4 s correction, its release/reversal, and one continuous 3.5 m lane traversal. */
export function measurePlayerHandling(step = updatePlayerPath, speed = 28, hz = 120) {
  const turning = rig(step, speed, hz);
  let initialMovement = null, atRelease;
  for (let frame = 0; frame < Math.round(.4 * hz); frame++) {
    atRelease = turning.sample(1);
    if (initialMovement === null && atRelease.sideways >= .1) initialMovement = atRelease.time;
  }
  const releaseHeading = turning.state.heading;
  let settledAfter = 0, afterRelease;
  for (let frame = 0; frame < 3 * hz; frame++) {
    afterRelease = turning.sample(0);
    if (Math.abs(turning.state.heading) >= .005) settledAfter = (frame + 1) / hz;
  }
  const reversing = rig(step, speed, hz);
  for (let frame = 0; frame < Math.round(.4 * hz); frame++) reversing.sample(1);
  let reverseAfter = null;
  for (let frame = 0; frame < hz; frame++) {
    const sample = reversing.sample(-1);
    if (reverseAfter === null && sample.dx < 0) reverseAfter = (frame + 1) / hz;
  }
  const lane = rig(step, speed, hz);
  let laneSeconds = null;
  for (let frame = 0; frame < 10 * hz; frame++) {
    const sample = lane.sample(1);
    if (sample.sideways >= 3.5) { laneSeconds = sample.time; break; }
  }
  const steady = rig(step, speed, hz);
  let last;
  for (let frame = 0; frame < 4 * hz; frame++) last = steady.sample(1);
  return {
    speedMps: speed, hz, initialMovementSeconds: initialMovement, laneSeconds, releaseHeadingRadians: releaseHeading,
    releaseDriftMetres: afterRelease.sideways - atRelease.sideways, settledAfterSeconds: settledAfter,
    reverseAfterSeconds: reverseAfter, steadyLateralMps: last.dx * hz,
    maximumLateralAcceleration: Math.max(last.maximumAcceleration, afterRelease.maximumAcceleration),
    finalHeading: turning.state.heading,
  };
}

/** Exercise unchanged real braking and coast physics, rather than inventing a separate model. */
export function measureBraking(speed = 28, hz = 120, brake = 1) {
  const game = new Game({ random: () => .5 }); game.start();
  Object.assign(game.state, { speed, traffic: [], pickups: [], obstacles: [], nextSpawn: Infinity, nextEvent: Infinity });
  let seconds = 0;
  while (game.state.speed > .01 && seconds < 15) { game.update(1 / hz, { brake }); seconds += 1 / hz; }
  return { speedMps: speed, brake, hz, seconds, distanceMetres: game.state.distance, finalSpeedMps: game.state.speed };
}

export function handlingReport() {
  return {
    description: 'Arcade engineering measurements, not factory specifications or a reproduction of Traffic Racer source physics.',
    response: [30, 60, 120].flatMap(hz => [8, 18, 28, 40, 52, 65].map(speed => ({
      accepted: measurePlayerHandling(acceptedPlayerPath, speed, hz), current: measurePlayerHandling(updatePlayerPath, speed, hz),
    }))),
    braking: [30, 60, 120].flatMap(hz => [18, 28, 52].map(speed => measureBraking(speed, hz))),
    thumb: [0, 2.7, 5, 10, 20, 30, 46.08].map(dx => ({ dx, ...thumbControlsFromOffset({ dx }) })),
    pedals: [0, 5, 7.8, 12, 17.1, 18, 19, 24, 32.76].map(dy => ({ dy, ...thumbControlsFromOffset({ dy }) })),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(handlingReport(), null, 2));
