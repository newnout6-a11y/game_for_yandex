"""Original game-ready electric roadster. Run with Blender 4.x --background --python.
Coordinates in all helpers are game axes: +Y up, -Z forward; exported glTF is metres.
No external models, materials, images or add-ons are required.
"""
import bpy, bmesh, math, os
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
M['body']=material('body',(.34,.38,.42),.82,.25)
M['body'].use_backface_culling=True
M['carbon']=material('satin_carbon',(.018,.023,.029),.32,.3)
M['wing']=material('carbon_wing',(.006,.008,.012),0,.78)
M['wing'].node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.06
M['rubber']=material('tire_rubber',(.013,.016,.020),0,.78)
M['alloy']=material('brushed_alloy',(.44,.50,.56),.93,.24)
M['dark_alloy']=material('graphite_alloy',(.035,.045,.055),.82,.26)
M['glass']=material('glass',(.018,.028,.035),.35,.19,alpha=.82)
M['ivory']=material('ivory_leather',(.86,.86,.80),0,.65)
M['suede']=material('graphite_suede',(.11,.13,.145),0,.86)
M['red']=material('interior_red',(.62,.012,.018),.15,.38)
M['lights_red']=material('lights_red',(.9,.008,.009),.15,.22,2.4)
M['lights_white']=material('LED_white',(.7,.88,1),.1,.15,3)
M['screen']=material('screen_black',(.004,.009,.016),.1,.23)
M['cyan']=material('screen_cyan',(.04,.65,.82),.1,.3,1)
M['body'].node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.5
# Underbody art direction is generic EV-inspired, not a manufacturer's engineering model.
# Two additional groups keep the floor matte instead of reflecting as a silver slab.
M['underbody']=material('underbody_matte_composite',(.012,.019,.025),.05,.82)
M['shield']=material('underbody_satin_cast_metal',(.075,.095,.112),.48,.60)
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
    for i,p in enumerate(pts):
        tangent=pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]; tangent.normalize()
        up=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((1,0,0))
        a=tangent.cross(up).normalized(); b=tangent.cross(a).normalized()
        for k in range(segments): vs.append(p+r*(a*cos(k*2*pi/segments)+b*sin(k*2*pi/segments)))
    for i in range(len(pts)-1):
        for k in range(segments): fs.append((i*segments+k,i*segments+(k+1)%segments,(i+1)*segments+(k+1)%segments,(i+1)*segments+k))
    fs.extend([tuple(reversed(range(segments))),tuple((len(pts)-1)*segments+k for k in range(segments))])
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
W=[(-2.35,.82),(-2.18,.91),(-1.5,1.01),(-.82,.975),(-.25,.947),(.55,.96),(1.43,1.025),(2.0,.99),(2.35,.925)]
H=[(-2.35,.65),(-2.12,.72),(-1.48,.88),(-.8,.84),(0,.80),(.65,.82),(1.46,.90),(1.9,.84),(2.35,.79)]
wheel_z=[-1.47,1.47]
# Body side panels explicitly follow open wheel arches, not a box over wheels.
zstations=set([-2.35,-2.18,-2.05,-1.95,-.95,-.82,-.6,-.25,0,.3,.55,.8,.95,1.95,2.10,2.35])
for c in wheel_z:
    for i in range(17): zstations.add(round(c-.445*cos(pi*i/16),6))
