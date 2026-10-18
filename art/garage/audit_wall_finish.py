"""Audit current wall AND floor PBR sources against a read-only scene baseline.

Run with Blender: -- --before <source-root> [--after <source-root>]. The source
comparison preserves baseline non-surface shaders, mural bytes, preview lights,
cameras and render settings. One explicitly requested TV display material is
recorded separately; no other material addition or deletion is allowed. It
deliberately does not claim geometry/camera-contract
equality: the coordinated reverse-workshop pass adds authored architecture.
This audit never saves or exports a source and writes only its JSON evidence.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from garage_surface_finish import RESOLUTION, SPECS, VERSION
from sanitize_blend_sources import fingerprint, scalars, verify_paths

SURFACE_MATERIALS = {spec['material'] for spec in SPECS.values()}
RETIRED_TEXTURES = {'original-concrete-grain', 'original-concrete-roughness', 'original-wall-fine-mineral'}
APPROVED_NEW_MATERIALS = {'garage_screen_display'}
APPROVED_NEW_IMAGES = {'roadster-screen-poster': {
    'file': 'public/assets/garage/roadster-screen-poster.jpg',
    'bytes': 20303,
    'sha256': '9f37f6324365999516ee6a9ab18951d1c9a6feb91f8921f2fe8335d82e0e8424',
    'dimensions': [640, 360],
    'provenance': 'art/garage/screen/supplied-video-provenance.json',
    'authorship': 'Poster derived from third-party Tesla footage supplied by the user; not original game artwork.',
    'redistribution_license': 'Unverified; not inferred from user possession. Public release approval is separate.',
}}


def digest(value):
    """Hash portable ordered audit state without repeating large property lists."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def node_state(tree):
    """Capture exact node values, image identities and socket connections."""
    if tree is None:
        return None
    return {
        'nodes': sorted([[node.name, scalars(node),
            node.image.name if hasattr(node, 'image') and node.image else None,
            [scalars(socket) for socket in node.inputs],
            [scalars(socket) for socket in node.outputs]] for node in tree.nodes], key=lambda node: node[0]),
        'links': sorted([link.from_node.name, link.from_socket.identifier,
            link.to_node.name, link.to_socket.identifier] for link in tree.links),
    }


def surface_contract(root):
    """Verify real packed PBR graphs, physical UV scale and linear data-map roles."""
    assert root.get('workshop_surface_finish_version') == VERSION
    result = {}
    for surface, spec in SPECS.items():
        material = bpy.data.materials[spec['material']]
        assert material.get('workshop_surface_finish_version') == VERSION
        assert abs(material['texture_tile_metres'] - spec['tile_metres']) < 1e-6
        nodes = material.node_tree.nodes
        mappings = [node for node in nodes if node.type == 'MAPPING']
        assert len(mappings) == 1
        assert all(abs(value - 2 / spec['tile_metres']) < 1e-6 for value in mappings[0].inputs['Scale'].default_value[:2])
        shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
        assert shader.inputs['Metallic'].default_value == 0
        assert all(shader.inputs[socket].is_linked for socket in ['Base Color', 'Roughness', 'Normal'])
        normals = [node for node in nodes if node.type == 'NORMAL_MAP']
        assert len(normals) == 1 and normals[0].space == 'TANGENT'
        assert normals[0].inputs['Strength'].default_value == 1
        images = {}
        for role in ['basecolor', 'normal', 'roughness']:
            name = f'original-workshop-{surface}-{role}'
            image_nodes = [node for node in nodes if node.type == 'TEX_IMAGE' and node.image and node.image.name == name]
            assert len(image_nodes) == 1
            node = image_nodes[0]
            assert node.extension == 'REPEAT' and node.interpolation == 'Linear'
            assert node.inputs['Vector'].is_linked
            image = node.image
            assert list(image.size) == [RESOLUTION, RESOLUTION]
            assert image.colorspace_settings.name == ('sRGB' if role == 'basecolor' else 'Non-Color')
            assert image.packed_file
            images[role] = {'name': name, 'packed_bytes': len(image.packed_file.data),
                'sha256': hashlib.sha256(image.packed_file.data).hexdigest(),
                'colour_space': image.colorspace_settings.name}
        result[surface] = {'material': material.name, 'tile_metres': spec['tile_metres'],
            'resolution': RESOLUTION, 'images': images, 'shader': digest(node_state(material.node_tree))}
    return result


