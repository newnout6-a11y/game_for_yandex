import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TRAFFIC_KINDS, TRAFFIC_CATALOG } from '../src/traffic-catalog.js';

test('all eight runtime traffic GLBs have editable Blender project sources and animation nodes', async()=>{
 for(const kind of TRAFFIC_KINDS){
  const blend=await readFile(`art/traffic/${kind}.blend`);assert.equal(blend.subarray(0,7).toString(),'BLENDER',kind+' editable source');
  const bytes=await readFile(`public/assets/traffic/${kind}.glb`);assert.equal(bytes.readUInt32LE(0),0x46546c67);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  const wheels=gltf.nodes.filter(n=>/^wheel_[a-z0-9_]+$/.test(n.name||'')&&n.mesh===undefined);
  assert.equal(wheels.length,TRAFFIC_CATALOG[kind].axles*2,kind);
  for(const name of (kind==='semi'?['wheel_fl','wheel_fr']:['wheel_fl','wheel_fr','wheel_rl','wheel_rr']))assert.ok(wheels.some(n=>n.name===name),kind+' '+name);
  if(kind==='semi')assert.ok(gltf.nodes.some(n=>n.name==='trailer'));
  assert.ok(gltf.materials.some(m=>m.name==='lights_red'));
  assert.ok(!gltf.extensionsUsed?.includes('KHR_draco_mesh_compression'),'plain interoperable GLB');
 }
});
test('runtime loads Blender traffic assets, never procedural substitutes',async()=>{
 const runtime=await readFile('src/traffic.js','utf8'),assets=await readFile('src/assets.js','utf8');
 assert.doesNotMatch(runtime,/from ['"].*traffic-(?:passenger|heavy|special|model-kit)/);
 assert.match(assets,/gltf\.loadAsync\(base \+ 'traffic\//);
 assert.match(runtime,/Missing Blender traffic asset/);
});
