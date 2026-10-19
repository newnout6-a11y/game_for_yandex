import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadHomeQaSource} from './home-qa-source.mjs';
import {assertRouteRailGeometry, assertRouteRailSequence} from '../tests/helpers/route-rail-geometry.mjs';

// Run only through the sole native-browser owner. This is a real renderer/DOM
// geometry test, not a CSS-string check or a physical-device performance claim.
const root = fileURLToPath(new URL('../', import.meta.url));
const capture = await loadHomeQaSource(root);
const out = path.join(root, 'output/bonus-review-native');
await mkdir(out, {recursive: true});
const sourceFiles = ['src/bonus-announcements.js', 'src/main.js', 'src/ui.js', 'src/hud-gauges.js', 'src/route-vehicle-marker.js', 'src/garage-fleet-miniatures.js', 'src/driving-bonus-effects.js', 'src/world.js', 'index.html', 'styles/mobile-drive.css'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  method: 'Actual selected-run GLB snapshot, production UI and computed native DOM geometry in 280/320/400/551px touch iframes. Controlled software frames are not physical-device FPS evidence.',
  source: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha256(await readFile(path.join(root, file)))]))),
  frames: [], sequences: [], errors: [],
};
const hook = `
import {CONFIG as narrowRouteConfig} from './config.js';
window.__narrowRouteQA = {
  get ready() { return assetsReady && garageScene?.ready && routeVehicleMarker; },
  get game() { return game; },
  get ui() { return ui; },
  syncGameplay() { syncGameplay(); },
  get effects() { return renderer.bonusEffects; },
  get renderer() { return renderer; },
  async start() {
    clearInput();
    const selected = profileStore.dispatch({type: 'SELECT_VEHICLE', vehicleId: 'rocket'});
    if (!selected.ok) throw Error('Isolated native fixture selection rejected');
    await startRun();
    this.setProgress(0);
  },
  setProgress(progress) {
    clearInput();
    Object.assign(game.state, {
      speed: 80 / 3.6, nitro: 50, distance: progress * narrowRouteConfig.goal,
      goalReached: progress >= 1, traffic: [], pickups: [], obstacles: [],
      throttle: 0, braking: false, boosting: false, nextSpawn: Infinity, nextEvent: Infinity,
    });
    ui.hud(game.state);
  },
  pump() {
    tick(previous + 16);
    renderer.renderer.getContext().finish();
    return byId('mobileGoalVehicle').dataset.state;
  },
  draw() {
    renderer.resize();
    syncMobileControls();
    ui.hud(game.state);
    renderer.render(game.state, {dt: 0, paused: true});
    renderer.renderer.getContext().finish();
  },
  pause() { pauseRun(); },
  resume() { return handleAction('resume'); },
  inspect() {
    const box = node => {
      const r = node.getBoundingClientRect();
      return {x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom};
    };
    const control = node => {
      const r = box(node);
      return {...r, id: node.id || 'brand', visible: getComputedStyle(node).display !== 'none' && r.w > 0 && r.h > 0,
        hits: [[.5, .5], [0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) =>
          node.contains(document.elementFromPoint(r.x + 1 + (r.w - 2) * x, r.y + 1 + (r.h - 2) * y)))};
    };
    const rail = byId('mobileGoalRail'), track = rail.querySelector('.mobile-goal-track');
    const marker = byId('mobileGoalVehicle'), canvas = byId('mobileGoalVehicleCanvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let canvasInk = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) canvasInk++;
    return {
      size: [innerWidth, innerHeight], dpr: devicePixelRatio,
      progress: Number(rail.style.getPropertyValue('--goal-progress')),
      distance: game.state.distance, railValue: rail.getAttribute('aria-valuenow'),
      rail: box(rail), track: box(track), marker: box(marker), flag: box(rail.querySelector('.mobile-goal-flag')),
      fillWidth: parseFloat(getComputedStyle(track, '::after').width),
      brand: control(document.querySelector('.brand')),
      utilities: ['cameraBtn', 'pauseBtn'].map(id => control(byId(id))),
      lowerControls: ['leftBtn', 'rightBtn', 'brakeBtn', 'gasBtn', 'boostBtn', 'flightBtn', 'rollLeftBtn', 'rollRightBtn', 'hornBtn'].map(id => control(byId(id))),
      actualVehicle: renderer.playerVehicleId, selectedVehicle: routeVehicleSelection.id,
      selectedAppearance: routeVehicleSelection.appearance,
      status: marker.dataset.state, canvasHidden: canvas.hidden, canvasInk,
      canvasBuffer: [canvas.width, canvas.height],
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  },
};`;

