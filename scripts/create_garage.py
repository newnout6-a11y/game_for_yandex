"""Original four-tier performance workshops, authored in metres in Blender.
Run: blender -b --python scripts/create_garage.py -- --tiers 1 2 3 4 --render
Coordinates: +Y up, -Z front. GLBs contain no cars, cameras or runtime lights.
Editable .blend sources preserve named parts; GLB meshes are consolidated by material.
Garage geometry, pictograms and surface maps are original procedural artwork.
The TV poster is derived from a user-supplied third-party Tesla video; no
redistribution license or endorsement is asserted. Assembly seed is 9349; physically scaled surface maps use garage_surface_finish.py.
"""
import bpy, bmesh, math, os, sys, json, random, hashlib, argparse
import numpy as np
from mathutils import Vector
from math import sin, cos, pi
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(ROOT,'scripts'))
from sanitize_blend_sources import save_portable
ART=os.path.join(ROOT,'art','garage'); OUT=os.path.join(ROOT,'public','assets','garage')
os.makedirs(ART,exist_ok=True); os.makedirs(OUT,exist_ok=True); os.makedirs(os.path.join(ART,'previews'),exist_ok=True)
args=argparse.ArgumentParser(); args.add_argument('--tiers',nargs='+',type=int,default=[1,2,3,4]); args.add_argument('--render',action='store_true'); args.add_argument('--resume',action='store_true'); args.add_argument('--refresh-textures',action='store_true'); args.add_argument('--preview-car',action='store_true'); args.add_argument('--mural-only',action='store_true',help='With --resume, replace only the original wall-paint decal and preserve accepted geometry, materials and preview lighting'); args.add_argument('--cleanup-only',action='store_true',help='With --resume, preserve scene settings and remove only numerically collapsed faces before re-export'); args.add_argument('--interior-only',action='store_true',help='With --resume, complete missing interior without changing accepted rear geometry or materials'); args.add_argument('--workshop-surface-only',action='store_true',help='With --resume, refresh the current floor/wall PBR maps without rebuilding any geometry'); args.add_argument('--reverse-workshop-only',action='store_true',help='With --resume, add functional reverse-side work zones and replace floor/wall finish while preserving the accepted rear set'); args.add_argument('--arrival-tv-only',action='store_true',help='With --resume, add the physical wall screen and lift only its new ventilation assembly, preserving all other geometry and surface maps'); args.add_argument('--screen-poster-only',action='store_true',help='With --resume, replace only the packed TV poster and truthful provenance metadata; preserve every mesh, shader setting and camera contract'); args.add_argument('--render-reverse',action='store_true',help='Render an additional inward view of the front entrance'); OPT=args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
random.seed(9349)
M={}; OBJECTS=[]; ROOT_OBJ=None
SCREEN_ATTRIBUTION='Poster derived from user-provided Tesla footage; third-party authorship, redistribution rights unverified, no affiliation or endorsement.'
ROOM_ATTRIBUTION='Original authored garage geometry, mural and wall/floor surface maps; TV poster derives from user-provided third-party Tesla footage. Redistribution license unverified.'

def v(p): return Vector((p[0],-p[2],p[1]))
def material(name,color,metal=0,rough=.5,emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if emission: bs.inputs['Emission Color'].default_value=(*color,1); bs.inputs['Emission Strength'].default_value=emission
    return m

def image_texture(name,pixels):
    h,w,_=pixels.shape; path=os.path.join(OUT,name+'.png')
    img=bpy.data.images.new(name,width=w,height=h,alpha=True); img.pixels.foreach_set(pixels.astype(np.float32).ravel()); img.filepath_raw=path; img.file_format='PNG'; img.save(); return img

def surface_texture():
    n=768; rng=np.random.default_rng(9349); yy,xx=np.mgrid[:n,:n]; noise=rng.normal(0,.013,(n,n)); coarse=np.zeros((n,n))
    for freq,amp in [(3,.032),(11,.018),(39,.007)]:
        grid=rng.normal(0,1,(freq+1,freq+1)); grid[-1,:]=grid[0,:]; grid[:,-1]=grid[:,0]
        gx=xx/n*freq; gy=yy/n*freq; ix=gx.astype(int); iy=gy.astype(int); fx=gx-ix; fy=gy-iy
        fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy)
        coarse+=amp*((1-fy)*((1-fx)*grid[iy,ix]+fx*grid[iy,ix+1])+fy*((1-fx)*grid[iy+1,ix]+fx*grid[iy+1,ix+1]))
    base=np.clip(.40+noise+coarse,.29,.49); pixels=np.zeros((n,n,4)); pixels[:,:,:3]=np.stack([base*.94,base*.98,base],axis=-1); pixels[:,:,3]=1
    color=image_texture('original-concrete-grain',pixels)
    pixels[:,:,:3]=np.repeat(np.clip(.8-noise*3-coarse,.65,.96)[:,:,None],3,axis=2)
    rough=image_texture('original-concrete-roughness',pixels); rough.colorspace_settings.name='Non-Color'
    return color,rough

def set_textures(mat,tex,rough,tint):
    nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF'); im=nt.nodes.new('ShaderNodeTexImage'); im.image=tex; im.extension='REPEAT'
    nt.links.new(im.outputs['Color'],bs.inputs['Base Color']); bs.inputs['Base Color'].default_value=(*tint,1)
    # The exported material factor is kept neutral; the concrete image carries its original colour.
    ir=nt.nodes.new('ShaderNodeTexImage'); ir.image=rough; ir.extension='REPEAT'; nt.links.new(ir.outputs['Color'],bs.inputs['Roughness'])

def reg(o,name,mat):
    o.name=name; o.parent=ROOT_OBJ; o.data.materials.clear(); o.data.materials.append(M[mat]); OBJECTS.append(o); return o

def uv_world(o,scale=2):
    if not o.data.uv_layers: o.data.uv_layers.new(name='MetreUV')
    uv=o.data.uv_layers.active.data
    for poly in o.data.polygons:
        ax=max(range(3),key=lambda i: abs(poly.normal[i])); axes=[i for i in range(3) if i!=ax]
        for li in poly.loop_indices:
            p=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
            uv[li].uv=(p[axes[0]]/scale,p[axes[1]]/scale)

def box(name,pos,size,mat='paint',bevel=0,rot=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=v(pos)); o=bpy.context.object; o.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if rot: o.rotation_euler[2]=rot
    reg(o,name,mat)
    if bevel:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in o.data.polygons: p.use_smooth=False
        mod=o.modifiers.new('Face weighted corner normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    uv_world(o); return o

def cylinder(name,a,b,r,mat='steel',vertices=16,r2=None):
    aa,bb=v(a),v(b); d=bb-aa
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=d.length,location=(aa+bb)/2)
    o=bpy.context.object; o.rotation_euler=d.to_track_quat('Z','Y').to_euler(); reg(o,name,mat)
    for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
    return o

def tube(name,points,r,mat='steel',res=3):
    curve=bpy.data.curves.new(name,'CURVE'); curve.dimensions='3D'; curve.resolution_u=1; curve.bevel_depth=r; curve.bevel_resolution=res
    s=curve.splines.new('POLY'); s.points.add(len(points)-1)
    for p,co in zip(s.points,points): p.co=(*v(co),1)
    o=bpy.data.objects.new(name,curve); bpy.context.collection.objects.link(o); bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o=bpy.context.object; reg(o,name,mat); o.select_set(False); return o

def label(name,text,pos,size=.25,mat='white',orientation='back'):
    cu=bpy.data.curves.new(name,'FONT'); cu.body=text; cu.align_x='LEFT'; cu.size=size; cu.extrude=.0002; cu.resolution_u=2
    ob=bpy.data.objects.new(name,cu); bpy.context.collection.objects.link(ob); ob.location=v(pos)
    # Text local XY -> vertical XZ, face toward the open front (-game Z).
    ob.rotation_euler=(pi/2,0,0)
    if orientation=='floor': ob.rotation_euler=(0,0,0)
    bpy.context.view_layer.objects.active=ob; ob.select_set(True); bpy.ops.object.convert(target='MESH'); ob=bpy.context.object; reg(ob,name,mat); ob.rotation_euler.z+=pi; ob.location.x+=ob.dimensions.x; ob['garage_label_front_facing']=True; ob.select_set(False); return ob

def bolt(name,pos,axis='z',r=.018,mat='steel'):
    a=list(pos); b=list(pos); idx={'x':0,'y':1,'z':2}[axis]; a[idx]-=.012; b[idx]+=.012; return cylinder(name,a,b,r,mat,6)

def panel_fasteners(x,y,z,w,h):
    for dx in [-w/2+.08,w/2-.08]:
        for dy in [-h/2+.08,h/2-.08]: bolt('Captive panel screw',(x+dx,y+dy,z-.015))

def wheel(name,x,y,z,r=.19):
    cylinder(name+' rubber',(x,y,z-.055),(x,y,z+.055),r,'rubber',20)
    cylinder(name+' axle',(x,y,z-.063),(x,y,z+.063),r*.45,'steel',12)

def cabinet(x,z,w=1.6,h=1.05,drawers=5,mat='paint',mobile=False):
    y=.1+h/2
    box('Folded steel cabinet',(x,y,z),(w,h,.65),mat,.025)
    box('Raised worktop lip',(x,.12+h,z),(w+.05,.045,.70),'steel',.01)
    box('Black top protector',(x,.15+h,z),(w-.035,.015,.62),'rubber',.008)
    for i in range(drawers):
        yy=.2+(i+.5)*(h-.15)/drawers
        box('Inset drawer',(x,yy,z-.338),(w-.10,(h-.15)/drawers-.022,.025),mat,.008)
        box('Extruded drawer handle',(x,yy+.04,z-.37),(w*.67,.025,.035),'steel',.006)
        if i==drawers-1: bolt('Cabinet lock',(x+w*.37,yy,z-.36),r=.022)
    box('Cabinet plinth',(x,.075,z),(w-.10,.15,.55),'dark')
    if mobile:
        for dx in [-w*.38,w*.38]:
            for dz in [-.24,.24]: wheel('Swivel caster',x+dx,.105,z+dz,.10)
    return h

def pegboard(x,z,w=3.2,y=2.05):
    box('Perforated tool board',(x,y,z),(w,1.25,.07),'dark',.012)
    # Recessed circular perforations avoid expensive alpha textures and preserve editing.
    for dx in np.arange(-w/2+.12,w/2,.18):
        for dy in np.arange(-.5,.56,.18): cylinder('Pegboard perforation',(x+dx,y+dy,z-.043),(x+dx,y+dy,z-.047),.013,'black',8)
    for j in range(8):
        xx=x-w*.40+j*w*.105; length=.24+j*.028
        box('Forged wrench shank',(xx,y+.15-length/2,z-.085),(.028,length,.025),'steel',.007)
        cylinder('Wrench ring',(xx,y+.17,z-.10),(xx,y+.17,z-.065),.055,'steel',12)
        cylinder('Ring opening',(xx,y+.17,z-.105),(xx,y+.17,z-.102),.026,'dark',8)
        box('Wrench head',(xx,y+.15-length,z-.08),(.075,.08,.03),'steel',.012)
    for j in range(3):
        xx=x+w*.24+j*.18
        box('Tool grip',(xx,y-.29,z-.10),(.07,.22,.07),'signal',.02)
        cylinder('Driver blade',(xx,y-.18,z-.1),(xx,y+.17,z-.1),.013,'steel',8)
    box('Magnetic socket rail',(x,y-.48,z-.10),(w*.75,.04,.05),'steel',.005)
    for j in range(14): cylinder('Socket set',(x-w*.33+j*w*.05,y-.43,z-.11),(x-w*.33+j*w*.05,y-.36,z-.11),.027,'steel',8)

