import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ROCKET_CONTACT_SHAPE} from '../src/player-contact-shape.js';
const proof=JSON.parse(await readFile(new URL('../docs/handling-contact-metrics/rocket-compound.json',import.meta.url),'utf8'));
test('measured Rocket proxies remain tied to the unchanged authored GLB',async()=>{
 const bytes=await readFile(new URL('../'+proof.sourceAsset.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),proof.sourceAsset.sha256);
 assert.equal(ROCKET_CONTACT_SHAPE.length,9);
 for(const p of proof.rectangles){const actual=ROCKET_CONTACT_SHAPE.find(q=>q.id===p.id);assert.ok(actual,p.id);
  for(const key of ['role','centerX','centerY','centerZ','halfWidth','halfHeight','halfLength'])assert.equal(actual[key],p[key],p.id+'.'+key);
  assert.ok(actual.centerY-actual.halfHeight<=p.actualMinY+1e-9);assert.ok(actual.centerY+actual.halfHeight>=p.actualMaxY-1e-9);
 }
});
test('mirrors and wheel shoulders stay local instead of broadening the entire nose',()=>{
 const nose=ROCKET_CONTACT_SHAPE.find(p=>p.id==='nose'),mirror=ROCKET_CONTACT_SHAPE.find(p=>p.id==='mirror_left'),wheel=ROCKET_CONTACT_SHAPE.find(p=>p.id==='front_wheel_left');
 assert.equal(mirror.role,'mirror');assert.equal(wheel.role,'wheel');assert.ok(nose.halfWidth<1);assert.ok(mirror.centerZ-mirror.halfLength>nose.centerZ+nose.halfLength);assert.ok(wheel.centerX-wheel.halfWidth<=-1.14351132);
});
