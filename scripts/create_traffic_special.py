"""Build the original Blender-authored tow truck and fire engine.

Run: blender --background --python scripts/create_traffic_special.py
The original parametric block-in is imported from traffic-special.js. Blender is
then the final modeling stage: manufactured bevels, normal refinement, editable
recovery equipment and ladder rails, PBR materials, studio inspection, and glTF.
No external assets or logos are used. Game convention is +Y up / -Z forward.
"""
import bpy, bmesh, json, math, os, subprocess, tempfile
from collections import defaultdict
from mathutils import Vector, Matrix, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'art', 'traffic')
PUBLIC = os.path.join(ROOT, 'public', 'assets', 'traffic')
PREVIEW = os.environ.get('TRAFFIC_SPECIAL_PREVIEW', os.path.join(ROOT, 'output', 'traffic-special-blender'))
for folder in [ART, PUBLIC, PREVIEW]: os.makedirs(folder, exist_ok=True)

BRIDGE = r"""
import fs from 'node:fs';
import { buildSpecialVehicle } from './src/traffic-special.js';
const target = process.argv[1], data = {};
for (const kind of ['towtruck', 'firetruck']) {
 const root = buildSpecialVehicle(kind); root.updateMatrixWorld(true);
 const meshes = [], wheels = root.children.filter(n => n.name.startsWith('wheel_'));
 root.traverse(n => {
   if (!n.isMesh) return;
   const g=n.geometry, m=n.material, wheel=wheels.find(w=>w.children.includes(n));
   meshes.push({ name:n.name, group:wheel?.name || null, position:wheel?.position.toArray() || [0,0,0],
     vertices:Array.from(g.attributes.position.array), normals:Array.from(g.attributes.normal.array),
     indices:g.index?Array.from(g.index.array):null,
     material:{key:m.color.getHexString(),materialName:m.name,name:n.name,color:m.color.toArray(),metalness:m.metalness,
       roughness:m.roughness,emissive:m.emissive.toArray(),emissiveIntensity:m.emissiveIntensity,
       coat:m.clearcoat||0,opacity:m.opacity,doubleSided:m.side===2}});
 });
 data[kind]={meshes,metadata:root.userData};
}
fs.writeFileSync(target,JSON.stringify(data));
"""
bridge_path = os.path.join(tempfile.gettempdir(), 'traffic-special-blockin.json')
subprocess.run(['node', '--input-type=module', '-e', BRIDGE, bridge_path], cwd=ROOT, check=True)
with open(bridge_path) as stream: SOURCE = json.load(stream)


def cv(point): return Vector((point[0], -point[2], point[1]))
def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections): bpy.data.collections.remove(collection)
    for mesh in list(bpy.data.meshes): bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials): bpy.data.materials.remove(material)


def empty(name, location=(0,0,0), parent=None, collection=None):
    obj=bpy.data.objects.new(name,None); (collection or bpy.context.scene.collection).objects.link(obj)
    obj.location=cv(location); obj.parent=parent; obj.empty_display_type='PLAIN_AXES'; obj.empty_display_size=.2
    return obj


def material(info):
    names={'8696a3':'body','922a22':'lights_red','b52423':'fixed_rescue_red','d99d28':'recovery_ochre',
      '6d7c83':'brushed_work_steel','a0a9ae':'bright_alloy','171d22':'dark_chassis',
      '121416':'tire_rubber','293f4d':'cab_glazing','93b2bc':'traffic_cab_glass','e6e8df':'rescue_white',
      'e99d27':'amber_work_lamp','2165ae':'blue_rescue_lamp','e8f5f1':'headlamp','d8dad5':'blank_plate'}
    name=info.get('materialName') if info.get('materialName') in ['indicator_left','indicator_right'] else names.get(info['key'],info['key']); old=bpy.data.materials.get(name)
    if old: return old
    m=bpy.data.materials.new(name); m.diffuse_color=(*info['color'],info.get('opacity',1)); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*info['color'],1)
    p.inputs['Alpha'].default_value=info.get('opacity',1)
    if info.get('opacity',1)<1:
        m.surface_render_method='DITHERED'; m.use_transparency_overlap=False
        p.inputs['Transmission Weight'].default_value=0
    p.inputs['Metallic'].default_value=info['metalness']; p.inputs['Roughness'].default_value=info['roughness']
    p.inputs['Coat Weight'].default_value=info['coat']
    p.inputs['Emission Color'].default_value=(*info['emissive'],1)
    p.inputs['Emission Strength'].default_value=info['emissiveIntensity']
    m.use_backface_culling=not info['doubleSided']
    return m


