"""Author and export four original traffic vehicles in Blender 4.x.

Run: blender --background --python scripts/create_traffic_passenger.py
Optional: TRAFFIC_KINDS=sedan,suv TRAFFIC_RENDER=1 TRAFFIC_SAMPLES=24

The hand-designed curved shell is imported as an editable mesh base. Blender
authors the manufactured edge treatment, rear valances, pressed sheet metal,
exhausts, antennae, high-roof reinforcing ribs, materials and final normals.
The saved .blend retains those editable named parts and non-destructive bevels;
only the GLB copy batches parts into material groups for the racing renderer.
All geometry and materials are original. No third-party assets are used.
"""
import bpy
import json
import math
import os
import subprocess
from mathutils import Vector, Matrix, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'art', 'traffic')
ASSETS = os.path.join(ROOT, 'public', 'assets', 'traffic')
PREVIEWS = os.path.join(ART, 'previews')
for directory in (ART, ASSETS, PREVIEWS):
    os.makedirs(directory, exist_ok=True)

KINDS = os.environ.get('TRAFFIC_KINDS', 'sedan,hatch,suv,van').split(',')
RENDER = os.environ.get('TRAFFIC_RENDER', '1') != '0'

# Export the authored base with mesh normals and wheel-local coordinate frames.
# Keeping this bridge here makes each .blend reproducible with one command.
BRIDGE = r'''
import * as T from './public/vendor/three.js';
import {buildPassengerVehicle} from './src/traffic-passenger.js';
import {trafficDefinition} from './src/traffic-catalog.js';
import * as K from './src/traffic-model-kit.js';
const keys=['basePaint','trim','glass','chrome','rubber','headlights','plate','baseBrake'];
const materialNames={basePaint:'body',baseBrake:'lights_red',trim:'trim',glass:'glass',chrome:'alloy',rubber:'rubber',headlights:'lights_white',plate:'plate'};
const materials=Object.fromEntries(keys.map(key=>{const m=K[key];return[materialNames[key],{color:m.color.toArray(),metalness:m.metalness,roughness:m.roughness,emissive:m.emissive?.toArray()||[0,0,0],emissiveIntensity:m.emissiveIntensity||0}];}));
const output={materials,vehicles:{}};
for(const kind of process.argv.slice(1)){
 const root=buildPassengerVehicle(kind);root.updateMatrixWorld(true);const meshes=[],wheels={};
 root.traverse(node=>{
  if(node.name.startsWith('wheel_')&&node.isGroup)wheels[node.name]=node.getWorldPosition(new T.Vector3()).toArray();
  if(!node.isMesh)return;
  const mat=keys.find(k=>K[k]===node.material),g=node.geometry.clone().applyMatrix4(node.matrixWorld);
  const position=Array.from(g.attributes.position.array),normal=Array.from(g.attributes.normal.array);
  const index=g.index?Array.from(g.index.array):Array.from({length:position.length/3},(_,i)=>i);
  if(node.matrixWorld.determinant()<0)for(let i=0;i<index.length;i+=3)[index[i+1],index[i+2]]=[index[i+2],index[i+1]];
  meshes.push({material:materialNames[mat],position,normal,index,wheel:node.parent.name.startsWith('wheel_')?node.parent.name:null});
 });
 output.vehicles[kind]={spec:trafficDefinition(kind),meshes,wheels};
}
console.log(JSON.stringify(output));
'''
SOURCE = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', BRIDGE, *KINDS], cwd=ROOT, text=True))

def xyz(p):
    """Game (+Y up, -Z forward) to Blender (+Z up, +Y forward)."""
    return Vector((p[0], -p[2], p[1]))

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)

def make_material(name, settings):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    color = settings['color']
    material.diffuse_color = (*color, 1)
    material.use_backface_culling = name != 'glass'
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = settings.get('metalness', 0)
    shader.inputs['Roughness'].default_value = settings.get('roughness', .5)
    shader.inputs['Emission Color'].default_value = (*settings.get('emissive', [0, 0, 0]), 1)
    shader.inputs['Emission Strength'].default_value = settings.get('emissiveIntensity', 0)
    if name == 'body':
        shader.inputs['Coat Weight'].default_value = .36
        shader.inputs['Coat Roughness'].default_value = .20
    if name == 'glass':
        # Ordinary alpha glazing is inexpensive on mobile. No transmission,
        # refraction buffer, screen-space copy or opaque blue window proxy.
        shader.inputs['Base Color'].default_value = (.47,.65,.72,.20)
        shader.inputs['Alpha'].default_value = .20
        shader.inputs['Metallic'].default_value = .06
        shader.inputs['Roughness'].default_value = .12
        shader.inputs['Coat Weight'].default_value = .25
        shader.inputs['Specular IOR Level'].default_value = .35
        material.diffuse_color = (.47,.65,.72,.20)
        material.surface_render_method = 'DITHERED'
    return material

def model_mesh(name, vertices, faces, material, parent=None, bevel=0, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(p) for p in vertices], [], faces)
    data.materials.append(MATERIALS[material])
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent or ROOT_OBJECT
    obj['material_group'] = material
    obj['authored_in'] = 'Blender'
    for face in data.polygons:
        face.use_smooth = smooth
    if bevel:
        bevel_mod = obj.modifiers.new('Manufactured corner radius', 'BEVEL')
        bevel_mod.width = bevel
        bevel_mod.segments = 2
        bevel_mod.affect = 'EDGES'
        bevel_mod.limit_method = 'ANGLE'
        bevel_mod.angle_limit = math.radians(34)
        bevel_mod.harden_normals = True
        normal_mod = obj.modifiers.new('Weighted panel normals', 'WEIGHTED_NORMAL')
        normal_mod.keep_sharp = True
        normal_mod.weight = 45
    return obj

def beveled_box(name, center, dimensions, material, bevel=.008):
    x,y,z = center
    a,b,c = (d*.5 for d in dimensions)
    vertices = [(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
                (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)]
    return model_mesh(name, vertices, [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)], material, bevel=bevel)

def transverse_pressing(name, width, center_y, center_z, depth, height, material='body'):
    """Swept six-sided lip: curved width and rounded folded sheet-metal edges."""
    vertices = []
    profile = [(-.50,-.20),(-.35,.42),(.05,.50),(.50,.12),(.40,-.38),(-.30,-.50)]
    for i in range(13):
        x = width*(i/12-.5)
        crown = (1-(2*x/width)**2)*.018
        for py,pz in profile:
            vertices.append((x,center_y+height*py+crown,center_z+depth*pz-.04*(2*x/width)**2))
    faces = []
    for i in range(12):
        for j in range(6):
            faces.append((i*6+j,i*6+(j+1)%6,(i+1)*6+(j+1)%6,(i+1)*6+j))
    faces += [tuple(reversed(range(6))),tuple(12*6+j for j in range(6))]
    return model_mesh(name,vertices,faces,material,bevel=.003,smooth=True)

def pipe(name, center, radius, depth, material='alloy', inside=True):
    """Exhaust/recess with actual annular wall, not a capped cylinder."""
    x,y,z=center
    vertices=[]
    for zz,r in [(z-depth*.5,radius),(z+depth*.5,radius),(z+depth*.5,radius*.73),(z-depth*.5,radius*.73)]:
        for i in range(12):
            a=i*math.tau/12
            vertices.append((x+math.cos(a)*r,y+math.sin(a)*r,zz))
    faces=[]
    for row in range(3):
        for i in range(12):
            j=(i+1)%12
            faces.append((row*12+i,row*12+j,(row+1)*12+j,(row+1)*12+i))
    ob=model_mesh(name,vertices,faces,material,smooth=True)
    if inside:
        disk=[(x+math.cos(i*math.tau/12)*radius*.73,y+math.sin(i*math.tau/12)*radius*.73,z-depth*.46) for i in range(12)]
        model_mesh(name+'_dark_cavity',disk,[tuple(range(12))],'trim')
    return ob

def shark_fin(kind, height):
    z=.55 if kind=='sedan' else .87
    vertices=[(-.035,height-.032,z-.13),(.035,height-.032,z-.13),(.035,height-.032,z+.12),(-.035,height-.032,z+.12),
              (-.010,height+.045,z+.065),(.010,height+.045,z+.065)]
    obj=model_mesh('Roof radio shark fin',vertices,[(0,1,2,3),(0,4,5,1),(1,5,2),(2,5,4,3),(3,4,0)],'trim',bevel=.004)
    # Preserve the catalog maximum height, including the antenna.
    obj.location.z=-.052