def workbench(x,z,w=3.2,tools=True):
    for xx in [x-w/2+.12,x+w/2-.12]:
        for zz in [z-.29,z+.29]: box('Workbench square tube leg',(xx,.5,zz),(.08,1,.08),'steel',.008)
    box('Workbench shelf',(x,.24,z),(w-.15,.06,.64),'dark',.012)
    box('Workbench folded upper frame',(x,.96,z),(w,.12,.75),'paint',.018)
    box('Laminated work surface',(x,1.045,z),(w+.07,.07,.80),'wood',.018)
    box('Bench vise fixed body',(x-w*.32,1.16,z-.17),(.32,.17,.25),'steel',.025)
    box('Vise jaws',(x-w*.32,1.28,z-.17),(.32,.08,.12),'dark',.01)
    cylinder('Bench vise spindle',(x-w*.32-.25,1.16,z-.17),(x-w*.32+.22,1.16,z-.17),.022,'steel',12)
    cylinder('Bench vise T handle',(x-w*.32-.25,1.02,z-.17),(x-w*.32-.25,1.30,z-.17),.014,'steel',10)
    if tools: pegboard(x,z+.32,w)
    for j in range(3): box('Parts tray',(x+.2+j*.43,1.1,z),(.32,.07,.24),'dark',.012)

def service_trolley(x,z):
    cabinet(x,z,.95,.78,4,'signal',True)
    for j in range(3): cylinder('Trolley socket',(x-.25+j*.22,.99,z),(x-.25+j*.22,1.05,z),.034,'steel',10)
    tube('Trolley push handle',[(x+.50,.70,z-.26),(x+.60,.82,z-.26),(x+.60,.82,z+.26),(x+.5,.7,z+.26)],.022)

def tire_rack(x,z):
    for xx in [x-1.25,x+1.25]:
        for zz in [z-.38,z+.38]: box('Storage rack upright',(xx,1.3,zz),(.06,2.6,.06),'steel',.005)
    for y in [.35,1.38,2.4]:
        for zz in [z-.35,z+.35]: box('Storage rack rail',(x,y,zz),(2.6,.065,.065),'paint',.005)
    for level in [.72,1.77]:
        for j in range(4):
            xx=x-.88+j*.58
            cylinder('Spare performance tyre',(xx-.19,level,z),(xx+.19,level,z),.36,'rubber',24)
            cylinder('Spare wheel hollow',(xx+.195,level,z),(xx+.2,level,z),.21,'black',20)
            cylinder('Spare wheel bead',(xx+.201,level,z),(xx+.206,level,z),.145,'steel',16)

def screen(x,y,z,w=1.2,h=.65):
    box('Diagnostic display housing',(x,y,z),(w+.08,h+.08,.09),'dark',.025)
    box('Anti-glare display',(x,y,z-.051),(w,h,.01),'screen',.002)
    for i in range(4): box('Readout band',(x-w*.33,y+h*.33-i*h*.16,z-.061),(w*.22,.012,.004),'cyan')
    for i in range(20):
        xx=x-w*.07+i*w*.023; yy=y-h*.2+.06*sin(i*.75)+i*.006
        box('Telemetry sample',(xx,yy,z-.062),(w*.016,.018+abs(sin(i*.4))*.12,.004),'cyan')
    box('Display footer',(x,y-h*.37,z-.063),(w*.88,.008,.004),'lightwarm')

def fixture(x,y,z,w=3,style='linear'):
    box('Suspended fixture casing',(x,y,z),(w,.105,.22),'dark',.02)
    box('Prismatic light diffuser',(x,y-.057,z),(w-.10,.016,.14),'light')
    for xx in [x-w*.35,x+w*.35]: cylinder('Light suspension',(xx,y+.05,z),(xx,6.0,z),.009,'steel',8)

def drain(x,z,w=1.5):
    box('Recessed drainage channel',(x,.0005,z),(w,.003,.15),'dark')
    for j in range(int(w/.05)): box('Drain grating',(x-w/2+j*.05,.005,z),(.016,.006,.14),'steel')

def floor_markings(tier):
    # Flush painted workspace bounds remain outside every player wheel/body envelope.
    for x in [-3.1,3.1]:
        for z in [-3.5,3.5]:
            box('Calibration corner long',(x,.003,z),(.055,.004,.7),'mark')
            box('Calibration corner short',(x+(.3 if x<0 else -.3),.003,z+(.32 if z<0 else -.32)),(.6,.004,.055),'mark')
    if tier>=2:
        for z in [-5.5,5.2]:
            box('Service walkway boundary',(0,.003,z),(14,.004,.035),'mark')
        for x in np.arange(-8,8,1): box('Service walkway ticks',(x,.004,5.4),(.035,.004,.25),'mark')
    for x in [-7,7]: drain(x,2,1.5)

def wear():
    # Hand-authored deterministic floor scuffs, thin enough not to affect car contacts.
    rng=random.Random(93)
    for j in range(110):
        x=rng.uniform(-8.8,8.8); z=rng.uniform(-6.6,7.0)
        if abs(x)<2 and abs(z)<3.5: continue
        ob=box('Historic floor scuff',(x,.001,z),(rng.uniform(.01,.025),.001,rng.uniform(.12,.48)),'scuff',rot=rng.uniform(-.2,.2))
    for x in [-.96,.96]:
        for z in np.arange(3.8,6.7,.18): box('Faded tyre trace',(x,.002,z),(.18,.001,.11),'scuff')

def fire_safety(x,z):
    cylinder('Extinguisher bottle',(x,.35,z),(x,1.0,z),.125,'red',20,r2=.105)
    cylinder('Extinguisher valve',(x,1.0,z),(x,1.12,z),.045,'steel',12)
    box('Extinguisher handle',(x+.05,1.13,z),(.17,.03,.04),'dark',.008)
    box('Extinguisher instructions',(x,.73,z-.122),(.13,.27,.007),'white',.008)
    tube('Extinguisher hose',[(x+.05,1.04,z),(x+.20,.97,z),(x+.18,.45,z)],.016,'rubber')
    box('Safety sign',(x,1.6,z+.05),(.30,.34,.018),'red',.008)
    box('Safety symbol vertical',(x,1.6,z+.037),(.035,.19,.007),'white')
    box('Safety symbol horizontal',(x,1.6,z+.034),(.15,.035,.007),'white')

def compressor(x,z):
    cylinder('Air receiver',(x-.57,.45,z),(x+.57,.45,z),.27,'paint',24)
    for xx in [x-.38,x+.38]: wheel('Compressor wheel',xx,.14,z+.12,.14)
    box('Compressor motor',(x-.13,.85,z),(.48,.38,.37),'dark',.03)
    for i in range(5): box('Motor cooling fin',(x-.32+i*.085,.87,z),(.025,.38,.41),'steel',.004)
    cylinder('Pressure regulator',(x+.38,.67,z),(x+.38,.91,z),.06,'steel',12)
    cylinder('Pressure gauge',(x+.38,.9,z-.045),(x+.38,.9,z-.08),.08,'white',20)
    box('Pressure needle',(x+.38,.92,z-.085),(.012,.07,.005),'red',rot=.4)
    pts=[(x+.5+.25*cos(j*.18),.6+.18*sin(j*.18),z-.35+j*.006) for j in range(100)]
    tube('Coiled pneumatic hose',pts,.018,'signal',2)

def door(x,z,w=3.2,h=3.8,style='utility'):
    box('Door reveal',(x,h/2,z),(w+.32,h+.15,.22),'dark',.02)
    for j in range(int(h/.32)):
        box('Insulated sectional door leaf',(x,.17+j*.32,z-.13),(w,.30,.055),'door',.012)
        for xx in [x-w*.36,x+w*.36]: box('Door hinge strap',(xx,.16+j*.32,z-.17),(.09,.16,.025),'steel',.008)
    for xx in [x-w/2-.12,x+w/2+.12]: box('Door track extrusion',(xx,h/2,z-.14),(.08,h,.12),'steel',.008)
    box('Door bottom seal',(x,.035,z-.18),(w,.055,.05),'rubber')
    box('Door handle',(x,.9,z-.20),(.38,.05,.06),'steel',.012)

def structure(tier):
    box('Continuous structural slab',(0,-.125,-.2),(20,.24,18),'concrete')
    # Real expansion joints and rear kick protection, not a floating display plinth.
    for x in [-6.7,0,6.7]: box('Slab expansion joint',(x,-.002,-.2),(.012,.008,18),'seam')
    for z in [-6.2,-.2,5.8]: box('Slab expansion joint',(0,-.002,z),(20,.008,.012),'seam')
    back=7.7
    box('Rear wall cast concrete',(0,3.3,back),(20,6.6,.26),'wall')
    box('Left return wall',(-10,3.3,.7),(.24,6.6,14.3),'wall')
    box('Right rear return wall',(10,3.3,3.65),(.24,6.6,8.4),'wall')
    for x in [-9.7,-5,5,9.7]:
        box('Structural steel column',(x,3.2,7.47),(.20,6.4,.22),'dark',.012)
        box('Column base plate',(x,.055,7.45),(.40,.11,.44),'steel',.012)
        for dx in [-.14,.14]: bolt('Anchor bolt',(x+dx,.12,7.30),'y',.025)
    for z in [-4.8,1.1,7.25]:
        box('Exposed roof beam',(0,6.15,z),(20,.30,.18),'dark',.015)
        for x in [-8,-4,0,4,8]:
            box('Cross beam gusset',(x,5.95,z),(.22,.44,.06),'steel',.005)
            for yy in [5.87,6.02]: bolt('Beam connection',(x,yy,z-.035),r=.023)
    for x in [-7.6,0,7.6]: box('Ceiling longitudinal rail',(x,6.4,.5),(.14,.22,15),'dark')
    box('Rear wall kick plate',(0,.23,7.53),(19.7,.46,.045),'dark',.008)
    floor_markings(tier)

def tier1():
    structure(1); wear(); door(3.8,7.48,3.5,3.8)
    box('Lower painted masonry band',(-4.8,1.45,7.54),(9.2,2.4,.035),'paint')
    workbench(-5.5,6.80,3.8); cabinet(-2.4,6.85,1.45,1.15,5)
    cabinet(-8.7,6.85,1.5,1.75,3,'door')
    tire_rack(-8,3.6); service_trolley(-4.7,3.5); compressor(7.2,6.8); fire_safety(8.7,7.1)
    for x in [-5,0,5]:
        for z in [-1.5,4.5]: fixture(x,4.8,z,2.8)
    # Surface-mounted conduit, elbow bends, switchgear and historic wall repairs.
    tube('Electrical conduit',[(-9,3.25,7.38),(-2.8,3.25,7.38),(-2.8,1.5,7.38)],.027,'steel')
    for x in np.arange(-8.7,-2.8,.75): box('Conduit clip',(x,3.25,7.36),(.08,.10,.025),'dark',.005)
    box('Electrical isolator',(-2.8,1.65,7.29),(.35,.5,.18),'door',.02)
    cylinder('Isolator rotary handle',(-2.8,1.65,7.19),(-2.8,1.65,7.15),.065,'red',16)
    label('Bay numeral','01',(-.7,3.05,7.30),.8,'white')
    label('Utility identifier','SERVICE BAY',(-.65,2.74,7.28),.16,'white')
    box('Wall clock backing',(-3,4.0,7.37),(.75,.75,.065),'dark',.025)
    cylinder('Clock face',(-3,4,7.33),(-3,4,7.30),.31,'white',32)
    box('Clock minute hand',(-3,4.1,7.27),(.015,.24,.008),'black')
    box('Clock hour hand',(-2.92,4,7.27),(.18,.02,.008),'black')
    # Folding task stool, broom, paper roll and oil trays give this modest bay a working history.
    cylinder('Stool seat',(-3.8,.65,5.6),(-3.8,.72,5.6),.22,'rubber',20)
    for dx,dz in [(-.14,-.14),(.14,-.14),(-.14,.14),(.14,.14)]: cylinder('Stool leg',(-3.8+dx,.05,5.6+dz),(-3.8+dx*.7,.65,5.6+dz*.7),.018)
    cylinder('Broom handle',(-9.25,.15,6.5),(-9.1,1.85,6.6),.018,'wood',12)
    box('Broom head',(-9.25,.08,6.5),(.48,.13,.13),'wood',.015)
    box('Broom bristles',(-9.25,.025,6.5),(.45,.05,.12),'rubber')
    label('Service plaque','INSPECT  /  BUILD  /  DRIVE',(-8,4.5,7.31),.23,'white')