def components(info):
    """Find disconnected manufactured pieces, despite the flattened source normals."""
    vertices=info['vertices']; count=len(vertices)//3
    indices=info['indices'] or list(range(count))
    parents=list(range(count)); locations={}
    def find(a):
        while parents[a]!=a: parents[a]=parents[parents[a]]; a=parents[a]
        return a
    def union(a,b): parents[find(a)]=find(b)
    for i in range(count):
        key=tuple(round(vertices[i*3+j],5) for j in range(3))
        if key in locations: union(i,locations[key])
        else: locations[key]=i
    for i in range(0,len(indices),3): union(indices[i],indices[i+1]); union(indices[i],indices[i+2])
    pieces=defaultdict(list)
    for i in range(0,len(indices),3): pieces[find(indices[i])].append(indices[i:i+3])
    return list(pieces.values())


def piece_bounds(info, faces):
    p=info['vertices']; points=[p[i*3:i*3+3] for face in faces for i in face]
    low=[min(p[a] for p in points) for a in range(3)]; high=[max(p[a] for p in points) for a in range(3)]
    return [(low[a]+high[a])*.5 for a in range(3)], [high[a]-low[a] for a in range(3)]


def replaced_piece(kind, info, faces):
    """Replace the important equipment rails in Blender, not merely re-export them."""
    center,size=piece_bounds(info,faces); x,y,z=center
    if kind=='towtruck':
        if info['material']['key']=='d99d28' and abs(x)<.01 and abs(y-1.91)<.03 and abs(z-1.195)<.04: return True
        if info['material']['key']=='6d7c83' and abs(x)<.01 and abs(y-2.41)<.03 and abs(z-2.40)<.05: return True
    else:
        if info['material']['key']=='a0a9ae' and size[2]>4 and size[0]<.08 and y>2.98: return True
    return False


def import_mesh(kind, info, root, wheel_groups, collection):
    faces=[face for part in components(info) if not replaced_piece(kind,info,part) for face in part]
    raw=info['vertices']; original_normals=info['normals']
    indices=sorted({i for face in faces for i in face}); index={old:new for new,old in enumerate(indices)}
    verts=[cv(raw[i*3:i*3+3]) for i in indices]
    mesh=bpy.data.meshes.new(info['name']+'_editable'); mesh.from_pydata(verts,[],[[index[i] for i in face] for face in faces]); mesh.update()
    mesh.materials.append(material(info['material']))
    for polygon in mesh.polygons: polygon.use_smooth=True
    mesh.normals_split_custom_set([cv(original_normals[i*3:i*3+3]) for face in faces for i in face])
    obj=bpy.data.objects.new(info['name'],mesh); collection.objects.link(obj)
    if info['group']:
        if info['group'] not in wheel_groups:
            wheel_groups[info['group']]=empty(info['group'],info['position'],root,collection)
            wheel_groups[info['group']]['steering']=info['group'] in ['wheel_fl','wheel_fr']
        obj.parent=wheel_groups[info['group']]
    else: obj.parent=root
    obj['source_stage']='Original parametric block-in, refined in Blender'
    return obj


def beveled_box(name, center, size, material_name, collection, parent, bevel=.008):
    bpy.ops.mesh.primitive_cube_add(size=1, location=cv(center)); obj=bpy.context.object; obj.name=name
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj); obj.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(bpy.data.materials[material_name]); obj.parent=parent
    mod=obj.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=bevel; mod.segments=1; mod.affect='EDGES'
    normal=obj.modifiers.new('Weighted face normals','WEIGHTED_NORMAL'); normal.keep_sharp=True; normal.weight=40
    for poly in obj.data.polygons: poly.use_smooth=True
    obj['authored_in']='Blender'; return obj


def beveled_beam(name, start, end, width, depth, material_name, collection, parent):
    a,b=cv(start),cv(end); obj=beveled_box(name,(0,0,0),(width,(b-a).length,depth),material_name,collection,parent,.018)
    # beveled_box's game-Y length becomes Blender-Z.
    obj.location=(a+b)/2; obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler(); return obj