def refine_sedan(spec):
    l=spec['length']*.5
    transverse_pressing('Folded trunk-deck lip',1.27,.935,l-.25,.095,.028)
    transverse_pressing('Sculpted lower rear valance',1.35,.365,l-.077,.10,.11,'trim')
    for side in [-1,1]:
        pipe('Inset exhaust outlet '+str(side),(side*.58,.327,l-.08),.043,.12)
    shark_fin('sedan',spec['height'])

def refine_hatch(spec):
    l=spec['length']*.5
    transverse_pressing('Hatchgate stamped lifting lip',.83,.88,l-.095,.08,.032)
    transverse_pressing('Compact lower diffuser',1.18,.36,l-.085,.095,.10,'trim')
    for x in [-.41,0,.41]:
        beveled_box('Diffuser molded rib',(x,.335,l-.105),(.026,.045,.12),'trim',.005)
    shark_fin('hatch',spec['height'])

def refine_suv(spec):
    l=spec['length']*.5
    transverse_pressing('Pressed rear skid-plate edge',1.02,.435,l-.075,.10,.11,'alloy')
    for x in [-.34,-.17,0,.17,.34]:
        beveled_box('Skid plate reinforcing flute',(x,.431,l-.045),(.036,.085,.018),'trim',.006)
    for side in [-1,1]:
        beveled_box('Roof rail aerodynamic foot',(side*.64,1.775,-.41),(.095,.052,.19),'trim',.012)
        beveled_box('Roof rail aerodynamic foot',(side*.64,1.775,1.33),(.095,.052,.19),'trim',.012)
    shark_fin('suv',1.79)

def refine_van(spec):
    l=spec['length']*.5
    transverse_pressing('Wide rear loading step',1.53,.417,l-.10,.17,.09,'trim')
    for x in [-.54,-.27,0,.27,.54]:
        beveled_box('Rear step anti-slip ridge',(x,.466,l-.10),(.15,.009,.075),'trim',.003)
    for x in [-.53,0,.53]:
        # Stamped roof channels are raised six millimeters and tapered at ends.
        vertices=[(x-.028,2.546,-.90),(x+.028,2.546,-.90),(x+.025,2.546,2.23),(x-.025,2.546,2.23),
                  (x-.015,2.556,-.77),(x+.015,2.556,-.77),(x+.015,2.556,2.08),(x-.015,2.556,2.08)]
        model_mesh('Pressed high-roof reinforcing channel',vertices,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],'body',bevel=.004,smooth=True)
    for side in [-1,1]:
        beveled_box('Rear cargo door recessed handle',(side*.11,1.055,l-.014),(.055,.12,.020),'trim',.012)
        for y in [.69,1.90]:
            beveled_box('Cargo door exposed hinge',(side*.84,y,l-.017),(.067,.07,.024),'alloy',.007)

CABINS={
    'sedan':dict(width=1.64,body=1.78,front=-1.13,rear=1.43,belt=.92,floor=.43,seat=.65,seat_z=-.02,rear_z=.66,back=1.04,head=1.23),
    'hatch':dict(width=1.60,body=1.70,front=-.98,rear=1.86,belt=.95,floor=.45,seat=.67,seat_z=.06,rear_z=1.08,back=1.08,head=1.27),
    'suv':dict(width=1.79,body=1.88,front=-1.14,rear=2.22,belt=1.105,floor=.55,seat=.82,seat_z=.04,rear_z=1.24,back=1.36,head=1.57),
    'van':dict(width=1.98,body=2.01,front=-2.10,rear=-.30,belt=1.19,floor=.62,seat=.92,seat_z=-1.05,rear_z=0,back=1.57,head=1.82),
}

def cabin_tint(obj,color):
    attribute=obj.data.color_attributes.new(name='CabinColor',type='FLOAT_COLOR',domain='CORNER')
    for item in attribute.data: item.color=(*color,1)
    obj.data.color_attributes.active_color=attribute
    obj['component_role']='visible_cabin_interior'
    return obj

def cabin_box(name,center,dimensions,color,bevel=.025):
    return cabin_tint(beveled_box(name,center,dimensions,'cabin_interior',bevel),color)

def cabin_ring(name,center,radius,tube,normal,color,segments=24):
    n=Vector(normal).normalized();u=Vector((1,0,0));v=n.cross(u).normalized();c=Vector(center)
    verts=[]
    for i in range(segments):
        r=u*math.cos(i*math.tau/segments)+v*math.sin(i*math.tau/segments)
        for j in range(6):
            verts.append(tuple(c+r*(radius+tube*math.cos(j*math.tau/6))+n*tube*math.sin(j*math.tau/6)))
    faces=[]
    for i in range(segments):
        for j in range(6):
            a=i*6+j;b=((i+1)%segments)*6+j
            faces.append((a,b,((i+1)%segments)*6+(j+1)%6,i*6+(j+1)%6))
    return cabin_tint(model_mesh(name,verts,faces,'cabin_interior',smooth=True),color)

def author_cabin_enclosure(kind,spec):
    """A closed passenger cell, with actual wheel-house domes below the glass."""
    p=CABINS[kind];floor=p['floor'];front=p['front']+.06;rear=p['rear']-.025
    radius=spec['wheelRadius']+.047;cy=spec['wheelRadius']+.015
    axles=sorted(set(value[2] for value in SOURCE['vehicles'][kind]['wheels'].values()))
    wheel_x=abs(SOURCE['vehicles'][kind]['wheels']['wheel_fr'][0])
    inner=wheel_x-WHEEL_WIDTHS[kind]*.60-.022;outer=p['body']*.5-.025
    start=math.asin(max(-.95,min(.95,(floor-cy)/radius)));extent=radius*math.cos(start)
    cuts=sorted(set([front,rear]+[max(front,min(rear,z+sign*extent)) for z in axles for sign in [-1,1]]))
    for index,(z0,z1) in enumerate(zip(cuts,cuts[1:])):
        mid=(z0+z1)*.5
        half_width=inner+.009 if any(abs(mid-z)<extent for z in axles) else p['width']*.46
        cabin_box('Notched carpet floor section '+str(index),(0,floor-.028,mid),(half_width*2,.065,z1-z0+.008),(.028,.034,.041),.003)
    cabin_box('Sealed forward footwell firewall',(0,(floor+p['belt'])*.5,p['front']+.105),(p['width']*.91,p['belt']-floor+.10,.055),(.040,.048,.058),.012)
    cabin_box('Rear cabin floor closure',(0,(floor+p['belt'])*.5,rear-.015),(p['width']*.91,p['belt']-floor+.10,.055),(.040,.048,.058),.012)
    for side in [-1,1]:
        for axle_index,z in enumerate(axles):
            # A real inward cap and a curved outer wall leave the tire cavity
            # open toward the road while closing it toward occupants.
            angles=[start+(math.pi-2*start)*i/20 for i in range(21)]
            vertices=[(side*x,cy+math.sin(a)*radius,z+math.cos(a)*radius) for x in [inner,outer] for a in angles]
            n=len(angles);faces=[(i,n+i,n+i+1,i+1) for i in range(n-1)]+[tuple(range(n))]
            if side<0:faces=[tuple(reversed(face)) for face in faces]
            cabin_tint(model_mesh('Inner wheel-house tub '+str(side)+' '+str(axle_index),vertices,faces,'cabin_interior',smooth=True),(.035,.043,.052))
        cabin_box('Lower sill inner seal '+str(side),(side*p['width']*.449,floor+.08,(front+rear)*.5),(.09,.19,rear-front),(.04,.048,.058),.012)

GAME_TO_BLENDER=Matrix(((1,0,0),(0,0,-1),(0,1,0)))

def rig_empty(name,position=(0,0,0),parent=None,rotation=None):
    ob=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(ob)
    ob.parent=parent or ROOT_OBJECT;ob.location=xyz(position)
    ob.empty_display_type='PLAIN_AXES';ob.empty_display_size=.065
    if rotation is not None:
        ob.rotation_mode='QUATERNION'
        ob.rotation_quaternion=(GAME_TO_BLENDER@rotation.to_matrix()@GAME_TO_BLENDER.transposed()).to_quaternion()
    ob['rig_contract']='Original seated driver; runtime steering and two-bone IK; no baked animation'
    return ob