def inspect(path, tier, current=False):
    """Read one saved source and separate preserved state from intentional changes."""
    bpy.ops.wm.open_mainfile(filepath=str(path))
    root = bpy.data.objects[f'GARAGE_TIER_{tier:02d}']
    state = fingerprint()
    material_graphs = {material.name: digest([scalars(material), node_state(material.node_tree)])
        for material in bpy.data.materials if material.name not in SURFACE_MATERIALS}
    non_surface_images = {image.name: hashlib.sha256(image.packed_file.data).hexdigest()
        for image in bpy.data.images if image.packed_file
        and image.name.split('.')[0] not in RETIRED_TEXTURES and not image.name.startswith('original-workshop-')}
    preserved = {
        'baseline_non_surface_materials': digest({name: graph for name, graph in material_graphs.items()
            if name not in APPROVED_NEW_MATERIALS}),
        'lighting_and_camera': digest({
            'lights': sorted([[light.name, scalars(light)] for light in bpy.data.lights]),
            'cameras': sorted([[camera.name, scalars(camera)] for camera in bpy.data.cameras]),
            'worlds': sorted([[world.name, scalars(world), node_state(world.node_tree)] for world in bpy.data.worlds]),
        }),
        'render_settings': state['settings'],
        'baseline_non_surface_packed_images': {name: image_hash for name, image_hash in non_surface_images.items()
            if name not in APPROVED_NEW_IMAGES},
    }
    result = {
        'preserved': preserved,
        'non_surface_material_graphs': material_graphs,
        'non_surface_packed_image_hashes': non_surface_images,
        'geometry': state['meshes'],
        'objects': state['objects'],
        'camera_contract': digest(root['garageCamera'].to_dict()),
        'camera_obstacle_count': len(root['garageCamera']['obstacles']),
        'statistics': state['statistics'],
        'source_bytes': path.stat().st_size,
        'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'relative_packed_paths_verified': bool(verify_paths(path)),
    }
    if current:
        result['surface_contract'] = surface_contract(root)
        result['retired_surface_payloads'] = [image.name for image in bpy.data.images if image.name.split('.')[0] in RETIRED_TEXTURES]
        assert not result['retired_surface_payloads'], 'Unused superseded packed surfaces inflate the editable source'
        result['approved_new_packed_images'] = {}
        for name, expected in APPROVED_NEW_IMAGES.items():
            image = bpy.data.images[name]
            assert image.packed_file and len(image.packed_file.data) == expected['bytes']
            assert hashlib.sha256(image.packed_file.data).hexdigest() == expected['sha256']
            assert list(image.size) == expected['dimensions']
            assert image.colorspace_settings.name == 'sRGB'
            result['approved_new_packed_images'][name] = dict(expected)
    return result


def image_header(data):
    """Read dimensions and encoded channels from exported PNG or JPEG bytes."""
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        width, height = struct.unpack_from('>II', data, 16)
        return width, height, {0: 1, 2: 3, 4: 2, 6: 4}[data[25]], 'PNG'
    assert data[:2] == b'\xff\xd8', 'Unsupported embedded image encoding'
    offset = 2
    while offset < len(data):
        assert data[offset] == 255, 'Invalid JPEG marker'
        while data[offset] == 255:
            offset += 1
        marker = data[offset]
        offset += 1
        if marker in {0xd8, 0x01, *range(0xd0, 0xd8)}:
            continue
        if marker == 0xd9:
            break
        length = struct.unpack_from('>H', data, offset)[0]
        if marker in {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}:
            height, width = struct.unpack_from('>HH', data, offset + 3)
            return width, height, data[offset + 7], 'JPEG'
        offset += length
    raise AssertionError('JPEG is missing a supported frame header')


