import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const execute=promisify(execFile);
const harness=new URL('../scripts/cloud-save-dialog-qa.mjs',import.meta.url);
const serverModule=new URL('../scripts/serve.mjs',import.meta.url);
const repository=fileURLToPath(new URL('../',import.meta.url));
/** Run lifecycle regressions in a child: leaked HTTP handles must fail the exit deadline. */
async function child(body){
 const cwd=await mkdtemp(path.join(os.tmpdir(),'cloud-dialog-qa-'));
 try{
  return await execute(process.execPath,['--input-type=module','-e',`
   import assert from 'node:assert/strict';
   import {readFile} from 'node:fs/promises';
   import {createHash} from 'node:crypto';
   import {EventEmitter} from 'node:events';
   import {runCloudSaveDialogQa,CLOUD_DIALOG_ROOT} from ${JSON.stringify(harness.href)};
   import {startServer} from ${JSON.stringify(serverModule.href)};
   const out=${JSON.stringify(cwd)};
   ${body}
  `],{cwd,timeout:45000,maxBuffer:128*1024});
 }finally{await rm(cwd,{recursive:true,force:true});}
}

test('cloud dialog QA import outside the checkout has no browser or server side effects',async()=>{
 const {stdout}=await child(`assert.equal(CLOUD_DIALOG_ROOT,${JSON.stringify(repository)});console.log('IMPORT_ONLY');`);
 assert.match(stdout,/IMPORT_ONLY/);
});

test('launch failure closes the real HTTP server and preserves source paths from another cwd',async()=>{
 const {stdout}=await child(`
  let server;const failure=new Error('intentional launch failure');
  await assert.rejects(runCloudSaveDialogQa({out,
   serverFactory:options=>{assert.equal(options.root,CLOUD_DIALOG_ROOT);server=startServer(options);return server;},
   launchBrowser:async()=>{
    const origin='http://127.0.0.1:'+server.address().port;
    for(const file of ['index.html','src/main.js','styles/garage.css']){
     const response=await fetch(origin+'/'+file);assert.equal(response.status,200);
     assert.equal(await response.text(),await readFile(CLOUD_DIALOG_ROOT+file,'utf8'));
    }
    throw failure;
   }
  }),error=>error===failure);
  assert.equal(server.listening,false);
  const report=JSON.parse(await readFile(out+'/report.json','utf8'));
  for(const file of ['src/platform-services.js','src/garage-ui.js'])assert.equal(report.sourceHashes[file],createHash('sha256').update(await readFile(CLOUD_DIALOG_ROOT+file)).digest('hex'));
  console.log('LAUNCH_FAILURE_EXIT');
 `);
 assert.match(stdout,/LAUNCH_FAILURE_EXIT/);
});

test('assertion and browser-close failures still close the server and preserve the primary error',async()=>{
 const {stdout}=await child(`
  let server,closed=0;const primary=new Error('page assertion');
  await assert.rejects(runCloudSaveDialogQa({out,
   serverFactory:options=>{server=startServer(options);return server;},
   launchBrowser:async()=>({newPage:async()=>{throw primary;},close:async()=>{closed++;throw new Error('close failed');}})
  }),error=>error===primary);
  assert.equal(closed,1);assert.equal(server.listening,false);
  assert.equal(JSON.parse(await readFile(out+'/report.json','utf8')).devices.length,0);
  console.log('PAGE_FAILURE_EXIT');
 `);
 assert.match(stdout,/PAGE_FAILURE_EXIT/);
});

test('HTTP listen failure also enters cleanup without attempting browser startup',async()=>{
 const {stdout}=await child(`
  let closed=0,launched=0;const primary=new Error('listen failure');
  await assert.rejects(runCloudSaveDialogQa({out,
   serverFactory:()=>{const server=new EventEmitter();server.close=callback=>{closed++;callback();};setImmediate(()=>server.emit('error',primary));return server;},
   launchBrowser:async()=>{launched++;}
  }),error=>error===primary);
  assert.equal(closed,1);assert.equal(launched,0);console.log('LISTEN_FAILURE_EXIT');
 `);
 assert.match(stdout,/LISTEN_FAILURE_EXIT/);
});

test('actual CLI from an unrelated directory exits nonzero when Chromium is absent instead of leaking its server',async()=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'cloud-dialog-cli-'));
 try{
  await assert.rejects(execute(process.execPath,[fileURLToPath(harness)],{
   cwd,timeout:45000,maxBuffer:128*1024,env:{...process.env,CHROME_BIN:path.join(cwd,'missing-chromium'),CLOUD_DIALOG_QA_OUT:cwd}
  }),error=>{
   assert.equal(error.code,1);assert.ok(!error.killed);assert.equal(error.signal,null);
   assert.match(error.stderr,/executable doesn't exist/i);assert.doesNotMatch(error.stderr,/ENOENT.*src\/main/);
   return true;
  });
  const report=JSON.parse(await readFile(path.join(cwd,'report.json'),'utf8'));
  assert.equal(report.devices.length,0);assert.ok(report.sourceHashes['src/platform-services.js']);
 }finally{await rm(cwd,{recursive:true,force:true});}
});