zs=sorted(zstations)
for s in [-1,1]:
    vs=[]
    for z in zs:
        w=lerp(z,W); top=lerp(z,H); bottom=.205
        for c in wheel_z:
            d=z-c
            if abs(d)<.445: bottom=max(bottom,.39+sqrt(max(0,.445**2-d*d)))
        bottom=min(bottom,top-.014)
        # Raised shoulder, crisp central crease, bevel sill.
        vs += [(s*w*.94,top,z),(s*w,top-(top-bottom)*.22,z),(s*w*.995,bottom+(top-bottom)*.38,z),(s*w*(.945+.05*min(1,(bottom-.205)/.18)),bottom,z)]
    fs=[]
    for i in range(len(zs)-1):
        for j in range(3):fs.append((4*i+j,4*i+j+1,4*(i+1)+j+1,4*(i+1)+j))
    if s<0:fs=[tuple(reversed(f)) for f in fs]
    # Split the three sheet-metal strips at the designed longitudinal creases.
    # Normals stay smooth along the car, not across the hard crease.
    sv=[];sf=[]
    for j in range(3):
        off=len(sv)
        for i in range(len(zs)):sv.extend([vs[4*i+j],vs[4*i+j+1]])
        for i in range(len(zs)-1):
            f=(off+i*2,off+i*2+1,off+i*2+3,off+i*2+2)
            sf.append(f if s>0 else tuple(reversed(f)))
    mesh('sculpted_side',sv,sf,'body',smooth=True)
    # Wheel-arch lips with an inward-return surface reveal the opening thickness.
    for c in wheel_z:
        ring=[]
        for i in range(25):
            a=pi*i/24; zz=c-.445*cos(a); yy=.39+.445*sin(a); xx=lerp(zz,W)*.995
            ring += [(s*xx,yy,zz),(s*(xx-.055),yy-.015,zz)]
        mesh('wheel_arch_return',ring,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(24)],'carbon')
        # Fine body colored rolled edge.
        tube('fender_edge',[(s*(lerp(c-.449*cos(pi*i/24),W)*.998),.39+.449*sin(pi*i/24),c-.449*cos(pi*i/24)) for i in range(25)],.012,'body')
    # Low full-length rocker blends the floor with sculpted door side.
    beam('carbon_sill',(s*.93,.22,-.99),(s*.94,.22,.98),.095,.07,'carbon')
    tube('door_shutline',[(s*.965,.805,-.78),(s*.965,.59,-.76),(s*.94,.29,-.66),(s*.94,.275,.62),(s*.984,.60,.94),(s*.98,.82,.97)],.004,'carbon',segments=5)
    box('flush_door_handle',(s*.974,.735,.57),(.009,.025,.15),'dark_alloy',.008)
    # Angular rear quarter cooling vent.
    mesh('quarter_intake',[(s*.976,.55,.75),(s*1.00,.71,1.04),(s*.974,.71,.73),(s*.948,.40,.72)],[(0,1,2,3)],'carbon')
    # Narrow camera mirrors, not oversized blocks.
    beam('mirror_stalk',(s*.87,.88,-.66),(s*1.055,.92,-.68),.025,.022,'carbon')
    box('mirror_housing',(s*1.075,.925,-.69),(.16,.07,.17),'body',.025)
    box('mirror_lens',(s*1.078,.925,-.605),(.118,.042,.008),'alloy',.008)
# Contoured hood and rear deck. A central crease and outer crown articulate the sheet metal.
for name,start,end in [('hood',-2.35,-.79),('rear_deck',1.13,2.35)]:
    rows=sorted(set([start,end]+[z for z in zs if start<z<end])); vs=[]
    fractions=[-1,-.77,-.32,0,.32,.77,1]
    for z in rows:
        w=lerp(z,W)*.94; h=lerp(z,H)
        for t in fractions:
            crown=(1-abs(t))*.038*min(1,(z-start)/.25 if name=='hood' else (end-z)/.25)
            vs.append((w*t,h+crown,z))
    fs=[(i*7+j,i*7+j+1,(i+1)*7+j+1,(i+1)*7+j) for i in range(len(rows)-1) for j in range(6)]
    mesh(name,vs,fs,'body',smooth=True)
for s in [-1,1]:
    tube('hood_panel_gap',[(s*.59,.687,-2.26),(s*.67,.76,-1.97),(s*.71,.868,-1.45),(s*.71,.86,-.83)],.0035,'carbon',segments=5)
    # Silver flying buttresses flank the sloping rear glazing.
    mesh('rear_buttress',[(s*.69,1.245,.57),(s*.80,1.15,.83),(s*.93,.86,1.37),(s*.79,.88,1.40),(s*.60,1.21,.62)],[(0,1,2,3,4)],'body')
# Front prow: chamfered nose, inset black intake and thin LED signature.
mesh('front_prow',[(-.82,.65,-2.35),(.82,.65,-2.35),(.88,.38,-2.30),(.76,.29,-2.25),(-.76,.29,-2.25),(-.88,.38,-2.30)],[(0,1,2,3,4,5)],'carbon')
mesh('front_upper_blade',[(-.82,.653,-2.35),(.82,.653,-2.35),(.80,.59,-2.36),(-.80,.59,-2.36)],[(0,1,2,3)],'body')
tube('front_light_signature',[(-.82,.642,-2.36),(-.45,.63,-2.372),(0,.627,-2.378),(.45,.63,-2.372),(.82,.642,-2.36)],.009,'lights_white')
box('front_intake', (0,.425,-2.315),(1.39,.20,.05),'carbon',.025)
for s in [-1,1]:
    # Side shell already closes this corner: no overlapping fascia face.
    tube('front_corner_led',[(s*.824,.645,-2.352),(s*.88,.686,-2.23),(s*.9,.702,-2.18)],.009,'lights_white')
    # Main front intake is continuous; no intersecting corner inserts.
