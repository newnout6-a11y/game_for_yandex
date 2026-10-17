"""Author the two original freight vehicles in Blender 4.3+.

Run: blender --background --python scripts/create_traffic_heavy.py
The original JS blockout is imported as editable mesh parts, then refined in
Blender with manufactured visor/aero surfaces, access hardware, vent louvers,
trailer structure and safety trim. No downloaded models/textures are used.
The .blend retains editable objects and bevel modifiers. The GLB is separately
batched by material/parent, preserving all wheel and articulated-trailer pivots.
"""
import bpy, bmesh, json, math, os, subprocess
from mathutils import Vector, Matrix
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'art', 'traffic')
ASSETS = os.path.join(ROOT, 'public', 'assets', 'traffic')
PREVIEW = os.environ.get('TRAFFIC_HEAVY_PREVIEW', os.path.join(ROOT, 'output', 'traffic-heavy-blender'))
for directory in (OUT, ASSETS, PREVIEW): os.makedirs(directory, exist_ok=True)
C = Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))

def v(p): return Vector((p[0], -p[2], p[1]))

def get_blockouts():
    code = r"""
import {buildHeavyVehicle} from './src/traffic-heavy.js';
import {TRAFFIC_CATALOG} from './src/traffic-catalog.js';
import {basePaint,baseBrake,trim,glass,chrome,rubber,headlights,plate} from './src/traffic-model-kit.js';
const palette=new Map([[basePaint,'body'],[baseBrake,'lights_red'],[trim,'trim'],[glass,'glass'],[chrome,'chrome'],[rubber,'rubber'],[headlights,'lights_white'],[plate,'plate']]);
const materials=new Map();
function material(m){
 if(!materials.has(m.uuid)) materials.set(m.uuid,{id:m.uuid,name:palette.get(m)||((m.vertexColors)?'wheel_vertex_finish':m.emissiveIntensity>0&&m.emissive?.getHex()>0?'amber':'cargo_skin'),color:m.color.toArray(),roughness:m.roughness,metalness:m.metalness,emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity||0,vertexColors:!!m.vertexColors,clearcoat:m.clearcoat||0,doubleSided:m.side===2});
 return m.uuid;
}
function node(n){n.updateMatrix();const out={name:n.name,matrix:n.matrix.toArray(),userData:n.userData,children:n.children.map(node)};if(n.isMesh){out.material=material(n.material);out.geometry={position:Array.from(n.geometry.attributes.position.array),normal:Array.from(n.geometry.attributes.normal.array),color:n.geometry.attributes.color?Array.from(n.geometry.attributes.color.array):null,index:n.geometry.index?Array.from(n.geometry.index.array):null};}return out;}
const models={};for(const kind of ['boxtruck','semi'])models[kind]={spec:TRAFFIC_CATALOG[kind],root:node(buildHeavyVehicle(kind))};
process.stdout.write(JSON.stringify({materials:Array.from(materials.values()),models}));
"""
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))

def make_material(source):
    material = bpy.data.materials.new('body_paint' if source['name']=='body' else source['name']); material.use_nodes = True
    material.diffuse_color = (*source['color'], 1)
    bs = material.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*source['color'], 1)
    bs.inputs['Metallic'].default_value = source.get('metalness', 0)
    bs.inputs['Roughness'].default_value = source.get('roughness', .5)
    bs.inputs['Coat Weight'].default_value = source.get('clearcoat', 0)
    if source.get('emissive'):
        bs.inputs['Emission Color'].default_value = (*source['emissive'], 1)
        bs.inputs['Emission Strength'].default_value = source.get('emissiveIntensity', 0)
    material.use_backface_culling = not source.get('doubleSided', False)
    if source.get('vertexColors'):
        node = material.node_tree.nodes.new('ShaderNodeVertexColor'); node.layer_name = 'Col'
        material.node_tree.links.new(node.outputs['Color'], bs.inputs['Base Color'])
    material['traffic_role'] = source['name']
    return material

def import_node(source, materials, parent=None):
    data = source.get('geometry')
    if data:
        flat = data['position']; vertices = [v(flat[i:i+3]) for i in range(0,len(flat),3)]
        indices = data.get('index') or list(range(len(vertices)))
        mesh = bpy.data.meshes.new((source['name'] or 'tire_rim_assembly') + '_mesh')
        mesh.from_pydata(vertices, [], [indices[i:i+3] for i in range(0,len(indices),3)]); mesh.update()
        mesh.materials.append(materials[source['material']])
        for poly in mesh.polygons: poly.use_smooth = True
        normals = data['normal']
        mesh.normals_split_custom_set_from_vertices([v(normals[i:i+3]) for i in range(0,len(normals),3)])
        if data.get('color'):
            attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
            colors = data['color']
            for i, item in enumerate(attr.data): item.color = (*colors[i*3:i*3+3], 1)
        ob = bpy.data.objects.new(source['name'] or 'tire_rim_assembly', mesh)
        ob['material_group'] = mesh.materials[0].get('traffic_role', 'detail')
    else: ob = bpy.data.objects.new(source['name'] or 'vehicle_group', None)
    bpy.context.collection.objects.link(ob)
    if parent: ob.parent = parent
    column_major = source['matrix']
    matrix = Matrix([column_major[i::4] for i in range(4)])
    ob.matrix_local = C @ matrix @ C.inverted()
    for key, value in source.get('userData', {}).items():
        if isinstance(value, (str, float, int, bool)): ob[key] = value
    for child in source['children']: import_node(child, materials, ob)
    return ob

def mesh_part(name, points, faces, material, parent, bevel=0):
    mesh = bpy.data.meshes.new(name + '_mesh'); mesh.from_pydata([v(p) for p in points], [], faces); mesh.update(); mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(ob); ob.parent = parent
    ob['material_group'] = material.get('traffic_role', 'detail'); ob['authored_in'] = 'Blender'
    if bevel:
        modifier = ob.modifiers.new('Manufactured rounded edges', 'BEVEL'); modifier.width = bevel; modifier.segments = 2
        modifier.affect = 'EDGES'
        modifier = ob.modifiers.new('Face-weighted corner normals', 'WEIGHTED_NORMAL'); modifier.keep_sharp = True; modifier.weight = 40
    return ob

def box(name, center, dims, material, parent, bevel=.008):
    x,y,z=center; a,b,c=[n/2 for n in dims]
    points=[(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)]
    return mesh_part(name, points, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], material,parent,bevel)

def beam(name, a, b, radius, material, parent):
    a,b=v(a),v(b); midpoint=(a+b)/2; length=(b-a).length
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=length, location=midpoint)
    ob=bpy.context.object; ob.name=name; ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler(); ob.parent=parent
    ob.data.materials.append(material); ob['authored_in']='Blender'; ob['material_group']=material.get('traffic_role','detail')
    return ob

