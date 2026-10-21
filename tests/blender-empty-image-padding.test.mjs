import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('cleared Image filepath still rejects and removes stale suffix bytes without changing actual art',()=>{
 const code=String.raw`import sys,pathlib,importlib.util,tempfile
root=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('portable',root/'scripts/portable_blender_images.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=(root/'art/roadster.blend').read_bytes();m.validate_packed_image_padding(root/'art/roadster.blend')
fields=list(m.image_path_fields(original));assert any(not name for _,_,name in fields),'Real artifact includes a valid empty image path'
start,_,_=fields[0];expected=bytearray(original);expected[start:start+1024]=bytes(1024)
data=bytearray(expected);marker=b'PRIVATE_EMPTY_IMAGE_PADDING_SENTINEL';data[start+1:start+1+len(marker)]=marker
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'synthetic.blend';p.write_bytes(data)
 try:m.validate_packed_image_padding(p)
 except AssertionError:pass
 else:raise AssertionError('Empty visible Image path must not hide stale padding')
 m.normalize_packed_image_padding(p);assert p.read_bytes()==expected
 assert marker not in p.read_bytes();m.validate_packed_image_padding(p)
assert (root/'art/roadster.blend').read_bytes()==original
print('EMPTY_IMAGE_PADDING_REGRESSION_PASS')`;
 assert.match(execFileSync('python3',['-B','-c',code,fileURLToPath(new URL('../',import.meta.url))],{encoding:'utf8'}),/EMPTY_IMAGE_PADDING_REGRESSION_PASS/);
});