def tier2():
    structure(2); door(5.9,7.49,4.2,4.1)
    for x in [-7.7,-4.7,-1.7,1.3]:
        box('Modular wall cassette',(x,2.8,7.50),(2.94,5.3,.075),'panel',.012); panel_fasteners(x,2.8,7.45,2.9,5.3)
    workbench(-6.3,6.8,4.3); cabinet(-2.5,6.85,2.4,1.2,6); pegboard(-2.5,7.17,2.4,2.2)
    cabinet(-8.9,6.8,1.3,2.5,2,'paint'); tire_rack(-8,3.5); service_trolley(4.9,3.7); compressor(8.2,6.7); fire_safety(9.0,5.9)
    # Twin-post lift is parked at the perimeter, arm ends safely away from the display car.
    for x in [-3.8,3.8]:
        box('Service lift post',(x,1.85,2.0),(.36,3.7,.40),'paint',.03)
        box('Lift base',(x,.07,2.0),(.82,.14,.74),'steel',.02)
        box('Lift carriage',(x,.65,1.75),(.52,.55,.20),'dark',.02)
        box('Retracted lift arm',(x,.25,2.8),(.17,.16,1.3),'signal',.015)
        cylinder('Lift pad',(x,.27,3.4),(x,.35,3.4),.15,'rubber',20)
        box('Lift screw channel',(x,2,1.77),(.07,2.9,.045),'steel')
    box('Lift overhead cable support',(0,4.1,2.0),(8.05,.18,.22),'dark',.02)
    for x in [-5.5,0,5.5]:
        for z in [-3.5,.2,4.6]: fixture(x,5.2,z,3.4)
    box('Diagnostic station column',(6.7,.8,3.8),(.13,1.6,.13),'steel',.012)
    box('Diagnostic station foot',(6.7,.06,3.8),(.75,.12,.65),'dark',.025)
    screen(6.7,1.7,3.8,1.05,.64)
    box('Diagnostic keyboard shelf',(6.7,1.10,3.55),(.85,.06,.45),'dark',.015)
    box('Diagnostic keyboard',(6.7,1.15,3.48),(.58,.025,.20),'steel',.008)
    tube('Diagnostic coiled lead',[(6.5+.12*sin(i*.7),.35+i*.015,3.75) for i in range(45)],.014,'rubber',2)
    box('Rear horizontal signal stripe',(-3.5,3.9,7.39),(12,.07,.014),'signal')
    label('Bay numeral','02',(-.3,2.7,7.33),.9,'dark'); label('Workshop designation','PRECISION SERVICE',(-1.0,2.42,7.32),.17,'dark')
    for x in [-9.3,-8.7]:
        cylinder('Fluid recovery container',(x,.08,4.8),(x,.7,4.8),.22,'door',20)
        cylinder('Container neck',(x,.7,4.8),(x,.80,4.8),.07,'dark',12)

def tier3():
    structure(3)
    # A deliberately different studio architecture: continuous low storage, acoustic fins,
    # a central telemetry wall, and flanking optical metrology/assembly stations.
    for x in np.arange(-9.3,9.4,.36): box('Acoustic wall fin',(x,3.8,7.45),(.045,4.8,.18),'wood',.006)
    for x in [-7.8,-5.6,-3.4,3.4,5.6,7.8]: cabinet(x,6.85,2.12,1.10,4,'panel')
    box('Central instrument wall',(0,2.8,7.12),(4.5,4.8,.18),'dark',.025)
    screen(0,2.95,6.99,3.5,1.6)
    label('Engineering wall title','VEHICLE SYSTEMS',(-1.75,4.24,6.98),.22,'white')
    label('Bay numeral','03',(-1.75,1.52,6.98),.60,'white')
    # Distinct suspended light frame, kept above camera and all vehicle parts.
    for z in [-4.2,4.0]: fixture(0,4.65,z,11.0)
    for x in [-5.45,5.45]:
        box('Studio perimeter light rail',(x,4.65,-.1),(.18,.12,8.4),'dark',.025)
        box('Studio side diffuser',(x,4.58,-.1),(.11,.014,8.2),'light')
        for z in [-3.3,3.3]: cylinder('Studio rail drop',(x,4.7,z),(x,6.3,z),.012,'steel',8)
    for x in [-6.8,6.8]:
        box('Metrology equipment plinth',(x,.09,3.4),(1.2,.18,1.0),'panel',.035)
        box('Optical metrology mast',(x,1.22,3.4),(.18,2.25,.18),'steel',.018)
        box('Optical tracking head',(x,2.15,3.4),(.65,.25,.25),'dark',.03)
        for dx in [-.20,.20]:
            cylinder('Optical lens body',(x+dx,2.15,3.26),(x+dx,2.15,3.22),.067,'steel',20)
            cylinder('Optical glass',(x+dx,2.15,3.215),(x+dx,2.15,3.21),.049,'screen',20)
        box('Tracking status',(x,2.15,3.207),(.035,.035,.003),'cyan')
    workbench(-7.0,4.7,3.1,False); service_trolley(-4.8,4.0)
    # Carefully enclosed engineering samples and a genuine parts-inspection table.
    for i in range(3):
        x=4.0+i*1.55
        box('Parts display recess',(x,2.0,7.21),(1.35,1.28,.09),'dark',.02)
        cylinder('Engineering component hub',(x,2.0,7.10),(x,2.0,6.97),.34,'steel',32)
        cylinder('Hub centre',(x,2.0,6.96),(x,2.0,6.94),.14,'dark',16)
        for j in range(6):
            a=j*2*pi/6; bolt('Component stud',(x+.23*cos(a),2+.23*sin(a),6.92),r=.025)
    fire_safety(9.1,7.0)
    # Floor datum inlays are flush, never a vehicle pedestal.
    for x in [-3.2,3.2]: box('Studio datum inlay',(x,.003,0),(.018,.004,8.3),'steel')
    label('Floor datum legend','CALIBRATION  /  03',(-2.95,.007,-4.25),.18,'mark','floor')

def tier4():
    structure(4)
    # Full-height manufactured wings and an immense insulated rear hangar door.
    door(0,7.48,7.6,5.35,'hangar')
    for side in [-1,1]:
        x=side*6.9
        box('Flagship equipment wing',(x,2.9,7.15),(4.4,5.8,.65),'dark',.035)
        for i in range(3):
            xx=x-1.35+i*1.35
            box('Equipment cassette',(xx,3.5,6.78),(1.28,3.7,.08),'panel',.02); panel_fasteners(xx,3.5,6.72,1.28,3.7)
            for yy in np.arange(4.5,4.95,.08): box('Cassette ventilation slot',(xx,yy,6.72),(.90,.018,.014),'black')
            box('Cabinet status line',(xx,5.03,6.72),(.72,.025,.014),'cyan')
        for xx in [x-1.5,x,x+1.5]: cabinet(xx,6.50,1.43,1.3,5,'panel')
        box('Vertical wing light',(x-side*2.0,3.0,6.76),(.045,5.5,.016),'light')
        # External torque/support gantry, open at front and well outside display area.
        box('Hangar gantry column',(side*8,2.75,1.8),(.42,5.5,.45),'steel',.03)
        box('Gantry column foot',(side*8,.08,1.8),(.86,.16,.85),'dark',.02)
        box('Gantry upright inset',(side*8,2.7,1.56),(.12,4.6,.025),'dark')
        for y in [.8,1.8,2.8,3.8,4.8]: box('Column calibration tag',(side*8,y,1.54),(.11,.035,.009),'signal')
    box('Hangar upper bridge',(0,5.7,1.8),(16.6,.48,.50),'steel',.025)
    box('Bridge inset',(0,5.6,1.52),(15.9,.16,.025),'dark')
    # Three elongated polygonal luminous frames create a unique performance-hangar identity.
    for z in [-3.7,.2,4.4]:
        pts=[(-7.4,4.8,z),(-5.9,5.5,z),(5.9,5.5,z),(7.4,4.8,z)]
        tube('Champfered overhead luminaire frame',pts,.10,'dark',3)
        tube('Continuous optical diffuser',[(x,y-.075,zz-.025) for x,y,zz in pts],.038,'light',3)
        for x in [-5,5]: cylinder('Hangar lighting drop',(x,5.58,z),(x,6.35,z),.012,'steel',8)
    # Paired technical islands on the periphery, not beside the camera.
    for x in [-6.1,6.1]:
        box('Technical island base',(x,.60,3.3),(2.4,1.2,.85),'dark',.035)
        box('Island machined work surface',(x,1.23,3.3),(2.46,.075,.90),'steel',.022)
        for j in range(3):
            xx=x-.75+j*.75
            box('Island storage door',(xx,.68,2.855),(.70,.93,.035),'panel',.012)
            box('Island handle',(xx,.98,2.82),(.42,.025,.025),'steel',.006)
        screen(x,2.05,3.55,1.8,.82)
        box('Integrated monitor pillar',(x,1.6,3.57),(.12,.80,.12),'steel',.015)
    tire_rack(-8,5.4); service_trolley(4.9,5.1); fire_safety(9.4,6.8)
    # Hangar door control and proud, brand-neutral bay identification.
    box('Hangar header plate',(0,5.98,7.14),(7.5,.58,.08),'dark',.012)
    label('Bay numeral','04',(-3.45,5.78,7.08),.42,'white')
    label('Flagship identification','PERFORMANCE ENGINEERING',(-1.98,5.87,7.07),.21,'white')
    box('Hangar header signal',(3.1,6.0,7.08),(.34,.045,.01),'signal')
    for x in [-3.4,3.4]:
        box('Flush light channel',(x,.003,.0),(.055,.006,8.3),'dark')
        box('Flush datum diffuser',(x,.007,.0),(.017,.004,8.0),'cyan')
    # Central painted horizontal datum, disconnected at the wheel contact zone.
    for x in [-5.5,5.5]: box('Hangar floor datum',(x,.004,-4.5),(3.3,.004,.04),'mark')

def setup_materials():
    global M
    M={
      'concrete':material('Original mottled concrete',(.36,.38,.40),0,.84),
      'wall':material('Warm architectural concrete',(.34,.36,.37),0,.87),
      'paint':material('Workshop petrol powdercoat',(.055,.14,.16),.48,.39),
      'panel':material('Pale ceramic powdercoat',(.51,.56,.56),.36,.38),
      'dark':material('Graphite structural powdercoat',(.037,.048,.055),.48,.44),
      'black':material('Optical recess',(.008,.012,.016),0,.84),
      'steel':material('Brushed stainless steel',(.38,.44,.48),.82,.30),
      'wood':material('Treated warm workshop laminate',(.27,.19,.115),0,.65),
      'signal':material('Signal amber enamel',(.76,.29,.055),.32,.37),
      'rubber':material('Workshop rubber',(.018,.024,.028),0,.86),
      'door':material('Satin sectional door',(.16,.205,.22),.50,.43),
      'white':material('Warm graphic enamel',(.72,.77,.73),.06,.55),
      'mark':material('Faded floor marking',(.53,.48,.32),0,.80),
      'seam':material('Concrete expansion gasket',(.07,.085,.095),0,.94),
      'scuff':material('Embedded floor scuff',(.055,.065,.07),0,.93),
      'red':material('Safety enamel',(.47,.055,.035),.20,.42),
      'screen':material('Diagnostic screen',(.009,.026,.030),.18,.24, .2),
      'cyan':material('Instrument soft teal',(.08,.55,.62),.1,.3,1.4),
      'light':material('Neutral warm LED diffuser',(.84,.89,.86),0,.35,3.0),
      'lightwarm':material('Warm diagnostic indicator',(.85,.55,.19),0,.35,1.5),
    }
    color,rough=surface_texture(); set_textures(M['concrete'],color,rough,(1,1,1))

# Existing palette names are stable across saved sources. Do not replace a
# material or re-author accepted art when upgrading a saved workshop.
PALETTE_NAMES={'concrete':'Original mottled concrete','wall':'Warm architectural concrete',
 'paint':'Workshop petrol powdercoat','panel':'Pale ceramic powdercoat',
 'dark':'Graphite structural powdercoat','black':'Optical recess','steel':'Brushed stainless steel',
 'wood':'Treated warm workshop laminate','signal':'Signal amber enamel','rubber':'Workshop rubber',
 'door':'Satin sectional door','white':'Warm graphic enamel','mark':'Faded floor marking',
 'seam':'Concrete expansion gasket','scuff':'Embedded floor scuff','red':'Safety enamel',
 'screen':'Diagnostic screen','cyan':'Instrument soft teal','light':'Neutral warm LED diffuser',
 'lightwarm':'Warm diagnostic indicator'}

