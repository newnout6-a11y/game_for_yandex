"""Audit the original mural's solid-wall containment and unchanged workshop.

Run after the bounded --resume --mural-only generator update:
  blender -b --python scripts/audit_garage_mural.py -- --baseline-dir <old-sources> --placement-baseline-dir <pre-framing-sources>
The required accepted baseline is read-only. Reports use repository-relative paths only.
No sources, runtime assets, materials, image bytes or camera settings are edited.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import struct

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from sanitize_blend_sources import fingerprint, scalars, verify_paths

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-dir', type=Path, required=True, help='Read-only directory containing the accepted tier1–4.blend and tier1–4.glb before placement repair')
parser.add_argument('--report', default='art/garage/mural-placement-audit.json')
parser.add_argument('--placement-baseline-dir', type=Path, required=True, help='Read-only four sources immediately before the 0.75 m native-framing adjustment')
parser.add_argument('--render', action='store_true', help='Render saved sources with a reference car without saving or exporting changes')
opts = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
EXPECTED = {
    'version': 2, 'support': 'Right rear return wall',
    'wall_interior_x': 9.88, 'paint_x': 9.878, 'paint_offset_m': .002,
    'z_min': 1., 'z_max': 7., 'y_min': 1.5, 'y_max': 4.5,
    'normal': [-1., 0., 0.], 'texture_aspect': 2.,
}
IMAGE_SHA = '996ac11896fe59aa172ad3c8b1b0a60a1743afa5b0a7d5dcbea6a39ffbb472fd'
VIEWS = {
    'normal-overview': [-3.55, 2.55, -4.85],
    'front-centre': [0., 2.55, -6.],
    'front-opposite': [3.55, 2.55, -4.85],
    'left-side': [-6., 2.55, 0.],
    'right-side': [6., 2.55, 0.],
    'rear-centre': [0., 2.55, 6.],
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def game(p):
    return [p.x, p.z, -p.y]


def blender(p):
    return Vector((p[0], -p[2], p[1]))


def canonical(value):
    if hasattr(value, 'to_dict'):
        return value.to_dict()
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in value.items()}
    return value


def preserved_state(tier):
    """Exact authored mesh, UV, matrix and material-slot hashes excluding paint."""
    objects = {}
    for ob in sorted(bpy.context.scene.objects, key=lambda ob: ob.name):
        if ob.get('original_garage_mural'):
            continue
        h = hashlib.sha256()
        h.update(json.dumps([ob.name, ob.type, ob.parent.name if ob.parent else None,
                             [list(row) for row in ob.matrix_local]], sort_keys=True).encode())
        if ob.type == 'MESH':
            mesh = ob.data
            for collection, prop, width, dtype in [
                (mesh.vertices, 'co', 3, np.float32),
                (mesh.loops, 'vertex_index', 1, np.int32),
                (mesh.polygons, 'loop_total', 1, np.int32),
                (mesh.polygons, 'material_index', 1, np.int32),
                (mesh.polygons, 'use_smooth', 1, np.bool_),
            ]:
                values = np.empty(len(collection) * width, dtype=dtype)
                collection.foreach_get(prop, values)
                h.update(values.tobytes())
            for uv in mesh.uv_layers:
                values = np.empty(len(uv.data) * 2, dtype=np.float32)
                uv.data.foreach_get('uv', values)
                h.update(uv.name.encode()); h.update(values.tobytes())
            h.update('|'.join(m.name for m in mesh.materials).encode())
        elif ob.data:
            h.update(json.dumps(scalars(ob.data), sort_keys=True, default=str).encode())
        objects[ob.name] = h.hexdigest()
    fp = fingerprint()
    root = bpy.data.objects[f'GARAGE_TIER_0{tier}']
    return {
        'objects_without_mural': objects,
        'materials': fp['materials'], 'images': fp['images'],
        'settings': fp['settings'], 'armatures': fp['armatures'],
        'camera_contract': canonical(root['garageCamera']),
        'screen_contract': canonical(root['garageScreen']),
    }


def runtime_state(path):
    """Compare actual exported accessor/image payloads, not only source counts."""
    raw = path.read_bytes(); length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+length]); binary = raw[28+length:]
    def payload(index):
        view = doc['bufferViews'][index]; start = view.get('byteOffset', 0)
        return sha(binary[start:start+view['byteLength']])
    meshes = {}
    for mesh in doc['meshes']:
        if any(doc['materials'][p['material']]['name'] == 'Original rose velocity mural' for p in mesh['primitives']):
            continue
        primitives = []
        for primitive in mesh['primitives']:
            record = {'material': doc['materials'][primitive['material']]['name'], 'mode': primitive.get('mode', 4)}
            for semantic, index in {**primitive['attributes'], 'indices': primitive['indices']}.items():
                accessor = doc['accessors'][index]
                record[semantic] = {'payload': payload(accessor['bufferView']),
                                    'specification': {key: value for key, value in accessor.items() if key != 'bufferView'}}
            primitives.append(record)
        meshes[mesh['name']] = primitives
    return {'non_mural_accessors': meshes, 'materials': doc['materials'],
            'images': {image['name']: payload(image['bufferView']) for image in doc['images']}}


records = []
for tier in [1, 2, 3, 4]:
    source = ROOT / f'art/garage/tier{tier}.blend'
    baseline = None
    placement_before_path = opts.placement_baseline_dir / source.name
    bpy.ops.wm.open_mainfile(filepath=str(placement_before_path))
    placement_before = next(ob for ob in bpy.context.scene.objects if ob.get('original_garage_mural'))
    previous_points = [game(placement_before.matrix_world @ p.co) for p in placement_before.data.vertices]
    previous_uvs = [tuple(uv.uv) for uv in placement_before.data.uv_layers.active.data]
    previous_polygons = [tuple(p.vertices) for p in placement_before.data.polygons]
    if opts.baseline_dir:
        baseline_path = opts.baseline_dir / source.name
        bpy.ops.wm.open_mainfile(filepath=str(baseline_path))
        baseline = preserved_state(tier)
        baseline_sha = sha(baseline_path.read_bytes())
    bpy.ops.wm.open_mainfile(filepath=str(source))
    after = preserved_state(tier)
    if baseline:
        assert baseline == after, ('Non-mural state changed', tier,
                                   [key for key in baseline if baseline[key] != after[key]])
    verify_paths(source)
    scene = bpy.context.scene
    root = bpy.data.objects[f'GARAGE_TIER_0{tier}']
    murals = [ob for ob in scene.objects if ob.get('original_garage_mural')]
    assert len(murals) == 1, ('Exactly one complete motif', tier, len(murals))
    mural = murals[0]
    assert len(mural.data.vertices) == 4 and len(mural.data.polygons) == 1
    assert canonical(mural['solid_wall_placement']) == EXPECTED
    assert canonical(root['garageMural']) == EXPECTED
    assert canonical(scene['garageMural']) == EXPECTED
    assert mural.data.materials[0].name == 'Original rose velocity mural'
    images = [node.image for node in mural.data.materials[0].node_tree.nodes if node.type == 'TEX_IMAGE']
    assert len(images) == 1 and list(images[0].size) == [1024, 512]
    assert [sha(p.packed_file.data) for p in images[0].packed_files] == [IMAGE_SHA]
    uvs = [tuple(uv.uv) for uv in mural.data.uv_layers.active.data]
    assert sorted(uvs) == [(0., 0.), (0., 1.), (1., 0.), (1., 1.)]
    bpy.context.view_layer.update()
    normal = mural.matrix_world.to_3x3() @ mural.data.polygons[0].normal
    assert (normal - Vector((-1, 0, 0))).length < 1e-6
    points = [game(mural.matrix_world @ p.co) for p in mural.data.vertices]
    assert len(points) == len(previous_points) == 4
    assert previous_uvs == uvs
    assert previous_polygons == [tuple(p.vertices) for p in mural.data.polygons]
    for before, after_point in zip(previous_points, points):
        assert all(abs(after_point[axis] - before[axis] - delta) < 1e-6
                   for axis, delta in enumerate([0., -.75, 0.])), ('Unexpected change beyond exact vertical translation', tier)
    assert all(abs(p[0] - EXPECTED['paint_x']) < 1e-6 for p in points)
    wall = bpy.data.objects[EXPECTED['support']]
    wall_points = np.asarray([game(wall.matrix_world @ Vector(p)) for p in wall.bound_box])
    low, high = wall_points.min(axis=0), wall_points.max(axis=0)
    for p in points:
        assert abs(low[0] - p[0] - .002) < 1e-6
        assert low[1] < p[1] < high[1] and low[2] < p[2] < high[2]
    # Trace through the entire intended paint area, starting behind the decal.
    # The first physical surface must always be the same uninterrupted wall.
    deps = bpy.context.evaluated_depsgraph_get()
    support_rays = []
    for u in [0., .25, .5, .75, 1.]:
        for vv in [0., .25, .5, .75, 1.]:
            origin = blender([9.8785, 1.5 + vv * 3., 1. + u * 6.])
            hit, location, normal, index, ob, matrix = scene.ray_cast(deps, origin, Vector((1, 0, 0)), distance=.01)
            assert hit and ob == wall, ('Paint lacks real solid backing', tier, u, vv, ob)
            support_rays.append({'uv': [u, vv], 'support': ob.name, 'distance_m': round((location-origin).length, 7)})
    # Neither quad nor texture ever reaches a moving leaf, gate reveal or track.
    gate_objects = [ob for ob in scene.objects if ob.type == 'MESH' and
                    ob.name.startswith(('Insulated sectional door leaf', 'Door reveal', 'Door track extrusion', 'Door hinge strap'))]
    for ob in gate_objects:
        gate = np.asarray([game(ob.matrix_world @ Vector(p)) for p in ob.bound_box])
        assert gate[:, 0].max() < EXPECTED['paint_x'] - .1
    # The RGBA artwork has large fully transparent margins. Visibility must
    # measure the actual car/lightning pigment, not invisible quad corners.
    width, height = images[0].size
    image_pixels = np.empty(width * height * 4, dtype=np.float32)
    images[0].pixels.foreach_get(image_pixels)
    image_pixels = image_pixels.reshape(height, width, 4)
    opaque_samples = []
    for u in [i / 20 for i in range(1, 20)]:
        for vv in [j / 12 for j in range(1, 12)]:
            alpha = float(image_pixels[round(vv * (height - 1)), round(u * (width - 1)), 3])
            if alpha >= .5:
                opaque_samples.append((u, vv, alpha))
    assert len(opaque_samples) >= 50, ('Visibility probes must span the actual painted motif', tier)
    views = []
    for name, eye in VIEWS.items():
        hits = []
        for u, vv, alpha in opaque_samples:
            target = blender([9.878, 1.5 + vv * 3., 1. + u * 6.])
            origin = blender(eye); delta = target-origin
            hit, location, normal, index, ob, matrix = scene.ray_cast(deps, origin, delta.normalized(), distance=delta.length + .005)
            clear = bool(hit and ob == mural)
            hits.append({'uv': [u, vv], 'artwork_alpha': round(alpha, 6), 'clear': clear, 'first_hit': ob.name if hit else None})
        views.append({'name': name, 'eye': eye, 'clear_rays': sum(hit['clear'] for hit in hits), 'total_rays': len(hits), 'rays': hits})
    overview_minimum = .95 if tier < 4 else .75
    assert views[0]['clear_rays'] >= len(opaque_samples) * overview_minimum, ('Normal overview artwork is materially obscured', tier, views[0])
    # Side-orbit occlusion by retained equipment is an observation, not a
    # reason to delete/move that equipment or claim the whole painting is clear.
    # The exact fractions and first-hit identities remain in the audit.
    assert all(view['clear_rays'] > 0 for view in views), ('Artwork is completely hidden at a tested normal orbit', tier)
    for view in views:
        assert all(hit['clear'] or (hit['first_hit'] in after['objects_without_mural'] and
                   not hit['first_hit'].startswith(('Door reveal', 'Door track', 'Insulated sectional door leaf')))
                   for hit in view['rays']), ('Gate or new object obstructs the wall artwork', tier, view['name'])
    glb = ROOT / f'public/assets/garage/tier{tier}.glb'
    report = json.loads((ROOT / f'art/garage/tier{tier}-report.json').read_text())
    record = {
        'tier': tier, 'source': str(source.relative_to(ROOT)), 'glb': str(glb.relative_to(ROOT)),
        'source_sha256': sha(source.read_bytes()), 'glb_sha256': sha(glb.read_bytes()),
        'framing_adjustment': {
            'source_before_sha256': sha(placement_before_path.read_bytes()),
            'translation_game_m': [0., -.75, 0.], 'quad_size_topology_and_uvs_unchanged': True,
            'all_four_vertices_exact_translation_verified': True,
            'acceptance_reference': 'Actual native-game overview; final recapture required, not studio-camera-only acceptance',
        },
        'placement': EXPECTED, 'editable_mural_meshes': 1, 'mural_vertices': 4, 'mural_triangles': 2,
        'visibility_sampling': {'method': '20 by 12 UV grid filtered to original packed artwork alpha >= 0.5', 'opaque_samples_per_view': len(opaque_samples)},
        'original_texture_sha256': IMAGE_SHA, 'source_paths_portable_and_images_packed': True,
        'unchanged_non_mural_objects': len(after['objects_without_mural']),
        'non_mural_geometry_materials_images_settings_camera_tv_unchanged': baseline == after if baseline else None,
        'preserved_state_sha256': sha(json.dumps(after, sort_keys=True).encode()),
        'wall_bounds_game_m': {'min': low.tolist(), 'max': high.tolist()},
        'support_rays': support_rays, 'door_and_frame_bounds_disjoint': True,
        'visibility': views,
        'runtime': {key: report[key] for key in ['bytes', 'draw_batches', 'triangles', 'vertices', 'bounds_m']},
    }
    if baseline:
        record['baseline_source_sha256'] = baseline_sha
        runtime_before = runtime_state(opts.baseline_dir / glb.name)
        runtime_after = runtime_state(glb)
        assert runtime_before == runtime_after, ('Non-mural exported payload changed', tier)
        record['runtime_preservation'] = {
            'non_mural_accessors_byte_identical': True, 'all_materials_identical': True,
            'all_images_byte_identical': True, 'non_mural_mesh_batches': len(runtime_after['non_mural_accessors']),
            'preserved_payload_sha256': sha(json.dumps(runtime_after, sort_keys=True).encode()),
        }
    records.append(record)
    print('MURAL_AUDIT_PASS', tier, json.dumps({v['name']: v['clear_rays'] for v in views}), flush=True)
    if opts.render:
        bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/assets/roadster.glb'))
        scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
        scene.cycles.samples = 24; scene.cycles.use_denoising = False
        scene.render.resolution_x = 1152; scene.render.resolution_y = 720; scene.render.resolution_percentage = 100
        scene.camera.location = blender([-4.3, 2.9, -5.9])
        scene.camera.rotation_euler = (blender([1.2, 1.7, 1.5]) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.camera.data.lens = 24
        preview = ROOT / f'output/mural-placement/tier{tier}-final.png'
        preview.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(preview); bpy.ops.render.render(write_still=True)
        record['preview'] = str(preview.relative_to(ROOT))
report = {
    'version': 1, 'scope': 'Only relocate the unchanged original Rose Velocity mural to the uninterrupted right concrete return wall.',
    'method': 'Open real packed Blender sources; compare exact non-mural baseline state; inspect one full-UV quad; cast 25 physical-backing rays and dense alpha-qualified artwork visibility rays from six normal orbits per tier.',
    'visibility_note': 'Only alpha >= 0.5 original artwork pixels count for visibility, not transparent quad corners. Existing solid lift/gantry equipment may correctly occlude a narrow part at some orbits; paint is never projected onto that equipment or any gate.',
    'sources': records,
}
destination = ROOT / opts.report; destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2) + '\n')
print('MURAL_PLACEMENT_AUDIT_COMPLETE', str(destination.relative_to(ROOT)), flush=True)
