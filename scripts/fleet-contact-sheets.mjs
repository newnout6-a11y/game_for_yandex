import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1020},deviceScaleFactor:1});
 for(const [name,title,kinds]of[
  ['passenger','НОВЫЙ ТРАФИК · ЛЕГКОВЫЕ И ФУРГОН',['sedan','hatch','suv','van']],
  ['work','НОВЫЙ ТРАФИК · ГРУЗОВЫЕ И СПЕЦТЕХНИКА',['boxtruck','semi','towtruck','firetruck']],
  ['fleet','ВОСЕМЬ НОВЫХ МОДЕЛЕЙ ТРАФИКА',['sedan','hatch','suv','van','boxtruck','semi','towtruck','firetruck']],
 ]){
  await page.setViewportSize({width:1600,height:name==='fleet'?1980:1020});
  const cards=await Promise.all(kinds.map(async kind=>`<img src="data:image/png;base64,${(await readFile(`output/fleet-after/${kind}-${['towtruck','van','hatch','boxtruck'].includes(kind)?'rear':'front'}.png`)).toString('base64')}" />`));
  await page.setContent(`<html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#e6edf1;font-family:Arial,sans-serif;color:#20333d}h1{font-size:32px;margin:28px 36px 12px}p{margin:0 36px 20px;font-size:18px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 24px}img{display:block;width:100%;border-radius:12px}footer{padding:16px 36px;font-size:17px}</style></head><body><h1>${title}</h1><p>Восемь оригинальных моделей · Blender → GLB → игровой рендер</p><main>${cards.join('')}</main><footer>Обзор моделей для проверки. Камеры подогнаны под размер транспорта; это не общий масштаб и не новый режим игры.</footer></body></html>`);
  await page.screenshot({path:`output/fleet-after/${name}-catalog.png`});
 }
}finally{await browser.close();}
