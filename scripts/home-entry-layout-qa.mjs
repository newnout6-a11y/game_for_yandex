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
    const visible = node => { const r=rect(node);return r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden'; };
    const hit = node => { const r=rect(node);return [[r.x+2,r.y+2],[r.right-2,r.y+2],[r.x+2,r.bottom-2],[r.right-2,r.bottom-2],[r.x+r.width/2,r.y+r.height/2]].every(([x,y])=>node.contains(document.elementFromPoint(x,y))); };
    const textBoxes = node => {
      const boxes=[], walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const text=walker.currentNode;
        if(!text.textContent.trim()||!visible(text.parentElement))continue;
        const range=document.createRange();range.selectNodeContents(text);
        for(const r of range.getClientRects())if(r.width&&r.height)boxes.push({text:text.textContent.trim(),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
      }
      return boxes;
    };
    const bounds = node => {
      const r=rect(node),style=getComputedStyle(node),number=key=>parseFloat(style[key])||0;
      return {x:r.x+number('borderLeftWidth')+number('paddingLeft'),y:r.y+number('borderTopWidth')+number('paddingTop'),right:r.right-number('borderRightWidth')-number('paddingRight'),bottom:r.bottom-number('borderBottomWidth')-number('paddingBottom')};
    };
    const control = node => ({...rect(node),name:node.textContent.trim()||node.getAttribute('aria-label'),hit:hit(node),content:bounds(node),textBoxes:textBoxes(node),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth});
    const root=document.querySelector('.garage-shell'),hub=document.querySelector('.gs-hub');
    const actions=[...document.querySelectorAll('.gs-hub-actions button')].map(node=>({...control(node),action:JSON.parse(node.dataset.gsAction)}));
    const title=document.querySelector('.gs-hub-title'),route=document.querySelector('[data-gs-setting="route"]');
    const routeStyle=getComputedStyle(route),label=route.selectedOptions[0].textContent;
    // A native select may clip its value while scrollWidth still equals clientWidth.
    // Measure the real label font, then subtract BOTH padding sides and borders.
    const probe=document.createElement('span');probe.textContent=label;
    Object.assign(probe.style,{position:'fixed',left:'-9999px',whiteSpace:'pre',font:routeStyle.font,letterSpacing:routeStyle.letterSpacing});
    document.body.append(probe);const textWidth=probe.getBoundingClientRect().width;probe.remove();
    const routeContent=bounds(route),header=document.querySelector('.gs-header'),footer=document.querySelector('.gs-footer'),hero=document.querySelector('.gs-hero-vehicle');
    const centre={x:innerWidth*.5,y:innerHeight*.48};
    return {
      viewport:[innerWidth,innerHeight],physicalScreen:[screen.width,screen.height],root:rect(root),
      hub:{...rect(hub),content:bounds(hub),scrollTop:hub.scrollTop,scrollHeight:hub.scrollHeight,clientHeight:hub.clientHeight,overflow:getComputedStyle(hub).overflowY},
      header:{...rect(header),textBoxes:textBoxes(header)},footer:footer?{...rect(footer),textBoxes:textBoxes(footer)}:null,
      headerControls:[...header.querySelectorAll('button')].map(control),footerControls:footer?[...footer.querySelectorAll('button')].map(control):[],
      brand:rect(document.querySelector('.gs-brand')),account:rect(document.querySelector('.gs-account')),
      hero:visible(hero)?rect(hero):null,title:{...rect(title),clip:getComputedStyle(title).clipPath},
      route:{...rect(route),value:route.value,label,textWidth,contentWidth:routeContent.right-routeContent.x,content:routeContent,font:routeStyle.font,paddingLeft:routeStyle.paddingLeft,paddingRight:routeStyle.paddingRight,hit:hit(route)},
      actions,pageOverflow:document.documentElement.scrollWidth-innerWidth,blocked:window.__homeEntryQA.gate.blocked,
      centreObstructed:[...document.querySelectorAll('.gs-hub button,.gs-hub select,.gs-hub-title,.gs-hub-copy')].some(node=>{const r=node.getBoundingClientRect();return r.width>1&&r.height>1&&centre.x>=r.x&&centre.x<=r.right&&centre.y>=r.y&&centre.y<=r.bottom;})
    };
  });
}
function problems(info) {
  const issues=[],epsilon=.75;
  const inside=(r,b)=>r.x>=b.x-epsilon&&r.y>=b.y-epsilon&&r.right<=b.right+epsilon&&r.bottom<=b.bottom+epsilon;
  const overlap=(a,b)=>a.x<b.right-epsilon&&a.right>b.x+epsilon&&a.y<b.bottom-epsilon&&a.bottom>b.y+epsilon;
  if(info.actions.length!==2)issues.push('Expected exactly two entry actions');
  if(info.blocked)issues.push('Landscape incorrectly blocked');
  if(info.brand.right>info.account.x)issues.push('Brand and wallet overlap');
  if(info.pageOverflow>1)issues.push('Horizontal page overflow');
  if(info.hub.bottom>(info.footer?.y??info.viewport[1])+epsilon)issues.push('HOME extends below footer or viewport edge');
  for(const section of [info.header,info.footer].filter(Boolean)) {
    if(!inside(section,info.root))issues.push('Header/footer outside viewport');
    if(section.textBoxes.some(box=>!inside(box,section)))issues.push('Header/footer text is clipped');
  }
  for(const [controls,area] of [[info.actions,info.hub],[info.headerControls,info.header],[info.footerControls,info.footer]]) {
    for(const button of controls) {
      if(button.width<44||button.height<44)issues.push(`${button.name}: touch target <44px`);
      if(!inside(button,area))issues.push(`${button.name}: clipped/outside its layout area`);
      if(!button.hit)issues.push(`${button.name}: not fully hit-testable`);
      if(button.scrollWidth>button.clientWidth+1||button.textBoxes.some(box=>!inside(box,button.content)))issues.push(`${button.name}: text overflows padded button`);
    }
  }
  if(info.actions.some((a,i)=>info.actions.some((b,j)=>i<j&&overlap(a,b))))issues.push('Entry buttons overlap');
  if(info.title.clip!=='none') {
    // The 180px fixture cannot reserve the middle while retaining two 44px rows,
    // header and guest login. Its right-of-route clearance is reported honestly.
    if(info.viewport[1]>220&&info.centreObstructed)issues.push('Compact centre is obstructed by hero copy or controls');
    if(info.hub.scrollHeight>info.hub.clientHeight+1)issues.push('Compact HOME still needs scrolling');
    if(info.route.width<44||info.route.height<44)issues.push('Route touch target <44px');
    if(!inside(info.route,info.hub.content))issues.push('Route outside padded HOME area');
    if(!info.route.hit)issues.push('Route not fully hit-testable');
    if(info.route.textWidth>info.route.contentWidth+epsilon)issues.push(`Route text clipped: ${info.route.textWidth.toFixed(2)}px label in ${info.route.contentWidth.toFixed(2)}px content area`);
    if(info.actions.some(button=>overlap(button,info.route)))issues.push('Route overlaps entry actions');
    if(info.hero&&overlap(info.hero,info.route))issues.push('Route overlaps car caption');
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
  const sizes=[[320,240],[320,180],[560,315],[640,360],[667,300],[844,390],[1440,900]];
  const routes=['ring','neon','dawn'];
  const scales=[1,1.25,1.5];
  const failures=[];
  for(const guest of [false,true]) {
    for(const [width,height] of sizes) {
      if(guest&&![[320,240],[320,180],[560,315]].some(([w,h])=>w===width&&h===height))continue;
      for(const fontScale of scales) {
        for(const selectedRoute of routes) {
          await page.locator('iframe').evaluate((node,{width,height})=>{node.style.width=`${width}px`;node.style.height=`${height}px`;},{width,height});
          await frame.evaluate(({guest,selectedRoute})=>{
            const qa=window.__homeEntryQA;qa.ui.root.style.fontSize='';
            qa.ui.render({...qa.view,settings:{...qa.view.settings,route:selectedRoute},...(guest?{platform:{sdk:true,cloud:true,auth:'guest'}}:{})});qa.gate.refresh();qa.actions.length=0;
          },{guest,selectedRoute});
          if(fontScale!==1)await frame.evaluate(scale=>{
            const nodes=[...document.querySelectorAll('.garage-shell, .garage-shell *')];
            const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
            nodes.forEach((node,index)=>node.style.fontSize=`${sizes[index]*scale}px`);
          },fontScale);
          await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const info=await measure(frame),issues=problems(info);
          assert.deepEqual(info.viewport,[width,height],'Must measure the iframe, not the larger host or physical display');
          assert.equal(info.route.value,selectedRoute,'Measure the actual selected route, not just the first option');
          const name=`home-${width}x${height}-font-${fontScale}-route-${selectedRoute}${guest?'-guest':''}`;
          report.frames.push({name,fontScale,guest,...info,rightOfRouteClearance:width-info.route.right-8,issues});
          await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
          if(selectedRoute==='dawn'&&(fontScale===1||fontScale===1.5&&(width===320||width===560)))await page.locator('iframe').screenshot({path:path.join(out,`${name}.png`)});
          if(!legacy&&issues.length)failures.push({name,issues});
          if(!legacy&&!issues.length) {
            await frame.locator('.gs-hub-actions .gs-drive-button').click();
            await frame.locator('.gs-hub-actions button').nth(1).click();
            assert.deepEqual(await frame.evaluate(()=>window.__homeEntryQA.actions.splice(0)),[{type:'startDrive'},{type:'navigate',screen:'garage',tab:'fleet'}]);
            if(info.title.clip!=='none') {
              const nextRoute=routes[(routes.indexOf(selectedRoute)+1)%routes.length];
              await frame.locator('[data-gs-setting="route"]').selectOption(nextRoute);
              assert.deepEqual(await frame.evaluate(()=>window.__homeEntryQA.actions.splice(0)),[{type:'settings',key:'route',value:nextRoute}]);
            }
          }
          console.log(`${legacy?'LEGACY':issues.length?'FAIL':'PASS'} ${name}: ${issues.length?issues.join('; '):'labels fit padded controls; entry actions clickable'}`);
        }
      }
    }
  }
  report.failures=failures;
  if (legacy) assert.ok(report.frames.some(frame=>frame.viewport[0]===560&&frame.issues.length),'Legacy test must reproduce the narrow landscape defect');
  else {
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
  if(!legacy)assert.deepEqual(report.failures,[],'Native DOM layout failures; see report.json for every route, font size and footer state');
  console.log(`HOME ENTRY ${legacy?'REPRODUCTION':'QA'} PASS: ${report.frames.length} iframe/route/text-scale/footer cases`);
} finally {
  await browser.close(); await new Promise(resolve=>server.close(resolve));
}