def glb_payload(path):
    """Measure exported images and estimate their uncompressed RGBA8 mip storage."""
    data = path.read_bytes()
    assert data[:4] == b'glTF'
    length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + length])
    binary = data[28 + length:]
    images = {image['name']: document['bufferViews'][image['bufferView']]['byteLength']
        for image in document.get('images', [])}
    details = {}
    for image in document.get('images', []):
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        encoded = binary[start:start + view['byteLength']]
        width, height, channels, encoding = image_header(encoded)
        w, h, mip_pixels = width, height, 0
        while True:
            mip_pixels += w * h
            if w == h == 1:
                break
            w, h = max(1, w // 2), max(1, h // 2)
        details[image['name']] = {'dimensions': [width, height],
            'encoding': encoding, 'encoded_channels': channels,
            'estimated_rgba8_full_mip_bytes': mip_pixels * 4}
    surface_bytes = sum(size for name, size in images.items()
        if name.split('.')[0] in RETIRED_TEXTURES or name.startswith('original-workshop-'))
    estimated_surface_gpu_bytes = sum(detail['estimated_rgba8_full_mip_bytes'] for name, detail in details.items()
        if name.split('.')[0] in RETIRED_TEXTURES or name.startswith('original-workshop-'))
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
        'image_bytes': sum(images.values()), 'surface_image_bytes': surface_bytes,
        'non_image_bytes': len(data) - sum(images.values()), 'images': images,
        'image_details': details, 'estimated_surface_gpu_rgba8_mip_bytes': estimated_surface_gpu_bytes}


def write_map_audit(before_root, after_root):
    """Record original map provenance and honest source/runtime byte deltas."""
    maps = {}
    for surface, spec in SPECS.items():
        images = {}
        for role in ['basecolor', 'normal', 'roughness']:
            relative = Path(f'public/assets/garage/original-workshop-{surface}-{role}.png')
            data = (after_root / relative).read_bytes()
            width, height = struct.unpack_from('>II', data, 16)
            assert width == height == RESOLUTION
            images[role] = {'file': relative.as_posix(), 'bytes': len(data),
                'sha256': hashlib.sha256(data).hexdigest(), 'dimensions': [width, height],
                'colour_space': 'sRGB' if role == 'basecolor' else 'Non-Color'}
        maps[surface] = {**spec, 'uv_scale': 2 / spec['tile_metres'], 'images': images}
    rooms = []
    for tier in range(1, 5):
        relative = Path(f'public/assets/garage/tier{tier}.glb')
        before = glb_payload(before_root / relative)
        after = glb_payload(after_root / relative)
        rooms.append({'tier': tier, 'file': relative.as_posix(), 'before': before, 'after': after,
            'total_byte_delta': after['bytes'] - before['bytes'],
            'surface_image_byte_delta': after['surface_image_bytes'] - before['surface_image_bytes'],
            'non_surface_image_byte_delta': (after['image_bytes'] - after['surface_image_bytes']) - (before['image_bytes'] - before['surface_image_bytes']),
            'non_image_byte_delta': after['non_image_bytes'] - before['non_image_bytes'],
            'estimated_surface_gpu_byte_delta': after['estimated_surface_gpu_rgba8_mip_bytes'] - before['estimated_surface_gpu_rgba8_mip_bytes']})
    output = after_root / 'art/garage/workshop-surface-map-audit.json'
    output.write_text(json.dumps({'version': VERSION,
        'source': 'scripts/garage_surface_finish.py',
        'provenance': 'The six wall/floor maps are original reproducible periodic mineral aggregate and physical microrelief, with no photographic or third-party input. Physical normals derive from metre-scale height gradients. The separate television poster is derived from user-supplied third-party Tesla footage, not original game artwork; its redistribution license is unverified and its provenance is recorded separately.',
        'resolution': RESOLUTION, 'surfaces': maps, 'approved_new_images': APPROVED_NEW_IMAGES,
        'source_png_bytes': sum(image['bytes'] for surface in maps.values() for image in surface['images'].values()),
        'gpu_estimate': {
            'method': 'Approximate RGBA8 pixel storage including complete mip chains, derived from actual exported PNG dimensions. Not measured hardware allocation; excludes driver padding, texture objects, PMREM, other room images and geometry.',
            'reuse': 'Six distinct surface images per room. Each GLB embeds its own images, and GarageScene caches separate loader results per tier; no cross-room image-source reuse is authored.',
            'all_four_cached_surface_bytes_before': sum(room['before']['estimated_surface_gpu_rgba8_mip_bytes'] for room in rooms),
            'all_four_cached_surface_bytes_after': sum(room['after']['estimated_surface_gpu_rgba8_mip_bytes'] for room in rooms),
            'all_four_cached_surface_byte_delta': sum(room['estimated_surface_gpu_byte_delta'] for room in rooms),
        },
        'rooms': rooms,
    }, indent=2) + '\n')