def original_geometry_signature(include_interior=False):
    """A repeatable audit proving the accepted rear set and mural were untouched."""
    h=hashlib.sha256()
    for obj in sorted((o for o in OBJECTS if include_interior or not o.get('garage_interior_completion')),key=lambda o:o.name):
        h.update(obj.name.encode());h.update(np.asarray(obj.matrix_local,dtype=np.float32).tobytes())
        h.update(np.asarray([v.co[:] for v in obj.data.vertices],dtype=np.float32).tobytes())
        for p in obj.data.polygons:h.update(np.asarray(p.vertices[:],dtype=np.int32).tobytes())
        for uv in obj.data.uv_layers:
            h.update(np.asarray([item.uv[:] for item in uv.data],dtype=np.float32).tobytes())
        h.update('|'.join(m.name for m in obj.data.materials).encode())
    return h.hexdigest()

def complete_interior(tier):
    """Complete the missing half of the actual room, not a view-facing backdrop.

    All additions use the existing palette. The central and both parked-car
    envelopes remain clear; low furniture stays against the outer architecture.
    Tagged parts make this upgrade idempotent and independently editable.
    """
    global M,OBJECTS
    for ob in list(OBJECTS):
        if ob.get('garage_interior_completion'):
            OBJECTS.remove(ob); mesh=ob.data; bpy.data.objects.remove(ob,do_unlink=True)
            if not mesh.users:bpy.data.meshes.remove(mesh)
    # Blender can purge palettes unused by an older saved tier. Reintroduce only
    # the identical original sectional-door swatch when the studio now needs it.
    if PALETTE_NAMES['door'] not in bpy.data.materials:
        material(PALETTE_NAMES['door'],(.16,.205,.22),.50,.43)
    M.update({alias:bpy.data.materials[name] for alias,name in PALETTE_NAMES.items() if name in bpy.data.materials})
    start=len(OBJECTS)
    panel='wall' if tier==1 else 'panel'
    # Existing returns and rear wall stay byte-for-byte unchanged. New returns
    # meet their old ends, closing the front half without overlapping faces.
    box('Interior front structural wall',(0,3.3,-9.1),(20,6.6,.26),'wall')
    box('Interior left front return',(-10,3.3,-7.775),(.24,6.6,2.65),'wall')
    box('Interior right front return',(10,3.3,-4.825),(.24,6.6,8.55),'wall')
    # A real ceiling: eight large structural panels with recessed seams, above
    # the accepted beams and luminaires. No hidden giant plane or fog backdrop.
    for x in [-5,5]:
        for z in [-7.0,-2.8,1.4,5.6]:
            box('Interior insulated ceiling panel',(x,6.525,z),(9.98,.15,4.18),panel)
    for z in [-9.08,-4.9,-.7,3.5,7.68]:
        box('Interior ceiling transverse joint',(0,6.455,z),(20,.02,.035),'dark')
    box('Interior ceiling central joint',(0,6.455,-.7),(.035,.02,16.8),'dark')
    for side in [-1,1]:
        x=side*9.835
        box('Interior side impact protection',(x,.27,-4.5),(.065,.54,8.9),'paint' if tier<3 else 'dark')
        box('Interior side dado cap',(x-side*.015,.56,-4.5),(.075,.035,8.9),'steel')
        # Shallow, serviceable metal cladding and a measured wall rhythm.
        for z in [-7.5,-4.7,-1.9]:
            box('Interior side service panel',(x-side*.02,2.15,z),(.065,2.75,2.62),panel)
            box('Interior side panel reveal',(x-side*.06,2.15,z-1.33),(.025,2.75,.035),'dark')
        # Pipework is attached to walls, never hanging across an orbit path.
        tube('Interior surface electrical conduit',[(x-side*.07,3.8,5.5),(x-side*.07,3.8,-7.8),(x-side*.07,1.8,-7.8)],.024,'steel',1)
        for z in [-7.5,-4.5,-1.5,1.5,4.5]:
            box('Interior conduit saddle',(x-side*.06,3.8,z),(.065,.095,.065),'dark')
        # Ceiling-mounted cable trays make the service runs visibly terminate.
        box('Interior overhead cable tray',(side*9.05,6.02,-.6),(.32,.09,15.5),'dark')
        for z in [-6,0,6]:
            box('Interior cable tray hanger',(side*9.05,6.25,z),(.035,.42,.035),'steel')
        box('Interior side ventilation housing',(side*9.69,4.65,-5.6),(.26,.72,1.45),'door')
        for y in [4.4,4.55,4.7,4.85]:
            box('Interior side ventilation grille',(side*9.54,y,-5.6),(.022,.035,1.25),'dark')
    # Front entrance faces inward (+game Z), in contrast to the accepted rear
    # door. Build each leaf directly so no labels or original art get mirrored.
    w={1:6.2,2:6.6,3:7.0,4:7.6}[tier];h={1:4.15,2:4.4,3:4.55,4:4.85}[tier]
    box('Interior entrance dark reveal',(0,h/2,-8.91),(w+.38,h+.18,.10),'dark')
    rows=11
    for j in range(rows):
        yy=(j+.5)*h/rows
        box('Interior entrance sectional leaf',(0,yy,-8.83),(w,h/rows-.022,.065),'door' if tier<3 else 'panel')
        box('Interior entrance pressed seam',(0,yy-h/rows*.33,-8.786),(w-.18,.028,.018),'steel' if tier==4 else 'dark')
    for side in [-1,1]:
        x=side*(w/2+.13)
        box('Interior entrance vertical guide',(x,h/2,-8.73),(.10,h,.15),'steel')
        box('Interior entrance jamb',(x+side*.15,h/2,-8.84),(.12,h+.15,.19),'paint' if tier<3 else 'dark')
        box('Interior entrance lower guard',(x+side*.15,.48,-8.67),(.18,.96,.10),'signal')
    box('Interior entrance threshold',(0,.015,-8.7),(w,.03,.19),'rubber')
    box('Interior entrance grip',(0,1.03,-8.74),(.52,.045,.07),'steel')
    box('Interior entrance header',(0,h+.14,-8.78),(w+.7,.20,.26),'dark')
    # Original inspection glazing and recessed header lights add meaningful
    # hierarchy without new glass materials, logos, signage or extra textures.
    if tier>=2:
        for x in [-2.1,0,2.1]:
            box('Interior entrance inspection frame',(x,3.24,-8.77),(1.66,.48,.06),'dark')
            box('Interior entrance inspection glazing',(x,3.24,-8.732),(1.51,.34,.015),'screen')
            box('Interior entrance glazing highlight',(x,3.34,-8.72),(1.38,.014,.005),'steel')
    # A separate personnel/service door, deliberately offset from all bays.
    sx=-7.15
    box('Interior service door reveal',(sx,1.36,-8.89),(1.55,2.72,.13),'dark')
    box('Interior service door leaf',(sx,1.32,-8.79),(1.34,2.60,.07),'paint' if tier<3 else 'panel')
    box('Interior service door kick plate',(sx,.31,-8.745),(1.24,.55,.016),'steel')
    box('Interior service door push bar',(sx,1.13,-8.70),(1.03,.055,.065),'steel')
    box('Interior service door upper inset',(sx,2.05,-8.74),(.65,.61,.02),'dark')
    box('Interior service door glazing',(sx,2.05,-8.723),(.54,.5,.009),'screen' if tier>=2 else 'door')
    box('Interior service closer',(sx+.43,2.55,-8.71),(.33,.11,.09),'steel')
    # Electrical distribution/control bank: shallow wall kit, not loose props.
    for x in [5.3,6.45]:
        box('Interior electrical cabinet',(x,1.69,-8.73),(.90,1.31,.24),'paint' if tier==1 else 'panel')
        box('Interior electrical cabinet gasket',(x,1.69,-8.59),(.79,1.20,.025),'dark')
        box('Interior electrical cabinet lid',(x,1.69,-8.57),(.75,1.16,.025),'door' if tier==1 else 'panel')
        box('Interior electrical cabinet latch',(x+.27,1.69,-8.54),(.035,.13,.018),'steel')
        tube('Interior cabinet feed',[(x,2.37,-8.76),(x,3.75,-8.76),(8.9,3.75,-8.76)],.022,'steel',1)
    box('Interior entrance control',(w/2+.57,1.47,-8.68),(.23,.43,.17),'dark')
    for yy,mat in [(1.56,'white'),(1.4,'red')]:
        cylinder('Interior entrance control button',(w/2+.57,yy,-8.58),(w/2+.57,yy,-8.56),.035,mat,8)
    # These new fixtures continue the same lighting grammar as the rear half.
    for x in [-5,0,5]:
        box('Interior entrance luminaire casing',(x,5.85,-6.6),(3.1,.13,.23),'dark')
        box('Interior entrance luminaire diffuser',(x,5.777,-6.6),(2.96,.016,.15),'light')
        for dx in [-1,1]:
            cylinder('Interior entrance fixture suspension',(x+dx,5.92,-6.6),(x+dx,6.40,-6.6),.009,'steel',6)
    # Progression is architectural: basic utilitarian -> precision panels ->
    # warm acoustic studio -> machined flagship enclosure, never more clutter.
    if tier==3:
        for x in [-8.7,-5.1,5.0,8.1]:
            for dx in [-.22,0,.22]:
                box('Interior studio acoustic batten',(x+dx,4.6,-8.76),(.045,2.55,.12),'wood')
        for side in [-1,1]:
            box('Interior studio wall wash',(side*9.68,3.55,-3.4),(.025,.035,8.0),'light')
    if tier==4:
        for x in [-8.9,-4.6,4.6,8.9]:
            box('Interior flagship architectural pier',(x,3.12,-8.69),(.23,6.18,.42),'dark')
            box('Interior flagship pier light',(x,3.8,-8.468),(.035,3.72,.016),'light')
        box('Interior flagship entrance crown',(0,5.65,-8.68),(18.0,.36,.36),'steel')
        box('Interior flagship crown inset',(0,5.65,-8.488),(17.5,.12,.016),'dark')
        for side in [-1,1]:
            box('Interior flagship upper service channel',(side*9.61,4.02,-3.3),(.10,.17,9.4),'dark')
            box('Interior flagship upper datum',(side*9.55,4.02,-3.3),(.017,.035,9.2),'cyan')
    for obj in OBJECTS[start:]:
        obj['garage_interior_completion']=True
        obj['authoring_source']='scripts/create_garage.py:complete_interior'
    ROOT_OBJ['interior_completion']='Complete four-wall and ceiling workshop; original rear set and artwork retained'
    bpy.context.scene['interior_completion_version']=1

def place_workshop_group(start, x, z, angle, mirror_x=False):
    """Turn a locally authored service assembly to face into the real room.

    Local X is the assembly’s horizontal span and local +Z is its wall side. Rotating
    complete individual parts keeps each editable rather than baking a prop
    into a proxy box. The resulting metre-space bounds feed camera_contract.
    """
    from mathutils import Matrix
    bpy.context.view_layer.update()
    transform=Matrix.Translation(v((x,0,z)))@Matrix.Rotation(angle,4,'Z')
    if mirror_x:transform=transform@Matrix.Diagonal((-1,1,1,1))
    for ob in OBJECTS[start:]:ob.matrix_world=transform@ob.matrix_world