def refine_freight_wheels(root, spec, material):
    """Blender-authored commercial wheel revision: open steel webs, not decals.

    Each wheel remains one vertex-colored mesh and one draw call. The editable
    source stores named vertex groups for tire, rim, hub and fastening islands.
    Tires retain their catalog radius and wheel-center contact-plane clearance.
    """
    bs=material.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Metallic'].default_value=.18
    bs.inputs['Roughness'].default_value=.73
    rubber=(.009,.012,.016,1); sidewall=(.018,.023,.028,1)
    steel=(.32,.38,.42,1); edge=(.43,.49,.53,1); recess=(.055,.075,.085,1)
    fastener=(.42,.45,.46,1); groove=(.003,.004,.005,1)
    radius=spec['wheelRadius']
    for pivot in [ob for ob in root.children_recursive if ob.type=='EMPTY' and ob.name.startswith('wheel_')]:
        role='steer' if pivot.get('steer') else ('trailer' if 'trailer' in pivot.name else 'drive')
        dual=role!='steer'; side=1 if pivot.location.x>0 else -1
        verts=[]; faces=[]; face_colors=[]; groups={}
        def part(name, points, polygons, color):
            start=len(verts); verts.extend(points); groups.setdefault(name,[]).extend(range(start,len(verts)))
            for face in polygons:
                faces.append(tuple(start+i for i in face)); face_colors.append(color)
        def revolve(name, profile, color, segments=24):
            points=[]; polygons=[]
            for x,r in profile:
                points.extend([(x,r*math.cos(a*2*math.pi/segments),r*math.sin(a*2*math.pi/segments)) for a in range(segments)])
            for j in range(len(profile)-1):
                for a in range(segments):
                    b=(a+1)%segments
                    polygons.append((j*segments+a,j*segments+b,(j+1)*segments+b,(j+1)*segments+a))
            part(name,points,polygons,color)
        def cylinder(name, x0,x1,r,center,color,segments=10):
            cy,cz=center; points=[]
            for x in [x0,x1]:points.extend([(x,cy+r*math.cos(i*2*math.pi/segments),cz+r*math.sin(i*2*math.pi/segments)) for i in range(segments)])
            polygons=[tuple(reversed(range(segments))),tuple(range(segments,segments*2))]
            polygons.extend([(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)])
            part(name,points,polygons,color)
        width=.20 if dual else .285
        offsets=[-.125,.125] if dual else [0]
        for index,offset in enumerate(offsets):
            profile=[(-.50,.65),(-.515,.81),(-.45,.93),(-.25,.99),(-.13,1),(.13,1),(.25,.99),(.45,.93),(.515,.81),(.50,.65),(-.50,.65)]
            revolve('Rounded commercial tire '+str(index),[(offset+x*width,r*radius) for x,r in profile],rubber)
            # Raised molded sidewall rings sit below the shoulder. Dark tread
            # bands are physical recessed rings, not floating tire-sized disks.
            if index==len(offsets)-1:
                x=offset+width*.511
                revolve('Molded sidewall rings '+str(index),[(x,.755*radius),(x+.001,.768*radius)],sidewall)
            for sign in [-1,1]:
                gx=offset+sign*width*.11
                revolve('Circumferential tread channel '+str(index),[(gx-.004, .999*radius),(gx+.004,.999*radius)],groove)
        outer=.125+width*.50 if dual else width*.50
        # Outer rolled bead and recessed barrel are geometrically distinct.
        # Descending-radius profile makes the visible dish normals face +X.
        revolve('Rolled steel rim flange',[(outer-.017,radius*.68),(outer+.006,radius*.68),(outer+.014,radius*.662),(outer+.010,radius*.642),(outer-.025,radius*.62)],edge,32)
        revolve('Recessed rim barrel',[(outer-.025,radius*.62),(outer-.060,radius*.565),(outer-.066,radius*.54)],steel,28)
        # Blender's 2D filled curve supports real negative-space ventilation
        # apertures. Convert the manufactured stamping into an editable mesh.
        curve=bpy.data.curves.new('Commercial wheel vented stamping','CURVE');curve.dimensions='2D';curve.fill_mode='BOTH';curve.resolution_u=1;curve.extrude=.006;curve.bevel_depth=0;curve.bevel_resolution=0
        outline=curve.splines.new('POLY');outline.points.add(31)
        for i,p in enumerate(outline.points):
            a=i*2*math.pi/32;p.co=(radius*.55*math.cos(a),radius*.55*math.sin(a),0,1)
        outline.use_cyclic_u=True
        for hole in range(10):
            a=hole*2*math.pi/10;spline=curve.splines.new('POLY');spline.points.add(7)
            for i,p in enumerate(spline.points):
                t=-i*2*math.pi/8
                rr=radius*.43+radius*.064*math.cos(t); tangent=radius*.044*math.sin(t)
                p.co=(rr*math.cos(a)-tangent*math.sin(a),rr*math.sin(a)+tangent*math.cos(a),0,1)
            spline.use_cyclic_u=True
        temp=bpy.data.objects.new('Editable steel stamping',curve);bpy.context.collection.objects.link(temp)
        bpy.ops.object.select_all(action='DESELECT');temp.select_set(True);bpy.context.view_layer.objects.active=temp;bpy.ops.object.convert(target='MESH')
        temp=bpy.context.object
        part('Ten open rim ventilation apertures',[(outer-.060+point.co.z,point.co.x,point.co.y) for point in temp.data.vertices],[tuple(poly.vertices) for poly in temp.data.polygons if poly.normal.z>-.9],steel)
        bpy.data.objects.remove(temp,do_unlink=True)
        # Behind the holes is a small recessed brake drum, never a flat disc
        # pasted over the entire wheel. This gives the real holes depth.
        cylinder('Recessed brake drum',outer-.098,outer-.089,radius*.51,(0,0),recess,12)
        hub_extension=.064 if role=='drive' else (.034 if role=='steer' else .022)
        revolve('Axle-specific hub shoulder',[(outer-.048,radius*.27),(outer-.018,radius*.195),(outer+hub_extension-.008,radius*.165),(outer+hub_extension,radius*.125)],edge,20)
        cylinder('Drive hub' if role=='drive' else 'Bearing dust cap',outer+hub_extension-.008,outer+hub_extension+.004,radius*.126,(0,0),recess if role=='drive' else steel,16)
        for lug in range(10):
            a=lug*2*math.pi/10;center=(radius*.238*math.cos(a),radius*.238*math.sin(a))
            washer=[(outer-.029,center[0]+.025*math.cos(i*math.pi/3),center[1]+.025*math.sin(i*math.pi/3)) for i in range(6)]
            part('Lug washers',washer,[tuple(range(6))],recess)
            cylinder('Ten hexagonal lug nuts',outer-.028,outer-.004,.018,center,fastener,6)
        # Vertex colors on face corners keep rubber dark and the steel painted
        # grey without multiplying draw calls or requiring external textures.
        converted=[v((side*x,y,z)) for x,y,z in verts]
        if side<0: faces=[tuple(reversed(face)) for face in faces]
        mesh=bpy.data.meshes.new(pivot.name+'_Blender_commercial_wheel');mesh.from_pydata(converted,[],faces);mesh.update();mesh.materials.append(material)
        attr=mesh.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
        for poly,color in zip(mesh.polygons,face_colors):
            poly.use_smooth=True
            for loop in poly.loop_indices:attr.data[loop].color=color
        mesh.set_sharp_from_angle(angle=math.radians(36))
        for child in list(pivot.children):bpy.data.objects.remove(child,do_unlink=True)
        wheel=bpy.data.objects.new('commercial_tire_and_vented_steel_rim',mesh);bpy.context.collection.objects.link(wheel);wheel.parent=pivot
        wheel['authored_in']='Blender';wheel['material_group']='wheel_vertex_finish';wheel['wheel_revision']=2
        wheel['construction']='Rounded carcass, molded sidewall, recessed open ten-hole steel rim, axle-specific hub, ten hex nuts'
        for name,indices in groups.items():wheel.vertex_groups.new(name=name).add(indices,1,'REPLACE')
        pivot['wheel_revision']=2;pivot['axle_role']=role;pivot['tire_width']=width;pivot['dual_tire_gap']=.044 if dual else 0