def refine(kind, root, collection):
    if kind=='towtruck':
        beveled_beam('Recovery main boom', [0,1.48,.23], [0,2.34,2.16], .40,.35,'recovery_ochre',collection,root)
        beveled_beam('Telescopic steel boom', [0,2.34,2.06], [0,2.48,2.74], .26,.23,'brushed_work_steel',collection,root)
        for side in [-1,1]:
            beveled_box('Boom pivot cheek plate', [side*.225,1.58,.37], [.035,.29,.32], 'recovery_ochre',collection,root,.015)
            beveled_box('Wheel-lift end stop', [side*.72,.76,3.43], [.12,.13,.19], 'recovery_ochre',collection,root,.012)
        anchors={'equipment_winch':[0,1.67,-.11],'equipment_boom':[0,1.48,.23],'equipment_wheel_lift':[0,.63,3.28]}
    else:
        for y,half,first,last in [(3.02,.47,-.85,3.86),(3.17,.36,-.56,3.62)]:
            for side in [-1,1]:
                beveled_box('Nested roof ladder rail',[.29+side*half,y,(first+last)/2],[.055,.10,last-first], 'bright_alloy',collection,root,.009)
        for z in [-.60,3.37]:
            beveled_box('Ladder retaining saddle',[.29,2.94,z],[1.03,.065,.10],'dark_chassis',collection,root,.008)
        for side in [-1,1]:
            # Non-branded raised diamond grips on the rear crew step.
            for z in [-2.03,-1.84,-1.65]:
                beveled_box('Crew step grip',[side*1.11,.668,z],[.15,.015,.065],'bright_alloy',collection,root,.004)
        anchors={'equipment_roof_ladder':[.29,3.02,1.50],'equipment_hose_reel':[.52,1,4.16], 'equipment_pump_panel':[-.27,1.04,4.17]}
    for name,position in anchors.items():
        anchor=empty(name,position,root,collection); anchor['purpose']='Future activity attachment point; no behavior is implemented'


def wheel_material(name, color, metalness, roughness):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name); mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metalness; p.inputs['Roughness'].default_value=roughness
    mat.diffuse_color=(*color,1); mat.use_backface_culling=True
    return mat


def wheel_mesh(name, vertices, faces, mat, wheel, collection, side=1, smooth=True):
    # Mirror geometry, not the wheel pivot: local X remains the rolling axle.
    mesh=bpy.data.meshes.new(name)
    points=[cv((side*p[0],p[1],p[2])) for p in vertices]
    mesh.from_pydata(points,[],[tuple(reversed(f)) if side<0 else f for f in faces]); mesh.update()
    mesh.materials.append(mat)
    for polygon in mesh.polygons: polygon.use_smooth=smooth
    obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj); obj.parent=wheel
    obj['authored_in']='Blender'; return obj


def revolved_wheel_part(name, profile, mat, wheel, collection, side, segments=32, center=(0,0,0), close=False, smooth=True):
    # Profile is (radius, axle X). Winding faces out of the revolved volume.
    vertices=[(x+center[0],r*math.cos(a*2*math.pi/segments)+center[1],r*math.sin(a*2*math.pi/segments)+center[2]) for r,x in profile for a in range(segments)]
    faces=[]; rings=len(profile)
    for j in range(rings if close else rings-1):
        jj=(j+1)%rings
        for a in range(segments):
            b=(a+1)%segments
            if profile[j][0]==0 and profile[jj][0]==0: continue
            if profile[j][0]==0: faces.append((j*segments+a,jj*segments+b,jj*segments+a))
            elif profile[jj][0]==0: faces.append((j*segments+a,j*segments+b,jj*segments+b))
            else: faces.append((j*segments+a,j*segments+b,jj*segments+b,jj*segments+a))
    return wheel_mesh(name,vertices,faces,mat,wheel,collection,side,smooth)