def main():
    """Compare all tiers against explicit evidence, never silently accept a new baseline."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', required=True)
    parser.add_argument('--after', default=str(ROOT))
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    rows = []
    for tier in range(1, 5):
        relative = Path(f'art/garage/tier{tier}.blend')
        before = inspect(Path(args.before) / relative, tier)
        after = inspect(Path(args.after) / relative, tier, current=True)
        before_materials = before['non_surface_material_graphs']
        after_materials = after['non_surface_material_graphs']
        assert not set(before_materials) - set(after_materials), 'A baseline material was removed'
        assert set(after_materials) - set(before_materials) == APPROVED_NEW_MATERIALS, 'Only the explicitly requested TV display material may be added'
        assert all(after_materials[name] == graph for name, graph in before_materials.items()), 'A baseline non-surface material changed'
        before_images = before['non_surface_packed_image_hashes']
        after_images = after['non_surface_packed_image_hashes']
        assert not set(before_images) - set(after_images), 'A baseline non-surface image was removed'
        assert set(after_images) - set(before_images) == set(APPROVED_NEW_IMAGES), 'Only the explicitly approved TV poster image may be added'
        assert all(after_images[name] == image_hash for name, image_hash in before_images.items()), 'A baseline non-surface packed image changed'
        assert before['preserved'] == after['preserved'], {'tier': tier, 'changed': [
            key for key in before['preserved'] if before['preserved'][key] != after['preserved'][key]]}
        rows.append({'tier': tier, 'source': str(relative), 'before': before, 'after': after,
            'baseline_non_surface_state_unchanged': True,
            'approved_new_materials': {name: after_materials[name] for name in sorted(APPROVED_NEW_MATERIALS)},
            'source_byte_delta': after['source_bytes'] - before['source_bytes']})
    output = Path(args.after) / 'art/garage/workshop-surface-source-audit.json'
    output.write_text(json.dumps({
        'version': VERSION,
        'scope': 'Current wall and floor PBR with exact preservation of every baseline non-surface material node graph, mural packed bytes, preview lighting, cameras and render settings. The only allowed additions are garage_screen_display material and the exact 20,303-byte roadster-screen-poster JPEG for the explicitly requested physical television, both recorded separately. The poster derives from third-party Tesla footage supplied by the user, not original game artwork; redistribution rights are unverified. Geometry and camera collision metadata are intentionally not equality-asserted because the authorized entry/charging area and television add authored objects.',
        'sources': rows,
    }, indent=2) + '\n')
    write_map_audit(Path(args.before), Path(args.after))
    print('WORKSHOP_SURFACE_SOURCE_PRESERVATION_PASS', len(rows), flush=True)


if __name__ == '__main__':
    main()