def arrival_ventilation(width=3.2,tier=1):
    """A shallow intake plenum and real louver blades, not a painted sign."""
    metal='door' if tier<3 else 'panel'
    box('Arrival ventilation plenum',(0,4.65,.21),(width,.92,.30),metal,.018)
    box('Arrival ventilation dark throat',(0,4.65,.042),(width-.14,.80,.025),'dark' if tier==3 else 'black')
    for j in range(8):
        blade=box('Arrival intake louver blade',(0,4.31+j*.095,-.025),(width-.18,.038,.18),'steel' if tier>=3 else 'door')
        blade.rotation_euler.x=.28
    for x in [-width/2+.04,width/2-.04]:
        box('Arrival louver perimeter frame',(x,4.65,-.04),(.055,.99,.07),'steel',.005)
    for y in [4.18,5.12]:box('Arrival louver perimeter frame',(0,y,-.04),(width,.055,.07),'steel',.005)
    box('Arrival overhead extraction trunk',(0,5.50,.24),(width+.22,.38,.39),metal,.012)
    for x in np.linspace(-width*.47,width*.47,5):
        box('Arrival duct slip joint',(x,5.50,.23),(.035,.42,.43),'steel',.004)
    # The riser visibly connects to the upper service run instead of ending in
    # mid-air. It remains against the wall, never across the eye orbit.
    x=-width*.36
    box('Arrival vertical extraction riser',(x,5.99,.24),(.44,.60,.39),metal,.012)
    box('Arrival duct upper elbow',(x,6.19,.22),(.66,.20,.43),metal,.02)
    for y in [5.78,6.14]:
        box('Arrival riser wall strap',(x,y,.23),(.50,.045,.45),'steel',.004)
    for x in [-width*.35,width*.35]:
        box('Arrival intake mounting foot',(x,4.65,.44),(.18,.68,.13),'dark')


def arrival_wall_television():
    """Author a physical 16:9 screen with an independently editable UV plane.

    The supplied-video poster is packed for an immediately legible source and
    runtime fallback. Runtime replaces exactly one material with the full muted
    user-supplied clip; third-party authorship is attributed separately. Housing, wall mounts, cable and restrained diffuser
    remain ordinary original meshes; no dynamic light or extra wall art is used.
    """
    path=os.path.join(OUT,'roadster-screen-poster.jpg')
    if not os.path.isfile(path):raise FileNotFoundError('Supplied-video screen poster must exist before exporting: '+path)
    mat=bpy.data.materials.get('garage_screen_display')
    if mat is None:mat=material('garage_screen_display',(1,1,1),rough=.45,emission=1)
    mat.use_nodes=True;nt=mat.node_tree;bs=nt.nodes.get('Principled BSDF')
    for node in list(nt.nodes):
        if node.type=='TEX_IMAGE':nt.nodes.remove(node)
    image=bpy.data.images.load(path,check_existing=True)
    image.name='roadster-screen-poster';image.colorspace_settings.name='sRGB';image.pack()
    tex=nt.nodes.new('ShaderNodeTexImage');tex.name='TV poster image';tex.image=image;tex.extension='EXTEND'
    bs.inputs['Base Color'].default_value=(1,1,1,1)
    bs.inputs['Emission Color'].default_value=(1,1,1,1);bs.inputs['Emission Strength'].default_value=1
    nt.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    nt.links.new(tex.outputs['Color'],bs.inputs['Emission Color'])
    mat['screen_asset']=SCREEN_ATTRIBUTION
    ROOT_OBJ['asset_provenance']=ROOM_ATTRIBUTION
    mat['screen_aspect_ratio']=16/9;mat['screen_uv_contract']='UV0 0..1; +X room-facing normal'
    M['garage_screen_display']=mat
    start=len(OBJECTS)
    # The shallow chassis projects only 0.915 m inward from the structural wall,
    # remaining beyond the measured parking and complete camera-orbit envelope.
    box('Arrival television chassis',(-9.17,2.65,-4.30),(.26,2.48,4.32),'dark',.018)
    for z in [-5.60,-3.0]:
        box('Arrival television wall mounting plate',(-9.72,2.65,z),(.08,.70,.24),'steel',.008)
        box('Arrival television rigid mounting arm',(-9.49,2.65,z),(.40,.10,.12),'steel',.008)
    for y in [1.415,3.885]:
        box('Arrival television horizontal bezel',(-9.015,y,-4.30),(.10,.09,4.38),'dark',.006)
    for z in [-6.445,-2.155]:
        box('Arrival television vertical bezel',(-9.015,2.65,z),(.10,2.54,.09),'dark',.006)
    # Modest diffuser geometry uses the existing fixture material and no light.
    for y in [1.365,3.935]:
        box('Arrival television surround diffuser',(-9.23,y,-4.30),(.045,.018,4.30),'light')
    for z in [-6.51,-2.09]:
        box('Arrival television surround diffuser',(-9.23,2.65,z),(.045,2.50,.018),'light')
    tube('Arrival television power cable',[(-9.31,1.64,-5.66),(-9.52,1.48,-5.66),(-9.65,1.19,-5.66),(-9.65,1.02,-5.66)],.017,'rubber',2)
    box('Arrival television cable outlet',(-9.66,1.02,-5.66),(.13,.19,.13),'dark',.008)
    # Ordering is counterclockwise viewed from inside: +game X is the normal.
    corners=[(-9.02,1.46875,-2.20),(-9.02,1.46875,-6.40),
             (-9.02,3.83125,-6.40),(-9.02,3.83125,-2.20)]
    uvs=[(0,0),(1,0),(1,1),(0,1)]
    mesh=bpy.data.meshes.new('Arrival television independently editable screen')
    mesh.from_pydata([v(point) for point in corners],[],[(0,1,2,3)]);mesh.update()
    ob=bpy.data.objects.new('Arrival wall television display',mesh);bpy.context.collection.objects.link(ob)
    reg(ob,ob.name,'garage_screen_display')
    uv=mesh.uv_layers.new(name='UV0')
    for loop in mesh.loops:uv.data[loop.index].uv=uvs[loop.vertex_index]
    ob['garage_screen_surface']=True;ob['collision_role']='none'
    for ob in OBJECTS[start:]:
        ob['garage_screen_fixture']=True;ob['garage_reverse_workshop']=True;ob['garage_interior_completion']=True
        ob['authoring_source']='scripts/create_garage.py:arrival_wall_television'
    ROOT_OBJ['garageScreen']={'version':1,'material':'garage_screen_display','width':4.20,'height':2.3625,
        'center':[-9.02,2.65,-4.30],'normal':[1.,0.,0.],
        'corners':[{'uv':list(uv),'position':list(point)} for uv,point in zip(uvs,corners)],
        'fixtureMin':[-9.76,1.356,-6.519],'fixtureMax':[-8.965,3.944,-2.081],
        'poster':'assets/garage/roadster-screen-poster.jpg','video':'assets/garage/roadster-screen-loop.mp4'}


def upgrade_arrival_television(tier):
    """Only replace the new intake location and TV, never the original workshop."""
    global OBJECTS
    prefixes=('Arrival ventilation','Arrival intake','Arrival louver','Arrival overhead extraction',
              'Arrival duct','Arrival vertical extraction','Arrival riser')
    for ob in list(OBJECTS):
        if ob.get('garage_screen_fixture') or (ob.get('garage_reverse_workshop') and ob.name.startswith(prefixes)):
            OBJECTS.remove(ob);mesh=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
            if not mesh.users:bpy.data.meshes.remove(mesh)
    M.update({alias:bpy.data.materials[name] for alias,name in PALETTE_NAMES.items() if name in bpy.data.materials})
    start=len(OBJECTS);arrival_ventilation(3.15 if tier<3 else 3.65,tier)
    place_workshop_group(start,-9.30,-4.45,-pi/2)
    for ob in OBJECTS[start:]:
        ob['garage_reverse_workshop']=True;ob['garage_interior_completion']=True
        ob['authoring_source']='scripts/create_garage.py:arrival_ventilation'
    arrival_wall_television()
    ROOT_OBJ['reverse_workshop_new_parts']=sum(bool(ob.get('garage_reverse_workshop')) for ob in OBJECTS)


def arrival_charge_point(tier):
    """A compact arrival-side EV service pedestal with a tethered connector.

    It is visually and functionally distinct from the retained rear repair
    workbench. Cable, connector holster, user display and impact guard are real
    geometry; no manufacturer logo or invented written specification is used.
    """
    shell='paint' if tier<3 else 'panel';w=.54 if tier<3 else .66
    box('Arrival charging pedestal foot',(0,.07,0),(w+.20,.14,.49),'steel',.012)
    box('Arrival charging pedestal spine',(0,.78,.06),(w,1.42,.29),shell,.025)
    box('Arrival charger sloped upper cap',(0,1.52,.045),(w+.02,.10,.34),'dark',.012)
    box('Arrival charging interface surround',(0,1.21,-.105),(w-.09,.46,.035),'dark',.012)
    box('Arrival charging status screen',(0,1.30,-.129),(w-.17,.22,.012),'black' if tier==1 else 'screen')
    box('Arrival charging status bar',(0,1.37,-.139),(w-.25,.014,.005),'signal' if tier==1 else 'cyan')
    for j in range(4):
        box('Arrival charge level segment',(-.13+j*.085,1.27,-.14),(.052,.040,.007),('signal' if tier==1 else 'cyan') if j<3 else 'door')
    cylinder('Arrival authorization button',(0,1.10,-.16),(0,1.10,-.126),.046,'steel',16)
    box('Arrival charger lower protective face',(0,.54,-.101),(w-.06,.66,.025),shell,.01)
    count=1 if tier<2 else 2
    for side in [-1,1][:count]:
        sx=side*(w/2+.10)
        box('Arrival charge connector holster',(sx,1.14,-.04),(.11,.22,.14),'dark',.012)
        cylinder('Arrival tethered connector grip',(sx,1.03,-.12),(sx,1.24,-.12),.040,'rubber',12)
        cylinder('Arrival charge connector nose',(sx,1.22,-.12),(sx,1.29,-.12),.032,'steel',12)
        # Nonclosed, explicitly ordered bends avoid tiny coincident cap faces.
        tube('Arrival charging service cable',[(sx,1.04,-.10),(sx*1.40,.80,-.12),(sx*1.58,.38,-.12),(sx*1.27,.25,-.12),(sx*.60,.30,-.12),(sx*.42,.50,-.10),(sx*.42,.73,.03)],.024,'rubber',2)
    # One horizontal protection hoop, not a cluster of random floor props.
    tube('Arrival charging impact hoop',[(-.53,.04,-.34),(-.53,.58,-.34),(-.43,.70,-.34),(.43,.70,-.34),(.53,.58,-.34),(.53,.04,-.34)],.035,'signal' if tier<3 else 'steel',2)
    if tier>=3:
        box('Arrival integrated charger canopy',(0,1.72,.01),(1.10,.065,.57),'panel',.015)
        for x in [-.45,.45]:box('Arrival canopy slender bracket',(x,1.52,.18),(.045,.35,.045),'steel')
    if tier==4:
        box('Arrival fleet charger status mast',(0,2.02,.20),(.10,1.02,.10),'steel',.01)
        box('Arrival fleet status head',(0,2.52,.15),(.54,.22,.13),'dark',.015)
        box('Arrival fleet status diffuser',(0,2.52,.077),(.43,.055,.018),'cyan')


