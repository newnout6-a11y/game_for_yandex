import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import {loadRoadsterGeometry} from './helpers/roadster-geometry.mjs';
import {createOwnedVehicle,applyVehicleAppearance} from '../src/owned-vehicles.js';
import {installTrafficTemplates,TRAFFIC_KINDS} from '../src/traffic.js';
const car=(await loadRoadsterGeometry()).scene,traffic={};
for(const id of TRAFFIC_KINDS)traffic[id]=(await loadRoadsterGeometry(new URL(`../public/assets/traffic/${id}.glb`,import.meta.url))).scene;
installTrafficTemplates(traffic);
const cosmetics={};for(const [key,name]of [['body','body-splitter'],['left','wheel-turbine-left'],['right','wheel-turbine-right'],['louver','body-louver'],['copperLeft','rim-copper-left'],['copperRight','rim-copper-right']])cosmetics[key]=(await loadRoadsterGeometry(new URL(`../public/assets/garage-cosmetics/${name}.glb`,import.meta.url))).scene;
for(const [key,name]of [['steeringRound','steering-round'],['steeringYoke','steering-yoke']])cosmetics[key]=(await loadRoadsterGeometry(new URL(`../public/assets/cosmetics/${name}.glb`,import.meta.url))).scene;
const assets={car,traffic,cosmetics};
/** Capture visible collision-independent buffers for reversible appearance checks. */
const signature=root=>{const out=[];root.traverse(n=>{if(n.isMesh)out.push([n.geometry,n.material?.name]);});return out;};
test('appearance changes clone materials and never mutate template or another owned car',()=>{
 const a=createOwnedVehicle(assets,'rocket'),b=createOwnedVehicle(assets,'rocket');
 const before=b.userData.appearance.paint[0].material.color.getHex(),template=car.getObjectByName('body')?.material?.color.getHex();
 applyVehicleAppearance(a,{'body.paint':'paint_copper','body.finish':'finish_satin','wheels.finish':'rim_graphite'});
 assert.notEqual(a.userData.appearance.paint[0].material.color.getHex(),before);assert.equal(b.userData.appearance.paint[0].material.color.getHex(),before);
 assert.equal(car.getObjectByName('body')?.material?.color.getHex(),template);
 const copy=a.userData.appearance.paint[0];applyVehicleAppearance(a,{});assert.equal(copy.material.color.getHex(),copy.base.color.getHex());assert.equal(copy.material.roughness,copy.base.roughness);
});
test('authored parts mount once under real sprung/spin rigs and can be removed without geometry changes',()=>{
 const model=createOwnedVehicle(assets,'rocket'),initial=signature(model);
 applyVehicleAppearance(model,{'body.addon':'body_splitter','wheels.geometry':'wheel_turbine','cockpit.trim':'cockpit_stitch'});
 const parts=model.userData.cosmeticParts;assert.equal(parts.body.parent,model.userData.bodyRig);assert.equal(parts.body.visible,true);assert.equal(parts.wheels.length,4);
 for(let i=0;i<4;i++){assert.equal(parts.wheels[i].parent,model.userData.wheelRest[i].spinner);assert.equal(parts.wheels[i].visible,true);}
 assert.ok(model.userData.appearance.stitch.length>0);
 applyVehicleAppearance(model,{});assert.equal(parts.body.visible,false);assert.ok(parts.wheels.every(p=>!p.visible));assert.deepEqual(signature(model),initial);
});
for(const id of ['hatch','sedan','suv','van'])test(`${id}: purchased car retains its actual dimensions and has working paint/rim slots`,()=>{
 const model=createOwnedVehicle(assets,id,{'body.paint':'paint_glacier','wheels.finish':'rim_graphite'}),size=new T.Box3().setFromObject(model,true).getSize(new T.Vector3());
 assert.ok(Math.abs(size.z-model.userData.length)<.06);assert.ok(model.userData.appearance.paint.length>0);assert.ok(model.userData.appearance.rims.length>0);
 assert.equal(model.userData.cosmeticParts,undefined);assert.equal(model.userData.ownedVehicleId,id);
});

test('rear louver and copper rings are real reversible parts without replacing wheel tyres',()=>{
 const model=createOwnedVehicle(assets,'rocket',{'body.addon':'body_louver','wheels.finish':'rim_copper','wheels.geometry':'wheel_turbine'});const p=model.userData.cosmeticParts;
 assert.equal(p.louver.visible,true);assert.equal(p.body.visible,false);assert.equal(p.copper.length,4);assert.ok(p.copper.every(n=>n.visible));assert.ok(p.wheels.every(n=>n.visible));
 const base=model.userData.wheelRest.map(w=>w.spinner.children[0]);applyVehicleAppearance(model,{});assert.equal(p.louver.visible,false);assert.ok(p.copper.every(n=>!n.visible));assert.deepEqual(model.userData.wheelRest.map(w=>w.spinner.children[0]),base);
});

test('both actual authored steering variants replace only the original grip assembly and inherit its animation pivot',()=>{
 const model=createOwnedVehicle(assets,'rocket'),yoke=model.userData.yoke,original=model.userData.originalSteeringMeshes,parts=model.userData.cosmeticParts;
 assert.equal(original.length,5);assert.ok(original.every(n=>n.visible));const position=yoke.position.clone(),rotation=yoke.quaternion.clone();
 for(const [id,key]of [['steering_round','steeringRound'],['steering_yoke','steeringYoke']]){
  applyVehicleAppearance(model,{'cockpit.steering':id});assert.ok(original.every(n=>!n.visible));assert.equal(parts[key].parent,yoke);assert.equal(parts[key].visible,true);assert.deepEqual(parts[key].position.toArray(),[0,0,0]);assert.deepEqual(parts[key].scale.toArray(),[1,1,1]);
  assert.ok(yoke.position.equals(position));assert.ok(yoke.quaternion.equals(rotation));
 }
 applyVehicleAppearance(model,{});assert.ok(original.every(n=>n.visible));assert.equal(parts.steeringRound.visible,false);assert.equal(parts.steeringYoke.visible,false);
});