def smooth_manufactured_shell(root):
    # Imported flat extrusion facets are not acceptable as final cab finish.
    # Weld the painted shell in Blender, preserve real >32 degree creases, and
    # rebuild split normals so roof crowns and bevels shade continuously.
    for ob in [root]+list(root.children_recursive):
        if ob.type!='MESH' or ob.get('material_group')!='body': continue
        mesh=ob.data; bm=bmesh.new(); bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        bm.to_mesh(mesh); bm.free(); mesh.update()
        for poly in mesh.polygons: poly.use_smooth=True
        mesh.set_sharp_from_angle(angle=math.radians(32))
        mesh.normals_split_custom_set([(0,0,0)]*len(mesh.loops))
        ob['Blender_surface_refinement']='Welded manufactured surfaces; smooth roof crown; 32 degree sharp-edge threshold'

def refine_in_blender(kind, spec, root, palette):
    paint,trim,chrome=palette['body'],palette['trim'],palette['chrome']
    parent = next(ob for ob in root.children if ob.name.startswith('tractor' if kind=='semi' else 'rigid_truck_body'))
    front=-spec['length']/2+.09; rear=spec['length']/2-.14; width=spec['width']-.39
    cab_rear=front+(2.48 if kind=='semi' else 2.23)
    visor_y=3.035 if kind=='semi' else 2.675
    # Purpose-built seven-station aero visor. Its crowned upper face, downward
    # lip and beveled front edge are authored here, not inherited from blockout.
    points=[]
    for i in range(7):
        t=i/6; x=(t*2-1)*width*.437; crown=.035*(1-(t*2-1)**2)
        points.extend([(x,visor_y+crown,front+.17),(x,visor_y-.055+crown,front+.008),(x,visor_y-.095+crown,front+.022),(x,visor_y-.037+crown,front+.18)])
    faces=[]
    for i in range(6):
        for j in range(4):faces.append((i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j))
    faces.extend([(3,2,1,0),(24,25,26,27)])
    mesh_part('Blender sculpted windscreen visor',points,faces,paint,parent,.008)
    # Individual stamped cooling louvers and grab hardware remain editable in
    # the source blend, then join their existing material batch for the GLB.
    for side in [-1,1]:
        x=side*(width/2+.018)
        for i in range(5):
            louver=box('Cab cooling louver %s %02d'%(side,i),(x,1.31+i*.062,cab_rear-.26),(.022,.024,.29),trim,parent,.006)
        for z in [cab_rear-.46,cab_rear-.10]:
            beam('Recessed cab access handle',(x,1.22,z),(x,1.55,z),.015,chrome,parent)
        gutter_y=3.12 if kind=='semi' else 2.74
        beam('Pressed roof rain gutter',(side*(width/2-.015),gutter_y,front+.42),(side*(width/2-.015),gutter_y,cab_rear-.10),.012,paint,parent)
    if kind=='semi':
        trailer=next(ob for ob in root.children if ob.name=='trailer')
        cargo_parent=next(ob for ob in trailer.children if ob.name.startswith('trailer_body'))
        cargo_front=spec.get('trailerFrontZ',cab_rear+1.33)
        # Mesh coordinates here match the existing trailer static batch. Its
        # local +Z compensation cancels the parent hitch translation exactly.
        for side in [-1,1]:
            x=side*(spec['width']/2-.08)
            box('Front bulkhead protective cap',(x,2.60,cargo_front+.045),(.045,2.51,.09),chrome,cargo_parent,.008)
            for z in [spec['hitchZ']+2.60,1.35,3.46]:
                beam('Trailer rail diagonal brace',(side*.56,1.18,z),(side*(spec['width']/2-.14),.78,z+.34),.023,trim,cargo_parent)
            # Two hanging rear rubber spray strips, short of the contact plane.
            box('Trailer anti-spray brush',(side*(spec['width']/2-.27),.31,rear-1.62+spec['wheelRadius']+.12),(.43,.22,.025),trim,cargo_parent,.003)
        beam('Landing-gear crank',(1.04,.97,spec['hitchZ']+1.68),(1.04,.97,spec['hitchZ']+2.00),.018,chrome,cargo_parent)
        beam('Landing-gear crank grip',(1.04,.97,spec['hitchZ']+2.00),(1.04,.84,spec['hitchZ']+2.00),.022,trim,cargo_parent)
    else:
        for side in [-1,1]:
            x=side*(spec['width']/2-.07)
            box('Rigid cargo lower rub rail',(x,1.53,(cab_rear+.11+rear)/2),(.022,.075,rear-cab_rear-.26),chrome,parent,.008)
            for z in [cab_rear+.17,rear-.11]:
                box('Cargo corner reinforced shoe',(x,1.39,z),(.055,.29,.12),trim,parent,.009)
        for side in [-1,1]:
            beam('Rear underrun brace',(side*.56,.93,rear-.55),(side*.77,.72,rear-.04),.028,trim,parent)
    root['source_authoring']='Original blockout refined in Blender 4.3; editable manufactured parts and bevel modifiers'
    root['coordinate_contract']='glTF +Y up; -Z front; wheel local X spin; trailer local Y articulation'
    root['asset_kind']=kind