def dress_reverse_workshop(tier):
    """Turn the reverse side into a distinct arrival/charging/utilities zone.

    No repair bench, toolboard or duplicate cupboard is added. The visible
    left return holds extraction ducting and one compact charging pedestal;
    the front-left free wall carries the entrance's drive and hand-chain.
    Flush lane markings and drainage relate these utilities to the gate.
    All equipment stays shallow against the perimeter and all old art remains.
    """
    global OBJECTS,M
    for ob in list(OBJECTS):
        if ob.get('garage_reverse_workshop'):
            OBJECTS.remove(ob);mesh=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
            if not mesh.users:bpy.data.meshes.remove(mesh)
    M.update({alias:bpy.data.materials[name] for alias,name in PALETTE_NAMES.items() if name in bpy.data.materials})
    start=len(OBJECTS);palette='paint' if tier<3 else 'panel'
    # A real protective dado and structural rhythm, not decorative posters.
    for side in [-1,1]:
        for z in [-7.75,-6.15,-4.55,-2.95,-1.35]:
            box('Arrival lower wall impact panel',(side*9.745,.91,z),(.065,1.20,1.55),palette,.009)
            box('Arrival wall panel vertical reveal',(side*9.70,.91,z-.79),(.028,1.20,.025),'dark')
        box('Arrival wall protective top cap',(side*9.705,1.54,-4.55),(.095,.045,8.03),'steel',.005)
        for z in [-8.1,-5.3,-2.5]:box('Arrival upper wall cast joint',(side*9.79,4.85,z),(.016,2.30,.018),'seam')
        box('Arrival wall horizontal cast joint',(side*9.785,3.66,-4.8),(.018,.022,8.15),'seam')
    # Main composition occupies the previously empty left field in rear view.
    begin=len(OBJECTS);arrival_ventilation(3.15 if tier<3 else 3.65,tier)
    place_workshop_group(begin,-9.30,-4.45,-pi/2)
    arrival_wall_television()
    begin=len(OBJECTS);arrival_charge_point(tier)
    place_workshop_group(begin,-9.22,-7.12,-pi/2)
    # A gate drive, with a shaft into the existing entrance header and reachable
    # manual chain: this is entry machinery, not another repair cabinet.
    begin=len(OBJECTS)
    box('Arrival gate motor mounting plate',(0,3.98,.19),(.73,.65,.07),'steel',.012)
    box('Arrival gate geared motor',(0,4.07,-.02),(.48,.39,.34),'door',.025)
    cylinder('Arrival gate motor gearbox',(.18,4.08,-.02),(.37,4.08,-.02),.17,'dark',20)
    cylinder('Arrival gate drive output shaft',(.35,4.08,-.02),(1.40,4.08,-.02),.043,'steel',12)
    for x in [.63,1.20]:box('Arrival gate shaft bearing',(x,4.08,.04),(.12,.22,.18),'dark',.008)
    tube('Arrival gate manual chain', [(-.15,3.85,-.08),(-.15,1.40,-.08),(-.10,1.19,-.08),(.10,1.19,-.08),(.15,1.40,-.08),(.15,3.85,-.08)],.014,'steel',1)
    for y in np.arange(1.45,3.65,.18):
        for x in [-.15,.15]:box('Arrival hand chain visible link',(x,y,-.08),(.033,.044,.025),'steel')
    box('Arrival chain keeper',(0,1.50,.02),(.42,.16,.11),'signal',.012)
    tube('Arrival gate motor power conduit',[(-.40,1.1,.17),(-.40,4.48,.17),(1.42,4.48,.17)],.022,'steel',1)
    box('Arrival gate emergency isolation',(-.40,1.35,.08),(.23,.31,.13),'signal',.012)
    cylinder('Arrival gate isolation switch',(-.40,1.35,-.01),(-.40,1.35,-.005),.059,'red',16)
    place_workshop_group(begin,-4.95,-8.55,pi,mirror_x=True)
    # Opposite-side extraction is a quiet architectural return, not a repeated
    # furniture bank. Higher tiers add serviceable filters and clean air supply.
    begin=len(OBJECTS)
    box('Arrival exhaust grille casing',(0,2.96,.22),(2.65,1.05,.22),'door' if tier<3 else 'panel',.012)
    box('Arrival exhaust grille throat',(0,2.96,.095),(2.48,.90,.016),'dark' if tier==3 else 'black')
    for j in range(7):box('Arrival exhaust louver blade',(0,2.58+j*.125,.045),(2.48,.035,.14),'steel' if tier>=3 else 'door')
    if tier>=2:
        box('Arrival replaceable ventilation filter',(0,4.05,.23),(2.65,.85,.24),'panel',.012)
        for x in [-1.15,1.15]:box('Arrival filter service latch',(x,4.05,.09),(.035,.23,.035),'steel',.004)
        for x in np.linspace(-1.05,1.05,9):box('Arrival filter intake slot',(x,4.05,.09),(.04,.63,.015),'dark')
    if tier>=3:
        box('Arrival clean air distribution trunk',(0,5.06,.23),(4.0,.36,.34),'panel',.012)
        for x in [-1.5,-.5,.5,1.5]:box('Arrival clean air duct coupling',(x,5.06,.23),(.035,.41,.38),'steel',.004)
    if tier==4:
        box('Arrival regulated service manifold',(0,1.94,.19),(2.65,.35,.16),'dark',.014)
        for x in [-.85,0,.85]:
            cylinder('Arrival regulated supply outlet',(x,1.94,.07),(x,1.94,.04),.09,'steel',16)
            box('Arrival supply status indicator',(x,2.07,.035),(.13,.018,.006),'cyan')
    place_workshop_group(begin,9.36,-5.45,pi/2)
    # The lane stops before the display car. It guides the entrance, rather
    # than surrounding the car with another pedestal or a false parking bay.
    for x in [-2.68,2.68]:
        for z in [-7.15,-6.15,-5.15]:box('Arrival entrance lane dash',(x,.001,z),(.055,.008,.62),'mark')
    box('Arrival entrance drainage recess',(0,-.001,-7.78),(6.65,.008,.18),'dark')
    for x in np.linspace(-3.25,3.25,44):box('Arrival threshold drain grating',(x,.004,-7.78),(.025,.006,.15),'steel')
    for x in [-3.35,3.35]:box('Arrival floor saw-cut expansion seam',(x,-.002,-.2),(.012,.008,18),'seam')
    for z in [-3.2,2.8]:box('Arrival floor saw-cut expansion seam',(0,-.002,z),(20,.008,.012),'seam')
    for ob in OBJECTS[start:]:
        ob['garage_reverse_workshop']=True;ob['garage_interior_completion']=True
        ob['authoring_source']='scripts/create_garage.py:dress_reverse_workshop'
    ROOT_OBJ['reverse_workshop_version']=2
    ROOT_OBJ['reverse_workshop_program']=['Arrival lane, basic charging and extraction','Dual charging and serviceable air filtration','Integrated charging and clean-air distribution','Fleet charging and regulated utility supply'][tier-1]
    ROOT_OBJ['reverse_workshop_new_parts']=len(OBJECTS)-start


def camera_contract():
    """Describe actual interior and authored solids before material batching.

    Small details belong to their enclosing solids and do not need hundreds of
    duplicate broad-phase boxes. Thin rails and overhead luminaires are retained.
    """
    bpy.context.view_layer.update();items=[]
    architecture={'Continuous structural slab','Rear wall cast concrete','Left return wall',
      'Right rear return wall','Interior front structural wall','Interior left front return',
      'Interior right front return','Interior insulated ceiling panel'}
    for ob in OBJECTS:
        if ob.get('original_garage_mural') or ob.get('garage_screen_surface') or ob.name.split('.')[0] in architecture:continue
        ps=[ob.matrix_world@Vector(p) for p in ob.bound_box]
        a=np.asarray([(p.x,p.z,-p.y) for p in ps]);lo=a.min(axis=0);hi=a.max(axis=0);size=hi-lo
        if hi[1]<.06 or max(size)<.23:continue
        # Keep perimeter facing panels even when thin; enclosed small fasteners,
        # handles, graphics and individual tool heads cannot create new hazards.
        if sorted(size)[1]<.075:continue
        items.append({'name':ob.name,'min':lo.round(5).tolist(),'max':hi.round(5).tolist()})
    # Drop boxes wholly contained by another already authored solid. This keeps
    # bounds exact and avoids a loose aggregate enclosing legitimate free space.
    retained=[]
    for i,item in enumerate(items):
        lo=np.asarray(item['min']);hi=np.asarray(item['max'])
        if any(i!=j and all(lo>=np.asarray(other['min'])-1e-5) and all(hi<=np.asarray(other['max'])+1e-5)
               and (i>j or np.prod(hi-lo)<np.prod(np.asarray(other['max'])-np.asarray(other['min']))-1e-8)
               for j,other in enumerate(items)):continue
        retained.append(item)
    contract={'version':1,'interiorMin':[-9.88,.02,-8.97],'interiorMax':[9.88,6.45,7.57],
      'clearance':.25,'orbitRadius':6.0,'obstacles':retained}
    ROOT_OBJ['garageCamera']=contract;bpy.context.scene['garageCamera']=contract
    return contract

