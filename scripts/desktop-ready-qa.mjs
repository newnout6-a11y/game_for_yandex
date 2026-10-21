import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const css=await readFile(new URL('../styles/desktop-drive.css',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true});
try {
 const page=await browser.newPage();
 await page.setContent(`<style>${css}</style><div id="app" data-mobile-controls="false" data-screen="playing"><div class="touch-controls"><div class="ability-pair"><button id="rollLeftBtn" data-mode="ground"><span class="mobile-control-face"></span></button></div></div></div>`);
 const result={};
 for(const mode of ['ground','ready','rolling']) {
  result[mode]=await page.evaluate(mode=>{const b=document.querySelector('button');b.dataset.mode=mode;const s=getComputedStyle(b.querySelector('.mobile-control-face'));return {ring:s.borderTopColor,fill:s.backgroundColor,color:s.color};},mode);
 }
 result.disabled=await page.evaluate(()=>{const b=document.querySelector('button');b.dataset.mode='ready';b.setAttribute('aria-disabled','true');return getComputedStyle(b.querySelector('.mobile-control-face')).borderTopColor;});
 assert.notDeepEqual(result.ground,result.ready);assert.notDeepEqual(result.ready,result.rolling);assert.notEqual(result.disabled,result.ready.ring);
 console.log(JSON.stringify(result));
 console.log('NATIVE_READY_STATES_PASS');
} finally {await browser.close();}
