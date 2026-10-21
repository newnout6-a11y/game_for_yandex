"""Reference-based Lightning McQueen physical toy replica, modelled in Blender in metres.
Run: blender -b --python-exit-code 1 --python scripts/create_garage_toy.py -- --render
Game axes: +Y up, -Z nose. Independent static prop; never modifies room/car assets.
Original mesh geometry; recreated third-party character markings from user supplied toy reference.
No commercial license, affiliation or redistribution rights are asserted.
The editable source retains individually named pieces; export batches share a bounded material palette and a packed marking atlas plus opaque authored windshield paint.
"""
import bpy, bmesh, math, json, sys, argparse, hashlib, struct
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from math import sin, cos, pi
import numpy as np
"""Zero unused fixed-size path-string tails in an uncompressed Blender file.
Uses the file's own SDNA layout; does not touch active strings, geometry, or packed bytes.
"""
def clear_blend_path_padding(path):
 import struct,re,math
 from pathlib import Path
 path=Path(path);raw=bytearray(path.read_bytes())
 assert raw[:7]==b'BLENDER' and raw[7:9]==b'-v','Expected 64-bit little-endian uncompressed Blender source'
 blocks=[];off=12
 while off<len(raw):
  code,size,old,sdna,count=struct.unpack_from('<4sIQII',raw,off);blocks.append((code,off+24,size,sdna,count));off+=24+size
  if code==b'ENDB':break
 _,at,size,_,_=next(b for b in blocks if b[0]==b'DNA1');d=raw[at:at+size];assert d[:8]==b'SDNANAME';o=8
 n=struct.unpack_from('<I',d,o)[0];o+=4;names=[]
 for _ in range(n):q=d.index(0,o);names.append(d[o:q].decode());o=q+1
 o=(o+3)//4*4;assert d[o:o+4]==b'TYPE';o+=4;n=struct.unpack_from('<I',d,o)[0];o+=4;types=[]
 for _ in range(n):q=d.index(0,o);types.append(d[o:q].decode());o=q+1
 o=(o+3)//4*4;assert d[o:o+4]==b'TLEN';o+=4;lens=struct.unpack_from('<'+'H'*len(types),d,o);o+=2*len(types);o=(o+3)//4*4;assert d[o:o+4]==b'STRC';o+=4;n=struct.unpack_from('<I',d,o)[0];o+=4;structures=[]
 for _ in range(n):
  ti,nf=struct.unpack_from('<HH',d,o);o+=4;fields=[]
  for __ in range(nf):ft,fn=struct.unpack_from('<HH',d,o);o+=4;fields.append((ft,names[fn]))
  structures.append((ti,fields))
 bytype={ti:fs for ti,fs in structures};layouts={}
 def layout(ti):
  if ti in layouts:return layouts[ti]
  if ti not in bytype:return (min(lens[ti],8) or 1,[])
  offset=0;alignment=1;entries=[]
  for ft,name in bytype[ti]:
   count=math.prod(int(v) for v in re.findall(r'\[(\d+)\]',name));pointer='*'in name
   a=8 if pointer else layout(ft)[0];alignment=max(alignment,a);offset=(offset+a-1)//a*a
   size=(8 if pointer else lens[ft])*count;entries.append((offset,ft,name,count,pointer));offset+=size
  assert (offset+alignment-1)//alignment*alignment==lens[ti],('Unexpected DNA layout',types[ti],offset,lens[ti])
  layouts[ti]=(alignment,entries);return layouts[ti]
 paths={}
 def path_fields(ti):
  if ti in paths:return paths[ti]
  result=[]
  for offset,ft,name,count,pointer in layout(ti)[1]:
   if pointer:continue
   base=name.split('[')[0]
   is_path=(base in {'name','filepath','filename','file','dir','directory','pic','path','renamefile'} or 'path'in base.lower() or 'directory'in base.lower())
   if types[ft]=='char' and count>=256 and is_path:result.append((offset,count,types[ti]+'.'+name))
   elif ft in bytype:
    for i in range(count):
     for sub,size,label in path_fields(ft):result.append((offset+i*lens[ft]+sub,size,types[ti]+'.'+base+'.'+label))
  paths[ti]=result;return result
 changes=[]
 for code,start,size,si,count in blocks:
  if code in {b'DNA1',b'ENDB',b'REND',b'TEST'} or si>=len(structures):continue
  ti=structures[si][0];fields=path_fields(ti)
  if not fields:continue
  assert lens[ti]*count<=size,(code,types[ti],size,count,lens[ti])
  for item in range(count):
   for offset,width,label in fields:
    pos=start+item*lens[ti]+offset;data=raw[pos:pos+width]
    if 0 not in data:continue
    nul=data.index(0)
    if label.endswith('ImagePackedFile.filepath[1024]') and nul:
     active=bytes(data[:nul]).decode('utf8');portable='//'+active.replace('\\','/').rsplit('/',1)[-1]
     if active!=portable:
      encoded=portable.encode();assert len(encoded)<width;data=bytearray(encoded+bytes(width-len(encoded)));raw[pos:pos+width]=data;nul=len(encoded)
      changes.append({'block':code.decode('ascii','replace'),'field':label,'normalized_packed_extraction_path':portable})
    tail=data[nul+1:]
    if any(tail):
     changes.append({'block':code.decode('ascii','replace'),'field':label,'nonzero_tail_bytes':sum(v!=0 for v in tail)})
     raw[pos+nul+1:pos+width]=bytes(width-nul-1)
 if changes:path.write_bytes(raw)
 return changes


ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from sanitize_blend_sources import save_portable
ART=ROOT/'art/garage/toy'; OUT=ROOT/'public/assets/garage/toy-racecar.glb'
ART.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--render',action='store_true');parser.add_argument('--candidate',action='store_true');parser.add_argument('--quick-preview',action='store_true');OPT=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--'in sys.argv else [])
DEST=ROOT/'output/mcqueen-diecast-validation' if OPT.candidate else ART
DEST.mkdir(parents=True,exist_ok=True)
if OPT.candidate:OUT=DEST/'toy-racecar.glb'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials):bpy.data.materials.remove(d)
PARTS=[];M={}
root=bpy.data.objects.new('GARAGE_TOY_MCQUEEN_95',None);bpy.context.collection.objects.link(root)
root['asset_kind']='physical_lightning_mcqueen_toy';root['character_name']='Lightning McQueen';root['character_rights']='Disney/Pixar Cars likeness from user-supplied toy reference; no commercial license asserted';root['axis_contract']='Y up, -Z nose';root['source']='art/garage/toy/toy-racecar.blend';root['not_a_player_vehicle']=True