def refine_visible_cabin(kind, spec, root, palette):
    """Cut real openings and author the original cabin/mirrors in Blender."""
    front=-spec['length']/2+.09; width=spec['width']-.39; half=width/2
    height=3.68 if kind=='semi' else 2.83; rear=front+(2.48 if kind=='semi' else 2.23)
    wind_low=1.91; wind_high=2.94 if kind=='semi' else 2.58
    window_rear=front+1.61 if kind=='semi' else rear-.15
    paint,trim=palette['body'],palette['trim']
    parent=next(ob for ob in root.children if ob.name.startswith('tractor' if kind=='semi' else 'rigid_truck_body'))
    body=next(ob for ob in parent.children if ob.type=='MESH' and ob.name=='body')
    # Extract the solid cab's connected component from its material batch.
    # Keeping the closed cab independent makes exact Boolean hollowing robust,
    # without touching any wheel arch, fairing, chassis or accepted wheel.
    mesh=body.data; adjacency=[set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a,b=edge.vertices;adjacency[a].add(b);adjacency[b].add(a)
    components=[];seen=set()
    for start in range(len(mesh.vertices)):
        if start in seen:continue
        group=set([start]);pending=[start];seen.add(start)
        while pending:
            for j in adjacency[pending.pop()]:
                if j not in seen:seen.add(j);group.add(j);pending.append(j)
        components.append(group)
    def volume(group):
        points=[mesh.vertices[i].co for i in group]
        return math.prod(max(p[a] for p in points)-min(p[a] for p in points) for a in range(3))
    cab_vertices=max(components,key=volume)
    coordinates=[tuple(vertex.co) for vertex in mesh.vertices]
    cab_faces=[tuple(poly.vertices) for poly in mesh.polygons if poly.vertices[0] in cab_vertices]
    remaining=[tuple(poly.vertices) for poly in mesh.polygons if poly.vertices[0] not in cab_vertices]
    ids=sorted(cab_vertices);mapping={old:i for i,old in enumerate(ids)}
    shell_mesh=bpy.data.meshes.new('Hollow forward-control cab shell')
    shell_mesh.from_pydata([coordinates[i] for i in ids],[],[tuple(mapping[i] for i in face) for face in cab_faces]);shell_mesh.update();shell_mesh.materials.append(paint)
    shell=bpy.data.objects.new('Blender hollow cab with true windows',shell_mesh);bpy.context.collection.objects.link(shell);shell.parent=parent;shell['material_group']='body';shell['authored_in']='Blender'
    retained=sorted(set(i for face in remaining for i in face));remap={old:new for new,old in enumerate(retained)}
    mesh.clear_geometry();mesh.from_pydata([coordinates[i] for i in retained],[],[tuple(remap[i] for i in face) for face in remaining]);mesh.update()
    for poly in mesh.polygons:poly.use_smooth=True
    mesh.set_sharp_from_angle(angle=math.radians(32))
    def cut(cutter):
        modifier=shell.modifiers.new('Real cabin opening','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
        bpy.context.view_layer.objects.active=shell;bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
    cut(box('Cabin inner volume',(0,(1.14+height-.13)/2,(front+.20+rear-.12)/2),(width-.16,height-.13-1.14,rear-.12-front-.20),paint,None,0))
    # Trapezoidal front aperture follows the original glazing; leave real A
    # pillars, dashboard rail and roof/header instead of a floating glass box.
    a=width*.411
    points=[(-a+.015,wind_low+.012),(a-.015,wind_low+.012),(a*.965-.015,wind_high-.012),(-a*.965+.015,wind_high-.012)]
    coords=[(x,y,z) for z in [front-.17,front+.32] for x,y in points]
    cut(mesh_part('Front windshield opening cutter',coords,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],paint,None))
    side_points=[(front+.22,1.897),(front+.405,wind_high+.008),(window_rear-.035,wind_high+.008),(window_rear-.018,1.897)]
    coords=[(x,y,z) for x in [-half-.15,half+.15] for z,y in side_points]
    cut(mesh_part('Door glazing opening cutter',coords,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],paint,None))
    if kind=='semi':cut(box('Sleeper side window opening',(0,2.375,rear-.38),(width+.25,.438,.37),paint,None,0))
    for poly in shell.data.polygons:poly.use_smooth=True
    shell.data.set_sharp_from_angle(angle=math.radians(32))
    shell['cabin_shell_revision']=1
    # Remove the old filled black gasket patches, retaining wipers and door
    # hardware. New narrow seals frame the now genuinely open apertures.
    def game_point(co):return (co.x,co.z,-co.y)
    def front_patch(point):
        x,y,z=point; vv=(y-(wind_low-.035))/(wind_high-wind_low+.07)
        if not -.0001<=vv<=1.0001:return False
        span=(width*.411+.035)*(1-.035*vv);u=x/span
        if abs(u)>1.0001:return False
        expected=front+.035+(y-1.84)/(height-.16-1.84)*.185-.074+abs(u)**5*.019
        return abs(z-expected)<.00002
    def side_patch(point):
        x,y,z=point
        return abs(abs(x)-(half+.011))<.00002 and 1.84<y<wind_high+.07 and front+.12<z<window_rear+.05
    def remove_faces(ob,predicate):
        bm=bmesh.new();bm.from_mesh(ob.data)
        doomed=[face for face in bm.faces if all(predicate(game_point(vertex.co)) for vertex in face.verts)]
        bmesh.ops.delete(bm,geom=doomed,context='FACES');bm.to_mesh(ob.data);bm.free();ob.data.update()
    for ob in list(parent.children):
        if ob.type!='MESH':continue
        if ob.data.materials and ob.data.materials[0]==trim:remove_faces(ob,lambda p:front_patch(p) or side_patch(p))
    glass=palette['glass'];glass.name='cabin_glass';glass['traffic_role']='cabin_glass'
    bs=glass.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.14,.23,.27,1);bs.inputs['Alpha'].default_value=.20;bs.inputs['Metallic'].default_value=.02;bs.inputs['Roughness'].default_value=.09;bs.inputs['Coat Weight'].default_value=.15
    glass.diffuse_color=(.14,.23,.27,.20);glass.surface_render_method='DITHERED';glass.use_transparency_overlap=False;glass.use_backface_culling=True
    for ob in list(parent.children):
        if ob.type=='MESH' and ob.data.materials and ob.data.materials[0]==glass:
            remove_faces(ob,lambda p:abs(p[0])>half+.04 and front-.05<p[2]<front+.22)
            bm=bmesh.new();bm.from_mesh(ob.data)
            for face in bm.faces:
                if all(vertex.co.x<-.5 for vertex in face.verts) and max(vertex.co.x for vertex in face.verts)-min(vertex.co.x for vertex in face.verts)<.00001:face.normal_flip()
            bm.to_mesh(ob.data);bm.free();ob.data.update();ob.data.normals_split_custom_set([(0,0,0)]*len(ob.data.loops))
            ob['transparent_glazing']=True
    for side in [-1,1]:
        outline=[(front+.20,1.88),(front+.39,wind_high+.025),(window_rear-.02,wind_high+.025),(window_rear,1.88)]
        for i in range(4):
            z0,y0=outline[i];z1,y1=outline[(i+1)%4]
            beam('Narrow door window rubber seal',(side*(half+.016),y0,z0),(side*(half+.016),y1,z1),.014,trim,parent)
    def wz(y):return front+.035+(y-1.84)/(height-.16-1.84)*.185-.085
    front_outline=[(-a,wind_low),(a,wind_low),(a*.965,wind_high),(-a*.965,wind_high)]
    for i in range(4):
        x0,y0=front_outline[i];x1,y1=front_outline[(i+1)%4]
        beam('Narrow windshield rubber seal',(x0,y0,wz(y0)),(x1,y1,wz(y1)),.014,trim,parent)
    # One vertex-colored interior material keeps all seats, trim, instruments
    # and steering components in one inexpensive runtime material batch.
    interior=make_material({'name':'cabin_interior','color':[1,1,1],'roughness':.82,'metalness':.02,'vertexColors':True})
    charcoal=(.025,.036,.045,1);dash_color=(.045,.063,.073,1);upholstery=(.27,.21,.145,1);inset=(.36,.29,.21,1);ceiling=(.20,.22,.22,1)
    def colorize(ob,color):
        attr=ob.data.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
        for item in attr.data:item.color=color
        return ob
    def ibox(name,center,dims,color,bevel=.025):return colorize(box(name,center,dims,interior,parent,bevel),color)
    def ibeam(name,start,end,r,color):return colorize(beam(name,start,end,r,interior,parent),color)
    # Continuous structural floor reaches the inside of every door sill and
    # bulkhead. Real inner tubs and a firewall hide the *outside* wheel wells
    # without placing any opaque backing in the glazed cabin.
    ibox('Continuous sealed cabin floor',(0,1.18,(front+.17+rear-.075)/2),(width-.09,.11,rear-front-.245),charcoal,.008)
    ibox('Front cabin firewall',(0,1.43,front+.24),(width-.10,.56,.095),dash_color,.014)
    ibox('Recessed front footwell toe board',(0,1.27,front+.40),(width-.16,.22,.22),charcoal,.018)
    axle_z=front+(1.22 if kind=='semi' else 1.20); axle_y=spec['wheelRadius']+.012
    for side in [-1,1]:
        inner=side*(half-.40);outer=side*(half-.025);radius=spec['wheelRadius']+.115
        points=[]
        for x in [inner,outer]:
            for i in range(17):
                a=i*math.pi/16;points.append((x,axle_y+math.sin(a)*radius,axle_z+math.cos(a)*radius))
        faces=[(i,i+1,i+18,i+17) for i in range(16)]
        faces.extend([tuple(reversed(range(17))),tuple(range(17,34)),(0,17,33,16)])
        tub=mesh_part('Sealed inner commercial wheel tub',points,faces,interior,parent,.006)
        bm=bmesh.new();bm.from_mesh(tub.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(tub.data);bm.free();colorize(tub,charcoal)
        ibox('Wheel tub to floor sealed joint',(side*(half-.18),1.145,axle_z),(.30,.18,1.25),charcoal,.018)
        ibox('Inner door sill',(side*(half-.074),1.24,(front+.32+rear-.13)/2),(.115,.20,rear-front-.45),dash_color,.012)
    ibox('Inner rear bulkhead',(0,2.02,rear-.155),(width-.24,1.57,.035),ceiling,.004)
    ibox('Cabin headliner',(0,height-.145,(front+.4+rear-.16)/2),(width-.25,.035,rear-front-.56),ceiling,.008)
    ibox('Sculpted truck dashboard',(0,1.71,front+.45),(width-.25,.32,.38),dash_color,.07)
    ibox('Driver instrument hood',(-.47,1.90,front+.54),(.53,.15,.24),charcoal,.035)
    ibox('Recessed instrument panel',(-.47,1.88,front+.668),(.43,.10,.014),(.095,.17,.18,1),.008)
    for x in [-.79,.30,.77]:ibox('Dash air vent',(x,1.80,front+.651),(.19,.064,.016),charcoal,.006)
    ibox('Central console',(0,1.39,front+1.0),(.28,.38,.42),dash_color,.035)
    for side in [-1,1]:
        seat_z=front+1.32
        ibox('Seat suspension pedestal',(side*.50,1.32,seat_z),(.31,.25,.34),charcoal,.015)
        ibox('Truck seat cushion',(side*.50,1.48,seat_z),(.53,.17,.55),upholstery,.065)
        ibox('Upholstered seat back',(side*.50,1.91,seat_z+.24),(.52,.72,.17),upholstery,.065)
        ibox('Inset seat back panel',(side*.50,1.92,seat_z+.145),(.36,.53,.026),inset,.018)
        ibox('Adjustable head restraint',(side*.50,2.36,seat_z+.23),(.32,.20,.15),upholstery,.04)
        ibox('Interior door trim',(side*(half-.108),1.56,front+1.13),(.034,.65,1.30),dash_color,.012)
        ibox('Interior door arm rest',(side*(half-.16),1.72,front+1.31),(.13,.09,.38),charcoal,.02)
    if kind=='semi':ibox('Sleeper bunk cushion',(0,1.43,rear-.48),(width-.35,.15,.60),(.13,.18,.22,1),.045)
    author_driver_and_steering(kind,spec,root,parent,interior,front,colorize,ibox,ibeam)
    # A named environment-reflective pane faces rearward and slightly outward
    # inside each retained housing. No scene cameras or transmission passes.
    reflector=make_material({'name':'mirror_reflector','color':[.67,.72,.75],'roughness':.085,'metalness':.96})
    reflector['reflection_method']='Environment approximation, not a live rear-view camera'
    for side in [-1,1]:
        for y,dims,z in [(2.25,(.083,.328,.007),front+.136),(1.94,(.076,.104,.006),front+.130)]:
            center=(side*(half+.115),y,z)
            mirror=box('Rearward reflective mirror pane',center,dims,reflector,parent,.004)
            mirror.data.transform(Matrix.Translation(-v(center)));mirror.location=v(center);mirror.rotation_euler.z=side*.14
            mirror['mirror_facing']='rearward and outward';mirror['reflection_method']='environment'
    root['visible_cabin_revision']=2

def author_driver_and_steering(kind,spec,root,parent,material,front,colorize,ibox,ibeam):
    """Original adult driver and low-cost articulated hands, authored in Blender.

    Empties export in the game's coordinates. Wheel local XY is the rim plane,
    +Z points toward the driver. Arm bones point along local +Y; segment lengths
    are recorded as extras so the runtime two-bone solver uses actual geometry.
    """
    skin=(.43,.255,.15,1);skin_light=(.54,.34,.215,1)
    jacket=(.055,.115,.16,1);jacket_light=(.085,.16,.205,1)
    pants=(.055,.064,.075,1);boots=(.022,.028,.033,1)
    hair=(.035,.022,.016,1);dark=(.017,.023,.027,1)
    def empty(name,position,owner,rotation=None):
        ob=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(ob);ob.parent=owner
        transform=Matrix.Translation(Vector(position))
        if rotation is not None:transform=transform@rotation.to_4x4()
        ob.matrix_local=C@transform@C.inverted();ob.empty_display_size=.04
        ob['authored_in']='Blender';return ob
    def ellipsoid(name,center,radii,color,owner=parent,segments=12,rings=8):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=v(center))
        ob=bpy.context.object;ob.name=name;ob.parent=owner;ob.scale=(radii[0],radii[2],radii[1]);ob.data.materials.append(material)
        for poly in ob.data.polygons:poly.use_smooth=True
        ob['authored_in']='Blender';colorize(ob,color);return ob
    def capsule(name,start,end,radii,color,owner=parent):
        a,b=Vector(start),Vector(end);ob=ellipsoid(name,(a+b)/2,(radii[0],radii[1],(b-a).length/2+radii[1]),color,owner)
        # Blender sphere local Z is its long axis after replacing scale.
        ob.scale=(radii[0],radii[1],(b-a).length/2+radii[1]);ob.rotation_euler=v((b-a).normalized()).to_track_quat('Z','Y').to_euler();return ob
    def local_box(name,center,dims,color,owner,bevel=.008):return colorize(box(name,center,dims,material,owner,bevel),color)
    def local_beam(name,start,end,r,color,owner):return colorize(beam(name,start,end,r,material,owner),color)
    def loft(name,profiles,color,owner=parent,segments=20,offset=(0,0,0)):
        points=[];faces=[];ox,oy,oz=offset
        for y,rx,rz,cz in profiles:
            for i in range(segments):
                angle=i*math.tau/segments;depth=math.sin(angle)
                if name=='Sculpted adult jaw cheek and skull' and depth<0:depth=-math.sqrt(-depth)
                points.append((ox+rx*math.cos(angle),oy+y,oz+cz+rz*depth))
        for row in range(len(profiles)-1):
            for i in range(segments):faces.append((row*segments+i,row*segments+(i+1)%segments,(row+1)*segments+(i+1)%segments,(row+1)*segments+i))
        faces.extend([tuple(reversed(range(segments))),tuple(range((len(profiles)-1)*segments,len(profiles)*segments))])
        ob=mesh_part(name,points,faces,material,owner)
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
        for poly in ob.data.polygons:poly.use_smooth=True
        colorize(ob,color);return ob
    def tube(name,centers,radii,color,owner=parent,segments=8):
        points=[];faces=[];centers=[Vector(p) for p in centers]
        for j,center in enumerate(centers):
            tangent=(centers[min(j+1,len(centers)-1)]-centers[max(0,j-1)]).normalized()
            across=tangent.cross(Vector((1,0,0)))
            if across.length<.1:across=tangent.cross(Vector((0,1,0)))
            across.normalize();up=tangent.cross(across).normalized()
            for i in range(segments):points.append(center+radii[j]*(across*math.cos(i*math.tau/segments)+up*math.sin(i*math.tau/segments)))
        for j in range(len(centers)-1):
            for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
        faces.extend([tuple(reversed(range(segments))),tuple(range((len(centers)-1)*segments,len(centers)*segments))])
        ob=mesh_part(name,points,faces,material,owner)
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
        for poly in ob.data.polygons:poly.use_smooth=True
        return colorize(ob,color)
    ellipsoid('Adult driver pelvis',(-.50,1.65,front+1.28),(.19,.145,.16),pants)
    loft('Tailored driver jacket torso',[(1.60,.16,.12,0),(1.69,.184,.142,0),(1.87,.218,.148,0),(2.04,.235,.132,0),(2.13,.183,.096,0),(2.18,.074,.056,0)],jacket,offset=(-.50,0,front+1.31))
    ibox('Driver jacket zipper',(-.50,1.85,front+1.158),(.009,.36,.009),(.18,.22,.24,1),.002)
    ibox('Driver zipper pull',(-.50,2.019,front+1.150),(.018,.027,.012),(.28,.31,.31,1),.004)
    ibox('Driver jacket chest pocket',(-.385,1.98,front+1.167),(.10,.08,.013),jacket_light,.008)
    for side in [-1,1]:
        points=[(-.50+side*.06,2.18,front+1.247),(-.50+side*.15,2.09,front+1.201),(-.50+side*.077,2.04,front+1.166),(-.50+side*.035,2.135,front+1.206)]
        collar=mesh_part('Folded jacket collar',points,[(0,1,2,3),(3,2,1,0)],material,parent);colorize(collar,jacket_light)
        tube('Jacket stitched side seam',[(-.50+side*.179,1.70,front+1.26),(-.50+side*.210,1.87,front+1.25),(-.50+side*.215,2.03,front+1.24)],[.003,.003,.003],jacket_light)
    capsule('Driver neck',(-.50,2.16,front+1.30),(-.50,2.24,front+1.30),(.055,.045),skin)
    # All face/hair/ear parts share one independently yawable head batch. Its
    # unscaled neck anchor keeps local +Y up and -Z forward after glTF export.
    head=empty('driver_head',(-.50,2.20,front+1.30),root);head['rig_role']='contextual_head';head['forward_axis']='local -Z';head['driver_detail_revision']=2
    loft('Sculpted adult jaw cheek and skull',[(.018,.050,.047,-.006),(.045,.064,.059,-.020),(.073,.087,.075,-.018),(.115,.102,.087,-.009),(.16,.113,.094,0),(.205,.110,.095,.008),(.25,.102,.090,.016),(.29,.075,.072,.019),(.31,.024,.027,.019)],skin_light,head,24)
    # Sculpted bridge, alar wings and tip replace the earlier spherical nose.
    nose=[(-.010,.223,-.083),(.010,.223,-.083),(-.014,.158,-.111),(.014,.158,-.111),(-.008,.149,-.127),(.008,.149,-.127),(-.019,.140,-.107),(.019,.140,-.107),(0,.137,-.112)]
    ob=mesh_part('Sculpted nose bridge and tip',nose,[(0,2,4,5,3,1),(2,6,8,4),(3,5,8,7),(4,8,5),(0,1,3,7,8,6,2)],material,head,.003);colorize(ob,skin_light)
    for side in [-1,1]:
        ellipsoid('Subtle nostril',(side*.012,.145,-.114),(.006,.0035,.004),(.15,.063,.034,1),head,8,6)
        x=side*.043
        ellipsoid('Sculpted eye socket',(x,.201,-.080),(.026,.015,.006),skin,head,12,6)
        ellipsoid('Driver eye white',(x,.202,-.087),(.018,.008,.005),(.63,.64,.58,1),head,12,6)
        ellipsoid('Driver iris',(x,.202,-.093),(.0065,.0065,.0024),(.075,.105,.095,1),head,10,6)
        ellipsoid('Driver pupil',(x,.202,-.095),(.003,.004,.0015),dark,head,8,6)
        tube('Upper eyelid',[(x-.019,.202,-.086),(x-.010,.209,-.091),(x+.006,.211,-.091),(x+.019,.204,-.085)],[.0025,.003,.003,.0025],skin,head,6)
        tube('Natural shaped eyebrow',[(x-.026,.225,-.084),(x-.011,.231,-.088),(x+.012,.230,-.087),(x+.027,.223,-.081)],[.003,.005,.004,.002],hair,head,6)
        ellipsoid('Anatomical outer ear',(side*.115,.167,.010),(.020,.036,.025),skin_light,head,12,8)
        ellipsoid('Inset ear concha',(side*.129,.167,.004),(.004,.022,.014),skin,head,10,6)
        tube('Ear helix fold',[(side*.128,.143,.018),(side*.135,.162,.027),(side*.133,.190,.021),(side*.128,.194,-.002)],[.004,.004,.004,.003],skin_light,head,6)
    tube('Shaped upper lip',[(-.027,.108,-.092),(-.011,.112,-.099),(0,.109,-.101),(.011,.112,-.099),(.027,.108,-.092)],[.003,.004,.003,.004,.003],(.32,.145,.095,1),head,6)
    tube('Lower lip',[(-.023,.103,-.094),(0,.098,-.101),(.023,.103,-.094)],[.0025,.004,.0025],(.40,.21,.14,1),head,6)
    # Hairline follows forehead/temples; crown is no longer a separate ball.
    hair_points=[];hair_faces=[];segments=24
    for row in range(4):
        for i in range(segments):
            angle=i*math.tau/segments;frontness=max(0,-math.sin(angle))
            y=[.183+.060*frontness,.267,.304,.318][row]
            rx=[.113,.103,.069,.015][row];rz=[.099,.092,.063,.018][row]
            depth=math.sin(angle);depth=-math.sqrt(-depth) if depth<0 else depth
            hair_points.append((rx*math.cos(angle),y,.017+rz*depth))
    for row in range(3):
        for i in range(segments):hair_faces.append((row*segments+i,row*segments+(i+1)%segments,(row+1)*segments+(i+1)%segments,(row+1)*segments+i))
    hair_faces.append(tuple(range(72,96)))
    ob=mesh_part('Original shaped short hair and hairline',hair_points,hair_faces,material,head)
    bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();colorize(ob,hair)
    for poly in ob.data.polygons:poly.use_smooth=True
    for i in range(7):
        x=-.075+i*.024
        f0=math.sqrt(1-(x/.113)**2);x1=x*.90;f1=math.sqrt(1-(x1/.103)**2);x2=x*.60;f2=math.sqrt(1-(x2/.069)**2)
        tube('Swept scalp-fitted short hair lock',[(x,.183+.060*f0+.001,.017-.099*math.sqrt(f0)-.001),(x1,.268,.017-.092*math.sqrt(f1)-.001),(x2,.305,.017-.063*math.sqrt(f2)-.001)],[.0015,.002,.0012],(.055,.036,.025,1),head,6)
    # Physical seated legs terminate above the lined floor, clear of the dash.
    for side in [-1,1]:
        x=-.50+side*.105
        capsule('Driver trouser thigh',(x,1.64,front+1.27),(x,1.56,front+.94),(.095,.083),pants)
        capsule('Driver trouser shin',(x,1.54,front+.94),(x,1.29,front+.80),(.071,.065),pants)
        ellipsoid('Driver work shoe',(x,1.265,front+.715),(.083,.060,.15),boots)
    ibeam('Driver seat belt',(-.70,2.14,front+1.23),(-.35,1.64,front+1.12),.018,dark)
    ibox('Seat belt buckle',(-.32,1.65,front+1.14),(.055,.07,.04),(.22,.055,.035,1),.009)
    center=Vector((-.50,1.98,front+.88));normal=Vector((0,.48,.88)).normalized()
    xaxis=Vector((1,0,0));yaxis=normal.cross(xaxis).normalized()
    rotation=Matrix((xaxis,yaxis,normal)).transposed()
    wheel=empty('steering_wheel',center,parent,rotation);wheel['rig_role']='steering';wheel['roll_axis']='local Z'
    bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=6,major_radius=.18,minor_radius=.016)
    rim=bpy.context.object;rim.name='Original three-spoke steering rim';rim.parent=wheel;rim.data.transform(C);rim.data.materials.append(material);colorize(rim,dark)
    for poly in rim.data.polygons:poly.use_smooth=True
    local_box('Steering wheel center',(0,0,.004),(.10,.075,.065),dark,wheel,.020)
    for angle in [math.pi/6,5*math.pi/6,3*math.pi/2]:
        local_beam('Steering wheel spoke',(0,0,0),(math.cos(angle)*.17,math.sin(angle)*.17,0),.012,jacket_light,wheel)
    ibeam('Steering column',(-.50,1.57,front+.60),center,.035,dark)
    stalk_position=center+rotation@Vector((-.215,-.055,-.065))
    stalk=empty('indicator_stalk',stalk_position,parent,rotation);stalk['rig_role']='indicator_hand_target'
    ibeam('Column indicator stalk',center+rotation@Vector((-.045,-.055,-.065)),stalk_position,.010,dark)
    # The stalk is a target marker; its visible switch is included in the static
    # cabin batch. Hands can reach it without adding an unnecessary eighth draw.
    ibox('Indicator stalk thumb switch',stalk_position,(.038,.025,.032),dark,.008)
    for side,label in [(-1,'l'),(1,'r')]:
        grip_local=Vector((side*.162,.072,.014));grip=empty('grip_'+label,grip_local,wheel);grip['rig_role']='hand_hold'
        target=center+rotation@grip_local
        shoulder=Vector((-.50+side*.19,2.13,front+1.32));upper_length=.30;forearm_length=.28
        delta=target-shoulder;distance=delta.length;direction=delta.normalized()
        bend=Vector((side*.20,-1,.12));bend=(bend-direction*bend.dot(direction)).normalized()
        along=(upper_length**2-forearm_length**2+distance**2)/(2*distance)
        elbow_pos=shoulder+direction*along+bend*math.sqrt(max(0,upper_length**2-along**2))
        upper_rotation=Vector((0,1,0)).rotation_difference((elbow_pos-shoulder).normalized()).to_matrix()
        forearm_world=Vector((0,1,0)).rotation_difference((target-elbow_pos).normalized()).to_matrix()
        shoulder_ob=empty('driver_shoulder_'+label,shoulder,parent,upper_rotation)
        shoulder_ob['upperLength']=upper_length;shoulder_ob['forearmLength']=forearm_length;shoulder_ob['rig_role']='two_bone_arm';shoulder_ob['driver_side']=label
        elbow_ob=empty('driver_elbow_'+label,(0,upper_length,0),shoulder_ob,upper_rotation.inverted()@forearm_world)
        hand_ob=empty('driver_hand_'+label,(0,forearm_length,0),elbow_ob,forearm_world.inverted()@rotation)
        loft('Tapered upper jacket sleeve',[(0,.064,.064,0),(.045,.075,.070,0),(.16,.064,.060,0),(.27,.051,.050,0),(.30,.047,.047,0)],jacket,shoulder_ob,12)
        loft('Tapered forearm jacket sleeve',[(0,.050,.049,0),(.055,.057,.053,0),(.16,.047,.045,0),(.213,.041,.041,0)],jacket_light,elbow_ob,12)
        loft('Ribbed driver cuff',[(.195,.043,.043,0),(.211,.044,.043,0),(.225,.037,.038,0)],jacket,elbow_ob,12)
        capsule('Driver exposed wrist',(0,.221,0),(0,forearm_length-.015,0),(.035,.031),skin,elbow_ob)
        # Compact palm plus four curled fingers straddle the wheel rim. The hand
        # origin is the actual hold, not a wrist offset that would spoil IK.
        ellipsoid('Driver gripping palm',(0,0,0),(.045,.052,.025),skin_light,hand_ob)
        for i in range(4):
            xx=-.027+i*.018;shorten=.005 if i in [0,3] else 0
            tube('Curved finger with three phalanges',[(xx,.037-shorten,.010),(xx,.026-shorten,-.013),(xx,.007,-.033),(xx,-.014,-.033),(xx,-.027+shorten,-.018)],[.009,.010,.0095,.0085,.007],skin_light,hand_ob,8)
            ellipsoid('Short natural fingernail',(xx,-.016,-.039),(.005,.007,.0018),(.54,.36,.26,1),hand_ob,8,6)
        tube('Curved opposing thumb',[(-side*.027,-.023,.013),(-side*.045,-.004,.014),(-side*.041,.020,-.005),(-side*.019,.023,-.018)],[.014,.013,.011,.009],skin_light,hand_ob,8)
    root['driver_rig_revision']=2;root['interior_liner_revision']=2
    root['driver_description']='Original seated adult driver, two-bone arms, wheel grip targets; no external assets'

