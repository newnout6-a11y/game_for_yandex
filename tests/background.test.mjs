import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { landscapeFixture } from './landscape-fixture.mjs';
import { updateScenicLandscape } from '../src/landscape.js';

test('distant ranges have finite complete horizon coverage without extra shadow passes',()=>{
 const host=landscapeFixture();assert.equal(host.scenery.ridges.length,3);
 for(const ridge of host.scenery.ridges){
  const g=ridge.geometry;g.computeBoundingBox();const b=g.boundingBox;
  assert.ok(b.min.x < -700 && b.max.x > 700 && b.min.z < -700 && b.max.z > 700,'range surrounds wide and side views');
  assert.ok(g.index.count/3<16000,'bounded distant geometry');assert.equal(ridge.castShadow,false);
  for(const key of ['position','normal','color'])for(const value of g.attributes[key].array)assert.ok(Number.isFinite(value),key);
 }
});

test('sky panorama stays bounded and mip filtered with one environment texture',()=>{
 const host=landscapeFixture(),sky=host.scenery.sky;
 assert.equal(host.scene.background,sky);assert.ok(sky.image.width<=2048&&sky.image.height<=1024);
 assert.equal(sky.mapping,T.EquirectangularReflectionMapping);assert.equal(sky.colorSpace,T.SRGBColorSpace);
 assert.equal(sky.wrapS,T.RepeatWrapping);assert.equal(sky.generateMipmaps,true);assert.equal(sky.minFilter,T.LinearMipmapLinearFilter);
});

test('background geometry and sky are static through distant driving and route changes',()=>{
 const host=landscapeFixture(),sky=host.scenery.sky,skyVersion=sky.version;
 const snapshots=host.scenery.ridges.map(r=>({positions:r.geometry.attributes.position.array.slice(),version:r.geometry.attributes.position.version}));
 for(const route of ['ring','neon','dawn'])for(const distance of [0,799,800,100000]){
  updateScenicLandscape(host,distance,route);
  host.scenery.ridges.forEach((r,i)=>{assert.equal(r.geometry.attributes.position.version,snapshots[i].version);assert.deepEqual(r.geometry.attributes.position.array,snapshots[i].positions);assert.ok(Math.abs(r.position.x)<=22);});
 }
 assert.equal(host.scenery.sky,sky);assert.equal(sky.version,skyVersion);
});