def authored_truck_wheels(kind, data, root, collection):
    """Commercial wheel surfaces authored in Blender, replacing the block-in entirely.

    A rounded two-groove carcass surrounds a recessed, actually perforated steel
    dish. Hub/lug parts rotate with the wheel; no stationary caliper is included.
    """
    tire_mat=wheel_material('tire_rubber',(.015,.018,.022),0,.82)
    metal=wheel_material('satin_wheel_steel',(.31,.36,.39),.78,.36)
    seen=set(); radius=data['metadata']['wheelRadius']
    for info in data['meshes']:
        name=info['group']
        if not name or name in seen: continue
        seen.add(name); side=-1 if name.endswith('l') else 1; front=name in ['wheel_fl','wheel_fr']
        width=(.28 if kind=='towtruck' else .30) if front else .31; half=width/2
        wheel=empty(name,info['position'],root,collection)
        wheel['steering']=front; wheel['wheelRadius']=radius; wheel['tireWidth']=width*1.05
        wheel['wheelDesign']='Rounded commercial tire, recessed vented steel dish, eight-lug hub'
        # Rounded sidewall and shoulder transitions, with two shallow tread grooves.
        profile=[(.635,-.83),(.73,-1.05),(.88,-1.02),(.97,-.80),(1,-.55),
          (1,-.30),(.985,-.195),(1,-.09),(1,.09),(.985,.195),
          (1,.30),(1,.55),(.97,.80),(.88,1.02),(.73,1.05),(.635,.83)]
        revolved_wheel_part('Rounded commercial tire',[(r*radius,x*half) for r,x in profile],tire_mat,wheel,collection,side,28,close=True)
        # The flange has real rolled thickness, separate from the dished center.
        lip=[(.635,.83),(.653,.87),(.651,.96),(.617,.96),(.602,.89)]
        revolved_wheel_part('Rolled steel rim flange',[(r*radius,x*half) for r,x in lip],metal,wheel,collection,side,32,close=True)
        radii=[.235,.34,.42,.53,.603]; depths=[.55,.48,.42,.69,.90]; count=32
        vertices=[(depths[j]*half,r*radius*math.cos(a*2*math.pi/count),r*radius*math.sin(a*2*math.pi/count)) for j,r in enumerate(radii) for a in range(count)]
        faces=[]
        for j in range(len(radii)-1):
            for a in range(count):
                # Eight true ventilation apertures, not black circles on a disc.
                if j==2 and a%4 in (1,2): continue
                b=(a+1)%count; faces.append((j*count+a,(j+1)*count+a,(j+1)*count+b,j*count+b))
        wheel_mesh('Recessed perforated steel dish',vertices,faces,metal,wheel,collection,side)
        # A dark brake drum behind the vents is a rotating mechanical part.
        revolved_wheel_part('Dark rotating brake drum',[(0,-half*.25),(.57*radius,-half*.25),(.57*radius,half*.22),(0,half*.22)],tire_mat,wheel,collection,side,16)
        hub_tip=1.04 if front else .94
        hub=[(.24,.54),(.22,.84),(.18,hub_tip),(0,hub_tip)]
        revolved_wheel_part('Stepped axle hub',[(r*radius,x*half) for r,x in hub],metal,wheel,collection,side,16)
        for k in range(8):
            a=k*math.pi/4; r=radius*.285; y,z=r*math.cos(a),r*math.sin(a)
            bolt_r=radius*.038; x=half*.60
            # Hexagonal lug nuts with a small chamfer, not a single raised dot.
            profile=[(bolt_r,x),(bolt_r,x+.021),(bolt_r*.76,x+.027),(0,x+.027)]
            revolved_wheel_part('Hex wheel fastener',profile,metal,wheel,collection,side,6,center=(0,y,z),smooth=False)
        # Small metal valve stem is attached to the rotating rim, inside its flange.
        a=.30; y,z=radius*.56*math.cos(a),radius*.56*math.sin(a)
        revolved_wheel_part('Rim valve stem',[(radius*.014,half*.87),(radius*.014,half*1.03),(0,half*1.03)],metal,wheel,collection,side,6,center=(0,y,z))


def cabin_tint(obj, color):
    attr=obj.data.color_attributes.new(name='CabinTint',type='FLOAT_COLOR',domain='CORNER')
    for corner in attr.data: corner.color=(*color,1)
    return obj


