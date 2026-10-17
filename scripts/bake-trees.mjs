// Bake artist-created foliage into transparent, lit impostors for mobile GPUs.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
/**
 * Serve a loopback bake page, vendored JS and downloaded foliage sources.
 * Resolves source assets below output/assets-source and rejects path escape;
 * this temporary authoring server is not the release server.
 * @param {http.IncomingMessage} req - Requested bake resource.
 * @param {http.ServerResponse} res - Response receiving local bytes or 404.
 */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<canvas></canvas>'); return; }
    const base = url.pathname.startsWith('/public/vendor/') ? process.cwd() : path.resolve('output/assets-source');
    const file = path.resolve(base, '.' + url.pathname);
    if (!file.startsWith(base + path.sep)) throw Error('Path');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(e));
  await page.goto('http://127.0.0.1:' + server.address().port);
  /**
   * Bake each source-tree child into an independent 1024px transparent PNG.
   * Recenters cloned geometry, fits an orthographic camera with 6% padding and
   * uses daylight lighting. Returns data URLs; disposes the temporary renderer.
   * This is a fixed lit impostor bake, not a runtime geometry or FPS test.
   */
  const images = await page.evaluate(async () => {
    const T = await import('/public/vendor/three.js');
    const gltf = await new T.GLTFLoader().loadAsync('/public/fir/tree.gltf');
    const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1024, 1024); renderer.setClearColor(0, 0);
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const scene = new T.Scene(); scene.add(new T.HemisphereLight(0xe1edff, 0x6f784b, 2));
    const sun = new T.DirectionalLight(0xfff1da, 3.2); sun.position.set(-6, 10, 7); scene.add(sun);
    const images = [];
    for (const original of [...gltf.scene.children]) {
      const tree = original.clone(); tree.position.set(0, 0, 0); scene.add(tree);
      const box = new T.Box3().setFromObject(tree), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
      tree.position.x -= center.x; tree.position.y -= box.min.y; tree.position.z -= center.z;
      const span = Math.max(size.y, size.x) * 1.06;
      const camera = new T.OrthographicCamera(-span/2, span/2, span/2, -span/2, .01, 100);
      camera.position.set(0, size.y/2, 20); camera.lookAt(0, size.y/2, 0);
      renderer.render(scene, camera); images.push(renderer.domElement.toDataURL('image/png')); scene.remove(tree);
    }
    renderer.dispose(); return images;
  });
  const manifest = JSON.parse(await readFile('public/assets/manifest.json', 'utf8')).filter(m => !m.file.includes('/fir-'));
  for (let i = 0; i < images.length; i++) {
    const data = Buffer.from(images[i].split(',')[1], 'base64'), file = `public/assets/fir-${i}.png`;
    await writeFile(file, data);
    manifest.push({ file: file.replace('public/', ''), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), license: 'CC0-1.0', source: 'https://polyhaven.com/a/fir_sapling', changes: 'Transparent orthographic rendering with daylight; original by Rico Cilliers / Poly Haven.' });
    console.log(file, data.length);
  }
  await writeFile('public/assets/manifest.json', JSON.stringify(manifest, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