def split_directional_indicators(spec, root, palette):
    """Separate only turn-signal lenses, preserving static amber markers."""
    front=-spec['length']/2+.09;rear=spec['length']/2-.14
    signal_materials={}
    for side,name in [(-1,'indicator_left'),(1,'indicator_right')]:
        material=palette['amber'].copy();material.name=name;material['traffic_role']=name;signal_materials[side]=material
    for ob in list(root.children_recursive):
        if ob.type!='MESH' or not ob.data.materials or ob.data.materials[0]!=palette['amber']:continue
        positions=[(p.co.x,p.co.z,-p.co.y) for p in ob.data.vertices]
        selected={-1:[],1:[]}
        for poly in ob.data.polygons:
            points=[positions[i] for i in poly.vertices]
            if all(front-.09<z<front+.005 and .90<y<1.06 and abs(x)>.85 for x,y,z in points) or all(rear+.04<z<rear+.12 and .84<y<1.11 and abs(x)>.93 for x,y,z in points):
                selected[-1 if sum(p[0] for p in points)<0 else 1].append(tuple(poly.vertices))
        remove=set()
        for side,faces in selected.items():
            if not faces:continue
            ids=sorted(set(i for face in faces for i in face));mapping={old:new for new,old in enumerate(ids)}
            mesh=bpy.data.meshes.new(signal_materials[side].name+'_lens_geometry');mesh.from_pydata([ob.data.vertices[i].co.copy() for i in ids],[],[tuple(mapping[i] for i in face) for face in faces]);mesh.update();mesh.materials.append(signal_materials[side])
            lens=bpy.data.objects.new(signal_materials[side].name,mesh);bpy.context.collection.objects.link(lens);lens.parent=ob.parent;lens['material_group']=signal_materials[side].name;lens['authored_in']='Blender'
            remove.update(faces)
        if remove:
            bm=bmesh.new();bm.from_mesh(ob.data);bm.verts.ensure_lookup_table();bm.verts.index_update()
            doomed=[face for face in bm.faces if tuple(vertex.index for vertex in face.verts) in remove]
            bmesh.ops.delete(bm,geom=doomed,context='FACES');bm.to_mesh(ob.data);bm.free();ob.data.update()