def authored_cab_interior(kind, root, collection):
    # Every interior finish shares one vertex-colored material and one runtime draw.
    mat=bpy.data.materials.new('special_cabin_finish'); mat.use_nodes=True; mat.use_backface_culling=True
    shader=mat.node_tree.nodes.get('Principled BSDF'); shader.inputs['Roughness'].default_value=.72
    colors=mat.node_tree.nodes.new('ShaderNodeVertexColor'); colors.layer_name='CabinTint'
    mat.node_tree.links.new(colors.outputs['Color'],shader.inputs['Base Color'])
    def part(name,center,size,color,bevel=.018):
        return cabin_tint(beveled_box(name,center,size,mat.name,collection,root,bevel),color)
    charcoal=(.035,.045,.052); fabric=(.20,.25,.25); bolster=(.29,.34,.32); lining=(.15,.18,.18)
    fire=kind=='firetruck'; floor=.96 if fire else .86; top=2.62 if fire else 2.25
    front=-4.10 if fire else -2.51; back=-1.34 if fire else -.68; inside=1.83 if fire else 1.68
    part('Sealed cab floor',(0,floor,(front+back)/2),(inside+.13,.10,back-front+.04),charcoal,.025)
    part('Closed front footwell bulkhead',(0,floor+.31,front+(.12 if fire else .18)),(inside+.13,.64,.10),charcoal,.025)
    for side in [-1,1]:
        part('Continuous inner sill',(side*(inside/2+.035),floor+.19,(front+back)/2),(.10,.42,back-front+.035),lining,.025)
        part('Closed inner wheel tub',(side*(inside/2-.045),floor+.09,-3.09 if fire else -2.53),(.28,.28,1.02 if fire else .94),charcoal,.075)
    root['sealedCabFloor']=True
    rear_lining=part('Rear cab lining',(0,(top+floor)/2,back+.015),(inside,top-floor,.055),lining,.012)
    for vertex in rear_lining.data.vertices:
        t=max(0,min(1,(vertex.co.z+rear_lining.location.z-floor)/(top-floor)))
        vertex.co.x*=1-.28*t*t
    roof_z=-2.48 if fire else -1.36; roof_l=2.15 if fire else 1.24
    part('Headliner',(0,top,roof_z),(inside*.80,.045,roof_l),(.28,.30,.28),.015)
    for side in [-1,1]:
        part('Inner door trim',(side*(inside/2+.035),floor+.37,roof_z),(.055,.69,roof_l),lining,.025)
        part('Door armrest',(side*(inside/2-.04),floor+.55,roof_z),(.12,.08,.45),charcoal,.025)
        part('Door pull',(side*(inside/2-.108),floor+.70,roof_z-.12),(.018,.055,.14),(.36,.40,.39),.01)
    def seat(x,z,base,width=.47):
        part('Seat pedestal',(x,base-.18,z),(width*.69,.28,.37),charcoal,.018)
        part('Seat cushion',(x,base,z),(width,.15,.50),fabric,.045)
        part('Seat back',(x,base+.37,z+.20),(width,.66,.13),fabric,.05)
        for side in [-1,1]:
            part('Seat bolster',(x+side*width*.44,base+.32,z+.13),(.07,.52,.13),bolster,.028)
        part('Seat headrest',(x,base+.77,z+.20),(width*.68,.19,.12),bolster,.035)
        part('Seat belt strap',(x-width*.31,base+.38,z+.115),(.027,.58,.013),charcoal,.004)
    if fire:
        for x in [-.53,.53]: seat(x,-3.01,1.29,.50)
        for x in [-.57,0,.57]: seat(x,-1.88,1.28,.45)
        dash_z=-3.72; dash_y=1.65; steering=(-.53,1.88,-3.31)
    else:
        for x in [-.48,.48]: seat(x,-1.19,1.12,.47)
        dash_z=-2.15; dash_y=1.44; steering=(-.48,1.65,-1.80)
    part('Sculpted dashboard',(0,dash_y,dash_z),(inside,.22,.43),charcoal,.055)
    part('Dashboard lower shelf',(0,dash_y-.16,dash_z+.04),(inside*.95,.18,.31),lining,.035)
    part('Instrument binnacle',(-.49,dash_y+.16,dash_z+.115),(.41,.16,.22),charcoal,.035)
    part('Instrument panel',(-.49,dash_y+.165,dash_z+.23),(.32,.09,.009),(.13,.28,.30),.009)
    part('Central control panel',(0,dash_y-.01,dash_z+.235),(.22,.17,.02),(.07,.11,.13),.012)
    for x in [-.72,.28,.72]:
        part('Cab air vent',(x,dash_y+.025,dash_z+.228),(.16,.055,.012),(.008,.012,.016),.009)
    part('Center console',(0,floor+.30,dash_z+.63),(.23,.43,.54),charcoal,.035)
    part('Gear selector',(0,floor+.57,dash_z+.60),(.07,.16,.07),(.10,.14,.15),.018)
    authored_driver(kind,root,collection,floor,mat)
    # Original rectangular mirror housings with a genuinely inset rearward pane.
    mirror=wheel_material('traffic_mirror_surface',(.64,.70,.74),1,.055)
    for side in [-1,1]:
        mx=side*(1.145 if fire else 1.085); my=1.86 if fire else 1.65; mz=-3.91 if fire else -2.28
        angle=side*.22; normal=Vector((math.sin(angle),0,math.cos(angle)))
        housing=beveled_box('Mirror housing',(mx,my,mz),(.17,.35,.10),'dark_chassis',collection,root,.035)
        housing.rotation_euler.z=angle
        pane_center=Vector((mx,my,mz))+normal*.052
        pane=beveled_box('Inset reflective mirror pane',pane_center,(.137,.297,.004),mirror.name,collection,root,.025)
        pane.rotation_euler.z=angle
        for dy in [-.095,.095]:
            beveled_beam('Mirror support',(side*(inside/2+.06),my+dy,mz-.03),(mx,my+dy,mz),.022,.022,'dark_chassis',collection,root)
    root['visibleCabInterior']=True; root['mirrorSurface']='Opaque metalness reflection; no per-vehicle reflection camera'