def V(p):return Vector((p[0],-p[2],p[1]))
def rgb(hex):
 a=[int(hex[i:i+2],16)/255 for i in (1,3,5)];return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in a)
def mat(key,color,rough=.38):
 m=bpy.data.materials.new(key);m.diffuse_color=(*rgb(color),1);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=m.diffuse_color;s.inputs['Roughness'].default_value=rough;s.inputs['Metallic'].default_value=0;s.inputs['Coat Weight'].default_value=.65 if key not in ['Toy tyre rubber','Toy window charcoal'] else 0;s.inputs['Coat Roughness'].default_value=.13;M[key]=m;return m
mat('Toy racing red','#d60918',.17);mat('Toy eye white','#fffefb',.21);mat('Toy eye blue','#1972ad',.23);mat('Toy tyre rubber','#121418',.49);mat('Toy window charcoal','#1c252d',.22);mat('Toy lamp silver','#bfc8ce',.26)
RED='Toy racing red';WHITE='Toy eye white';BLUE='Toy eye blue';RUB='Toy tyre rubber';DARK='Toy window charcoal';SILVER='Toy lamp silver'

def reg(o,name,m):
 o.name=name;o.parent=root;o.data.materials.clear();o.data.materials.append(M[m]);PARTS.append(o);return o
def mesh(name,pts,faces,m,smooth=False,preserve_winding=False):
 d=bpy.data.meshes.new(name);d.from_pydata([V(p) for p in pts],[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);reg(o,name,m)
 bm=bmesh.new();bm.from_mesh(d)
 if not preserve_winding:bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 bm.to_mesh(d);bm.free()
 for p in d.polygons:p.use_smooth=smooth
 return o
def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def bevel(o,width=.008,segments=2):
 activate(o);m=o.modifiers.new('Molded softened edge','BEVEL');m.width=width;m.segments=segments;bpy.ops.object.modifier_apply(modifier=m.name)
 m=o.modifiers.new('Weighted manufactured normals','WEIGHTED_NORMAL');m.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=m.name);return o

def box(name,p,size,m,edge=.008):
 bpy.ops.mesh.primitive_cube_add(size=1,location=V(p));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);reg(o,name,m)
 return bevel(o,edge) if edge else o

def cylinder(name,a,b,r,m,n=40):
 a,b=V(a),V(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();reg(o,name,m)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 return o

def tube(name,pts,r,m,res=2):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=1;cu.bevel_depth=r;cu.bevel_resolution=res;cu.use_fill_caps=True;sp=cu.splines.new('POLY');sp.points.add(len(pts)-1)
 for p,co in zip(sp.points,pts):p.co=(*V(co),1)
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);activate(o);bpy.ops.object.convert(target='MESH');return reg(bpy.context.object,name,m)

def patch(name,pts,m,normal,thickness=.0015):
 # Tiny solid relief: decals remain real geometry with a visible printed edge.
 n=np.array(normal,dtype=float);n/=np.linalg.norm(n);a=np.array(pts);verts=np.concatenate([a,a-n*thickness]);N=len(a);faces=[tuple(range(N)),tuple(range(N,2*N))[::-1]]+[(i,(i+1)%N,(i+1)%N+N,i+N)for i in range(N)]
 return mesh(name,verts.tolist(),faces,m)

def project_surface(pts,obj,axis,side,offset=.002):
    bpy.context.view_layer.update();tree=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get());out=[]
    for p in pts:
        origin=list(p);origin[axis]=side*2;direction=[0,0,0];direction[axis]=-side
        hit,normal,_,_=tree.ray_cast(V(origin),V(direction),4)
        if hit is None:
            hit,normal,_,_=tree.find_nearest(V(p))
            if hit is None:raise RuntimeError('Unable to conform printed detail to '+obj.name)
        g=[hit.x,hit.z,-hit.y];g[axis]+=side*offset;out.append(g)
    return out

def ensure_print_clearance(pts,faces,obj,axis,side,gap=.0012):
    # Curved surfaces are not linear between projected grid vertices. Test actual
    # triangle interiors and edge midpoints, then lift only intersecting vertices.
    bpy.context.view_layer.update();tree=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get());pts=np.array(pts,dtype=float)
    for iteration in range(4):
        delta=np.zeros(len(pts))
        for face in faces:
            q=pts[list(face)];samples=[q.mean(axis=0)]+[(q[i]+q[(i+1)%len(q)])/2 for i in range(len(q))]
            need=0
            for point in samples:
                origin=point.copy();origin[axis]=side*2;direction=[0,0,0];direction[axis]=-side;hit,_,_,_=tree.ray_cast(V(origin),V(direction),4)
                if hit is not None:
                    g=[hit.x,hit.z,-hit.y];need=max(need,side*(g[axis]-point[axis])+gap)
            if need>0:
                for i in face:delta[i]=max(delta[i],need)
        pts[:,axis]+=side*delta
        if delta.max()<1e-6:break
    return pts.tolist()

def surface_patch(name,quad,obj,axis,side,m,offset=.003,steps=5,brow=False):
    a,b,c,d=[np.array(p,dtype=float) for p in quad];raw=[]
    for row in range(steps+1):
        t=row/steps
        for col in range(steps+1):
            u=col/steps;tt=t*(1-.12*(1-abs(2*u-1))**2) if brow else t;raw.append(((1-tt)*((1-u)*a+u*b)+tt*((1-u)*d+u*c)).tolist())
    pts=project_surface(raw,obj,axis,side,offset);faces=[]
    for row in range(steps):
        for col in range(steps):
            k=row*(steps+1)+col;faces.extend([(k,k+1,k+steps+2),(k,k+steps+2,k+steps+1)])
    pts=ensure_print_clearance(pts,faces,obj,axis,side)
    o=mesh(name,pts,faces,m,True)
    expected=V([side if i==axis else 0 for i in range(3)])
    if sum(p.normal.dot(expected) for p in o.data.polygons)<0:
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    activate(o);mod=o.modifiers.new('Conformal printed decal thickness','SOLIDIFY');mod.thickness=.0008;mod.offset=-1;bpy.ops.object.modifier_apply(modifier=mod.name);return o

def ellipse(name,center,right,up,rx,ry,m,n=36):
 c=np.array(center,dtype=float);r=np.array(right,dtype=float);u=np.array(up,dtype=float);normal=np.cross(r,u);normal/=np.linalg.norm(normal);pts=[c+r*rx*cos(i*2*pi/n)+u*ry*sin(i*2*pi/n) for i in range(n)];return patch(name,pts,m,normal)

