import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../scripts/mobile-garage-qa.mjs',import.meta.url),'utf8');
/** Extract only the browser font hook, never execute the capture or launch a browser. */
function fontHarness(){
 const code=source.match(/font\(scale\)\{[\s\S]*?\},async draw/)[0].replace(/,async draw$/,'');
 const nodes=[16,12,10].map(base=>({base,style:{removeProperty(name){if(name==='font-size')delete this.fontSize;}}}));
 const context={document:{querySelectorAll:()=>nodes},getComputedStyle:n=>({fontSize:n.style.fontSize||n.base*(nodes[0].style.fontSize?parseFloat(nodes[0].style.fontSize)/16:1)+'px'})};
 const font=vm.runInNewContext('({'+code+'}).font',context);return{nodes,font};
}
test('native text scaling resets every inherited override between repeated cases',()=>{
 const {nodes,font}=fontHarness();for(const scale of[1,1.25,1.5,1,1.5,1.25,1]){font(scale);assert.deepEqual(nodes.map(n=>parseFloat(n.style.fontSize||n.base)),[16,12,10].map(n=>n*scale));}
});
test('native garage QA requires clear camera containment and a complete source-tree baseline',()=>{
 assert.match(source,/loadHomeQaSource\(baseline\|\|undefined\)/);assert.match(source,/garageCssSha256/);assert.match(source,/m\.region\.y\+m\.region\.height<=Math\.min\(m\.controls\.y,m\.stage\.bottom\)/);
});

test('miniature visibility obeys the nested Fleet list as well as the outer workbench',async()=>{
 const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const body=main.slice(main.indexOf('function refreshFleetVisibility(){'),main.indexOf('/** Queue cloud sync',main.indexOf('function refreshFleetVisibility(){')));
 const box=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
 const panel=box(300,44,560,280);let list=box(306,44,554,154),received;
 const rows=[box(308,50,338,72),box(308,108,338,130),box(308,162,338,184)];
 const ctx={fleetVisibilityDirty:true,innerWidth:560,innerHeight:315,byId:()=>({querySelector:()=>({getBoundingClientRect:()=>panel})}),fleetTargets:rows.map((rect,id)=>({id,canvas:{getBoundingClientRect:()=>rect,closest:()=>({getBoundingClientRect:()=>list})}})),profileStore:{get:()=>({profileId:'fixture'}),getReplacementEpoch:()=>2},fleetMiniatures:{sync:targets=>{received=targets;}}};
 vm.runInNewContext(body+';refreshFleetVisibility();',ctx);assert.deepEqual(Array.from(received,t=>t.visible),[true,true,false]);
 rows[0]=Object.assign(rows[0],box(308,20,338,42));rows[1]=Object.assign(rows[1],box(308,78,338,100));rows[2]=Object.assign(rows[2],box(308,132,338,154));
 vm.runInNewContext('refreshFleetVisibility()',ctx);assert.deepEqual(Array.from(received,t=>t.visible),[false,true,true]);
 list=panel;vm.runInNewContext('refreshFleetVisibility()',ctx);assert.deepEqual(Array.from(received,t=>t.visible),[false,true,true]);
});

test('density measurements ignore non-box display:contents ancestors but honor real scroll clips',()=>{
 assert.match(source,/if\(c\.display==='contents'\)continue/);
 assert.match(source,/\['auto','scroll','hidden','clip'\]\.includes\(c\.overflowY\)/);
});

// The normal tab count alone cannot detect oversized material-option cards.
test('native subcategory parity checks include real rim, steering, tint and reset actions',()=>{
 for(const id of ['rim_graphite:wheels.finish','rim_rose:wheels.finish','steering_round:cockpit.steering','cockpit_amber:cockpit.theme','resetCosmetic:body.tint'])assert.ok(source.includes(id));
 assert.match(source,/checkSubcategory\(m,category\)/);assert.match(source,/season eligibility label overflows tile/);
});

// A DOM hit test alone passed the original compositor defect. Retain the first
// full image before forcing a nav repaint, then compare the actual painted pixels.
test('live paint QA checks the initial frame before an element snapshot can repair it',()=>{
 assert.match(source,/const paint=!!process.env.GARAGE_PAINT/);assert.match(source,/await page.clock.resume\(\)/);
 const initial=source.indexOf("const initial=await readFile(path.join(out,name+'.png'))");
 const reference=source.indexOf("await frame.locator('.gs-tabs').screenshot");
 assert.ok(initial>0&&reference>initial);assert.match(source,/mismatch.ratio<\.03/);
});
