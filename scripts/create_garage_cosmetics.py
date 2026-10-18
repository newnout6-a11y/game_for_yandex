"""Original Roadster Rocket attachments. Run Blender background with -- --render.
Only cosmetic outputs are written; accepted Roadster is read-only fitting reference.
Game/source axes +Y up, -Z front, metres BEFORE Roadster root scale.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'art/garage-cosmetics'; OUT=ROOT/'public/assets/garage-cosmetics'
sys.path.insert(0,str(ROOT/'scripts'))
from sanitize_blend_sources import save_portable
for path in (ART,OUT,ART/'previews'):path.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser();p.add_argument('--render',action='store_true');p.add_argument('--render-only',action='store_true');p.add_argument('--new-only',action='store_true',help='Preserve the accepted splitter and turbine files byte for byte');p.add_argument('--samples',type=int,default=24);p.add_argument('--view',choices=['all','exterior','wheel','body','cockpit','louver','copper','new'],default='all')
OPT=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
CAR_PATH=ROOT/'public/assets/roadster.glb'; SOURCE_SHA=hashlib.sha256(CAR_PATH.read_bytes()).hexdigest(); M={}; PARTS=[]; DECK=None

def v(p):return Vector((p[0],-p[2],p[1]))
def reset():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);PARTS.clear()
    # Editable attachment files must not embed orphaned copies of the fitting car.
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    for material in list(bpy.data.materials):
        if material.users == 0:bpy.data.materials.remove(material)
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.preferences.filepaths.save_version=0

def material(name,color,metal,rough):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough;m.use_backface_culling=True
    return m

def materials():
    M.clear();M['graphite']=material('Roadster_Cosmetic_Graphite_Ceramic',(.038,.048,.052),.62,.36)
    M['copper']=material('Roadster_Cosmetic_Copper_Anodized',(.48,.185,.070),.78,.29)
    M['fastener']=material('Roadster_Cosmetic_Fastener_Black',(.012,.018,.021),.72,.32)

def empty(name):
    ob=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(ob);return ob

def mesh(name,points,faces,mat,parent,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata([v(p) for p in points],[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free();data.update()
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.parent=parent;data.materials.append(M[mat])
    for face in data.polygons:face.use_smooth=smooth
    ob['cosmetic_part']=True;ob['original_geometry']=True;PARTS.append(ob);return ob

def sweep(name,points,radius,mat,parent,sides=6):
    vs=[]
    for i,point in enumerate(points):
        direction=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])).normalized()
        helper=Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0))
        a=direction.cross(helper).normalized();b=direction.cross(a).normalized()
        vs.extend(tuple(Vector(point)+radius*(a*math.cos(k*math.tau/sides)+b*math.sin(k*math.tau/sides))) for k in range(sides))
    fs=[tuple(reversed(range(sides))),tuple((len(points)-1)*sides+k for k in range(sides))]
    fs += [(i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k) for i in range(len(points)-1) for k in range(sides)]
    return mesh(name,vs,fs,mat,parent,True)

def ring(name,profile,mat,parent,side=1,segments=64):
    vs=[(side*x,r*math.cos(k*math.tau/segments),r*math.sin(k*math.tau/segments)) for x,r in profile for k in range(segments)]
    fs=[(j*segments+k,j*segments+(k+1)%segments,((j+1)%len(profile))*segments+(k+1)%segments,((j+1)%len(profile))*segments+k) for j in range(len(profile)) for k in range(segments)]
    return mesh(name,vs,fs,mat,parent,True)

def body_splitter():
    root=empty('cosmetic_body_splitter');root['slot']='body.addon';root['cosmetic_id']='body_splitter'
    root['attachment_parent']='player_sprung_body';root['attachment_frame']='Roadster unscaled local; identity transform'
    rows=[]
    for i in range(41):
        q=-1+i/20;x=.897*q;f=-2.337+.066*q*q
        rows.append([(x,.218+.006*q*q,f),(x*1.008,.227+.006*q*q,f+.023),(x*.995,.235,f+.083),
            (x*.995,.211,f+.079),(x*1.006,.201+.006*q*q,f+.021),(x,.202+.006*q*q,f)])
    vs=[p for row in rows for p in row];n=6
    fs=[tuple(reversed(range(n))),tuple((len(rows)-1)*n+k for k in range(n))]
    fs += [(i*n+k,(i+1)*n+k,(i+1)*n+(k+1)%n,i*n+(k+1)%n) for i in range(len(rows)-1) for k in range(n)]
    mesh('Formed graphite nose lower lip',vs,fs,'graphite',root)
    for a,b in [(-.90,-.13),(.13,.90)]:
        pts=[]
        for i in range(22):
            q=a+(b-a)*i/21;pts.append((.897*q,.219+.006*q*q,-2.339+.066*q*q))
        sweep('Copper nose datum inlay',pts,.0022,'copper',root,5)
    for q in [-.78,-.47,-.17,.17,.47,.78]:
        x=.897*q;z=-2.337+.066*q*q+.047;sides=6
        pts=[(x+.006*math.cos(k*math.tau/sides),y,z+.006*math.sin(k*math.tau/sides)) for y in [.237,.240] for k in range(sides)]
        fs=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]+[(k,(k+1)%sides,(k+1)%sides+sides,k+sides) for k in range(sides)]
        mesh('Captive M6 lip fastener',pts,fs,'fastener',root)
    return root

def wheel_turbine(side):
    label='left' if side<0 else 'right';root=empty('cosmetic_wheel_turbine_'+label)
    root['slot']='wheels.geometry';root['cosmetic_id']='wheel_turbine'
    root['attachment_parent']='wheel_spin_fl/rl' if side<0 else 'wheel_spin_fr/rr'
    root['attachment_frame']='Existing spinner local; identity transform; X axle'
    root['maximum_radius_source_m']=.282;root['retains_original_tyre']=True
    ring('Ventilated turbine outer return',[(.160,.266),(.164,.266),(.164,.280),(.161,.282),(.157,.280),(.157,.269)],'graphite',root,side)
    ring('Turbine centre fastening ring',[(.180,.065),(.184,.065),(.184,.080),(.180,.082)],'graphite',root,side,48)
    for k in range(10):
        start=k*math.tau/10;stations=[(.078,0,.36),(.136,.075,.36),(.210,.172,.34),(.271,.23,.31)];pts=[]
        for depth in [0,.004]:
            for r,turn,width in stations:
                x=.181-(r-.078)*.086+depth
                for ang in [start+turn,start+turn+width]:pts.append((side*x,r*math.cos(ang),r*math.sin(ang)))
        n=8;fs=[]
        for j in range(3):
            a=j*2;fs.extend([(a,a+2,a+3,a+1),(n+a+1,n+a+3,n+a+2,n+a)])
        border=[0,2,4,6,7,5,3,1];fs += [(a,b,n+b,n+a) for a,b in zip(border,border[1:]+border[:1])]
        mesh('Swept ventilated vane %02d'%(k+1),pts,fs,'graphite',root)
        if k in (0,3,6):
            pts=[]
            for i in range(9):
                r=.208+.055*i/8;ang=start+.17+.06*i/8+.014;x=.181-(r-.078)*.086+.0052
                pts.append((side*x,r*math.cos(ang),r*math.sin(ang)))
            sweep('Copper turbine witness %02d'%k,pts,.00165,'copper',root,5)
    for k in range(5):
        a=k*math.tau/5;p=(side*.185,.073*math.cos(a),.073*math.sin(a))
        sweep('Turbine centre retaining stud',[(p[0]-side*.001,p[1],p[2]),p],.0026,'copper',root,6)
    return root

def reference_deck():
    """Fit to the accepted triangles, never an approximate proxy vehicle."""
    reset();obs=import_glb(CAR_PATH);root=next(o for o in obs if o.name=='Roadster')
    body=next(o for o in obs if o.name=='body');bpy.context.view_layer.update()
    transform=root.matrix_world.inverted()@body.matrix_world
    return BVHTree.FromPolygons([transform@vert.co for vert in body.data.vertices],
        [tuple(face.vertices) for face in body.data.polygons])

def deck_y(x,z):
    hit,normal,index,distance=DECK.ray_cast(v((x,2,z)),Vector((0,0,-1)),2)
    assert hit is not None and .80<hit.z<.90,'Louver must fit an existing rear deck surface'
    return hit.z

def deck_strip(name,x0,x1,z0,z1,front_height,rear_height,mat,parent):
    """A curved, closed 2.5mm sheet above the untouched deck, with real open gaps."""
    rows=[]
    for i in range(17):
        x=x0+(x1-x0)*i/16;a=deck_y(x,z0);b=deck_y(x,z1)
        rows.append([(x,a+front_height,z0),(x,b+rear_height,z1),
            (x,b+rear_height-.0025,z1),(x,a+front_height-.0025,z0)])
    pts=[point for row in rows for point in row];n=4
    faces=[tuple(reversed(range(n))),tuple((len(rows)-1)*n+k for k in range(n))]
    faces += [(i*n+k,(i+1)*n+k,(i+1)*n+(k+1)%n,i*n+(k+1)%n) for i in range(len(rows)-1) for k in range(n)]
    return mesh(name,pts,faces,mat,parent)

def body_louver():
    root=empty('cosmetic_body_louver');root['slot']='body.addon';root['cosmetic_id']='body_louver'
    root['capability']='body.louver';root['attachment_parent']='player_sprung_body'
    root['attachment_frame']='Roadster unscaled local; identity transform'
    root['function']='Decorative vented deck applique; original closed deck and flight packaging remain intact'
    # A broad low-profile applique fits entirely between the rear glazing and wing pocket.
    for i in range(6):
        z=1.517+i*.033
        deck_strip('Raised rear-deck louver %02d'%(i+1),-.546,.546,z,z+.021,.009,.024,'graphite',root)
    for z in [1.493,1.719]:deck_strip('Deck louver end rail',-.563,.563,z,z+.012,.007,.007,'graphite',root)
    for side in [-1,1]:
        x0,x1=sorted([side*.549,side*.563])
        deck_strip('Deck louver side mounting rail',x0,x1,1.493,1.731,.007,.007,'graphite',root)
        pts=[(side*.557,deck_y(side*.557,1.525+i*.016)+.009,1.525+i*.016) for i in range(11)]
        sweep('Copper deck louver edge inlay',pts,.0015,'copper',root,5)
    return root

def rim_copper(side):
    label='left' if side<0 else 'right';root=empty('cosmetic_rim_copper_'+label)
    root['slot']='wheels.finish';root['cosmetic_id']='rim_copper';root['capability']='rims.copperAccent'
    root['attachment_parent']='wheel_spin_fl/rl' if side<0 else 'wheel_spin_fr/rr'
    root['attachment_frame']='Existing spinner local; identity transform; X axle'
    root['maximum_radius_source_m']=.2922;root['minimum_radius_source_m']=.2846
    root['retains_original_tyre']=True;root['compatible_wheel_geometry']=['stock','wheel_turbine']
    # A 7.6mm radial accent. Neither rubber nor broad spoke material is recolored.
    ring('Copper removable outer rim accent',[(.1586,.2856),(.161,.2846),(.164,.2858),
        (.165,.2906),(.162,.2922),(.1586,.2912)],'copper',root,side,72)
    return root

def export_part(root,stem):
    root['cars']=['rocket'];root['source_roadster_sha256']=SOURCE_SHA
    root['coordinate_convention']='+Y up, -Z front; unscaled Roadster local metres'
    root['gameplay_effect']='none; no tyre, contact, collision or flight changes'
    root['provenance']='Original procedural Blender artwork; no third-party assets'
    bpy.context.scene['source_script']='scripts/create_garage_cosmetics.py'
    save_portable(ART/(stem+'.blend'));authored_parts=len(PARTS);batches=[]
    groups=[(mat,[o for o in PARTS if o.data.materials[0]==mat]) for mat in M.values()]
    for mat,group in groups:
        if not group:continue
        bpy.ops.object.select_all(action='DESELECT')
        for ob in group:ob.select_set(True)
        bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();ob=bpy.context.object
        ob.name=stem.replace('-','_')+'_'+mat.name;batches.append(ob)
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    for ob in batches:ob.select_set(True)
    path=OUT/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_normals=True,
        export_apply=True,export_cameras=False,export_lights=False,export_materials='EXPORT')
    bpy.context.view_layer.update();pts=[ob.matrix_world@vert.co for ob in batches for vert in ob.data.vertices];game=[(p.x,p.z,-p.y) for p in pts]
    result={'asset':stem+'.glb','root':root.name,'editableParts':authored_parts,'drawBatches':len(batches),
        'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in batches),'bytes':path.stat().st_size,
        'boundsSourceM':{'min':[min(p[i] for p in game) for i in range(3)],'max':[max(p[i] for p in game) for i in range(3)]},
        'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    print('COSMETIC_ASSET '+json.dumps(result),flush=True);return result

def import_glb(path):
    previous=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(path));return [o for o in bpy.data.objects if o not in previous]

def stage():
    reset();car_objects=import_glb(CAR_PATH);car=next(o for o in car_objects if o.name=='Roadster')
    for ob in car_objects:
        if 'aeroRole' in ob:
            ob.location+=v(ob.get('aeroStowPositionOffset',[0,0,0]));ob.rotation_mode='QUATERNION'
            ob.rotation_quaternion=ob.rotation_quaternion@Quaternion(v(ob.get('aeroStowAxis',[1,0,0])),ob.get('aeroStowAngle',0))
    for stem in ['body-splitter','body-louver','wheel-turbine-left','wheel-turbine-right','rim-copper-left','rim-copper-right']:
        obs=import_glb(OUT/(stem+'.glb'));root=next(o for o in obs if o.parent is None)
        if stem.startswith('body-'):root.parent=car
        else:
            label='l' if 'left' in stem else 'r';root.parent=bpy.data.objects['wheel_spin_f'+label]
            copy=root.copy();bpy.context.collection.objects.link(copy);copy.parent=bpy.data.objects['wheel_spin_r'+label]
            for child in list(root.children):
                new=child.copy();bpy.context.collection.objects.link(new);new.parent=copy
    for ob in car_objects:
        if ob.type=='MESH':
            for slot in ob.material_slots:
                if slot.material and slot.material.name=='RC_Ivory_Double_Stitch':
                    slot.material=slot.material.copy();slot.material.name='Roadster_Preview_Copper_Upholstery_Stitch'
                    rgb=[value/12.92 if value<=.04045 else ((value+.055)/1.055)**2.4 for value in [199/255,118/255,67/255]]
                    slot.material.diffuse_color=(*rgb,1)
                    slot.material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*rgb,1)
    floor_mat=material('Preview warm workshop floor',(.16,.17,.16),0,.82)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.013));bpy.context.object.data.materials.append(floor_mat)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=OPT.samples;scene.cycles.use_denoising=False
    scene.render.resolution_x=1440;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
    scene.world.color=(.16,.16,.16);scene.view_settings.view_transform='AgX'
    for name,pos,power,color,size in [('Warm high window',(-3,5,-4),1700,(1,.86,.69),5),('Cool fill',(4,3,-1),1400,(.75,.86,1),4),('Rear edge',(1,4,4),1600,(1,.95,.85),3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
        ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.location=v(pos)
        ob.rotation_euler=(v((0,.5,0))-ob.location).to_track_quat('-Z','Y').to_euler()
    return car_objects

def render_view(name,pos,target,lens=55):
    scene=bpy.context.scene;data=bpy.data.cameras.new(name);cam=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(cam)
    cam.location=v(pos);cam.rotation_euler=(v(target)-cam.location).to_track_quat('-Z','Y').to_euler();data.lens=lens;data.clip_start=.025
    scene.camera=cam;scene.render.filepath=str(ART/'previews'/(name+'.png'));bpy.ops.render.render(write_still=True);bpy.data.objects.remove(cam,do_unlink=True)

def previews():
    car_objects=stage()
    if OPT.view in ('all','exterior'):render_view('rocket-cosmetics-front',(-5.0,2.15,-6.5),(0,.53,-.22),60)
    if OPT.view in ('all','wheel'):render_view('turbine-fitted-detail',(-2.7,.89,-2.23),(-.93,.40,-1.46),70)
    if OPT.view in ('all','body'):render_view('splitter-fitted-detail',(0,.70,-4.4),(0,.23,-2.17),55)
    if OPT.view in ('all','louver','new'):
        render_view('louver-fitted-detail',(-1.65,2.25,2.72),(0,.86,1.62),67)
        render_view('rocket-cosmetics-rear',(-4.7,2.6,5.4),(0,.60,.45),58)
    if OPT.view in ('all','copper','new'):
        render_view('copper-turbine-fitted-detail',(-2.7,.89,-2.23),(-.93,.40,-1.46),70)
        for ob in bpy.data.objects:
            if ob.type=='MESH' and ob.name.startswith('wheel_turbine'):ob.hide_render=True
        render_view('copper-stock-fitted-detail',(-2.7,.89,-2.23),(-.93,.40,-1.46),70)
        for ob in bpy.data.objects:
            if ob.type=='MESH' and ob.name.startswith('wheel_turbine'):ob.hide_render=False
    hidden=[]
    for ob in car_objects:
        if ob.type=='MESH' and any(s.material and s.material.name in ('glass','RC_Charcoal_Roof_Alcantara') for s in ob.material_slots):ob.hide_render=True;hidden.append(ob)
    if OPT.view in ('all','cockpit'):render_view('stitch-copper-cutaway',(-.40,1.55,-.40),(-.43,.65,.28),50)
    for ob in hidden:ob.hide_render=False

if not OPT.render_only:
    DECK=reference_deck();report=[]
    old=json.loads((OUT/'manifest.json').read_text()) if OPT.new_only else None
    if old:assert old['sourceRoadsterSha256']==SOURCE_SHA,'Preserved cosmetics require the same accepted Roadster'
    builders=[('body-splitter',body_splitter),('wheel-turbine-left',lambda:wheel_turbine(-1)),('wheel-turbine-right',lambda:wheel_turbine(1)),
        ('body-louver',body_louver),('rim-copper-left',lambda:rim_copper(-1)),('rim-copper-right',lambda:rim_copper(1))]
    for stem,builder in builders:
        if old and stem in ['body-splitter','wheel-turbine-left','wheel-turbine-right']:
            record=next(record for record in old['assets'] if record['asset']==stem+'.glb')
            assert record['sha256']==hashlib.sha256((OUT/record['asset']).read_bytes()).hexdigest()
            report.append(record);continue
        reset();materials();report.append(export_part(builder(),stem))
    manifest={'schemaVersion':1,'brand':'Roadster','cars':['rocket'],'sourceRoadsterSha256':SOURCE_SHA,'sourceRoadsterScale':0.9866073727607727,
        'coordinateConvention':'Source Roadster local, +Y up, -Z front, X wheel axle; no runtime rescale',
        'body':{'id':'body_splitter','slot':'body.addon','asset':'body-splitter.glb','root':'cosmetic_body_splitter','parent':'player_sprung_body','transform':{'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]}},
        'wheels':{'id':'wheel_turbine','slot':'wheels.geometry','left':'wheel-turbine-left.glb','right':'wheel-turbine-right.glb','parents':['wheel_spin_fl','wheel_spin_fr','wheel_spin_rl','wheel_spin_rr'],
        'transform':{'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},'preserveExistingWheels':True,'coverMaximumRadiusSourceM':.282,'acceptedTyreRadiusSourceM':.3830000078417506},
        'cockpit':{'id':'cockpit_stitch','slot':'cockpit.trim','mode':'existing_authored_material_tint','material':'RC_Ivory_Double_Stitch','mesh':'detail_rc_stitch','colorSrgb':'#c77643','requiresNewGeometry':False},
        'bodyLouver':{'id':'body_louver','capability':'body.louver','slot':'body.addon','asset':'body-louver.glb','root':'cosmetic_body_louver','parent':'player_sprung_body',
            'transform':{'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},'preserveExistingDeck':True},
        'rims':{'id':'rim_copper','capability':'rims.copperAccent','slot':'wheels.finish','left':'rim-copper-left.glb','right':'rim-copper-right.glb',
            'parents':['wheel_spin_fl','wheel_spin_fr','wheel_spin_rl','wheel_spin_rr'],
            'transform':{'position':[0,0,0],'rotation':[0,0,0],'scale':[1,1,1]},'preserveExistingWheels':True,
            'minimumRadiusSourceM':.2846,'maximumRadiusSourceM':.2922,'compatibleWheelGeometry':['stock','wheel_turbine']},
        'capabilities':['body.splitter','body.louver','wheels.turbine','rims.copperAccent','cockpit.stitch'],
        'unsupported':[],'assets':report,
        'provenance':'Original Blender-authored cosmetic geometry, no purchased/downloaded assets. Accepted Roadster only imported for read-only fitting/previews; its rights status is unchanged.'}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(ART/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
if OPT.render or OPT.render_only:previews()
assert hashlib.sha256(CAR_PATH.read_bytes()).hexdigest()==SOURCE_SHA,'Accepted Roadster must remain untouched'
