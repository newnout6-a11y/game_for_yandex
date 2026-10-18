import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './serve.mjs';

// Isolated DOM/CSS QA: production presenter and orientation gate, no renderer,
// SDK, network service, persistence, or real user data. Parent and iframe sizes
// deliberately differ to reproduce a side-panel-constrained Yandex container.
const legacy = process.env.HOME_ENTRY_LEGACY === '1';
const out = path.resolve(process.env.HOME_ENTRY_QA_OUT || `output/home-entry-${legacy ? 'before' : 'after'}`);
await mkdir(out, { recursive: true });
const css = await readFile('styles/garage.css', 'utf8');
const server = startServer({ port: 0 }); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), headless: true });
const report = { method: 'Actual GarageUI in a smaller iframe; no 3D renderer, SDK, saves or production data. Text-only font enlargement is applied to actual computed font sizes.', legacy, frames: [], errors: [] };
const fixture = `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/garage.css"><link rel="stylesheet" href="/styles/orientation-gate.css"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#262835}#app{position:fixed;inset:0}</style><div id="app"><div id="homeRoot"></div></div><script type="module">
import { GarageUI } from '/src/garage-ui.js';
import { createOrientationGate } from '/src/orientation-gate.js';
const actions = [];
const ui = new GarageUI({root:document.getElementById('homeRoot'),onAction:action=>actions.push(action)});
const view = { screen:'hub', profile:{stats:{runs:1}}, balances:{credits:300}, selectedVehicle:{id:'rocket',name:'Roadster Rocket',role:'ДОРОГА / НЕБО'}, platform:{sdk:true,cloudConnected:true,authenticated:true}, otherGames:[{appID:'fixture-game',title:'Другая игра'}] };
ui.render(view);
const gate = createOrientationGate({appRoot:document.getElementById('app')});
window.__homeEntryQA={ui,view,actions,gate};
</script></html>`;

