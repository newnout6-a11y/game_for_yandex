import { trafficDefinition } from './traffic-catalog.js';
import { trafficLateral } from './traffic-behavior.js';

/** Copy presentation coordinates while the simulation source still exists. No rewards live here. */
export function placeBonusAnchor(state, lane, z, height = 1.5) {
  return Object.freeze({lane,z,height,distance:state.distance+(state.sceneTravel||0),elapsed:state.elapsed,speed:0});
}

/** The source car's near front corner remains meaningful even for a long articulated vehicle. */
export function trafficBonusAnchor(state, car) {
  const spec=trafficDefinition(car.kind),lane=trafficLateral(car);
  // Keep the pulse beside the front fender, not detached above the roof.
  return Object.freeze({...placeBonusAnchor(state,lane,car.z,Math.min(spec.height*.55+.12,1.65)),
    entityId:car.id,entityKind:spec.id,speed:car.speed,heading:car.heading||0,...(car.impactActive&&Number.isFinite(car.impactYaw)?{impactYaw:car.impactYaw}:{}),
    offsetX:(state.x>=lane?1:-1)*(spec.width/2+.15),offsetZ:-spec.length/2});
}

/** Resolve a completed event's actual vehicle or road location before the event is removed. */
export function eventBonusAnchor(state, event, lastConvoyPass) {
  if(event.type==='convoy')return lastConvoyPass?.eventId===event.id?lastConvoyPass.anchor:null;
  return placeBonusAnchor(state,event.type==='roadworks'?state.x:event.lane,(event.type==='roadworks'?event.end:event.at)-state.distance-((state.sceneTravel||0)-(event.sceneTravelStart||0)),1.8);
}
