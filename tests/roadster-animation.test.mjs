import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { createCar, animatePlayerCar, animatePlayerHardware, setPlayerAeroPose } from '../src/car.js';
import { tuneModelTextureSampling } from '../src/assets.js';
import { createFlightState, updateFlight } from '../src/flight.js';

/** Build a small authored-style player fixture with separate axle carriers and rotating brake discs. */
function playerFixture({ metadata = true, legacy = false } = {}) {
  const model = new T.Group();
  if (metadata) model.userData = { wheelRadius: .38, roadsterVariant: 'rocket' };
  const paint = new T.MeshPhysicalMaterial({ color: '#cccccc', roughness: .31, metalness: .82, clearcoat: .67 });
  paint.name = 'body'; paint.map = new T.DataTexture(new Uint8Array([255,255,255,255]),1,1); paint.normalScale.set(.15,.22);
  const body = new T.Mesh(new T.BoxGeometry(1.6,.35,4.7), paint); body.name = 'body'; body.position.y = .6; model.add(body);
  const glassMaterial = new T.MeshPhysicalMaterial({ color:'#29343b', transparent:true, opacity:.55, roughness:.14 }); glassMaterial.name='rocket_glass';
  const glass = new T.Mesh(new T.BoxGeometry(1.1,.2,1.2), glassMaterial); glass.position.y=.9; model.add(glass);
  const lensMaterial=new T.MeshStandardMaterial({color:'#a51811',emissive:'#d82416',roughness:.21});lensMaterial.name='lights_red';
  lensMaterial.emissiveMap=paint.map;
  const lens=new T.Mesh(new T.BoxGeometry(1.4,.03,.02),lensMaterial);lens.position.set(0,.8,2.2);model.add(lens);
  for(const [name,x,z] of [['fl',-.85,-1.4],['fr',.85,-1.4],['rl',-.85,1.4],['rr',.85,1.4]]) {
    const carrier=new T.Group(); carrier.name='wheel_'+name; carrier.position.set(x,.38,z); model.add(carrier);
    const spinner=legacy?carrier:new T.Group(); if(!legacy){spinner.name='wheel_spin_'+name;carrier.add(spinner);}
    const tire=new T.Mesh(new T.CylinderGeometry(.38,.38,.22,32),new T.MeshStandardMaterial()); tire.rotation.z=Math.PI/2; spinner.add(tire);
    const caliper=new T.Mesh(new T.BoxGeometry(.07,.13,.09),new T.MeshStandardMaterial());caliper.name='caliper_'+name;caliper.position.set(.07,.12,.18);carrier.add(caliper);
  }
  const yoke=new T.Group();yoke.name='steering_yoke';yoke.rotation.x=-.28;model.add(yoke);
  return model;
}

test('Roadster preserves authored paint maps and glazing while isolating instance changes',()=>{
  const template=playerFixture(), source=template.getObjectByName('body').material;
  const authored=createCar(template);assert.equal(authored.userData.paint.color.getHexString(),source.color.getHexString());
  const first=createCar(template,'#b9c4cc'), second=createCar(template,'#885544');
  assert.notEqual(first.userData.paint,source);assert.notEqual(first.userData.paint,second.userData.paint);
  assert.equal(first.userData.paint.map,source.map);assert.equal(first.userData.paint.clearcoat,.67);assert.equal(first.userData.paint.roughness,.31);
  assert.deepEqual(first.userData.paint.normalScale.toArray(),[.15,.22]);assert.equal(source.color.getHexString(),'cccccc');
  let glass;first.traverse(n=>{if(n.material?.name==='rocket_glass')glass=n;});
  assert.equal(glass.castShadow,false);assert.equal(glass.material.depthWrite,false);assert.equal(glass.material.forceSinglePass,true);
  assert.equal(glass.material.opacity,.55);assert.equal(first.userData.variant,'rocket');
  assert.equal(first.userData.brakeMaterial.emissiveMap,source.map);assert.equal(first.userData.brakeMaterial.roughness,.21);
  assert.notEqual(first.userData.brakeMaterial,second.userData.brakeMaterial);
  animatePlayerCar(first,0,0,true);assert.equal(first.userData.brakeMaterial.emissiveIntensity,2);
  assert.notEqual(second.userData.brakeMaterial.emissiveIntensity,2);
});