async function measure(frame) {
  return frame.evaluate(() => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    const root = document.querySelector('.garage-shell'), hub = document.querySelector('.gs-hub');
    const actions = [...document.querySelectorAll('.gs-hub-actions button')].map(node => {
      const r = rect(node);
      const points = [[r.x+2,r.y+2],[r.right-2,r.y+2],[r.x+2,r.bottom-2],[r.right-2,r.bottom-2],[r.x+r.width/2,r.y+r.height/2]];
      return { ...r, name:node.textContent.trim(), action:JSON.parse(node.dataset.gsAction), hit:points.every(([x,y])=>node.contains(document.elementFromPoint(x,y))), scrollWidth:node.scrollWidth, clientWidth:node.clientWidth };
    });
    const title = document.querySelector('.gs-hub-title'), route = document.querySelector('[data-gs-setting="route"]');
    const centre = { x:innerWidth*.5,y:innerHeight*.48 };
    return { viewport:[innerWidth,innerHeight], physicalScreen:[screen.width,screen.height], root:rect(root), hub:{...rect(hub),scrollTop:hub.scrollTop,scrollHeight:hub.scrollHeight,clientHeight:hub.clientHeight,overflow:getComputedStyle(hub).overflowY}, footer:rect(document.querySelector('.gs-footer')), brand:rect(document.querySelector('.gs-brand')), account:rect(document.querySelector('.gs-account')), title:{...rect(title),clip:getComputedStyle(title).clipPath}, route:rect(route), actions, pageOverflow:document.documentElement.scrollWidth-innerWidth, blocked:window.__homeEntryQA.gate.blocked, centreObstructed:[...document.querySelectorAll('.gs-hub button,.gs-hub select,.gs-hub-title,.gs-hub-copy')].some(node=>{const r=node.getBoundingClientRect();return r.width>1&&r.height>1&&centre.x>=r.x&&centre.x<=r.right&&centre.y>=r.y&&centre.y<=r.bottom;}) };
  });
}
function problems(info) {
  const issues = [];
  if (info.actions.length !== 2) issues.push('Expected exactly two entry actions');
  if (info.blocked) issues.push('Landscape incorrectly blocked');
  if (info.brand.right > info.account.x) issues.push('Brand and wallet overlap');
  if (info.pageOverflow > 1) issues.push('Horizontal page overflow');
  for (const button of info.actions) {
    if (button.width < 44 || button.height < 44) issues.push(`${button.name}: touch target <44px`);
    if (button.x < 0 || button.y < 0 || button.right > info.viewport[0]+.5 || button.bottom > info.footer.y+.5) issues.push(`${button.name}: clipped/outside playable viewport`);
    if (!button.hit) issues.push(`${button.name}: not fully hit-testable`);
    if (button.scrollWidth > button.clientWidth+1) issues.push(`${button.name}: text overflows button`);
  }
  if (info.title.clip !== 'none') {
    if (info.centreObstructed) issues.push('Compact centre is obstructed by hero copy or controls');
    if (info.hub.scrollHeight > info.hub.clientHeight+1) issues.push('Compact HOME still needs scrolling');
    if (info.route.height < 44 || info.route.bottom > Math.min(...info.actions.map(action=>action.y))) issues.push('Route overlaps actions or target is too small');
  }
  return issues;
}
try {
  const page = await browser.newPage({ viewport:{width:1600,height:1000}, hasTouch:true, deviceScaleFactor:1, reducedMotion:'reduce' });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/__home-entry-host', route => route.fulfill({ contentType:'text/html', body:`<!doctype html><html><style>body{margin:0;background:#050507;color:white}iframe{display:block;border:0;margin:20px;width:560px;height:315px}</style><iframe title="Isolated game viewport" src="${origin}/__home-entry-frame"></iframe></html>` }));
  await page.route('**/__home-entry-frame', route => route.fulfill({ contentType:'text/html',body:fixture }));
  if (legacy) await page.route('**/styles/garage.css', route => route.fulfill({ contentType:'text/css', body:css.split('/* HOME_ENTRY_COMPACT:')[0] }));
  await page.goto(`${origin}/__home-entry-host`);
  const frame = page.frames().find(frame=>frame.parentFrame());
  await frame.waitForFunction(()=>window.__homeEntryQA);
  for (const [width,height] of [[560,315],[640,360],[667,300],[844,390],[1440,900]]) {
    for (const fontScale of [1,1.25,1.5]) {
      await page.locator('iframe').evaluate((node,{width,height})=>{node.style.width=`${width}px`;node.style.height=`${height}px`;},{width,height});
      await frame.evaluate(() => { const qa=window.__homeEntryQA;qa.ui.root.style.fontSize='';qa.ui.render(qa.view);qa.gate.refresh(); });
      if (fontScale !== 1) await frame.evaluate(scale => {
        const nodes=[...document.querySelectorAll('.garage-shell, .garage-shell *')];
        const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
        nodes.forEach((node,index)=>node.style.fontSize=`${sizes[index]*scale}px`);
      },fontScale);
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const info=await measure(frame), issues=problems(info);
      assert.deepEqual(info.viewport,[width,height],'Must measure the iframe, not the larger host or physical display');
      const name=`home-${width}x${height}-font-${fontScale}`;
      report.frames.push({name,fontScale,...info,issues});
      await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
      if (fontScale===1 || fontScale===1.5&&width===560) await page.locator('iframe').screenshot({path:path.join(out,`${name}.png`)});
      if (!legacy) assert.deepEqual(issues,[],`${name}: ${issues.join('; ')}`);
      if (!legacy) {
        await frame.locator('.gs-hub-actions .gs-drive-button').click();
        await frame.locator('.gs-hub-actions button').nth(1).click();
        assert.deepEqual(await frame.evaluate(()=>window.__homeEntryQA.actions.splice(0)),[{type:'startDrive'},{type:'navigate',screen:'garage',tab:'fleet'}]);
        const route=frame.locator('[data-gs-setting="route"]');
        if (info.title.clip!=='none') {
          await route.selectOption('neon');
          assert.deepEqual(await frame.evaluate(()=>window.__homeEntryQA.actions.splice(0)),[{type:'settings',key:'route',value:'neon'}]);
        }
      }
      console.log(`${legacy?'LEGACY':'PASS'} ${name}: ${issues.length ? issues.join('; ') : 'both entry actions visible and clickable'}`);
    }
  }
  if (legacy) assert.ok(report.frames.some(frame=>frame.viewport[0]===560&&frame.issues.length),'Legacy test must reproduce the narrow landscape defect');
  else {
    // A guest-auth footer is taller but must not push the primary entry row away.
    await page.locator('iframe').evaluate(node=>{node.style.width='560px';node.style.height='315px';});
    await frame.evaluate(()=>{const qa=window.__homeEntryQA;qa.ui.render({...qa.view,platform:{sdk:true,cloud:true,auth:'guest'}});qa.gate.refresh();});
    const guest=await measure(frame); assert.deepEqual(problems(guest),[],'Guest footer must preserve both actions');
    report.guest=guest;
    // Portrait remains intentionally blocked. Restore landscape and verify recovery.
    await page.locator('iframe').evaluate(node=>{node.style.width='315px';node.style.height='560px';});
    await frame.evaluate(()=>window.__homeEntryQA.gate.refresh());
    assert.equal(await frame.evaluate(()=>window.__homeEntryQA.gate.blocked),true);
    assert.ok(await frame.locator('#orientationGate').isVisible());
    await page.locator('iframe').evaluate(node=>{node.style.width='560px';node.style.height='315px';});
    await frame.evaluate(()=>window.__homeEntryQA.gate.refresh());
    assert.equal(await frame.evaluate(()=>window.__homeEntryQA.gate.blocked),false);
    report.portraitGatePreserved=true;
  }
  assert.deepEqual(report.errors,[]);
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(`HOME ENTRY ${legacy?'REPRODUCTION':'QA'} PASS: ${report.frames.length} iframe/text-scale cases`);
} finally {
  await browser.close(); await new Promise(resolve=>server.close(resolve));
}