def apply_original_mural(tier):
    """Project one original painting onto existing architectural faces, not a poster.

    Geometry belongs to a separate, non-collision decal batch; the original wall,
    door leaves, gaps, fasteners and fins are untouched. Paint sits 2 mm in front
    of each actual surface. All tiers share one small 1024 x 512 RGBA paint map.
    """
    global OBJECTS
    for ob in list(OBJECTS):
        if ob.get('original_garage_mural'):
            OBJECTS.remove(ob); mesh=ob.data; bpy.data.objects.remove(ob,do_unlink=True)
            if not mesh.users: bpy.data.meshes.remove(mesh)
    name='Original rose velocity mural'
    mat=bpy.data.materials.get(name)
    if mat is None: mat=material(name,(1,1,1),0,.94)
    M[name]=mat; nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF')
    for node in list(nt.nodes):
        if node.type=='TEX_IMAGE': nt.nodes.remove(node)
    path=os.path.join(OUT,'original-rose-velocity-mural.png')
    if not os.path.exists(path): raise FileNotFoundError('Run python art/garage/mural/create_mural.py first')
    img=bpy.data.images.load(path,check_existing=True); img.name='original-rose-velocity-mural'; img.reload()
    im=nt.nodes.new('ShaderNodeTexImage'); im.image=img; im.interpolation='Linear'; im.extension='CLIP'
    nt.links.new(im.outputs['Color'],bs.inputs['Base Color']); nt.links.new(im.outputs['Alpha'],bs.inputs['Alpha'])
    mat.surface_render_method='BLENDED'; mat.use_transparency_overlap=False
    mat['original_art_source']='art/garage/mural/rose-velocity.svg'; mat['collision_role']='none'; mat['paint_surface']='Aerosol pigment on existing rear architecture, not emissive signage'
    # Bounds deliberately cover the rear door/right wall visible from the actual
    # game overview, rather than only the workshop wall hidden by its right UI.
    bounds={1:(1.40,9.62,1.34,5.45),2:(2.80,9.62,1.72,5.13),3:(2.58,9.62,2.53,6.05),4:(-3.72,3.72,1.25,4.97)}[tier]
    x0,x1,y0,y1=bounds
    targets={'Rear wall cast concrete','Insulated sectional door leaf','Modular wall cassette','Acoustic wall fin'}
    verts=[]; faces=[]
    def clipped(poly,axis,value,greater):
        if not poly:return []
        out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            inside_a=(a[axis]>=value) if greater else (a[axis]<=value)
            inside_b=(b[axis]>=value) if greater else (b[axis]<=value)
            if inside_a:out.append(a)
            if inside_a!=inside_b:
                t=(value-a[axis])/(b[axis]-a[axis]);out.append(a+(b-a)*t)
        return out
    bpy.context.view_layer.update()
    for ob in OBJECTS:
        if ob.name.split('.')[0] not in targets:continue
        for poly in ob.data.polygons:
            normal=(ob.matrix_world.to_3x3()@poly.normal).normalized()
            if normal.y<.9999:continue # Only inward rear faces, never tops/sides.
            ps=[ob.matrix_world@ob.data.vertices[i].co for i in poly.vertices]
            for axis,value,greater in [(0,x0,True),(0,x1,False),(2,y0,True),(2,y1,False)]:ps=clipped(ps,axis,value,greater)
            # Clipping at a source corner can repeat it. Remove only those exact
            # coincidences so no numeric-collapse defects enter the new batch.
            clean=[]
            for pt in ps:
                if not clean or (pt-clean[-1]).length>1e-6:clean.append(pt)
            if len(clean)>1 and (clean[-1]-clean[0]).length<1e-6:clean.pop()
            if len(clean)<3:continue
            area=sum((clean[i]-clean[0]).cross(clean[i+1]-clean[0]).length for i in range(1,len(clean)-1))
            if area<1e-9:continue
            start=len(verts);verts.extend([(p.x,p.y+.002,p.z) for p in clean]);faces.append(tuple(range(start,start+len(clean))))
    if not faces:raise RuntimeError('Original mural did not find rear architectural faces')
    mesh=bpy.data.meshes.new('Original mural projected surface mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    ob=bpy.data.objects.new('Original rose velocity wall paint',mesh);bpy.context.collection.objects.link(ob);reg(ob,ob.name,name)
    uv=mesh.uv_layers.new(name='Original mural whole-wall projection')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            p=mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv=((x1-p.x)/(x1-x0),(p.z-y0)/(y1-y0))
    ob['original_garage_mural']=True;ob['collision_role']='none';ob['artwork']='Rose Velocity';ob['authoring_source']='art/garage/mural/rose-velocity.svg';ob['paint_offset_m']=.002
    ob['projection_bounds_game_xy']=list(bounds);ob['original_architecture_unchanged']=True
    bpy.context.scene['original_mural']='Rose Velocity: original rose, magenta and plum flight-road coupe graffiti'

def lighting(tier):
    def area(name,pos,target,power,color,size):
        d=bpy.data.lights.new(name,'AREA'); d.energy=power; d.color=color; d.shape='DISK'; d.size=size
        o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.location=v(pos); o.rotation_euler=(v(target)-o.location).to_track_quat('-Z','Y').to_euler()
    area('Preview only - broad daylight',(2.5,6.1,-5.8),(0,.6,1.4),1500,(.80,.89,1.0),9)
    area('Preview only - warm workshop key',(-4,5.5,2.5),(-1,0,2),1300,(1.0,.86,.68),7)
    area('Preview only - rear architectural fill',(5,5.0,5.2),(0,1,1),700,(.73,.90,1.0),5)
    bpy.context.scene.world.color=(.18,.18,.18)
    bpy.context.scene.world.use_nodes=True; bg=bpy.context.scene.world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value=(.28,.33,.38,1); bg.inputs['Strength'].default_value=.22
    bpy.ops.object.camera_add(location=v((7,3.5,-8))); cam=bpy.context.object; cam.name='PREVIEW_CAMERA_not_exported'; cam.rotation_euler=(v((0,1.1,1))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.lens=28
    bpy.context.scene.camera=cam; sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=48; sc.cycles.use_denoising=False; sc.render.resolution_x=1440; sc.render.resolution_y=900; sc.render.resolution_percentage=100
    sc.view_settings.view_transform='AgX'; sc.render.image_settings.file_format='PNG'

# Match the GLB audit's scale-relative numerical-collapse criterion. This is not
# a world-area cutoff: millimetre details remain, even next to large architecture.
DEGENERATE_RELATIVE_CROSS_SQUARED = 1e-16

def collapsed_triangles(coordinates, indices):
    points=np.asarray(coordinates,dtype=np.float64)[indices]
    ab=points[:,1]-points[:,0]; ac=points[:,2]-points[:,0]; bc=points[:,2]-points[:,1]
    longest=np.maximum.reduce([np.einsum('ij,ij->i',e,e) for e in (ab,ac,bc)])
    cross=np.cross(ab,ac)
    return np.einsum('ij,ij->i',cross,cross)<=longest**2*DEGENERATE_RELATIVE_CROSS_SQUARED

def clean_collapsed_mesh(obj, export_transform):
    """Delete only collapsed triangles; retain positions, named parts and UVs.

    Material batching joins geometry in the first object's coordinate frame.
    Check that exact Float32 projection as well as the editable local geometry,
    because bevel edges below its representable precision collapse only at join.
    Only affected polygons are triangulated; untouched source quads stay editable.
    """
    mesh=obj.data; mesh.calc_loop_triangles()
    if not mesh.loop_triangles: return 0
    indices=np.asarray([tri.vertices[:] for tri in mesh.loop_triangles])
    local=[vertex.co[:] for vertex in mesh.vertices]
    projected=[(export_transform@vertex.co)[:] for vertex in mesh.vertices]
    bad=collapsed_triangles(local,indices)|collapsed_triangles(projected,indices)
    if not bad.any(): return 0
    affected={mesh.loop_triangles[i].polygon_index for i in np.flatnonzero(bad)}
    bm=bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
    faces=[bm.faces[index] for index in affected if len(bm.faces[index].verts)>3]
    if faces: bmesh.ops.triangulate(bm,faces=faces,quad_method='BEAUTY',ngon_method='BEAUTY')
    bm.verts.ensure_lookup_table(); bm.verts.index_update()
    triangles=[face for face in bm.faces if len(face.verts)==3]
    indices=np.asarray([[vertex.index for vertex in face.verts] for face in triangles])
    local=[vertex.co[:] for vertex in bm.verts]
    projected=[(export_transform@vertex.co)[:] for vertex in bm.verts]
    bad=collapsed_triangles(local,indices)|collapsed_triangles(projected,indices)
    discarded=[face for face,remove in zip(triangles,bad) if remove]
    bmesh.ops.delete(bm,geom=discarded,context='FACES_ONLY')
    bm.to_mesh(mesh); bm.free(); mesh.update()
    return len(discarded)

def clean_source_meshes():
    result=[]
    for mat in dict.fromkeys(M.values()):
        group=[obj for obj in OBJECTS if obj.data.materials and obj.data.materials[0]==mat]
        if not group: continue
        inverse=group[0].matrix_world.inverted()
        for obj in group:
            removed=clean_collapsed_mesh(obj,inverse@obj.matrix_world)
            if removed: result.append({'object':obj.name,'material':mat.name,'removed_triangles':removed})
    return result

def refresh_screen_poster_only(tier,source):
    """Swap only packed poster bytes and attribution, with exact preservation.

    Saved Blender fingerprints prove every mesh, transform, shader socket/link,
    render setting and rig is identical. The runtime GLB is not rebatched: only
    one image bufferView is replaced, and every other view's bytes are compared
    exactly. Material parameters and all actual-solid camera metadata stay fixed.
    """
    import copy,struct
    from pathlib import Path
    from sanitize_blend_sources import fingerprint,verify_paths
    poster_path=Path(OUT)/'roadster-screen-poster.jpg';poster=poster_path.read_bytes()
    media=json.loads((Path(ART)/'screen'/'supplied-video-provenance.json').read_text())
    expected=next(item for item in media['files'] if item['path'].endswith('roadster-screen-poster.jpg'))
    assert len(poster)==expected['bytes'] and hashlib.sha256(poster).hexdigest()==expected['sha256']
    before=fingerprint();source_before=hashlib.sha256(Path(source).read_bytes()).hexdigest()
    camera=json.dumps(ROOT_OBJ['garageCamera'].to_dict(),sort_keys=True)
    screen=json.dumps(ROOT_OBJ['garageScreen'].to_dict(),sort_keys=True)
    packed=lambda:{im.name:hashlib.sha256(im.packed_file.data).hexdigest() for im in bpy.data.images if im.packed_file}
    images_before=packed();image=bpy.data.images['roadster-screen-poster']
    assert image.colorspace_settings.name=='sRGB'
    if image.packed_file:image.unpack(method='REMOVE')
    image.filepath=str(poster_path);image.reload();image.pack()
    assert list(image.size)==[640,360] and image.colorspace_settings.name=='sRGB'
    bpy.data.materials['garage_screen_display']['screen_asset']=SCREEN_ATTRIBUTION
    ROOT_OBJ['asset_provenance']=ROOM_ATTRIBUTION
    save_portable(source)
    after=fingerprint()
    for key in before:
        if key!='images':assert before[key]==after[key],('Poster refresh changed',key)
    images_after=packed()
    assert set(images_before)==set(images_after)
    for name in images_before:
        assert images_after[name]==(expected['sha256'] if name=='roadster-screen-poster' else images_before[name]),name
    assert camera==json.dumps(ROOT_OBJ['garageCamera'].to_dict(),sort_keys=True)
    assert screen==json.dumps(ROOT_OBJ['garageScreen'].to_dict(),sort_keys=True)
    assert verify_paths(Path(source))
    source_after=hashlib.sha256(Path(source).read_bytes()).hexdigest()
    path=Path(OUT)/('tier%d.glb'%tier);old=path.read_bytes()
    length=struct.unpack_from('<I',old,12)[0];original=json.loads(old[20:20+length]);doc=copy.deepcopy(original)
    binary_start=20+length;binary_length,binary_type=struct.unpack_from('<II',old,binary_start)
    assert binary_type==0x004e4942 and binary_start+8+binary_length==len(old)
    blob=old[binary_start+8:];img=next(im for im in doc['images'] if im['name']=='roadster-screen-poster')
    assert img['mimeType']=='image/jpeg';view_index=img['bufferView'];view=doc['bufferViews'][view_index]
    start=view.get('byteOffset',0);old_size=view['byteLength'];old_end=start+((old_size+3)//4)*4
    new_span=((len(poster)+3)//4)*4;delta=new_span-(old_end-start)
    for index,item in enumerate(doc['bufferViews']):
        if index==view_index:continue
        lo=item.get('byteOffset',0);hi=lo+item['byteLength']
        assert hi<=start or lo>=old_end,('Overlapping image bufferView',index)
        if lo>=old_end:item['byteOffset']=lo+delta
    changed=blob[:start]+poster+b'\0'*(new_span-len(poster))+blob[old_end:]
    view['byteLength']=len(poster)
    doc['buffers'][0]['byteLength']=max(v.get('byteOffset',0)+v['byteLength'] for v in doc['bufferViews'])
    changed=changed[:doc['buffers'][0]['byteLength']]
    for node in doc['nodes']:
        if node.get('name')=='GARAGE_TIER_%02d'%tier:node['extras']['asset_provenance']=ROOM_ATTRIBUTION
    display=next(mat for mat in doc['materials'] if mat['name']=='garage_screen_display')
    display['extras']['screen_asset']=SCREEN_ATTRIBUTION
    # Check every source accessor byte, including unchanged other images.
    for index,(old_view,new_view) in enumerate(zip(original['bufferViews'],doc['bufferViews'])):
        a=blob[old_view.get('byteOffset',0):old_view.get('byteOffset',0)+old_view['byteLength']]
        b=changed[new_view.get('byteOffset',0):new_view.get('byteOffset',0)+new_view['byteLength']]
        assert b==(poster if index==view_index else a),('Changed bufferView',index)
    check=copy.deepcopy(doc)
    check['buffers']=original['buffers'];check['bufferViews']=original['bufferViews']
    for node,old_node in zip(check['nodes'],original['nodes']):
        if node.get('name')=='GARAGE_TIER_%02d'%tier:node['extras']['asset_provenance']=old_node['extras']['asset_provenance']
    for mat,old_mat in zip(check['materials'],original['materials']):
        if mat['name']=='garage_screen_display':mat['extras']['screen_asset']=old_mat['extras']['screen_asset']
    assert check==original,'Unexpected non-image GLB change'
    text=json.dumps(doc,ensure_ascii=True,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
    changed+=b'\0'*((-len(changed))%4)
    result=struct.pack('<III',0x46546c67,2,28+len(text)+len(changed))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(changed),0x004e4942)+changed
    tmp=path.with_suffix('.glb.tmp');tmp.write_bytes(result);os.replace(tmp,path)
    report_path=Path(ART)/('tier%d-report.json'%tier);report=json.loads(report_path.read_text())
    report['bytes']=len(result);report['sha256']=hashlib.sha256(result).hexdigest()
    report['original_textures']=[name for name in report['original_textures'] if name!='roadster-screen-poster.jpg']
    report['user_provided_textures']=['roadster-screen-poster.jpg']
    report['screen_media_provenance']='art/garage/screen/supplied-video-provenance.json'
    report['screen_poster_swap']={'method':'Exact image bufferView replacement, no geometry export or rebatching',
        'source_before_sha256':source_before,'source_after_sha256':source_after,
        'glb_before_sha256':hashlib.sha256(old).hexdigest(),'glb_after_sha256':report['sha256'],
        'poster_sha256':expected['sha256'],'poster_bytes':len(poster),
        'all_geometry_transforms_uvs_shaders_settings_unchanged':True,'garage_camera_unchanged':True,
        'other_image_bytes_unchanged':True,'all_other_glb_buffer_views_byte_identical':True,
        'attribution_only_metadata_updated':['root.asset_provenance','garage_screen_display.extras.screen_asset'],
        'preserved_fingerprint':{key:value for key,value in after.items() if key!='images'}}
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    print('SCREEN_POSTER_SWAP_PASS',tier,len(result),expected['sha256'],flush=True)


def main(tier):
    global ROOT_OBJ,OBJECTS,M
    source=os.path.join(ART,'tier%d.blend'%tier)
    if OPT.resume and os.path.exists(source):
        bpy.ops.wm.open_mainfile(filepath=source)
        ROOT_OBJ=bpy.data.objects.get('GARAGE_TIER_%02d'%tier)
        OBJECTS=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.parent==ROOT_OBJ]
        M={m.name:m for m in bpy.data.materials}
    else:
        build_scene(tier)
    if OPT.screen_poster_only:
        if not OPT.resume:raise ValueError('--screen-poster-only requires --resume')
        refresh_screen_poster_only(tier,source)
        return
    if OPT.arrival_tv_only:
        if not OPT.resume:raise ValueError('--arrival-tv-only requires --resume')
        before=original_geometry_signature()
        upgrade_arrival_television(tier)
        cleanup=clean_source_meshes()
        if before!=original_geometry_signature():raise RuntimeError('TV addition changed original workshop geometry')
        camera_contract();save_portable(source);export_tier(tier,source,cleanup)
        return
    if OPT.workshop_surface_only:
        if not OPT.resume: raise ValueError('--workshop-surface-only requires --resume')
        from garage_surface_finish import apply_workshop_surface_finish
        before=original_geometry_signature(include_interior=True)
        camera_before=json.dumps(ROOT_OBJ['garageCamera'].to_dict(),sort_keys=True)
        apply_workshop_surface_finish(ROOT_OBJ)
        if before!=original_geometry_signature(include_interior=True):
            raise RuntimeError('Surface refresh changed geometry, UVs or material assignment')
        if camera_before!=json.dumps(ROOT_OBJ['garageCamera'].to_dict(),sort_keys=True):
            raise RuntimeError('Surface refresh changed actual-solid camera metadata')
        save_portable(source)
        export_tier(tier,source,[])
        return
    if OPT.reverse_workshop_only:
        if not OPT.resume: raise ValueError('--reverse-workshop-only requires --resume')
        from garage_surface_finish import apply_workshop_surface_finish
        before=original_geometry_signature()
        dress_reverse_workshop(tier)
        apply_workshop_surface_finish(ROOT_OBJ)
        cleanup=clean_source_meshes()
        if before!=original_geometry_signature():
            raise RuntimeError('Reverse workshop changed accepted rear geometry or artwork')
        ROOT_OBJ['preserved_rear_geometry_sha256']=before
        # Former all-geometry preservation only applied to the superseded wall
        # repair. New equipment is intentional and is audited independently.
        if 'preserved_all_geometry_sha256' in ROOT_OBJ:del ROOT_OBJ['preserved_all_geometry_sha256']
        if 'wall_finish_version' in ROOT_OBJ:del ROOT_OBJ['wall_finish_version']
        camera_contract()
        save_portable(source)
        export_tier(tier,source,cleanup)
        return
    if OPT.interior_only:
        if not OPT.resume: raise ValueError('--interior-only requires --resume')
        before=original_geometry_signature()
        complete_interior(tier)
        dress_reverse_workshop(tier)
        from garage_surface_finish import apply_workshop_surface_finish
        apply_workshop_surface_finish(ROOT_OBJ)
        cleanup=clean_source_meshes()
        after=original_geometry_signature()
        if before!=after:raise RuntimeError('Interior completion changed accepted original geometry')
        ROOT_OBJ['preserved_rear_geometry_sha256']=before
        camera_contract()
        save_portable(source)
        export_tier(tier,source,cleanup)
        return
    if OPT.mural_only:
        if not OPT.resume: raise ValueError('--mural-only requires --resume')
        apply_original_mural(tier)
        cleanup=clean_source_meshes()
        bpy.context.preferences.filepaths.save_version=0
        save_portable(source)
        export_tier(tier,source,cleanup)
        return
    if OPT.cleanup_only:
        if not OPT.resume: raise ValueError('--cleanup-only requires --resume')
        cleanup=clean_source_meshes()
        bpy.context.preferences.filepaths.save_version=0
        save_portable(source)
        export_tier(tier,source,cleanup)
        return
    if OPT.refresh_textures:
        new_color,new_rough=surface_texture()
        for mat in bpy.data.materials:
            if not mat.use_nodes: continue
            for node in mat.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image:
                    if node.image.name.startswith('original-concrete-grain'): node.image=new_color
                    elif node.image.name.startswith('original-concrete-roughness'): node.image=new_rough
        for img in list(bpy.data.images):
            if img.users==0 and img.name.startswith('original-concrete'): bpy.data.images.remove(img)
    # Upgrade saved preview sources without rebuilding editable geometry.
    label_names={'Bay numeral','Utility identifier','Service plaque','Workshop designation','Engineering wall title','Floor datum legend','Flagship identification'}
    for ob in OBJECTS:
        if ob.name in label_names and not ob.get('garage_label_front_facing'):
            width=ob.dimensions.x; ob.rotation_euler.z+=pi; ob.location.x+=width; ob['garage_label_front_facing']=True
    if tier==2:
        for ob in OBJECTS:
            if ob.name in {'Bay numeral','Workshop designation'}: ob.data.materials[0]=bpy.data.materials['Graphite structural powdercoat']
    sc=bpy.context.scene; sc.cycles.use_denoising=False; sc.cycles.samples=48; sc.render.threads_mode='FIXED'; sc.render.threads=2
    sc.view_settings.exposure=-.35
    old_scuff=bpy.data.materials.get('Embedded floor scuff')
    if old_scuff:
        old_scuff.diffuse_color=(.055,.065,.07,1); old_scuff.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.055,.065,.07,1)
    powers={'Preview only - broad daylight':1500,'Preview only - warm workshop key':1300,'Preview only - rear architectural fill':700}
    for light in bpy.data.lights:
        if light.name in powers: light.energy=powers[light.name]
    wall=bpy.data.materials.get('Warm architectural concrete'); floor=bpy.data.materials.get('Original mottled concrete')
    if wall and floor and not any(n.type=='TEX_IMAGE' for n in wall.node_tree.nodes):
        textures=[n.image for n in floor.node_tree.nodes if n.type=='TEX_IMAGE']
        if len(textures)>=2: set_textures(wall,textures[0],textures[1],(1,1,1))
    from garage_surface_finish import apply_workshop_surface_finish
    apply_workshop_surface_finish(ROOT_OBJ)
    sc.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.22
    sc.camera.data.lens=28; sc.camera.rotation_euler=(v((0,1.1,1))-sc.camera.location).to_track_quat('-Z','Y').to_euler()
    apply_original_mural(tier)
    cleanup=clean_source_meshes()
    before=original_geometry_signature()
    complete_interior(tier)
    dress_reverse_workshop(tier)
    cleanup+=clean_source_meshes()
    if before!=original_geometry_signature():raise RuntimeError('Interior completion changed accepted original geometry')
    ROOT_OBJ['preserved_rear_geometry_sha256']=before
    camera_contract()
    save_portable(source)
    export_tier(tier,source,cleanup)

def build_scene(tier):
    global ROOT_OBJ,OBJECTS,M
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    for d in list(bpy.data.materials): bpy.data.materials.remove(d)
    OBJECTS=[]; bpy.context.scene.unit_settings.system='METRIC'; bpy.context.scene.unit_settings.scale_length=1
    ROOT_OBJ=bpy.data.objects.new('GARAGE_TIER_%02d'%tier,None); bpy.context.collection.objects.link(ROOT_OBJ)
    ROOT_OBJ['coordinate_convention']='+Y up, -Z front, metres in exported GLB'; ROOT_OBJ['car_clearance']='x ±2m; z ±3.6m; floor top at y=-0.005m'; ROOT_OBJ['asset_provenance']='All geometry and textures are original procedural Blender artwork, no external assets.'
    setup_materials(); [None,tier1,tier2,tier3,tier4][tier](); lighting(tier)
    bpy.context.scene['garage_tier']=tier; bpy.context.scene['source']='scripts/create_garage.py'; bpy.context.scene['runtime_lights']='None exported: use unified runtime key/fill/environment.'

def export_tier(tier,source,cleanup=None):
    original_objects=len(OBJECTS)
    # Export copies consolidated by material. Source .blend retains each editable named part.
    export_meshes=[]
    groups=[(mat,[o for o in OBJECTS if o.data.materials and o.data.materials[0]==mat]) for mat in dict.fromkeys(M.values())]
    for mat,group in groups:
        if not group: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group: o.select_set(True)
        bpy.context.view_layer.objects.active=group[0]; bpy.ops.object.join(); obj=bpy.context.object; obj.name='Tier%d_%s'%(tier,mat.name.replace(' ','_')); export_meshes.append(obj)
        mod=obj.modifiers.new('Export triangulation','TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.data.calc_loop_triangles()
        indices=np.asarray([tri.vertices[:] for tri in obj.data.loop_triangles])
        if len(indices) and collapsed_triangles([vertex.co[:] for vertex in obj.data.vertices],indices).any():
            raise RuntimeError('Collapsed triangles survived source cleanup: '+obj.name)
    bpy.ops.object.select_all(action='DESELECT'); ROOT_OBJ.select_set(True)
    for o in export_meshes: o.select_set(True)
    path=os.path.join(OUT,'tier%d.glb'%tier)
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_cameras=False,export_lights=False,export_extras=True,export_apply=True,export_texcoords=True,export_normals=True,export_materials='EXPORT')
    verts=[]
    for o in export_meshes:
        for ve in o.data.vertices:
            p=o.matrix_world@ve.co; verts.append((p.x,p.z,-p.y))
    a=np.asarray(verts)
    report={'tier':tier,'root':ROOT_OBJ.name,'source':os.path.relpath(source,ROOT),'glb':os.path.relpath(path,ROOT),'editable_parts':original_objects,'draw_batches':len(export_meshes),'triangles':sum(len(o.data.polygons) for o in export_meshes),'vertices':sum(len(o.data.vertices) for o in export_meshes),'bounds_m':{'min':a.min(axis=0).round(5).tolist(),'max':a.max(axis=0).round(5).tolist()},'bytes':os.path.getsize(path),'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest(),'original_textures':['original-concrete-grain.png','original-concrete-roughness.png','original-rose-velocity-mural.png'],'clear_car_zone':{'x':[-2,2],'z':[-3.6,3.6],'floor_top_y':-.005},'contains_car':False,'runtime_lights':0}
    if ROOT_OBJ.get('workshop_surface_finish_version'):
        report['workshop_surface_finish_version']=ROOT_OBJ['workshop_surface_finish_version']
        report['original_textures']=['original-rose-velocity-mural.png']+[f'original-workshop-{surface}-{kind}.png' for surface in ['wall','floor'] for kind in ['basecolor','normal','roughness']]
    if ROOT_OBJ.get('reverse_workshop_version'):
        report['reverse_workshop_version']=ROOT_OBJ['reverse_workshop_version']
        report['reverse_workshop_new_parts']=ROOT_OBJ['reverse_workshop_new_parts']
        report['reverse_workshop_program']=ROOT_OBJ['reverse_workshop_program']
    if ROOT_OBJ.get('garageScreen'):
        report['garage_screen']=ROOT_OBJ['garageScreen'].to_dict()
        report['user_provided_textures']=['roadster-screen-poster.jpg']
        report['screen_media_provenance']='art/garage/screen/supplied-video-provenance.json'
    report['degenerate_cleanup']={'relative_cross_squared_threshold':DEGENERATE_RELATIVE_CROSS_SQUARED,'removed_triangles':sum(item['removed_triangles'] for item in cleanup or []),'parts':cleanup or [],'export_collapsed_triangles':0}
    if ROOT_OBJ.get('garageCamera'):
        report['camera_interior']=ROOT_OBJ['garageCamera'].to_dict()
        report['interior_completion_version']=1
        report['preserved_rear_geometry_sha256']=ROOT_OBJ.get('preserved_rear_geometry_sha256','')
    with open(os.path.join(ART,'tier%d-report.json'%tier),'w') as f: json.dump(report,f,indent=2)
    print('GARAGE_REPORT '+json.dumps(report),flush=True)
    if OPT.render or OPT.render_reverse:
        if OPT.preview_car:
            bpy.ops.object.select_all(action='DESELECT'); bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'public','assets','roadster.glb'))
            for obj in bpy.context.selected_objects: obj['preview_only']=True
        if OPT.render:
            bpy.context.scene.render.filepath=os.path.join(ART,'previews','tier%d.png'%tier); bpy.ops.render.render(write_still=True)
        if OPT.render_reverse:
            sc=bpy.context.scene;cam=sc.camera
            eye=(2.8,3.6,5.8) if tier==2 else (5.7,3.25,5.3)
            cam.location=v(eye);cam.rotation_euler=(v((0,1.3,-3.3))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=25
            sc.cycles.samples=20;sc.render.resolution_x=1152;sc.render.resolution_y=720
            sc.render.filepath=os.path.join(ART,'previews','tier%d-reverse.png'%tier);bpy.ops.render.render(write_still=True)

for tier in OPT.tiers: main(tier)
