import { RUN_REWARDS } from './progression-catalog.js';
import { sanitizeTelemetry } from './progression.js';

const MAX_SPEED_MPS = 160;
const MAX_SAMPLE_SECONDS = .25;
/** Read finite nonnegative simulation data without numeric-string or NaN coercion. */
const finite = (value,fallback=0) => Number.isFinite(value)&&value>=0?value:fallback;
/** Reduce a roll angle to its unsigned distance from an upright multiple of one full revolution. */
const uprightAngle = value => Number.isFinite(value)?Math.abs(Math.atan2(Math.sin(value),Math.cos(value))):Math.PI;
/**
 * Observe production Game state without changing it. All distances are metres, speeds m/s and
 * durations simulation seconds. Pauses, menus and wall-clock gaps do not create earned progress.
 * Landings require a real flight cycle, safe touchdown and both a ground-distance gate and a
 * rolling 1000 m limit; merely firing a `land` callback cannot manufacture precision rewards.
 */
export class RunTelemetry {
  /** Create independent counters for one run; preserve this instance across a legitimate revive. */
  constructor() {
    this.metrics={distanceM:0,groundDistanceM:0,airDistanceM:0,activeSeconds:0,roadEventsCompleted:0,precisionLandings:0,airborneOvertakes:0,maxCleanGroundSegmentM:0,rawScore:0,revives:0,goalReached:false,peakSpeedMps:0,airSeconds:0,landings:0};
    this.distanceHigh=0;this.elapsedHigh=0;this.eventHigh=0;this.overtakeHigh=0;this.reviveHigh=0;
    this.lastPhase='ready';this.lastAltitude=0;this.lastVerticalSpeed=0;this.lastRoll=0;this.cleanGround=0;this.groundSinceReward=0;
    this.cycle=null;this.flightHazard=false;this.rewardedLandingDistances=[];this.finalized=false;this.lastTouchdownElapsed=-1;
    // Some synchronous Game events fire after elapsed advances but before that substep travels.
    // Keep one bounded distance allowance for its final same-timestamp observation.
    this.sampleElapsed=-1;this.sampleTravelRemaining=0;this.sampleAirborne=false;
  }
  /**
   * Accumulate one simulation sample. Elapsed simulation time takes precedence over caller dt,
   * avoiding rewards during hidden-tab pauses, repeated observations and frame-time jitter.
   */
  observe(state,dt=0,touchdownData=null) {
    if(this.finalized||!state||typeof state!=='object')return this.snapshot();
    const elapsed=finite(state.elapsed,this.elapsedHigh),distance=finite(state.distance,this.distanceHigh),advance=elapsed-this.elapsedHigh;
    const active=state.phase==='playing'||state.phase==='crashed'&&this.lastPhase==='playing';
    const revives=Math.floor(finite(state.revives));
    if(revives>this.reviveHigh){this.metrics.revives+=revives-this.reviveHigh;this.reviveHigh=revives;this.cycle=null;this.flightHazard=false;this.cleanGround=0;this.lastAltitude=0;}
    // A state reset belongs to a new telemetry instance; it must not earn old distance again.
    if(elapsed+1e-7<this.elapsedHigh||distance+1e-5<this.distanceHigh){this.lastPhase=state.phase;return this.snapshot();}
    const seconds=active&&advance>0&&advance<=MAX_SAMPLE_SECONDS?advance:0;
    const altitude=finite(state.altitude),airborne=altitude>.08;
    if(seconds>0){this.sampleElapsed=elapsed;this.sampleTravelRemaining=MAX_SPEED_MPS*seconds+.25;this.sampleAirborne=airborne||this.lastAltitude>.08;}
    else if(!active||elapsed!==this.sampleElapsed)this.sampleTravelRemaining=0;
    const delta=Math.max(0,distance-this.distanceHigh);
    const travelled=active&&delta<=this.sampleTravelRemaining?delta:0;
    // A duplicate cannot renew the allowance; an impossible jump consumes it without reward.
    if(delta>0)this.sampleTravelRemaining=delta<=this.sampleTravelRemaining?this.sampleTravelRemaining-delta:0;
    if(seconds>0||travelled>0){this.metrics.activeSeconds+=seconds;this.metrics.distanceM+=travelled;if(seconds>0)this.metrics.peakSpeedMps=Math.max(this.metrics.peakSpeedMps,Math.min(MAX_SPEED_MPS,finite(state.speed)));
      // A transition sample belongs to the airborne cycle until its touchdown, not clean ground.
      if(this.sampleAirborne){this.metrics.airDistanceM+=travelled;this.metrics.airSeconds+=seconds;this.cleanGround=0;if(seconds>0&&!this.cycle&&airborne)this.cycle={maximumAltitude:altitude,seconds:0,clean:!this.flightHazard};if(this.cycle&&seconds>0){this.cycle.maximumAltitude=Math.max(this.cycle.maximumAltitude,altitude);this.cycle.seconds+=seconds;}}
      else{this.metrics.groundDistanceM+=travelled;this.groundSinceReward+=travelled;this.cleanGround+=travelled;this.metrics.maxCleanGroundSegmentM=Math.max(this.metrics.maxCleanGroundSegmentM,this.cleanGround);}
      if(this.lastAltitude>0&&altitude===0)this.touchdown(state,touchdownData,elapsed);
    }
    // Game can increment later counters after an earlier event observed the same substep.
    // Read each monotonic counter once without manufacturing another second or distance budget.
    if(active&&elapsed===this.sampleElapsed){
      const completed=Math.floor(finite(state.eventsCompleted));if(completed>this.eventHigh){this.metrics.roadEventsCompleted+=completed-this.eventHigh;this.eventHigh=completed;}
      const overtakes=Math.floor(finite(state.overtakes));if(overtakes>this.overtakeHigh){if(airborne&&altitude>=.8)this.metrics.airborneOvertakes+=overtakes-this.overtakeHigh;this.overtakeHigh=overtakes;}
    }
    if(active){this.metrics.rawScore=Math.floor(finite(state.score));this.metrics.goalReached=this.metrics.goalReached||(state.goalReached===true&&this.metrics.distanceM>=RUN_REWARDS.goalMetres);}
    this.distanceHigh=Math.max(this.distanceHigh,distance);this.elapsedHigh=Math.max(this.elapsedHigh,elapsed);this.lastPhase=state.phase;this.lastAltitude=altitude;
    this.lastVerticalSpeed=Number.isFinite(state.verticalSpeed)?state.verticalSpeed:0;this.lastRoll=Number.isFinite(state.rollAngle)?state.rollAngle:0;
    if(altitude===0)this.flightHazard=false;
    return this.snapshot();
  }
  /** Consume a real touchdown once, using pre-touchdown sample data when the game has reset velocity. */
  touchdown(state,payload,elapsed) {
    if(state.altitude!==0||elapsed<this.elapsedHigh||this.lastTouchdownElapsed===elapsed||!this.cycle)return;
    this.lastTouchdownElapsed=elapsed;const cycle=this.cycle;this.cycle=null;
    if(cycle.maximumAltitude<.8||cycle.seconds<.35)return;
    this.metrics.landings++;
    const vertical=Number.isFinite(payload?.verticalSpeed)?payload.verticalSpeed:this.lastVerticalSpeed;
    const roll=Number.isFinite(payload?.rollAngle)?payload.rollAngle:this.lastRoll;
    const onRoad=Number.isFinite(state.x)&&state.x>=-.05&&state.x<=2.05;
    const assisted=state.touchdownPulse>0||payload?.assisted===true;
    const safe=cycle.clean&&state.phase==='playing'&&onRoad&&Math.abs(vertical)<=2.5&&uprightAngle(roll)<=.22&&!state.rolling&&assisted;
    this.rewardedLandingDistances=this.rewardedLandingDistances.filter(d=>this.metrics.distanceM-d<1000);
    if(safe&&this.groundSinceReward+1e-6>=RUN_REWARDS.landingRewardMinimumGroundMetres&&this.rewardedLandingDistances.length<RUN_REWARDS.maxRewardedLandingsPerKilometre){this.metrics.precisionLandings++;this.groundSinceReward=0;this.rewardedLandingDistances.push(this.metrics.distanceM);}
  }
  /**
   * Consume existing Game event names. State counters provide event/overtake totals; callbacks
   * only mark hazards, touchdown and revive boundaries, so duplicated callbacks award nothing.
   */
  event(name,payload,state) {
    // Impact is optional visual/audio feedback; physical contacts have their own event.
    if(this.finalized||name==='impact')return this.snapshot();
    // Collision happens synchronously before the next renderer observation.
    const hazard=name==='cone'||name==='crash'||name==='contact';
    if(hazard){this.cleanGround=0;if(this.cycle)this.cycle.clean=false;}
    const touchdownData=name==='land'?{verticalSpeed:this.lastVerticalSpeed,rollAngle:this.lastRoll,...(payload&&typeof payload==='object'?payload:{})}:payload;
    if(state)this.observe(state,0,name==='land'?touchdownData:null);
    if(name==='land'&&state)this.touchdown(state,touchdownData,finite(state.elapsed,this.elapsedHigh));
    // A hazard can create the first airborne sample, or happen during low takeoff before
    // the .08 m accounting threshold. Preserve that hazard for this flight, not the next.
    if(hazard){this.cleanGround=0;if(this.cycle)this.cycle.clean=false;if(finite(state?.altitude,this.lastAltitude)>0)this.flightHazard=true;}
    return this.snapshot();
  }
  /** Return a bounded independent cumulative receipt; no ad or currency value can change raw score. */
  snapshot(){return sanitizeTelemetry(this.metrics);}
  /** Capture the last production state, then freeze this telemetry run against subsequent observations. */
  finalize(state){if(state)this.observe(state,0);this.finalized=true;return this.snapshot();}
}
