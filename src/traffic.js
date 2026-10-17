import * as T from '../public/vendor/three.js';
import { createTrafficMotion, updateTrafficMotion, curvatureAt, steeringForWheel } from './traffic-motion.js';
import { TRAFFIC_KINDS, normalizeTrafficKind, trafficDefinition } from './traffic-catalog.js';
export { TRAFFIC_KINDS, normalizeTrafficKind } from './traffic-catalog.js';

// Runtime vehicles are the reviewed Blender exports. Their authoring builders
// are deliberately not imported here and are never a silent asset fallback.
const templates = new Map();
export function installTrafficTemplates(models) {
  for (const kind of TRAFFIC_KINDS) {
    const model = models[kind];
    if (!model?.isObject3D) throw new Error('Missing Blender traffic asset: ' + kind);
    const wheels=[]; model.traverse(node=>{if(!node.isMesh&&/^wheel_[a-z0-9_]+$/.test(node.name))wheels.push(node);});
    if (wheels.length !== trafficDefinition(kind).axles*2) throw new Error('Invalid traffic wheel pivots: ' + kind);
    if (kind==='semi' && !model.getObjectByName('trailer')) throw new Error('Missing articulated trailer pivot');
    model.traverse(node=>{if(!node.isMesh)return;for(const material of Array.isArray(node.material)?node.material:[node.material]){
      if(/glass/i.test(material.name)&&!/mirror/i.test(material.name)){material.transparent=true;material.depthWrite=false;material.forceSinglePass=true;material.side=T.FrontSide;material.envMapIntensity=.42;}
      if(/mirror_(?:reflective|reflector|surface)/i.test(material.name)){material.metalness=.96;material.roughness=.1;material.envMapIntensity=1.05;}
    }});
    templates.set(kind,model);
  }
}
export function createTrafficCar(kind='sedan',color=null) {
  kind=normalizeTrafficKind(kind);
  color ||= kind==='towtruck'?'#b78338':'#8a98a2';
  if(!templates.has(kind))throw new Error('Traffic assets are not loaded: '+kind);
  const spec=trafficDefinition(kind),car=templates.get(kind).clone(true),wheels=[];
  let paint=null,brakeMaterial=null;const indicators={};
  car.traverse(node=>{
    if(!node.isMesh&&/^wheel_[a-z0-9_]+$/.test(node.name)){wheels.push(node);node.rotation.order='YXZ';}
    if(!node.isMesh)return;
    node.castShadow=true;node.receiveShadow=true;
    const name=node.material?.name||'';
    if(/glass/i.test(name)&&!/mirror/i.test(name))node.castShadow=false;
    if(name==='body'||name==='body_paint'||name.startsWith('body_paint.')){
      if(!paint){paint=node.material.clone();paint.color.set(color);}node.material=paint;
    }
    if(/^indicator_(left|right)$/.test(name)){if(!indicators[name])indicators[name]=node.material.clone();node.material=indicators[name];}
    if(name==='lights_red'||name.startsWith('lights_red.')){
      if(!brakeMaterial)brakeMaterial=node.material.clone();node.material=brakeMaterial;
    }
  });
  car.userData={...car.userData,kind,category:spec.category,length:spec.length,width:spec.width,height:spec.height,wheelRadius:spec.wheelRadius,wheels,paint,brakeMaterial,indicators,trailer:car.getObjectByName('trailer')||null};
  prepareTrafficRig(car);
  return car;
}

// Runtime-only transform groups keep the authored GLB geometry and draw count.
function prepareTrafficRig(car){
  const data=car.userData,wheels=data.wheels,point=new T.Vector3(),matrix=new T.Matrix4();
  car.updateMatrixWorld(true);
  const rest=wheels.map(wheel=>{
    const inverse=wheel.matrixWorld.clone().invert();let radius=0;
    wheel.traverse(mesh=>{if(!mesh.isMesh)return;matrix.multiplyMatrices(inverse,mesh.matrixWorld);const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(matrix);radius=Math.max(radius,Math.hypot(point.y,point.z));}});
    const center=car.worldToLocal(wheel.getWorldPosition(new T.Vector3()));
    return{wheel,radius,center,front:wheel.name==='wheel_fl'||wheel.name==='wheel_fr'};
  });
  data.wheelRest=rest;
  data.groundY=.01-Math.min(...rest.map(w=>w.center.y-w.radius));
  const tractorWheels=rest.filter(w=>!data.trailer||!isWithin(w.wheel,data.trailer));
  const frontZ=Math.min(...tractorWheels.map(w=>w.center.z)),rearZ=Math.max(...tractorWheels.map(w=>w.center.z));
  data.wheelbase=Math.max(1,rearZ-frontZ);
  function makeRig(parent,name,z){
    const rig=new T.Group();rig.name=name;rig.position.set(0,.62,z);parent.add(rig);parent.updateMatrixWorld(true);
    const meshes=[];parent.traverse(node=>{if(!node.isMesh||wheels.some(w=>isWithin(node,w))||parent!==data.trailer&&data.trailer&&isWithin(node,data.trailer))return;meshes.push(node);});
    for(const mesh of meshes)rig.attach(mesh);
    return rig;
  }
  data.bodyRig=makeRig(car,'sprung_body',(frontZ+rearZ)/2);
  if(data.trailer)data.trailerRig=makeRig(data.trailer,'sprung_trailer',4.5);
  data.motion=createTrafficMotion();
}
function isWithin(node,parent){for(let p=node;p;p=p.parent)if(p===parent)return true;return false;}
export function resetTrafficMotion(car){
  car.userData.motion=createTrafficMotion();
  car.userData.bodyRig.rotation.set(0,0,0);
  if(car.userData.trailerRig)car.userData.trailerRig.rotation.set(0,0,0);
}
export function animateTrafficCar(car,item,distance,dt){
  const data=car.userData,m=updateTrafficMotion(data.motion,item,distance,data.wheelbase,dt),k=curvatureAt(-item.z,distance)+(item.laneCurvature||0);
  data.bodyRig.rotation.set(m.pitch,0,m.roll);
  if(data.trailerRig)data.trailerRig.rotation.set(m.pitch*.3,0,m.roll*.65);
  for(const [name,material] of Object.entries(data.indicators)){
    const side=name==='indicator_left'?-1:1,on=item.signal===side&&Math.floor((item.signalTime||0)*2.8)%2===0;
    material.emissive.set('#ff870a');material.emissiveIntensity=on?3.2:.02;
  }
  for(const {wheel,radius,center,front} of data.wheelRest){
    wheel.rotation.x=(m.distance/radius)%(Math.PI*2);
    wheel.rotation.y=front?steeringForWheel(k,data.wheelbase,center.x):0;
  }
}
