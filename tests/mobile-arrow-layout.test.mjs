import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html'),css=read('styles/mobile-drive.css'),main=read('src/main.js'),ui=read('src/ui.js');
test('production shell loads arrow layout instead of the retired thumbpad',()=>{
 assert.match(html,/\.\/styles\/mobile-drive\.css/);assert.doesNotMatch(html,/thumb-drive\.css|id="thumbDrive"/);assert.doesNotMatch(main,/createThumbDrive|syncThumbControls/);
 for(const id of ['leftBtn','rightBtn','gasBtn','brakeBtn','boostBtn','flightBtn','hornBtn','rollLeftBtn','rollRightBtn'])assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,id);
 assert.match(html,/id="boostStatus"/);assert.match(html,/aria-describedby="boostStatus sharedEnergyStatus"/);
});
test('mobile layout parses and uses defined palette tokens without globally resizing desktop',async()=>{
 const result=await transform(css,{loader:'css'});assert.equal(result.warnings.length,0);
 const defined=new Set([...read('styles/theme.css').matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]));for(const m of css.matchAll(/(--[\w-]+)\s*:/g))defined.add(m[1]);
 for(const m of css.matchAll(/var\((--[\w-]+)/g))assert.ok(defined.has(m[1]),m[1]);
 assert.match(css,/@media \(orientation: landscape\)/);assert.match(css,/#app\[data-mobile-controls="true"\]/);assert.match(css,/min-height: 44px/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/max-width: 480px/);
});
test('help describes independent arrow pedals and touch-only nitro assist without claiming auto driving',()=>{
 assert.doesNotMatch(ui,/Газ \+ руль/);assert.match(ui,/отдельные кнопки ГАЗ и ТОРМОЗ/);assert.match(ui,/На клавиатуре удерживай газ вместе с пробелом/);assert.match(ui,/эта кнопка сама подаёт газ, пока палец на ней/);
});
