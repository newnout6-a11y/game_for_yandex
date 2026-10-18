import * as T from '../public/vendor/three.js';
import { createCar, animatePlayerHardware } from './car.js';
import { createTrafficCar } from './traffic.js';
import { cosmeticDefinition, vehicleDefinition } from './progression-catalog.js';

/** Authored rotor-scoring surfaces share a historical metal batch, but are not a rim finish. */
export function isRotorScoreVertex(x,y,z){const r=Math.hypot(y,z);return Math.abs(Math.abs(x)-.058)<.0011&&(Math.abs(r-.228)<.0011||Math.abs(r-.241)<.0011);}

/** Preserve those exact inset brake rings in the existing single draw, without new geometry or template edits. */
function preserveRotorScoring(material,source){
  const original=material.onBeforeCompile,cache=material.customProgramCacheKey.call(material),base=source.color.clone();
  material.onBeforeCompile=(shader,renderer)=>{original.call(material,shader,renderer);shader.uniforms.garageBrakeBaseColor={value:base};
    shader.vertexShader='varying float vGarageBrakeScore;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n float scoreRadius=length(position.yz); vGarageBrakeScore=(abs(abs(position.x)-0.058)<0.0011 && (abs(scoreRadius-0.228)<0.0011 || abs(scoreRadius-0.241)<0.0011))?1.0:0.0;');
    shader.fragmentShader='varying float vGarageBrakeScore;\nuniform vec3 garageBrakeBaseColor;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','if(vGarageBrakeScore>0.5) diffuseColor.rgb=garageBrakeBaseColor;\n#include <map_fragment>');
  };material.customProgramCacheKey=()=>cache+':preserve-authored-brake-score-v1';material.needsUpdate=true;
}

/** Clone only mutable appearance materials; templates, tyres, glass and safety lamps retain their authored values. */
export function prepareVehicleAppearance(car, id='rocket') {
  if (car.userData.appearance) return car;
  const copies=new Map(), slots={paint:[],rims:[],ambient:[],stitch:[],glass:[]};
  car.traverse(node=>{
    if(!node.isMesh||Array.isArray(node.material))return;
    const source=node.material,name=source.name||'';let ancestor=node.parent,wheel=null,inSpinner=false;
    while(ancestor){if(/^wheel_spin_/.test(ancestor.name))inSpinner=true;if(/^wheel_(?:fl|fr|rl|rr)$/.test(ancestor.name)){wheel=ancestor;break;}ancestor=ancestor.parent;}
    const glazing=(/glass|glazing/i.test(name)&&source.transparent&&source.opacity<1);
    const slot=/^body(?:_|$)/.test(name)?'paint':wheel&&inSpinner&&id==='rocket'&&/^(brushed_alloy|graphite_alloy)$/.test(name)?'rims':wheel&&id!=='rocket'&&name==='wheel_metal'?'rims':/RC_Red_Indirect_Ambient/.test(name)?'ambient':/RC_Ivory_Double_Stitch/.test(name)?'stitch':glazing?'glass':null;
    if(!slot)return;
    // Each rim gets its own small material instance so the wipe spans one disc,
    // not the entire wheelbase; templates and other cars remain immutable.
    const key=slot==='rims'?`${source.uuid}:${wheel.uuid}`:source;
    if(!copies.has(key)){const material=source.clone();if(slot==='rims'&&id==='rocket'&&name==='graphite_alloy')preserveRotorScoring(material,source);copies.set(key,material);slots[slot].push({material,base:source.clone(),root:slot==='rims'?wheel:null,source});}
    node.material=copies.get(key);
  });
  for(const entry of car.userData.glazing||[]){const slot=slots.glass.find(value=>value.source===entry.material);if(slot)entry.material=slot.material;}
  car.userData.appearance=slots; car.userData.ownedAppearanceMaterials=[...(car.userData.ownedAppearanceMaterials||[]),...copies.values(),...Object.values(slots).flat().map(s=>s.base)];
  car.userData.ownedVehicleId=id;return car;
}