mesh('front_splitter',[(-.93,.21,-2.37),(.93,.21,-2.37),(.97,.20,-2.15),(.87,.17,-2.11),(-.87,.17,-2.11),(-.97,.20,-2.15)],[(0,1,2,3,4,5)],'carbon')
# A continuous shaped floor sits behind individually modeled shields and mechanisms.
# It narrows around each wheel bay: no full-length featureless rectangle and no open cabin holes.
floor_outline=[(-.73,-2.22),(.73,-2.22),(.67,-1.90),(.51,-1.73),(.51,-1.20),
    (.77,-.97),(.79,.98),(.52,1.22),(.52,1.76),(.69,2.19),(-.69,2.19),
    (-.52,1.76),(-.52,1.22),(-.79,.98),(-.77,-.97),(-.51,-1.20),(-.51,-1.73),(-.67,-1.90)]
prism_xz('continuous_shaped_floor',floor_outline,.247,.278,'underbody')
# Deep perimeter battery frame; the individual covers are recessed behind the frame's lower face.
chamfer_panel('battery_enclosure',(0),.02,1.39,2.13,.188,.055,'underbody',.13)
for sx in [-1,1]:
    box('battery_perimeter_rail',(sx*.699,.183,.02),(.072,.112,2.16),'shield',.008)
    box('rocker_crash_rail',(sx*.837,.242,.01),(.105,.12,2.17),'underbody',.01)
    box('rocker_rail_wear_strip',(sx*.837,.179,.01),(.057,.012,1.97),'shield',0)
    # Small drain/fastener recesses and the line duct along each protected edge.
    tube('protected_line_duct',[(sx*.768,.205,-1.01),(sx*.768,.205,-.76),(sx*.773,.205,.76),(sx*.768,.205,1.05)],.017,'underbody',segments=6)
    tube('brake_line_main',[(sx*.776,.185,-1.06),(sx*.776,.185,-.75),(sx*.78,.185,.76),(sx*.772,.19,1.10)],.005,'alloy',segments=5)
for zz in [-1.047,1.087]:box('battery_end_rail',(0,.18,zz),(1.37,.09,.075),'shield',.008)
box('battery_center_spine',(0,.164,.02),(.055,.052,2.06),'underbody',.004)
for zz in [-.66,.02,.70]:
    for xx in [-.337,.337]:
        # Octagonal corners, real depth and separation keep the six sections legible from a roll view.
        chamfer_panel('recessed_battery_shield',xx,zz,.596,.618,.163,.023,'shield',.052)
        chamfer_panel('battery_shield_inner_pressing',xx,zz,.498,.48,.157,.008,'underbody',.055)
        for dx in [-.14,.14]:
            box('shield_pressed_rib',(xx+dx,.150,zz),(.015,.012,.36),'shield',0)
    box('battery_cross_reinforcement',(0,.145,zz+.325),(1.34,.025,.032),'underbody',0)
for xx in [-.654,.654]:
    for zz in [-.99,-.66,-.33,.02,.37,.70,1.03]:bolt_y('battery_frame_fastener',xx,.122,zz)
# Dedicated front service shield and a rear diffuser transition, rather than one generic floor panel.
chamfer_panel('front_service_shield',0,-1.98,1.24,.43,.205,.025,'underbody',.12)
chamfer_panel('front_service_access',0,-1.98,.50,.24,.195,.012,'shield',.045)
for xx in [-.43,0,.43]:
    box('front_aero_strake',(xx,.176,-2.00),(.02,.055,.38),'underbody',0)
for xx in [-.48,.48]:
    for zz in [-2.12,-1.84]:bolt_y('front_cover_fastener',xx,.191,zz,.011)
mesh('rear_diffuser_ramp',[(-.68,.205,1.76),(.68,.205,1.76),(.80,.315,2.32),(-.80,.315,2.32),
                         (-.68,.235,1.76),(.68,.235,1.76),(.80,.345,2.32),(-.80,.345,2.32)],
     [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],'underbody')
# Two cast subframes, simplified e-drive housings, half-shafts and double-wishbone silhouettes.
# These are a plausible original visual design, not a claim about the reference car's mechanisms.
for zi,cz in enumerate(wheel_z):
    tube('subframe_perimeter',[(-.49,.27,cz-.24),(.49,.27,cz-.24),(.53,.27,cz+.22),
        (-.53,.27,cz+.22),(-.49,.27,cz-.24)],.047,'shield',segments=6)
    tube('subframe_crossmember',[(-.49,.255,cz),(.49,.255,cz)],.044,'underbody',segments=6)
    chamfer_panel('e_drive_lower_housing',0,cz,.48,.39,.226,.115,'shield',.10)
    chamfer_panel('e_drive_service_cap',0,cz,.22,.25,.214,.014,'underbody',.055)
    for zz in [cz-.12,cz-.04,cz+.04,cz+.12]:
        box('e_drive_cast_rib',(0,.211,zz),(.35,.023,.014),'underbody',0)
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
        # Damper shaft and short coil, without a heavy high-poly mechanism.
        a=(sx*.50,.59,cz+.08); b=(sx*.745,.35,cz+.02)
        tube('suspension_damper',[a,b],.030,'underbody',segments=8)
        av=Vector(a);bv=Vector(b);axis=(bv-av).normalized();ref=Vector((0,0,1));u=axis.cross(ref).normalized();w=axis.cross(u).normalized()
        coil=[]
        for k in range(25):
            t=.16+.65*k/24; ang=6*pi*k/24; q=av+(bv-av)*t+.048*(u*cos(ang)+w*sin(ang));coil.append(tuple(q))
        tube('suspension_coil',coil,.009,'shield',segments=5)
        tube('wheel_brake_hose',[(sx*.73,.20,cz-.20),(sx*.75,.30,cz-.17),(sx*.78,.45,cz-.10),(sx*.81,.42,cz+.15)],.006,'underbody',segments=5)
