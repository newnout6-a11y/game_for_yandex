import { CONFIG, DIFFICULTIES } from './config.js';
import { clamp, lerp, seededRandom } from './util.js';
import { createFlightState, updateFlight } from './flight.js';
import { trafficDefinition, chooseTrafficKind, trafficCenterGap } from './traffic-catalog.js';
import { playerBottom, playerTrafficDepth, playerTrafficWidth, trafficHitsPlayer, updateTrailerKinematics, LANE_WIDTH } from './traffic-physics.js';
import { trafficLateral, occupiedTrafficLanes, updateTrafficManoeuvres } from './traffic-behavior.js';
import { trafficDynamics } from './traffic-motion.js';
const axis = (v, min=0) => Number.isFinite(Number(v)) ? clamp(Number(v),min,1) : 0;
export class Game {
  constructor({ random = seededRandom(), onEvent = () => {} } = {}) { this.random=random;this.onEvent=onEvent;this.reset(); }
  reset(difficulty='flow') {
    this.difficulty=Object.hasOwn(DIFFICULTIES,difficulty)?difficulty:'flow';
    this.state={
      phase:'ready',lane:1,x:1,heading:0,steerAngle:0,acceleration:0,throttle:0,braking:false,
      distance:0,score:0,elapsed:0,speed:0,nitro:60,boosting:false,
      ...createFlightState(),
      combo:1,comboTime:0,overtakes:0,nearMisses:0,charges:0,revives:0,invincible:0,
      traffic:[],pickups:[],obstacles:[],nextSpawn:68,safeLane:1,goalReached:false,
      nextEvent:80,eventIndex:0,roadEvent:null,lastEvent:null,eventsCompleted:0,
    };
    this.serial=0;this.pulse=0;this.pulseTime=0;return this.state;
  }
  get rules(){return DIFFICULTIES[this.difficulty];}
  start(){
    if(this.state.phase!=='ready')return;
    this.state.phase='playing';for(const z of [85,145,205])this.spawnWave(z,true);
  }
  // A swipe gives a short steering input; it never selects or snaps to a lane.
  steer(direction){
    if(this.state.phase!=='playing'||!Number.isFinite(direction)||!direction)return false;
    this.pulse=Math.sign(direction);this.pulseTime=.45;return true;
  }
  releaseControls(){this.pulseTime=0;}
  update(dt, controls={}){
    if(this.state.phase!=='playing'||!Number.isFinite(dt)||dt<=0)return;
    const c={throttle:axis(controls?.throttle),brake:axis(controls?.brake),steer:axis(controls?.steer,-1),boost:Boolean(controls?.boost),flight:Boolean(controls?.flight),roll:axis(controls?.roll,-1)};
    let remaining=Math.min(dt,.1);
    while(remaining>1e-9&&this.state.phase==='playing'){const step=Math.min(remaining,1/120);this.step(step,c);remaining-=step;}
  }
  step(dt,c){
    const s=this.state;s.elapsed+=dt;s.invincible=Math.max(0,s.invincible-dt);s.comboTime=Math.max(0,s.comboTime-dt);
    if(!s.comboTime)s.combo=1;
    this.pulseTime=Math.max(0,this.pulseTime-dt);
    const steering=c.steer||(this.pulseTime>0?this.pulse:0);
    s.throttle=c.brake>0?0:c.throttle;s.braking=c.brake>0;
    updateFlight(s,dt,c,this.onEvent);
    s.boosting=c.boost&&!s.flying&&s.altitude<.2&&s.throttle>0&&!s.braking&&s.speed>5&&s.nitro>0;
    if(s.boosting)s.nitro=Math.max(0,s.nitro-CONFIG.nitroDrain*dt);
    const maxSpeed=CONFIG.maxSpeed*this.rules.speed*(s.boosting?1.27:1);
    const drive=s.throttle*(CONFIG.acceleration+(s.boosting?7:0));
    const resistance=s.speed>0?CONFIG.coastDeceleration+s.speed*s.speed*.0012:0;
    const beforeSpeed=s.speed;
    s.speed=clamp(s.speed+(drive-resistance-CONFIG.brakeDeceleration*c.brake)*dt,0,Math.max(beforeSpeed,maxSpeed));
    // Releasing boost/accelerator reduces speed gradually rather than cutting it.
    if(s.speed>maxSpeed)s.speed=Math.max(maxSpeed,s.speed-dt*3);
    s.acceleration=(s.speed-beforeSpeed)/dt;
    s.steerAngle+=clamp(steering*.3-s.steerAngle,-CONFIG.steeringRate*dt,CONFIG.steeringRate*dt);
    const grip=1/(1+Math.max(0,s.speed-30)*.012);
    s.heading=lerp(s.heading,s.steerAngle*.67*grip,1-Math.exp(-dt*5));
    const previousX=s.x;
    s.x=clamp(s.x+Math.sin(s.heading)*s.speed*dt/3.5,-.24,2.24);
    if((s.x<=-.24&&s.heading<0)||(s.x>=2.24&&s.heading>0))s.heading=0;
    s.lane=clamp(Math.round(s.x),0,2);
    const travelled=s.speed*Math.cos(s.heading)*dt;
    s.distance+=travelled;s.score+=travelled*s.combo*this.rules.score;
    if(s.distance>=s.nextSpawn){this.spawnWave();s.nextSpawn+=CONFIG.spawnDistance*this.rules.spacing;}
    if(!s.traffic.length&&s.speed>10&&Number.isFinite(s.nextSpawn)){this.spawnWave(160);s.nextSpawn=s.distance+CONFIG.spawnDistance;}
    this.updateEvent(dt);
    const flightClearance=playerBottom(s.altitude,s.rollAngle);
    // Front-to-back ordering gives each follower its updated leader position.
    // One sort replaces repeated filtering/sorting for every traffic vehicle.
    for(const car of s.traffic){car.previousLateral=trafficLateral(car);car.previousZ=car.z;}
    updateTrafficManoeuvres(s,dt);
    const trafficOrder=[...s.traffic].sort((a,b)=>b.z-a.z),laneLeader=new Map();
    for(const car of trafficOrder){
      const before=car.z,beforeSpeed=car.speed,spec=trafficDefinition(car.kind),clearHeight=spec.height+.08;
      const depth=playerTrafficDepth(car),width=playerTrafficWidth(car)/LANE_WIDTH;
      if(car.eventId&&s.roadEvent?.id===car.eventId&&s.roadEvent.remaining<115)car.eventBraking=true;
      const occupied=occupiedTrafficLanes(car),carX=trafficLateral(car);
      const following=before<0&&(Math.abs(carX-s.x)<width||(car.laneChange&&occupied.includes(Math.round(s.x))))&&flightClearance<clearHeight;
      const rearSafeSpeed=s.speed+Math.max(0,-before-depth-2)*.8;
      const leader=occupied.map(l=>laneLeader.get(l)).filter(Boolean).sort((a,b)=>a.z-b.z)[0];
      for(const l of occupied)laneLeader.set(l,car);
      const gap=leader?leader.z-before:Infinity;
      const minGap=leader?trafficCenterGap(car,leader,1.4):0;
      const freeGap=leader?gap-trafficCenterGap(car,leader,0):Infinity;
      const followSpeed=leader?Math.max(0,leader.speed+(freeGap-2)*.7):Infinity;
      const cruise=car.cruiseSpeed??car.speed;
      const needsHeadway=Boolean(leader&&freeGap<7+car.speed*.65&&followSpeed<cruise);
      car.braking=Boolean(car.eventBraking||(following&&car.speed>rearSafeSpeed)||needsHeadway);
      const targetSpeed=Math.min(car.eventBraking?6:cruise,following?rearSafeSpeed:Infinity,needsHeadway?followSpeed:Infinity);
      const response=trafficDynamics(car.kind);
      const wanted=lerp(car.speed,targetSpeed,1-Math.exp(-dt*(following?6:1.5)));
      car.speed+=clamp(wanted-car.speed,-response.braking*dt,response.acceleration*dt);
      car.z+=(car.speed-s.speed*Math.cos(s.heading))*dt;
      if(leader&&leader.previousZ-before>=minGap-1e-8&&car.z>leader.z-minGap){car.z=leader.z-minGap;car.speed=Math.min(car.speed,leader.speed);car.braking=true;}
      // A following driver stops behind the player, including a parked player.
      const stopZ=Math.max(before,-(depth+2));
      if(following&&before<=-depth&&car.z>stopZ){car.z=stopZ;car.speed=Math.min(car.speed,s.speed);car.braking=true;}
      car.acceleration=(car.speed-beforeSpeed)/dt;
      car.travelDistance=(car.travelDistance||0)+Math.hypot(Math.max(0,car.z-before+travelled),(carX-car.previousLateral)*LANE_WIDTH);
      if(spec.articulated)updateTrailerKinematics(car,s.distance,dt);
      const crosses=Math.min(before,car.z)<=depth+.8&&Math.max(before,car.z)>=-depth-.8;
      const lateral=Math.min(Math.abs(s.x-carX),Math.abs(previousX-car.previousLateral));
      if(crosses&&s.invincible<=0&&trafficHitsPlayer(car,s,previousX,before)){this.crash();return;}
      if(!car.passed&&before>=-depth&&car.z<-depth){
        car.passed=true;s.overtakes++;
        if(lateral<width+.45&&lateral>=width&&flightClearance<clearHeight){s.nearMisses++;s.combo=Math.min(5,s.combo+1);s.comboTime=5;s.score+=30*s.combo*this.rules.score;this.onEvent('near',s.combo);}
      }
    }
    for(const obstacle of s.obstacles){
      const before=obstacle.z;obstacle.z-=travelled;
      if(!obstacle.hit&&Math.min(before,obstacle.z)<=2.8&&Math.max(before,obstacle.z)>=-2.8&&Math.abs(s.x-obstacle.x)<(obstacle.kind==='barrier'?.72:.36)&&s.invincible<=0&&flightClearance<1.65){
        if(obstacle.kind==='barrier'){this.crash();return;}
        obstacle.hit=true;s.speed*=.8;s.score=Math.max(0,s.score-50);if(s.roadEvent)s.roadEvent.clean=false;this.onEvent('cone');
      }
    }
    for(const pickup of s.pickups){
      const before=pickup.z;pickup.z-=travelled;
      if(!pickup.collected&&before>=-2&&pickup.z<=2&&Math.abs(s.x-pickup.lane)<.5&&flightClearance<1.7){pickup.collected=true;s.nitro=Math.min(100,s.nitro+CONFIG.nitroPickup);s.score+=50*s.combo*this.rules.score;s.charges++;this.onEvent('charge');}
    }
    s.traffic=s.traffic.filter(car=>car.z>-18-trafficDefinition(car.kind).length/2&&car.z<420+trafficDefinition(car.kind).length/2);s.pickups=s.pickups.filter(p=>!p.collected&&p.z>-5);s.obstacles=s.obstacles.filter(o=>!o.hit&&o.z>-8);
    if(!s.goalReached&&s.distance>=CONFIG.goal){s.goalReached=true;s.score+=1000;this.onEvent('goal');}
  }
  crash(){this.state.phase='crashed';this.state.boosting=false;this.state.flying=false;this.pulseTime=0;this.onEvent('crash');}
  spawnWave(initialZ=null,dense=false){
    const s=this.state,closed=s.roadEvent?.type==='roadworks'?s.roadEvent.lane:-1;
    let nextSafe=clamp(s.safeLane+Math.floor(this.random()*3)-1,0,2);
    if(nextSafe===closed)nextSafe=1;
    const z=(initialZ??205)+this.random()*10;
    // Reserve a genuinely empty corridor through the whole wave, including
    // long trailers from earlier spawns, rather than only omitting a lane now.
    const committedLanes=new Set(s.traffic.filter(car=>car.laneChange?.phase==='moving').flatMap(occupiedTrafficLanes));
    const clearLanes=[0,1,2].filter(l=>l!==closed&&!committedLanes.has(l)&&!s.traffic.some(car=>occupiedTrafficLanes(car).includes(l)&&Math.abs(car.z-z)<trafficDefinition(car.kind).length/2+16));
    if(!clearLanes.length)return;
    if(!clearLanes.includes(nextSafe))nextSafe=clearLanes.reduce((best,l)=>Math.abs(l-s.safeLane)<Math.abs(best-s.safeLane)?l:best,clearLanes[0]);
    s.safeLane=nextSafe;
    const blocked=[0,1,2].filter(l=>l!==nextSafe&&l!==closed);
    if(!(dense||(s.distance>300&&this.random()<.6))&&blocked.length>1)blocked.splice(Math.floor(this.random()*blocked.length),1);
    for(const lane of blocked){
      const kind=chooseTrafficKind(this.random()),spec=trafficDefinition(kind);
      const speed=spec.cruise[0]+this.random()*(spec.cruise[1]-spec.cruise[0]);
      // Do not insert a new car into another driver's braking space.
      if(s.traffic.some(car=>occupiedTrafficLanes(car).includes(lane)&&Math.abs(car.z-z)<trafficCenterGap(car,{kind},12)))continue;
      s.traffic.push({id:++this.serial,lane,z,speed,cruiseSpeed:speed,kind,category:spec.category,color:Math.floor(this.random()*7),passed:false});
    }
    if(this.random()<.8)s.pickups.push({id:++this.serial,lane:nextSafe,z:z-24,collected:false});
  }
  startEvent(type=['roadworks','checkpoint','convoy'][this.state.eventIndex%3]){
    const s=this.state;if(s.roadEvent)return false;
    if(!['roadworks','checkpoint','convoy'].includes(type))return false;
    const committed=new Set(s.traffic.filter(car=>car.laneChange?.phase==='moving').flatMap(occupiedTrafficLanes));
    const openEdges=[0,2].filter(lane=>!committed.has(lane));
    if((type==='roadworks'||type==='convoy')&&!openEdges.length)return false;
    const lane=type==='roadworks'?openEdges[Math.floor(this.random()*openEdges.length)]:Math.floor(this.random()*3);
    const at=s.distance+(type==='convoy'?240:150),id=++this.serial;
    const info={
      roadworks:{title:'Дорожные работы',hint:(lane===0?'Левая':'Правая')+' полоса закрыта. Обойди ограждение.',points:300},
      checkpoint:{title:'Контрольная точка',hint:'Пройди между флагами до конца отсчёта.',points:500},
      convoy:{title:'Поток тормозит',hint:'Тормози или обойди колонну. Следи за стоп-сигналами.',points:400},
    }[type];
    if(!info)return false;
    s.roadEvent={...info,id,type,lane,at,end:at+65,remaining:at-s.distance,deadline:s.elapsed+(type==='checkpoint'?18:35),clean:true,targets:[]};
    if(type==='roadworks'){
      for(let i=0;i<8;i++)s.obstacles.push({id:++this.serial,kind:'cone',x:lane+(lane===0?.33:-.33),z:150+i*9});
      for(const z of [174,204])s.obstacles.push({id:++this.serial,kind:'barrier',x:lane,z});
    }
    if(type==='convoy'){
      const preferredSafe=lane===0?2:0;
      const safe=openEdges.includes(preferredSafe)?preferredSafe:openEdges[0];
      for(let i=0;i<4;i++){
        const kind=['van','sedan','suv','hatch'][i];
        const car={id:++this.serial,eventId:id,lane:i%2?1:(safe===0?2:0),z:240+i*18,speed:19,cruiseSpeed:19,color:i%7,kind,category:trafficDefinition(kind).category,passed:false};
        // Existing convoy activity is retained, but it must not spawn on a
        // pre-existing long truck. Move forward until its whole envelope fits.
        while(car.z<=400&&s.traffic.some(other=>occupiedTrafficLanes(other).includes(car.lane)&&Math.abs(other.z-car.z)<trafficCenterGap(other,car,12)))car.z+=18;
        if(car.z>400)continue;
        s.traffic.push(car);s.roadEvent.targets.push(car.id);
      }
      s.safeLane=safe;
    }
    s.eventIndex++;this.onEvent('event-start',s.roadEvent);return true;
  }
  updateEvent(){
    const s=this.state;
    if(!s.roadEvent&&s.distance>=s.nextEvent)this.startEvent();
    const e=s.roadEvent;if(!e)return;
    e.remaining=e.at-s.distance;e.seconds=Math.max(0,e.deadline-s.elapsed);
    if(e.type==='checkpoint'&&(e.remaining<=0||e.seconds<=0)){
      this.finishEvent(e.remaining<=0&&e.seconds>0&&Math.abs(s.x-e.lane)<.26);return;
    }
    if(e.type==='roadworks'&&s.distance>e.end){this.finishEvent(e.clean);return;}
    if(e.type==='convoy'){
      const cars=s.traffic.filter(c=>e.targets.includes(c.id));e.carsLeft=cars.filter(c=>!c.passed).length;
      if(cars.length&&cars.every(c=>c.passed))this.finishEvent(true);
      else if(e.seconds<=0)this.finishEvent(false);
    }
  }
  finishEvent(success){
    const s=this.state,e=s.roadEvent;if(!e)return;
    const points=success?e.points*this.rules.score:0;
    if(success){s.eventsCompleted++;s.score+=points;s.nitro=Math.min(100,s.nitro+15);}
    s.lastEvent={title:e.title,success,points,until:s.elapsed+4};s.roadEvent=null;s.nextEvent=s.distance+120;
    this.onEvent('event-clear',s.lastEvent);
  }
  revive(){
    const s=this.state;if(s.phase!=='crashed'||s.revives>=CONFIG.maxRevives)return false;
    s.revives++;s.traffic=s.traffic.filter(c=>c.z>80);s.pickups=s.pickups.filter(p=>p.z>20);s.obstacles=[];
    if(s.roadEvent)this.finishEvent(false);
    s.speed=0;Object.assign(s,createFlightState());s.heading=0;s.steerAngle=0;s.throttle=0;s.braking=false;this.pulseTime=0;
    s.nitro=Math.max(40,s.nitro);s.invincible=2.5;s.combo=1;s.comboTime=0;s.phase='playing';return true;
  }
}
