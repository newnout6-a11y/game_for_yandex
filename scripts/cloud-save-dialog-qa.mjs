import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startServer} from './serve.mjs';
import {createProfile} from '../src/progression.js';

/** Inspect the actual missing-cloud dialog using an isolated in-memory SDK, never an online player or save. */
const out='output/cloud-save-dialog-qa';await mkdir(out,{recursive:true});
const profile=createProfile({now:1000,id:'cloud_dialog_fixture'});profile.wallet.credits=170;profile.wallet.totalSpent=130;profile.stats.runs=2;profile.revision=7;
const source=await readFile('src/main.js','utf8');
const expose=`\nwindow.__cloudDialogQA={get ready(){return assetsReady&&garageScene?.ready},state(){return{profile:profileStore.get(),platform:platform.getState(),screen}}};`;
const fixtureSdk=`const writes=[];window.__fixtureCloudWrites=writes;const player={getUniqueID:()=> 'isolated_test_player',isAuthorized:()=>false,getData:async()=>({}),setData:async(data,durable)=>{writes.push({data:structuredClone(data),durable});}};const api={getPlayer:async()=>player,environment:{i18n:{lang:'ru'}}};export function createSdk(){return{init:async()=>api,get:()=>api,on(){},ready(){},gameplay(){}};}`;
const report={method:'Native renderer and real UI/controller/cloud adapter; only SDK transport and local test inventory are isolated fixtures. No real user save, authentication or remote write.',sourceHashes:{},devices:[],errors:[]};
for(const file of ['src/platform-services.js','src/garage-ui.js'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const server=startServer({root:process.cwd(),port:0});await once(server,'listening');
const browser=await chromium.launch({...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'}),headless:true,args:process.env.SOFTWARE_WEBGL?['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']:[]});
try{
 for(const [device,viewport,mobile] of [['desktop',{width:1280,height:720},false],['mobile',{width:844,height:390},true]]){
  const page=await browser.newPage({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'reduce'});page.setDefaultTimeout(180000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/src/main.js',route=>route.fulfill({body:source+expose,contentType:'text/javascript'}));
  await page.route('**/src/sdk.js',route=>route.fulfill({body:fixtureSdk,contentType:'text/javascript'}));
  await page.addInitScript(p=>localStorage.setItem('aerokrai.profile.v2',JSON.stringify(p)),profile);
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__cloudDialogQA?.ready,null,{timeout:180000});
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const text=await dialog.innerText();assert.match(text,/В облаке пока нет сохранения/);
  assert.equal(await page.getByRole('button',{name:'Загрузить облачный прогресс',exact:true}).count(),0);
  const create=page.getByRole('button',{name:'Создать облачное сохранение',exact:true});await create.scrollIntoViewIfNeeded();assert.equal(await create.isEnabled(),true);
  const before=await page.evaluate(()=>window.__cloudDialogQA.state());
  assert.equal(before.profile.wallet.credits,170);assert.equal(before.profile.stats.runs,2);
  assert.equal(await page.evaluate(()=>window.__fixtureCloudWrites.length),0);
  const bounds=await create.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+.5&&bounds.y+bounds.height<=viewport.height+.5);
  await page.screenshot({path:out+'/'+device+'-create-cloud.png',timeout:180000});
  await create.click();await page.waitForFunction(()=>window.__cloudDialogQA.state().platform.cloud.status==='durable');
  const after=await page.evaluate(()=>window.__cloudDialogQA.state()),writes=await page.evaluate(()=>window.__fixtureCloudWrites);
  assert.deepEqual(after.profile,before.profile);assert.equal(after.platform.conflict,null);assert.equal(writes.length,1);assert.equal(writes[0].durable,true);
  assert.deepEqual(writes[0].data.aerokraiGarageV2.profile,before.profile);
  report.devices.push({device,text,bounds,before:{credits:170,runs:2,revision:before.profile.revision},after:{credits:after.profile.wallet.credits,runs:after.profile.stats.runs,revision:after.profile.revision,cloud:after.platform.cloud.status,writes:writes.length}});
  console.log(device,'CLOUD CREATE PASS');await writeFile(out+'/report.json',JSON.stringify(report,null,2));await page.close();
 }
 assert.deepEqual(report.errors,[]);console.log('CLOUD SAVE DIALOG QA PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await writeFile(out+'/report.json',JSON.stringify(report,null,2));}
