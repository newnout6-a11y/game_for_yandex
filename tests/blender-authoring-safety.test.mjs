import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Roadster authoring rejects unsupported hosts before side effects and preserves the source on failed saves',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const code=String.raw`import sys,pathlib,tempfile,importlib.util,types,runpy,os
root=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('portable_blender_images',root/'scripts/portable_blender_images.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for version,order,size in [((4,2,0),'little',8),((4,4,0),'little',8),((4,3,2),'big',8),((4,3,2),'little',4)]:
 try:m.require_supported_blender(version,order,size)
 except RuntimeError:pass
 else:raise AssertionError('Unsupported host must fail')
m.require_supported_blender((4,3,2),'little',8)
with tempfile.TemporaryDirectory() as directory:
 d=pathlib.Path(directory);preview=d/'must-not-exist'
 os.environ['ROADSTER_PREVIEW']=str(preview)
 # No ops/data attributes: touching the scene before the guard fails this test.
 sys.modules['bpy']=types.SimpleNamespace(app=types.SimpleNamespace(version=(4,4,0)))
 sys.modules['bmesh']=types.ModuleType('bmesh')
 mathutils=types.ModuleType('mathutils');mathutils.Vector=lambda value:value;sys.modules['mathutils']=mathutils
 try:runpy.run_path(str(root/'scripts/create_roadster.py'))
 except RuntimeError as e:assert 'requires Blender 4.3' in str(e)
 else:raise AssertionError('Entrypoint should reject unsupported Blender')
 assert not preview.exists()
 target=d/'source.blend';original=(root/'art/roadster.blend').read_bytes();target.write_bytes(original)
 def fail_save(path):
  pathlib.Path(path).write_bytes(b'partial')
  raise OSError('injected save failure')
 def bad_header(path):pathlib.Path(path).write_bytes(b'BLENDER-v404')
 def private_bytes(path):pathlib.Path(path).write_bytes(original+b'/home/private-author')
 for callback,error in [(fail_save,OSError),(bad_header,ValueError),(private_bytes,AssertionError)]:
  try:m.save_portable_blend(target,callback)
  except error:pass
  else:raise AssertionError('Save should fail')
  assert target.read_bytes()==original
  assert sorted(p.name for p in d.iterdir())==['source.blend']
 result=m.save_portable_blend(target,lambda path:pathlib.Path(path).write_bytes(original))
 assert target.read_bytes()==original and len(result['packedPaths'])==8
 assert sorted(p.name for p in d.iterdir())==['source.blend']
print('AUTHORING_PREFLIGHT_AND_ATOMIC_SAVE_PASS')`;
 assert.match(execFileSync('python3',['-B','-c',code,root],{encoding:'utf8'}),/AUTHORING_PREFLIGHT_AND_ATOMIC_SAVE_PASS/);
});