# Protected low-profile cooling/cable routes run alongside the battery, not across the contact surface.
tube('cooling_route',[(-.16,.222,-1.29),(-.24,.212,-1.13),(-.56,.212,-1.07),(-.61,.212,-.70),(-.61,.212,.72),(-.53,.22,1.12),(-.15,.25,1.29)],.012,'dark_alloy',segments=6)
tube('insulated_power_route',[(.17,.235,-1.28),(.28,.235,-1.10),(.59,.22,-1.04),(.61,.215,.68),(.48,.225,1.12),(.19,.25,1.27)],.010,'red',segments=6)
# Thruster mounting lugs attach each socket's duct to the axle-area subframe.
# Aperture centers and socket transforms intentionally remain unchanged for the game's VFX.
for sx in [-1,1]:
  for cz in [-1.35,1.35]:
    chamfer_panel('thruster_inboard_mount',sx*.556,cz,.21,.285,.213,.035,'shield',.035)
    for dz in [-.102,.102]:
        bolt_y('thruster_mount_fastener',sx*.57,.194,cz+dz,.014)
        tube('thruster_mount_rib',[(sx*.48,.24,cz+dz),(sx*.664,.235,cz+dz)],.016,'underbody',segments=6)
    # Oval collar keeps the outboard edge inside the tire while exposing a deep, dark throat.
    vs=[];n=24
    for yy,rx,rz in [(.218,.098,.133),(.204,.098,.133),(.204,.079,.106),(.248,.070,.087)]:
        vs.extend([(sx*.67+rx*cos(i*2*pi/n),yy,cz+rz*sin(i*2*pi/n)) for i in range(n)])
    mesh('thruster_mount_collar',vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)],'shield',smooth=True)

# Panoramic greenhouse; all glass is explicitly separated from paint.
# Structured curved panes prevent triangulation glints across large glass n-gons.
for pane in ['windshield','panoramic_roof','rear_glass']:
    vs=[]; nx=10; nz=6
    for row in range(nz+1):
        u=row/nz
        for col in range(nx+1):
            t=col/nx*2-1; bow=1-t*t
            if pane=='windshield':
                xx=(.78*(1-u)+.66*u)*t
                yy=(.865+.012*bow)*(1-u)+(1.252+.048*bow)*u
                zz=-.79*(1-u)+(-.04-.05*bow)*u
            elif pane=='panoramic_roof':
                xx=(.66*(1-u)+.65*u)*t
                yy=1.252+.048*bow+.007*sin(pi*u)
                zz=(-.04-.05*bow)*(1-u)+(.61+.05*bow)*u
            else:
                xx=(.65*(1-u)+.78*u)*t
                yy=(1.25+.05*bow)*(1-u)+(.885+.01*bow)*u
                zz=(.61+.05*bow)*(1-u)+1.35*u
            vs.append((xx,yy,zz))
    fs=[(row*(nx+1)+col,row*(nx+1)+col+1,(row+1)*(nx+1)+col+1,(row+1)*(nx+1)+col) for row in range(nz) for col in range(nx)]
    mesh(pane,vs,fs,'glass',smooth=True)
for s in [-1,1]:
    side=[(s*.804,.848,-.76),(s*.692,1.235,-.015),(s*.683,1.235,.57),(s*.844,.867,1.16),(s*.922,.842,.90)]
    mesh('side_glazing',side,[(0,1,2,3,4)],'glass')
    tube('silver_a_pillar',[(s*.80,.85,-.79),(s*.746,1.04,-.4),(s*.675,1.254,-.035)],.018,'body')
    tube('roof_side_rail',[(s*.675,1.254,-.035),(s*.673,1.268,.34),(s*.67,1.252,.61)],.022,'body')
    tube('window_weather_seal',[(s*.804,.848,-.76),(s*.692,1.235,-.015),(s*.683,1.235,.57),(s*.844,.867,1.16),(s*.922,.842,.90),(s*.804,.848,-.76)],.012,'carbon')
    tube('window_separator',[(s*.70,1.205,.63),(s*.89,.85,.72)],.015,'carbon')