def driver_ellipsoid(name,center,size,color,parent=None,segments=12,rings=8,theta_max=math.pi):
    cx,cy,cz=center;sx,sy,sz=size;vertices=[]
    for j in range(rings+1):
        theta=theta_max*j/rings
        for i in range(segments):
            a=math.tau*i/segments
            vertices.append((cx+sx*math.sin(theta)*math.cos(a),cy+sy*math.cos(theta),cz+sz*math.sin(theta)*math.sin(a)))
    faces=[]
    for j in range(rings):
        for i in range(segments):
            k=(i+1)%segments;faces.append((j*segments+i,(j+1)*segments+i,(j+1)*segments+k,j*segments+k))
    return cabin_tint(model_mesh(name,vertices,[tuple(reversed(face)) for face in faces],'cabin_interior',parent=parent,smooth=True),color)

def driver_segment(name,start,end,radius_start,radius_end,color,parent=None):
    start=Vector(start);end=Vector(end);axis=(end-start).normalized()
    u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();v=axis.cross(u).normalized();verts=[]
    for t,r in [(0,radius_start*.80),(.12,radius_start),(.83,radius_end),(1,radius_end*.78)]:
        center=start.lerp(end,t)
        for i in range(10):
            a=math.tau*i/10;verts.append(tuple(center+u*math.cos(a)*r+v*math.sin(a)*r))
    faces=[]
    for j in range(3):
        for i in range(10):
            k=(i+1)%10;faces.append((j*10+i,j*10+k,(j+1)*10+k,(j+1)*10+i))
    faces += [tuple(reversed(range(10))),tuple(30+i for i in range(10))]
    return cabin_tint(model_mesh(name,verts,faces,'cabin_interior',parent=parent,smooth=True),color)

def driver_loft(name,sections,color,parent=None,segments=16):
    """Tailored/anatomical horizontal sections: (y, width, front, back, z)."""
    verts=[]
    for y,width,front,back,z in sections:
        for i in range(segments):
            a=math.tau*i/segments;s=math.sin(a)
            # Flatter anterior planes retain jaw, cheek and chest structure.
            depth=front*(-s)**.55 if s<0 else -back*s
            verts.append((math.cos(a)*width,y,z-depth))
    faces=[]
    for j in range(len(sections)-1):
        for i in range(segments):
            k=(i+1)%segments;faces.append((j*segments+i,(j+1)*segments+i,(j+1)*segments+k,j*segments+k))
    faces += [tuple(range(segments)),tuple(reversed([(len(sections)-1)*segments+i for i in range(segments)]))]
    return cabin_tint(model_mesh(name,verts,faces,'cabin_interior',parent=parent,smooth=True),color)

def driver_curve(name,points,radii,color,parent=None,sides=6):
    """Swept rounded anatomical detail, with a radius at each authored point."""
    verts=[]
    for index,point in enumerate(points):
        center=Vector(point);axis=(Vector(points[min(index+1,len(points)-1)])-Vector(points[max(0,index-1)])).normalized()
        u=axis.cross(Vector((0,0,1)))
        if u.length<.01:u=axis.cross(Vector((1,0,0)))
        u.normalize();v=axis.cross(u).normalized()
        for i in range(sides):
            a=i*math.tau/sides;verts.append(tuple(center+(u*math.cos(a)+v*math.sin(a))*radii[index]))
    faces=[]
    for j in range(len(points)-1):
        for i in range(sides):
            k=(i+1)%sides;faces.append((j*sides+i,j*sides+k,(j+1)*sides+k,(j+1)*sides+i))
    faces += [tuple(reversed(range(sides))),tuple((len(points)-1)*sides+i for i in range(sides))]
    return cabin_tint(model_mesh(name,verts,faces,'cabin_interior',parent=parent,smooth=True),color)

def author_driver_head(position,head_offset,skin,hair):
    """One mobile draw group, sculpted profile and separate editable facial parts."""
    head=rig_empty('driver_head',position)
    head['rotation_axis']='local +Y';head['recommended_yaw_limit']=.35
    head['pivot_definition']='Neck joint; +Y up, -Z forward; restrained mirror check only'
    hy,hz=head_offset
    profile=[(-.110,.020,.048,.035),(-.099,.043,.070,.047),(-.078,.059,.074,.061),
             (-.052,.072,.077,.074),(-.022,.080,.080,.084),(.005,.082,.083,.089),
             (.026,.078,.081,.091),(.054,.078,.078,.092),(.081,.069,.069,.085),
             (.105,.049,.046,.060),(.118,.014,.014,.025)]
    face=driver_loft('Driver sculpted jaw cheeks and forehead',[(hy+y,w,f,b,hz) for y,w,f,b in profile],skin,parent=head,segments=20)
    # Low-contrast vertex tones clarify the temples/jaw without image textures.
    colors=face.data.color_attributes['CabinColor'].data
    for loop in face.data.loops:
        vertex=face.data.vertices[loop.vertex_index].co;local_y=vertex.z-hy
        tone=.91 if local_y<-.06 else 1.025 if -.04<local_y<.04 else .98
        colors[loop.index].color=(*(min(1,v*tone) for v in skin),1)
    # Hair follows the skull and has a lower nape, temples and natural forehead line.
    def skull(y):
        for a,b in zip(profile,profile[1:]):
            if a[0]<=y<=b[0]:
                t=(y-a[0])/(b[0]-a[0]);return tuple(a[k]+(b[k]-a[k])*t for k in range(1,4))
        return profile[-1][1:]
    verts=[];n=24
    for j in range(7):
        t=j/6
        for i in range(n):
            a=math.tau*i/n;s=math.sin(a)
            boundary=.025+(-s)*(.039 if s<0 else .050)
            y=boundary+(.119-boundary)*t;w,f,b=skull(min(.118,y));scale=1.025
            depth=f*(-s)**.55 if s<0 else -b*s
            verts.append((math.cos(a)*w*scale,hy+y+.002,hz-depth*scale))
    faces=[]
    for j in range(6):
        for i in range(n):
            k=(i+1)%n;faces.append((j*n+i,(j+1)*n+i,(j+1)*n+k,j*n+k))
    faces.append(tuple(reversed([6*n+i for i in range(n)])))
    cabin_tint(model_mesh('Driver fitted short hairline',verts,faces,'cabin_interior',parent=head,smooth=True),hair)
    for side in [-1,1]:
        driver_ellipsoid('Driver ear helix '+str(side),(side*.081,hy-.011,hz+.003),(.016,.028,.019),skin,parent=head,segments=10,rings=6)
        driver_ellipsoid('Driver ear concha '+str(side),(side*.093,hy-.010,hz-.003),(.004,.015,.010),tuple(v*.69 for v in skin),parent=head,segments=8,rings=5)
        ex=side*.031
        driver_ellipsoid('Driver almond eye '+str(side),(ex,hy+.020,hz-.083),(.014,.0057,.0038),(.62,.60,.54),parent=head,segments=10,rings=5)
        driver_ellipsoid('Driver iris '+str(side),(ex,hy+.020,hz-.0865),(.0048,.0048,.0018),(.048,.061,.061),parent=head,segments=8,rings=4)
        driver_ellipsoid('Driver pupil '+str(side),(ex,hy+.020,hz-.088),(.0024,.0030,.001),(.012,.016,.019),parent=head,segments=8,rings=4)
        driver_curve('Driver upper eyelid '+str(side),[(ex-.014,hy+.020,hz-.0835),(ex-.006,hy+.026,hz-.085),(ex+.007,hy+.025,hz-.085),(ex+.014,hy+.020,hz-.0835)],[.0023,.0027,.0027,.0018],tuple(v*.83 for v in skin),parent=head)
        driver_curve('Driver eyebrow '+str(side),[(ex-.015,hy+.035,hz-.080),(ex-.005,hy+.039,hz-.082),(ex+.009,hy+.038,hz-.081),(ex+.016,hy+.034,hz-.079)],[.0018,.0031,.0028,.0011],hair,parent=head)
    # Continuous bridge, tip and alar wings instead of a sphere stuck on the face.
    verts=[(-.010,hy+.031,hz-.079),(.010,hy+.031,hz-.079),(-.008,hy+.010,hz-.094),(.008,hy+.010,hz-.094),
           (-.011,hy-.018,hz-.111),(.011,hy-.018,hz-.111),(-.018,hy-.026,hz-.085),(.018,hy-.026,hz-.085),(0,hy-.033,hz-.094)]
    faces=[(0,2,3,1),(2,4,5,3),(4,8,5),(0,6,4,2),(1,3,5,7),(6,8,4),(7,5,8),(6,7,8)]
    cabin_tint(model_mesh('Driver nose bridge and alar wings',verts,[tuple(reversed(face)) for face in faces],'cabin_interior',parent=head,smooth=True),skin)
    for side in [-1,1]:
        driver_ellipsoid('Driver nostril '+str(side),(side*.010,hy-.028,hz-.094),(.0035,.0019,.0023),tuple(v*.43 for v in skin),parent=head,segments=8,rings=4)
    driver_curve('Driver closed mouth', [(-.021,hy-.058,hz-.074),(0,hy-.060,hz-.079),(.021,hy-.058,hz-.074)],[.0013,.0016,.0013],(.18,.085,.058),parent=head)
    driver_curve('Driver lower lip', [(-.015,hy-.062,hz-.076),(0,hy-.064,hz-.079),(.015,hy-.062,hz-.076)],[.0017,.0023,.0017],(.36,.18,.12),parent=head)
    return head

