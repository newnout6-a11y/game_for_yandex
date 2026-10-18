import { vehicleDefinition } from './progression-catalog.js';
import { PLAYER_WHEELBASE, PLAYER_REAR_OFFSET } from './player-motion.js';

// Actual exported axle-centre measurements, not visual wheelbase guesses.
const AXLES = Object.freeze({
  rocket: [PLAYER_WHEELBASE, PLAYER_REAR_OFFSET, 10],
  hatch: [2.5, 1.2200000286102295, 10],
  sedan: [2.819999933242798, 1.3899999856948853, 9.5],
  suv: [3, 1.4900000095367432, 8.2],
  van: [3.5700000524520874, 1.7400000095367432, 7.8],
});

/** Build a bounded simulation configuration from the owned catalog and already-earned research; no visual asset scaling. */
export function playerConfiguration(id = 'rocket', modifiers = {}) {
  const vehicle = vehicleDefinition(id) || vehicleDefinition('rocket'), axles = AXLES[vehicle.id] || AXLES.rocket;
  const bounded = (key, low, high) => Math.max(low, Math.min(high, Number.isFinite(modifiers[key]) ? modifiers[key] : 1));
  return Object.freeze({
    id: vehicle.id, flight: vehicle.flight, cockpit: vehicle.cockpit,
    bounds: Object.freeze({ length: vehicle.lengthM, width: vehicle.widthM, height: vehicle.heightM }),
    maxSpeed: vehicle.maxSpeedMps,
    acceleration: vehicle.accelerationMps2 * bounded('accelerationMultiplier', 1, 1.1),
    brakeDeceleration: vehicle.brakeDecelerationMps2 * bounded('brakeDecelerationMultiplier', 1, 1.15),
    steeringSlewMultiplier: vehicle.steeringSlewMultiplier * bounded('steeringSlewMultiplier', 1, 1.1),
    flightDrainMultiplier: vehicle.flight ? bounded('flightDrainMultiplier', .9, 1) : 1,
    wheelbase: axles[0], rearOffset: axles[1], maxLateralAcceleration: axles[2],
  });
}
