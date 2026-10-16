import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startServer } from '../scripts/serve.mjs';
test('local server serves modules with correct MIME and does not expose tools or backups', async t => {
  const server = startServer({ port: 0 }); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(url); assert.equal(home.status, 200); assert.match(await home.text(), /ПОТОК/);
  const module = await fetch(url + '/src/main.js'); assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
  for (const [route,type] of [['/public/assets/car.glb','model/gltf-binary'],['/public/assets/grass_diff.jpg','image/jpeg'],['/public/vendor/draco/draco_decoder.wasm','application/wasm']]) {
    const asset = await fetch(url + route); assert.equal(asset.status,200); assert.equal(asset.headers.get('content-type'),type); await asset.arrayBuffer();
  }
  for (const route of ['/package.json','/output/backups/original-2026-10-15.zip','/.git/config','/src/%2e%2e%5cpackage.json']) {
    const result = await fetch(url + route); assert.equal(result.status, 403, route);
  }
  assert.equal((await fetch(url + '/src/missing.js')).status, 404);
});