def author_driver_hand(parent,side,label,skin,hand_to_wheel):
    """Palm and four curled fingers wrap the existing rim; its grip stays exact."""
    before=set(bpy.context.scene.objects)
    palm=driver_loft('Driver shaped palm '+label,[(-.031,.011,.009,.010,.021),(-.021,.018,.011,.013,.021),
        (.013,.019,.012,.013,.021),(.031,.013,.009,.010,.021)],skin,parent=parent,segments=12)
    for v in palm.data.vertices:v.co.x+=.025
    for finger in range(4):
        along=(finger-1.5)*.015;radius=.0073 if finger<3 else .0067
        points=[]
        for j in range(8):
            a=.72-(3.80 if finger<3 else 3.60)*j/7
            points.append((.005+.029*math.cos(a),along,-.012+.029*math.sin(a)))
        driver_curve('Driver curled finger '+label+' '+str(finger),points,[radius*(1-.18*j/7) for j in range(8)],skin,parent=parent,sides=6)
        # A shallow knuckle crease remains part of the same shared-color mesh.
        driver_curve('Driver finger crease '+label+' '+str(finger),[(.025,along-.004,-.032),(.025,along+.004,-.032)],[.0008,.0008],tuple(v*.80 for v in skin),parent=parent,sides=4)
    thumb_side=-1 if side<0 else 1
    driver_curve('Driver articulated thumb '+label,[(.011,thumb_side*.028,.019),(-.007,thumb_side*.025,.021),(-.018,thumb_side*.010,.013),(-.016,thumb_side*.001,.006)],[.012,.011,.009,.0075],skin,parent=parent,sides=8)
    radial=Vector((side*.132,.047,0)).normalized();tangent=Vector((-radial.y,radial.x,0))
    basis=Matrix((radial,tangent,Vector((0,0,1)))).transposed()
    transform=GAME_TO_BLENDER@hand_to_wheel.to_matrix()@basis@GAME_TO_BLENDER.transposed()
    for ob in set(bpy.context.scene.objects)-before:
        if ob.type=='MESH':ob.data.transform(transform.to_4x4())

def author_driver(kind):
    p=CABINS[kind];seat=p['seat'];z=p['seat_z'];x=-.45 if kind=='van' else -p['width']*.235
    head_y=seat+({'sedan':.59,'hatch':.59,'suv':.65,'van':.69}[kind]);shoulder_y=head_y-.17
    jacket={'sedan':(.030,.065,.10),'hatch':(.08,.045,.055),'suv':(.055,.075,.055),'van':(.025,.065,.10)}[kind]
    trousers=(.035,.044,.054);skin=(.38,.235,.15);hair=(.025,.018,.015);shoe=(.018,.023,.029)
    pelvis_y=seat+.12;torso_z=z+.055
    cabin_box('Driver seated pelvis',(x,pelvis_y,z-.005),(.27,.17,.22),trousers,.045)
    # Seated jacket has a waist, abdominal fold, chest, shoulder slope and neck.
    torso=driver_loft('Driver tailored jacket torso',[(pelvis_y-.01,.113,.097,.091,-.025),
        (pelvis_y+.05,.124,.110,.098,-.012),(pelvis_y+.09,.132,.105,.101,0),
        (shoulder_y-.105,.151,.107,.104,.008),(shoulder_y-.045,.159,.107,.098,.012),
        (shoulder_y+.004,.150,.087,.086,.014),(shoulder_y+.035,.090,.061,.068,.008),
        (shoulder_y+.043,.045,.042,.047,0)],jacket)
    torso.location=xyz((x,0,torso_z))
    shirt=tuple(min(1,v*1.70+.025) for v in jacket)
    cabin_tint(model_mesh('Driver visible shirt neckline',[(x-.043,shoulder_y+.030,torso_z-.049),(x+.043,shoulder_y+.030,torso_z-.049),
        (x+.020,shoulder_y-.073,torso_z-.108),(x-.020,shoulder_y-.073,torso_z-.108)],[(0,1,2,3)],'cabin_interior',bevel=.002),shirt)
    for side in [-1,1]:
        cabin_tint(model_mesh('Driver folded collar '+str(side),[(x+side*.036,shoulder_y+.037,torso_z-.045),
            (x+side*.082,shoulder_y+.014,torso_z-.071),(x+side*.044,shoulder_y-.067,torso_z-.113),
            (x+side*.019,shoulder_y-.024,torso_z-.095)],[(0,1,2,3) if side>0 else (3,2,1,0)],'cabin_interior',bevel=.003),tuple(v*1.16 for v in jacket))
    driver_curve('Driver jacket central seam',[(x,pelvis_y+.07,torso_z-.119),(x,shoulder_y-.12,torso_z-.108),(x,shoulder_y-.073,torso_z-.110)],
        [.002,.002,.002],tuple(v*.55 for v in jacket))
    for side in [-1,1]:
        driver_curve('Driver jacket waist fold '+str(side),[(x+side*.018,pelvis_y+.08,torso_z-.113),(x+side*.065,pelvis_y+.065,torso_z-.107),(x+side*.104,pelvis_y+.08,torso_z-.089)],
            [.0015,.0025,.0012],tuple(v*.76 for v in jacket))
    driver_segment('Driver neck',(x,shoulder_y+.025,torso_z),(x,head_y-.081,torso_z-.003),.037,.035,skin)
    neck_y=shoulder_y+.045
    author_driver_head((x,neck_y,torso_z),(head_y-neck_y,-.017),skin,hair)
    for side in [-1,1]:
        knee=(x+side*.082,seat+.025,z-.28);hip=(x+side*.083,pelvis_y,z-.03);ankle=(x+side*.082,p['floor']+.095,z-.43)
        driver_segment('Driver trouser thigh '+str(side),hip,knee,.070,.060,trousers)
        driver_segment('Driver trouser shin '+str(side),knee,ankle,.057,.042,trousers)
        driver_ellipsoid('Driver folded trouser knee '+str(side),knee,(.057,.052,.057),trousers,segments=10,rings=6)
        cabin_box('Driver shoe '+str(side),(ankle[0],p['floor']+.058,ankle[2]-.035),(.10,.085,.18),shoe,.026)
        cabin_box('Driver shoe welt '+str(side),(ankle[0],p['floor']+.024,ankle[2]-.041),(.103,.018,.183),(.030,.034,.038),.009)
    # A visible restraint runs from the outer shoulder to the inner hip.
    driver_segment('Driver diagonal seat belt',(x-.145,shoulder_y+.018,torso_z-.105),(x+.11,pelvis_y-.015,torso_z-.132),.018,.018,(.012,.016,.021))
    driver_segment('Driver lap seat belt',(x-.125,pelvis_y+.035,torso_z-.128),(x+.125,pelvis_y+.035,torso_z-.128),.018,.018,(.012,.016,.021))

    steering=Vector((-p['width']*.245,p['belt']+.04,p['front']+.72))
    steering_rotation=Quaternion((1,0,0),-math.asin(.34))
    wheel=rig_empty('steering_wheel',steering,rotation=steering_rotation)
    wheel['rotation_axis']='local +Z';wheel['grip_radius']=.145
    rim=cabin_ring('Animated steering leather rim',(0,0,0),.145,.019,(0,0,1),(.022,.029,.038));rim.parent=wheel
    hub=cabin_box('Animated steering center',(0,0,0),(.11,.085,.055),(.07,.085,.10),.018);hub.parent=wheel
    for side in [-1,1]:
        spoke=cabin_box('Animated steering spoke '+str(side),(side*.084,-.012,0),(.092,.025,.023),(.20,.23,.26),.005);spoke.parent=wheel
    stalk_point=steering+steering_rotation@Vector((-.205,-.020,.040))
    rig_empty('indicator_stalk',stalk_point,rotation=steering_rotation)
    driver_segment('Static indicator column lever',steering+steering_rotation@Vector((-.065,-.026,-.038)),stalk_point,.010,.014,(.032,.042,.052))
    for side,label in [(-1,'l'),(1,'r')]:
        grip=Vector((side*.132,.047,.012));rig_empty('grip_'+label,grip,parent=wheel)
        hand_target=steering+steering_rotation@grip
        shoulder=Vector((x+side*.15,shoulder_y,torso_z+.004))
        upper_length={'sedan':.270,'hatch':.245,'suv':.300,'van':.275}[kind]
        fore_length={'sedan':.280,'hatch':.250,'suv':.305,'van':.280}[kind]
        delta=hand_target-shoulder;distance=delta.length;direction=delta.normalized()
        along=(upper_length**2-fore_length**2+distance**2)/(2*distance)
        bend=Vector((side*.45,-1,.16));bend=(bend-direction*bend.dot(direction)).normalized()
        elbow_world=shoulder+direction*along+bend*math.sqrt(max(0,upper_length**2-along**2))
        upper_direction=(elbow_world-shoulder).normalized()
        upper_rotation=Vector((0,1,0)).rotation_difference(upper_direction)
        shoulder_ob=rig_empty('driver_shoulder_'+label,shoulder,rotation=upper_rotation)
        shoulder_ob['upper_length']=upper_length;shoulder_ob['forearm_length']=fore_length
        driver_loft('Driver tailored upper sleeve '+label,[(-.025,.037,.039,.039,0),(.008,.059,.052,.052,0),
            (upper_length*.23,.056,.052,.050,0),(upper_length*.62,.049,.046,.047,0),
            (upper_length*.84,.047,.043,.042,0),(upper_length+.012,.041,.039,.039,0)],jacket,parent=shoulder_ob,segments=12)
        fore_direction=upper_rotation.inverted()@(hand_target-elbow_world).normalized()
        elbow_rotation=Vector((0,1,0)).rotation_difference(fore_direction)
        elbow_ob=rig_empty('driver_elbow_'+label,(0,upper_length,0),parent=shoulder_ob,rotation=elbow_rotation)
        driver_loft('Driver tailored forearm sleeve '+label,[(-.012,.036,.035,.036,0),(.014,.047,.044,.043,0),
            (fore_length*.27,.045,.041,.041,0),(fore_length*.65,.036,.035,.034,0),
            (fore_length*.84,.034,.032,.032,0),(fore_length-.014,.029,.028,.027,0)],jacket,parent=elbow_ob,segments=12)
        driver_loft('Driver ribbed sleeve cuff '+label,[(fore_length-.040,.033,.032,.032,0),
            (fore_length-.032,.034,.033,.033,0),(fore_length-.011,.031,.030,.030,0)],tuple(v*.70 for v in jacket),parent=elbow_ob,segments=12)
        driver_curve('Driver elbow fabric fold '+label,[(-.031,.038,-.030),(0,.047,-.043),(.032,.039,-.030)],
            [.0015,.0025,.0015],tuple(v*1.18 for v in jacket),parent=elbow_ob)
        hand_ob=rig_empty('driver_hand_'+label,(0,fore_length,0),parent=elbow_ob)
        hand_ob['pivot_definition']='Palm grip center, coincident with grip_'+label
        hand_to_wheel=(upper_rotation@elbow_rotation).inverted()@steering_rotation
        author_driver_hand(hand_ob,side,label,skin,hand_to_wheel)