test('Roadster uses exported or geometry-measured tire radius, not a fixed legacy radius',()=>{
  for(const metadata of [true,false]){
    const car=createCar(playerFixture({metadata}));
    for(const rest of car.userData.wheelRest)assert.ok(Math.abs(rest.radius-.38)<1e-6);
    animatePlayerCar(car,.38*Math.PI/2,0);
    for(const rest of car.userData.wheelRest)assert.ok(Math.abs(rest.spinner.rotation.x+Math.PI/2)<1e-5);
  }
});

test('rotated merged hardware cannot inflate the normalization envelope or lift the tires',()=>{
  const model=playerFixture(), geometry=new T.BufferGeometry(), rotation=Math.PI/4;
  const inverse=new T.Matrix4().makeRotationY(-rotation);
  const points=[[-.8,.6,-2.3],[.8,.6,2.3],[.8,.6,-2.3]].map(p=>new T.Vector3(...p).applyMatrix4(inverse));
  geometry.setFromPoints(points);geometry.computeVertexNormals();
  const hardware=new T.Mesh(geometry,new T.MeshStandardMaterial());hardware.rotation.y=rotation;model.add(hardware);
  assert.ok(new T.Box3().setFromObject(model).getSize(new T.Vector3()).z>4.8,'fixture must reproduce transformed-AABB inflation');
  const car=createCar(model),box=new T.Box3().setFromObject(car,true);
  assert.ok(Math.abs(box.getSize(new T.Vector3()).z-4.7)<1e-6);
  assert.ok(Math.abs(box.min.y)<1e-7);
  for(const wheel of car.userData.wheelRest)assert.ok(Math.abs(wheel.radius-.38)<1e-6);
});

test('steering carriers do not rotate calipers and tire spin cannot tilt the steering axis',()=>{
  const car=createCar(playerFixture());
  for(const distance of [0,1,4,13]){
    animatePlayerCar(car,distance,.25,true);car.updateMatrixWorld(true);
    for(const rest of car.userData.wheelRest){
      assert.equal(rest.carrier.rotation.x,0);assert.equal(rest.carrier.rotation.y,rest.front?-.25:0);
      const axis=new T.Vector3(1,0,0).applyQuaternion(rest.spinner.getWorldQuaternion(new T.Quaternion()));
      assert.ok(Math.abs(axis.y)<1e-10,'local-X spin must not tilt the wheel axle');
      const caliper=rest.carrier.children.find(n=>n.name.startsWith('caliper_'));
      assert.ok(caliper.rotation.toArray().slice(0,3).every(angle=>Math.abs(angle)<1e-12));
    }
  }
  assert.equal(car.userData.brakeMaterial.emissiveIntensity,2);
  assert.notDeepEqual(car.userData.yoke.quaternion.toArray(),car.userData.yokeRest.toArray());
});

test('negative-X wheel spin gives a rearward contact velocity for forward -Z travel',()=>{
  const car=createCar(playerFixture()),rest=car.userData.wheelRest[0], bottom=new T.Vector3(0,-rest.radius,0);
  animatePlayerCar(car,.01,0);
  const turned=bottom.clone().applyEuler(rest.spinner.rotation);
  assert.ok(turned.z>0,'ground contact moves backward relative to a forward-going chassis');
  assert.ok(Math.abs(turned.z-.01)<.00001);
});

test('legacy single-pivot wheels remain steerable at every spin phase without mutating the template',()=>{
  const template=playerFixture({legacy:true}),car=createCar(template);
  for(const distance of [0,1,5]){
    animatePlayerCar(car,distance,-.3);car.updateMatrixWorld(true);
    const axis=new T.Vector3(1,0,0).applyQuaternion(car.userData.wheels[0].getWorldQuaternion(new T.Quaternion()));
    assert.ok(Math.abs(axis.y)<1e-10);assert.ok(Math.abs(axis.z+Math.sin(.3))<1e-10);
  }
  assert.equal(template.getObjectByName('wheel_fl').rotation.order,'XYZ');
  assert.equal(template.getObjectByName('wheel_fl').rotation.x,0);
});

