"""Read-only Blender proof: snapshot or verify editable Roadster preservation.

Run from any directory:
  blender -b art/roadster.blend --python scripts/audit_roadster_preservation.py
For independently recording an input during a deliberate revision, append:
  -- --snapshot /absolute/path/to/snapshot.json
No file is opened for writing except an explicitly requested snapshot. The
.blend is never saved or modified. Normal regression verification is portable:
it needs this checkout and Blender, not the historical sibling publication.
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def hash_record(value):
    return digest(canonical(value))


def rounded(vector):
    return tuple(round(float(value), 6) for value in vector)


def snapshot():
    meshes = {}
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        data = obj.data
        vertices = [rounded(vertex.co) for vertex in data.vertices]
        polygons = []
        for polygon in data.polygons:
            points = [vertices[index] for index in polygon.vertices]
            rotations = [points[i:] + points[:i] for i in range(len(points))]
            polygons.append((min(rotations), polygon.material_index, polygon.use_smooth))
        # Position-associated corner normals/UVs avoid the source hood's harmless
        # reordered loop sequence while retaining every authored normal and UV.
        corners = []
        for loop, normal in zip(data.loops, data.corner_normals):
            corners.append((vertices[loop.vertex_index], rounded(normal.vector),
                            tuple((layer.name, rounded(layer.data[loop.index].uv)) for layer in data.uv_layers)))
        meshes[obj.name] = {
            'polygonGeometrySha256': hash_record(sorted(polygons)),
            'cornerPositionNormalUvSha256': hash_record(sorted(corners)),
            'matrixSha256': hash_record([rounded(row) for row in obj.matrix_world]),
            'parent': obj.parent.name if obj.parent else None,
            'materials': [material.name for material in data.materials],
            'vertices': len(data.vertices), 'polygons': len(data.polygons), 'loops': len(data.loops),
        }
    images = {}
    for image in bpy.data.images:
        if image.type == 'RENDER_RESULT':
            continue
        assert image.packed_file, 'All authored textures must be packed: ' + image.name
        assert image.filepath.startswith('//textures/'), 'Portable relative texture path required: ' + image.name
        assert image.packed_files, 'Packed image records must exist: ' + image.name
        for packed_file in image.packed_files:
            assert packed_file.filepath == image.filepath, 'Packed record must use the same relative path: ' + image.name
        packed = bytes(image.packed_file.data)
        source = Path(bpy.path.abspath(image.filepath))
        assert source.is_file(), 'Portable texture is missing: ' + image.filepath
        assert packed == source.read_bytes(), 'Packed image must equal the authored texture: ' + image.name
        images[image.name] = {'filepath': image.filepath, 'byteLength': len(packed), 'sha256': digest(packed)}
    return {'meshes': meshes, 'images': images}


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
current = snapshot()
if args and args[0] == '--snapshot':
    Path(args[1]).write_text(json.dumps(current, indent=2) + '\n')
    print('SOURCE_SNAPSHOT', len(current['meshes']), 'meshes;', len(current['images']), 'packed relative textures')
else:
    root = Path(__file__).resolve().parent.parent
    proof = json.loads((root / 'art/roadster-wing-preservation.json').read_text())
    expected = dict(proof['source']['unchangedMeshes'])
    expected.update({name: item['after'] for name, item in proof['source']['changedMeshes'].items()})
    assert current['meshes'].keys() == expected.keys(), 'Unexpected added or removed source meshes'
    for name, record in current['meshes'].items():
        assert record == expected[name], 'Source preservation mismatch: ' + name
    assert current['images'] == proof['source']['images'], 'Packed texture/path mismatch'
    assert digest(Path(bpy.data.filepath).read_bytes()) == proof['current']['blendSha256'], 'Source file hash mismatch'
    print('SOURCE_PRESERVATION_PASS', len(proof['source']['unchangedMeshes']), 'unchanged meshes;',
          len(proof['source']['changedMeshes']), 'intentional wing/pocket changes;', len(current['images']), 'exact packed textures')