# Rear fascia, full-width light bar and aerodynamic wing.
mesh('rear_fascia',[(-.925,.79,2.35),(.925,.79,2.35),(.91,.47,2.33),(.77,.34,2.32),(-.77,.34,2.32),(-.91,.47,2.33)],[(0,1,2,3,4,5)],'body')
mesh('rear_dark_valance',[(-.90,.65,2.36),(.90,.65,2.36),(.87,.36,2.37),(-.87,.36,2.37)],[(0,1,2,3)],'carbon')
tube('rear_light_housing',[(-.913,.756,2.357),(-.55,.775,2.369),(0,.78,2.375),(.55,.775,2.369),(.913,.756,2.357)],.034,'carbon')
tube('continuous_rear_led',[(-.916,.761,2.378),(-.55,.780,2.390),(0,.785,2.396),(.55,.780,2.390),(.916,.761,2.378)],.017,'lights_red',segments=8)
box('rear_plate',(0,.626,2.381),(.34,.105,.014),'dark_alloy',.01)
# Rear grille vanes.
for j in range(3):
    box('rear_grille',(0,.46+j*.035,2.385),(1.60,.014,.02),'dark_alloy',.004)
for xx in [-.52,-.19,.19,.52]:
    cylinder_z('exhaust_metal_lip',(xx,.563,2.37),.053,.095,'alloy')
    cylinder_z('exhaust_dark_bore',(xx,.563,2.422),.041,.003,'carbon')
for xx in [-.72,-.48,-.24,0,.24,.48,.72]:
    mesh('diffuser_fin',[(xx-.012,.18,1.85),(xx+.012,.18,1.85),(xx+.012,.34,2.39),(xx-.012,.34,2.39),(xx-.012,.17,2.39),(xx+.012,.17,2.39)],[(0,1,2,3),(3,2,5,4),(0,3,4),(1,5,2)],'carbon')
for s in [-1,1]:
    mesh('wing_upright',[(s*.57,.84,1.89),(s*.57,1.16,1.99),(s*.57,1.15,2.10),(s*.57,.83,2.02)],[(0,1,2,3)],'carbon',bevel=0)
    # Tip plates have real thickness.
    box('wing_endplate',(s*1.005,1.164,2.02),(.022,.18,.40),'wing',.01)
# Airfoil loft cross-section across x.
wing_vs=[]
for xx in [-1,-.65,0,.65,1]:
    yy=1.19+.02*(1-abs(xx))
    wing_vs += [(xx,yy-.016,1.83),(xx,yy+.027,1.93),(xx,yy+.02,2.11),(xx,yy+.005,2.20),(xx,yy-.025,2.11),(xx,yy-.029,1.94)]
wing_fs=[(i*6+j,i*6+(j+1)%6,(i+1)*6+(j+1)%6,(i+1)*6+j) for i in range(4) for j in range(6)]+[tuple(reversed(range(6))),tuple(range(24,30))]
mesh('wing_airfoil',wing_vs,wing_fs,'wing')
# Cockpit is a finished interior with a floor, center tunnel and inset door cards.
box('cabin_carpet',(0,.305,.15),(1.60,.09,1.91),'suede',.03)
box('rear_cabin_wall',(0,.63,1.03),(1.50,.58,.10),'carbon',.045)
box('center_tunnel',(0,.45,.21),(.22,.29,1.52),'carbon',.045)
box('ivory_armrest',(0,.635,.48),(.26,.10,.63),'ivory',.045)
for s in [-1,1]:
    x=s*.825
    mesh('door_card',[(x,.34,-.57),(x,.79,-.64),(x,.815,.73),(x,.46,.91)],[(0,1,2,3)],'carbon')
    mesh('door_ivory_inlay',[(x-s*.008,.55,-.54),(x-s*.008,.74,-.58),(x-s*.008,.755,.57),(x-s*.008,.64,.77),(x-s*.008,.55,.63)],[(0,1,2,3,4)],'ivory')
    tube('door_ambient_red',[(x-s*.014,.55,-.53),(x-s*.014,.69,-.50),(x-s*.014,.71,.52),(x-s*.014,.65,.72)],.009,'red')
    box('door_armrest',(s*.762,.51,.27),(.12,.07,.62),'carbon',.022)
    box('door_pull',(s*.763,.66,-.25),(.017,.026,.14),'alloy',.009)
    # Seats: integrated tapered racing shell, pale bolsters, contrasting center pads.
    cx=s*.43
    poly=[(cx-.23,.42),(cx-.25,.62),(cx-.22,.84),(cx-.17,1.02),(cx-.11,1.12),(cx+.11,1.12),(cx+.17,1.02),(cx+.22,.84),(cx+.25,.62),(cx+.23,.42)]
    shell=extrude_xy('seat_carbon_shell',poly,.52,.65,'carbon',.027)
    # Tilt the full-height back to a sporting recline around the lower back.
    for vert in shell.data.vertices: vert.co.y -= max(0,vert.co.z-.43)*.18
    backpoly=[(cx-.15,.48),(cx-.18,.70),(cx-.16,.86),(cx-.11,.99),(cx+.11,.99),(cx+.16,.86),(cx+.18,.70),(cx+.15,.48)]
    pad=extrude_xy('seat_back_pad',backpoly,.484,.56,'ivory',.03)
    for vert in pad.data.vertices:vert.co.y-=max(0,vert.co.z-.43)*.18
    box('seat_cushion',(cx,.42,.17),(.40,.105,.64),'suede',.05)
    for a in [-1,1]:
        bolster=box('seat_lower_bolster',(cx+a*.20,.475,.20),(.095,.16,.64),'ivory',.045)
        beam('seat_back_bolster',(cx+a*.205,.47,.53),(cx+a*.165,.89,.63),.095,.10,'ivory')
    box('integrated_headrest',(cx,1.047,.63),(.255,.20,.115),'ivory',.055)
    box('harness_slot',(cx,.947,.565),(.18,.055,.012),'carbon',.02)
    box('harness_red_detail',(cx,.942,.556),(.10,.009,.008),'red',.003)
    box('seatbelt_buckle',(cx-s*.23,.47,.25),(.04,.065,.06),'carbon',.008)
    box('buckle_red_release',(cx-s*.23,.502,.25),(.027,.008,.038),'red',.003)
    tube('shoulder_belt',[(cx+s*.20,.48,.58),(cx+s*.20,.84,.66),(cx+s*.15,1.04,.71)],.018,'carbon')
