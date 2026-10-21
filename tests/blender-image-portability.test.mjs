import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from './helpers/roadster-preservation.mjs';

test('Blender packed-image records are relative with zero stale padding and a reproducible guarded sanitizer',async()=>{
 const root=new URL('../',import.meta.url),source=await readFile(new URL('art/roadster.blend',root));
 const proof=JSON.parse(await readFile(new URL('art/roadster-wing-preservation.json',root),'utf8'));
 assert.equal(sha256(source),proof.current.blendSha256);
 for(const token of ['/workspace/','/home/','/tmp/'])assert.equal(source.includes(Buffer.from(token)),false,token);
 assert.equal(sha256(await readFile(new URL('scripts/create_roadster.py',root))),proof.current.authoringEntrypointSha256);
 assert.equal(sha256(await readFile(new URL('scripts/portable_blender_images.py',root))),proof.current.packedPathSanitizerSha256);
 const code=`import sys, pathlib, tempfile, importlib.util\nroot=pathlib.Path(sys.argv[1])\nspec=importlib.util.spec_from_file_location('portable',root/'scripts/portable_blender_images.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\noriginal=(root/'art/roadster.blend').read_bytes()\nassert len(m.validate_packed_image_padding(root/'art/roadster.blend')['packedPaths'])==8\nfields=list(m.all_path_fields(original))\nwith tempfile.TemporaryDirectory() as directory:\n p=pathlib.Path(directory)/'corrupt.blend';data=bytearray(original);start,end,name=fields[-1];offset=start+end+1;data[offset:offset+5]=b'STALE';p.write_bytes(data)\n try:m.validate_packed_image_padding(p)\n except AssertionError:pass\n else:raise AssertionError('Stale padding must fail, even after a valid relative C-string')\n m.normalize_packed_image_padding(p)\n assert p.read_bytes()==original,'Sanitizer may change only the unused metadata padding'\nassert (root/'art/roadster.blend').read_bytes()==original\nprint('PACKED_PATH_CHECK_AND_NEGATIVE_CONTROL_PASS')`;
 const output=execFileSync('python3',['-B','-c',code,fileURLToPath(root)],{encoding:'utf8'});
 assert.match(output,/PACKED_PATH_CHECK_AND_NEGATIVE_CONTROL_PASS/);
});
