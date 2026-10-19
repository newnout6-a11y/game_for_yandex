import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {startServer} from './serve.mjs';

const workspace=fileURLToPath(new URL('../',import.meta.url));
/**
 * Load one complete trusted source tree for a HOME capture. The HTML, runtime
 * imports, styles, vendor dependencies and assets all use this same root; a
 * missing baseline file must fail rather than fall back to the current tree.
 * Only the main entrypoint receives the caller's test-only inspection hook.
 * @param {string} [directory] Absolute or working-directory-relative snapshot root.
 * @returns {Promise<object>} Main bytes/hash, matching profile factory and a root-bound server factory.
 */
export async function loadHomeQaSource(directory=workspace) {
  const root=path.resolve(directory);
  const [main,index]=await Promise.all(['src/main.js','index.html'].map(file=>readFile(path.join(root,file),'utf8')));
  const {createProfile}=await import(pathToFileURL(path.join(root,'src/progression.js')).href);
  if(typeof createProfile!=='function')throw new Error('Capture source has no compatible createProfile fixture factory');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  return {root,main,createProfile,provenance:{mainSha256:hash(main),indexSha256:hash(index),completeSourceTree:true},
    startServer:({port=0,host='127.0.0.1'}={})=>startServer({root,port,host})};
}
