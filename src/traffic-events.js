import { playerBoundsFor } from './player-spec.js';
import { trafficDefinition } from './traffic-catalog.js';
import { occupiedTrafficLanes } from './traffic-behavior.js';
import { trafficDriverProfile, TRAFFIC_DRIVER_LIMITS } from './traffic-policy.js';

/**
 * Test a new static roadwork layout before it exists. Existing drivers must be
 * able to stop for every approaching cone/barrier after their reaction reserve;
 * a roadwork cannot appear inside a car or depend on an immediate lane change.
 * Cars wholly beyond a new obstacle are unaffected. Distances are metres, speed
 * m/s, reaction seconds and maximum braking m/s². This does not mutate state.
 * @param {Object} state - Current traffic with fixed-width lane reservations.
 * @param {number} lane - Proposed closed outer lane, 0 or 2.
 * @returns {boolean} Whether this exact default roadwork layout is feasible.
 */
export function canPlaceRoadworks(state,lane){
  // A road event cannot revoke the finite passage already promised by demand.
  // Include the player's half-length at either end, not just the wave centre.
  const corridor=state.safeCorridor,half=playerBoundsFor(state).length/2;
  if(corridor?.lane===lane&&Number.isFinite(corridor.z)&&Number.isFinite(corridor.halfLength)
    &&corridor.z+corridor.halfLength+half>=149.4&&corridor.z-corridor.halfLength-half<=213.6)return false;
  const hazards=[...Array.from({length:8},(_,i)=>({z:150+i*9,depth:.6})),{z:174,depth:2},{z:204,depth:2}];
  for(const car of state.traffic||[]){
    if(!occupiedTrafficLanes(car).includes(lane))continue;
    const spec=trafficDefinition(car.kind),driver=trafficDriverProfile(car);
    const speed=Math.max(0,Number.isFinite(car.speed)?car.speed:0),braking=TRAFFIC_DRIVER_LIMITS[spec.category].braking;
    const stop=driver.minimumGap+speed*(driver.reaction+1/120)+speed*speed/(2*braking)+.5;
    for(const obstacle of hazards){
      if(car.z-spec.length/2>obstacle.z+obstacle.depth+.5)continue;
      const gap=obstacle.z-car.z-spec.length/2-obstacle.depth;
      if(gap<stop)return false;
    }
  }
  return true;
}