def author_cabin(kind,spec):
    p=CABINS[kind];w=p['width'];front=p['front'];rear=p['rear'];floor=p['floor'];belt=p['belt']
    MATERIALS['cabin_interior']=make_material('cabin_interior',{'color':[1,1,1],'roughness':.78})
    mat=MATERIALS['cabin_interior'];nodes=mat.node_tree.nodes
    vertex=nodes.new('ShaderNodeVertexColor');vertex.layer_name='CabinColor'
    mat.node_tree.links.new(vertex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    charcoal=(.035,.043,.052);inset=(.10,.13,.15);seam=(.22,.25,.27)
    upholstery={'sedan':(.18,.095,.043),'hatch':(.065,.155,.18),'suv':(.16,.085,.038),'van':(.085,.12,.145)}[kind]
    insert=tuple(v*.72 for v in upholstery)
    # An outside-only shell has no visible underside. Copy only its opaque
    # upper-cabin faces inward, reverse winding and retain the real apertures.
    # This is a fitted headliner/pillar lining, never a glass-closing flat lid.
    verts=[];normals=[];faces=[];mapping={}
    for mesh in SOURCE['vehicles'][kind]['meshes']:
        if mesh['material']!='body' or mesh['wheel']:continue
        pos=mesh['position'];normal=mesh['normal'];idx=mesh['index'];mapping={}
        for j in range(0,len(idx),3):
            tri=idx[j:j+3]
            points=[pos[v*3:v*3+3] for v in tri]
            if not all(point[1]>belt+.055 and p['front']+.03<point[2]<({'van':2.70}.get(kind,p['rear']-.03)) for point in points):continue
            face=[]
            for v in tri:
                if v not in mapping:
                    n=normal[v*3:v*3+3];point=pos[v*3:v*3+3]
                    mapping[v]=len(verts);verts.append(tuple(point[k]-n[k]*.014 for k in range(3)));normals.append(tuple(-value for value in n))
                face.append(mapping[v])
            faces.append(tuple(reversed(face)))
    liner=cabin_tint(model_mesh('Fitted roof headliner and inner pillars',verts,faces,'cabin_interior',smooth=True),(.065,.075,.085))
    liner.data.normals_split_custom_set_from_vertices([xyz(n) for n in normals])
    author_cabin_enclosure(kind,spec)
    cabin_box('Dashboard sculpted upper pad',(0,belt-.025,front+.25),(w*.91,.16,.40),charcoal,.045)
    cabin_box('Dashboard lower instrument fascia',(0,belt-.11,front+.43),(w*.85,.24,.12),inset,.025)
    cabin_box('Instrument binnacle',(-w*.245,belt+.062,front+.32),(.35,.095,.18),charcoal,.035)
    # Visible rear-facing instrument and center display surfaces, not text.
    cabin_box('Instrument inset',(-w*.245,belt+.052,front+.416),(.27,.054,.008),(.055,.14,.18),.006)
    cabin_box('Center display',(0,belt-.005,front+.499),(.18,.10,.012),(.035,.13,.17),.008)
    for side in [-1,1]:
        cabin_box('Dash ventilation '+str(side),(side*w*.36,belt-.011,front+.454),(.13,.047,.015),(.013,.018,.023),.006)
        cabin_box('Inner door panel '+str(side),(side*w*.453,(belt+floor)*.5,(front+rear)*.5),(.068,belt-floor+.05,rear-front-.10),inset,.024)
        cabin_box('Door arm rest '+str(side),(side*w*.423,belt-.18,p['seat_z']-.03),(.09,.06,.42),upholstery,.025)
        cabin_box('Inner door pull '+str(side),(side*w*.419,belt-.11,p['seat_z']-.13),(.019,.035,.12),(.30,.32,.34),.006)
    def seat(x,z,width,index):
        sy=p['seat'];top=p['back']
        cabin_box('Seat '+index+' cushion',(x,sy,z),(width,.145,.46),upholstery,.055)
        cabin_box('Seat '+index+' upholstery insert',(x,sy+.078,z-.015),(width*.66,.014,.32),insert,.006)
        # The backrest reclines toward the rear. Vertices stay inside the roof.
        y0=sy+.04;y1=top;zb=z+.16;zt=z+.26;a=width*.5
        verts=[(x-a,y0,zb-.055),(x+a,y0,zb-.055),(x+a,y1,zt-.055),(x-a,y1,zt-.055),
               (x-a,y0,zb+.065),(x+a,y0,zb+.065),(x+a,y1,zt+.065),(x-a,y1,zt+.065)]
        ob=model_mesh('Seat '+index+' reclining backrest',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],'cabin_interior',bevel=.035)
        cabin_tint(ob,upholstery)
        cabin_box('Seat '+index+' back insert',(x,(y0+y1)*.5,zt-.078),(width*.61,(y1-y0)*.70,.015),insert,.006)
        for offset in [-.065,.065]:
            cabin_box('Seat '+index+' headrest post',(x+offset,(top+p['head'])*.5,zt),(.012,p['head']-top,.012),seam,.002)
        cabin_box('Seat '+index+' head restraint',(x,p['head'],zt+.015),(width*.67,.16,.115),upholstery,.035)
    if kind=='van':
        seat(-.45,p['seat_z'],.45,'driver')
        seat(.14,p['seat_z'],.41,'passenger inner');seat(.58,p['seat_z'],.41,'passenger outer')
        cabin_box('Commercial cab cargo bulkhead',(0,1.53,-.33),(1.72,1.79,.055),(.13,.15,.17),.015)
    else:
        seat(-w*.235,p['seat_z'],w*.275,'driver');seat(w*.235,p['seat_z'],w*.275,'passenger')
        # Rear bench shares a continuous cushion but separate visible restraints.
        cabin_box('Rear bench cushion',(0,p['seat']+.025,p['rear_z']),(w*.78,.15,.43),upholstery,.05)
        cabin_box('Rear bench backrest',(0,(p['seat']+p['back'])*.5+.045,p['rear_z']+.22),(w*.78,p['back']-p['seat'],.13),upholstery,.035)
        for x in [-w*.24,w*.24]:
            cabin_box('Rear bench head restraint',(x,p['head']-.045,p['rear_z']+.23),(w*.19,.14,.11),upholstery,.03)
        cabin_box('Center console',(0,floor+.14,front+.91),(.16,.25,.58),inset,.025)
        cabin_box('Gear selector',(0,floor+.31,front+.82),(.045,.13,.05),charcoal,.015)
    steering=(-w*.245,belt+.04,front+.72)
    cabin_box('Steering column',(steering[0],belt-.055,front+.54),(.065,.075,.22),charcoal,.015)
    if kind!='van':
        cabin_box('Interior rear view mirror',(0,spec['height']-.20,front+.43),(.20,.065,.026),(.055,.065,.075),.012)