const fixture = capture.createProfile({id: 'isolated_narrow_route_rail_qa'});
fixture.cosmetics.owned.push('paint_copper');
fixture.loadouts.rocket.cosmetics['body.paint'] = 'paint_copper';
let server, browser;
try {
  server = capture.startServer();
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true,
    args: process.env.SOFTWARE_WEBGL ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] : [],
  });
  const page = await browser.newPage({viewport: {width: 780, height: 400}, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true});
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/src/main.js', route => route.fulfill({
    body: capture.main.replaceAll('requestAnimationFrame(tick);', '/* Native QA owns render scheduling. */') + hook,
    contentType: 'text/javascript',
  }));
  await page.addInitScript(profile => localStorage.setItem('aerokrai.profile.v2', JSON.stringify(profile)), fixture);
  await page.route('**/__narrowroutehost', route => route.fulfill({contentType: 'text/html',
    body: '<style>body{margin:0;background:#17131b;overflow:hidden}iframe{position:absolute;left:74px;top:0;width:551px;height:360px;border:0}</style><iframe src="' + origin + '" title="Roadster native narrow route rail"></iframe>',
  }));
  await page.goto(origin + '/__narrowroutehost');
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForFunction(() => window.__narrowRouteQA?.ready, null, {timeout: 180000});
  await frame.evaluate(() => window.__narrowRouteQA.start());
  await frame.waitForFunction(() => window.__narrowRouteQA.pump() === 'ready', null, {polling: 250, timeout: 180000});

  async function resize(width, height) {
    await page.locator('iframe').evaluate((node, {width, height}) => {
      node.style.width = width + 'px'; node.style.height = height + 'px';
    }, {width, height});
    await frame.waitForFunction(({width, height}) => innerWidth === width && innerHeight === height, {width, height});
    await frame.evaluate(() => window.__narrowRouteQA.draw());
  }

  async function settle(progress) {
    await frame.evaluate(progress => {window.__narrowRouteQA.setProgress(progress); window.__narrowRouteQA.draw();}, progress);
    // Wait for actual CSS interpolation, not merely its target custom property.
    await frame.waitForFunction(progress => {
      const rail = document.getElementById('mobileGoalRail');
      const track = rail.querySelector('.mobile-goal-track');
      const t = track.getBoundingClientRect(), c = document.getElementById('mobileGoalVehicle').getBoundingClientRect();
      return Math.abs(c.x + c.width / 2 - (t.x + t.width * progress)) < .1 &&
        Math.abs(parseFloat(getComputedStyle(track, '::after').width) - t.width * progress) < .1;
    }, progress);
  }

  const finishOnly = process.env.BONUS_REVIEW_FINISH_ONLY === '1';
  if (finishOnly) {
    const prior=JSON.parse(await readFile(path.join(out,'matrix-completed-before-process-exit.json'),'utf8'));
    assert.deepEqual(prior.source,report.source,'Retained matrix must certify the identical runtime bytes');
    assert.equal(prior.frames.length,12);
    report.frames=prior.frames;report.sequences=prior.sequences;
    report.retainedMatrix={frames:12,processExit:137,reason:'First process exited after all matrix frames; only finishing checks rerun without concurrent full-suite load.'};
    for (let i=0;i<12;i+=3) assertRouteRailSequence(report.frames.slice(i,i+3).map(f=>f.state));
  }
  for (const [width, height] of (finishOnly ? [] : [[280, 180], [320, 200], [400, 240], [551, 360]])) {
    await resize(width, height);
    const sequence = [];
    for (const progress of [0, .5, 1]) {
      await settle(progress);
      const state = await frame.evaluate(() => window.__narrowRouteQA.inspect());
      assert.deepEqual(state.size, [width, height]);
      assertRouteRailGeometry(state, progress);
      assert.equal(state.selectedAppearance['body.paint'], 'paint_copper');
      const name = width + '-progress-' + progress;
      await page.locator('iframe').screenshot({path: path.join(out, name + '.png'), timeout: 180000});
      report.frames.push({name, state});
      sequence.push(state);
      await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log('CAPTURE', name, 'actual travel', state.track.w, 'px');
    }
    report.sequences.push({size: [width, height], actualTravel: assertRouteRailSequence(sequence)});
  }

  // Optional exact 551px baseline comparison: pass a real pre-change CSS file.
  // All runtime assets/state are frozen; only this stylesheet is swapped.
  if (process.env.ROUTE_RAIL_BASELINE_CSS) {
    const baselineCss = await readFile(path.resolve(process.env.ROUTE_RAIL_BASELINE_CSS), 'utf8');
    await settle(.5);
    const currentGeometry = await frame.evaluate(() => window.__narrowRouteQA.inspect());
    const measureStyles=()=>['.brand','#cameraBtn','#pauseBtn','.mobile-goal-rail','.mobile-goal-track','.mobile-goal-car','.mobile-goal-flag'].map(selector=>{const c=getComputedStyle(document.querySelector(selector));return{selector,...Object.fromEntries(['display','position','color','backgroundColor','borderRadius','borderColor','fontSize','fontFamily','opacity','width','height','left','right','top','margin','transform','stroke','strokeWidth'].map(k=>[k,c[k]]))};});
    const currentStyles=await frame.evaluate(measureStyles);
    const currentPixels = await frame.locator('.topbar').screenshot({path: path.join(out, '551-current-topbar.png')});
    await frame.evaluate(css => {
      const link = document.querySelector('link[href$="/mobile-drive.css"]');
      if (!link) throw Error('Production mobile-drive stylesheet link missing');
      link.disabled = true;
      const style = document.createElement('style'); style.id = 'native-rail-baseline'; style.textContent = css; document.head.append(style);
    }, baselineCss);
    const baselineGeometry = await frame.evaluate(() => window.__narrowRouteQA.inspect());
    const baselinePixels = await frame.locator('.topbar').screenshot({path: path.join(out, '551-baseline-topbar.png')});
    assert.deepEqual(currentGeometry, baselineGeometry, '551px computed geometry must remain exactly unchanged');
    assert.deepEqual(currentStyles,await frame.evaluate(measureStyles),'551px computed appearance must remain unchanged');
    // A stylesheet swap can re-rasterize fractional-DPR edges; compare decoded
    // pixels with a strict bounded tolerance, never stringify two PNG buffers.
    const pixelDifference=await page.evaluate(async({a,b})=>{
      const decode=async data=>{const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return{width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};};
      const x=await decode(a),y=await decode(b);if(x.width!==y.width||x.height!==y.height)throw Error('Parity image dimensions differ');let changed=0,sum=0,max=0;
      for(let i=0;i<x.data.length;i+=4){let diff=false;for(let c=0;c<3;c++){const d=Math.abs(x.data[i+c]-y.data[i+c]);sum+=d;max=Math.max(max,d);diff=diff||d>0;}if(diff)changed++;}
      return{width:x.width,height:x.height,changedPixels:changed,fraction:changed/(x.width*x.height),meanChannelDifference:sum/(x.width*x.height*3),maxChannelDifference:max};
    },{a:currentPixels.toString('base64'),b:baselinePixels.toString('base64')});
    assert.ok(pixelDifference.fraction<=.01&&pixelDifference.meanChannelDifference<=.05&&pixelDifference.maxChannelDifference<=32,JSON.stringify(pixelDifference));
    await frame.evaluate(() => {
      document.getElementById('native-rail-baseline').remove();
      document.querySelector('link[href$="/mobile-drive.css"]').disabled = false;
    });
    report.parity551 = {geometryIdentical: true, stylesIdentical:true, pixelsIdentical:sha256(currentPixels)===sha256(baselinePixels), pixelDifference, baselineCssSha256: sha256(baselineCss), screenshotSha256: sha256(currentPixels)};
  } else report.parity551 = {checked: false, reason: 'Pass ROUTE_RAIL_BASELINE_CSS to compare a preserved pre-change stylesheet.'};

  // Exercise the actual preference listener, renderer setter and paused cue.
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await frame.waitForFunction(() => !window.__narrowRouteQA.renderer.reducedMotion);
  const motionBefore = await frame.evaluate(() => {
    const qa=window.__narrowRouteQA,s=qa.game.state;qa.effects.clear();
    qa.renderer.bonus('charge',{lane:1,z:5,height:1.5,distance:s.distance,elapsed:s.elapsed,speed:0},s);
    qa.effects.update(s,.18);const m=qa.effects.group.children.find(m=>m.visible);
    qa.pause();return{scale:m.scale.x,opacity:m.material.uniforms.opacity.value,position:m.position.toArray()};
  });
  await page.emulateMedia({reducedMotion: 'reduce'});
  await frame.waitForFunction(() => window.__narrowRouteQA.renderer.reducedMotion);
  const motionPaused = await frame.evaluate(() => {const qa=window.__narrowRouteQA,m=qa.effects.group.children.find(m=>m.visible);qa.effects.update(qa.game.state,.5,true);return{scale:m.scale.x,opacity:m.material.uniforms.opacity.value,position:m.position.toArray(),needsRender:qa.renderer.needsRender};});
  assert.equal(motionPaused.scale,1);assert.equal(motionPaused.opacity,motionBefore.opacity);assert.deepEqual(motionPaused.position,motionBefore.position);assert.equal(motionPaused.needsRender,true);
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await frame.waitForFunction(() => !window.__narrowRouteQA.renderer.reducedMotion);
  const motionRestored=await frame.evaluate(()=>window.__narrowRouteQA.effects.group.children.find(m=>m.visible).scale.x);
  assert.equal(motionRestored,motionBefore.scale);
  report.liveMotion={before:motionBefore,pausedReduced:motionPaused,restoredScale:motionRestored};
  await frame.evaluate(() => window.__narrowRouteQA.resume());

  // DOM/ARIA proof, not a claim of real assistive-technology speech output.
  await frame.evaluate(() => {const qa=window.__narrowRouteQA;qa.syncGameplay();qa.game.onEvent('near',2);});
  await frame.waitForFunction(() => document.getElementById('bonusAnnouncement').textContent.includes('Комбо'));
  const announcement = await frame.evaluate(() => {const n=document.getElementById('bonusAnnouncement'),c=getComputedStyle(n),r=n.getBoundingClientRect();return{text:n.textContent,role:n.getAttribute('role'),live:n.getAttribute('aria-live'),atomic:n.getAttribute('aria-atomic'),hidden:n.hidden,display:c.display,visibility:c.visibility,clip:c.clip,clipPath:c.clipPath,width:r.width,height:r.height,overflow:c.overflow,toastVisible:document.getElementById('toast').classList.contains('visible')};});
  assert.equal(announcement.role,'status');assert.equal(announcement.live,'polite');assert.equal(announcement.atomic,'true');assert.equal(announcement.hidden,false);assert.notEqual(announcement.display,'none');assert.notEqual(announcement.visibility,'hidden');assert.equal(announcement.width,1);assert.equal(announcement.height,1);assert.equal(announcement.overflow,'hidden');assert.equal(announcement.toastVisible,false);
  const ax = await frame.locator('#bonusAnnouncement').ariaSnapshot();assert.match(ax,/Комбо/);
  await frame.evaluate(() => {const qa=window.__narrowRouteQA;qa.game.onEvent('charge');qa.pause();});
  const cleared=await frame.evaluate(()=>({text:document.getElementById('bonusAnnouncement').textContent,pending:window.__narrowRouteQA.ui.bonusAnnouncements.pendingCount}));
  assert.equal(cleared.text,'');assert.equal(cleared.pending,0);
  await frame.evaluate(() => window.__narrowRouteQA.resume());
  await frame.evaluate(() => window.__narrowRouteQA.game.onEvent('event-clear',{success:true,points:400}));
  await frame.waitForFunction(() => document.getElementById('bonusAnnouncement').textContent.includes('400'));
  const success=await frame.locator('#bonusAnnouncement').textContent();assert.match(success,/15/);
  await frame.evaluate(() => {const qa=window.__narrowRouteQA;qa.ui.clearBonusAnnouncements();qa.game.state.revives++;qa.syncGameplay();qa.game.onEvent('pass');});
  assert.equal(await frame.locator('#bonusAnnouncement').textContent(),'');
  report.announcements={announcement,ax,pausedClear:cleared,success,ordinaryPassSilent:true};

  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  try { await browser?.close(); }
  finally {
    if (server) await new Promise(resolve => {server.close(resolve); server.closeAllConnections?.();});
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}