/** Apply verified owned material choices without changing geometry or simulation bounds; repeated selection is reversible. */
export function applyVehicleAppearance(car, cosmetics={}) {
  const slots=car.userData.appearance;if(!slots)return;
  for(const entries of Object.values(slots))for(const {material,base}of entries)material.copy(base);
  const paint=cosmeticDefinition(cosmetics['body.paint']),rim=cosmeticDefinition(cosmetics['wheels.finish']),theme=cosmeticDefinition(cosmetics['cockpit.theme']);
  for(const {material}of slots.paint){if(paint?.color)material.color.set(paint.color);if(cosmetics['body.finish']==='finish_satin'){material.roughness=.48;if('clearcoat'in material)material.clearcoat=.32;}}
  for(const {material}of slots.rims)if(rim?.color)material.color.set(rim.color);
  const tint=cosmeticDefinition(cosmetics['body.tint']);
  for(const {material,base}of slots.glass||[]){if(tint?.tintColor){material.color.set(tint.tintColor);material.opacity=Math.min(.92,base.opacity+tint.opacityIncrease);}material.depthWrite=false;material.forceSinglePass=true;}
  for(const entry of car.userData.glazing||[]){entry.opacity=entry.material.opacity;entry.envMapIntensity=entry.material.envMapIntensity;}
  for(const {material}of slots.ambient)if(theme?.color){material.color.set(theme.color);material.emissive?.set(theme.color);}
  for(const {material}of slots.stitch)if(cosmetics['cockpit.trim']==='cockpit_stitch')material.color.set('#c77643');
  car.userData.cockpitTheme=theme?.id||'stock';
  applyAuthoredParts(car,cosmetics);
}

/** Make a genuine authored selected vehicle; ground fleet assets are never normalized to the Rocket's length. */
export function createOwnedVehicle(assets,id='rocket',cosmetics={}) {
  const definition=vehicleDefinition(id);if(!definition)throw new Error('Unknown owned vehicle: '+id);
  const car=id==='rocket'?createCar(assets.car):createTrafficCar(id);
  const shared=new Set();(id==='rocket'?assets.car:assets.traffic[id]).traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])shared.add(m);});
  const owned=new Set();car.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!shared.has(m))owned.add(m);});
  car.userData.ownedAppearanceMaterials=[...owned];car.userData.cosmeticTemplates=assets.cosmetics||null;
  prepareVehicleAppearance(car,id);applyVehicleAppearance(car,cosmetics);
  if(id==='rocket')animatePlayerHardware(car,{phase:'menu',speed:0},0);
  return car;
}