def author_mirrors(kind):
    p=CABINS[kind];is_van=kind=='van';z=-1.73 if is_van else p['front']+.30
    y=p['belt']+(.32 if is_van else .14)
    MATERIALS['mirror_reflective']=make_material('mirror_reflective',{'color':[.78,.84,.88],'metalness':1,'roughness':.07})
    for side in [-1,1]:
        center=Vector((side*(p['body']*.5+.008),y,z));n=Vector((side*.12,0,.9927739));u=Vector((.9927739,0,-side*.12))
        def point(a,b,d): return tuple(center+u*a+Vector((0,b,0))+n*d)
        def outline(w,h):
            r=min(w,h)*.25;points=[]
            for cx,cy,start in [(w-r,h-r,0),(-w+r,h-r,math.pi/2),(-w+r,-h+r,math.pi),(w-r,-h+r,math.pi*1.5)]:
                for i in range(3):
                    a=start+i*math.pi/4;points.append((cx+math.cos(a)*r,cy+math.sin(a)*r))
            return points
        h=.106 if is_van else .055
        verts=[]
        for w,hh,d in [(.035,h*.60,-.095),(.062,h,.025),(.061,h*.97,.091)]:
            verts += [point(a,b,d) for a,b in outline(w,hh)]
        faces=[]
        for row in range(2):
            for i in range(12):
                j=(i+1)%12;faces.append((row*12+i,row*12+j,(row+1)*12+j,(row+1)*12+i))
        faces += [tuple(reversed(range(12))),tuple(24+i for i in range(12))]
        model_mesh('Mirror aerodynamic housing '+str(side),verts,faces,'trim' if is_van else 'body',smooth=True)
        outer=outline(.060,h*.95);inner=outline(.052,h*.81)
        bezel=[point(a,b,.093) for a,b in outer]+[point(a,b,.0935) for a,b in inner]
        model_mesh('Mirror recessed rubber surround '+str(side),bezel,[(i,(i+1)%12,(i+1)%12+12,i+12) for i in range(12)],'trim')
        pane=[point(a,b,.094) for a,b in inner]
        ob=model_mesh('Mirror inset reflective pane '+str(side),pane,[tuple(range(12))],'mirror_reflective')
        ob['reflection_model']='Approximate environment reflection, no planar scene capture'
    if kind!='van':
        # Rear-facing interior mirror shares the same inexpensive environment
        # material as the exterior panes and sits inside its dark cabin frame.
        h=SOURCE['vehicles'][kind]['spec']['height']-.20;z=p['front']+.445
        model_mesh('Interior rear view reflective pane',[(-.087,h-.023,z),(.087,h-.023,z),(.087,h+.023,z),(-.087,h+.023,z)],[(0,1,2,3)],'mirror_reflective')

def author_indicators(kind,spec):
    p=CABINS[kind];w=p['body'];l=spec['length']*.5
    front_y={'sedan':.683,'hatch':.693,'suv':.868,'van':.933}[kind]
    rear_y={'sedan':.73,'hatch':.945,'suv':.935,'van':1.47}[kind]
    for side,label in [(-1,'left'),(1,'right')]:
        material='indicator_'+label
        MATERIALS[material]=make_material(material,{'color':[.55,.17,.013],'roughness':.23,'emissive':[1,.25,.015],'emissiveIntensity':.04})
        beveled_box('Front amber turn signal '+label,(side*w*.35,front_y,-l+(.014 if kind=='van' else .016)),(.065,.052,.007),material,.009)
        rear_x=w*(.43 if kind=='van' else .385 if kind=='hatch' else .374)
        beveled_box('Rear amber turn signal '+label,(side*rear_x,rear_y,l-.0025),(.085 if kind=='van' else .066,.072 if kind in ['van','hatch'] else .052,.007),material,.009)

WHEEL_WIDTHS={'sedan':.225,'hatch':.215,'suv':.26,'van':.245}

def metal_tint(obj,color):
    attribute=obj.data.color_attributes.new(name='WheelMetalTint',type='FLOAT_COLOR',domain='CORNER')
    for item in attribute.data: item.color=(*color,1)
    obj.data.color_attributes.active_color=attribute
    return obj

def wheel_mesh(name,vertices,faces,material,pivot,side,smooth=True,color=None):
    # Build the outward-facing right wheel, then mirror both positions and
    # winding for the left. The named pivot itself keeps identity transforms.
    if side<0:
        vertices=[(-p[0],p[1],p[2]) for p in vertices]
        faces=[tuple(reversed(face)) for face in faces]
    ob=model_mesh(name,vertices,faces,material,parent=pivot,smooth=smooth)
    ob['wheel_detail']='Blender-authored tire, dished rim, hub or brake hardware'
    if color is not None: metal_tint(ob,color)
    return ob

def wheel_lathe(name,profile,pivot,side,material,segments=32,close=False,color=None):
    vertices=[(x,math.cos(i*math.tau/segments)*radius,math.sin(i*math.tau/segments)*radius)
              for x,radius in profile for i in range(segments)]
    faces=[]
    for row in range(len(profile) if close else len(profile)-1):
        next_row=(row+1)%len(profile)
        for i in range(segments):
            j=(i+1)%segments
            faces.append((row*segments+i,row*segments+j,next_row*segments+j,next_row*segments+i))
    return wheel_mesh(name,vertices,faces,material,pivot,side,color=color)

def wheel_cylinder(name,x,radius,depth,pivot,side,material,center=(0,0),segments=12,color=None):
    cy,cz=center
    vertices=[(xx,cy+math.cos(i*math.tau/segments)*radius,cz+math.sin(i*math.tau/segments)*radius)
              for xx in [x-depth*.5,x+depth*.5] for i in range(segments)]
    faces=[tuple(reversed(range(segments))),tuple(range(segments,segments*2))]
    faces += [(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)]
    return wheel_mesh(name,vertices,faces,material,pivot,side,smooth=False,color=color)