test('embedded cabin maps reuse the capped sampling budget without changing glTF color or mip semantics',()=>{
  const model=playerFixture(),map=model.getObjectByName('body').material.map;
  map.colorSpace=T.SRGBColorSpace;map.minFilter=T.LinearMipmapLinearFilter;
  const beforeVersion=map.version;
  assert.equal(tuneModelTextureSampling(model,4),1);
  assert.equal(map.anisotropy,4);assert.equal(map.version,beforeVersion+1);
  assert.equal(map.colorSpace,T.SRGBColorSpace);assert.equal(map.minFilter,T.LinearMipmapLinearFilter);
  tuneModelTextureSampling(model,NaN);assert.equal(map.anisotropy,1);
});

test('opaque console glass remains opaque and is not mistaken for a transparent window',()=>{
  const model=playerFixture(),material=new T.MeshPhysicalMaterial({color:'#07090b',roughness:.12,metalness:.08});
  material.name='RC_Dark_Console_Touch_Glass';
  const consolePane=new T.Mesh(new T.BoxGeometry(.2,.01,.25),material);consolePane.name='console_touch';model.add(consolePane);
  const car=createCar(model),pane=car.getObjectByName('console_touch');
  assert.equal(pane.material.transparent,false);assert.equal(pane.material.depthWrite,true);
  assert.equal(pane.castShadow,true);assert.equal(material.transparent,false);
});

test('wing lifts before tip unfolding and reverses into its authored mechanical pocket without scaling',()=>{
  const template=playerFixture(),lift=new T.Group(),tip=new T.Group(),fan=new T.Group();
  lift.name='wing_carriage';lift.position.set(0,1.1,2);lift.userData={aeroRole:'lift',aeroStowPositionOffset:[0,-.3,0]};
  tip.name='wing_tip_l';tip.userData={aeroRole:'tip',aeroStowAxis:[0,0,1],aeroStowAngle:Math.PI/2};lift.add(tip);template.add(lift);
  fan.name='fan_0';template.add(fan);const car=createCar(template),l=car.getObjectByName(lift.name),t=car.getObjectByName(tip.name);
  setPlayerAeroPose(car,0);assert.ok(Math.abs(l.position.y-.8)<1e-12);assert.ok(Math.abs(t.rotation.z-Math.PI/2)<1e-12);
  setPlayerAeroPose(car,.4);assert.ok(l.position.y>.8);assert.ok(Math.abs(t.rotation.z-Math.PI/2)<1e-12);
  setPlayerAeroPose(car,1);assert.equal(l.position.y,1.1);assert.ok(Math.abs(t.rotation.z)<1e-12);
  setPlayerAeroPose(car,.4);assert.ok(Math.abs(t.rotation.z-Math.PI/2)<1e-12);
  for(const part of car.userData.aero){assert.deepEqual(part.node.scale.toArray(),[1,1,1]);assert.equal(part.node.visible,true);}
  assert.equal(template.getObjectByName(lift.name).position.y,1.1);assert.equal(template.getObjectByName(tip.name).rotation.z,0);
});

test('aero and fan state is bounded, continuous, instance-local and frozen while paused',()=>{
  const template=playerFixture(),fan=new T.Group();fan.name='fan_0';template.add(fan);
  const car=createCar(template),other=createCar(template),state={phase:'playing',speed:30,altitude:3.3,thrusterPower:.8};
  animatePlayerHardware(car,state,1/60);assert.equal(car.userData.aeroDeployment,.025);assert.ok(car.userData.fanPhase>0);
  const q=car.getObjectByName('fan_0').quaternion.toArray(),deployment=car.userData.aeroDeployment;
  animatePlayerHardware(car,state,0);assert.deepEqual(car.getObjectByName('fan_0').quaternion.toArray(),q);assert.equal(car.userData.aeroDeployment,deployment);
  for(let i=0;i<90;i++)animatePlayerHardware(car,state,1/60);assert.equal(car.userData.aeroDeployment,1);
  for(let i=0;i<90;i++)animatePlayerHardware(car,{phase:'menu'},1/60);assert.equal(car.userData.aeroDeployment,0);
  assert.equal(other.userData.fanPhase,0);assert.equal(template.getObjectByName('fan_0').rotation.z,0);
});