def descendants(root):
    return [root]+list(root.children_recursive)

def add_studio(kind,spec):
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=int(os.environ.get('TRAFFIC_HEAVY_SAMPLES','24')); scene.cycles.use_denoising=False
    scene.render.resolution_x=1100;scene.render.resolution_y=680;scene.render.resolution_percentage=100
    scene.world.color=(.25,.25,.25);scene.view_settings.view_transform='AgX'
    floor_mat=bpy.data.materials.new('Studio ground');floor_mat.diffuse_color=(.14,.19,.22,1)
    bpy.ops.mesh.primitive_plane_add(size=150,location=(0,0,-.015));floor=bpy.context.object;floor.name='STUDIO floor';floor.data.materials.append(floor_mat)
    for name,pos,energy,size in [('Key',(-7,7,13),2200,9),('Fill',(9,2,8),1700,8),('Rim',(0,-10,10),2400,7)]:
        data=bpy.data.lights.new('STUDIO '+name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        light=bpy.data.objects.new(data.name,data);bpy.context.collection.objects.link(light);light.location=pos;light.rotation_euler=(Vector((0,0,1.5))-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('STUDIO inspection camera');camera=bpy.data.objects.new(data.name,data);bpy.context.collection.objects.link(camera);scene.camera=camera
    distance=spec['length']*(1.9 if kind=='boxtruck' else 1.7); direction=Vector((.82,1.0,.58)).normalized();target=Vector((0,0,spec['height']*.47))
    camera.location=target+direction*distance;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();data.lens=52
    scene.render.filepath=os.path.join(PREVIEW,kind+'-front.png')

def batch_for_export(root):
    # Source has already been saved. Only the in-memory export copy is flattened.
    for ob in descendants(root):
        if ob.type=='MESH':
            bpy.context.view_layer.objects.active=ob
            for modifier in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    batches=defaultdict(list)
    for ob in descendants(root):
        if ob.type=='MESH' and not ob.parent.name.startswith('wheel_'):
            batches[(ob.parent,tuple(ob.data.materials))].append(ob)
    for (parent,mats),objects in batches.items():
        if len(objects)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objects:ob.select_set(True)
        # Prefer the established role name, allowing exact paint/brake matching.
        active=next((ob for ob in objects if ob.name.startswith(('body','lights_red'))),objects[0])
        bpy.context.view_layer.objects.active=active;bpy.ops.object.join()
    # Keep static-batch local axes canonical. A rotated active join object
    # otherwise inflates the runtime's conservative transformed local AABB.
    for ob in descendants(root):
        if ob.type=='MESH' and not ob.parent.name.startswith('wheel_'):
            ob.data.transform(ob.matrix_basis); ob.matrix_basis=Matrix.Identity(4); ob.data.update()
    bpy.ops.object.select_all(action='DESELECT')
    for ob in descendants(root):ob.select_set(True)

source=get_blockouts();report=[]
selected_models=os.environ.get('TRAFFIC_HEAVY_MODELS','boxtruck,semi').split(',')
assert selected_models and all(kind in ['boxtruck','semi'] for kind in selected_models)
for kind in selected_models:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):bpy.data.materials.remove(material)
    materials={m['id']:make_material(m) for m in source['materials']}
    palette={m.get('traffic_role'):m for m in materials.values()}
    spec=source['models'][kind]['spec'];root=import_node(source['models'][kind]['root'],materials)
    smooth_manufactured_shell(root);refine_in_blender(kind,spec,root,palette);refine_freight_wheels(root,spec,palette['wheel_vertex_finish']);refine_visible_cabin(kind,spec,root,palette);split_directional_indicators(spec,root,palette);add_studio(kind,spec)
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True);bpy.context.view_layer.objects.active=root
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,kind+'.blend'))
    if os.environ.get('TRAFFIC_HEAVY_RENDER','1')!='0':bpy.ops.render.render(write_still=True)
    if kind=='semi' and os.environ.get('TRAFFIC_HEAVY_SWEEP_PREVIEW')=='1':
        trailer=next(ob for ob in root.children if ob.name=='trailer')
        camera=bpy.context.scene.camera;target=v((0,1.9,-3.7));camera.location=target+Vector((9,7,8));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=47
        for degrees in [-75,75]:
            trailer.rotation_euler.z=math.radians(degrees);bpy.context.view_layer.update()
            bpy.context.scene.render.filepath=os.path.join(PREVIEW,'semi-clearance-'+str(degrees)+'.png');bpy.ops.render.render(write_still=True)
        trailer.rotation_euler.z=0;bpy.context.view_layer.update()
    if os.environ.get('TRAFFIC_HEAVY_DETAIL_PREVIEW')=='1':
        target_pivot=next(ob for ob in root.children_recursive if ob.name==('wheel_fr' if kind=='boxtruck' else 'wheel_tractor2_r'))
        target=target_pivot.matrix_world.translation.copy(); camera=bpy.context.scene.camera
        camera.location=target+Vector((2.35, .65, .72));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=62
        bpy.context.scene.render.filepath=os.path.join(PREVIEW,kind+'-wheel-detail.png');bpy.ops.render.render(write_still=True)
    if os.environ.get('TRAFFIC_HEAVY_CAB_PREVIEW')=='1':
        front=-spec['length']/2+.09;target=v((0,2.05,front+1.13));camera=bpy.context.scene.camera
        camera.location=target+Vector((3.1,4.0,1.25));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=55
        bpy.context.scene.render.filepath=os.path.join(PREVIEW,kind+'-cabin-detail.png');bpy.ops.render.render(write_still=True)
        target=v((spec['width']/2-.08,2.23,front+.135));camera.location=target+Vector((1.8,-1.9,.45));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=64
        bpy.context.scene.render.filepath=os.path.join(PREVIEW,kind+'-mirror-detail.png');bpy.ops.render.render(write_still=True)
        target=v((-.40,2.20,front+1.18));camera.location=v((.05,2.32,front-2.5));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=60
        bpy.context.scene.render.filepath=os.path.join(PREVIEW,kind+'-driver-detail.png');bpy.ops.render.render(write_still=True)
        target=v((-.13,1.29,front+.92));camera.location=v((.05,2.48,front+(2.48 if kind=='semi' else 2.23)-.25));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=24
        bpy.context.scene.render.filepath=os.path.join(PREVIEW,kind+'-footwell-detail.png');bpy.ops.render.render(write_still=True)
    batch_for_export(root)
    bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS,kind+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    record={'kind':kind,'blend':os.path.relpath(os.path.join(OUT,kind+'.blend'),ROOT),'glb':os.path.relpath(os.path.join(ASSETS,kind+'.glb'),ROOT),'mesh_objects':sum(ob.type=='MESH' for ob in descendants(root)),'wheel_pivots':[ob.name for ob in descendants(root) if ob.name.startswith('wheel_') and ob.type=='EMPTY']}
    report.append(record);print('HEAVY_ASSET_COMPLETE '+json.dumps(record),flush=True)
with open(os.path.join(PREVIEW,'manifest.json'),'w') as f:json.dump({'blender':bpy.app.version_string,'assets':report,'source':'Original procedural blockouts and Blender-authored refinements; no external assets.'},f,indent=2)