def text(name,body,center,right,up,size,m,extrude=.0008):
 cu=bpy.data.curves.new(name,'FONT');cu.body=body;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.extrude=extrude;cu.resolution_u=3
 # Blender built-in Bfont is portable; converted geometry avoids font dependencies.
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);r=V(right).normalized();u=V(up).normalized();n=r.cross(u).normalized();o.matrix_world=Matrix(((r.x,u.x,n.x,0),(r.y,u.y,n.y,0),(r.z,u.z,n.z,0),(0,0,0,1)));o.location=V(center);activate(o);bpy.ops.object.convert(target='MESH');return reg(bpy.context.object,name,m)

def loft(name,stations,m,segments=20,subdiv=2,xpower=.58,ypower=.68):
 pts=[]
 for z,w,mid,h in stations:
  for i in range(segments):
   t=i*2*pi/segments;cx=cos(t);sy=sin(t);pts.append((w*math.copysign(abs(cx)**xpower,cx),mid+h*math.copysign(abs(sy)**ypower,sy),z))
 faces=[tuple(range(segments))[::-1]]
 for j in range(len(stations)-1):
  for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
 faces.append(tuple(range((len(stations)-1)*segments,len(stations)*segments)))
 o=mesh(name,pts,faces,m,True);activate(o);mod=o.modifiers.new('Broad toy molded shell','SUBSURF');mod.levels=subdiv;bpy.ops.object.modifier_apply(modifier=mod.name);return o

# Low, wide stock-car body, long bonnet and four real wheel arches.
body=loft('McQueen sculpted U nose and crowned fenders',[(-.666,.012,.167,.018),(-.660,.073,.169,.041),(-.643,.164,.173,.068),(-.610,.244,.177,.086),(-.555,.294,.180,.101),(-.455,.326,.182,.111),(-.290,.328,.185,.112),(-.10,.319,.183,.115),(.20,.326,.181,.113),(.42,.335,.177,.114),(.57,.320,.177,.106),(.635,.329,.174,.098),(.657,.313,.173,.078)],RED,24,2)
# Shape is carried by the shell itself: raised front shoulders above a shallow hood basin.
for vertex in body.data.vertices:
 x,y,z=vertex.co.x,vertex.co.z,-vertex.co.y
 upper=max(0,min(1,(y-.19)/.055));upper=upper*upper*(3-2*upper)
 crown=.040*math.exp(-((abs(x)-.248)/.065)**2)*math.exp(-((z+.390)/.215)**2)
 basin=.013*math.exp(-(x/.175)**4)*math.exp(-((z+.415)/.23)**4)
 rear_crown=.035*math.exp(-((abs(x)-.260)/.075)**2)*math.exp(-((z-.385)/.20)**2)
 vertex.co.z+=(crown+rear_crown-basin)*upper
 vertex.co.x*=1.02
 lower=max(0,min(1,(.155-y)/.07));lower=lower*lower*(3-2*lower)
 vertex.co.z-=.033*lower
body.data.update()
for z in [-.390,.385]:
 cut=cylinder('Temporary arch tooling',(-.6,.123,z),(.6,.123,z),.134,DARK,96);PARTS.remove(cut);activate(body);mod=body.modifiers.new('Real small racing wheel arches','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
bevel(body,.002,2) # Preserve the clean Boolean arch loops; no post-Boolean collapse.
box('Dark recessed toy undertray',(0,.098,0),(.43,.049,1.09),DARK,.013)
# Shallow, integrated canopy. Its base is buried in the red shell, not a separate upright block.
cabin_stations=[]
for z,w,top in [(-.26,.251,.274),(-.225,.258,.301),(-.15,.253,.354),(-.045,.240,.408),(.015,.233,.424),(.205,.233,.424),(.265,.242,.401),(.390,.264,.292),(.445,.265,.269)]:
 cabin_stations.append((z,w,(top+.22)/2,(top-.22)/2))
cabin=loft('Low flat rounded diecast roof and integrated canopy',cabin_stations,RED,24,1,ypower=.34)
# Runtime-stable tampo art is painted on the EXISTING opaque canopy triangles.
# The accepted shell vertices, eyebrow contour and authored ellipse coordinates do not move.
# No white, border, iris, pupil or catchlight overlay meshes remain.
FACE='Toy opaque painted windshield'
face_material=mat(FACE,'#ffffff',.17)
XMIN,XMAX,TMIN,TMAX=-.25,.25,-.005,.165

def windshield_outline(expand=0):
    lower=[];upper=[]
    for i in range(21):
        u=-1+2*i/20
        lo=.012+.006*abs(u)**10-expand
        hi=.143-.018*math.exp(-(u/.22)**2)-.009*abs(u)**10+expand
        lower.append((u*(.218+expand),lo));upper.append((u*(.184+expand),hi))
    return lower+upper[::-1]
paint_shapes=[{'kind':'polygon','points':windshield_outline(.0015),'color':'#1c252d','name':'Exact expanded windshield dark border'},
              {'kind':'polygon','points':windshield_outline(0),'color':'#fffefb','name':'Exact shaped white windshield with central brow notch'}]
for side in [-1,1]:
    cx=side*.062;ct=.069
    for label,x,t,rx,ry,color in [('iris dark rim',cx,ct,.032,.034,'#1c252d'),('blue iris',cx,ct,.0295,.0315,'#1972ad'),('pupil',cx-side*.005,ct,.016,.020,'#1c252d'),('catchlight',cx-.010,ct+.012,.0045,.006,'#fffefb')]:
        paint_shapes.append({'kind':'ellipse','center':[x,t],'radii':[rx,ry],'color':color,'name':label+' '+str(side)})
# Editable authored vectors, not a photo or AI raster. t is the original facepoint up-coordinate.
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="-.25 -.165 .5 .17">','<rect x="-.25" y="-.165" width=".5" height=".17" fill="#d60918"/>']
for shape in paint_shapes:
    if shape['kind']=='polygon':
        points=' '.join(f'{x:.9f},{-t:.9f}' for x,t in shape['points']);svg.append(f'<polygon points="{points}" fill="{shape["color"]}"/>')
    else:
        x,t=shape['center'];rx,ry=shape['radii'];svg.append(f'<ellipse cx="{x:.9f}" cy="{-t:.9f}" rx="{rx:.9f}" ry="{ry:.9f}" fill="{shape["color"]}"/>')
svg.append('</svg>');(DEST/'windshield-paint.svg').write_text('\n'.join(svg)+'\n')
# Deterministic 4x supersampled vector raster using NumPy + standard PNG encoding.
# Both editable and runtime textures are generated from the same exact vector parameters.
def raster_windshield(width,height,path):
    import zlib
    SS=4;w,h=width*SS,height*SS
    xx=XMIN+(np.arange(w)+.5)*(XMAX-XMIN)/w;tt=TMAX-(np.arange(h)+.5)*(TMAX-TMIN)/h
    X,T=np.meshgrid(xx,tt);canvas=np.empty((h,w,3),dtype=np.uint8);canvas[:]=[214,9,24]
    for shape in paint_shapes:
        if shape['kind']=='polygon':
            inside=np.zeros((h,w),dtype=bool);points=shape['points']
            for i,(x0,t0) in enumerate(points):
                x1,t1=points[(i+1)%len(points)]
                if abs(t1-t0)<1e-15:continue
                inside^=((t0>T)!=(t1>T)) & (X<(x1-x0)*(T-t0)/(t1-t0)+x0)
        else:
            x,t=shape['center'];rx,ry=shape['radii'];inside=((X-x)/rx)**2+((T-t)/ry)**2<=1
        color=shape['color'];canvas[inside]=[int(color[i:i+2],16) for i in (1,3,5)]
    pixels=np.rint(canvas.reshape(height,SS,width,SS,3).mean(axis=(1,3))).astype(np.uint8)
    def chunk(kind,payload):return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)
    scan=b''.join(b'\0'+row.tobytes() for row in pixels)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(scan,9))+chunk(b'IEND',b''))