/** Load optional authored geometry once; failure keeps geometry-dependent products unavailable, never substitutes boxes. */
export async function loadGarageCosmetics(assets) {
  const capabilities={},loader=new T.GLTFLoader();
  const records=[['body','body-splitter','cosmetic_body_splitter'],['left','wheel-turbine-left','cosmetic_wheel_turbine_left'],['right','wheel-turbine-right','cosmetic_wheel_turbine_right'],['louver','body-louver','cosmetic_body_louver'],['copperLeft','rim-copper-left','cosmetic_rim_copper_left'],['copperRight','rim-copper-right','cosmetic_rim_copper_right']];
  assets.cosmetics={};
  await Promise.all(records.map(async([key,file,root])=>{try{const gltf=await loader.loadAsync(new URL('../public/assets/garage-cosmetics/'+file+'.glb',import.meta.url).href);if(!gltf.scene.getObjectByName(root))throw new Error('Malformed cosmetic root');assets.cosmetics[key]=gltf.scene;}catch(error){console.warn('Optional cosmetic unavailable: '+file,error.message);}}));
  capabilities['body.splitter']=!!assets.cosmetics.body;capabilities['body.louver']=!!assets.cosmetics.louver;
  capabilities['wheels.turbine']=!!(assets.cosmetics.left&&assets.cosmetics.right);capabilities['rims.copperAccent']=!!(assets.cosmetics.copperLeft&&assets.cosmetics.copperRight);
  let seam=false;assets.car.traverse(node=>{if(node.isMesh&&node.name==='detail_rc_stitch'&&node.material?.name==='RC_Ivory_Double_Stitch'&&node.geometry?.attributes.position?.count>0)seam=true;});
  capabilities['cockpit.stitch']=seam;
  await Promise.all([['steeringRound','steering-round','cosmetic_steering_round','cockpit.steeringRound'],['steeringYoke','steering-yoke','cosmetic_steering_yoke','cockpit.steeringYoke']].map(async([key,file,root,capability])=>{
    try{const gltf=await loader.loadAsync(new URL('../public/assets/cosmetics/'+file+'.glb',import.meta.url).href);if(!gltf.scene.getObjectByName(root))throw new Error('Malformed steering root');assets.cosmetics[key]=gltf.scene;capabilities[capability]=true;}
    catch(error){capabilities[capability]=false;console.warn('Optional steering unavailable: '+file,error.message);}
  }));
  return capabilities;
}

/** Mount real optional parts beneath the reviewed sprung body and wheel-spin nodes; base tyres and colliders stay unchanged. */
function applyAuthoredParts(car,cosmetics){
  if(car.userData.ownedVehicleId!=='rocket')return;
  const templates=car.userData.cosmeticTemplates;if(!templates)return;
  const mounted=car.userData.cosmeticParts ||= {};
  if(templates.body&&!mounted.body){mounted.body=templates.body.clone(true);mounted.body.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});car.userData.bodyRig.add(mounted.body);}
  if(mounted.body)mounted.body.visible=cosmetics['body.addon']==='body_splitter';
  if(templates.left&&templates.right&&!mounted.wheels){mounted.wheels=[];for(const rest of car.userData.wheelRest){const left=rest.carrier.name.endsWith('l'),part=(left?templates.left:templates.right).clone(true);part.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});rest.spinner.add(part);mounted.wheels.push(part);}}
  for(const part of mounted.wheels||[])part.visible=cosmetics['wheels.geometry']==='wheel_turbine';
  if(templates.louver&&!mounted.louver){mounted.louver=templates.louver.clone(true);mounted.louver.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});car.userData.bodyRig.add(mounted.louver);}
  if(mounted.louver)mounted.louver.visible=cosmetics['body.addon']==='body_louver';
  if(templates.copperLeft&&templates.copperRight&&!mounted.copper){mounted.copper=[];for(const rest of car.userData.wheelRest){const part=(rest.carrier.name.endsWith('l')?templates.copperLeft:templates.copperRight).clone(true);part.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});rest.spinner.add(part);mounted.copper.push(part);}}
  for(const part of mounted.copper||[])part.visible=cosmetics['wheels.finish']==='rim_copper';
  const yoke=car.userData.yoke;
  if(yoke){
    const original=car.userData.originalSteeringMeshes ||= yoke.children.filter(node=>node.isMesh&&/^steering_yoke_rc_(?:black|carbon|ivory|liner|metal)$/.test(node.name));
    for(const key of ['steeringRound','steeringYoke'])if(templates[key]&&!mounted[key]){mounted[key]=templates[key].clone(true);mounted[key].traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});yoke.add(mounted[key]);}
    const selected=cosmetics['cockpit.steering']==='steering_round'&&mounted.steeringRound?'steeringRound':cosmetics['cockpit.steering']==='steering_yoke'&&mounted.steeringYoke?'steeringYoke':null;
    for(const node of original)node.visible=!selected;
    for(const key of ['steeringRound','steeringYoke'])if(mounted[key])mounted[key].visible=key===selected;
  }
}