test('authored wing sequencing uses a validated per-part deployment interval',()=>{
  const model=playerFixture(),tip=new T.Group();tip.name='late_tip';
  tip.userData={aeroRole:'tip',aeroStowAxis:[0,0,1],aeroStowAngle:1.2,aeroDeployStart:.7,aeroDeployEnd:1};model.add(tip);
  const car=createCar(model),part=car.getObjectByName('late_tip');
  setPlayerAeroPose(car,.7);assert.ok(Math.abs(part.rotation.z-1.2)<1e-12);
  setPlayerAeroPose(car,.85);assert.ok(Math.abs(part.rotation.z-.6)<1e-12);
  setPlayerAeroPose(car,1);assert.ok(Math.abs(part.rotation.z)<1e-12);
  for(const values of [[1,1],[-1,.5],[.7,2],[NaN,1]]){
    tip.userData.aeroDeployStart=values[0];tip.userData.aeroDeployEnd=values[1];
    const fallback=createCar(model);setPlayerAeroPose(fallback,.4);
    assert.ok(Math.abs(fallback.getObjectByName('late_tip').rotation.z-1.2)<1e-12);
  }
});

test('ground contact stows the wing despite high speed, braking, boost and residual landing thrust',()=>{
  const car=createCar(playerFixture());
  setPlayerAeroPose(car,1);
  const ground={phase:'playing',speed:65,altitude:0,flying:false,rolling:false,
    braking:true,boosting:true,thrusterPower:.9,touchdownPulse:1};
  animatePlayerHardware(car,ground,0);assert.equal(car.userData.aeroDeployment,1,'pause must not advance retraction');
  let previous=1;
  for(let frame=0;frame<60;frame++){
    animatePlayerHardware(car,ground,1/60);
    const amount=car.userData.aeroDeployment;
    assert.ok(amount<=previous && previous-amount<=.025000001,'landing retraction must be bounded and monotonic');
    previous=amount;
  }
  assert.equal(previous,0,'ground aero demand must not override landing stow');
  animatePlayerHardware(car,{...ground,flying:true,altitude:.001},1/60);
  assert.equal(car.userData.aeroDeployment,.025,'a new authorized takeoff raises the wing again');
  animatePlayerHardware(car,{phase:'menu'},0);
  assert.equal(car.userData.aeroDeployment,0,'menu/retry must not retain the prior flight pose');
});

test('real repeated lift and soft touchdown preserve the wing until contact, then fully stow',()=>{
  const car=createCar(playerFixture()),dt=1/60;
  for(let cycle=0;cycle<3;cycle++){
    const state={...createFlightState(),phase:'playing',speed:58,nitro:100};
    let landed=false,contactFrame=-1,airborneSeen=false;
    for(let frame=0;frame<600;frame++){
      updateFlight(state,dt,{flight:frame<150,brake:0,roll:0},event=>{if(event==='land'){landed=true;contactFrame=frame;}});
      const before=car.userData.aeroDeployment;
      animatePlayerHardware(car,state,dt);
      if(state.altitude>0){
        airborneSeen=true;
        assert.ok(car.userData.aeroDeployment>=before,'no early folding during the final low flare');
      }
      if(landed && frame===contactFrame) assert.ok(state.thrusterPower>.12,'fixture must exercise residual touchdown thrust');
      if(landed && frame>contactFrame+45) assert.equal(car.userData.aeroDeployment,0);
    }
    assert.ok(airborneSeen && landed,'each cycle must take off and genuinely land');
    assert.equal(car.userData.aeroDeployment,0);
  }
});
