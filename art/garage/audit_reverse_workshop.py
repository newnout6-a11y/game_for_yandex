"""Verify new reverse-side workshop geometry against explicit Blender baselines.

Read-only: compare every pre-existing editable mesh, inspect each addition's
real vertices in exported game metres, and verify packed portable source paths.
Run: blender -b --python art/garage/audit_reverse_workshop.py -- --before PATH
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import bpy
import numpy as np
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from sanitize_blend_sources import fingerprint, verify_paths


def geometry(ob):
    """Hash topology, float32 vertices/UVs, transforms and material assignment."""
    h=hashlib.sha256()
    h.update(np.asarray(ob.matrix_local,dtype=np.float32).tobytes())
    h.update(np.asarray([v.co[:] for v in ob.data.vertices],dtype=np.float32).tobytes())
    for polygon in ob.data.polygons:h.update(np.asarray(polygon.vertices[:],dtype=np.int32).tobytes())
    for uv in ob.data.uv_layers:h.update(np.asarray([value.uv[:] for value in uv.data],dtype=np.float32).tobytes())
    h.update('|'.join(m.name for m in ob.data.materials).encode())
    return h.hexdigest()


def inspect(path,tier):
    """Inspect named original meshes and genuinely transformed new equipment."""
    bpy.ops.wm.open_mainfile(filepath=str(path));bpy.context.view_layer.update()
    root=bpy.data.objects[f'GARAGE_TIER_{tier:02d}']
    originals={};new=[]
    for ob in bpy.context.scene.objects:
        if ob.type!='MESH' or ob.parent!=root:continue
        if not ob.get('garage_reverse_workshop'):
            originals[ob.name]=geometry(ob);continue
        points=[ob.matrix_world@v.co for v in ob.data.vertices]
        a=np.asarray([(p.x,p.z,-p.y) for p in points]);lo=a.min(0);hi=a.max(0)
        assert np.isfinite(a).all(),ob.name
        floor=bool(hi[1]<.03)
        if not floor:
            assert lo[1]>=-.01 and hi[1]<=6.451,(ob.name,lo,hi)
            assert lo[0]>=-9.881 and hi[0]<=9.881 and lo[2]>=-8.971 and hi[2]<=7.571,ob.name
            assert hi[0]<-8.65 or lo[0]>8.65 or hi[2]<-7.95,(ob.name,lo,hi)
        new.append({'name':ob.name,'min':lo.round(5).tolist(),'max':hi.round(5).tolist(),'floor_seam':floor})
    return originals,new,root


p=argparse.ArgumentParser(description=__doc__);p.add_argument('--before',required=True)
p.add_argument('--poster-before',help='Optional complete TV source baseline before an image-only poster swap')
p.add_argument('--tiers',type=int,nargs='+',default=[1,2,3,4]);args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
rows=[]
for tier in args.tiers:
    poster_before=None;poster_camera=None
    tier_report=json.loads((ROOT/f'art/garage/tier{tier}-report.json').read_text())
    recorded_swap=tier_report.get('screen_poster_swap')
    if recorded_swap:
        poster_before=recorded_swap['preserved_fingerprint']
        poster_camera=json.dumps(tier_report['camera_interior'],sort_keys=True)
    if args.poster_before:
        bpy.ops.wm.open_mainfile(filepath=str(Path(args.poster_before)/f'art/garage/tier{tier}.blend'))
        poster_before=fingerprint()
        poster_camera=json.dumps(bpy.data.objects[f'GARAGE_TIER_{tier:02d}']['garageCamera'].to_dict(),sort_keys=True)
    rel=Path(f'art/garage/tier{tier}.blend');old,_,_=inspect(Path(args.before)/rel,tier)
    current,additions,root=inspect(ROOT/rel,tier)
    poster_proof=None
    if poster_before:
        after=fingerprint()
        for key in poster_before:
            if key!='images':assert poster_before[key]==after[key],('Saved/reopened poster-only change',tier,key)
        assert poster_camera==json.dumps(root['garageCamera'].to_dict(),sort_keys=True)
        poster_proof={'saved_and_reopened_all_geometry_shaders_settings_unchanged':True,'garage_camera_unchanged':True,
            'preserved_fingerprint':{key:value for key,value in after.items() if key!='images'}}
    assert old==current,{'tier':tier,'missing':list(set(old)-set(current)),'changed':[k for k in old if old[k]!=current.get(k)]}
    assert len(additions)>=150
    assert root['reverse_workshop_new_parts']==len(additions)
    assert bool(verify_paths(ROOT/rel))
    displays=[ob for ob in bpy.context.scene.objects if ob.get('garage_screen_surface')]
    assert len(displays)==1
    display=displays[0];display.data.calc_loop_triangles()
    assert len(display.data.polygons)==1 and len(display.data.vertices)==4
    assert len(display.data.materials)==1 and display.data.materials[0].name=='garage_screen_display'
    uv=[tuple(value.uv) for value in display.data.uv_layers[0].data]
    assert set(uv)=={(0.,0.),(1.,0.),(1.,1.),(0.,1.)}
    normal=display.matrix_world.to_3x3()@display.data.polygons[0].normal
    assert (normal-Vector((1,0,0))).length<1e-6
    points=[display.matrix_world@v.co for v in display.data.vertices]
    screen=np.asarray([(p.x,p.z,-p.y) for p in points]);span=screen.max(0)-screen.min(0)
    assert abs(span[2]/span[1]-16/9)<1e-6 and abs(span[2]-4.2)<1e-5
    assert span[0]<1e-6 and abs(screen[:,0].mean()+9.02)<1e-5
    screen_contract={'material':'garage_screen_display','independent_uv_plane':True,'room_facing_normal':[1,0,0],
      'blender_uv_corners':[list(v) for v in uv],'min':screen.min(0).round(5).tolist(),'max':screen.max(0).round(5).tolist(),
      'width_m':round(float(span[2]),5),'height_m':round(float(span[1]),5),'triangles':len(display.data.loop_triangles)}
    digest=hashlib.sha256(json.dumps(old,sort_keys=True).encode()).hexdigest()
    rows.append({'tier':tier,'source':rel.as_posix(),'preserved_original_parts':len(old),
      'all_original_geometry_sha256':digest,'original_geometry_unchanged':True,
      'new_editable_parts':len(additions),'relative_packed_paths_verified':True,
      'perimeter_clearance_verified':True,'poster_swap':poster_proof,'screen':screen_contract,'new_parts':sorted(additions,key=lambda x:x['name'])})
out=ROOT/'art/garage/reverse-workshop-source-audit.json'
out.write_text(json.dumps({'scope':'Every pre-existing source mesh, transform, topology, UV and material assignment remains unchanged. New functional equipment vertices stay at least 8.65 m to the sides or 7.95 m toward the front, outside all parking and eye-orbit envelopes. New flush floor seams are explicitly excluded from equipment envelopes. Materials and camera contract are intentionally updated and independently audited.','sources':rows},indent=2)+'\n')
print('REVERSE_WORKSHOP_SOURCE_PASS',len(rows),flush=True)
