import { CONFIG, DIFFICULTIES } from './config.js';
import { clamp, lerp, seededRandom } from './util.js';
const axis = (v, min=0) => Number.isFinite(Number(v)) ? clamp(Number(v),min,1) : 0;
export class Game {
  constructor({ random = seededRandom(), onEvent = () => {} } = {}) { this.random=random;this.onEvent=onEvent;this.reset(); }
  reset(difficulty='flow') {
    this.difficulty=Object.hasOwn(DIFFICULTIES,difficulty)?difficulty:'flow';
    this.state={
      phase:'ready',lane:1,x:1,heading:0,steerAngle:0,acceleration:0,throttle:0,braking:false,
      distance:0,score:0,elapsed:0,speed:0,nitro:60,boosting:false,
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
    const c={throttle:axis(controls?.throttle),brake:axis(controls?.brake),steer:axis(controls?.steer,-1),boost:Boolean(controls?.boost)};
    let remaining=Math.min(dt,.1);
    while(remaining>0&&this.state.phase==='playing'){const step=Math.min(remaining,1/120);this.step(step,c);remaining-=step;}
  }
  step(dt,c){
    const s=this.state;s.elapsed+=dt;s.invincible=Math.max(0,s.invincible-dt);s.comboTime=Math.max(0,s.comboTime-dt);
    if(!s.comboTime)s.combo=1;
    this.pulseTime=Math.max(0,this.pulseTime-dt);
    const steering=c.steer||(this.pulseTime>0?this.pulse:0);
    s.throttle=c.brake>0?0:c.throttle;s.braking=c.brake>0;
    s.boosting=c.boost&&s.throttle>0&&!s.braking&&s.speed>5&&s.nitro>0;
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
    for(const car of s.traffic){
      const before=car.z;
      if(car.eventId&&s.roadEvent?.id===car.eventId&&s.roadEvent.remaining<115)car.eventBraking=true;
      const following=before<0&&Math.abs(car.lane-s.x)<CONFIG.collisionWidth;
      const rearSafeSpeed=s.speed+Math.max(0,-before-6)*.8;
      car.braking=Boolean(car.eventBraking||(following&&car.speed>rearSafeSpeed));
      const targetSpeed=car.eventBraking?6:car.braking?rearSafeSpeed:(car.cruiseSpeed??car.speed);
      car.speed=lerp(car.speed,targetSpeed,1-Math.exp(-dt*(following?6:1.5)));
      car.z+=(car.speed-s.speed*Math.cos(s.heading))*dt;
      // A following driver stops behind the player, including a parked player.
      const stopZ=Math.max(before,-(CONFIG.collisionDepth+2));
      if(following&&before<=-CONFIG.collisionDepth&&car.z>stopZ){car.z=stopZ;car.speed=Math.min(car.speed,s.speed);car.braking=true;}
      const crosses=Math.min(before,car.z)<=CONFIG.collisionDepth&&Math.max(before,car.z)>=-CONFIG.collisionDepth;
      const lateral=Math.min(Math.abs(s.x-car.lane),Math.abs(previousX-car.lane));
      if(crosses&&lateral<CONFIG.collisionWidth&&s.invincible<=0){this.crash();return;}
      if(!car.passed&&before>=-CONFIG.collisionDepth&&car.z<-CONFIG.collisionDepth){
        car.passed=true;s.overtakes++;
        if(lateral<1.05&&lateral>=CONFIG.collisionWidth){s.nearMisses++;s.combo=Math.min(5,s.combo+1);s.comboTime=5;s.score+=30*s.combo*this.rules.score;this.onEvent('near',s.combo);}
      }
    }
    for(const obstacle of s.obstacles){
      const before=obstacle.z;obstacle.z-=travelled;
      if(!obstacle.hit&&Math.min(before,obstacle.z)<=2.8&&Math.max(before,obstacle.z)>=-2.8&&Math.abs(s.x-obstacle.x)<(obstacle.kind==='barrier'?.72:.36)&&s.invincible<=0){
        if(obstacle.kind==='barrier'){this.crash();return;}
        obstacle.hit=true;s.speed*=.8;s.score=Math.max(0,s.score-50);if(s.roadEvent)s.roadEvent.clean=false;this.onEvent('cone');
      }
    }
    for(const pickup of s.pickups){
      const before=pickup.z;pickup.z-=travelled;
      if(!pickup.collected&&before>=-2&&pickup.z<=2&&Math.abs(s.x-pickup.lane)<.5){pickup.collected=true;s.nitro=Math.min(100,s.nitro+CONFIG.nitroPickup);s.score+=50*s.combo*this.rules.score;s.charges++;this.onEvent('charge');}
    }
    s.traffic=s.traffic.filter(car=>car.z>-18&&car.z<420);s.pickups=s.pickups.filter(p=>!p.collected&&p.z>-5);s.obstacles=s.obstacles.filter(o=>!o.hit&&o.z>-8);
    if(!s.goalReached&&s.distance>=CONFIG.goal){s.goalReached=true;s.score+=1000;this.onEvent('goal');}
  }
  crash(){this.state.phase='crashed';this.state.boosting=false;this.pulseTime=0;this.onEvent('crash');}
  spawnWave(initialZ=null,dense=false){
    const s=this.state,closed=s.roadEvent?.type==='roadworks'?s.roadEvent.lane:-1;
    let nextSafe=clamp(s.safeLane+Math.floor(this.random()*3)-1,0,2);
    if(nextSafe===closed)nextSafe=1;s.safeLane=nextSafe;
    const z=(initialZ??205)+this.random()*10;
    const blocked=[0,1,2].filter(l=>l!==nextSafe&&l!==closed);
    if(!(dense||(s.distance>300&&this.random()<.6))&&blocked.length>1)blocked.splice(Math.floor(this.random()*blocked.length),1);
    for(const lane of blocked){const speed=17+this.random()*5;s.traffic.push({id:++this.serial,lane,z,speed,cruiseSpeed:speed,color:Math.floor(this.random()*5),passed:false});}
    if(this.random()<.8)s.pickups.push({id:++this.serial,lane:nextSafe,z:z-24,collected:false});
  }
  startEvent(type=['roadworks','checkpoint','convoy'][this.state.eventIndex%3]){
    const s=this.state;if(s.roadEvent)return false;
    if(!['roadworks','checkpoint','convoy'].includes(type))return false;
    const lane=type==='roadworks'?(this.random()<.5?0:2):Math.floor(this.random()*3);
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
      const safe=lane===0?2:0;
      for(let i=0;i<4;i++){
        const car={id:++this.serial,eventId:id,lane:i%2?1:(safe===0?2:0),z:240+i*18,speed:19,cruiseSpeed:19,color:i%5,passed:false};
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
    s.speed=0;s.heading=0;s.steerAngle=0;s.throttle=0;s.braking=false;this.pulseTime=0;
    s.nitro=Math.max(40,s.nitro);s.invincible=2.5;s.combo=1;s.comboTime=0;s.phase='playing';return true;
  }
}