def spoke(name,stations,angle,pivot,side,color):
    # A manufactured six-sided cross-section gives a narrow bevel highlight,
    # a real side wall and a face that sweeps into the concave rim bowl.
    vertices=[]
    cross=[(-1,-.004),(-.72,0),(.72,0),(1,-.004),(1,-.018),(-1,-.018)]
    for radius,x,width,sweep in stations:
        a=angle+sweep
        for tangent,depth in cross:
            vertices.append((x+depth,math.cos(a)*radius-math.sin(a)*tangent*width,
                             math.sin(a)*radius+math.cos(a)*tangent*width))
    faces=[]
    for row in range(len(stations)-1):
        for i in range(6): faces.append((row*6+i,row*6+(i+1)%6,(row+1)*6+(i+1)%6,(row+1)*6+i))
    faces += [tuple(reversed(range(6))),tuple((len(stations)-1)*6+i for i in range(6))]
    return wheel_mesh(name,vertices,[tuple(reversed(face)) for face in faces],'wheel_metal',pivot,side,smooth=False,color=color)

def steel_dish(radius,width,pivot,side):
    # The commercial rim is an actual dished plate with eight rounded holes,
    # made as a filled Blender curve, not eight bright rectangular spokes.
    curve=bpy.data.curves.new('Steel rim vented plate','CURVE')
    curve.dimensions='2D';curve.resolution_u=1;curve.fill_mode='BOTH';curve.extrude=0
    def loop(points):
        spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
        for item,(x,y) in zip(spline.points,points): item.co=(x,y,0,1)
        spline.use_cyclic_u=True
    loop([(math.cos(i*math.tau/32)*radius*.625,math.sin(i*math.tau/32)*radius*.625) for i in range(32)])
    for j in range(8):
        angle=j*math.tau/8
        points=[]
        for i in reversed(range(10)):
            a=i*math.tau/10;radial=radius*(.43+.105*math.cos(a));tangent=radius*.062*math.sin(a)
            points.append((math.cos(angle)*radial-math.sin(angle)*tangent,math.sin(angle)*radial+math.cos(angle)*tangent))
        loop(points)
    ob=bpy.data.objects.new('Commercial pressed-steel rim',curve);bpy.context.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.convert(target='MESH');ob=bpy.context.object
    for vertex in ob.data.vertices:
        y,z,depth=vertex.co
        # The stamped center is a recessed plane inside the separate concave
        # rolled barrel. Nonlinearly warping a hole-tessellated face would make
        # long triangulation creases and conceal several fasteners.
        x=width*.30+depth
        vertex.co=xyz((side*x,y,z))
    if side<0:
        import bmesh
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
    for face in ob.data.polygons:face.use_smooth=True
    ob.data.materials.append(MATERIALS['wheel_metal']);ob.parent=pivot;ob['material_group']='wheel_metal'
    ob['authored_in']='Blender';ob['wheel_detail']='Dished steel wheel with eight open rounded ventilation holes'
    metal_tint(ob,(.28,.32,.35));ob.data.update()

def author_wheels(kind,vehicle,pivots):
    radius=vehicle['spec']['wheelRadius'];width=WHEEL_WIDTHS[kind]
    MATERIALS['rubber'].node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.80
    MATERIALS['wheel_recess']=make_material('wheel_recess',{'color':[.004,.006,.008],'roughness':.76,'metalness':.10})
    MATERIALS['wheel_metal']=make_material('wheel_metal',{'color':[1,1,1],'roughness':.31,'metalness':.82})
    shader=MATERIALS['wheel_metal'].node_tree.nodes.get('Principled BSDF')
    tint=MATERIALS['wheel_metal'].node_tree.nodes.new('ShaderNodeVertexColor');tint.layer_name='WheelMetalTint'
    MATERIALS['wheel_metal'].node_tree.links.new(tint.outputs['Color'],shader.inputs['Base Color'])
    for name,pivot in pivots.items():
        side=1 if pivot.location.x>0 else -1
        # Nominal outer radius and the original pivot positions are unchanged.
        # Rounded bead, convex sidewall, shoulder rolls and two modeled grooves
        # replace the previous flat annular tire and low-sided silhouette.
        contour=[(-.47,.67),(-.51,.78),(-.47,.91),(-.33,.985),(-.18,1),(-.105,.988),(-.07,1),
                 (.07,1),(.105,.988),(.18,1),(.33,.985),(.47,.91),(.51,.78),(.47,.67)]
        wheel_lathe('Rounded tire carcass',[(x*width,r*radius) for x,r in contour],pivot,side,'rubber',close=True)
        # Short diagonal shoulder sipes remain restrained and are merged with
        # the dark recess group, so they do not add material draw calls.
        vertices=[];faces=[]
        for shoulder in [-1,1]:
            for i in range(16):
                a=(i+(0 if shoulder>0 else .45))*math.tau/16
                start=len(vertices)
                for x,r,da in [(shoulder*.29*width,.991,-.009),(shoulder*.43*width,.946,.055),
                               (shoulder*.43*width,.946,.073),(shoulder*.29*width,.991,.009)]:
                    vertices.append((x,math.cos(a+da)*r*radius,math.sin(a+da)*r*radius))
                face=(start,start+1,start+2,start+3)
                faces.append(face if shoulder<0 else tuple(reversed(face)))
        wheel_mesh('Shoulder tread sipes',vertices,faces,'wheel_recess',pivot,side)
        wheel_lathe('Deep inner rim barrel',[(width*.32,radius*.565),(-width*.34,radius*.565)],pivot,side,'wheel_recess')
        wheel_lathe('Rolled rim lip',[(width*.46,radius*.67),(width*.515,radius*.67),(width*.515,radius*.625),(width*.32,radius*.57)],
                    pivot,side,'wheel_metal',color=(.54,.59,.64))
        # The rotor is coupled to the wheel, as on a real hub. Calipers are
        # deliberately omitted, keeping the steering/spin hierarchy unchanged.
        wheel_lathe('Ventilated brake disc',[(width*.10,radius*.51),(width*.10,radius*.205)],
                    pivot,side,'wheel_metal',color=(.16,.185,.21))
        if kind=='van':steel_dish(radius,width,pivot,side)
        else:
            count=5 if kind in ['sedan','hatch'] else 6
            for i in range(count):
                a=i*math.tau/count
                if kind=='sedan':
                    spoke('Split spoke root',[(radius*.20,width*.27,radius*.055,0),(radius*.36,width*.31,radius*.047,.025)],a,pivot,side,(.33,.39,.45))
                    for split in [-1,1]:
                        spoke('Split concave alloy spoke',[(radius*.33,width*.305,radius*.028,split*.035),(radius*.58,width*.47,radius*.023,split*.12+.03)],a,pivot,side,(.40,.46,.52))
                elif kind=='hatch':
                    spoke('Swept five-spoke alloy',[(radius*.20,width*.27,radius*.060,0),(radius*.40,width*.35,radius*.052,.07),(radius*.58,width*.47,radius*.038,.12)],a,pivot,side,(.34,.40,.46))
                else:
                    spoke('Utility alloy spoke',[(radius*.20,width*.27,radius*.065,0),(radius*.41,width*.35,radius*.058,.03),(radius*.58,width*.47,radius*.042,.03)],a,pivot,side,(.32,.38,.44))
        wheel_cylinder('Recessed hub flange',width*.255,radius*.255,.026,pivot,side,'wheel_metal',segments=16,color=(.28,.33,.38))
        wheel_cylinder('Center dust cap',width*.33,radius*.126,.018,pivot,side,'wheel_recess',segments=16)
        wheel_cylinder('Center cap inset',width*.375,radius*.088,.006,pivot,side,'wheel_metal',segments=12,color=(.40,.45,.50))
        bolts=5 if kind=='sedan' else 4 if kind=='hatch' else 6
        for i in range(bolts):
            a=i*math.tau/bolts;center=(math.cos(a)*radius*.196,math.sin(a)*radius*.196)
            wheel_cylinder('Hex wheel fastener',width*.335,radius*.024,.009,pivot,side,'wheel_metal',center=center,segments=6,color=(.60,.63,.66))
        if kind!='van':
            vertices=[];faces=[]
            for i in range(12):
                a=i*math.tau/12;start=len(vertices)
                for r,da in [(.40,-.018),(.47,.015),(.47,.038),(.40,.005)]:
                    vertices.append((width*.105,math.cos(a+da)*radius*r,math.sin(a+da)*radius*r))
                faces.append((start,start+1,start+2,start+3))
            wheel_mesh('Brake rotor swept slots',vertices,faces,'wheel_recess',pivot,side)

