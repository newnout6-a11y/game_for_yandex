"""Optional end-to-end negative fixture for the production Blender audit.

python3 tests/garage-normal-audit-blender.py --baseline-dir /path/to/checkpoint

Only temporary files are written. Accepted sources/exports are never saved,
re-exported or modified. The fixture changes one drawn float32 NORMAL in tier 2,
leaving every other GLB byte exact, then must abort before emitting proof.
"""
import argparse
from pathlib import Path
import runpy
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / 'tests/garage-normal-audit.py'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-dir', type=Path, required=True)
parser.add_argument('--blender', default='blender')
opts = parser.parse_args()

with tempfile.TemporaryDirectory(prefix='garage-normal-negative-') as temporary:
    root = Path(temporary)
    art = root / 'art/garage'
    exports = root / 'public/assets/garage'
    art.mkdir(parents=True)
    exports.mkdir(parents=True)
    (root / 'scripts').symlink_to(ROOT / 'scripts', target_is_directory=True)
    for name in ('audit_stable_orbit.py', 'normal_validation.py',
                 'stable-orbit-placement.json', 'mural-placement-audit.json'):
        shutil.copyfile(ROOT / 'art/garage' / name, art / name)
    for tier in (1, 2, 3, 4):
        (art / f'tier{tier}.blend').symlink_to(ROOT / f'art/garage/tier{tier}.blend')
        if tier != 2:
            (exports / f'tier{tier}.glb').symlink_to(ROOT / f'public/assets/garage/tier{tier}.glb')

    original = (ROOT / 'public/assets/garage/tier2.glb').read_bytes()
    normals, normal_offset, doc = helpers['normal_accessor'](original)
    primitive = doc['meshes'][0]['primitives'][0]
    index_accessor = doc['accessors'][primitive['indices']]
    index_view = doc['bufferViews'][index_accessor['bufferView']]
    binary_offset = 28 + struct.unpack_from('<I', original, 12)[0]
    index_offset = binary_offset + index_view.get('byteOffset', 0) + index_accessor.get('byteOffset', 0)
    vertex = struct.unpack_from({5121: '<B', 5123: '<H', 5125: '<I'}[index_accessor['componentType']], original, index_offset)[0]
    normal_accessor = doc['accessors'][primitive['attributes']['NORMAL']]
    stride = doc['bufferViews'][normal_accessor['bufferView']].get('byteStride', 12)
    changed_offset = normal_offset + vertex * stride
    corrupted = bytearray(original)
    struct.pack_into('<3f', corrupted, changed_offset, *helpers['rotated'](normals[vertex], 1))
    assert corrupted[:changed_offset] == original[:changed_offset]
    assert corrupted[changed_offset + 12:] == original[changed_offset + 12:]
    assert corrupted != original
    (exports / 'tier2.glb').write_bytes(corrupted)
    print('FIXTURE: exactly one drawn tier2 NORMAL rotated 1 degree; all other GLB bytes preserved.', flush=True)
    result = subprocess.run([opts.blender, '-b', '-t', '2', '--python-exit-code', '1',
        '--python', str(art / 'audit_stable_orbit.py'), '--', '--baseline-dir',
        str(opts.baseline_dir.resolve())], capture_output=True, text=True, timeout=180)
    print(result.stdout + result.stderr, flush=True)
    assert result.returncode != 0, 'Corrupt shading NORMAL unexpectedly passed the full audit'
    assert 'Exported shading NORMAL changed beyond approved precision' in result.stdout + result.stderr
    assert 'STABLE_ORBIT_PRESERVATION_PASS 2' not in result.stdout
    assert not (art / 'stable-orbit-placement-audit.json').exists(), 'Failed audit must not emit passing proof'
    assert (ROOT / 'public/assets/garage/tier2.glb').read_bytes() == original
    print('PASS: production audit rejected the mutated exported NORMAL before tier 2 pass/proof; accepted GLB unchanged.')
