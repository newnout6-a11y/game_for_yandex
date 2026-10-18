import { clamp } from './util.js';

// Arcade flight assistance, not manufacturer flight-control specifications.
export const FLIGHT = Object.freeze({
  maxAltitude: 3.3, minimumSpeed: 12, drain: 14,
  rollMinAltitude: 2.6, rollCost: 8, rollDuration: 1.15, rollCooldown: 2,
  landingCooldown: 2, landingReserveCost: 2.5, landingReserveTime: 3.2,
});

/**
 * Creates independent, grounded flight/roll state with all timers and effects off.
 * Merge these fields into a run that also supplies speed (m/s) and nitro (0..100).
 * @returns {Object} Fresh mutable flight state; altitude is metres, angular fields
 * are radians or rad/s, and cooldown/reserve durations are seconds.
 */
export function createFlightState() {
  return {
    flying: false, altitude: 0, verticalSpeed: 0, flightReady: false,
    flightCooldown: 0, landing: false, landingReserve: 0, thrusterPower: 0, touchdownPulse: 0,
    rolling: false, rollAngle: 0, rollAngularSpeed: 0, rollProgress: 0,
    rollDirection: 0, rollReady: false, rollCooldown: 0, rollInput: 0,
  };
}

/**
 * Advances arcade lift, reserved landing assistance and edge-triggered barrel rolls.
 * Mutates flight fields and the shared nitro reserve. Upward altitude/speed are
 * positive; roll sign follows controls.roll. A paid roll finishes upright even
 * if lift input ends. Altitude stays within [0, maxAltitude], with land/roll
 * notifications emitted synchronously on their respective transitions.
 * @param {Object} s - Mutable run with createFlightState fields, speed and nitro.
 * @param {number} dt - Positive fixed simulation interval in seconds.
 * @param {Object} controls - Flight flag, brake input and signed roll input.
 * @param {Function} [onEvent] - Receives 'roll' at initiation and 'land' at touchdown.
 * @returns {void}
 */
export function updateFlight(s, dt, controls, onEvent = () => {}) {
  const previousAltitude = s.altitude || 0;
  s.flightCooldown = Math.max(0, (s.flightCooldown || 0) - dt);
  s.rollCooldown = Math.max(0, (s.rollCooldown || 0) - dt);
  s.touchdownPulse = Math.max(0, (s.touchdownPulse || 0) - dt * 2.8);
  const fuelRequired = previousAltitude > 0 ? .0001 : FLIGHT.landingReserveCost;
  s.flightReady = s.flightAllowed !== false && s.speed >= FLIGHT.minimumSpeed && s.nitro >= fuelRequired && s.flightCooldown <= 0;
  s.flying = Boolean(controls.flight && !controls.brake && s.flightReady);
  if (s.flying && previousAltitude === 0) {
    s.nitro = Math.max(0, s.nitro - FLIGHT.landingReserveCost);
    s.landingReserve = FLIGHT.landingReserveTime;
  }
  s.rollReady = s.flying && previousAltitude >= FLIGHT.rollMinAltitude && s.nitro >= FLIGHT.rollCost
    && !s.rolling && s.rollCooldown <= 0;

  const rollInput = Math.sign(controls.roll || 0);
  const rollEdge = rollInput !== 0 && rollInput !== s.rollInput;
  s.rollInput = rollInput;
  if (rollEdge && s.rollReady) {
    s.nitro -= FLIGHT.rollCost;
    s.rolling = true; s.rollDirection = rollInput; s.rollProgress = 0;
    s.rollReady = false;
    onEvent('roll');
  }
  if (s.flying) {
    s.nitro = Math.max(0, s.nitro - FLIGHT.drain * Math.max(.9,Math.min(1,Number.isFinite(s.flightDrainMultiplier)?s.flightDrainMultiplier:1)) * dt);
    if (s.nitro === 0) s.flying = false;
  }

  if (s.rolling) {
    const u = s.rollProgress = Math.min(1, s.rollProgress + dt / FLIGHT.rollDuration);
    // Quintic ease has zero angular speed and acceleration at both ends.
    const eased = u * u * u * (10 + u * (-15 + 6 * u));
    s.rollAngle = s.rollDirection * Math.PI * 2 * eased;
    s.rollAngularSpeed = s.rollDirection * Math.PI * 2 * 30 * u * u * (1 - u) * (1 - u) / FLIGHT.rollDuration;
    if (u >= 1) {
      s.rolling = false; s.rollAngle = 0; s.rollAngularSpeed = 0;
      s.rollCooldown = FLIGHT.rollCooldown;
    }
  }

  // A paid roll reserves enough stabilization to finish upright before descending.
  // Vertical landing assistance remains available after the shared boost reserve
  // is exhausted; it cannot lift the car or initiate another roll.
  const supported = s.flying || s.rolling;
  const assistedLanding = previousAltitude > 0 && (s.landingReserve || 0) > 0;
  if (!supported && previousAltitude > 0) s.landingReserve = Math.max(0, (s.landingReserve || 0) - dt);
  const targetSpeed = supported
    ? Math.min(2.6, Math.sqrt(Math.max(0, 18 * (FLIGHT.maxAltitude - previousAltitude))))
    : assistedLanding ? -Math.min(2.2, Math.max(.22, previousAltitude * 2.6)) : -30;
  const maxAcceleration = supported ? 14 : assistedLanding ? 8 : 9.8;
  s.verticalSpeed = (s.verticalSpeed || 0) + clamp(targetSpeed - (s.verticalSpeed || 0), -maxAcceleration * dt, maxAcceleration * dt);
  s.altitude = clamp(previousAltitude + s.verticalSpeed * dt, 0, FLIGHT.maxAltitude);
  if (s.altitude >= FLIGHT.maxAltitude && s.verticalSpeed > 0) s.verticalSpeed = 0;
  if ((!supported && s.altitude < .015 && s.verticalSpeed <= 0) || (!previousAltitude && !supported)) {
    s.altitude = 0; s.verticalSpeed = 0;
  }
  s.landing = s.altitude > 0 && !supported;
  if (previousAltitude > 0 && s.altitude === 0) {
    s.flightCooldown = FLIGHT.landingCooldown; s.flightReady = false;
    s.touchdownPulse = assistedLanding ? 1 : 0; s.landingReserve = 0;
    s.rollAngle = 0; s.rollAngularSpeed = 0;
    onEvent('land');
  }

  // Lower output in the fall, stronger ground-effect braking close to touchdown.
  // Never gate visible propulsion on the ascent/hover Boolean alone.
  const landingPower = .38 + .50 * (1 - clamp(s.altitude / 1.3, 0, 1));
  const targetPower = supported ? (s.rolling ? .62 : s.verticalSpeed > .15 ? .93 : .63)
    : s.landing ? (assistedLanding ? landingPower : 0) : s.touchdownPulse * .65;
  const response = 1 - Math.exp(-dt * 15);
  s.thrusterPower += (targetPower - s.thrusterPower) * response;
  if (s.thrusterPower < .001 && targetPower === 0) s.thrusterPower = 0;
  if (s.altitude === 0 || s.rolling) s.rollReady = false;
}
