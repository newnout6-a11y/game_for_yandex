import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {loadHomeQaSource} from '../scripts/home-qa-source.mjs';

/** Deliberately incompatible revisions catch accidental current-checkout fallback. */
async function fixture(t,label) {
 const root=await mkdtemp(path.join(tmpdir(),'roadster-home-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const files={'package.json':'{"type":"module"}','index.html':`<script type="module" src="/src/main.js"></script>${label}`,'src/main.js':`import {version} from './dependency.js'; export const build='${label}';`,'src/dependency.js':`export const version='${label}-only';`,'src/progression.js':`export const createProfile=()=>({id:'${label}-profile'});`,'styles/garage.css':`/* ${label} */`,'public/vendor/runtime.js':`${label}-vendor`,'public/assets/garage/tier1.glb':`${label}-model`};
 for(const [name,bytes]of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),bytes);}return {root,files};
}
test('HOME before capture serves the entire selected snapshot, not mixed current modules or models',async t=>{
 const old=await fixture(t,'old'),newer=await fixture(t,'new'),before=await loadHomeQaSource(old.root),after=await loadHomeQaSource(newer.root);
 assert.deepEqual(before.createProfile(),{id:'old-profile'});assert.deepEqual(after.createProfile(),{id:'new-profile'});
 assert.equal(before.main,old.files['src/main.js']);assert.equal(before.provenance.mainSha256,createHash('sha256').update(before.main).digest('hex'));
 const server=before.startServer();await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
 for(const name of ['index.html','src/main.js','src/dependency.js','src/progression.js','styles/garage.css','public/vendor/runtime.js','public/assets/garage/tier1.glb']){
  const response=await fetch(origin+'/'+name);assert.equal(response.status,200,name);assert.equal(await response.text(),old.files[name],name);
 }
 assert.equal((await fetch(origin+'/src/garage-scene.js')).status,404,'missing baseline module must not silently come from current runtime');
});
test('HOME capture rejects incomplete snapshots instead of reusing current entrypoint or profile schema',async t=>{
 const source=await fixture(t,'missing');await rm(path.join(source.root,'src/main.js'));await assert.rejects(loadHomeQaSource(source.root),/ENOENT/);
 const invalid=await fixture(t,'invalid');await writeFile(path.join(invalid.root,'src/progression.js'),'export const unrelated=true;');await assert.rejects(loadHomeQaSource(invalid.root),/compatible createProfile/);
});
test('HOME native harness uses root-bound server and profile factory without stylesheet substitution',async()=>{
 const source=await readFile(new URL('../scripts/home-composition-qa.mjs',import.meta.url),'utf8');
 assert.match(source,/loadHomeQaSource\(baseline\|\|undefined\)/);assert.match(source,/capture\.startServer\(\)/);assert.match(source,/capture\.createProfile\(/);
 assert.doesNotMatch(source,/\.route\('\*\*\/styles\/garage\.css'/);assert.doesNotMatch(source,/from '\.\.\/src\/progression\.js'/);
});