def load_base(kind, vehicle):
    global ROOT_OBJECT, MATERIALS
    ROOT_OBJECT=bpy.data.objects.new('traffic_'+kind,None)
    bpy.context.collection.objects.link(ROOT_OBJECT)
    ROOT_OBJECT['kind']=kind
    ROOT_OBJECT['category']=vehicle['spec']['category']
    ROOT_OBJECT['wheelRadius']=vehicle['spec']['wheelRadius']
    ROOT_OBJECT['length']=vehicle['spec']['length']
    ROOT_OBJECT['asset_pipeline']='Blender authored final mesh and materials; original procedural block-in'
    MATERIALS={name:make_material(name,settings) for name,settings in SOURCE['materials'].items()}
    pivots={}
    for name,position in vehicle['wheels'].items():
        obj=bpy.data.objects.new(name,None)
        bpy.context.collection.objects.link(obj)
        obj.parent=ROOT_OBJECT
        obj.location=xyz(position)
        obj.empty_display_type='CIRCLE'
        obj.empty_display_size=.16
        pivots[name]=obj
    for i,item in enumerate(vehicle['meshes']):
        # The procedural wheels are only block-in references. All final tire,
        # rim, hub and brake geometry is authored above in editable Blender.
        if item['wheel']: continue
        offset=vehicle['wheels'][item['wheel']] if item['wheel'] else [0,0,0]
        source=item['position']
        vertices=[tuple(source[j+k]-offset[k] for k in range(3)) for j in range(0,len(source),3)]
        faces=[tuple(item['index'][j:j+3]) for j in range(0,len(item['index']),3)]
        name=(item['wheel']+'_' if item['wheel'] else '')+item['material']
        ob=model_mesh(name,vertices,faces,item['material'],pivots.get(item['wheel']),smooth=True)
        normals=item['normal']
        ob.data.normals_split_custom_set_from_vertices([xyz(normals[j:j+3]) for j in range(0,len(normals),3)])
        ob['base_component']='Original lofted body / cutout arches / curved glazing / wheel hardware'
    author_wheels(kind,vehicle,pivots)
    return ROOT_OBJECT

def batch_for_export():
    """Batch the cabin and mirrors once each; retain three groups per wheel."""
    groups={}
    for ob in list(bpy.context.scene.objects):
        if ob.type=='MESH':
            groups.setdefault((ob.parent.name,ob['material_group']),[]).append(ob)
    for (parent,material),objects in groups.items():
        for ob in objects:
            bpy.context.view_layer.objects.active=ob
            for modifier in list(ob.modifiers):
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objects: ob.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1: bpy.ops.object.join()
        ob=bpy.context.object
        ob.name=(parent+'_' if parent!=ROOT_OBJECT.name else '')+material

def preview(kind, spec):
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=int(os.environ.get('TRAFFIC_SAMPLES','24'))
    # Distribution Blender builds may omit OpenImageDenoise. Enough samples
    # keep the deterministic studio review usable without that optional module.
    scene.cycles.use_denoising=False
    scene.render.resolution_x=1280
    scene.render.resolution_y=850
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX'
    scene.world.color=(.16,.16,.16)
    ground=make_material('preview_ground',{'color':[.075,.085,.095],'roughness':.72})
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.005))
    bpy.context.object.data.materials.append(ground)
    def area(name,loc,power,color,size):
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
        ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.location=xyz(loc)
        ob.rotation_euler=(xyz((0,.7,0))-ob.location).to_track_quat('-Z','Y').to_euler()
    area('Large studio key',(-3.5,6,-2),1000,(.83,.90,1),5)
    area('Rear studio rim',(1.5,5,5),1200,(1,.87,.72),4)
    area('Front studio fill',(4,3,-4),850,(.85,.93,1),4)
    data=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',data)
    bpy.context.collection.objects.link(camera);scene.camera=camera;data.lens=54
    scale=spec['length']/4.65
    views=[('rear',(-5.6*scale,2.9*scale,6.7*scale)),('front',(5.6*scale,2.8*scale,-6.7*scale))]
    if 'wheel' in os.environ.get('TRAFFIC_VIEWS',''):
        axle={'sedan':-1.43,'hatch':-1.28,'suv':-1.51,'van':-1.83}[kind]
        views.append(('wheel',(2.55,.78,axle+.42)))
    if 'cabin' in os.environ.get('TRAFFIC_VIEWS',''):
        views.append(('cabin',(2.7,2.15*scale,-3.5*scale)))
    if 'mirror' in os.environ.get('TRAFFIC_VIEWS',''):
        views.append(('mirror',(1.65,CABINS[kind]['belt']+.28,CABINS[kind]['front']+1.45)))
    if 'driver' in os.environ.get('TRAFFIC_VIEWS',''):
        driver_view=(-1.05,1.90,-3.55) if kind=='van' else (-2.15,CABINS[kind]['belt']+.57,CABINS[kind]['front']-1.02)
        views.append(('driver',driver_view))
    for name,position in views:
        if os.environ.get('TRAFFIC_VIEWS') and name not in os.environ['TRAFFIC_VIEWS'].split(','):
            continue
        camera.location=xyz(position)
        target=(.84,spec['wheelRadius']+.06,axle) if name=='wheel' else (0,spec['height']*.43,0)
        if name=='cabin': target=(0,CABINS[kind]['belt']+.17,CABINS[kind]['seat_z']+.10)
        if name=='mirror': target=(CABINS[kind]['body']*.5,CABINS[kind]['belt']+(.32 if kind=='van' else .14),-1.73 if kind=='van' else CABINS[kind]['front']+.30)
        if name=='driver': target=(-CABINS[kind]['width']*.235,CABINS[kind]['seat']+.40,CABINS[kind]['seat_z']-.10)
        camera.rotation_euler=(xyz(target)-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=os.path.join(PREVIEWS,kind+'-'+name+'.png')
        bpy.ops.render.render(write_still=True)

if os.environ.get('TRAFFIC_PREVIEW_ONLY') == '1':
    # Review an already frozen .blend without touching its runtime GLB.
    for kind in KINDS:
        bpy.ops.wm.open_mainfile(filepath=os.path.join(ART,kind+'.blend'))
        preview(kind,SOURCE['vehicles'][kind]['spec'])
    print('TRAFFIC_PASSENGER_PREVIEWS_COMPLETE',flush=True)
    raise SystemExit(0)

REPORT={}
for kind in KINDS:
    clear_scene()
    vehicle=SOURCE['vehicles'][kind]
    load_base(kind,vehicle)
    {'sedan':refine_sedan,'hatch':refine_hatch,'suv':refine_suv,'van':refine_van}[kind](vehicle['spec'])
    author_cabin(kind,vehicle['spec'])
    author_driver(kind)
    author_mirrors(kind)
    author_indicators(kind,vehicle['spec'])
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.scene['authoring_notes']='Original traffic vehicle; editable curved base, named Blender-authored refinements, modifier bevels and PBR materials.'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART,kind+'.blend'))
    batch_for_export()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS,kind+'.glb'),export_format='GLB',use_selection=True,
        export_apply=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bpy.context.view_layer.update()
    bounds=[o.matrix_world@Vector(corner) for o in meshes for corner in o.bound_box]
    size=[max(v[i] for v in bounds)-min(v[i] for v in bounds) for i in range(3)]
    REPORT[kind]={'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),
                  'draw_groups':len(meshes),'game_size':[size[0],size[2],size[1]],
                  'blend':'art/traffic/'+kind+'.blend','glb':'public/assets/traffic/'+kind+'.glb'}
    print('TRAFFIC_PASSENGER_RESULT',kind,json.dumps(REPORT[kind]),flush=True)
    if RENDER: preview(kind,vehicle['spec'])
with open(os.path.join(ART,'passenger-build-report.json'),'w') as file:
    json.dump(REPORT,file,ensure_ascii=False,indent=2)
print('TRAFFIC_PASSENGER_COMPLETE',json.dumps(REPORT),flush=True)
