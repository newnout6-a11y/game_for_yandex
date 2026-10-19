import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startServer } from '../scripts/serve.mjs';
test('local server serves modules with correct MIME and does not expose tools or backups', async t => {
  const server = startServer({ port: 0 }); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(url); assert.equal(home.status, 200); assert.match(await home.text(), /Roadster/);
  const module = await fetch(url + '/src/main.js'); assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
  for (const [route,type] of [['/public/assets/car.glb','model/gltf-binary'],['/public/assets/grass_diff.jpg','image/jpeg'],['/public/vendor/draco/draco_decoder.wasm','application/wasm']]) {
    const asset = await fetch(url + route); assert.equal(asset.status,200); assert.equal(asset.headers.get('content-type'),type); await asset.arrayBuffer();
  }
  for (const route of ['/package.json','/output/backups/original-2026-10-15.zip','/.git/config','/src/%2e%2e%5cpackage.json']) {
    const result = await fetch(url + route); assert.equal(result.status, 403, route);
  }
  assert.equal((await fetch(url + '/src/missing.js')).status, 404);
});

/** Native media must expose exact bounded byte ranges for reproducible seeking and looping. */
test('local video server supports MIME, full/HEAD and safe single byte ranges', async t => {
  const server = startServer({port:0}); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/public/assets/garage/roadster-screen-loop.mp4';
  const full = await fetch(url), bytes = new Uint8Array(await full.arrayBuffer());
  assert.equal(full.status,200); assert.equal(full.headers.get('content-type'),'video/mp4');
  assert.equal(full.headers.get('accept-ranges'),'bytes'); assert.equal(Number(full.headers.get('content-length')),bytes.length);
  for (const [range,start,end] of [['bytes=4-19',4,19],['bytes=1707740-',1707740,bytes.length-1],['bytes=-16',bytes.length-16,bytes.length-1],['bytes=0-99999999',0,bytes.length-1]]) {
    const response = await fetch(url,{headers:{Range:range}});
    assert.equal(response.status,206); assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.slice(start,end+1));
  }
  for (const range of ['bytes=99999999-', 'bytes=5-1', 'bytes=-0', 'bytes=-', 'bytes=0-5,8-9','bytes=9007199254740993-']) {
    const response = await fetch(url,{headers:{Range:range}}); assert.equal(response.status,416,range);
    assert.equal(response.headers.get('content-range'),'bytes */'+bytes.length); await response.arrayBuffer();
  }
  const head=await fetch(url,{method:'HEAD'});assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
});