def authored_driver(kind,root,collection,floor,mat):
    """Original adult driver and rigid two-bone arm chains, no baked animation."""
    fire=kind=='firetruck'; x=-.53 if fire else -.48
    seat_y=1.29 if fire else 1.12; seat_z=-3.01 if fire else -1.19
    shoulder_y=1.96 if fire else 1.75; shoulder_z=-3.045 if fire else -1.25
    skin=(.36,.22,.15); shirt=(.035,.065,.085) if fire else (.26,.20,.095)
    trousers=(.025,.035,.045); dark=(.012,.016,.021); strip=(.45,.43,.25)
    def box(name,center,size,color,parent=root,bevel=.025):
        return cabin_tint(beveled_box(name,center,size,mat.name,collection,parent,bevel),color)
    def oval(name,center,size,color,parent=root):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=cv(center))
        obj=bpy.context.object; obj.name=name
        for c in list(obj.users_collection): c.objects.unlink(obj)
        collection.objects.link(obj); obj.parent=parent; obj.scale=(size[0]/2,size[2]/2,size[1]/2)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        obj.data.materials.append(mat)
        for face in obj.data.polygons: face.use_smooth=True
        return cabin_tint(obj,color)
    def beam(name,a,b,width,depth,color,parent=root):
        return cabin_tint(beveled_beam(name,a,b,width,depth,mat.name,collection,parent),color)
    # Adult proportions, work clothes, modest facial detail, no branding.
    hip=(x,seat_y+.13,seat_z+.005); chest=(x,shoulder_y-.20,shoulder_z+.035)
    beam('Driver jacket torso',hip,(x,shoulder_y-.065,shoulder_z),.36,.235,shirt)
    box('Driver jacket hem',(x,seat_y+.17,seat_z-.015),(.37,.075,.25),shirt)
    for sx in [-1,1]:
        beam('Jacket reflective strip',(x+sx*.12,seat_y+.24,seat_z-.14),(x+sx*.12,shoulder_y-.075,shoulder_z-.12),.026,.012,strip)
        leg_x=x+sx*.095
        beam('Seated driver thigh',(leg_x,seat_y+.09,seat_z-.035),(leg_x,seat_y+.01,seat_z-.36),.145,.14,trousers)
        beam('Driver lower leg',(leg_x,seat_y+.01,seat_z-.36),(leg_x,floor+.15,seat_z-.54),.115,.105,trousers)
        box('Driver work shoe',(leg_x,floor+.10,seat_z-.61),(.135,.095,.25),dark,bevel=.025)
    oval('Driver neck',(x,shoulder_y+.015,shoulder_z),(.105,.14,.105),skin)
    head=(x,shoulder_y+.17,shoulder_z-.015)
    oval('Original adult head',head,(.178,.245,.195),skin)
    oval('Short hair',(x,head[1]+.077,head[2]+.012),(.185,.115,.194),(.025,.018,.015))
    oval('Driver nose',(x,head[1]-.006,head[2]-.105),(.038,.045,.04),skin)
    for sx in [-1,1]:
        oval('Driver ear',(x+sx*.086,head[1]-.01,head[2]),(.025,.065,.035),skin)
        oval('Driver eye',(x+sx*.037,head[1]+.015,head[2]-.092),(.014,.009,.009),dark)
    # Steering pivot's game-local XY is the wheel plane; +Z points at the driver.
    steering=(x,1.92 if fire else 1.70,-3.39 if fire else -1.68)
    wheel=empty('steering_wheel',steering,root,collection); wheel.rotation_euler.x=-.30
    wheel['radius']=.205; wheel['steeringAxis']='local Z'; wheel['gripRadius']=.19
    column_start=(x,steering[1]-.20,steering[2]-.30)
    beam('Stationary steering column',column_start,steering,.075,.075,dark)
    bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=6,major_radius=.205,minor_radius=.023)
    ring=bpy.context.object; ring.name='Rotating steering rim'; ring.rotation_euler.x=math.pi/2
    for c in list(ring.users_collection): c.objects.unlink(ring)
    collection.objects.link(ring); ring.parent=wheel; ring.location=(0,0,0); ring.data.materials.append(mat)
    for face in ring.data.polygons: face.use_smooth=True
    cabin_tint(ring,dark)
    box('Rotating steering hub',(0,0,0),(.14,.11,.06),(.06,.075,.08),wheel,.02)
    for endpoint in [(-.18,.015,0),(.18,.015,0),(0,-.18,0)]:
        beam('Rotating steering spoke',(0,0,0),endpoint,.026,.023,(.13,.16,.17),wheel)
    grips={}
    for side in ['l','r']:
        grip=empty('grip_'+side,(-.19 if side=='l' else .19,.02,.025),wheel,collection)
        grips[side]=grip
    stalk=empty('indicator_stalk',(x-.30,steering[1]-.035,steering[2]-.025),root,collection)
    beam('Indicator lever',(x-.045,steering[1]-.04,steering[2]-.07),(x-.30,steering[1]-.035,steering[2]-.025),.022,.024,dark)
    # C maps game coordinates to Blender; convert each rigid-joint rotation too.
    C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
    def orient(obj,q):
        obj.rotation_mode='QUATERNION'; obj.rotation_quaternion=(C@q.to_matrix()@C.inverted()).to_quaternion()
    bpy.context.view_layer.update()
    upper=.30; lower=.28
    reach={}
    for side,sign in [('l',-1),('r',1)]:
        S=Vector((x+sign*.18,shoulder_y,shoulder_z))
        p=grips[side].matrix_world.translation; G=Vector((p.x,p.z,-p.y))
        delta=G-S; distance=delta.length; direction=delta.normalized()
        pole=Vector((0,-1,0)); pole=(pole-direction*pole.dot(direction)).normalized()
        along=(upper*upper-lower*lower+distance*distance)/(2*distance)
        E=S+direction*along+pole*math.sqrt(max(0,upper*upper-along*along))
        shoulder=empty('driver_shoulder_'+side,S,root,collection)
        shoulder['upperLength']=upper; shoulder['forearmLength']=lower; shoulder['ikPole']=[0,-1,0]
        q_upper=Vector((0,1,0)).rotation_difference((E-S).normalized()); orient(shoulder,q_upper)
        elbow=empty('driver_elbow_'+side,(0,upper,0),shoulder,collection)
        q_lower=Vector((0,1,0)).rotation_difference((G-E).normalized()); orient(elbow,q_upper.inverted()@q_lower)
        hand=empty('driver_hand_'+side,(0,lower,0),elbow,collection)
        oval('Driver upper sleeve',(0,upper*.49,0),(.12,upper+.035,.115),shirt,shoulder)
        oval('Driver forearm',(0,lower*.47,0),(.095,lower+.02,.09),skin,elbow)
        oval('Driver sleeve cuff',(0,.038,0),(.106,.10,.10),shirt,elbow)
        oval('Driver palm',(0,.005,0),(.08,.10,.047),skin,hand)
        oval('Driver wrapped fingers',(0,.035,-.012),(.077,.05,.046),skin,hand)
        oval('Driver thumb',(sign*.04,.006,-.016),(.028,.055,.031),skin,hand)
        reach[side]=round(distance,4)
    root['driverRig']='Two-bone rigid arms; local +Y bones, local Z steering wheel'
    root['driverGripReach']=json.dumps(reach); root['driverAdult']=True


