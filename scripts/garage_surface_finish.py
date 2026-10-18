"""Author original, metre-scaled workshop wall and floor PBR maps in Blender.

The retained garage UVs cover two metres per unit. Both finishes use selective
mineral aggregate at millimetre/centimetre scale, never broad colour clouds.
Run with Blender to regenerate the six reproducible PNGs, or import and call
``apply_workshop_surface_finish(root_object)`` before saving/exporting a garage.
Only the two named architectural materials are changed; no geometry is touched.
"""

from pathlib import Path
import hashlib
import json
import struct
import zlib

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public' / 'assets' / 'garage'
VERSION = 2
RESOLUTION = 512
SPECS = {
    'wall': {
        'material': 'Warm architectural concrete',
        'tile_metres': .75,
        'seed': 9351,
        'roughness': .84,
        'description': 'Matte mineral plaster with restrained 4–25 mm aggregate and shallow pores',
    },
    'floor': {
        'material': 'Original mottled concrete',
        'tile_metres': 1.0,
        'seed': 9352,
        'roughness': .77,
        'description': 'Honed workshop concrete with 5–35 mm mineral aggregate and shallow trowel relief',
    },
}


def _blur_periodic(field, sigma_x, sigma_y=None):
    """Gaussian-filter a periodic field without a visible tile-edge boundary."""
    sigma_y = sigma_x if sigma_y is None else sigma_y
    fy = np.fft.fftfreq(field.shape[0])[:, None]
    fx = np.fft.rfftfreq(field.shape[1])[None, :]
    kernel = np.exp(-2 * np.pi ** 2 * (sigma_x ** 2 * fx ** 2 + sigma_y ** 2 * fy ** 2))
    return np.fft.irfft2(np.fft.rfft2(field) * kernel, s=field.shape)


def _unit(field):
    """Center a texture signal and give it unit RMS before artistic weighting."""
    centered = field - field.mean()
    return centered / max(float(centered.std()), 1e-12)


def _band(field, fine, coarse):
    """Isolate a bounded grain size rather than summing cloudy low frequencies."""
    return _unit(_blur_periodic(field, fine) - _blur_periodic(field, coarse))


def _write_png(path, rgb):
    """Write deterministic lossless RGB8 PNG bytes with efficient row filtering.

    These source maps contain no alpha, timestamps, external photos or plugins.
    A PNG sub filter retains full quality while compressing the smooth normals.
    """
    rgb = np.asarray(rgb, dtype=np.uint8)
    height, width, channels = rgb.shape
    if channels != 3:
        raise ValueError('Surface maps must have exactly three colour channels')
    raw = rgb.reshape(height, width * channels)
    filtered = raw.copy()
    filtered[:, channels:] -= raw[:, :-channels]
    rows = b''.join(b'\x01' + row.tobytes() for row in filtered)
    def chunk(kind, data):
        """Encode one PNG chunk with its required unsigned CRC."""
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    content = b'\x89PNG\r\n\x1a\n'
    content += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    content += chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != content:
        path.write_bytes(content)
    return len(content)


