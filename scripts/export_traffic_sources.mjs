import { mkdir, writeFile } from 'node:fs/promises';
import { TRAFFIC_CATALOG } from '../src/traffic-catalog.js';
import { buildPassengerVehicle } from '../src/traffic-passenger.js';
import { buildHeavyVehicle } from '../src/traffic-heavy.js';
import { buildSpecialVehicle } from '../src/traffic-special.js';
import { basePaint, baseBrake } from '../src/traffic-model-kit.js';

// Lossless, local authoring bridge. Final game models are exported by Blender,
// not constructed from these procedural source surfaces at runtime.
const selected=process.argv.slice(2);const kinds=selected.length?selected:Object.keys(TRAFFIC_CATALOG);
await mkdir('art/traffic/source',{recursive:true});
for(const kind of kinds){
 const spec=TRAFFIC_CATALOG[kind];if(!spec)throw new Error('Unknown traffic kind '+kind);
 const model=spec.category==='freight'?buildHeavyVehicle(kind,spec):spec.category==='special'?buildSpecialVehicle(kind,spec):buildPassengerVehicle(kind,spec);
 const materials=[],materialIds=new Map();let counter=0;
 const material=m=>{if(materialIds.has(m))return materialIds.get(m);const id=materials.length;materialIds.set(m,id);materials.push({name:m===basePaint?'body_paint':m===baseBrake?'lights_red':m.name||`material_${id}`,color:m.color?.toArray()||[1,1,1],metalness:m.metalness??0,roughness:m.roughness??.6,emissive:m.emissive?.toArray()||[0,0,0],emissiveIntensity:m.emissiveIntensity??0,opacity:m.opacity??1,transparent:!!m.transparent,side:m.side,vertexColors:!!m.vertexColors,clearcoat:m.clearcoat??0});return id;};
 const node=n=>{const out={name:n.name||`part_${counter++}`,position:n.position.toArray(),quaternion:n.quaternion.toArray(),scale:n.scale.toArray(),children:n.children.map(node)};if(n.isMesh){const g=n.geometry;out.geometry={positions:Array.from(g.attributes.position.array),normals:Array.from(g.attributes.normal?.array||[]),indices:g.index?Array.from(g.index.array):null,colors:g.attributes.color?Array.from(g.attributes.color.array):null};out.material=material(n.material);}return out;};
 const root=node(model);await writeFile(`art/traffic/source/${kind}.json`,JSON.stringify({kind,spec,axis:'Y-up, front -Z; positions in metres; quaternion x,y,z,w',materials,root}));console.log('Exported authoring source',kind);
}