# Dashboard is a multi-level sculpted surface.
mesh('dash_top',[(-.77,.835,-.74),(.77,.835,-.74),(.76,.79,-.44),(.25,.77,-.40),(-.25,.77,-.40),(-.76,.79,-.44)],[(0,1,2,3,4,5)],'suede')
mesh('dash_front',[(-.76,.79,-.44),(-.25,.77,-.40),(.25,.77,-.40),(.76,.79,-.44),(.75,.61,-.51),(-.75,.61,-.51)],[(0,1,2,3,4,5)],'carbon')
tube('dashboard_alloy_line',[(-.76,.759,-.423),(-.22,.739,-.383),(.25,.739,-.383),(.76,.759,-.423)],.008,'alloy')
for s in [-1,1]:
    box('air_vent',(s*.65,.727,-.428),(.20,.037,.01),'screen',.008)
    for j in range(3):box('vent_slat',(s*.65,.714+j*.01,-.418),(.18,.002,.005),'alloy',.001)
# Driver yoke: a squared-off, open racing wheel with pale grips.
beam('steering_column',(-.42,.69,-.49),(-.42,.75,-.25),.075,.075,'carbon')
box('yoke_hub',(-.42,.765,-.18),(.17,.13,.067),'carbon',.025)
for s in [-1,1]:
    tube('yoke_frame',[(-.42+s*.07,.715,-.173),(-.42+s*.185,.69,-.17),(-.42+s*.218,.74,-.17),(-.42+s*.213,.88,-.17),(-.42+s*.145,.902,-.17),(-.42+s*.09,.87,-.17)],.023,'alloy')
    tube('yoke_grip',[(-.42+s*.207,.724,-.17),(-.42+s*.218,.78,-.17),(-.42+s*.205,.866,-.17)],.032,'ivory')
    beam('yoke_spoke',(-.42+s*.07,.79,-.18),(-.42+s*.18,.84,-.18),.04,.025,'carbon')
    box('yoke_button',(-.42+s*.135,.815,-.143),(.035,.025,.008),'screen',.007)
# Large central floating tablet and the slim portrait console below it.
box('tablet_bezel',(.075,.827,-.295),(.37,.25,.028),'carbon',.017)
box('tablet_display',(.075,.828,-.278),(.34,.22,.006),'screen',.012)
box('console_phone',(0,.622,-.18),(.155,.019,.27),'alloy',.014)
box('console_phone_display',(0,.634,-.18),(.13,.006,.24),'screen',.01)
# Screen UI geometry avoids texture files while staying crisp in close-up.
for i in range(4):box('screen_ui_line',(.133,.874-i*.027,-.272),(.16-(i%2)*.04,.006,.003),'cyan',.002)
for i in range(5):box('screen_status_bar',(-.035+i*.055,.743,-.271),(.025,.006,.003),'ivory',.002)
# Tiny 3D schematic car on the tablet, and a segmented speed readout.
box('screen_vehicle',(-.043,.833,-.270),(.052,.095,.003),'alloy',.01)
for side in [-1,1]:
    for yy in [.802,.86]:box('screen_vehicle_wheel',(-.043+side*.03,yy,-.269),(.012,.022,.003),'cyan',.003)
