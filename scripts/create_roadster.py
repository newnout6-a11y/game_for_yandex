"""Reference-reconstructed angular Rocket roadster, authored in editable Blender. Run with Blender 4.x --background --python.
Coordinates in all helpers are game axes: +Y up, -Z forward; exported glTF is metres.
No external models, materials, images or add-ons are required.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector
from math import sin, cos, pi, sqrt
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW=os.environ.get('ROADSTER_PREVIEW',os.path.join(ROOT,'art','previews'))
os.makedirs(PREVIEW,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)

def v(p):
    """Return a Blender vector from game-space coordinates without changing scale.

    Map (X, Y, Z) to (X, -Z, Y): game +Y is up and -Z is forward.
    Positions remain in metres; the same rotation also applies to directions.
    """
    return Vector((p[0],-p[2],p[1]))
def material(name, color, metal=0, rough=.5, emission=0, alpha=1):
    """Create and return a node-based roadster material in bpy.data.

    Use normalized RGB/alpha and Principled metallic/roughness values; emission
    is shader strength. Enable dithered alpha only for translucent finishes.
    """
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,alpha); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,alpha)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if emission:
        bs.inputs['Emission Color'].default_value=(*color,1); bs.inputs['Emission Strength'].default_value=emission
    if alpha<1:
        bs.inputs['Alpha'].default_value=alpha
        m.surface_render_method='DITHERED'; m.use_transparency_overlap=False
    return m
M={}
M['body']=material('body',(.68,.69,.71),.28,.27)
M['body'].use_backface_culling=True
M['carbon']=material('satin_carbon',(.018,.023,.029),.32,.3)
M['wing']=material('carbon_wing',(.006,.008,.012),0,.78)
M['wing'].node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.06
M['rubber']=material('tire_rubber',(.013,.016,.020),0,.78)
M['alloy']=material('brushed_alloy',(.44,.50,.56),.93,.24)
M['dark_alloy']=material('graphite_alloy',(.035,.045,.055),.82,.26)
M['glass']=material('glass',(.024,.020,.016),.24,.14,alpha=.74)
M['ivory']=material('ivory_leather',(.86,.86,.80),0,.65)
M['suede']=material('graphite_suede',(.11,.13,.145),0,.86)
M['red']=material('interior_red',(.62,.012,.018),.15,.38)
M['lights_red']=material('lights_red',(.9,.008,.009),.15,.22,2.4)
M['lights_white']=material('LED_white',(.7,.88,1),.1,.15,3)
M['screen']=material('screen_black',(.004,.009,.016),.1,.23)
M['cyan']=material('screen_cyan',(.04,.65,.82),.1,.3,1)
M['body'].node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.65
# Visible suspension follows public Rocket imagery; hidden packaging is reconstructed, not CAD.
# Two additional groups keep the floor matte instead of reflecting as a silver slab.
M['underbody']=material('underbody_matte_composite',(.012,.019,.025),.05,.82)
M['shield']=material('underbody_satin_cast_metal',(.075,.095,.112),.48,.60)
M['spring_gold']=material('suspension_anodized_gold',(.56,.32,.095),.78,.26)
M['plate']=material('rear_license_plate',(.17,.18,.19),.05,.64)
M['optical']=material('optical_smoked_lens',(.032,.036,.042),.08,.30)
M['brake_carbon']=material('brake_carbon_ceramic',(.022,.025,.028),.18,.70)
objects=[]

def mesh(name, verts, faces, mat, parent=None, bevel=0, smooth=False):
    """Create, link and register a roadster mesh with its material-group tag.

    Vertices are parent-local game coordinates in metres; convert them once to
    Blender axes. Apply the optional metre-width bevel immediately, optionally
    smooth all faces, and return the object for later material/pivot batching.
    """
    me=bpy.data.meshes.new(name); me.from_pydata([v(p) for p in verts],[],faces); me.materials.append(M[mat]); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob)
    if parent: ob.parent=parent
    if bevel:
        mod=ob.modifiers.new('Soft manufactured edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.context.view_layer.objects.active=ob; ob.select_set(True); bpy.ops.object.modifier_apply(modifier=mod.name); ob.select_set(False)
    if smooth:
        for f in ob.data.polygons: f.use_smooth=True
    ob['material_group']=mat; objects.append(ob)
    return ob

def box(name, c, dims, mat, bevel=.01, parent=None):
    """Return a closed box centered at c with full game-axis dimensions in metres.

    Build six consistently wound faces through mesh(), retaining the optional
    parent and applying its bevel width before later export batching.
    """
    x,y,z=c; a,b,d=[q/2 for q in dims]
    ps=[(x-a,y-b,z-d),(x+a,y-b,z-d),(x+a,y+b,z-d),(x-a,y+b,z-d),
        (x-a,y-b,z+d),(x+a,y-b,z+d),(x+a,y+b,z+d),(x-a,y+b,z+d)]
    return mesh(name,ps,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],mat,parent,bevel)

def beam(name,a,b,width,depth,mat,parent=None):
    # Rectangular section whose local length is aimed along the segment.
    """Return a beveled rectangular beam joining game-space endpoints a and b.

    Endpoint coordinates and cross-section width/depth are metres in the parent
    frame. Orient the box's Blender -Y length axis along the converted segment.
    """
    ob=box(name,(0,0,0),(width,depth,(v(b)-v(a)).length),mat,min(width,depth)*.18,parent)
    ob.location=(v(a)+v(b))/2
    ob.rotation_euler=(v(b)-v(a)).to_track_quat('-Y','Z').to_euler()
    return ob

def tube(name,points,r,mat,parent=None,segments=8):
    """Return a capped, smooth polygon tube swept along game-space points.

    Points and radius r are parent-local metres. Construct perpendicular rings
    in Blender space, then convert back before mesh() performs its sole axis
    conversion; segments controls the radial polygon count.
    """
    pts=[v(p) for p in points]; vs=[]; fs=[]
    closed=len(pts)>2 and (pts[0]-pts[-1]).length<1e-7
    if closed:pts=pts[:-1]
    for i,p in enumerate(pts):
        tangent=(pts[(i+1)%len(pts)]-pts[(i-1)%len(pts)]) if closed else pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]
        tangent.normalize()
        up=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((1,0,0))
        a=tangent.cross(up).normalized(); b=tangent.cross(a).normalized()
        for k in range(segments): vs.append(p+r*(a*cos(k*2*pi/segments)+b*sin(k*2*pi/segments)))
    for i in range(len(pts) if closed else len(pts)-1):
        nxt=(i+1)%len(pts)
        for k in range(segments):fs.append((i*segments+k,i*segments+(k+1)%segments,nxt*segments+(k+1)%segments,nxt*segments+k))
    if not closed:fs.extend([tuple(reversed(range(segments))),tuple((len(pts)-1)*segments+k for k in range(segments))])
    # Convert back because the mesh helper owns the single coordinate conversion.
    return mesh(name,[(p.x,p.z,-p.y) for p in vs],fs,mat,parent,smooth=True)

def extrude_xy(name,poly,zfront,zback,mat,bevel=0,parent=None):
    """Return a capped extrusion of a game-XY polygon between two Z planes.

    Polygon vertices, zfront/zback and bevel use parent-local metres; negative
    Z is forward. Preserve the supplied polygon order for the side-wall winding.
    """
    n=len(poly); vs=[(x,y,z) for z in [zfront,zback] for x,y in poly]
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,vs,fs,mat,parent,bevel)

def cylinder_x(name,c,r,depth,mat,parent=None,n=48):
    """Return a capped n-sided cylinder along the game X wheel-axle direction.

    Center, radius and full depth are parent-local metres. Smooth the generated
    mesh without changing the wheel parent's transform or spin axis.
    """
    x,y,z=c; vs=[]; fs=[]
    for xx in [x-depth/2,x+depth/2]:
        vs += [(xx,y+r*cos(2*pi*i/n),z+r*sin(2*pi*i/n)) for i in range(n)]
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,vs,fs,mat,parent,smooth=True)

def cylinder_z(name,c,r,length,mat,n=32):
    """Return a capped smooth cylinder along the game longitudinal Z axis.

    Center, radius and full length are metres; n controls each circular ring.
    The object is linked as an unparented roadster part for static batching.
    """
    x,y,z=c; vs=[]
    for zz in [z-length/2,z+length/2]: vs += [(x+r*cos(2*pi*i/n),y+r*sin(2*pi*i/n),zz) for i in range(n)]
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,vs,fs,mat,smooth=True)

def prism_xz(name,poly,ybottom,ytop,mat):
    """Return a closed floor-style prism from a game-XZ footprint.

    Extrude the ordered footprint between ybottom and ytop in metres, with
    +Y upward; the resulting unparented mesh joins the static material batch.
    """
    n=len(poly); vs=[(x,y,z) for y in [ybottom,ytop] for x,z in poly]
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,vs,fs,mat)

def chamfer_panel(name,x,z,w,length,y,thickness,mat,corner=.045):
    """Return an eight-corner horizontal panel with real vertical thickness.

    Center x/z, full width/length, bottom y, thickness and corner setback are
    metres. Clamp the setback to half of each half-extent before extrusion.
    """
    a=w/2; b=length/2; c=min(corner,a*.5,b*.5)
    poly=[(x-a+c,z-b),(x+a-c,z-b),(x+a,z-b+c),(x+a,z+b-c),
          (x+a-c,z+b),(x-a+c,z+b),(x-a,z+b-c),(x-a,z-b+c)]
    return prism_xz(name,poly,y,y+thickness,mat)

def bolt_y(name,x,y,z,r=.013,mat='alloy',n=8):
    """Return a short n-sided fastener rising 9 mm along game +Y.

    The supplied x/y/z and radius are metres; cap both ends and keep the
    fastener as a static mesh in the selected material group.
    """
    vs=[(x+r*cos(i*2*pi/n),yy,z+r*sin(i*2*pi/n)) for yy in [y,y+.009] for i in range(n)]
    fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,vs,fs,mat)

def lerp(z,table):
    """Return a linearly interpolated scalar from an ascending station table.

    Clamp outside the table to its endpoint values. Body callers use metre
    Z stations and metre widths/heights; the table itself is not modified.
    """
    for (a,x),(b,y) in zip(table,table[1:]):
        if a<=z<=b:return x+(y-x)*(z-a)/(b-a)
    return table[0][1] if z<table[0][0] else table[-1][1]

# Reference-matched exterior is kept separate from the cabin author's module.
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from roadster_geometry import build_exterior
metadata=build_exterior(globals())
wheel_z=[-1.47,1.47]
# A continuous shaped floor sits behind individually modeled shields and mechanisms.
# It narrows around each wheel bay: no full-length featureless rectangle and no open cabin holes.
floor_outline=[(-.700,-2.22),(.700,-2.22),(.67,-1.90),(.51,-1.73),(.51,-1.20),
    (.77,-.97),(.79,.98),(.52,1.22),(.52,1.76),(.69,2.19),(-.69,2.19),
    (-.52,1.76),(-.52,1.22),(-.79,.98),(-.77,-.97),(-.51,-1.20),(-.51,-1.73),(-.67,-1.90)]
prism_xz('continuous_shaped_floor',floor_outline,.247,.278,'underbody')
# Formed carbon undertray, recessed suction duct mouths and service access.
# The public imagery confirms active front/rear suction and inboard suspension,
# but does not expose a full factory floor plan. Hidden packaging is deliberately
# modest; no six-module battery layout or pressure-vessel claim is invented here.
chamfer_panel('central_formed_carbon_undertray',0,.02,1.40,2.10,.170,.030,'underbody',.13)
for sx in [-1,1]:
    beam('undertray_protected_side_channel',(sx*.694,.177,-1.02),(sx*.694,.177,1.06),.055,.050,'underbody')
    beam('rocker_structural_return',(sx*.837,.242,-1.06),(sx*.837,.242,1.08),.096,.112,'underbody')
    tube('protected_brake_line',[(sx*.754,.216,-1.07),(sx*.760,.207,-.71),(sx*.760,.207,.72),(sx*.748,.222,1.11)],.006,'dark_alloy',segments=6)
    for zz in [-.94,-.47,0,.49,.98]:bolt_y('undertray_recessed_fastener',sx*.660,.159,zz,.009,'dark_alloy')
# Long shallow pressed flutes follow the airflow; they are not square battery boxes.
for xx in [-.52,-.35,-.18,0,.18,.35,.52]:
    tube('undertray_formed_flute',[(xx,.167,-.91),(xx*.97,.157,-.68),(xx*.97,.157,.70),(xx,.167,.96)],.009,'underbody',segments=6)
for zz in [-.72,.76]:
    chamfer_panel('flush_service_hatch',0,zz,.50,.30,.156,.010,'underbody',.055)
    for xx in [-.19,.19]:
        for dz in [-.10,.10]:bolt_y('service_hatch_quarter_turn',xx,.150,zz+dz,.008,'dark_alloy')
# Two deep, framed suction inlets, located in the front/rear floor zones described
# publicly. Their exact unphotographed planform is a conservative reconstruction.
for sz in [-1.985,1.895]:
    footprint=[(-.50,sz-.18),(.50,sz-.18),(.57,sz-.11),(.57,sz+.11),(.50,sz+.18),(-.50,sz+.18),(-.57,sz+.11),(-.57,sz-.11)]
    n=len(footprint);vs=[]
    for yy,scale in [(.155,1),(.155,.91),(.263,.84)]:
        vs.extend([(x*scale,yy,sz+(z-sz)*scale) for x,z in footprint])
    fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(2) for i in range(n)]
    duct=mesh('underfloor_suction_duct',vs,fs,'underbody')
    mod=duct.modifiers.new('Duct wall thickness','SOLIDIFY');mod.thickness=.015
    bpy.ops.object.select_all(action='DESELECT');duct.select_set(True);bpy.context.view_layer.objects.active=duct;bpy.ops.object.modifier_apply(modifier=mod.name);duct.select_set(False)
    chamfer_panel('suction_duct_dark_well',0,sz,.93,.26,.265,.012,'carbon',.045)
    for i in range(13):
        xx=-.46+.92*i/12
        beam('suction_stator_vane',(xx,.213,sz-.126),(xx,.213,sz+.126),.010,.041,'dark_alloy')
    for sx in [-1,1]:
        beam('suction_duct_side_strake',(sx*.598,.17,sz-.20),(sx*.598,.17,sz+.20),.017,.050,'underbody')
# Cast-style open subframe, real half-shafts and double-wishbone linkage.
# Topology follows the visible architecture; exact dimensions remain reconstructed.
for zi,cz in enumerate(wheel_z):
    tube('subframe_perimeter',[(-.49,.27,cz-.24),(.49,.27,cz-.24),(.53,.27,cz+.22),
        (-.53,.27,cz+.22),(-.49,.27,cz-.24)],.047,'shield',segments=6)
    tube('subframe_crossmember',[(-.49,.255,cz),(.49,.255,cz)],.044,'underbody',segments=6)
    for sx in [-1,1]:
        for dz in [-.25,.24]:
            chamfer_panel('subframe_mount_plate',sx*.46,cz+dz,.17,.14,.24,.031,'underbody',.025)
            bolt_y('subframe_mount_bolt',sx*.46,.222,cz+dz,.021)
        # Lower A-arm: two visible legs join a real inner wheel carrier, not floating wheels.
        hub=(sx*.767,.33,cz)
        tube('lower_wishbone_front',[(sx*.46,.262,cz-.23),hub],.027,'shield',segments=6)
        tube('lower_wishbone_rear',[(sx*.46,.262,cz+.23),hub],.027,'shield',segments=6)
        tube('upper_wishbone',[(sx*.48,.51,cz-.15),(sx*.766,.48,cz),(sx*.48,.51,cz+.15)],.020,'underbody',segments=6)
        box('upright_carrier',(sx*.762,.405,cz),(.066,.22,.105),'shield',.012)
        cylinder_x('half_shaft',(sx*.50,.39,cz),.027,.55,'dark_alloy',n=12)
        # Compact CV gaiter rings and steering/toe links read clearly in silhouette.
        cylinder_x('cv_boot',(sx*.696,.39,cz),.046,.095,'underbody',n=12)
        for xx in [sx*.665,sx*.697,sx*.730]:
            cylinder_x('cv_boot_ridge',(xx,.39,cz),.050,.011,'underbody',n=12)
        tube('steering_or_toe_link',[(sx*.38,.33,cz-.12),(sx*.765,.39,cz-.085)],.012,'alloy',segments=6)
        tube('wheel_brake_hose',[(sx*.61,.25,cz-.17),(sx*.63,.30,cz-.10),(sx*.65,.38,cz),(sx*.70,.40,cz+.04)],.006,'underbody',segments=6)
# Protected low-profile service routes stay above the undertray contact surface.
tube('cooling_route',[(-.16,.222,-1.29),(-.24,.212,-1.13),(-.56,.212,-1.07),(-.61,.212,-.70),(-.61,.212,.72),(-.53,.22,1.12),(-.15,.25,1.29)],.012,'dark_alloy',segments=6)
tube('insulated_power_route',[(.17,.235,-1.28),(.28,.235,-1.10),(.59,.22,-1.04),(.61,.215,.68),(.48,.225,1.12),(.19,.25,1.27)],.010,'red',segments=6)

# Lift ducts are recessed into the underfloor near the wheel tangent. Geometry and
# effect sockets share the exact aperture positions, so VFX never need magic offsets.
lift_socket_positions=[]
for sx,side in [(-.760,'l'),(.760,'r')]:
    for sz,axle in [(-2.040,'f'),(2.040,'r')]:
        lift_x=math.copysign(abs(sx)-(.020 if axle=='f' else 0),sx)
        n=64;vs=[]
        for yy,rr in [(.285,.061),(.205,.081),(.168,.088),(.158,.086),(.158,.066),(.245,.047),(.285,.061)]:
            vs += [(lift_x+rr*.88*cos(i*2*pi/n),yy,sz+rr*sin(i*2*pi/n)) for i in range(n)]
        fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(6) for i in range(n)]
        mesh('lift_nozzle_machined_bell',vs,fs,'shield',smooth=True)
        mesh('lift_nozzle_dark_throat',[(lift_x+.045*cos(i*2*pi/n),.247,sz+.045*sin(i*2*pi/n)) for i in range(n)],[tuple(range(n))],'carbon')
        chamfer_panel('lift_duct_mount',lift_x,sz,.178,.200,.267,.024,'underbody',.035)
        for dz in [-.075,.075]:bolt_y('lift_duct_mount_fastener',lift_x,.248,sz+dz,.010)
        lift_socket_positions.append(('thruster_'+axle+side,(lift_x,.158,sz)))
# Source-supported compact inboard coilovers and rocker linkage. Exact internal
# packaging is reconstructed for the game, not represented as factory engineering.
for z in wheel_z:
    for s in (-1,1):
        a=Vector((s*.12,.49,z+.07));b=Vector((s*.57,.49,z+.07))
        tube('inboard_damper_body',[tuple(a),tuple(b)],.035,'shield',segments=12)
        tube('inboard_damper_piston',[(s*.08,.49,z+.07),(s*.65,.49,z+.07)],.014,'alloy',segments=10)
        coil=[]
        for k in range(97):
            t=k/96;ang=12*pi*t;q=a+(b-a)*t;coil.append((q.x,q.y+.055*cos(ang),q.z+.055*sin(ang)))
        tube('inboard_damper_coil',coil,.008,'spring_gold',segments=8)
        tube('suspension_pushrod',[(s*.70,.33,z),(s*.59,.49,z+.07)],.017,'alloy',segments=8)
        # A shaped triangular bellcrank, machined pivot and bearing eye replace
        # the old generic vertical damper or block-shaped stand-in.
        yz=[(.398,z+.020),(.576,z+.028),(.615,z+.090),(.534,z+.170),(.444,z+.117)]
        verts=[(xx,y,zz) for xx in [s*.578,s*.622] for y,zz in yz];nn=len(yz)
        faces=[tuple(reversed(range(nn))),tuple(range(nn,nn*2))]+[(i,(i+1)%nn,(i+1)%nn+nn,i+nn) for i in range(nn)]
        mesh('suspension_cast_bellcrank',verts,faces,'dark_alloy',bevel=.006)
        for yy,zz in [(.55,z+.075),(.427,z+.055)]:
            cylinder_x('bellcrank_machined_pivot',(s*.626,yy,zz),.025,.014,'alloy',n=32)
            cylinder_x('bellcrank_recessed_bolt',(s*.637,yy,zz),.015,.005,'carbon',n=12)
        for x in [.120,.147,.174,.535]:
            cylinder_x('damper_threaded_adjuster',(s*x,.49,z+.07),.046,.012,'dark_alloy',n=32)
        for x in [.195,.527]:
            cylinder_x('coil_spring_perch',(s*x,.49,z+.07),.063,.016,'spring_gold',n=48)

# Cabin is independently authored, with no legacy stand-in boxes.
cabin_metadata={}
try:
    from roadster_cabin import build_cabin
    cabin_metadata=build_cabin(globals())
except ImportError:
    print('ROADSTER_CABIN_PENDING: silhouette review only')

# Coherent normals on each closed authored part.
for ob in objects:
    if ob.get('authored_normals'):continue
    bm=bmesh.new();bm.from_mesh(ob.data)
    if 'RDSTR' in ob.name or ob.get('material_group')=='rc_red':
        bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='BEAUTY')
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.0000001)
    if 'RDSTR' in ob.name or ob.get('material_group')=='rc_red':
        # Font outlines can contain collinear boundary points. Triangulate AFTER
        # cleanup, since dissolving edges can otherwise recreate the same ngons.
        bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='BEAUTY',ngon_method='BEAUTY')
        bmesh.ops.delete(bm,geom=[face for face in bm.faces if face.calc_area()<1e-10],context='FACES_ONLY')
    bmesh.ops.delete(bm,geom=[face for face in bm.faces if face.calc_area()<1e-13],context='FACES_ONLY')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update();bm.to_mesh(ob.data);bm.free();ob.data.update()

# Preserve each individual editable part in the .blend before export-only batching.
model_objects=list(bpy.context.scene.objects)
bpy.context.view_layer.update()
bounds=[o.matrix_world @ Vector(c) for o in model_objects if o.type=='MESH' for c in o.bound_box]
lo=[min(p[i] for p in bounds) for i in range(3)];hi=[max(p[i] for p in bounds) for i in range(3)]
asset_scale=4.7/(hi[1]-lo[1])
asset_root=bpy.data.objects.new('Roadster',None);bpy.context.collection.objects.link(asset_root)
for ob in model_objects:
    if ob.parent is None:ob.parent=asset_root
asset_root.scale=(asset_scale,)*3
asset_root.location=(-.5*(lo[0]+hi[0])*asset_scale,-.5*(lo[1]+hi[1])*asset_scale,-lo[2]*asset_scale)
measured_wheel_radius=max(math.hypot(vert.co.y,vert.co.z) for ob in model_objects if ob.type=='MESH' and ob.name.endswith('_tire') for vert in ob.data.vertices)
asset_root['wheelRadius']=measured_wheel_radius*asset_scale
asset_root['wheelRadiusUnscaled']=measured_wheel_radius
asset_root['assetScale']=asset_scale
asset_root['lengthMeters']=4.7
asset_root['coordinateConvention']='metres, game +Y up, -Z front; wheel local X spin, local Y steer'
asset_root['referenceBasis']='User supplied Rocket images and official public renderings; reconstructed proportions, not factory CAD'
asset_root['variant']='Rocket flying single-seat reference'
asset_root['wheelHierarchy']='steer carrier wheel_fl/fr/rl/rr; rotating child wheel_spin_fl/fr/rl/rr'
asset_root['wingPose']='Deployed rest pose; reconstructed nested lift sleeves, blade pitch and folding tips use explicit aeroStow extras; reference-led endpoints'
asset_root['mechanismBasis']='Visible proportions follow public images; hidden packaging and wing mechanism are inferred, not manufacturer CAD'
asset_root['cabinLayoutEvidence']=cabin_metadata.get('layout_evidence','Reference-reconstructed cabin')
if cabin_metadata.get('passenger_pressure_vessel'):
    vessel_info=dict(cabin_metadata['passenger_pressure_vessel'])
    vessel_info['measured_outer_mesh_volume_m3_scaled']=vessel_info['measured_outer_mesh_volume_m3']*asset_scale**3
    asset_root['passengerPressureVessel']=vessel_info
for name,position in lift_socket_positions:
    socket=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(socket);socket.parent=asset_root;socket.location=v(position);socket.empty_display_size=.05
    socket['direction']=[0,-1,0];socket['thrusterDirection']=[0,-1,0];socket['thrusterRole']='lift';socket['socketType']='lift_nozzle';socket['apertureRadius']=.066;model_objects.append(socket)
for i,sx in enumerate([-.399,-.135,.135,.399]):
    socket=bpy.data.objects.new('thruster_boost_'+str(i),None);bpy.context.collection.objects.link(socket);socket.parent=asset_root;socket.location=v((sx,.541,2.357));socket.empty_display_size=.04
    socket['thrusterDirection']=[0,0,1];socket['thrusterRole']='boost';socket['socketType']='rear_nozzle';socket['apertureRadius']=.035;model_objects.append(socket)
model_objects.append(asset_root)
for ob in model_objects:ob['asset_role']='roadster'
bpy.context.scene.unit_settings.system='METRIC';bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'art','roadster.blend'))

def join_group(obs,name):
    """Batch meshes sharing one material and motion parent after editable source save."""
    if not obs:return None
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:ob.select_set(True)
    bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();ob=bpy.context.object;ob.name=name
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return ob
def dedupe_export_triangles(ob):
    """Remove repeated or zero-area internal caps from the export-only batch.

    Closed editable parts have already been saved. Triangulate with preserved
    custom split normals, remove exact repeated triangles at 0.1 micrometre
    coordinate resolution, and retain every remaining corner's shading normal.
    Painted meshes have no UV maps or vertex-color layers to discard.
    """
    modifier=ob.modifiers.new('Stable export triangulation','TRIANGULATE')
    if hasattr(modifier,'keep_custom_normals'):modifier.keep_custom_normals=True
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.modifier_apply(modifier=modifier.name);ob.select_set(False)
    source=ob.data;seen=set();faces=[];normals=[];smooth=[];removed=0
    for face in source.polygons:
        a,b,c=(source.vertices[index].co for index in face.vertices)
        longest=max((b-a).length_squared,(c-a).length_squared,(c-b).length_squared)
        if (b-a).cross(c-a).length_squared<=longest*longest*1e-16:
            removed+=1;continue
        key=tuple(sorted(tuple(round(source.vertices[index].co[axis]*1e7) for axis in range(3)) for index in face.vertices))
        if key in seen:
            removed+=1;continue
        seen.add(key);faces.append(tuple(face.vertices));smooth.append(face.use_smooth)
        normals.extend(tuple(source.corner_normals[index].vector) for index in face.loop_indices)
    if not removed:return
    clean=bpy.data.meshes.new(source.name+'_clean_export');clean.from_pydata([tuple(vertex.co) for vertex in source.vertices],[],faces)
    for material in source.materials:clean.materials.append(material)
    clean.update()
    for face,value in zip(clean.polygons,smooth):face.use_smooth=value
    clean.normals_split_custom_set(normals);ob.data=clean
    print('ROADSTER_REMOVED_INTERNAL_DUPLICATE_TRIANGLES',ob.name,removed)

# No material/node name collision: export batches have semantic geometry roles.
parents=set(o.parent for o in objects if o.type=='MESH')
for parent in parents:
    for key in M:
        group=[o for o in list(bpy.context.scene.objects) if o.type=='MESH' and o.parent==parent and o.get('material_group')==key and o.name!='RC_Rocket_Passenger_Vessel_Approximate']
        if not group:continue
        static=parent==asset_root
        name=(key if key in ['body','glass','lights_red'] else 'detail_'+key) if static else parent.name+'_'+key
        batch=join_group(group,name)
        if key=='body':dedupe_export_triangles(batch)
model_objects=[o for o in bpy.context.scene.objects]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public','assets','roadster.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in model_objects if o.type=='MESH')
stats={'triangles':triangles,'meshes':sum(o.type=='MESH' for o in model_objects),'objects':len(model_objects),'wheelRadius':asset_root['wheelRadius'],'assetScale':asset_scale,'glbBytes':os.path.getsize(os.path.join(ROOT,'public','assets','roadster.glb'))}
print('ROADSTER_STATS',json.dumps(stats))
with open(os.path.join(PREVIEW,'stats.json'),'w') as f:json.dump(stats,f,indent=2)
if os.environ.get('ROADSTER_SKIP_RENDER')=='1':
    print('ROADSTER_EXPORT_COMPLETE');sys.exit(0)
# Studio previews. These helpers never enter the game asset or editable source.
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=int(os.environ.get('ROADSTER_SAMPLES','96')); scene.cycles.use_denoising=False
scene.render.resolution_x=int(os.environ.get('ROADSTER_RESOLUTION','1440'));scene.render.resolution_y=int(os.environ.get('ROADSTER_RESOLUTION_Y','960'));scene.render.resolution_percentage=100
scene.world.color=(.06,.06,.06)
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG'
# Opaque canopy previews keep the external silhouette legible but interior remains fully modeled.
def area(name,loc,energy,color,size,target=(0,.5,0),shape='DISK',size_y=None):
    """Add and return a preview-only area lamp aimed at a game-space target.

    Location/target and emitter dimensions are metres; energy is Blender lamp
    power in watts and color is RGB. Convert coordinates before aiming local
    -Z at the target; these lamps are created after model save/export.
    """
    dat=bpy.data.lights.new(name,'AREA');dat.energy=energy;dat.color=color;dat.shape=shape;dat.size=size
    if size_y:dat.size_y=size_y
    ob=bpy.data.objects.new(name,dat);bpy.context.collection.objects.link(ob);ob.location=v(loc);ob.rotation_euler=(v(target)-ob.location).to_track_quat('-Z','Y').to_euler();return ob
floor_mat=material('studio_ground',(.023,.029,.039),.05,.48)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.005));floor=bpy.context.object;floor.name='STUDIO floor';floor.data.materials.append(floor_mat)
area('key_softbox',(-3,6,-2),1100,(.80,.88,1),5,shape='RECTANGLE',size_y=3)
area('side_strip',(4,3,0),1100,(.84,.9,1),4,shape='RECTANGLE',size_y=1)
area('rear_rim',(-1.5,3.8,4),1300,(1,.77,.55),3,shape='RECTANGLE',size_y=2)
area('front_fill',(0,1.8,-5),250,(.7,.83,1),3)
camdat=bpy.data.cameras.new('Preview camera');cam=bpy.data.objects.new('Preview camera',camdat);bpy.context.collection.objects.link(cam);scene.camera=cam

def render(name,loc,target,lens=52,roll=0):
    """Render one named preview PNG unless ROADSTER_VIEWS filters it out.

    Set the shared camera from game-space metre coordinates, lens in mm and
    optional local-Z roll in radians. Mutate camera/render state and write to
    PREVIEW; return None without changing the already exported asset.
    """
    wanted=os.environ.get('ROADSTER_VIEWS','')
    if wanted and name not in wanted.split(','): return
    cam.location=v(loc);cam.rotation_euler=(v(target)-cam.location).to_track_quat('-Z','Y').to_euler();camdat.lens=lens;camdat.clip_start=.02
    if roll:cam.rotation_euler.rotate_axis('Z',roll)
    scene.render.filepath=os.path.join(PREVIEW,name+'.png');bpy.ops.render.render(write_still=True)
render('roadster-front-three-quarter',(6.3,2.35,-7.7),(0,.62,0),55)
render('roadster-side',(8.6,1.3,.0),(0,.62,0),56)
render('roadster-front',(0,1.25,-7.7),(0,.66,0),58)
render('roadster-rear',(0,1.20,7.7),(0,.65,0),58)
render('roadster-rear-three-quarter',(-5.9,2.25,7.3),(0,.62,.15),56)
# Camera sits inside, ahead of the rear bulkhead; light the ivory seat geometry softly.
area('cabin_softbox',(0,2.0,.2),100,(.9,.95,1),1.4,target=(0,.6,0))
render('roadster-interior',(0,1.0,.83),(0,.72,-.45),18)
# Open-top inspection: the glass and rails remain in the asset but are hidden for this render only.
bpy.data.objects['glass'].hide_render=True
render('roadster-cockpit-cutaway',(-2.4,3.2,-2.2),(0,.65,.05),58)
# Required underbody review: direct bottom and a barrel-roll angle, not only exterior hero views.
bpy.data.objects['glass'].hide_render=False
floor.hide_render=True
under_key=area('underbody_key',(-2.5,-4.0,-1.8),700,(.83,.91,1),4.0,target=(0,.22,0),shape='RECTANGLE',size_y=2.5)
under_fill=area('underbody_fill',(3.0,-2.5,2.0),450,(1,.91,.80),3.0,target=(0,.25,0),shape='RECTANGLE',size_y=2.5)
render('roadster-underbody',(0,-6.7,0),(0,.2,0),45,roll=pi/2)
under_key.hide_render=True;under_fill.hide_render=True
floor.hide_render=False
asset_root.rotation_euler.y=math.radians(-135)
asset_root.location.z+=1.65
render('roadster-roll-underside',(5.6,3.1,6.5),(-.30,1.25,.05),48)
print('ROADSTER_DELIVERABLES',os.path.join(ROOT,'public','assets','roadster.glb'),os.path.join(ROOT,'art','roadster.blend'),PREVIEW)