def export_runtime(root, kind, destination):
    """Merge only the runtime copy, preserving all editable objects in the .blend."""
    saved_names={obj:obj.name for obj in bpy.data.objects}
    for obj,name in saved_names.items():
        obj['runtime_name']=name; obj.name='EDITABLE_'+name
    collection=bpy.data.collections.new('Runtime export'); bpy.context.scene.collection.children.link(collection)
    exported=empty(kind,collection=collection)
    for key,value in root.items(): exported[key]=value
    groups={}; buckets=defaultdict(lambda:{'vertices':[],'normals':[],'faces':[],'colors':[],'material':None})
    def is_pivot(obj):
        name=obj.get('runtime_name','')
        return obj.type=='EMPTY' and (name.startswith(('wheel_','driver_','grip_')) or name in ['steering_wheel','indicator_stalk'])
    def clone_pivots(parent):
        for original in parent.children:
            if not is_pivot(original): continue
            name=original['runtime_name']; parent_name=original.parent.get('runtime_name','')
            group=empty(name,parent=groups.get(parent_name,exported),collection=collection)
            group.matrix_local=original.matrix_local.copy()
            for key,value in original.items():
                if key!='runtime_name': group[key]=value
            groups[name]=group; clone_pivots(original)
    clone_pivots(root)
    dg=bpy.context.evaluated_depsgraph_get()
    for obj in list(bpy.data.objects):
        if obj.type!='MESH' or not obj.parent: continue
        ancestor=obj.parent
        while ancestor and ancestor!=root: ancestor=ancestor.parent
        if ancestor!=root: continue
        pivot=obj.parent if is_pivot(obj.parent) else None
        group_name=pivot['runtime_name'] if pivot else ''
        ev=obj.evaluated_get(dg); me=ev.to_mesh(); me.calc_loop_triangles()
        transform=obj.matrix_local if pivot else obj.matrix_world
        normal_transform=transform.to_3x3().inverted().transposed()
        for tri in me.loop_triangles:
            mat=me.materials[tri.material_index]; bucket=buckets[(group_name,mat.name)]; bucket['material']=mat
            start=len(bucket['vertices']); bucket['faces'].append((start,start+1,start+2))
            for loop_index in tri.loops:
                loop=me.loops[loop_index]; bucket['vertices'].append(transform@me.vertices[loop.vertex_index].co)
                bucket['normals'].append((normal_transform@me.corner_normals[loop_index].vector).normalized())
                tint=me.color_attributes.get('CabinTint')
                bucket['colors'].append(tuple(tint.data[loop_index].color) if tint else (1,1,1,1))
        ev.to_mesh_clear()
    cache={}
    for (group_name,mat_name),bucket in buckets.items():
        key=(mat_name,tuple(tuple(round(v,6) for v in p) for p in bucket['vertices'])) if group_name else None
        mesh=cache.get(key) if key else None
        if not mesh:
            mesh=bpy.data.meshes.new(mat_name); mesh.from_pydata(bucket['vertices'],[],bucket['faces']); mesh.update(); mesh.materials.append(bucket['material'])
            for polygon in mesh.polygons: polygon.use_smooth=True
            mesh.normals_split_custom_set(bucket['normals'])
            if mat_name=='special_cabin_finish':
                attr=mesh.color_attributes.new(name='CabinTint',type='FLOAT_COLOR',domain='CORNER')
                for i,corner in enumerate(attr.data): corner.color=bucket['colors'][i]
            if key: cache[key]=mesh
        name='body' if mat_name=='body' else 'lights_red' if mat_name=='lights_red' else 'body_fixed' if mat_name=='fixed_rescue_red' else mat_name
        obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj); obj.parent=groups.get(group_name,exported)
    for original in root.children:
        if original.type=='EMPTY' and original.get('runtime_name','').startswith('equipment_'):
            anchor=empty(original['runtime_name'],parent=exported,collection=collection); anchor.location=original.location.copy()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in collection.objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=exported
    bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',use_selection=True,export_yup=True,
      export_apply=True,export_extras=True,export_normals=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
    stats={'meshes':sum(o.type=='MESH' for o in collection.objects),'triangles':sum(len(o.data.polygons) for o in collection.objects if o.type=='MESH'),
      'wheels':sorted(name for name in groups if name.startswith('wheel_')),'driverRigNodes':sorted(name for name in groups if not name.startswith('wheel_')),'file':os.path.relpath(destination,ROOT)}
    for obj in list(collection.objects): bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.collections.remove(collection)
    for obj,name in saved_names.items():
        obj.name=name; del obj['runtime_name']
    return stats


