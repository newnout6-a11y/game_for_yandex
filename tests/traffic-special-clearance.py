"""Exact GLB triangle regression for unsprung wheels against every opaque sprung vehicle surface.

Run: blender --background --threads 4 --python-exit-code 1 --python tests/traffic-special-clearance.py
No assets are changed. The test sweeps steering, spin, pitch and roll using
the same body pivot and XYZ/YXZ rotation composition as traffic.js.
"""
import bpy, json, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def verts_faces(o):
    me=o.data; me.calc_loop_triangles()
    vs=[]
    for v in me.vertices:
        p=o.matrix_world@v.co; vs.append(Vector((p.x,p.z,-p.y)))
    return vs,[tuple(t.vertices) for t in me.loop_triangles]
reports={}
for kind in ['towtruck','firetruck']:
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/public/assets/traffic/{kind}.glb')
    bpy.context.view_layer.update()
    cv=[]; cf=[]; labels=[]
    for obj in bpy.data.objects:
        if obj.type!='MESH' or not obj.parent or obj.parent.name.startswith('wheel_'): continue
        if any(material and 'glass' in material.name for material in obj.data.materials): continue
        vertices,faces=verts_faces(obj); offset=len(cv); cv.extend(vertices)
        cf.extend(tuple(offset+i for i in face) for face in faces)
        labels.extend([obj.name+'|'+obj.data.materials[0].name]*len(faces))
    wheel_centers=[(o.name,Vector((o.matrix_world.translation.x,o.matrix_world.translation.z,-o.matrix_world.translation.y))) for o in bpy.data.objects if o.type=='EMPTY' and o.name.startswith('wheel_')]
    front_z=min(v.z for _,v in wheel_centers); rear=[v.z for n,v in wheel_centers if n not in ['wheel_fl','wheel_fr']]
    center=Vector((0,.62,(front_z+sum(rear)/len(rear))/2))
    wheel_data={}
    for side in ['l','r']:
        wheel=bpy.data.objects[f'wheel_f{side}']; p=wheel.matrix_world.translation; wc=Vector((p.x,p.z,-p.y))
        for mesh in wheel.children:
            if mesh.type!='MESH':continue
            vs,fs=verts_faces(mesh); label=side+'_'+mesh.data.materials[0].name
            wheel_data[label]=(wc,vs,fs)
    wheel_bvhs={}
    for step in range(-8,9):
        for spin in [0,math.pi/28,math.pi/14]:
            a=step*.075; r=Matrix.Rotation(a,3,'Y')@Matrix.Rotation(spin,3,'X')
            wheel_bvhs[(step,spin)]={label:BVHTree.FromPolygons([wc+r@(v-wc) for v in vs],fs,all_triangles=True,epsilon=0) for label,(wc,vs,fs) in wheel_data.items()}
    overlaps=[]
    for pitch in [-.05,-.025,0,.025,.05]:
        for roll in [-.06,-.03,0,.03,.06]:
            r=Matrix.Rotation(pitch,3,'X')@Matrix.Rotation(roll,3,'Z')
            moved=[center+r@(v-center) for v in cv]; cb=BVHTree.FromPolygons(moved,cf,all_triangles=True,epsilon=0)
            for (step,spin),ws in wheel_bvhs.items():
                for label,wb in ws.items():
                    hits=cb.overlap(wb)
                    if hits:
                        sample=[tuple(round(c,4) for c in sum((moved[j] for j in cf[i]),Vector())/3) for i,_ in hits[:3]]
                        overlaps.append({'pitch':pitch,'roll':roll,'steer':round(step*.075,2),'spin':spin,'part':label,'pairs':len(hits),'samples':sample,'bodyParts':sorted(set(labels[i] for i,_ in hits))})
    reports[kind]={'poses':1275,'overlapCases':len(overlaps),'max':max(overlaps,key=lambda a:a['pairs']) if overlaps else None,'neutral':[a for a in overlaps if a['pitch']==0 and a['roll']==0],'examples':overlaps[:8]}
    print('SWEEP',kind,json.dumps(reports[kind]),flush=True)
assert all(v['overlapCases']==0 for v in reports.values()), 'Opaque sprung body, cabin or underbody crosses actual unsprung tire or steel-rim triangles'
print('PASS: 2,550 combined poses, both front tires and rims, zero opaque sprung-surface intersections')