raster_windshield(1024,512,DEST/'windshield-paint.png')
raster_windshield(512,256,DEST/'windshield-paint-runtime.png')
face_image=bpy.data.images.load(str(DEST/'windshield-paint.png'),check_existing=True);face_image.name='Authored opaque windshield paint';face_image.colorspace_settings.name='sRGB';face_image.pack();face_image.filepath='//windshield-paint.png'
face_tex=face_material.node_tree.nodes.new('ShaderNodeTexImage');face_tex.image=face_image;face_tex.extension='EXTEND';face_material.node_tree.links.new(face_tex.outputs['Color'],face_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
# Opaque RGB texture; alpha is deliberately not linked. Outside the face art it is exactly #d60918.
cabin.data.materials.clear();cabin.data.materials.append(face_material)
face_uv=cabin.data.uv_layers.new(name='Opaque windshield receiver UV')
for polygon in cabin.data.polygons:
    points=[cabin.data.vertices[i].co for i in polygon.vertices]
    front=sum(-p.y for p in points)/len(points)<.08
    for li in polygon.loop_indices:
        p=cabin.data.vertices[cabin.data.loops[li].vertex_index].co;t=(p.z-.300)/.614
        face_uv.data[li].uv=((p.x-XMIN)/(XMAX-XMIN),(t-TMIN)/(TMAX-TMIN)) if front else (0,0)
cabin['face_finish']='Single opaque receiver-UV tampo paint; no stacked face-art meshes'
(DEST/'windshield-paint.json').write_text(json.dumps({'schema_version':1,'source_svg':'windshield-paint.svg','source_png':'windshield-paint.png','runtime_png':'windshield-paint-runtime.png','source_dimensions':[1024,512],'runtime_dimensions':[512,256],'opaque':True,'runtime_rgba8_mip_bytes':699052,'coordinate_system':{'x_bounds':[XMIN,XMAX],'t_bounds':[TMIN,TMAX],'game_y':'.300 + .614*t','front_receiver_game_z_mean_limit':.08},'red_background':'#d60918','shapes':paint_shapes,'scope':'Original authored windshield vectors projected onto the unchanged opaque canopy. Disney/Pixar Lightning McQueen character likeness; no reference photo is included.'},indent=2)+'\n')

q=[(-.184,.389,.270),(.184,.389,.270),(.220,.294,.405),(-.220,.294,.405)]
rear_glass=surface_patch('Dark sloping rear window',q,cabin,2,1,DARK,.0007,8)
rear_bars=[]
# The reference has three longitudinal separators down the rear glass, not transverse louvres.
for x in [-.112,0,.112]:
 pts=project_surface([(x,.388-(.388-.297)*i/16,.274+(.402-.274)*i/16) for i in range(17)],cabin,2,1,.0011)
 rear_bars.append(tube('Thin rear glass separator '+str(x),pts,.0030,RED,1))
# One shared rear-only mapping extends the sloping glazing towards the blade.
# Roof/face vertices at game Z <= .245 and the separate side windows do not move.
for rear_part in [cabin,rear_glass]+rear_bars:
 for vertex in rear_part.data.vertices:
  z=-vertex.co.y;t=max(0,min(1,(z-.245)/.145));vertex.co.y-=.105*t*t*(3-2*t)
 rear_part.data.update()
# Project unchanged side-window outlines after rear-canopy reshaping.
# Two blunt, separate glass panels, with the red pillar formed by the canopy between them.
for side in [-1,1]:
 front=[(side*.27,.307,-.156),(side*.24,.393,-.018),(side*.24,.393,.116),(side*.27,.312,.129)]
 rear=[(side*.27,.312,.151),(side*.24,.393,.143),(side*.25,.387,.238),(side*.28,.315,.320)]
 surface_patch('Front dark side window '+str(side),front,cabin,0,side,DARK,.00065,8)
 surface_patch('Rear quarter dark side window '+str(side),rear,cabin,0,side,DARK,.00065,8)
 # Deliberately small neutral reflection, not a large opaque grey sticker.
 q=[(side*.27,.324,-.111),(side*.24,.381,-.009),(side*.24,.379,.005),(side*.27,.325,-.085)]
 surface_patch('Subtle glass edge reflection '+str(side),q,cabin,0,side,SILVER,.0010,4)
# Full-width molded raked blade: dipped middle, rounded raised corners and side returns.
# About 68 degrees from the deck, rather than the previous shallow GT-like ramp.
wing_pts=[];NX=48;NZ=6
for layer in range(2):
 for row in range(NZ+1):
  t=row/NZ
  for col in range(NX+1):
   u=-1+2*col/NX;w=.305+.023*t
   corner=max(0,(abs(u)-.88)/.12)
   top=.411+.020*math.exp(-((abs(u)-.83)/.30)**2)-.022*(1-math.sqrt(max(0,1-corner*corner)))
   bottom=.277-.008*abs(u)**2
   y=bottom+(top-bottom)*t
   z=.594+.035*t+.008*u*u+.003*sin(pi*t)*(1-u*u)+layer*.012
   wing_pts.append((u*w,y,z))
wing_faces=[];K=(NX+1)*(NZ+1)
for row in range(NZ):
 for col in range(NX):
  k=row*(NX+1)+col;wing_faces.extend([(k,k+1,k+NX+2,k+NX+1),(K+k,K+k+NX+1,K+k+NX+2,K+k+1)])
for col in range(NX):
 k=col;wing_faces.append((k,K+k,K+k+1,k+1));k=NZ*(NX+1)+col;wing_faces.append((k,k+1,K+k+1,K+k))
for row in range(NZ):
 k=row*(NX+1);wing_faces.append((k,k+NX+1,K+k+NX+1,K+k));k=row*(NX+1)+NX;wing_faces.append((k,K+k,K+k+NX+1,k+NX+1))
wing=mesh('McQueen raked molded spoiler with dipped crown',wing_pts,wing_faces,RED,True);bevel(wing,.006,3)
for side in [-1,1]:
 stations=[]
 for z,w,top in [(.522,.008,.283),(.558,.014,.297),(.594,.020,.328),(.623,.025,.387),(.640,.024,.422),(.654,.014,.387),(.657,.008,.297)]:
  stations.append((z,w,(top+.22)/2,(top-.22)/2))
 shoulder=loft('Solid rounded rear quarter spoiler return '+str(side),stations,RED,12,1)
 for vertex in shoulder.data.vertices:vertex.co.x+=side*.294
 # The rear face of each return stays within the raked blade's back plane;
 # union its buried base into the widened quarter instead of leaving a capsule pad.
 cp=[(-1,-1,-2),(1,-1,-2),(1,-1,.5534-.21875),(-1,-1,.5534-.21875),(-1,1,-2),(1,1,-2),(1,1,.5534+.21875),(-1,1,.5534+.21875)]
 cf=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
 tooling=mesh('Temporary rear return integration halfspace',cp,cf,DARK);PARTS.remove(tooling)
 activate(shoulder);mod=shoulder.modifiers.new('Return behind continuous blade silhouette','BOOLEAN');mod.operation='INTERSECT';mod.solver='EXACT';mod.object=tooling;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(tooling,do_unlink=True)
 activate(body);mod=body.modifiers.new('Continuous cast rear quarter and spoiler return','BOOLEAN');mod.operation='UNION';mod.solver='EXACT';mod.object=shoulder;bpy.ops.object.modifier_apply(modifier=mod.name);PARTS.remove(shoulder);bpy.data.objects.remove(shoulder,do_unlink=True)
# Compact physical tyres seated under local fenders. Real concave and perforated steel rims.
wheel_meshes=[]
WHEEL_X=.2793807106599;WHEEL_Y=.123;AXLES=[-.390,.385]
def wheel(side,z,label):
 x=side*WHEEL_X;yc=WHEEL_Y
 profile=[(-.030,.091),(-.028,.108),(-.019,.119),(-.014,.120),(.014,.120),(.019,.119),(.028,.108),(.030,.091),(.029,.080),(-.029,.080)]
 N=48;pts=[]
 for axial,radius in profile:
  for i in range(N):
   t=i*2*pi/N;pts.append((x+axial,yc+radius*cos(t),z+radius*sin(t)))
 faces=[]
 for j in range(len(profile)):
  for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,((j+1)%len(profile))*N+(i+1)%N,((j+1)%len(profile))*N+i))
 tyre=mesh('Rounded compact LIGHTYEAR tyre '+label,pts,faces,RUB,True);wheel_meshes.append((side,z,label,tyre))
 outside=x+side*.030
 # A closed thin metal bowl. Ten elliptical through-holes are subtracted, not drawn on it.
 front=[(.086,-.004),(.083,-.002),(.078,-.003),(.071,-.007),(.064,-.010),(.035,-.017),(.020,-.013),(0,-.013)]
 profile2=[(radius,outside+side*depth) for radius,depth in front]+[(radius,outside+side*(depth-.0035)) for radius,depth in reversed(front)]
 N=60;pt=[]
 for radius,axial in profile2:
  for i in range(N):
   t=i*2*pi/N;pt.append((axial,yc+radius*cos(t),z+radius*sin(t)))
 ff=[]
 for j in range(len(profile2)):
  for i in range(N):ff.append((j*N+i,j*N+(i+1)%N,((j+1)%len(profile2))*N+(i+1)%N,((j+1)%len(profile2))*N+i))
 rim=mesh('Concave red steel rim with ten real oval openings '+label,pt,ff,RED,True)
 bm=bmesh.new();bm.from_mesh(rim.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(rim.data);bm.free()
 cp=[];cf=[];N=20
 for j in range(10):
  t=(j+.5)*2*pi/10;rad=np.array([0,cos(t),sin(t)]);tangent=np.array([0,-sin(t),cos(t)]);center=np.array([x,yc,z])+rad*.055
  k=len(cp)
  for axial in [-.045,.045]:
   for i in range(N):
    a=i*2*pi/N;cp.append((center+np.array([axial,0,0])+rad*(.009*cos(a))+tangent*(.0105*sin(a))).tolist())
  cf.extend([tuple(k+i for i in range(N))[::-1],tuple(k+N+i for i in range(N))])
  for i in range(N):cf.append((k+i,k+(i+1)%N,k+N+(i+1)%N,k+N+i))
 cutter=mesh('Temporary true rim hole tooling '+label,cp,cf,DARK);PARTS.remove(cutter)
 activate(rim);mod=rim.modifiers.new('Ten genuine oval ventilation openings','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
 bevel(rim,.00065,2)
 bm=bmesh.new();bm.from_mesh(rim.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-7);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(rim.data);bm.free()
 # Small central steel axle pin, with red bowl visible around it.
 cylinder('Central metal toy axle pin '+label,(outside-side*.014,yc,z),(outside-side*.011,yc,z),.0085,SILVER,24)
for side in [-1,1]:
 for z in AXLES:wheel(side,z,('L'if side<0 else'R')+('F'if z<0 else'R'))
for z in AXLES:cylinder('Recessed actual toy axle '+str(z),(-.296,WHEEL_Y,z),(.296,WHEEL_Y,z),.009,RUB,24)
# Broad, curved McQueen smile follows the rounded bumper instead of floating in front.
def smile_surface(name,halfwidth,top,bottom,m,offset):
 pts=[];faces=[];N=28
 for row in range(3):
  t=row/2
  for i in range(N+1):
   x=-halfwidth+2*halfwidth*i/N;u=x/halfwidth;y=(1-t)*(top[0]+top[1]*u*u)+t*(bottom[0]+bottom[1]*u*u);pts.append((x,y,-.7))
 pts=project_surface(pts,body,2,-1,offset)
 for row in range(2):
  for i in range(N):k=row*(N+1)+i;faces.extend([(k,k+1,k+N+2),(k,k+N+2,k+N+1)])
 o=mesh(name,pts,faces,m,True)
 if sum(p.normal.dot(V((0,0,-1))) for p in o.data.polygons)<0:
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 return o
smile_surface('McQueen compact curved crescent smile outline',.151,(.154,.033),(.130,.055),DARK,.0018)
smile_surface('McQueen small friendly crescent smile',.140,(.151,.032),(.134,.047),WHITE,.0030)
# Curved corner lenses wrap over the fender shoulders, not flat rectangular lamps.
AMBER='Toy lamp amber';mat(AMBER,'#f7bd25',.42)
def lens_surface(name,outline,m,offset,surface=None):
 surface=surface or body
 center=np.array(outline).mean(axis=0);pts=[center.tolist()];N=len(outline);rings=3;faces=[]
 for row in range(1,rings+1):
  t=row/rings
  for p in outline:pts.append((center*(1-t)+np.array(p)*t).tolist())
 for i in range(N):faces.append((0,1+i,1+(i+1)%N))
 for row in range(rings-1):
  a=1+row*N;b=a+N
  for i in range(N):j=(i+1)%N;faces.extend([(a+i,a+j,b+j),(a+i,b+j,b+i)])
 pts=project_surface(pts,surface,2,-1,offset);pts=ensure_print_clearance(pts,faces,surface,2,-1,gap=.0010)
 o=mesh(name,pts,faces,m,True)
 if sum(p.normal.dot(V((0,0,-1))) for p in o.data.polygons)<0:
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 return o
for side in [-1,1]:
 outline=[(side*x,y,-.7) for x,y in [(.187,.232),(.190,.249),(.205,.271),(.225,.278),(.255,.281),(.281,.275),(.292,.264),(.285,.244),(.266,.228),(.228,.222),(.202,.224)]]
 border=lens_surface('Shaped corner lamp dark border '+str(side),outline,DARK,.0020)
 center=np.array(outline).mean(axis=0);inner=[(center+(np.array(p)-center)*.91).tolist() for p in outline]
 silver=lens_surface('Shaped silver corner headlight '+str(side),inner,SILVER,.0015,border)
 amber=[(side*x,y,-.7) for x,y in [(.268,.232),(.283,.247),(.288,.262),(.279,.271),(.270,.270),(.263,.241)]]
 lens_surface('Amber outer corner lens '+str(side),amber,AMBER,.0012,silver)
 q=[(side*.205,.249,.66),(side*.28,.244,.63),(side*.278,.218,.63),(side*.205,.219,.66)]
 surface_patch('Dark red rear light outline '+str(side),q,body,2,1,DARK,.0015,5)
# Packed texture atlas on conformal surface meshes, never on a picture billboard.
# Major marks: Rust-eze hood/wing, roof 95, 95 lightning/flame side graphics and LIGHTYEAR tyres.
atlas=ART/'mcqueen-decals.png'
if not atlas.exists():raise RuntimeError('Expected authored reference-based decal atlas: art/garage/toy/mcqueen-decals.png')
image=bpy.data.images.load(str(atlas),check_existing=True);image.name='McQueen toy recreated decal atlas';image.colorspace_settings.name='sRGB';image.pack();image.filepath='//mcqueen-decals.png'
m=mat('Toy McQueen printed decals','#ffffff',.20);nt=m.node_tree;bs=nt.nodes.get('Principled BSDF');im=nt.nodes.new('ShaderNodeTexImage');im.image=image;nt.links.new(im.outputs['Color'],bs.inputs['Base Color']);nt.links.new(im.outputs['Alpha'],bs.inputs['Alpha']);m.surface_render_method='DITHERED';DECAL=m.name
RECTS={'hood':[32,32,960,600],'roof95':[1088,32,896,600],'side_left':[32,680,1984,400],'side_right':[32,1120,1984,400],'wing':[32,1560,944,240],'sponsors':[1040,1560,416,300],'tire':[1520,1560,496,440]}
# Metadata may tighten a region; the atlas remains a single shared texture/material.
metadata_path=ART/'mcqueen-decals.json'
if metadata_path.exists():
 if OPT.candidate:(DEST/'mcqueen-decals.json').write_bytes(metadata_path.read_bytes())
 data=json.loads(metadata_path.read_text())
 for key,value in data.get('regions',{}).items():
  if key in RECTS and isinstance(value,list):RECTS[key]=value

def atlas_uv(key,u,v):
 x,y,w,h=RECTS[key];return ((x+u*w)/2048,1-(y+(1-v)*h)/2048)
def conformal_decal(name,key,quad,obj,axis,side,nx=0,ny=0,offset=.0003):
 # Reuse clipped receiver triangles, not a coarse ray-projected grid. Every printed
 # triangle lies on the actual receiver plane, including its interior. No solidify.
 a,b,c,d=[np.array(p,dtype=float) for p in quad];du=b-a;dv=d-a;du[axis]=0;dv[axis]=0
 u2=np.dot(du,du);v2=np.dot(dv,dv);pts=[];uv=[];faces=[]
 obj.data.calc_loop_triangles()
 bpy.context.view_layer.update();visibility_tree=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
 def clip(poly,axis2,limit,lower):
  out=[]
  for i,P in enumerate(poly):
   Q=poly[(i+1)%len(poly)];p=P[1][axis2]-limit;q=Q[1][axis2]-limit;pin=p>=-1e-9 if lower else p<=1e-9;qin=q>=-1e-9 if lower else q<=1e-9
   if pin:out.append(P)
   if pin!=qin:
    t=p/(p-q);out.append((P[0]*(1-t)+Q[0]*t,P[1]*(1-t)+Q[1]*t))
  return out
 for tri in obj.data.loop_triangles:
  raw=[]
  for i in tri.vertices:
   v=obj.matrix_world@obj.data.vertices[i].co;raw.append(np.array([v.x,v.z,-v.y]))
  normal=np.cross(raw[1]-raw[0],raw[2]-raw[0]);norm=np.linalg.norm(normal)
  if norm<1e-12 or abs(normal[axis])/norm<.035:continue
  centre=sum(raw)/3
  if axis==0 and centre[0]*side<=0:continue
  origin=centre.copy();origin[axis]=side*2;direction=np.zeros(3);direction[axis]=-side
  visible,_,_,_=visibility_tree.ray_cast(V(origin),V(direction),4)
  if visible is None or (visible-V(centre)).length>2e-5:continue
  if normal[axis]*side<0:raw.reverse()
  poly=[(q,np.array([np.dot(q-a,du)/u2,np.dot(q-a,dv)/v2])) for q in raw]
  for ax,limit,lower in [(0,0,True),(0,1,False),(1,0,True),(1,1,False)]:
   if len(poly)<3:break
   poly=clip(poly,ax,limit,lower)
  if len(poly)<3:continue
  base=len(pts)
  for q,t in poly:
   q=q.copy();q[axis]+=side*offset;pts.append(q.tolist());uv.append(atlas_uv(key,float(t[0]),float(t[1])))
  faces.extend((base,base+i,base+i+1) for i in range(1,len(poly)-1))
 o=mesh(name,pts,faces,DECAL,True,preserve_winding=True)
 o['print_receiver']=obj.name
 o['preserve_receiver_winding']=True
 layer=o.data.uv_layers.new(name='Decal atlas UV')
 for loop in o.data.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
 return o
conformal_decal('Rust-eze large hood oval','hood',[(.228,.4,-.565),(-.228,.4,-.565),(-.228,.4,-.244),(.228,.4,-.244)],body,1,1,14,8)
conformal_decal('McQueen roof race number 95','roof95',[(.168,.5,.012),(-.168,.5,.012),(-.168,.5,.235),(.168,.5,.235)],cabin,1,1,12,8,.0003)
for s in [-1,1]:
 z0,z1=(-.32,.575) if s<0 else (.575,-.32)
 conformal_decal('McQueen side lightning flames 95 '+str(s),'side_left'if s<0 else'side_right',[(s*.4,.095,z0),(s*.4,.095,z1),(s*.4,.325,z1),(s*.4,.325,z0)],body,0,s,32,10)
 # Small sponsor cluster ahead of the number, behind the front wheel.
 z0,z1=(-.295,-.205)if s<0 else(-.205,-.295)
 conformal_decal('McQueen sponsor stickers '+str(s),'sponsors',[(s*.4,.152,z0),(s*.4,.152,z1),(s*.4,.277,z1),(s*.4,.277,z0)],body,0,s,5,9,.00035)
conformal_decal('Rust-eze rear wing script','wing',[(.145,.325,.5),(-.145,.325,.5),(-.145,.390,.5),(.145,.390,.5)],wing,2,-1,16,5,.0003)
# Lettering uses clipped actual sidewall triangles too, with no floating annular board.
for side,z,label,tyre in wheel_meshes:
 z0,z1=(z+.120,z-.120) if side>0 else (z-.120,z+.120)
 quad=[(side*.5,WHEEL_Y-.120,z0),(side*.5,WHEEL_Y-.120,z1),(side*.5,WHEEL_Y+.120,z1),(side*.5,WHEEL_Y+.120,z0)]
 conformal_decal('Flush LIGHTYEAR sidewall print '+label,'tire',quad,tyre,0,side,offset=.00025)

# Deterministic clean triangulation. Remove only genuinely collapsed triangles.
removed=0
for o in PARTS:
 activate(o);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 # Match the reference proportions while retaining the already tested world envelope.
 for v in o.data.vertices:v.co.x*=.985;v.co.y*=.985
 mod=o.modifiers.new('Stable export triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name)
 bm=bmesh.new();bm.from_mesh(o.data);bad=[]
 for f in bm.faces:
  if f.calc_area()<5e-10 or min((e.verts[0].co-e.verts[1].co).length for e in f.edges)<1e-7:bad.append(f)
 removed+=len(bad)
 if bad:bmesh.ops.delete(bm,geom=bad,context='FACES')
 loose=[v for v in bm.verts if not v.link_faces]
 if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
 if not o.get('preserve_receiver_winding',False):bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 bm.to_mesh(o.data);bm.free();o.data.update()
 if o.get('preserve_receiver_winding',False):
  activate(o);mod=o.modifiers.new('Receiver-matched final print normals','DATA_TRANSFER');mod.object=bpy.data.objects[o['print_receiver']];mod.use_loop_data=True;mod.data_types_loops={'CUSTOM_NORMAL'};mod.loop_mapping='POLYINTERP_NEAREST';bpy.ops.object.modifier_apply(modifier=mod.name)

# Editable source includes a native Blender studio; lights/camera/floor never export.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=192;scene.cycles.use_denoising=False;scene.render.threads_mode='FIXED';scene.render.threads=4;scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.world.color=(.12,.12,.12)
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-.6;scene.render.image_settings.file_format='PNG'
scene.unit_settings.system='METRIC';scene.unit_settings.length_unit='METERS'
studio=bpy.data.collections.new('PREVIEW_ONLY_not_exported');scene.collection.children.link(studio)
def studio_move(o):
 for c in list(o.users_collection):c.objects.unlink(o)
 studio.objects.link(o)
# Native matte platform outside runtime PARTS list.
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,.0028));floor=bpy.context.object;floor.name='Preview only neutral floor';studio_move(floor);fm=bpy.data.materials.new('Preview studio floor');fm.diffuse_color=(.70,.70,.70,1);fm.use_nodes=True;fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=fm.diffuse_color;fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.75;floor.data.materials.append(fm)
for name,pos,power,size,col in [('Neutral key strip',(-1.7,2.5,-1.8),180,2.0,(1,1,1)),('Neutral side strip',(1.6,1.6,-.3),110,1.5,(1,1,1)),('Neutral rear strip',(-.2,2.0,2.0),160,1.8,(1,1,1))]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='RECTANGLE';d.size=size;d.size_y=.38;d.color=col;o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=V(pos);o.rotation_euler=(V((0,.25,0))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('Toy native preview camera');cam=bpy.data.objects.new('Toy native preview camera',d);studio.objects.link(cam);cam.location=V((-1.65,2.25,-2.05));cam.rotation_euler=(V((0,.21,0))-cam.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=1.72;scene.camera=cam
scene.render.filepath='//preview-front-three-quarter.png'
# Embedded text documentation is useful after moving just the packed .blend.
readme=bpy.data.texts.new('README - McQueen reference toy');readme.write('Lightning McQueen physical toy likeness from the user-supplied red die-cast toy reference. Original Blender mesh construction; third-party character identity and recreated markings are not original fictional project art. No commercial license or endorsement is asserted. Metres; game +Y up/-Z nose. Named editable parts, two packed authored images including opaque windshield paint, separate studio excluded from GLB. Rebuild with scripts/create_garage_toy.py.\n')
source=DEST/'toy-racecar.blend';save_portable(source);clear_blend_path_padding(source)
# Keep the editable packed atlas at 2048, but embed a 1024 runtime atlas in the GLB.
runtime_image=image.copy();runtime_image.name='McQueen runtime decal atlas 1024';runtime_image.scale(1024,1024);runtime_image.filepath_raw=str(DEST/'mcqueen-decals-runtime.png');runtime_image.file_format='PNG';runtime_image.save();runtime_image.pack();runtime_image.filepath='//mcqueen-decals-runtime.png';im.image=runtime_image
face_runtime_image=bpy.data.images.load(str(DEST/'windshield-paint-runtime.png'),check_existing=True);face_runtime_image.name='Opaque windshield runtime paint 512x256';face_runtime_image.colorspace_settings.name='sRGB';face_runtime_image.pack();face_runtime_image.filepath='//windshield-paint-runtime.png';face_tex.image=face_runtime_image
# Join only temporary export duplicates; editable source never loses its semantic objects.
exports=[]
for key,m in M.items():
 group=[]
 for original in PARTS:
  if original.data.materials[0]!=m:continue
  o=original.copy();o.data=original.data.copy();bpy.context.collection.objects.link(o);group.append(o)
 if not group:continue
 bpy.ops.object.select_all(action='DESELECT')
 for o in group:o.select_set(True)
 bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();o=bpy.context.object;o.name='MCQUEEN95_'+key.replace(' ','_');exports.append(o)
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for o in exports:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',use_selection=True,export_yup=True,export_cameras=False,export_lights=False,export_extras=True,export_apply=True,export_texcoords=True,export_normals=True,export_materials='EXPORT')
# Audit the actual emitted buffer, rather than reporting pre-export Blender estimates.
raw=OUT.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);blob=raw[28+n:];verts=[];tris=0;bad=0;normalbad=0;primitive_count=0
for me in j['meshes']:
 for p in me['primitives']:
  primitive_count+=1
  def acc(i):
   a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dt={5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];w={'SCALAR':1,'VEC3':3}[a['type']];return np.ndarray((a['count'],w),dtype=dt,buffer=blob,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',w*np.dtype(dt).itemsize),np.dtype(dt).itemsize)).copy()
  a=acc(p['attributes']['POSITION']);normal=acc(p['attributes']['NORMAL']);ind=acc(p['indices']).reshape(-1,3);t=a[ind];tris+=len(t);cross=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);bad+=int((np.linalg.norm(cross,axis=1)<1e-10).sum());normalbad+=int((~np.isfinite(normal).all(1)|(np.abs(np.linalg.norm(normal,axis=1)-1)>.001)).sum())
# Bounds account for node transforms by importing exported asset into a throwaway scene later in tests.
for o in exports:
 for ve in o.data.vertices:
  p=o.matrix_world@ve.co;verts.append((p.x,p.z,-p.y))
a=np.asarray(verts);bounds={'min':a.min(0).round(6).tolist(),'max':a.max(0).round(6).tolist()}
report={'name':'Lightning McQueen toy (95)','source':str(source.relative_to(ROOT)),'glb':str(OUT.relative_to(ROOT)),'generator':str(Path(__file__).resolve().relative_to(ROOT)),'root':root.name,'axis_contract':{'up':'+Y','front':'-Z','units':'metres'},'bounds_m':bounds,'size_m':(a.max(0)-a.min(0)).round(6).tolist(),'editable_parts':len(PARTS),'materials':len(j['materials']),'draw_batches':primitive_count,'triangles':tris,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'generator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'collapsed_export_triangles':bad,'bad_export_normals':normalbad,'collapsed_source_faces_removed':removed,'textures':len(j.get('images',[])),'runtime_texture_dimensions':[1024,1024],'runtime_texture_rgba8_mip_bytes':6291456,'additional_runtime_textures':[{'name':'opaque windshield paint','dimensions':[512,256],'rgba8_mip_bytes':699052}],'additional_editable_textures':[{'name':'opaque windshield paint','dimensions':[1024,512],'source':'windshield-paint.svg'}],'editable_texture_dimensions':[2048,2048],'decal_source_sha256':hashlib.sha256(atlas.read_bytes()).hexdigest(),'runtime_lights':0,'runtime_cameras':0,'source_external_resources':0,'recommended_placement':{'position':[-2.95,-.007,4.8],'rotation_y':.2},'provenance':'Original Blender mesh construction recreating the user-supplied Lightning McQueen toy. Disney/Pixar Cars character identity and reproduced Rust-eze/95/Lightning graphics are third-party subject matter; no commercial license or endorsement is asserted. One packed marking atlas plus opaque authored windshield vector paint; no reference photograph billboard.'}
report.update({'budget':{'max_triangles':42000,'max_glb_bytes':2000000,'max_material_batches':8,'max_runtime_textures':2,'max_runtime_texture_rgba8_mip_bytes':6291456},'paint':{'base_color_srgb':'#d60918','metalness':0,'roughness':.17,'clearcoat':.65,'clearcoat_roughness':.13,'no_noise_or_bump_texture':True},'source_portability_cleanup':'Unused fixed-size path-string tails zeroed via SDNA; both packed image extraction paths use basename-relative // paths.','windshield_paint':'Exact authored outline/brow/iris/pupil/catchlight vectors painted directly onto unchanged opaque canopy receiver. No separate layered face-art meshes.'})
(DEST/'asset-report.json').write_text(json.dumps(report,indent=2)+'\n');print('TOY_REPORT '+json.dumps(report))
assert 8000<=tris<=42000,('Triangle budget',tris)
assert len(raw)<=2000000,('GLB byte budget',len(raw))
assert bad==0 and normalbad==0
assert primitive_count<=8 and len(j['materials'])<=8

im.image=image;face_tex.image=face_image
if OPT.render:
 if OPT.quick_preview:scene.cycles.samples=128;scene.render.resolution_percentage=75
 for o in exports:o.hide_render=True
 scene.render.filepath=str(DEST/'preview-front-three-quarter.png');bpy.ops.render.render(write_still=True)
 if OPT.quick_preview:sys.exit(0)
 cam.location=V((1.7,.95,2.05));cam.rotation_euler=(V((0,.21,0))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(DEST/'preview-rear-three-quarter.png');bpy.ops.render.render(write_still=True)
 cam.location=V((-1.65,2.25,-2.05));cam.rotation_euler=(V((0,.21,0))-cam.location).to_track_quat('-Z','Y').to_euler()
