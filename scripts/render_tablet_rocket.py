"""Render the authored Rocket once, then replace only its central-tablet artwork.

Run from any directory with Blender 4.x:
    blender --background --python scripts/render_tablet_rocket.py
Use -- --render-only for an artwork preview without changing the .blend or GLB,
or -- --reuse-render to recompose/repack the checked-in render without tracing.

This is deliberately not a model exporter. The original .blend is re-opened
before replacing its existing packed tablet image. The GLB's original binary
payload is retained, except a previously appended tablet image may be replaced;
only that image's existing bufferView and the buffer length are repointed.
The one stale driverDisplay.ui_artwork description is corrected explicitly.
Every geometry/accessor/node transform/material/sampler and every other image
is verified unchanged; other custom properties are preserved. Studio lights/camera, hidden tablet and stowed pose exist only in the
temporary rendering scene, never in the saved source or game model.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import zlib

import bpy
import numpy as np
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
TEXTURES = ROOT / 'art' / 'textures'
OUTPUT = ROOT / 'output' / 'tablet-rocket'
ART_PATH = TEXTURES / 'roadster-tablet-rocket.png'
META_PATH = TEXTURES / 'roadster-tablet-rocket.json'
UI_PATH = TEXTURES / 'roadster-cabin-original-ui.png'
UI_NAME = 'roadster-cabin-original-ui'
BASELINE_UI_DESCRIPTION = 'Original orthographic side-profile status graphic; no factory software or live telemetry claim.'
UI_DESCRIPTION = 'Offline Blender render of this authored Rocket in parked/stowed pose; live game instruments remain separate; no factory UI claim.'
REGION = (300, 247, 680, 201)
CLEAR_REGION = (300, 245, 680, 203)
SUPERSAMPLE = 3
CAMERA_POSITION = (-8.0, 1.80, -3.4)
CAMERA_TARGET = (0.0, .57, 0.0)
ORTHO_SCALE = 5.55
SAMPLES = 128
LIGHTS = [
    ('key', (3, 6, -3), 1200, (.94, .97, 1), 5, 3),
    ('side', (-4, 3, 0), 950, (1, .98, .95), 5, 2),
    ('rim', (2, 3.6, 4), 1400, (.82, .9, 1), 4, 2),
    ('front', (-1, 1.7, -5), 220, (.9, .95, 1), 3, 2),
]


def digest(data):
    """Return the hexadecimal SHA256 of an exact file or binary payload."""
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    """Encode JSON deterministically, independent of dictionary insertion order."""
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def game_vector(value):
    """Rotate game +Y up / -Z forward into Blender +Z up / +Y forward."""
    return Vector((value[0], -value[2], value[1]))


def read_glb(path):
    """Validate a GLB 2 container and return its JSON document and BIN bytes."""
    raw = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    assert magic == b'glTF' and version == 2 and length == len(raw)
    size, kind = struct.unpack_from('<I4s', raw, 12)
    assert kind == b'JSON'
    document = json.loads(raw[20:20 + size])
    offset = 20 + size
    size, kind = struct.unpack_from('<I4s', raw, offset)
    assert kind == b'BIN\0'
    return document, raw[offset + 8:offset + 8 + size]


def ui_view(document):
    """Resolve the existing central-tablet image to its unchanged bufferView ID."""
    return next(image['bufferView'] for image in document['images'] if image['name'] == UI_NAME)


def view_bytes(document, binary, index):
    """Read one logical glTF payload, excluding any adjacent alignment padding."""
    view = document['bufferViews'][index]
    start = view.get('byteOffset', 0)
    return binary[start:start + view['byteLength']]


def immutable_glb_fingerprint(document, binary):
    """Hash canonical full GLB JSON sans storage offsets and UI image payload.

    The list preserves bufferView identities/order. All other view byte strings
    are included by SHA256, including every vertex/index/UV and non-tablet PNG.
    Thus offset/padding/file-size changes cannot hide an authored model change.
    Only the exact corrected tablet-description sentence is canonicalized back
    to its baseline wording; no arbitrary extra or custom property is ignored.
    """
    clean = json.loads(json.dumps(document))
    target = ui_view(clean)
    for node in clean.get('nodes', []):
        display = node.get('extras', {}).get('driverDisplay', {})
        if node.get('name') == 'Roadster' and display.get('ui_artwork') == UI_DESCRIPTION:
            display['ui_artwork'] = BASELINE_UI_DESCRIPTION
    clean['buffers'] = [{'uri': x.get('uri')} for x in clean['buffers']]
    for index, view in enumerate(clean['bufferViews']):
        view.pop('byteOffset', None)
        view.pop('byteLength', None)
        view['contentSha256'] = 'TABLET_IMAGE_EXCLUDED' if index == target else digest(view_bytes(document, binary, index))
    return digest(canonical(clean))


def read_png_rgba(path):
    """Decode the exact RGBA8 pixels saved by Blender for invariant checks."""
    raw = Path(path).read_bytes()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8
    payload = bytearray()
    while pos < len(raw):
        size = struct.unpack_from('>I', raw, pos)[0]
        kind = raw[pos + 4:pos + 8]
        data = raw[pos + 8:pos + 8 + size]
        if kind == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', data)
            assert depth == 8 and color == 6 and interlace == 0
        elif kind == b'IDAT':
            payload.extend(data)
        pos += size + 12
    data = zlib.decompress(payload)
    stride = width * 4
    result = np.zeros((height, stride), dtype=np.uint8)
    for y in range(height):
        row = data[y * (stride + 1):(y + 1) * (stride + 1)]
        mode = row[0]
        for x, value in enumerate(row[1:]):
            a = int(result[y, x - 4]) if x >= 4 else 0
            b = int(result[y - 1, x]) if y else 0
            c = int(result[y - 1, x - 4]) if y and x >= 4 else 0
            if mode == 1: value += a
            elif mode == 2: value += b
            elif mode == 3: value += (a + b) // 2
            elif mode == 4:
                p = a + b - c
                distances = (abs(p - a), abs(p - b), abs(p - c))
                value += (a, b, c)[distances.index(min(distances))]
            else: assert mode == 0
            result[y, x] = value & 255
    return result.reshape((height, width, 4))


def blend_model_fingerprint():
    """Fingerprint editable geometry, objects and material references in memory.

    Reopening the unmodified source before patching also removes all studio
    helpers and restores authored transforms/visibility/render settings.
    """
    result = hashlib.sha256()
    for ob in sorted(bpy.context.scene.objects, key=lambda value: value.name):
        props = json.loads(json.dumps(dict(ob.items()), default=lambda value: list(value) if hasattr(value, '__iter__') else str(value)))
        result.update(canonical([ob.name, ob.type, ob.parent.name if ob.parent else None,
                                 [list(row) for row in ob.matrix_local], ob.hide_render, props]))
        if ob.type == 'MESH':
            mesh = ob.data
            result.update(canonical([mesh.name, [m.name if m else None for m in mesh.materials]]))
            for collection, property_name, width, dtype in (
                (mesh.vertices, 'co', 3, np.float32),
                (mesh.loops, 'vertex_index', 1, np.int32),
                (mesh.polygons, 'loop_total', 1, np.int32),
                (mesh.polygons, 'material_index', 1, np.int32),
            ):
                array = np.empty(len(collection) * width, dtype=dtype)
                collection.foreach_get(property_name, array)
                result.update(array.tobytes())
            for layer in mesh.uv_layers:
                array = np.empty(len(layer.data) * 2, dtype=np.float32)
                layer.data.foreach_get('uv', array)
                result.update(array.tobytes())
    return result.hexdigest()


def render_artwork():
    """Render the original model at parked pose, then reduce to a clean RGBA PNG."""
    scene = bpy.context.scene
    for ob in scene.objects:
        if ob.get('aeroRole'):
            ob.location += game_vector(ob.get('aeroStowPositionOffset', (0, 0, 0)))
            if ob.get('aeroStowAngle'):
                rotation = Quaternion(game_vector(ob.get('aeroStowAxis', (1, 0, 0))).normalized(), ob['aeroStowAngle'])
                ob.rotation_euler = (ob.rotation_euler.to_quaternion() @ rotation).to_euler()
        if ob.name == 'RC_Original_Infotainment_Display':
            ob.hide_render = True
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    # This packaged Blender has no OpenImageDenoise. Spatial supersampling,
    # sufficient path samples and premultiplied linear reduction remove grain.
    scene.cycles.use_denoising = False
    scene.cycles.seed = 17
    scene.render.resolution_x = REGION[2] * SUPERSAMPLE
    scene.render.resolution_y = REGION[3] * SUPERSAMPLE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.06, .075, .09, 1)
    background.inputs['Strength'].default_value = .3
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for name, location, energy, color, size, size_y in LIGHTS:
        data = bpy.data.lights.new('TABLET_RENDER_' + name, 'AREA')
        data.energy, data.color, data.shape = energy, color, 'RECTANGLE'
        data.size, data.size_y = size, size_y
        ob = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(ob)
        ob.location = game_vector(location)
        ob.rotation_euler = (game_vector((0, .55, 0)) - ob.location).to_track_quat('-Z', 'Y').to_euler()
    data = bpy.data.cameras.new('TABLET_RENDER_camera')
    camera = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.location = game_vector(CAMERA_POSITION)
    camera.rotation_euler = (game_vector(CAMERA_TARGET) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type, data.ortho_scale = 'ORTHO', ORTHO_SCALE
    scene.render.filepath = str(OUTPUT / 'rocket-supersampled.png')
    bpy.ops.render.render(write_still=True)
    source = bpy.data.images.load(scene.render.filepath, check_existing=False)
    width, height = source.size
    rgba = np.empty(width * height * 4, dtype=np.float32)
    source.pixels.foreach_get(rgba)
    rgba = rgba.reshape((height, width, 4))
    rgba[:, :, :3] = np.where(rgba[:, :, :3] <= .04045, rgba[:, :, :3] / 12.92,
                              ((rgba[:, :, :3] + .055) / 1.055) ** 2.4)
    rgba[:, :, :3] *= rgba[:, :, 3:4]
    rgba = rgba.reshape(REGION[3], SUPERSAMPLE, REGION[2], SUPERSAMPLE, 4).mean(axis=(1, 3))
    rgba[:, :, :3] = np.divide(rgba[:, :, :3], rgba[:, :, 3:4], out=np.zeros_like(rgba[:, :, :3]), where=rgba[:, :, 3:4] > 0)
    rgba[:, :, :3] = np.where(rgba[:, :, :3] <= .0031308, rgba[:, :, :3] * 12.92,
                              1.055 * np.maximum(rgba[:, :, :3], 0) ** (1 / 2.4) - .055)
    image = bpy.data.images.new('TABLET_RENDER_result', width=REGION[2], height=REGION[3], alpha=True)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(ART_PATH)
    image.file_format = 'PNG'
    image.save()
    print('TABLET_ROCKET_PREVIEW', str(ART_PATH), flush=True)


def patch_glb(path, document, binary, png):
    """Atomically append/repoint only the existing tablet image without export."""
    for node in document.get('nodes', []):
        display = node.get('extras', {}).get('driverDisplay', {})
        if node.get('name') == 'Roadster':
            assert display.get('ui_artwork') in (BASELINE_UI_DESCRIPTION, UI_DESCRIPTION)
            display['ui_artwork'] = UI_DESCRIPTION
    target = ui_view(document)
    view = document['bufferViews'][target]
    previous_end = view.get('byteOffset', 0) + view['byteLength']
    # Subsequent runs replace our terminal appended image, rather than growing
    # the file forever. The original mid-buffer source image stays untouched.
    if previous_end == document['buffers'][0]['byteLength']:
        binary = binary[:view.get('byteOffset', 0)]
    else:
        binary = binary[:document['buffers'][0]['byteLength']]
    binary += b'\0' * (-len(binary) % 4)
    view['byteOffset'] = len(binary)
    view['byteLength'] = len(png)
    binary += png
    document['buffers'][0]['byteLength'] = len(binary)
    binary += b'\0' * (-len(binary) % 4)
    encoded = canonical(document)
    encoded += b' ' * (-len(encoded) % 4)
    data = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(encoded) + 8 + len(binary))
    data += struct.pack('<I4s', len(encoded), b'JSON') + encoded
    data += struct.pack('<I4s', len(binary), b'BIN\0') + binary
    temporary = Path(str(path) + '.tablet-tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def main():
    """Run the offline render/composite/image patch, verify invariants, and report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render-only', action='store_true')
    parser.add_argument('--reuse-render', action='store_true')
    parser.add_argument('--blend', type=Path, default=ROOT / 'art' / 'roadster.blend')
    parser.add_argument('--glb', type=Path, default=ROOT / 'public' / 'assets' / 'roadster.glb')
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    TEXTURES.mkdir(parents=True, exist_ok=True)
    source_blend_hash = digest(arguments.blend.read_bytes())
    source_glb_hash = digest(arguments.glb.read_bytes())
    original_document, original_binary = read_glb(arguments.glb)
    geometry_hash = immutable_glb_fingerprint(original_document, original_binary)
    prior = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
    if prior.get('geometryFingerprintSha256') != geometry_hash:
        prior = {}
    # Keep immutable model-baseline anchors stable across image-only rebuilds;
    # record actual current inputs separately rather than mislabeling provenance.
    anchor_blend_hash = prior.get('sourceBlendSha256', source_blend_hash)
    anchor_glb_hash = prior.get('sourceGlbSha256', source_glb_hash)
    render_blend_hash, render_glb_hash = source_blend_hash, source_glb_hash
    if arguments.reuse_render and prior.get('image', {}).get('sha256') == digest(ART_PATH.read_bytes()):
        render_blend_hash = prior.get('renderInputBlendSha256', prior['sourceBlendSha256'])
        render_glb_hash = prior.get('renderInputGlbSha256', prior['sourceGlbSha256'])
    old_ui = read_png_rgba(UI_PATH)
    bpy.ops.wm.open_mainfile(filepath=str(arguments.blend))
    source_model_hash = blend_model_fingerprint()
    other_packed_images = {im.name: digest(bytes(im.packed_file.data)) for im in bpy.data.images
                           if im.name != UI_NAME and im.packed_file is not None}
    if not arguments.reuse_render:
        render_artwork()
    if arguments.render_only:
        return
    # Critical: discard every camera/light/pose/visibility mutation above.
    bpy.ops.wm.open_mainfile(filepath=str(arguments.blend))
    assert blend_model_fingerprint() == source_model_hash
    sys.path.insert(0, str(ROOT / 'scripts'))
    from roadster_cabin import _save_image, _screen_art
    image = _save_image(UI_NAME, _screen_art(), str(TEXTURES))
    image.filepath_raw = '//textures/' + UI_NAME + '.png'
    image.pack()
    new_ui = read_png_rgba(UI_PATH)
    outside = np.ones(old_ui.shape[:2], dtype=bool)
    x, y, width, height = REGION
    clear_x, clear_y, clear_width, clear_height = CLEAR_REGION
    outside[clear_y:clear_y + clear_height, clear_x:clear_x + clear_width] = False
    assert np.array_equal(old_ui[outside], new_ui[outside]), 'Non-illustration UI changed'
    assert blend_model_fingerprint() == source_model_hash
    display = bpy.data.objects['Roadster']['driverDisplay']
    assert display['ui_artwork'] in (BASELINE_UI_DESCRIPTION, UI_DESCRIPTION)
    display['ui_artwork'] = UI_DESCRIPTION
    assert bytes(image.packed_file.data) == UI_PATH.read_bytes(), 'Packed UI differs from PNG'
    assert other_packed_images == {im.name: digest(bytes(im.packed_file.data)) for im in bpy.data.images
                                   if im.name != UI_NAME and im.packed_file is not None}
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(arguments.blend))
    patch_glb(arguments.glb, json.loads(json.dumps(original_document)), original_binary, UI_PATH.read_bytes())
    final_document, final_binary = read_glb(arguments.glb)
    assert immutable_glb_fingerprint(final_document, final_binary) == geometry_hash
    assert view_bytes(final_document, final_binary, ui_view(final_document)) == UI_PATH.read_bytes()
    assert all(view_bytes(original_document, original_binary, i) == view_bytes(final_document, final_binary, i)
               for i in range(len(original_document['bufferViews'])) if i != ui_view(original_document))
    artwork = read_png_rgba(ART_PATH)
    metadata = {
        'schemaVersion': 1,
        'purpose': 'Authentic static parked/stowed Rocket illustration on the central tablet; no rear-camera feed and no per-frame model render.',
        'sourceBlend': 'art/roadster.blend', 'sourceBlendSha256': anchor_blend_hash,
        'sourceGlb': 'public/assets/roadster.glb', 'sourceGlbSha256': anchor_glb_hash,
        'sourceAnchorMeaning': 'Immutable accepted model baseline; retained only while the geometry fingerprint matches. Current render inputs are recorded separately.',
        'inputBlendSha256': source_blend_hash, 'inputGlbSha256': source_glb_hash,
        'renderInputBlendSha256': render_blend_hash, 'renderInputGlbSha256': render_glb_hash,
        'geometryFingerprintSha256': geometry_hash,
        'geometryFingerprintMethod': 'SHA256 canonical sorted-key GLB JSON; buffer byte lengths and view offsets/lengths removed; each view replaced by its SHA256 except the one named tablet image. Includes all nodes, extras, materials, accessors, geometry and other images; only the exact new Roadster.driverDisplay.ui_artwork description is canonicalized to its original value.',
        'editableGeometryFingerprintSha256': source_model_hash,
        'image': {'path': 'art/textures/roadster-tablet-rocket.png', 'sha256': digest(ART_PATH.read_bytes()), 'width': width, 'height': height,
                  'alpha': True, 'partiallyTransparentPixels': int(((artwork[:, :, 3] > 0) & (artwork[:, :, 3] < 255)).sum())},
        'composition': {'region': list(REGION), 'clearRegion': list(CLEAR_REGION), 'resize': 'none',
                        'colorSpace': 'Explicit sRGB decode, linear-light alpha-over, explicit sRGB encode; Blender byte-buffer PNG stores encoded values unchanged',
                        'clearRegionReason': 'The obsolete 3px roof-outline brush extended to y245, two rows above the prior silhouette bounds; all live readout regions remain outside.',
                        'background': 'Unmodified procedural dark UI gradient, identical to same-row x=10',
                        'formula': 'result_linear_rgb = source_linear_rgb * alpha + background_linear_rgb * (1 - alpha)',
                        'outsideRegionRgbaSha256': digest(new_ui[outside].tobytes())},
        'render': {'engine': 'Blender Cycles', 'blenderVersion': bpy.app.version_string, 'samples': SAMPLES, 'seed': 17,
                   'viewTransform': 'AgX', 'look': 'AgX - Medium High Contrast', 'filmTransparent': True,
                   'supersample': SUPERSAMPLE, 'reduction': '3x3 area average in premultiplied linear RGB/alpha, then unpremultiply',
                   'sourceResolution': [width * SUPERSAMPLE, height * SUPERSAMPLE],
                   'camera': {'projection': 'orthographic', 'gamePosition': list(CAMERA_POSITION), 'gameTarget': list(CAMERA_TARGET), 'orthoScale': ORTHO_SCALE},
                   'lights': [{'name': n, 'gamePosition': list(p), 'watts': e, 'color': list(c), 'size': sx, 'sizeY': sy} for n, p, e, c, sx, sy in LIGHTS],
                   'pose': 'Existing authored aeroStowPositionOffset and aeroStowAxis/aeroStowAngle applied at deployment=0 only during render',
                   'recursionPrevention': 'Hide RC_Original_Infotainment_Display only in temporary render scene; reopen unmodified .blend before packing UI',
                   'modelMaterials': 'All source model materials unchanged during render and in outputs'},
        'output': {'blendSha256': digest(arguments.blend.read_bytes()), 'glbSha256': digest(arguments.glb.read_bytes()), 'uiSha256': digest(UI_PATH.read_bytes())},
        'verification': {'nonUiBufferViewsIdentical': True, 'geometryStructureIdentical': True, 'liveUiRegionsIdentical': True,
                         'editableGeometryIdentical': True, 'embeddedUiIdentical': True, 'packedUiIdentical': True,
                         'otherPackedImagesIdentical': True, 'noModelReExport': True,
                         'onlyDescriptionUpdated': 'Roadster.driverDisplay.ui_artwork', 'uiArtworkDescription': UI_DESCRIPTION},
    }
    META_PATH.write_text(json.dumps(metadata, indent=2) + '\n')
    (OUTPUT / 'image-patch-report.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print('TABLET_ROCKET_COMPLETE', json.dumps(metadata['output']), flush=True)


if __name__ == '__main__':
    main()
