"""Read-only exact preservation audit for the bounded stable-orbit placement.
Run Blender with --baseline-dir containing the prior tierN.blend / tierN.glb.
No asset is written. The resulting proof chains the accepted mural checkpoint to
current portable sources and directly inspects every runtime accessor and image.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import bpy
import numpy as np
from mathutils import Vector, kdtree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from sanitize_blend_sources import fingerprint, verify_paths
sys.path.insert(0, str(Path(__file__).resolve().parent))
from normal_validation import (assert_normal_preserved, validate_exported_normals,
    NORMAL_COMPONENT_TOLERANCE, NORMAL_ANGLE_TOLERANCE_DEGREES, NORMAL_UNIT_LENGTH_TOLERANCE)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline-dir', type=Path, required=True)
opts = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
manifest = json.loads((ROOT / 'art/garage/stable-orbit-placement.json').read_text())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    if hasattr(value, 'to_dict'):
        value = value.to_dict()
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [canonical(v) for v in value]
    if hasattr(value, 'to_list'):
        return value.to_list()
    return value


def game(point):
    return [point.x, point.z, -point.y]


def source_snapshot(tier):
    bpy.context.view_layer.update()
    fp = fingerprint()
    objects = {}
    for ob in bpy.context.scene.objects:
        extras = canonical(dict(ob.items()))
        if ob.name == f'GARAGE_TIER_0{tier}':
            extras.pop('garageCamera', None)
        topology=hashlib.sha256()
        if ob.type=='MESH':
            for collection,prop,width,dtype in [(ob.data.edges,'vertices',2,np.int32),(ob.data.loops,'vertex_index',1,np.int32),(ob.data.polygons,'loop_total',1,np.int32),(ob.data.polygons,'material_index',1,np.int32),(ob.data.polygons,'use_smooth',1,np.bool_)]:
                values=np.empty(len(collection)*width,dtype=dtype);collection.foreach_get(prop,values);topology.update(values.tobytes())
            for uv in ob.data.uv_layers:
                values=np.empty(len(uv.data)*2,dtype=np.float32);uv.data.foreach_get('uv',values);topology.update(uv.name.encode());topology.update(values.tobytes())
        objects[ob.name] = {
            'topology_uvs_and_material_slots_sha256':topology.hexdigest(), 'type': ob.type, 'data': ob.data.name if ob.data else None,
            'matrix': np.asarray(ob.matrix_world).tolist(), 'extras': extras,
            'points': np.asarray([game(ob.matrix_world @ p.co) for p in ob.data.vertices]) if ob.type == 'MESH' else None,
            'materials': [m.name for m in ob.data.materials] if ob.type == 'MESH' else [],
        }
    root = bpy.data.objects[f'GARAGE_TIER_0{tier}']
    return fp, objects, canonical(root['garageCamera']), canonical(root['garageScreen']), canonical(root['garageMural'])


def read_glb(path):
    raw = path.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+length]); binary = raw[28+length:]
    def accessor(index):
        spec = doc['accessors'][index]; view = doc['bufferViews'][spec['bufferView']]
        dtype = {5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[spec['componentType']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[spec['type']]
        size = np.dtype(dtype).itemsize
        data = np.ndarray((spec['count'], width), dtype=dtype, buffer=binary,
            offset=view.get('byteOffset', 0)+spec.get('byteOffset', 0),
            strides=(view.get('byteStride', size*width), size)).copy()
        return data
    def view_bytes(index):
        view = doc['bufferViews'][index]
        return binary[view.get('byteOffset', 0):view.get('byteOffset', 0)+view['byteLength']]
    return raw, doc, accessor, view_bytes


def node_matrix(node):
    if 'matrix' in node:
        return np.asarray(node['matrix']).reshape(4, 4).T
    x,y,z,w = node.get('rotation', [0,0,0,1])
    r = np.asarray([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
        [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
        [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    matrix = np.eye(4); matrix[:3,:3] = r @ np.diag(node.get('scale',[1,1,1])); matrix[:3,3] = node.get('translation',[0,0,0])
    return matrix


historical = json.loads((ROOT / 'art/garage/mural-placement-audit.json').read_text())
rows = []
for tier in [1,2,3,4]:
    moves = manifest['tiers'].get(str(tier), [])
    named = {name: np.asarray(move['translation_game_m']) for move in moves for name in move['objects']}
    widen = {name:move.get('widen_game_x_m',0) for move in moves for name in move['objects']}
    source = ROOT / f'art/garage/tier{tier}.blend'; glb = ROOT / f'public/assets/garage/tier{tier}.glb'
    before_source = opts.baseline_dir / source.name; before_glb = opts.baseline_dir / glb.name
    checkpoint = next(row for row in historical['sources'] if row['tier'] == tier)
    assert sha(before_source.read_bytes()) == checkpoint['source_sha256'], 'Baseline must be exact accepted source checkpoint'
    assert sha(before_glb.read_bytes()) == checkpoint['glb_sha256'], 'Baseline must be exact accepted runtime checkpoint'
    bpy.ops.wm.open_mainfile(filepath=str(before_source))
    before_fp, before_objects, before_camera, before_screen, before_mural = source_snapshot(tier)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    after_fp, after_objects, after_camera, after_screen, after_mural = source_snapshot(tier)
    verify_paths(source)
    assert before_objects.keys() == after_objects.keys(), 'No props added or hidden by deletion'
    for key in ['materials','images','settings','armatures','statistics']:
        assert before_fp[key] == after_fp[key], ('Changed source payload', tier, key)
    if not any(widen.values()):assert before_fp['meshes']==after_fp['meshes']
    assert before_screen == after_screen and before_mural == after_mural
    transformed = []
    source_points = {}
    for name, before in before_objects.items():
        after = after_objects[name]
        assert {k:v for k,v in before.items() if k not in {'matrix','points'}} == {k:v for k,v in after.items() if k not in {'matrix','points'}}, ('Object identity/extras changed', name)
        if name not in named:
            assert before['matrix'] == after['matrix'], ('Unrelated transform changed', name)
            if before['points'] is not None:
                assert np.array_equal(before['points'], after['points']), ('Unrelated world geometry changed', name)
            continue
        delta = named[name]; expected = np.asarray(before['matrix']); expected[:3,3] += [delta[0], -delta[2], delta[1]]
        assert np.allclose(expected, after['matrix'], atol=1e-6, rtol=0), ('Unexpected assembly transform', name)
        expected_points=before['points']+delta
        if widen[name]:expected_points[:,0]+=np.sign(before['points'][:,0])*widen[name]/2
        assert np.allclose(expected_points, after['points'], atol=2e-6, rtol=0), ('Unexpected source vertex transformation', name)
        for mat in before['materials']:
            source_points.setdefault(mat, []).append((before['points'],expected_points))
        transformed.append({'name':name, 'translation_game_m':delta.tolist(),'widen_game_x_m':widen[name],
            'before_bounds_m':{'min':before['points'].min(axis=0).tolist(),'max':before['points'].max(axis=0).tolist()},
            'after_bounds_m':{'min':after['points'].min(axis=0).tolist(),'max':after['points'].max(axis=0).tolist()},
            'vertices':len(before['points'])})
    assert set(named) <= before_objects.keys()
    # Collision metadata must follow precisely the genuine moved objects.
    a = {box['name']: box for box in before_camera['obstacles']}; b = {box['name']: box for box in after_camera['obstacles']}
    assert a.keys() == b.keys(), 'No collisions hidden or invented'
    for name, box in a.items():
        expected = dict(box)
        if name in named:
            expected = {**box, 'min':(np.asarray(box['min'])+named[name]-[widen[name]/2,0,0]).round(5).tolist(), 'max':(np.asarray(box['max'])+named[name]+[widen[name]/2,0,0]).round(5).tolist()}
        assert expected == b[name], ('Camera AABB does not match translated source', name)
    assert {k:v for k,v in before_camera.items() if k!='obstacles'} == {k:v for k,v in after_camera.items() if k!='obstacles'}
    old_raw, old_doc, old_accessor, old_view = read_glb(before_glb)
    new_raw, new_doc, new_accessor, new_view = read_glb(glb)
    assert old_doc['materials'] == new_doc['materials'], 'Runtime material definitions changed'
    assert old_doc['images'] == new_doc['images'], 'Runtime image descriptors changed'
    images=[]
    for old, new in zip(old_doc['images'], new_doc['images']):
        assert old_view(old['bufferView']) == new_view(new['bufferView']), 'Embedded image bytes changed'
        images.append({'name':new['name'], 'sha256':sha(new_view(new['bufferView']))})
    assert len(old_doc['meshes']) == len(new_doc['meshes'])
    assert len(old_doc['nodes']) == len(new_doc['nodes'])
    rebased_nodes=[]
    for old, new in zip(old_doc['nodes'], new_doc['nodes']):
        if old.get('translation')!=new.get('translation'):rebased_nodes.append(old['name'])
        old = dict(old); new = dict(new)
        for node in [old,new]:
            if 'extras' in node:
                node['extras'] = dict(node['extras']); node['extras'].pop('garageCamera', None)
        old.pop('translation',None);new.pop('translation',None)
        assert old == new, ('Runtime node changed beyond translation-only material rebasing/collision metadata', old.get('name'))
    # Compare actual GLB triangles directly with the exactly preserved/current
    # Blender source polygons. This is invariant to valid quad diagonals, vertex
    # deduplication and material-batch origins; arbitrary triangles spanning
    # unrelated parts cannot pass a common-source-polygon test.
    if not named:
        assert before_source.read_bytes()==source.read_bytes() and old_raw==new_raw, 'Unchanged tiers must remain byte identical'
        accessor_records=[];triangle_records=[];total_changed=0
        for mesh in new_doc['meshes']:
            for primitive_index,primitive in enumerate(mesh['primitives']):
                count=len(new_accessor(primitive['indices']))//3
                length_error=validate_exported_normals(new_accessor(primitive['attributes']['NORMAL']), (tier,mesh['name']))
                triangle_records.append({'mesh':mesh['name'],'triangles':count,'changed_triangle_corners':0,
                    'source_polygon_containment_verified':True,'proof_method':'Exact source and GLB bytes equal the audited checkpoint',
                    'source_position_max_error_m':0,'source_uv_max_error':0,'baseline_normal_max_component_error':0,'unrelated_normal_max_component_error':0,
                    'baseline_normal_max_angle_degrees':0,'unrelated_normal_max_angle_degrees':0,'raw_normal_max_unit_length_error':length_error})
                for semantic,index in {**primitive['attributes'],'indices':primitive['indices']}.items():
                    data=new_accessor(index)
                    accessor_records.append({'mesh':mesh['name'],'primitive':primitive_index,'semantic':semantic,'accessor':index,
                        'before_sha256':sha(data.tobytes()),'after_sha256':sha(data.tobytes()),'before_count':len(data),'count':len(data),
                        'local_payload_byte_identical':True})
    else:
        source_materials={}
        for ob in bpy.context.scene.objects:
            if ob.type!='MESH' or ob.parent!=bpy.data.objects[f'GARAGE_TIER_0{tier}']:continue
            positions=np.asarray([game(ob.matrix_world@vertex.co) for vertex in ob.data.vertices])
            for poly in ob.data.polygons:
                mat=ob.data.materials[poly.material_index].name
                group=source_materials.setdefault(mat,{'corners':[],'faces':[],'triangle_options':[]})
                face_id=len(group['faces']);corners=[]
                for loop_index in poly.loop_indices:
                    loop=ob.data.loops[loop_index];position=positions[loop.vertex_index]
                    uv=ob.data.uv_layers.active.data[loop_index].uv if ob.data.uv_layers.active else [0,0]
                    corner={'position':position,'uv':np.asarray([uv[0],1-uv[1]]),'face':face_id}
                    corners.append(corner);group['corners'].append(corner)
                group['faces'].append({'object':ob.name,'corners':corners,'expected_triangles':len(corners)-2,'count':0})
        for group in source_materials.values():
            tree=kdtree.KDTree(len(group['corners']))
            for index,corner in enumerate(group['corners']):tree.insert(corner['position'],index)
            tree.balance();group['tree']=tree
        accessor_records=[];triangle_records=[];total_changed=0
        for mesh_index,(old_mesh,new_mesh) in enumerate(zip(old_doc['meshes'],new_doc['meshes'])):
            assert old_mesh['name']==new_mesh['name']
            new_node=next(n for n in new_doc['nodes'] if n.get('mesh')==mesh_index)
            for primitive_index,(old_p,new_p) in enumerate(zip(old_mesh['primitives'],new_mesh['primitives'])):
                assert old_p==new_p, ('Primitive material/semantic assignment changed',old_mesh['name'])
                material=new_doc['materials'][new_p['material']]['name'];group=source_materials[material]
                index=new_accessor(new_p['indices']).ravel();old_index=old_accessor(old_p['indices']).ravel()
                assert len(index)==len(old_index), 'Drawn triangle count changed'
                local=new_accessor(new_p['attributes']['POSITION'])
                world=(node_matrix(new_node)@np.c_[local,np.ones(len(local))].T).T[:,:3]
                raw_normal=new_accessor(new_p['attributes']['NORMAL'])
                length_error=validate_exported_normals(raw_normal, (tier,new_mesh['name'],'current'))
                normal=raw_normal@node_matrix(new_node)[:3,:3].T
                normal/=np.linalg.norm(normal,axis=1)[:,None]
                uv=new_accessor(new_p['attributes']['TEXCOORD_0'])
                old_node=next(n for n in old_doc['nodes'] if n.get('mesh')==mesh_index)
                old_local=old_accessor(old_p['attributes']['POSITION'])
                old_world=(node_matrix(old_node)@np.c_[old_local,np.ones(len(old_local))].T).T[:,:3]
                old_raw_normal=old_accessor(old_p['attributes']['NORMAL'])
                length_error=max(length_error,validate_exported_normals(old_raw_normal, (tier,new_mesh['name'],'baseline')))
                old_normal=old_raw_normal@node_matrix(old_node)[:3,:3].T
                old_normal/=np.linalg.norm(old_normal,axis=1)[:,None]
                old_uv=old_accessor(old_p['attributes']['TEXCOORD_0'])
                old_is_transformed=np.zeros(len(old_world),dtype=bool)
                if material in source_points:
                    candidates=np.concatenate([pair[0] for pair in source_points[material]]);expected_points=np.concatenate([pair[1] for pair in source_points[material]])
                    target_tree=kdtree.KDTree(len(candidates))
                    for k,point in enumerate(candidates):target_tree.insert(point,k)
                    target_tree.balance()
                    for k,point in enumerate(old_world):
                        matches=target_tree.find_range(point,3e-5)
                        if matches:old_world[k]=expected_points[matches[0][1]];old_is_transformed[k]=True
                baseline_tree=kdtree.KDTree(len(old_world))
                for k,point in enumerate(old_world):baseline_tree.insert(point,k)
                baseline_tree.balance()
                vertex_faces=[];position_error=uv_error=baseline_normal_error=unrelated_normal_error=0
                baseline_normal_angle=unrelated_normal_angle=0
                for vertex,point in enumerate(world):
                    matches=group['tree'].find_range(point,3e-5);valid={}
                    for co,source_index,distance in matches:
                        corner=group['corners'][source_index]
                        uerror=float(np.max(np.abs(corner['uv']-uv[vertex])))
                        if uerror<=2e-5:
                            valid[corner['face']]=(distance,uerror)
                    assert valid, ('Runtime corner differs from source position/UV/normal',tier,new_mesh['name'],vertex,point,uv[vertex],normal[vertex],[(group['corners'][i]['uv'].tolist(),d) for co,i,d in matches[:4]])
                    equivalent=[k for co,k,d in baseline_tree.find_range(point,3e-5) if np.max(np.abs(old_uv[k]-uv[vertex]))<=2e-5]
                    assert equivalent, ('No baseline UV/vertex at the expected source position',tier,new_mesh['name'],point)
                    # An unrelated source face may not borrow the allowance of
                    # a coincident moved part. Enforce before accumulating proof.
                    allow_transformed=all(group['faces'][face]['object'] in named for face in valid)
                    candidate,error,angle=assert_normal_preserved(normal[vertex],old_normal[equivalent],
                        old_is_transformed[equivalent],raw_normal[vertex],old_raw_normal[equivalent],
                        (tier,new_mesh['name'],vertex),allow_transformed=allow_transformed)
                    best=equivalent[candidate]
                    baseline_normal_error=max(baseline_normal_error,error)
                    baseline_normal_angle=max(baseline_normal_angle,angle)
                    if not old_is_transformed[best] or not allow_transformed:
                        unrelated_normal_error=max(unrelated_normal_error,error)
                        unrelated_normal_angle=max(unrelated_normal_angle,angle)
                    vertex_faces.append(valid)
                changed_corners=0
                for tri in index.reshape(-1,3):
                    common=set(vertex_faces[int(tri[0])])&set(vertex_faces[int(tri[1])])&set(vertex_faces[int(tri[2])])
                    assert common, ('Runtime triangle spans different source polygons',tier,new_mesh['name'],tri)
                    group['triangle_options'].append(sorted(common))
                    face=min(common)
                    if group['faces'][face]['object'] in named:changed_corners+=3
                    for vertex in tri:
                        distance,uerror=vertex_faces[int(vertex)][face]
                        position_error=max(position_error,distance);uv_error=max(uv_error,uerror)
                total_changed+=changed_corners
                triangle_records.append({'mesh':new_mesh['name'],'triangles':len(index)//3,'changed_triangle_corners':changed_corners,
                    'source_polygon_containment_verified':True,'source_position_max_error_m':position_error,
                    'source_uv_max_error':uv_error,'baseline_normal_max_component_error':baseline_normal_error,'unrelated_normal_max_component_error':unrelated_normal_error,
                    'baseline_normal_max_angle_degrees':baseline_normal_angle,'unrelated_normal_max_angle_degrees':unrelated_normal_angle,'raw_normal_max_unit_length_error':length_error})
                for semantic,accessor_index in {**new_p['attributes'],'indices':new_p['indices']}.items():
                    old=old_accessor(accessor_index);new=new_accessor(accessor_index)
                    accessor_records.append({'mesh':new_mesh['name'],'primitive':primitive_index,'semantic':semantic,'accessor':accessor_index,
                        'before_sha256':sha(old.tobytes()),'after_sha256':sha(new.tobytes()),'before_count':len(old),'count':len(new),
                        'local_payload_byte_identical':np.array_equal(old,new)})
        # Resolve coincident polygons globally instead of greedily attributing
        # the first matching face. Every real source polygon must receive exactly
        # its n-2 triangles, including unrelated parts. This capacity matching
        # detects an omitted face compensated by duplicating a different face.
        for mat,group in source_materials.items():
            fixed=[0]*len(group['faces']);options={}
            for tri,faces in enumerate(group['triangle_options']):
                if len(faces)==1:fixed[faces[0]]+=1
                else:options[tri]=faces
            remaining=[face['expected_triangles']-fixed[i] for i,face in enumerate(group['faces'])]
            assert min(remaining,default=0)>=0, ('Unambiguous source polygon duplicated',tier,mat)
            members=[[] for face in group['faces']]
            def assign(tri,seen):
                for face in options[tri]:
                    if face in seen:continue
                    seen.add(face)
                    if len(members[face])<remaining[face]:members[face].append(tri);return True
                    for previous in list(members[face]):
                        if assign(previous,seen):members[face].remove(previous);members[face].append(tri);return True
                return False
            for tri in sorted(options,key=lambda tri:len(options[tri])):
                assert assign(tri,set()), ('No complete source-face multiplicity assignment',tier,mat,tri)
            for i,face in enumerate(group['faces']):
                assert fixed[i]+len(members[i])==face['expected_triangles'], ('Source polygon missing in runtime',tier,mat,face['object'])
    assert bool(total_changed) == bool(named)
    # Current source ray evidence, independent of runtime loader and old visibility counts.
    mural=next(ob for ob in bpy.context.scene.objects if ob.get('original_garage_mural')); deps=bpy.context.evaluated_depsgraph_get(); views=[]
    for old_view_row in checkpoint['visibility']:
        eye=Vector((old_view_row['eye'][0],-old_view_row['eye'][2],old_view_row['eye'][1])); clear=0
        for sample in old_view_row['rays']:
            u,v=sample['uv']; target=Vector((9.878,-(1+u*6),1.5+v*3)); direction=target-eye
            hit,location,normal,index,ob,matrix=bpy.context.scene.ray_cast(deps,eye,direction.normalized(),distance=direction.length+.005)
            clear += bool(hit and ob == mural)
        views.append({'name':old_view_row['name'],'clear_rays':clear,'total_rays':old_view_row['total_rays']})
    print('CURRENT_MURAL_VISIBILITY',tier,json.dumps(views),flush=True)
    assert views[0]['clear_rays'] > 0, 'Current overview must retain visible original paint'
    rows.append({'tier':tier,'source':str(source.relative_to(ROOT)),'glb':str(glb.relative_to(ROOT)),
        'before_source_sha256':sha(before_source.read_bytes()),'source_sha256':sha(source.read_bytes()),
        'before_glb_sha256':sha(old_raw),'glb_sha256':sha(new_raw),'before_glb_bytes':len(old_raw),'glb_bytes':len(new_raw),
        'all_unrelated_source_meshes_uvs_materials_images_settings_unchanged':True,'all_unrelated_source_transforms_and_extras_unchanged':True,
        'all_runtime_materials_images_unchanged':True,'all_runtime_triangles_match_current_source_polygons_and_uvs':True,'all_source_polygon_multiplicities_verified':True,'runtime_normal_differences_measured_against_checkpoint':True,
        'runtime_shading_normal_constraints_enforced':True,'normal_component_tolerance':NORMAL_COMPONENT_TOLERANCE,
        'normal_angle_tolerance_degrees':NORMAL_ANGLE_TOLERANCE_DEGREES,'raw_normal_unit_length_tolerance':NORMAL_UNIT_LENGTH_TOLERANCE,
        'unrelated_runtime_normals_exact':True,'all_unrelated_runtime_world_positions_preserved':True,'world_position_tolerance_m':3e-5,'translation_rebased_material_nodes':rebased_nodes,
        'source_paths_portable_and_images_packed':True,'camera_boxes_match_actual_translated_objects':True,
        'unchanged_source_objects':len(before_objects)-len(named),'transformed_objects':transformed,
        'source_fingerprint_before':before_fp,'source_fingerprint_after':after_fp,
        'runtime_triangles':triangle_records,'runtime_accessors':accessor_records,'runtime_images':images,'runtime_materials':new_doc['materials'],'runtime_materials_sha256':sha(json.dumps(new_doc['materials'],sort_keys=True).encode()),
        'runtime_changed_triangle_corners':total_changed,'mural_visibility':views})
    print('STABLE_ORBIT_PRESERVATION_PASS',tier,len(named),total_changed,flush=True)
report={'version':1,'operation':manifest['operation'],'historical_checkpoint':'art/garage/mural-placement-audit.json',
    'scope':'Only approved complete lift/island transformations, one bridge width extension, and genuine collision bounds. No unrelated shell, shader, texture, light, TV, mural, toy or vehicle changes. Blender may rebase material-batch translations; world geometry is independently compared. Historical operation proofs retain original hashes.',
    'sources':rows}
(ROOT/'art/garage/stable-orbit-placement-audit.json').write_text(json.dumps(report,indent=2)+'\n')