# Rearview mirror and pedals complete views from inside.
box('rearview_mirror',(0,1.04,-.30),(.23,.065,.04),'carbon',.015)
box('rearview_glass',(0,1.04,-.277),(.20,.046,.003),'alloy',.008)
for xx in [-.49,-.35]:box('pedal',(xx,.385,-.64),(.065,.10,.025),'alloy',.007)
# Wheels. Pivot empties have identity rotation so glTF consumers spin local X / steer local Y.
for side in [-1,1]:
  for iz,zz in enumerate(wheel_z):
    side_name='l' if side<0 else 'r'; axle='f' if iz==0 else 'r'; name='wheel_'+axle+side_name
    pivot=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(pivot); pivot.location=v((side*.91,.39,zz)); pivot.empty_display_size=.12
    n=48; profile=[(-.148,.29),(-.148,.332),(-.13,.363),(-.10,.378),(-.075,.382),(-.066,.377),(-.057,.382),(-.023,.383),(-.016,.378),(-.008,.383),(.027,.383),(.035,.378),(.043,.383),(.079,.382),(.087,.377),(.095,.379),(.13,.363),(.148,.332),(.148,.29)]
    vs=[]
    for xx,rr in profile:vs += [(xx,rr*cos(2*pi*i/n),rr*sin(2*pi*i/n)) for i in range(n)]
    fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(profile)-1) for i in range(n)]
    mesh('tire',vs,fs,'rubber',pivot,smooth=True)
    cylinder_x('rim_barrel',(0,0,0),.297,.265,'dark_alloy',pivot)
    ox=side*.153
    cylinder_x('brake_disc',(side*.115,0,0),.247,.012,'alloy',pivot)
    # Outer alloy rim lip, thin enough to retain the dark spokes' negative space.
    tube('rim_lip',[(ox,.287*cos(2*pi*i/48),.287*sin(2*pi*i/48)) for i in range(49)],.012,'alloy',pivot,segments=6)
    cylinder_x('hub',(ox,0,0),.072,.02,'dark_alloy',pivot,n=32)
    # Five split-spoke pairs with a subtle swept shape.
    for k in range(5):
      angle=k*2*pi/5+.12
      for fork in [-1,1]:
        a=angle+fork*.07
        yz=[(.065*cos(a),.065*sin(a)),(.278*cos(a+fork*.115),.278*sin(a+fork*.115)),(.277*cos(a+fork*.115+.075),.277*sin(a+fork*.115+.075)),(.075*cos(a+.21),.075*sin(a+.21))]
        spvs=[(xx,yy,z) for xx in [ox-side*.011,ox+side*.011] for yy,z in yz]
        mesh('rim_spoke',spvs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'alloy',pivot,bevel=.003)
    cylinder_x('wheel_center',(ox+side*.015,0,0),.043,.009,'alloy',pivot,n=24)
    for k in range(5):
        a=k*2*pi/5; cylinder_x('lug',(ox+side*.018,.055*cos(a),.055*sin(a)),.008,.008,'alloy',pivot,n=8)
    # Fixed calipers are intentionally not parented to the spinning tire.
    box('red_brake_caliper',(side*1.025,.40,zz+.20),(.045,.19,.073),'red',.015)
# Four ducted rear fans and four underside cold-gas nozzles reference the flight package.
for xx in [-.52,-.19,.19,.52]:
    cylinder_z('rear_fan_housing',(xx,.366,2.384),.095,.035,'dark_alloy')
    cylinder_z('rear_fan_well',(xx,.366,2.407),.079,.008,'carbon')
    for k in range(7):
        a=k*2*pi/7
        mesh('rear_fan_blade',[(xx+.018*cos(a),.366+.018*sin(a),2.415),
             (xx+.075*cos(a+.4),.366+.075*sin(a+.4),2.415),
             (xx+.073*cos(a+.85),.366+.073*sin(a+.85),2.415),
             (xx+.025*cos(a+.8),.366+.025*sin(a+.8),2.415)],[(0,1,2,3)],'dark_alloy')
    cylinder_z('rear_fan_hub',(xx,.366,2.419),.021,.012,'alloy',n=20)
for xx in [-.67,.67]:
  for zz in [-1.35,1.35]:
    vs=[]; n=32
    for yy,rr in [(.28,.075),(.19,.105),(.17,.105),(.17,.077),(.245,.055)]:
        vs += [(xx+rr*.90*cos(i*2*pi/n),yy,zz+rr*sin(i*2*pi/n)) for i in range(n)]
    fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(4) for i in range(n)]
    mesh('underside_thruster',vs,fs,'dark_alloy',smooth=True)
    mesh('thruster_dark_core',[(xx+.05*cos(i*2*pi/n),.246,zz+.05*sin(i*2*pi/n)) for i in range(n)],[tuple(range(n))],'carbon')

