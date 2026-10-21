import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const read = name => readFile(new URL(`../scripts/${name}.mjs`, import.meta.url), 'utf8');
const [mobile, header, entry, composition] = await Promise.all(['mobile-garage-qa','garage-header-qa','home-entry-layout-qa','home-composition-qa'].map(read));

test('full-scene garage QA uses the true viewport edge only when the footer is absent', () => {
  const check = vm.runInNewContext(`(${mobile.match(/^function check\(m\)\{[^\n]+/m)[0]})`, { assert });
  const m = {viewport:[560,315],overflow:0,header:{bottom:44},nav:{bottom:44},footer:null,
    panel:{x:325,y:48,bottom:311,height:263,overflow:'auto'},heading:{height:1},
    stage:{x:0,y:44,right:325,bottom:315},controls:{y:270},
    region:{x:8,y:48,width:300,height:215},title:{right:317,bottom:260},inspectionButtons:[{width:44,height:32}]};
  assert.doesNotThrow(() => check(m));
  assert.throws(() => check({...m,panel:{...m.panel,bottom:316}}), /panel outside/);
  assert.throws(() => check({...m,title:{...m.title,bottom:316}}), /title escaped/);
  assert.throws(() => check({...m,footer:{y:287}}), /panel outside/);
  assert.throws(() => check({...m,region:{...m.region,height:230}}), /camera region crosses/);
});

test('native HOME entry still checks clipping, text, hit targets and former-footer bounds', () => {
  const code = entry.slice(entry.indexOf('function problems(info) {'), entry.indexOf('\ntry {', entry.indexOf('function problems(info) {')));
  const problems = vm.runInNewContext(`(${code})`);
  const rect=(x,y,width,height)=>({x,y,width,height,right:x+width,bottom:y+height});
  const action=x=>({...rect(x,255,90,44),name:'Entry',hit:true,content:rect(x,255,90,44),textBoxes:[],scrollWidth:90,clientWidth:90});
  const info={viewport:[560,315],root:rect(0,0,560,315),hub:{...rect(0,52,560,263),content:rect(0,52,560,263),scrollHeight:263,clientHeight:263},header:{...rect(0,0,560,52),textBoxes:[]},footer:null,footerControls:[],headerControls:[],brand:{right:100},account:{x:480},actions:[action(10),action(110)],blocked:false,pageOverflow:0,centreObstructed:false,title:{clip:'inset(50%)'},route:{...rect(10,60,180,44),hit:true,textWidth:140,contentWidth:160},hero:rect(300,66,100,19)};
  assert.equal(problems(info).length,0);
  assert.ok(problems({...info,hub:{...info.hub,bottom:317}}).includes('HOME extends below footer or viewport edge'));
  assert.ok(problems({...info,footer:{...rect(0,287,560,28),textBoxes:[]}}).includes('HOME extends below footer or viewport edge'));
  assert.ok(problems({...info,actions:[{...info.actions[0],hit:false},info.actions[1]]}).some(message=>message.includes('hit-testable')));
});

test('title and composition captures keep overlap and immutable baseline checks with nullable footer measurement', () => {
  assert.match(header,/if\(!node\)return null/);
  assert.match(header,/info\.title\.bottom<=\(info\.footer\?\.y\?\?info\.css\[1\]\)-3/);
  assert.match(header,/No title\/control overlap/);
  assert.match(header,/Unchanged car-fit/);
  assert.match(composition,/if\(!n\)return null/);
  assert.match(composition,/info\.vehicle\.bottom<=\(info\.footer\?\.y\?\?info\.viewport\[1\]\)/);
  assert.match(composition,/car\/action overlap/);
  assert.match(mobile,/loadHomeQaSource\(baseline\|\|undefined\)/);
});