def surface_pixels(surface):
    """Build bounded albedo, roughness and physical tangent-space normals.

    Base colour is deliberately not driven by the trowel relief: broad wet/dry
    patches and watercolour blotches are absent. Derivatives use actual metres,
    so normal strength remains meaningful if map resolution changes. Normal Y
    is inverted for top-down PNG row order, yielding glTF/OpenGL tangent normals.
    """
    spec = SPECS[surface]
    rng = np.random.default_rng(spec['seed'])
    source = rng.normal(size=(RESOLUTION, RESOLUTION))
    secondary = rng.normal(size=source.shape)
    if surface == 'wall':
        mineral = _band(source, 2.4, 8.5)
        fine = _band(secondary, 1.0, 2.8)
        pores = np.clip((_band(secondary, 1.2, 4.0) - 1.55) * .8, 0, 1)
        grain = np.tanh(mineral * .95)
        colour = 3.6 * grain + .7 * fine - 3.1 * pores
        height = .00013 * mineral + .000025 * fine - .00012 * pores
        roughness = spec['roughness'] + .031 * grain + .008 * fine + .035 * pores
    else:
        mineral = _band(source, 2.1, 7.4)
        fine = _band(secondary, 1.05, 2.9)
        aggregate = np.tanh(mineral * 1.25)
        pores = np.clip((_band(secondary, 1.0, 3.7) - 1.8) * .9, 0, 1)
        # The weak directional float marks belong only to physical finish, not
        # albedo. They are 1–8 cm long, not metre-scale painted brush strokes.
        trowel = _unit(_blur_periodic(secondary, 19, 2.4) - _blur_periodic(secondary, 23, 7.5))
        colour = 4.9 * aggregate + .85 * fine - 3.8 * pores
        height = .000075 * mineral + .000022 * fine - .00009 * pores + .000018 * trowel
        roughness = spec['roughness'] + .047 * aggregate + .009 * fine + .025 * pores + .012 * trowel
    # Keep the accepted average blue-grey concrete colour and overall exposure.
    colour -= colour.mean()
    base = np.stack([94.47 + colour * .94, 98.49 + colour * .98, 100.50 + colour], axis=-1)
    base = np.clip(np.rint(base), 0, 255).astype(np.uint8)
    roughness = np.clip(roughness, .62 if surface == 'floor' else .73, .94)
    rough = np.repeat(np.rint(roughness * 255).astype(np.uint8)[:, :, None], 3, axis=2)
    spacing = spec['tile_metres'] / RESOLUTION
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / (2 * spacing)
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) / (2 * spacing)
    normals = np.stack([-dx, dy, np.ones_like(height)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    normal = np.clip(np.rint((normals * .5 + .5) * 255), 0, 255).astype(np.uint8)
    return {'basecolor': base, 'normal': normal, 'roughness': rough}


def generate_surface_maps():
    """Generate original map assets and return portable, auditable map metadata."""
    report = {'version': VERSION, 'resolution': RESOLUTION, 'surfaces': {}, 'total_png_bytes': 0}
    for surface, spec in SPECS.items():
        maps = {}
        for role, pixels in surface_pixels(surface).items():
            path = ASSETS / f'original-workshop-{surface}-{role}.png'
            byte_count = _write_png(path, pixels)
            report['total_png_bytes'] += byte_count
            maps[role] = {
                'file': path.relative_to(ROOT).as_posix(),
                'bytes': byte_count,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'mean_rgb': pixels.mean(axis=(0, 1)).round(5).tolist(),
            }
        report['surfaces'][surface] = {**spec, 'uv_scale': 2 / spec['tile_metres'], 'maps': maps}
    return report


def _load_packed_map(bpy, surface, role):
    """Load one authored map, label its colour space and pack it into the source."""
    name = f'original-workshop-{surface}-{role}'
    image = bpy.data.images.get(name)
    path = ASSETS / f'{name}.png'
    if image is None:
        image = bpy.data.images.load(str(path), check_existing=False)
        image.name = name
    else:
        image.filepath = str(path)
        image.reload()
    image.colorspace_settings.name = 'sRGB' if role == 'basecolor' else 'Non-Color'
    image.pack()
    image['original_authoring_source'] = 'scripts/garage_surface_finish.py'
    image['workshop_surface_finish_version'] = VERSION
    return image


def _prune_retired_images(bpy):
    """Remove obsolete concrete payloads only when no shader or other ID uses them."""
    retired = {'original-concrete-grain', 'original-concrete-roughness', 'original-wall-fine-mineral'}
    removed = []
    for image in list(bpy.data.images):
        if image.name.split('.')[0] in retired and image.users - int(image.use_fake_user) == 0:
            removed.append(image.name)
            bpy.data.images.remove(image)
    return removed


def apply_workshop_surface_finish(root_object):
    """Replace only the named wall/floor shader graphs with standard glTF PBR.

    Existing geometry, material assignments, UVs, mural, equipment, cameras and
    lights are untouched. Explicit UV Mapping nodes export KHR_texture_transform;
    Blender's Normal Map node exports a real glTF normalTexture. No noise shader,
    displacement, runtime overlay, shared-material mutation or fake lighting is
    needed. The caller remains responsible for its normal portable source save.
    """
    import bpy

    targets = {}
    for surface, spec in SPECS.items():
        material = bpy.data.materials.get(spec['material'])
        if material is None:
            raise RuntimeError('Missing architectural surface material: ' + spec['material'])
        targets[surface] = material
    report = generate_surface_maps()
    for surface, material in targets.items():
        spec = SPECS[surface]
        material.use_nodes = True
        tree = material.node_tree
        tree.nodes.clear()
        output = tree.nodes.new('ShaderNodeOutputMaterial')
        output.location = (660, 60)
        shader = tree.nodes.new('ShaderNodeBsdfPrincipled')
        shader.location = (350, 60)
        shader.inputs['Base Color'].default_value = (1, 1, 1, 1)
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = spec['roughness']
        tree.links.new(shader.outputs['BSDF'], output.inputs['Surface'])
        coord = tree.nodes.new('ShaderNodeTexCoord')
        coord.location = (-900, 70)
        mapping = tree.nodes.new('ShaderNodeMapping')
        mapping.name = 'Physically scaled original workshop aggregate'
        mapping.location = (-700, 70)
        mapping.vector_type = 'POINT'
        scale = 2 / spec['tile_metres']
        mapping.inputs['Scale'].default_value = (scale, scale, 1)
        tree.links.new(coord.outputs['UV'], mapping.inputs['Vector'])
        texture_nodes = {}
        for index, role in enumerate(['basecolor', 'roughness', 'normal']):
            image = _load_packed_map(bpy, surface, role)
            node = tree.nodes.new('ShaderNodeTexImage')
            node.name = f'Original workshop {surface} {role}'
            node.label = f'{surface.title()} {role}: {spec["tile_metres"]} m tile'
            node.location = (-420, 320 - 290 * index)
            node.image = image
            node.interpolation = 'Linear'
            node.extension = 'REPEAT'
            tree.links.new(mapping.outputs['Vector'], node.inputs['Vector'])
            texture_nodes[role] = node
        tree.links.new(texture_nodes['basecolor'].outputs['Color'], shader.inputs['Base Color'])
        tree.links.new(texture_nodes['roughness'].outputs['Color'], shader.inputs['Roughness'])
        normal = tree.nodes.new('ShaderNodeNormalMap')
        normal.name = 'Physical mineral microrelief'
        normal.location = (70, -250)
        normal.space = 'TANGENT'
        normal.inputs['Strength'].default_value = 1.0
        tree.links.new(texture_nodes['normal'].outputs['Color'], normal.inputs['Color'])
        tree.links.new(normal.outputs['Normal'], shader.inputs['Normal'])
        material['workshop_surface_finish_version'] = VERSION
        material['surface'] = spec['description']
        material['texture_tile_metres'] = spec['tile_metres']
        material['texture_resolution'] = RESOLUTION
        material['original_authoring_source'] = 'scripts/garage_surface_finish.py'
        material['physical_relief_unit'] = 'metres; baked tangent-space OpenGL normal map'
        if 'wall_finish_version' in material:
            del material['wall_finish_version']
    root_object['workshop_surface_finish_version'] = VERSION
    root_object['workshop_surface_maps_png_bytes'] = report['total_png_bytes']
    if 'wall_finish_version' in root_object:
        del root_object['wall_finish_version']
    report['retired_unused_images_removed'] = _prune_retired_images(bpy)
    return report


if __name__ == '__main__':
    print(json.dumps(generate_surface_maps(), indent=2))