# The reference has a low, single-arc greenhouse, not an upright passenger cabin.
canopy_names={'windshield','panoramic_roof','rear_glass','side_glazing','silver_a_pillar','roof_side_rail','window_weather_seal','window_separator','rear_buttress'}
for ob in objects:
    if ob.name.split('.')[0] in canopy_names:
        for vert in ob.data.vertices:
            if vert.co.z>.84: vert.co.z=.84+(vert.co.z-.84)*.80

# Author correct outward winding, including open body sheets. glTF consumers may use
# FrontSide paint instead of Blender's permissive double-sided material defaults.
up_panels={'hood','rear_deck','dash_top','front_splitter','panoramic_roof'}
front_panels={'front_prow','front_upper_blade'}
back_panels={'rear_fascia','rear_dark_valance','rear_fan_blade','dash_front'}
side_panels={'sculpted_side','rear_buttress','side_glazing','quarter_intake','wing_upright'}
inside_panels={'door_card','door_ivory_inlay'}
for ob in objects:
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    name=ob.name.split('.')[0]
    for face in bm.faces:
        target=None
        if name in up_panels:target=Vector((0,0,1))
        elif name in front_panels:target=Vector((0,1,0))
        elif name in back_panels:target=Vector((0,-1,0))
        elif name=='windshield':target=Vector((0,1,1))
        elif name=='rear_glass':target=Vector((0,-1,1))
        elif name in side_panels:target=Vector((1 if face.calc_center_median().x>=0 else -1,0,0))
        elif name in inside_panels:target=Vector((-1 if face.calc_center_median().x>=0 else 1,0,0))
        if target is not None and face.normal.dot(target)<0:face.normal_flip()
    bm.normal_update();bm.to_mesh(ob.data);bm.free();ob.data.update()

# Merge static components by material and wheel components within their pivot.
# This preserves semantic mesh names while keeping material/draw-call overhead low.
def join_group(obs,name):
    """Join a nonempty object group, rename it, and return the surviving mesh.

    The first object is active and supplies the retained parent/local frame;
    callers therefore group by material and wheel pivot. Apply scale only,
    change Blender selection, and return None when the group is empty.
    """
    if not obs:return
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:ob.select_set(True)
    bpy.context.view_layer.objects.active=obs[0]; bpy.ops.object.join(); ob=bpy.context.object; ob.name=name
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return ob
static_groups={key:[o for o in objects if o.parent is None and o.get('material_group')==key] for key in M}
for key,group in static_groups.items():
    join_group(group,key if key in ['body','glass','lights_red'] else 'detail_'+key)
for name in ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']:
    pivot=bpy.data.objects[name]
    for key in ['rubber','alloy','dark_alloy']:
        join_group([o for o in list(pivot.children) if o.get('material_group')==key],name+'_'+key)
# Store only the model in the editable source and in glTF export.
model_objects=[o for o in bpy.context.scene.objects]
bpy.context.view_layer.update()
bounds=[o.matrix_world @ Vector(c) for o in model_objects if o.type=='MESH' for c in o.bound_box]
lo=[min(p[i] for p in bounds) for i in range(3)]; hi=[max(p[i] for p in bounds) for i in range(3)]
asset_scale=4.7/(hi[1]-lo[1])
asset_root=bpy.data.objects.new('Roadster',None);bpy.context.collection.objects.link(asset_root)
for ob in model_objects:
    if ob.parent is None:ob.parent=asset_root
asset_root.scale=(asset_scale,)*3
asset_root.location=(-.5*(lo[0]+hi[0])*asset_scale,-.5*(lo[1]+hi[1])*asset_scale,-lo[2]*asset_scale)
# Named non-rendering sockets support cold-gas VFX without fragile magic offsets.
for sx,side in [(-.67,'l'),(.67,'r')]:
    for sz,axle in [(-1.35,'f'),(1.35,'r')]:
        socket=bpy.data.objects.new('thruster_'+axle+side,None);bpy.context.collection.objects.link(socket)
        socket.parent=asset_root;socket.location=v((sx,.17,sz));socket.empty_display_size=.05
        model_objects.append(socket)
model_objects.append(asset_root)
for ob in model_objects:
    ob['asset_role']='roadster'
bpy.ops.object.select_all(action='DESELECT')
for ob in model_objects:ob.select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects['body']
bpy.context.scene.unit_settings.system='METRIC'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'art','roadster.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public','assets','roadster.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in model_objects if o.type=='MESH')
print('ROADSTER_STATS',len(model_objects),'objects',triangles,'triangles')
# Studio previews. These helpers never enter the game asset or editable source.
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=int(os.environ.get('ROADSTER_SAMPLES','96')); scene.cycles.use_denoising=False
scene.render.resolution_x=1600;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
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
