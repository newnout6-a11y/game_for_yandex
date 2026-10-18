"""Pack source resources and save portable Blender files without exporting or rendering.

Run: blender -b --python-exit-code 1 --python scripts/sanitize_blend_sources.py -- [files ...]
The default scope is the twelve garage/cosmetic sources, never the base Roadster.
Reports go to output/recovery/blend-portability-audit.json. No backup .blend1 files.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_PATH = re.compile(r'/(?:workspace/(?:scratch|shared)|home/agent|Users/)[^\s\x00"\'<>]*')


def ids():
    """Yield every top-level Blender datablock, including unused palettes."""
    for prop in bpy.data.bl_rna.properties:
        if prop.type == 'COLLECTION':
            for item in getattr(bpy.data, prop.identifier):
                if isinstance(item, bpy.types.ID):
                    yield item


def path_fields():
    """Inspect stored path holders without touching context-only RNA pointers.

    Blender 4.3 exposes some non-dereferenceable background-mode editor pointers;
    explicit data owners avoid invoking those UI callbacks during a batch audit.
    """
    owners = [(item, item.bl_rna.identifier + ':' + item.name) for item in ids()]
    for image in bpy.data.images:
        owners += [(packed, 'Image:' + image.name + '.packed_files') for packed in image.packed_files]
    for scene in bpy.data.scenes:
        owners.append((scene.render, 'Scene:' + scene.name + '.render'))
        if scene.sequence_editor:
            owners += [(strip, 'Scene:' + scene.name + '.sequence') for strip in scene.sequence_editor.sequences_all]
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                owners.append((space, 'Screen:' + screen.name + '.' + space.type))
                if space.type == 'FILE_BROWSER' and space.params:
                    owners.append((space.params, 'Screen:' + screen.name + '.file_browser'))
    trees = list(bpy.data.node_groups)
    for item in list(bpy.data.materials) + list(bpy.data.worlds) + list(bpy.data.scenes):
        if item.node_tree:
            trees.append(item.node_tree)
    for tree in trees:
        owners += [(node, 'NodeTree:' + tree.name + '.' + node.name) for node in tree.nodes]
    for ob in bpy.data.objects:
        owners += [(modifier, 'Object:' + ob.name + '.' + modifier.name) for modifier in ob.modifiers]
    visited = set()
    for value, label in owners:
        key = value.as_pointer()
        if not key or key in visited:
            continue
        visited.add(key)
        for prop in value.bl_rna.properties:
            if prop.type == 'STRING' and (prop.subtype in {'FILE_PATH', 'DIR_PATH', 'FILE_NAME'} or prop.identifier in {'filepath', 'directory'}):
                yield value, prop, label + '.' + prop.identifier, getattr(value, prop.identifier)


def relative_path(value, destination, directory=False):
    """Convert stored paths relative to the destination, retaining asset basenames."""
    raw = os.fsdecode(value)
    if not raw or raw.startswith('//') or not os.path.isabs(raw):
        return value
    if raw in {'/tmp', '/tmp/'}:
        out = '//renders/'
    elif raw in {'/home/agent', '/home/agent/'}:
        out = '//'
    else:
        out = '//' + os.path.relpath(raw, Path(destination).parent).replace(os.sep, '/')
        if directory and raw.endswith('/'):
            out += '/'
    return os.fsencode(out) if isinstance(value, bytes) else out


def portable_metadata(value):
    """Keep useful source names/provenance, removing only machine-specific prefixes."""
    if isinstance(value, str):
        prefix = str(ROOT) + '/'
        value = value.replace(prefix, '')
        return PRIVATE_PATH.sub(lambda m: Path(m.group()).name, value)
    if hasattr(value, 'keys'):
        for key in list(value.keys()):
            old = value[key]
            new = portable_metadata(old)
            if isinstance(old, str) and new != old:
                value[key] = new
    elif isinstance(value, (list, tuple)):
        return [portable_metadata(item) for item in value]
    return value


def make_portable(destination):
    """Pack missing images and normalize source paths without changing artwork."""
    destination = Path(destination).resolve()
    bpy.context.preferences.filepaths.save_version = 0
    # Preserve unused authored palettes/datablocks that a normal save may purge.
    for item in ids():
        if item.users == 0 and not item.library and not item.is_embedded_data:
            item.use_fake_user = True
    # Existing packed bytes are retained; only missing image payloads are packed.
    for image in bpy.data.images:
        if image.source in {'FILE', 'GENERATED'} and not image.packed_files:
            image.pack()
    changes = []
    for owner, prop, label, old in list(path_fields()):
        new = relative_path(old, destination, prop.subtype == 'DIR_PATH')
        if new != old:
            if prop.is_readonly:
                raise RuntimeError('Read-only absolute resource path: ' + label)
            setattr(owner, prop.identifier, new)
            changes.append(label)
    for item in ids():
        portable_metadata(item)
    for block in bpy.data.texts:
        old = block.as_string()
        new = portable_metadata(old)
        if new != old:
            block.clear()
            block.write(new)
    return changes


def save_portable(destination):
    """Save a portable source without backup files or geometry/export operations."""
    changes = make_portable(destination)
    # Relative paths above are already relative to destination, not the last file.
    bpy.ops.wm.save_as_mainfile(filepath=str(destination), relative_remap=False)
    return changes


def scalars(value):
    """Record authored scalar values, excluding paths and transient ID bookkeeping."""
    result = {}
    for p in value.bl_rna.properties:
        if p.identifier in {'rna_type', 'session_uid', 'is_updated', 'is_updated_data', 'is_updated_transform', 'users', 'use_fake_user'} or p.type not in {'BOOLEAN', 'INT', 'FLOAT', 'ENUM', 'STRING'}:
            continue
        if p.type == 'STRING' and p.subtype in {'FILE_PATH', 'DIR_PATH', 'FILE_NAME'}:
            continue
        try:
            v = getattr(value, p.identifier)
            if getattr(p, 'is_array', False): v = list(v)
            if isinstance(v, set): v = sorted(v)
            result[p.identifier] = v
        except (AttributeError, TypeError, ValueError):
            pass
    return result


def fingerprint():
    """Non-rendering exact mesh, material/node, transform, rig and packed-byte audit."""
    state = {'meshes': [], 'objects': [], 'materials': [], 'armatures': [], 'images': [], 'settings': []}
    vertices = faces = triangles = 0
    for mesh in bpy.data.meshes:
        h = hashlib.sha256()
        for collection, prop, width, dtype in [(mesh.vertices,'co',3,np.float32),
                (mesh.edges,'vertices',2,np.int32),(mesh.loops,'vertex_index',1,np.int32),
                (mesh.polygons,'loop_start',1,np.int32),(mesh.polygons,'loop_total',1,np.int32),
                (mesh.polygons,'material_index',1,np.int32),(mesh.polygons,'use_smooth',1,np.bool_)]:
            array = np.empty(len(collection)*width, dtype=dtype)
            collection.foreach_get(prop, array)
            h.update(array.tobytes())
        for uv in mesh.uv_layers:
            array=np.empty(len(uv.data)*2,dtype=np.float32)
            uv.data.foreach_get('uv',array);h.update(uv.name.encode());h.update(array.tobytes())
        state['meshes'].append([mesh.name,h.hexdigest(),[m.name if m else None for m in mesh.materials]])
        vertices += len(mesh.vertices); faces += len(mesh.polygons)
        triangles += sum(len(p.vertices)-2 for p in mesh.polygons)
    for ob in bpy.data.objects:
        state['objects'].append([ob.name,ob.type,ob.data.name if ob.data else None,
            ob.parent.name if ob.parent else None,[list(row) for row in ob.matrix_local],
            [scalars(m) for m in ob.modifiers],[scalars(c) for c in ob.constraints]])
    for mat in bpy.data.materials:
        tree = mat.node_tree
        nodes=[]
        if tree:
            for node in tree.nodes:
                nodes.append([scalars(node), node.image.name if hasattr(node,'image') and node.image else None,
                    [scalars(socket) for socket in node.inputs], [scalars(socket) for socket in node.outputs]])
        links=sorted([l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier] for l in tree.links) if tree else []
        state['materials'].append([mat.name,scalars(mat),nodes,links])
    for arm in bpy.data.armatures:
        state['armatures'].append([arm.name,[[b.name,b.parent.name if b.parent else None,
            list(b.head_local),list(b.tail_local),[list(row) for row in b.matrix_local]] for b in arm.bones]])
    for image in bpy.data.images:
        state['images'].append([image.name,list(image.size),image.colorspace_settings.name,
            [hashlib.sha256(p.packed_file.data).hexdigest() for p in image.packed_files]])
    for scene in bpy.data.scenes:
        state['settings'].append([scene.name,scalars(scene.render),scalars(scene.cycles),scalars(scene.view_settings)])
    result={key:hashlib.sha256(json.dumps(value,sort_keys=True,default=str).encode()).hexdigest() for key,value in state.items()}
    result['statistics']={'objects':len(bpy.data.objects),'meshes':len(bpy.data.meshes),'vertices':vertices,'faces':faces,'triangles':triangles,'materials':len(bpy.data.materials),'armatures':len(bpy.data.armatures),'actions':len(bpy.data.actions)}
    return result


def verify_paths(path):
    """Reject absolute RNA paths, unpacked images and private path bytes on disk."""
    entries=[]
    for owner,prop,label,value in path_fields():
        if value:
            raw=os.fsdecode(value)
            assert not (os.path.isabs(raw) and not raw.startswith('//')), (label,raw)
            entries.append({'field':label,'path':raw})
    for image in bpy.data.images:
        if image.source in {'FILE','GENERATED'}:
            assert image.packed_files, 'Image is not packed: '+image.name
    data=path.read_bytes()
    assert not PRIVATE_PATH.search(data.decode('latin1')), 'Machine-specific path remains in binary'
    assert b'/tmp/' not in data, 'Default absolute render path remains in binary'
    return entries


def main():
    """Sanitize the bounded source scope, reopen it and write preservation evidence."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files',nargs='*')
    parser.add_argument('--report',default='output/recovery/blend-portability-audit.json')
    opts=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    files=[ROOT/f for f in opts.files] if opts.files else sorted([*ROOT.glob('art/garage/tier[1-4].blend'),*ROOT.glob('art/cosmetics/steering-*.blend'),*ROOT.glob('art/garage-cosmetics/*.blend')])
    glbs={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('public/assets/**/*.glb')}
    reports=[]
    for path in files:
        bpy.ops.wm.open_mainfile(filepath=str(path))
        before=fingerprint()
        changes=save_portable(path)
        bpy.ops.wm.open_mainfile(filepath=str(path))
        after=fingerprint()
        assert before == after, 'Asset fingerprint changed: '+str(path)+str({k:(before[k],after[k]) for k in before if before[k]!=after[k]})
        entries=verify_paths(path)
        reports.append({'file':str(path.relative_to(ROOT)),'changedPathFields':changes,'verifiedPaths':entries,'fingerprint':after,'unchangedGeometryMaterialsRigImagesAndRenderSettings':True})
        print('PORTABLE_SOURCE '+str(path.relative_to(ROOT)),flush=True)
    assert glbs=={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('public/assets/**/*.glb')}, 'A runtime GLB changed'
    report={'sources':reports,'runtimeGlbHashesUnchanged':glbs,'verification':'Saved and reopened through Blender; exact fingerprints before/after; binary and RNA path inspection. No rendering or exports.'}
    destination=ROOT/opts.report;destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(report,indent=2)+'\n')
    print('PORTABILITY_VERIFIED '+str(len(files))+' sources; '+str(len(glbs))+' GLBs unchanged',flush=True)


if __name__=='__main__':
    main()
