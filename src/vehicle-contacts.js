import { sweepOBB, resolveContactImpulse } from './contact-physics.js';
import { trafficDefinition } from './traffic-catalog.js';
import { ROCKET_CONTACT_SHAPE } from './player-contact-shape.js';
import { playerBoundsFor } from './player-spec.js';
import { trafficPose, trafficCollisionParts, trafficHitch, roadYaw, roadCurve, LANE_WIDTH } from './traffic-physics.js';

const finite=(v,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Each 120Hz roll step is far below PI; unwrap its upright 2PI→0 reset.
const rollDelta=(before,after)=>Math.atan2(Math.sin(after-before),Math.cos(after-before));
const sweepScratch=new WeakMap();
// Arcade masses in tonnes. They affect relative impulses, not economy or assets.
const MASSES=Object.freeze({rocket:1.3,hatch:1.15,sedan:1.45,suv:2,van:2.8,boxtruck:7,semi:16,towtruck:6,firetruck:11});
export const CONTACT_TUNING=Object.freeze({restitution:.12,friction:.22,slop:.001,iterations:6,fatalClosing:10,fatalDelta:7,railInner:7.615});
/** Snapshot before any player/traffic integration; no rendering objects enter physics. */
export function captureContactFrame(s){
  return {x:s.x,playerBounds:playerBoundsFor(s),vehicleId:s.vehicleId,steerAngle:s.steerAngle,heading:finite(s.heading),altitude:finite(s.altitude),rollAngle:finite(s.rollAngle),distance:s.distance+finite(s.sceneTravel),
    traffic:new Map(s.traffic.filter(car=>Math.abs(car.z)<trafficDefinition(car.kind).length/2+playerBoundsFor(s).length/2+14).map(car=>[car,{...car,laneChange:car.laneChange?{...car.laneChange}:undefined,trailerState:car.trailerState?{...car.trailerState}:undefined}])),
    obstacles:new Map(s.obstacles.filter(o=>Math.abs(o.z)<playerBoundsFor(s).length/2+14).map(o=>[o,{...o}]))};
}
/** Project one conservative local solid around the exact .58m roll pivot. */
function projectPart(p,roll){
  const c=Math.cos(roll),sn=Math.sin(roll),cy=p.centerY-.58;
  const centerY=.58+p.centerX*sn+cy*c,halfHeight=Math.abs(sn)*p.halfWidth+Math.abs(c)*p.halfHeight;
  return {x:p.centerX*c-cy*sn,z:p.centerZ,halfWidth:Math.abs(c)*p.halfWidth+Math.abs(sn)*p.halfHeight,halfLength:p.halfLength,yaw:0,bottom:centerY-halfHeight,top:centerY+halfHeight,local:p};
}
/** Body, wheel and localized mirror proxies, transformed through actual roll. */
export function playerContactParts(s){
  const b=playerBoundsFor(s),parts=(s.vehicleId??'rocket')==='rocket'?ROCKET_CONTACT_SHAPE:[{centerX:0,centerY:b.height/2,centerZ:0,halfWidth:b.width/2,halfHeight:b.height/2,halfLength:b.length/2}];
  return parts.map(p=>projectPart(p,finite(s.rollAngle)));
}
/** World vertical interval, including the cabin pivot's lateral/vertical shift. */
export function playerContactHeight(s){
  const b=playerBoundsFor(s),r=finite(s.rollAngle),half=(Math.abs(Math.cos(r))*b.height+Math.abs(Math.sin(r))*b.width)/2;
  const center=.012+finite(s.altitude)+.58+(b.height/2-.58)*Math.cos(r);
  return {bottom:center-half,top:center+half};
}
function body(x,z,yaw,width,length,mass,vx,vz,yawRate){return{x,z,yaw,vx,vz,yawRate,invMass:mass?1/mass:0,invInertia:mass?12/(mass*(width*width+length*length)):0};}
function shapeAt(actor,part,seconds=0,fraction=1){
  const projected=actor.kind==='player'?projectPart(part.local,actor.previousRoll+(actor.endRoll-actor.previousRoll)*fraction):null;
  const old=part.start||part,mix=key=>projected?projected[key]:old[key]+(part[key]-old[key])*fraction;
  const yaw=actor.body.yaw+actor.body.yawRate*seconds,c=Math.cos(yaw),s=Math.sin(yaw),x=mix('x'),z=mix('z');
  return{x:actor.body.x+actor.body.vx*seconds+c*x+s*z,z:actor.body.z+actor.body.vz*seconds-s*x+c*z,yaw:yaw+mix('yaw'),halfWidth:mix('halfWidth'),halfLength:mix('halfLength')};
}
function localPart(part,root){const c=Math.cos(root.yaw),s=Math.sin(root.yaw),dx=part.x-root.x,dz=part.z-root.z;return{x:c*dx-s*dz,z:s*dx+c*dz,yaw:Math.atan2(part.forward[0],part.forward[1])-root.yaw,halfWidth:part.halfWidth,halfLength:part.halfLength};}
/** Reconstruct a clipped planner clock without mixing signal and moving epochs. */
function clipManeuverClock(car,old,seconds){
  const completionCooldown=car.laneChangeCooldown;
  for(const key of ['laneChangeCooldown','laneDecisionIn','yieldRequestTime','hornReactionIn'])if(Number.isFinite(old[key]))car[key]=Math.max(0,old[key]-seconds);
  const change=old.laneChange;
  if(!change){car.laneChange=change;car.signal=old.signal||0;car.signalTime=old.signalTime||0;car.lane=old.lane;return;}
  const next={...change,elapsed:change.elapsed+seconds};
  if(next.phase==='signal'&&next.elapsed+1e-10>=next.signalDuration){next.elapsed=Math.max(0,next.elapsed-next.signalDuration);next.phase='moving';}
  if(next.phase==='moving'&&next.elapsed+1e-10>=next.duration){car.laneChange=null;car.lane=next.to;car.signal=0;car.signalTime=0;car.laneChangeCooldown=finite(completionCooldown);return;}
  car.laneChange=next;car.lane=old.lane;car.signal=Math.sign(next.to-next.from);car.signalTime=finite(old.signalTime)+seconds;
  if(old.driverIntent!==undefined)car.driverIntent=old.driverIntent;
}
function advance(actors,seconds){for(const a of actors){if(a.kind==='player')a.integratedTravel-=a.body.vz*seconds;else if(a.kind==='traffic')a.integratedTravel=(a.integratedTravel||0)+Math.hypot(a.body.vx,a.body.vz)*seconds;a.body.x+=a.body.vx*seconds;a.body.z+=a.body.vz*seconds;a.body.yaw+=a.body.yawRate*seconds;}}
function verticalInterval(before,after,part,height,from,to,dt){
  // Each rolling interval spans <=.01rad. The nonlinear projected-solid curve
  // differs from its chord by <0.03mm at this asset scale; no broad-phase union
  // becomes a hit. Both temporal endpoints use this part's actual Y bounds.
  const at=t=>{const f=t/dt,p=projectPart(part.local,finite(before.rollAngle)+rollDelta(finite(before.rollAngle),finite(after.rollAngle))*f),alt=.012+finite(before.altitude)+(finite(after.altitude)-finite(before.altitude))*f;return{bottom:alt+p.bottom,top:alt+p.top};};
  const lo=at(from),hi=at(to);let start=0,end=1;
  for(const [v0,v1,bound,less] of [[lo.bottom,hi.bottom,height,true],[lo.top,hi.top,0,false]]){
    const d=v1-v0;if(Math.abs(d)<1e-12){if(less?v0>=bound:v0<=bound)return null;continue;}
    const t=(bound-v0)/d;if((d>0)===less)end=Math.min(end,t);else start=Math.max(start,t);
  }
  return end>=start&&end>=0&&start<=1?{from:from+Math.max(0,start)*(to-from),to:from+Math.min(1,end)*(to-from)}:null;
}
/**
 * Resolve the earliest continuous player contact, then the remaining substep.
 * Traffic proposals keep their existing planner. Only physically hit actors are
 * rewritten; impulses survive in speed/lateralVelocity and an impact yaw state.
 * Sweeps use exact translating SAT and bounded rotating interval refinement.
 * No damage cooldown ever disables contact geometry. Existing revive immunity
 * remains the explicit ghost policy, separate from impact feedback throttling.
 */
export function resolveVehicleContacts(s,previous,dt,travelled){
  s.impactCooldown=Math.max(0,finite(s.impactCooldown)-dt);
  if(!(dt>0)||s.invincible>0)return{travelled,physicalTravel:travelled,sceneCorrection:0,contacts:[],fatal:false};
  const b=playerBoundsFor(s),start={x:(previous.x-1)*LANE_WIDTH,z:0,yaw:-previous.heading};
  const player={kind:'player',integratedTravel:0,previousRoll:previous.rollAngle,endRoll:previous.rollAngle+rollDelta(previous.rollAngle,finite(s.rollAngle)),body:body(start.x,0,start.yaw,b.width,b.length,MASSES[s.vehicleId]||1.3,((s.x-previous.x)*LANE_WIDTH)/dt,-travelled/dt,(-finite(s.heading)-start.yaw)/dt),parts:playerContactParts(s).map((part,i)=>({...part,start:playerContactParts(previous)[i]})),changed:false};
  const actors=[player];
  for(const car of s.traffic){const old=previous.traffic.get(car);if(!old)continue;const spec=trafficDefinition(car.kind);
    if(Math.min(Math.abs(old.z),Math.abs(car.z))>spec.length/2+b.length/2+Math.abs(travelled)+3)continue;
    const p0=trafficPose(old,previous.distance),p1=trafficPose(car,previous.distance+travelled);p1.z-=travelled;
    actors.push({kind:'traffic',entity:car,body:body(p0.x,p0.z,p0.yaw,spec.width,spec.length,MASSES[car.kind]||2,(p1.x-p0.x)/dt,(p1.z-p0.z)/dt,(p1.yaw-p0.yaw)/dt),parts:trafficCollisionParts(car,previous.distance+travelled).map((part,i)=>{const end={...part,z:part.z-travelled};return{...localPart(end,p1),start:localPart(trafficCollisionParts(old,previous.distance)[i],p0)};}),height:spec.height+.012,changed:false});
  }
  for(const o of s.obstacles){const old=previous.obstacles.get(o);if(!old||o.hit||Math.abs(old.z)>b.length/2+Math.abs(travelled)+4)continue;
    const cone=o.kind==='cone',x=(old.x-1)*LANE_WIDTH+roadCurve(-old.z,previous.distance);
    actors.push({kind:o.kind,entity:o,body:body(x,-old.z,0,cone?.58:2.7,cone?.58:.14,0,0,0,0),parts:[{x:0,z:0,yaw:0,halfWidth:cone?.29:1.35,halfLength:cone?.29:.07}],height:cone?.86:1.3,changed:false});
  }
  // The rails match the authored landscape, not an invisible lane-centre clamp.
  for(const side of [-1,1])actors.push({kind:'rail',body:body(side*(CONTACT_TUNING.railInner+.2),0,0,.4,100,0,0,0,0),parts:[{x:0,z:0,yaw:0,halfWidth:.2,halfLength:50}],height:1.02,changed:false});
  let clock=0,fatal=false,iterations=0,slices=0;const contacts=[],suppressed=new Set(),trimSuppressed=new Map();
  let query=sweepScratch.get(s);if(!query){query={};sweepScratch.set(s,query);}
  while(clock<dt-1e-10&&iterations<CONTACT_TUNING.iterations&&slices++<64){
    let first=null,uncertain=null;
    const sliceEnd=Math.min(dt,clock+dt*Math.min(1,.01/Math.max(.01,Math.abs(player.endRoll-player.previousRoll))));
    for(let i=1;i<actors.length;i++){const other=actors[i];if(suppressed.has(other))continue;
      for(const pa of player.parts){
      if(trimSuppressed.get(other)?.has(pa.local.id))continue;
      const vertical=verticalInterval(previous,s,pa,other.height,clock,sliceEnd,dt);if(!vertical)continue;
      const wait=vertical.from-clock,span=vertical.to-vertical.from;if(span<1e-10)continue;
      for(const pb of other.parts){
        const a0=shapeAt(player,pa,wait,(clock+wait)/dt),a1=shapeAt(player,pa,wait+span,(clock+wait+span)/dt),b0=shapeAt(other,pb,wait,(clock+wait)/dt),b1=shapeAt(other,pb,wait+span,(clock+wait+span)/dt),out=query;
        const hit=sweepOBB(a0,a1,b0,b1,out);
        if(hit){const time=wait+hit.time*span;if(!first||time<first.time-1e-10)first={...hit,time,other,playerPart:pa.local};}
        else if(out.status==='unresolved'){const time=wait+Math.max(0,out.earliestPossibleTime||0)*span;if(!uncertain||time<uncertain.time)uncertain={time,other};}
      }}
    }
    if(uncertain&&(!first||uncertain.time<first.time)){
      // Fail closed on the small unproven rotational interval, without inventing
      // a crash/score event. Next fixed step can resolve from the safe pose.
      advance(actors,uncertain.time);clock+=uncertain.time;player.changed=true;s.contactUnresolved=finite(s.contactUnresolved)+1;break;
    }
    if(!first){advance(actors,sliceEnd-clock);clock=sliceEnd;continue;}
    iterations++;advance(actors,first.time);clock+=first.time;
    const other=first.other;
    if(other.kind==='cone'){
      other.entity.hit=true;contacts.push({kind:'cone',entity:other.entity,pointX:first.pointX,pointZ:first.pointZ});suppressed.add(other);continue;
    }
    if(first.playerPart.role==='mirror'){
      // Mirrors are compliant trim, not a rigid chassis-width wall. They dirty
      // the pass and give a scrape cue without halting the solver clock. Only
      // this trim part is excluded; body/wheel hits on the same car still solve.
      let parts=trimSuppressed.get(other);if(!parts){parts=new Set();trimSuppressed.set(other,parts);}parts.add(first.playerPart.id);
      const a=player.body,b=other.body,arx=first.pointX-a.x,arz=first.pointZ-a.z,brx=first.pointX-b.x,brz=first.pointZ-b.z;
      const closing=Math.max(0,-((b.vx+b.yawRate*brz-a.vx-a.yawRate*arz)*first.normalX+(b.vz-b.yawRate*brx-a.vz+a.yawRate*arx)*first.normalZ));
      if(other.entity)other.entity.contacted=true;
      if(!other.entity?.mirrorContacted)contacts.push({kind:other.kind,partRole:'mirror',entity:other.entity,normalX:first.normalX,normalZ:first.normalZ,pointX:first.pointX,pointZ:first.pointZ,closingSpeed:closing,deltaSpeed:0,severe:false});
      if(other.entity)other.entity.mirrorContacted=true;
      iterations--;continue;
    }
    const impulse=resolveContactImpulse(player.body,other.body,first,{restitution:CONTACT_TUNING.restitution,friction:CONTACT_TUNING.friction});
    const total=player.body.invMass+other.body.invMass,depth=Math.max(0,first.penetration||0)+CONTACT_TUNING.slop;
    if(total>0){const pa=depth*player.body.invMass/total,pb=depth*other.body.invMass/total;player.body.x-=first.normalX*pa;player.body.z-=first.normalZ*pa;other.body.x+=first.normalX*pb;other.body.z+=first.normalZ*pb;}
    player.changed=true;if(other.kind==='traffic'){other.changed=true;other.entity.contacted=true;}
    const delta=impulse.normalImpulse*player.body.invMass;
    // Severity comes from normal closing speed and actual player impulse, not
    // proximity or side-by-side forward speed. A grazing scrape stays playable.
    const severe=impulse.closingSpeed>=CONTACT_TUNING.fatalClosing&&delta>=CONTACT_TUNING.fatalDelta;
    fatal||=severe;
    contacts.push({kind:other.kind,partRole:first.playerPart.role||'body',entity:other.entity,normalX:first.normalX,normalZ:first.normalZ,pointX:first.pointX,pointZ:first.pointZ,closingSpeed:impulse.closingSpeed,deltaSpeed:delta,severe});
    // Suppress only a separating zero-time pair within this solver pass, never
    // across steps. Other contacts and the next substep still resolve normally.
    if(impulse.normalImpulse<=1e-9)suppressed.add(other);
  }
  if(clock<dt-1e-10&&iterations>=CONTACT_TUNING.iterations){player.changed=true;s.contactBudgetStops=finite(s.contactBudgetStops)+1;}
  // Position correction is never earned distance, in either direction. Only
  // integrated velocity travel contributes to score; the rest shifts the scene.
  const physical=player.changed?-player.body.z:travelled,actual=Math.max(0,player.changed?player.integratedTravel:travelled);
  if(clock<dt-1e-10)for(const actor of actors)if(actor.kind==='traffic')actor.clipped=true;
  if(player.changed){s.x=player.body.x/LANE_WIDTH+1;s.heading=-player.body.yaw;s.lateralVelocity=player.body.vx;s.speed=s.forwardVelocity=Math.max(0,-player.body.vz);s.yawRate=-player.body.yawRate;s.lane=clamp(Math.round(s.x),0,2);s.impactRemaining=Math.max(finite(s.impactRemaining),fatal?.65:.2);}
  const correction=physical-travelled;
  for(const car of s.traffic)car.z-=correction;
  for(const o of s.obstacles)o.z-=correction;
  for(const actor of actors){if((!actor.changed&&!actor.clipped)||actor.kind!=='traffic')continue;const car=actor.entity,p=actor.body,spec=trafficDefinition(car.kind);
    const old=previous.traffic.get(car),fraction=clock/dt;
    if(actor.changed){car.impactActive=true;car.impactYaw=p.yaw;car.impactYawRate=p.yawRate;car.lateralVelocity=p.vx;car.speed=Math.max(0,-p.vz);car.heading=-p.yaw;car.laneChange=null;car.signal=0;car.laneChangeCooldown=5;}
    else clipManeuverClock(car,old,clock);
    const sceneZ=p.z+physical;car.z=-sceneZ+spec.rearAxleZ*(1-Math.cos(p.yaw));
    const axleZ=-car.z+spec.rearAxleZ;car.x=1+(p.x-roadCurve(axleZ,previous.distance+physical)+Math.sin(p.yaw)*spec.rearAxleZ)/LANE_WIDTH;if(actor.changed)car.lane=clamp(Math.round(car.x),0,2);
    else car.heading=Math.atan(Math.tan(roadYaw(axleZ,previous.distance+physical))-Math.tan(p.yaw));
    car.travelDistance=finite(old.travelDistance)+finite(actor.integratedTravel);
    if(spec.articulated){
      // Rebase the retained hinge angle at the resolved root, not the discarded
      // end-of-step proposal. Tractor/trailer stay distinct collision parts.
      car.trailerAngle=finite(old.trailerAngle)+(finite(car.trailerAngle)-finite(old.trailerAngle))*fraction;
      const distance=previous.distance+physical,hitch=trafficHitch(car,distance),yaw=hitch.yaw+car.trailerAngle;
      car.trailerState={distance,hitchX:hitch.x,hitchZ:hitch.z,axleX:hitch.x+Math.sin(yaw)*spec.trailerAxleDistance,axleZ:hitch.z+Math.cos(yaw)*spec.trailerAxleDistance,yaw};
      car.trailerTravelDistance=finite(old.trailerTravelDistance)+finite(actor.integratedTravel);
    }
  }
  return{travelled:actual,physicalTravel:physical,sceneCorrection:physical-actual,contacts,fatal};
}
/** Advance hit traffic momentum, without restoring a cancelled lane-change path. */
export function advanceTrafficImpact(car,dt){
  const spec=trafficDefinition(car.kind),old=finite(car.impactYaw),vx=finite(car.lateralVelocity),omega=finite(car.impactYawRate);
  const response=1-Math.exp(-4*dt),target=-Math.atan2(vx,Math.max(2,car.speed));
  car.impactYawRate=omega+(clamp((target-old)*4,-1.2,1.2)-omega)*response;
  car.impactYaw=old+car.impactYawRate*dt;
  car.x+=(vx*dt+(Math.sin(car.impactYaw)-Math.sin(old))*spec.rearAxleZ)/LANE_WIDTH;
  car.z+=(Math.cos(old)-Math.cos(car.impactYaw))*spec.rearAxleZ;
  car.lateralVelocity=vx*Math.exp(-3*dt);car.heading=-car.impactYaw;car.laneCurvature=0;
  if(Math.abs(car.lateralVelocity)<.002&&Math.abs(car.impactYaw)<.002&&Math.abs(car.impactYawRate)<.002){car.impactActive=false;car.heading=0;}
}