def studio(root, kind):
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=32
    scene.cycles.use_denoising=False; scene.render.resolution_x=1280; scene.render.resolution_y=800; scene.render.resolution_percentage=100
    scene.world.color=(.25,.25,.25); scene.view_settings.view_transform='AgX'
    stage=bpy.data.collections.new('Studio preview only, not exported'); scene.collection.children.link(stage)
    ground=bpy.data.materials.new('Studio ground'); ground.diffuse_color=(.32,.37,.40,1); ground.use_nodes=True
    ground.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.32,.37,.40,1)
    ground.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.9
    bpy.ops.mesh.primitive_plane_add(size=200); plane=bpy.context.object; plane.name='Studio floor'
    for c in list(plane.users_collection): c.objects.unlink(plane)
    stage.objects.link(plane); plane.data.materials.append(ground); plane.location.z=-.005
    for name,location,power,size in [('Key',(4,6,9),2300,7),('Fill',(-6,2,6),1500,6),('Rear',(1,-8,7),2200,5)]:
        lamp=bpy.data.lights.new(name,'AREA'); lamp.energy=power; lamp.shape='DISK'; lamp.size=size
        obj=bpy.data.objects.new(name,lamp); stage.objects.link(obj); obj.location=location; obj.rotation_euler=(Vector((0,0,1.2))-obj.location).to_track_quat('-Z','Y').to_euler()
    camera=bpy.data.cameras.new('Inspection camera'); cam=bpy.data.objects.new('Inspection camera',camera); stage.objects.link(cam)
    camera.type='ORTHO'; camera.ortho_scale=11.4 if kind=='firetruck' else 10.2; scene.camera=cam
    return cam


report={}
for kind,data in SOURCE.items():
    if os.environ.get('TRAFFIC_SPECIAL_IDS') and kind not in os.environ['TRAFFIC_SPECIAL_IDS'].split(','): continue
    reset(); collection=bpy.data.collections.new('Editable vehicle'); bpy.context.scene.collection.children.link(collection)
    root=empty(kind,collection=collection)
    for key,value in data['metadata'].items(): root[key]=value
    root['authoring']='Original Blender-refined special vehicle; +Y up and -Z forward in glTF'
    wheel_groups={}
    for info in data['meshes']:
        if not info['group']: import_mesh(kind,info,root,wheel_groups,collection)
    authored_truck_wheels(kind,data,root,collection)
    refine(kind,root,collection); authored_cab_interior(kind,root,collection); bpy.context.view_layer.update()
    report[kind]=export_runtime(root,kind,os.path.join(PUBLIC,kind+'.glb'))
    cam=studio(root,kind)
    for view,location in [('front',(10,13,8)),('rear',(10,-13,8))]:
        cam.location=location; cam.rotation_euler=(Vector((0,0,1.3))-cam.location).to_track_quat('-Z','Y').to_euler()
        bpy.context.scene.render.filepath=os.path.join(PREVIEW,kind+'-'+view+'.png')
        if not os.environ.get('TRAFFIC_SPECIAL_SKIP_RENDER'): bpy.ops.render.render(write_still=True)
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True); bpy.context.view_layer.objects.active=root
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,kind+'.blend'))
    print('SPECIAL_ASSET',kind,report[kind],flush=True)
with open(os.path.join(PREVIEW,'metrics.json'),'w') as stream: json.dump(report,stream,indent=2)
