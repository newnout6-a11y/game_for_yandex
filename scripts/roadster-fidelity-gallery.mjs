import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startServer } from './serve.mjs';

// Identical inspection cameras for the accepted baseline and rebuilt Blender GLB.
// No mesh is replaced with reference photography; every capture uses createCar().
const stage = process.argv[2] || 'after';
const root = path.resolve(process.env.ROADSTER_GALLERY_ROOT || process.cwd());
const assetBytes = await readFile(path.join(root, 'public/assets/roadster.glb'));
const assetSha256 = createHash('sha256').update(assetBytes).digest('hex');
const out = process.env.ROADSTER_GALLERY_OUT || `output/roadster-fidelity-${stage}`;
const viewport = {width:Number(process.env.ROADSTER_GALLERY_WIDTH)||1440,height:Number(process.env.ROADSTER_GALLERY_HEIGHT)||1000};
const views = (process.env.ROADSTER_GALLERY_VIEWS || 'front,rear,side,top,wheel,cabin,dashboard,underbody').split(',');
await mkdir(out, { recursive: true });
const server = startServer({ port: 0, root }); await once(server, 'listening');
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }),
  headless: true,
  args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [],
});
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  // Freeze the exact bytes read above while Blender may export the next candidate.
  // The production GLTFLoader still parses those unchanged bytes and embedded maps.
  await page.route('**/public/assets/roadster.glb', route => route.fulfill({ body: assetBytes, contentType: 'model/gltf-binary' }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /WebGL|THREE|shader/.test(message.text())) errors.push(message.text()); });
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('#loadStatus').hidden, null, { timeout: 120000 });
  /** Replace only the fixture's draw hook so paused inspection draws can reuse the loaded production renderer. */
  await page.evaluate(async () => {
    const { RoadRenderer } = await import('./src/world.js');
    /** Capture the initialized renderer without advancing GPU scenery during controlled-time inspection. */
    RoadRenderer.prototype.render = function () { window.__roadsterWorld = this; };
  });
  const now = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(now + 100));
  await page.clock.runFor(32); await page.waitForFunction(() => window.__roadsterWorld);
  await page.addStyleTag({ content: '#menu,.topbar,#hud,.scene-shade,#overlay{display:none!important}#roadster-caption{position:fixed;left:32px;top:24px;padding:12px 18px;background:rgba(231,239,242,.9);border-radius:10px;color:#24333c;font:16px Arial;z-index:1000;line-height:1.45;pointer-events:none}' });
  /** Build an original neutral inspection studio around the real production player model and sky reflections. */
  await page.evaluate(async authoredPaint => {
    const T = await import('./public/vendor/three.js'), { createCar, setPlayerAeroPose } = await import('./src/car.js');
    const w = window.__roadsterWorld, scene = new T.Scene();
    w.setQuality?.('ultra');
    scene.background = new T.Color('#bccbd2'); scene.environment = w.scene.environment; scene.environmentIntensity = 1.15;
    scene.add(new T.HemisphereLight('#e0efff', '#a5a394', 1.55));
    const key = new T.DirectionalLight('#fff7ec', 2.35); key.position.set(-8, 11, -5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -6, near: 1, far: 40 }); key.shadow.normalBias = .012; scene.add(key, key.target);
    const fill = new T.DirectionalLight('#dcecff', .55); fill.position.set(5, 3, 7); scene.add(fill);
    const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshStandardMaterial({ color: '#a6b0b6', roughness: .92 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.009; floor.receiveShadow = true; scene.add(floor);
    const car = createCar(w.assets.car, authoredPaint ? null : '#b9c4cc'); scene.add(car); car.updateMatrixWorld(true);
    const camera = new T.PerspectiveCamera(34, innerWidth / innerHeight, .025, 100);
    const caption = document.createElement('div'); caption.id = 'roadster-caption'; document.body.append(caption);
    window.__roadsterGallery = { T, scene, car, camera, floor, setPlayerAeroPose }; w.renderer.info.autoReset = false;
  }, Boolean(process.env.ROADSTER_AUTHORED_PAINT));
  for (const view of views) {
    /** Apply a fixed metre-space camera, draw once, and report complete submitted geometry including shadows. */
    const record = await page.evaluate(({ view, stage }) => {
      const { T, scene, car, camera, floor, setPlayerAeroPose } = window.__roadsterGallery, renderer = window.__roadsterWorld.renderer;
      const poses = {
        panel: [[3.1,1.45,-3.8],[.55,.77,-1.18],36],
        front: [[5.8, 2.6, -7.8], [0, .65, -.15], 34],
        stowed: [[5.8, 2.6, -7.8], [0, .65, -.15], 34],
        stowedrear: [[0, 1.65, 8.8], [0, .67, .2], 32],
        stowedtop: [[0, 9.3, 0], [0, 0, 0], 34],
        headon: [[0, 1.35, -8.4], [0, .68, -.1], 29],
        referencefrontlow: [[0, .85, -12], [0, .68, 0], 18.5],
        referencefront: [[0, 1.05, -12], [0, .68, 0], 18.5],
        referencefronthigh: [[0, 1.35, -12], [0, .68, 0], 18.5],
        rear: [[0, 1.65, 8.8], [0, .67, .2], 32],
        rearflight: [[0, .65, 8.4], [0, .66, .2], 28],
        side: [[8.8, 1.65, 0], [0, .65, 0], 34],
        top: [[0, 9.3, 0], [0, 0, 0], 34],
        wheel: [[2.5, 1.1, -3.3], [.84, .43, -1.46], 36],
        cabin: [[.05, 1.04, -.65], [0, .63, .65], 88],
        dashboard: [[.43, 1.03, .52], [-.17, .73, -.59], 75],
        driver: [[-.32, 1.08, .35], [-.08, .74, -.51], 85],
        underbody: [[4.7, -5.4, 5.2], [0, .25, 0], 38],
      };
      if (setPlayerAeroPose) setPlayerAeroPose(car, view.startsWith('stowed') ? 0 : 1);
      car.updateMatrixWorld(true);
      const top=view.endsWith('top');
      const [position, target, fov] = poses[view]; camera.up.set(0, top ? 0 : 1, top ? -1 : 0);
      camera.position.fromArray(position); camera.lookAt(...target); camera.fov = fov; camera.updateProjectionMatrix(); floor.visible = view !== 'underbody';
      const labels = { front: 'Передняя часть и силуэт', stowed:'Крыло в убранном положении', stowedrear:'Убранное крыло, корма', stowedtop:'Убранное крыло, вид сверху', headon: 'Передняя проекция и свет', rear: 'Корма, свет и силовые установки', rearflight:'Поднятое крыло, низкая задняя проекция', side: 'Боковые пропорции', top: 'План и ширина кузова', wheel: 'Колесо и арка', cabin: 'Одноместный салон и реконструкция баллона', dashboard: 'Панель, руль и консоль', driver: 'Панель с места водителя', underbody: 'Реальная геометрия днища' };
      document.getElementById('roadster-caption').textContent = `${stage === 'before' ? 'Исходная модель' : 'Переработанная модель'} · ${labels[view] || 'Проверка фронтальных пропорций'}\nИнспекционный ракурс, не новая игровая камера`;
      renderer.info.reset(); renderer.render(scene, camera);
      const bounds = new T.Box3().setFromObject(car, true), size = bounds.getSize(new T.Vector3()), maps = new Set(); let meshes = 0, triangles = 0;
      car.traverse(node => {
        if (!node.isMesh) return;
        meshes++; triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          for (const value of Object.values(material)) if (value?.isTexture) maps.add(value);
      });
      const playerMaps = [...maps].map(map => ({ name: map.name, width: map.image?.width, height: map.image?.height,
        mipmaps: map.generateMipmaps, anisotropy: map.anisotropy, colorSpace: map.colorSpace }));
      return { view, position, target, fov, dimensions: size.toArray(), meshes, triangles, calls: renderer.info.render.calls,
        submittedTriangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, playerMaps,
        surface: [renderer.domElement.width, renderer.domElement.height] };
    }, { view, stage });
    await page.screenshot({ path: `${out}/${view}.png` }); records.push(record); console.log(stage, view, JSON.stringify(record));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const endingHash=createHash('sha256').update(await readFile(path.join(root,'public/assets/roadster.glb'))).digest('hex');
  await writeFile(`${out}/metrics.json`, JSON.stringify({ stage, assetSha256, assetLockedToCapturedBytes: true, diskAssetUnchangedDuringCapture: endingHash===assetSha256, authoredPaint: Boolean(process.env.ROADSTER_AUTHORED_PAINT), method: 'Fixed matched cameras, production createCar and existing environment, exact GLB bytes locked at startup, no photograph overlays or hidden car geometry. Inspection view only; controlled-time capture is not hardware FPS.', records, errors }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
