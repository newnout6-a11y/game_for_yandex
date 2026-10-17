import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { updateScenicLandscape,scenicTerrainHeight } from '../src/landscape.js';
import { roadBend } from '../src/world.js';

import { landscapeFixture as fixture } from './landscape-fixture.mjs';

test('lake uses one lightweight depth-aware mesh with world-anchored filtered waves',()=>{
 const host=fixture(),lake=host.scenery.lake,g=lake.mesh.geometry;
 assert.equal(host.scene.children.filter(o=>o.name==='mountain-lake').length,1);
 assert.ok(g.attributes.position.count<=1500);assert.ok(g.index.count/3<=2500);assert.equal(lake.material.isMeshBasicMaterial,true);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};lake.material.onBeforeCompile(shader);
 assert.equal(shader.uniforms.scenicTime,lake.time);assert.equal(shader.uniforms.scenicDistance,lake.distance);
 assert.match(shader.fragmentShader,/vLakeLocal\s*-\s*vec2\(0\.0,\s*scenicDistance\)/);
 assert.match(shader.fragmentShader,/fwidth\(/);assert.match(shader.fragmentShader,/fresnel/);
});

test('lake depths and bend positions remain aligned with periodic terrain on every route',()=>{
 const host=fixture(),lake=host.scenery.lake,g=lake.mesh.geometry,uv=g.attributes.lakeLocal.array.slice();
 for(const route of ['ring','neon','dawn'])for(const distance of [0,37,799,800,1601,100000]){
  host.time=distance/28;updateScenicLandscape(host,distance,route);assert.equal(lake.distance.value,distance);assert.equal(lake.time.value,host.time);
  for(let i=0;i<g.attributes.position.count;i++){
   const x=uv[i*2],z=uv[i*2+1],depth=Math.max(0,-5.05-scenicTerrainHeight(x,z-distance));
   assert.ok(Math.abs(g.attributes.lakeDepth.getX(i)-depth)<1e-5);
   assert.ok(Math.abs(g.attributes.position.getX(i)-(x+roadBend(z,distance)))<1e-4);
   assert.ok(Number.isFinite(g.attributes.lakeDepth.getX(i)));
  }
 }
 assert.deepEqual(g.attributes.lakeLocal.array,uv,'recycling never changes wave anchor coordinates');
});

test('stationary water animates time without re-uploading geometry or allocating scene roots',()=>{
 const host=fixture(),lake=host.scenery.lake,g=lake.mesh.geometry;updateScenicLandscape(host,125,'ring');
 const p=g.attributes.position.version,d=g.attributes.lakeDepth.version,count=host.scene.children.length;
 host.time=7;updateScenicLandscape(host,125,'ring');assert.equal(lake.time.value,7);assert.equal(lake.distance.value,125);
 assert.equal(g.attributes.position.version,p);assert.equal(g.attributes.lakeDepth.version,d);assert.equal(host.scene.children.length,count);
});

test('original lake normal tile stays small, periodic and mip filtered',()=>{
 const host=fixture(),lake=host.scenery.lake,t=lake.normalMap;
 assert.equal(t.isDataTexture,true);assert.equal(t.image.width,256);assert.equal(t.image.height,256);
 assert.equal(t.image.data.length,256*256*4);assert.equal(t.wrapS,T.RepeatWrapping);assert.equal(t.wrapT,T.RepeatWrapping);
 assert.equal(t.minFilter,T.LinearMipmapLinearFilter);assert.equal(t.generateMipmaps,true);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};lake.material.onBeforeCompile(shader);assert.equal(shader.uniforms.scenicWavelets.value,t);
});
