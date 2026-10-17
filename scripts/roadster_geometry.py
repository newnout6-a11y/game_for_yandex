"""Reference-driven angular Roadster exterior, authored as editable closed parts.

All input dimensions are art-direction proportions in metres, not factory CAD.
Game coordinates are X across, Y up and -Z forward. Runtime batches are produced
by the calling script only after the editable source scene has been saved.
"""
import math
from math import sin, cos, pi, sqrt
import bpy, bmesh
from mathutils import Vector, Quaternion


def build_exterior(api):
    """Build the exterior and return measured wheel/profile design metadata."""
    mesh, box, tube, beam = (api[k] for k in ('mesh','box','tube','beam'))
    cylinder_x, v, M = (api[k] for k in ('cylinder_x','v','M'))
    objects=api['objects']
    W=[(-2.35,.700),(-2.25,.805),(-2.02,.935),(-1.47,1.063),(-.86,.975),(-.20,.958),(.55,.968),(1.47,1.063),(1.95,1.006),(2.35,.937)]
    H=[(-2.35,.571),(-2.17,.666),(-1.94,.768),(-1.47,.866),(-.85,.851),(-.15,.846),(.56,.855),(1.47,.901),(1.95,.858),(2.35,.802)]
    HC=[(-2.35,.566),(-2.13,.675),(-1.72,.774),(-1.20,.846),(-.85,.846),(1.15,.873),(1.60,.849),(2.10,.820),(2.35,.802)]
    axles=[-1.47,1.47]; wheel_y=.390; radius=.383; arch=.425

    def interp(t, entries):
        """Monotone cubic Hermite interpolation, avoiding station overshoot."""
        if t<=entries[0][0]:return entries[0][1]
        if t>=entries[-1][0]:return entries[-1][1]
        slopes=[(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(entries,entries[1:])]
        tang=[slopes[0]]
        for a,b in zip(slopes,slopes[1:]):tang.append(0 if a*b<=0 else 2*a*b/(a+b))
        tang.append(slopes[-1])
        for i,(a,b) in enumerate(zip(entries,entries[1:])):
            if a[0]<=t<=b[0]:
                d=b[0]-a[0];u=(t-a[0])/d
                return (2*u**3-3*u*u+1)*a[1]+(u**3-2*u*u+u)*d*tang[i]+(-2*u**3+3*u*u)*b[1]+(u**3-u*u)*d*tang[i+1]

    def apply_modifier(ob,mod):
        """Bake one Blender modifier while retaining an individually editable mesh."""
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
        bpy.ops.object.modifier_apply(modifier=mod.name);ob.select_set(False)

    def surface(name,rows,mat='body',thickness=.012,outward=(0,1,0),smooth=True,normal_fn=None):
        """Close an ordered quad surface with an inward solidify shell."""
        ni=len(rows);nj=len(rows[0]);verts=[p for row in rows for p in row]
        faces=[(i*nj+j,i*nj+j+1,(i+1)*nj+j+1,(i+1)*nj+j) for i in range(ni-1) for j in range(nj-1)]
        # Choose orientation from the whole patch: a collapsed tip or a tiny
        # first strip must not invert Solidify and grow a whole hood outward.
        area_normal=Vector((0,0,0))
        for face in faces:
            a,b,c=(Vector(verts[k]) for k in face[:3])
            area_normal+=(b-a).cross(c-a)
        if area_normal.dot(Vector(outward))<0:faces=[tuple(reversed(f)) for f in faces]
        ob=mesh(name,verts,faces,mat,smooth=smooth)
        if thickness:
            mod=ob.modifiers.new('Manufactured wall thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1
            mod.use_even_offset=False;apply_modifier(ob,mod)
        if normal_fn:
            normals=[]
            for poly in ob.data.polygons:
                center=poly.center;target=v(normal_fn((center.x,center.z,-center.y))).normalized();dot=poly.normal.dot(target)
                for vi in poly.vertices:
                    q=ob.data.vertices[vi].co
                    n=v(normal_fn((q.x,q.z,-q.y))).normalized()
                    normals.append(tuple(n if dot>.55 else -n if dot<-.55 else poly.normal))
            ob.data.normals_split_custom_set(normals);ob['authored_normals']=True
        return ob

    def polygon_shell(name,pts,mat,thickness=.012,outward=(0,1,0),bevel=.0):
        """Close a game-metre polygon inward from the requested outward direction."""
        n=(Vector(pts[1])-Vector(pts[0])).cross(Vector(pts[2])-Vector(pts[0]))
        face=tuple(range(len(pts)))
        if n.dot(Vector(outward))<0:face=tuple(reversed(face))
        ob=mesh(name,pts,[face],mat)
        mod=ob.modifiers.new('Manufactured wall thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;apply_modifier(ob,mod)
        if bevel:
            mod=ob.modifiers.new('Edge radius','BEVEL');mod.width=bevel;mod.segments=3;apply_modifier(ob,mod)
        return ob

    def curve(points,steps=8):
        """Interpolating Catmull-Rom points for trim curves, including endpoints."""
        p=[Vector(points[0])]+[Vector(q) for q in points]+[Vector(points[-1])];out=[]
        for i in range(1,len(p)-2):
            for k in range(steps):
                t=k/steps;a,b,c,d=p[i-1:i+3]
                out.append(tuple(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)))
        return out+[points[-1]]

    def side_x(z,y):
        """Evaluate the reconstructed positive-X body skin at game Y/Z metres."""
        h=interp(z,H);q=max(0,min(1,(y-.205)/(h-.205)))
        # Tight shoulder crown, restrained concave door skin and inward rocker.
        offset=interp(q,[(0,.080),(.08,.061),(.25,.030),(.53,.020),(.79,.004),(.90,0),(1,.031)])
        return interp(z,W)-offset

    def side_normal(p):
        """Return an analytic outward skin normal for smooth patch boundaries."""
        x,y,z=p;eps=.0001
        dy=(side_x(z,y+eps)-side_x(z,y-eps))/(2*eps)
        dz=(side_x(z+eps,y)-side_x(z-eps,y))/(2*eps)
        return (1 if x>=0 else -1,-dy,-dz)

    # Side panels are continuous high-resolution patches around real open arches.
    # The U-shaped arch includes its lower return, unlike a semicircle on a box.
    for s in (-1,1):
        side='left' if s<0 else 'right'
        bottom=.205;arc_end=math.asin((bottom-wheel_y)/arch);arc_start=pi-arc_end
        rim_end=arch*cos(arc_end)
        def arch_boundary(c,u):
            """Return the open arch's Z/Y boundary around axle c, in metres."""
            a=arc_end+(arc_start-arc_end)*u
            return c-arch*cos(a),wheel_y+arch*sin(a)
        # Three large side sheets meet the arch panels on vertical nonplanar edges.
        spans=[(-2.35,axles[0]-.47,'front_corner'),(axles[0]+.47,axles[1]-.47,'door_skin'),(axles[1]+.47,2.35,'rear_corner')]
        for start,end,part in spans:
            rows=[]
            count=max(8,int((end-start)*30))
            for i in range(count+1):
                u=i/count;row=[]
                for j in range(13):
                    t=j/12
                    # Fender-edge points migrate inward beneath axle center.
                    za=start;zb=end
                    if part=='front_corner':
                        za=start+.100*(1-t)**1.4
                        zb=(axles[0]-rim_end)*(1-t)+(axles[0]-.47)*t
                    elif part=='door_skin':
                        za=(axles[0]+rim_end)*(1-t)+(axles[0]+.47)*t
                        zb=(axles[1]-rim_end)*(1-t)+(axles[1]-.47)*t
                    else:za=(axles[1]+rim_end)*(1-t)+(axles[1]+.47)*t
                    z=za+(zb-za)*u;y=bottom+(interp(z,H)-bottom)*t
                    row.append((s*side_x(z,y),y,z))
                rows.append(row)
            surface(side+'_'+part,rows,thickness=.014,outward=(s,0,0),normal_fn=side_normal)
        for c,axle in zip(axles,('front','rear')):
            rows=[]
            for i in range(61):
                u=i/60;zb,yb=arch_boundary(c,u);zt=c-.47+.94*u;row=[]
                for j in range(9):
                    t=j/8;z=zb*(1-t)+zt*t;yt=interp(zt,H);y=yb*(1-t)+yt*t
                    row.append((s*side_x(z,y),y,z))
                rows.append(row)
            surface(side+'_'+axle+'_fender',rows,thickness=.014,outward=(s,0,0),normal_fn=side_normal)
            # Rolled painted lip and deep black inner liner, not a floating ring.
            rows=[];liner=[]
            for i in range(101):
                u=i/100;z,y=arch_boundary(c,u);xx=side_x(z,y)
                fade=min(1,u/.08,(1-u)/.08)
                rows.append([(s*xx,y,z),(s*(xx-.020),y-.003*fade,z),(s*(xx-.038),y-.013*fade,z)])
                a=arc_end+(arc_start-arc_end)*u
                liner.append([(s*(xx-.032),y-.014,z),(s*.735,wheel_y+(arch-.015)*sin(a),c-(arch-.015)*cos(a))])
            surface(side+'_'+axle+'_rolled_arch',rows,thickness=.006,outward=(s,0,0))
            surface(side+'_'+axle+'_wheelhouse',liner,'underbody',.010,outward=(0,-1,0))
        # Sculpted sill is narrow and terminates neatly between openings.
        rows=[]
        for i in range(61):
            u=i/60;row=[]
            for yy in [.250,.218,bottom,.176]:
                if yy>=bottom:
                    end=axles[1]-sqrt(arch*arch-(yy-wheel_y)**2)
                    end-=.003*(yy-bottom)/(.250-bottom)
                else:end=axles[1]-rim_end-.045
                zz=-end+2*end*u
                xx=side_x(zz,max(bottom,yy))+.004-.028*max(0,(bottom-yy)/(bottom-.176))
                row.append((s*xx,yy,zz))
            rows.append(row)
        surface(side+'_aero_rocker',rows,'carbon',.018,(s,0,0))
        # Door seam follows the actual side skin, rather than a floating black tube.
        door=[(-1.15,.835),(-1.03,.68),(-.98,.36),(-.85,.264),(.68,.264),(.90,.39),(.94,.61),(.94,.857)]
        dp=[]
        points=curve([(z,y,0) for z,y in door],8)
        dp=[(s*(side_x(q[0],q[1])+.0017),q[1],q[0]) for q in points]
        tube(side+'_door_panel_gap',dp,.0024,'carbon',segments=6)
        handle_z=.58;handle_y=.757;xx=side_x(handle_z,handle_y)
        box(side+'_flush_handle',(s*(xx+.002),handle_y,handle_z),(.009,.018,.130),'dark_alloy',.006)
        # A restrained black camera stalk is retained on the actual shoulder.
        beam(side+'_camera_mount',(s*.842,.878,-.67),(s*.992,.894,-.64),.021,.021,'carbon')
        # Lens and housing have a tapered, wing-like silhouette instead of a box.
        pts=[(s*.985,.873,-.71),(s*1.088,.876,-.69),(s*1.097,.913,-.64),(s*1.043,.928,-.65),(s*.997,.911,-.69)]
        polygon_shell(side+'_camera_housing',pts,'body',.045,(0,1,0),.010)
        box(side+'_camera_lens',(s*1.059,.900,-.622),(.066,.020,.006),'screen',.005)

    def pocket_edge(x, trailing=False):
        """Return the inferred pocket boundary around the stowed 8-degree airfoil."""
        q=min(1,abs(x/.986));a=math.radians(8)
        dy=(-.010 if trailing else -.015)+.015*q*q
        dz=(.215 if trailing else -.235)+.075*q*q
        return 2.04+sin(a)*dy+cos(a)*dz+(.006 if trailing else -.006)

    # Three separate longitudinal top bands preserve the reference's deliberate
    # diagonal hood/fender crease; fine smooth quads remove accidental triangulation.
    for part,start,end in [('hood',-2.35,-1.20),('rear_deck_forward',1.45,1.80),('rear_deck_tail',2.31,2.35)]:
        for band,(a,b) in enumerate([(-1,-.70),(-.70,.70),(.70,1)]):
            rows=[];nz=60 if part=='hood' else (22 if part=='rear_deck_forward' else 5);nx=20 if band==1 else 8
            for i in range(nz+1):
                z=start+(end-start)*i/nz;w=interp(z,W);h=interp(z,H);hc=interp(z,HC);row=[]
                for j in range(nx+1):
                    t=a+(b-a)*j/nx;at=abs(t)
                    if at<=.70:y=hc+.009*(1-(at/.70)**2)
                    else:
                        q=(at-.70)/.30;y=hc*(1-q)+h*q+.010*sin(pi*q)
                    inner=(.662*(1-i/nz)+.552*(i/nz)) if part=='hood' else .70*(w-.031)
                    x=(t/.70*inner) if at<=.70 else math.copysign(inner+(at-.70)/.30*((w-.031)-inner),t)
                    if part!='hood':
                        f=i/nz
                        for iteration in range(3):
                            z=(start+(pocket_edge(x)-start)*f) if part=='rear_deck_forward' else (pocket_edge(x,True)+(2.35-pocket_edge(x,True))*f)
                            x=t*(interp(z,W)-.031)
                        hc=interp(z,HC);h=interp(z,H)
                        y=hc+.009*(1-(at/.70)**2) if at<=.70 else hc*(1-q)+h*q+.010*sin(pi*q)
                    row.append((x,y,z))
                rows.append(row)
            surface(part+'_formed_band_'+str(band),rows,thickness=.014,outward=(0,1,0))
    # Narrow belt-top planes join the shoulder to the greenhouse and hide no holes.
    for s in (-1,1):
        rows=[]
        for i in range(91):
            z=-1.20+2.65*i/90;u=i/90;outer=interp(z,W)-.031
            inner=interp(z,[(-1.20,.790),(-.30,.796),(.80,.805),(1.45,.805)])
            y=interp(z,H);rows.append([(s*inner,y+.014,z),(s*(inner+.08),y+.008,z),(s*outer,y,z)])
        surface(('left' if s<0 else 'right')+'_window_belt',rows,thickness=.016,outward=(0,1,0))
        # Genuine, thin hood seam separates the formed hood and fender crown.
        points=[]
        for i in range(65):
            z=-2.28+1.06*i/64;xx=.662+(.552-.662)*(z+2.35)/1.15;points.append((s*xx,interp(z,HC)+.0015,z))
        tube('hood_shutline',points,.0020,'carbon',segments=6)

    # Reference-led local nose: the hood falls into a closed dark upper band,
    # with a shallow low intake rather than one full-height rectangular grille.
    fascia=[]
    for i in range(81):
        x=-.670+1.340*i/80;q=abs(x/.670);front=-2.348+.028*q*q
        fascia.append([(x,.574+.004*q,front),(x*1.012,.515+.003*q,front+.006),(x*1.025,.430,front+.018)])
    surface('front_upper_nose_blade',fascia,'carbon',thickness=.016,outward=(0,0,-1))
    intake=[]
    for i in range(65):
        q=-1+2*i/64
        intake.append([(q*.687,.428,-2.310+.035*q*q),(q*.709,.294,-2.270+.035*q*q)])
    surface('front_intake_recess_back',intake,'carbon',.018,outward=(0,0,-1))
    for sign in (-1,1):
        rows=[]
        for j in range(33):
            y=.245+.329*j/32;t=(y-.205)/(.60-.205)
            for iteration in range(4):
                edge_z=-2.35+.100*(1-max(0,min(1,t)))**1.4
                t=(y-.205)/(interp(edge_z,H)-.205)
            outer_z=edge_z+.012
            if y>=.430:
                q=min(1,(y-.430)/.144);inner_x=.687-.017*q;inner_z=-2.302-.018*q
            else:
                q=max(0,(y-.294)/.136);inner_x=.709-.022*q;inner_z=-2.245-.055*q
            rows.append([(sign*inner_x,y,inner_z),(sign*(side_x(outer_z,y)-.006),y,outer_z)])
        surface('front_intake_closed_side_return',rows,'carbon',.018,outward=(0,0,-1))
    rows=[]
    for j in range(65):
        q=-1+2*j/64
        rows.append([(q*.709,.298,-2.270+.035*q*q),(q*.730,.248,-2.318+.060*(q*.730/.905)**2)])
    surface('front_intake_closed_lower_return',rows,'carbon',.018,outward=(0,0,-1))
    for yy,half,zz,rr in [(.430,.687,-2.329,.008),(.294,.709,-2.285,.010)]:
        tube('front_intake_lip',[(x,yy,zz+.028*(x/half)**2) for x in [-half+2*half*i/80 for i in range(81)]],rr,'carbon',segments=8)
    for yy in [.323,.354]:
        tube('front_inset_grille',[(x,yy,-2.289+.030*(x/.680)**2) for x in [-.680+1.360*i/32 for i in range(33)]],.0045,'dark_alloy',segments=6)
    points=[(x,.566+.005*abs(x/.670),-2.358+.018*(x/.670)**2) for x in [-.670+1.340*i/100 for i in range(101)]]
    tube('nose_LED_recess',points,.010,'carbon',segments=10)
    tube('nose_flush_LED',[(x,y+.001,z-.010) for x,y,z in points],.0048,'lights_white',segments=8)
    for s in (-1,1):
        # Deliberately faceted cheek planes in the reference taper to the splitter.
        pts=[(s*.802,.632,-2.312),(s*.893,.691,-2.187),(s*.920,.533,-2.151),(s*.882,.292,-2.203),(s*.785,.316,-2.279)]
        # Cheeks are the continuous formed side skin, not overlapping applied plates.
        # Triangular hidden main lamp between the central trapezoid and fender.
        def hood_at(x,z):
            """Sample the actual formed hood height for conformal optical surfaces."""
            inner=.662+(.552-.662)*(z+2.35)/1.15;outer=interp(z,W)-.031;hc=interp(z,HC);h=interp(z,H)
            if abs(x)<=inner:return hc+.009*(1-(x/inner)**2)
            q=(abs(x)-inner)/(outer-inner)
            return hc*(1-q)+h*q+.010*sin(pi*q)
        def optical_patch(name,outline,mat,lift,divisions=20):
            """Close a conformal triangular optical part above the hood in game metres."""
            tip,left,right=outline;verts=[];faces=[];n=divisions
            for i in range(n+1):
                u=i/n
                for j in range(i+1):
                    t=j/i if i else 0;x=tip[0]*(1-u)+u*(left[0]*(1-t)+right[0]*t);z=tip[1]*(1-u)+u*(left[1]*(1-t)+right[1]*t)
                    verts.append((s*x,hood_at(x,z)+lift,z))
            for i in range(n):
                a=i*(i+1)//2;b=(i+1)*(i+2)//2
                for j in range(i+1):
                    faces.append((a+j,b+j,b+j+1))
                    if j<i:faces.append((a+j,b+j+1,a+j+1))
            if s<0:faces=[tuple(reversed(f)) for f in faces]
            ob=mesh(name,verts,faces,mat,smooth=True)
            mod=ob.modifiers.new('Optical lens thickness','SOLIDIFY');mod.thickness=.005;mod.offset=-1;apply_modifier(ob,mod)
            return ob
        optical_patch('headlamp_optical_cover',[(.668,-2.310),(.552,-1.205),(.890,-1.205)],'optical',.007,24)
        # A narrow bright brow and separated tapered projector ribs sit inside
        # the smoked triangle; the complete patch is not a glowing white sticker.
        optical_patch('headlamp_lower_smoked_lens',[(.668,-2.292),(.617,-1.820),(.765,-1.820)],'optical',.014,16)
        rows=[]
        for j in range(25):
            t=j/24;x=.617+(.765-.617)*t
            rows.append([(s*x,hood_at(x,-1.824)+.021,-1.824),(s*(.668+(x-.668)*.91),hood_at(.668+(x-.668)*.91,-1.862)+.021,-1.862)])
        surface('headlamp_triangular_lens',rows,'lights_white',.004,outward=(0,1,0))
        for j in range(5):
            t=(j+.5)/5;xx=.624+.132*t;end_z=-1.944+.018*abs(t-.5)
            rows=[]
            for k in range(13):
                f=k/12;z=-1.860+(end_z+1.860)*f;center=.668+(xx-.668)*(1-.13*f);half=.006*(1-.35*f)
                rows.append([(s*(center-half),hood_at(center-half,z)+.022,z),(s*(center+half),hood_at(center+half,z)+.022,z)])
            surface('headlamp_projector_flute',rows,'lights_white',.003,outward=(0,1,0))
    rows=[]
    for i in range(81):
        q=-1+2*i/80;x=.905*q;front=-2.318+.060*q*q
        rows.append([(x,.248+.004*q*q,front),(x*1.022,.244,front+.045),(x*1.011,.208,-2.106+.020*q*q)])
    surface('front_sculpted_splitter',rows,'carbon',.022,outward=(0,1,0))

    # A low continuous arc greenhouse with an opaque-black ceramic boundary.
    def pane(pane_name):
        """Build a closed bowed glazing pane in the reconstructed canopy envelope."""
        rows=[]
        for i in range(25):
            u=i/24;row=[]
            for j in range(41):
                t=-1+2*j/40;bow=1-t*t
                if pane_name=='windshield':
                    width=.790*(1-u)+.664*u
                    y=(.856+.005*bow)*(1-u)+(1.193+.030*bow)*u+.014*sin(pi*u)
                    z=-1.200*(1-u)+(-.300-.055*bow)*u-.014*sin(pi*u)
                elif pane_name=='roof':
                    width=.664*(1-u)+.675*u
                    y=1.193+.030*bow+.014*sin(pi*u)
                    z=(-.300-.055*bow)*(1-u)+(.800+.035*bow)*u
                else:
                    width=.675*(1-u)+.802*u
                    y=(1.193+.030*bow)*(1-u)+(.877+.003*bow)*u+.015*sin(pi*u)
                    z=(.800+.035*bow)*(1-u)+1.450*u
                row.append((t*width,y,z))
            rows.append(row)
        surface('greenhouse_'+pane_name,rows,'glass',.006,outward=(0,1,0))
    for p in ('windshield','roof','rear_glass'):pane(p)
    for s in (-1,1):
        side='left' if s<0 else 'right'
        # Curved side glass is a ruled quadrilateral with a subtly bowed beltline.
        rows=[]
        for i in range(49):
            u=i/48;loz=-1.150+2.500*u;hiz=-.286+1.086*u
            lox=.804+.013*sin(pi*u);hix=.676+.011*u
            loy=.860+.010*u;hiy=1.191+.010*sin(pi*u)
            rows.append([(s*(lox*(1-t)+hix*t+.010*sin(pi*t)),loy*(1-t)+hiy*t,loz*(1-t)+hiz*t) for t in [j/16 for j in range(17)]])
        surface(side+'_door_glass',rows,'glass',.005,outward=(s,0,0))
        ap=curve([(s*.801,.856,-1.200),(s*.741,1.025,-.750),(s*.677,1.197,-.300)],16)
        tube(side+'_black_A_pillar',ap,.018,'carbon',segments=10)
        tube(side+'_painted_A_pillar',[(x+s*.006,y+.003,z) for x,y,z in ap],.005,'body',segments=8)
        rail=curve([(s*.677,1.197,-.300),(s*.682,1.214,.250),(s*.688,1.197,.800)],16)
        tube(side+'_roof_perimeter',rail,.019,'carbon',segments=10)
        # Roof perimeter is dark sealed glazing, not a separate chrome tube.
        belt=curve([(s*.802,.859,-1.175),(s*.816,.867,.20),(s*.817,.871,1.350)],16)
        tube(side+'_window_belt_seal',belt,.010,'carbon',segments=8)
        cp=curve([(s*.688,1.192,.800),(s*.770,1.040,1.090),(s*.817,.871,1.350)],16)
        tube(side+'_C_pillar_seal',cp,.018,'carbon',segments=10)
        # Solid sculpted flying buttress widens into rear shoulder; smooth in its
        # surface but with the sharp boundary seen in the exterior reference.
        rows=[]
        for i in range(49):
            u=i/48;zz=.800+.750*u;inside=.686+.116*u;outside=.704+.265*sin(u*pi/2)
            high=1.196*(1-u)+interp(1.55,H)*u;low=high-.036*sin(pi*u)
            rows.append([(s*(inside+(outside-inside)*t),high*(1-t)+low*t,zz+.035*sin(pi*t)) for t in [j/10 for j in range(11)]])
        surface(side+'_formed_rear_buttress',rows,'body',.018,outward=(s*.4,1,0))

    # Rear upper bumper and thin full-width light band match the supplied hover view.
    rear=[]
    for i in range(81):
        x=-.938+1.876*i/80;q=abs(x/.938);z=2.335+.015*q**4
        rear.append([(x,.805-.016*q,z),(x*.992,.731-.010*q,z+.010),(x*.965,.571+.012*q,z-.005)])
    surface('rear_upper_fascia',rear,'body',.022,outward=(0,0,1))
    led=[(x,.783-.020*abs(x/.930)**2,2.353+.005*(x/.930)**2) for x in [-.930+1.86*i/100 for i in range(101)]]
    surface('rear_light_shadow_channel',[[(x,y+.014,z+.010),(x,y-.014,z+.010)] for x,y,z in led],'carbon',.012,outward=(0,0,1))
    tube('continuous_rear_LED',[(x,y+.001,z+.024) for x,y,z in led],.009,'lights_red',segments=10)
    # License plate in the actual upper silver section, above the nozzles.
    box('rear_plate_recess',(0,.652,2.348),(.395,.172,.020),'carbon',.015)
    box('rear_plate_blank',(0,.655,2.361),(.356,.138,.010),'plate',.010)
    text_data=bpy.data.curves.new('RDSTR plate lettering','FONT');text_data.body='RDSTR';text_data.align_x='CENTER';text_data.align_y='CENTER';text_data.size=.068;text_data.resolution_u=3;text_data.extrude=.0002;text_data.bevel_depth=0;text_data.bevel_resolution=0
    text_ob=bpy.data.objects.new('rear_plate_RDSTR',text_data);bpy.context.collection.objects.link(text_ob);text_ob.location=v((0,.655,2.369));text_ob.rotation_euler.x=pi/2;text_data.materials.append(M['alloy'])
    bpy.ops.object.select_all(action='DESELECT');text_ob.select_set(True);bpy.context.view_layer.objects.active=text_ob;bpy.ops.object.convert(target='MESH');text_ob=bpy.context.object;text_ob['material_group']='alloy';objects.append(text_ob);text_ob.select_set(False)
    # Real inset propulsion chamber: an eight-sided shaped aperture, deep walls,
    # four upper cold-gas bores and four lower gimbal sockets inside it.
    aperture=[(-.656,.578),(-.550,.610),(.550,.610),(.656,.578),(.722,.464),(.703,.170),(.595,.100),(-.595,.100),(-.703,.170),(-.722,.464)]
    n=len(aperture);vs=[]
    for depth,scale in [(2.350,1),(2.325,.965),(2.178,.900)]:
        for x,y in aperture:vs.append((x*scale,max(.205 if scale<1 else .100,.411+(y-.411)*scale),depth))
    fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(2) for i in range(n)]
    ob=mesh('recessed_propulsion_tunnel',vs,fs,'carbon',smooth=False)
    mod=ob.modifiers.new('Duct wall','SOLIDIFY');mod.thickness=.020;mod.offset=-1;apply_modifier(ob,mod)
    polygon_shell('propulsion_chamber_back',[(x*.90,max(.205,.411+(y-.411)*.90),2.176) for x,y in aperture],'underbody',.018,(0,0,1))
    polygon_shell('rear_duct_structural_floor',[(-.655,.102,1.77),(.655,.102,1.77),(.655,.102,2.350),(-.655,.102,2.350)],'underbody',.018,(0,-1,0))
    # Open black side recesses above and outboard of the duct are separate closed cavities.
    for s in (-1,1):
        polygon_shell('rear_side_recess',[(s*.700,.563,2.316),(s*.886,.562,2.285),(s*.904,.395,2.278),(s*.750,.391,2.305)],'carbon',.025,(0,0,1),.008)
        tube('rear_side_recess_divider',[(s*.715,.491,2.330),(s*.887,.492,2.303)],.009,'dark_alloy',segments=6)
        # Outer bumper haunch is already present in the continuous rear side skin.

    def ring_z(name,x,y,z,profile,mat,n=64):
        """Revolve a closed axial/radial profile about game +Z, in metres."""
        vs=[(x+r*cos(2*pi*k/n),y+r*sin(2*pi*k/n),z+zz) for zz,r in profile for k in range(n)]
        fs=[(j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k) for j in range(len(profile)-1) for k in range(n)]
        # The profile must be a closed loop: it includes front lip, inner bore and rear.
        return mesh(name,vs,fs,mat,smooth=True)
    for fan_index,x in enumerate((-.399,-.135,.135,.399)):
        ring_z('rear_upper_nozzle_machined_lip',x,.541,2.334,[(0,.046),(.016,.048),(.023,.041),(.022,.035),(-.061,.033),(-.064,.040),(0,.046)],'shield')
        api['cylinder_z']('rear_upper_nozzle_dark_throat',(x,.541,2.267),.033,.006,'carbon',n=48)
        # A deep broad shroud, not an exposed fan glued to a bumper.
        x=x*1.19
        ring_z('rear_gimbal_shroud',x,.358,2.253,[(-.025,.106),(.007,.117),(.033,.114),(.040,.095),(-.017,.086),(-.025,.106)],'dark_alloy')
        api['cylinder_z']('rear_fan_well',(x,.358,2.255),.094,.007,'carbon',n=64)
        fan=bpy.data.objects.new('fan_'+str(fan_index),None);bpy.context.collection.objects.link(fan);fan.location=v((x,.358,2.270));fan['spinAxis']=[0,0,1]
        for k in range(9):
            a=k*2*pi/9
            pts=[(x+.022*cos(a),.358+.022*sin(a),2.270),(x+.091*cos(a+.17),.358+.091*sin(a+.17),2.272),(x+.093*cos(a+.47),.358+.093*sin(a+.47),2.276),(x+.030*cos(a+.66),.358+.030*sin(a+.66),2.279)]
            rotor=polygon_shell('rear_impeller_blade',pts,'dark_alloy',.006,(0,0,1),.001)
            for vert in rotor.data.vertices:vert.co-=fan.location
            rotor.parent=fan
        profile=[(2.264,.057,0),(2.294,.052,.004),(2.332,.034,.013),(2.352,.020,.019),(2.352,.012,.019),(2.322,.011,.014),(2.264,.057,0)]
        vs=[(x+r*cos(2*pi*k/48),.358+oy+r*sin(2*pi*k/48),zz) for zz,r,oy in profile for k in range(48)]
        fs=[(j*48+k,j*48+(k+1)%48,(j+1)*48+(k+1)%48,(j+1)*48+k) for j in range(len(profile)-1) for k in range(48)]
        mesh('rear_canted_conical_fan_hub',vs,fs,'underbody',smooth=True)
    for x in (-.265,0,.265):
        box('propulsion_vertical_web',(x,.375,2.251),(.034,.247,.112),'carbon',.003)
    # Low curved aft tray with a few longitudinal aero strakes, not oversized fins.
    for x in (-.60,-.38,0,.38,.60):
        pts=[(x,.174,1.77),(x,.267,2.303),(x,.207,2.303),(x,.153,1.89)]
        polygon_shell('rear_undertray_strake',pts,'carbon',.012,(1,0,0),.002)

    # A reconstructed telescoping mechanism connects the visible official stowed
    # and raised poses. Public imagery does not disclose its internal mechanism.
    carriage=bpy.data.objects.new('wing_carriage',None);bpy.context.collection.objects.link(carriage);carriage.location=v((0,1.13,2.04))
    carriage['aeroRole']='lift';carriage['aeroStowPositionOffset']=[0,-.28,0]
    wing_pivot=bpy.data.objects.new('wing_pivot',None);bpy.context.collection.objects.link(wing_pivot);wing_pivot.parent=carriage;wing_pivot.rotation_euler.x=math.radians(42)
    wing_pivot['aeroRole']='blade';wing_pivot['aeroStowPositionOffset']=[0,0,0];wing_pivot['aeroStowAxis']=[1,0,0];wing_pivot['aeroStowAngle']=math.radians(-34)
    wing_pivot['mechanismBasis']='Reconstructed telescoping/folding support; visible endpoint poses reference-led'

    def annular_sleeve(name,x,z,y0,y1,outer,inner,parent=None):
        """Create a closed rectangular hollow sleeve in game metres along +Y."""
        ow,od=outer;iw,idp=inner;verts=[]
        for yy in [y0,y1]:
            for ww,dd in [(ow,od),(iw,idp)]:
                verts.extend([(x-ww/2,yy,z-dd/2),(x+ww/2,yy,z-dd/2),(x+ww/2,yy,z+dd/2),(x-ww/2,yy,z+dd/2)])
        faces=[]
        for k in range(4):
            n=(k+1)%4;faces.extend([(k,n,8+n,8+k),(4+n,4+k,12+k,12+n),(k,4+k,4+n,n),(8+n,12+n,12+k,8+k)])
        return mesh(name,verts,faces,'carbon',parent,bevel=.0015)

    # The deck has a real shallow enclosed recess. The blade never sinks through
    # an intact sheet of bodywork, and the actuator sleeves remain visible.
    for s in (-1,1):
        rows=[]
        for i in range(33):
            z=pocket_edge(.986)+(pocket_edge(.986,True)-pocket_edge(.986))*i/32;edge=interp(z,W)-.033
            rows.append([(s*edge,interp(z,H)-.006,z),(s*(edge-.018),.714,z)])
        surface('wing_pocket_sidewall',rows,'carbon',.012,outward=(s,0,0))
    for trailing in [False,True]:
        edge=.985
        for iteration in range(4):edge=interp(pocket_edge(edge,trailing),W)-.034
        rows=[]
        for i in range(65):
            x=-edge+2*edge*i/64;zz=pocket_edge(x,trailing)
            at=abs(x)/(interp(zz,W)-.031);hc=interp(zz,HC);h=interp(zz,H)
            if at<=.70:yy=hc+.009*(1-(at/.70)**2)
            else:
                q=min(1,(at-.70)/.30);yy=hc*(1-q)+h*q+.010*sin(pi*q)
            rows.append([(x,.714,zz),(x,yy,zz)])
        surface('wing_pocket_endwall',rows,'carbon',.012,outward=(0,0,1 if trailing else -1))
    xs=[-.94,-.55,-.45,.45,.55,.94];zs=[1.78,1.99,2.09,2.35]
    for i in range(len(xs)-1):
        for j in range(len(zs)-1):
            if i in [1,3] and j==1:continue
            points=[]
            for k,z in [(i,zs[j]),(i+1,zs[j]),(i+1,zs[j+1]),(i,zs[j+1])]:
                x=xs[k]
                if k in (0,len(xs)-1):x=math.copysign(interp(z,W)-.051,x)
                if z==zs[-1]:
                    # Terminate at the fascia's inner wall. The old z=2.35
                    # floor pierced the bumper as a visible dark horizontal bar.
                    q=abs(x/.938);t=0
                    for iteration in range(4):
                        t=(.7065-(.731-.010*q))/(-.160+.022*q)
                        q=abs(x/(.938*(.992-.027*t)))
                    z=2.335+.015*q**4+.010-.015*t-.0235
                points.append((x,z))
            api['prism_xz']('wing_pocket_floor',points,.699,.714,'carbon')
    for s in (-1,1):
        side='l' if s<0 else 'r'
        annular_sleeve('wing_fixed_sleeve_'+side,s*.50,2.04,.64,.81,(.060,.090),(.046,.074))
        annular_sleeve('wing_floor_gland_'+side,s*.50,2.04,.706,.724,(.100,.130),(.064,.094))
        middle=bpy.data.objects.new('wing_lift_mid_'+side,None);bpy.context.collection.objects.link(middle)
        middle['aeroRole']='lift';middle['aeroStowPositionOffset']=[0,-.17,0]
        annular_sleeve('wing_middle_sleeve_'+side,s*.50,2.04,.79,.99,(.043,.070),(.028,.053),middle)
        top=bpy.data.objects.new('wing_lift_top_'+side,None);bpy.context.collection.objects.link(top)
        top['aeroRole']='lift';top['aeroStowPositionOffset']=[0,-.28,0]
        box('wing_inner_rod_'+side,(s*.50,1.05,2.04),(.024,.160,.049),'dark_alloy',.002,top)
        cylinder_x('wing_pitch_bearing_'+side,(s*.50,1.13,2.04),.023,.070,'dark_alloy',top,n=32)
    rows=[]
    foil=[(-.235,-.010),(-.196,.010),(-.120,.022),(-.010,.028),(.110,.020),(.207,.004),(.215,-.005),(.115,-.014),(-.010,-.020),(-.135,-.021),(-.222,-.015),(-.235,-.010)]
    for i in range(65):
        x=-.986+1.972*i/64;q=abs(x/.986);yy=1.125+.015*q*q;zz=2.040+.075*q*q
        rows.append([(x,yy+dy,zz+dz) for dz,dy in foil])
    ni=len(rows);nj=len(foil);verts=[p for row in rows for p in row];faces=[(i*nj+j,i*nj+j+1,(i+1)*nj+j+1,(i+1)*nj+j) for i in range(ni-1) for j in range(nj-1)]
    faces += [tuple(reversed(range(nj))),tuple((ni-1)*nj+j for j in range(nj))]
    blade=mesh('sculpted_rear_aerofoil',verts,faces,'body',smooth=True)
    for vert in blade.data.vertices:vert.co-=v((0,1.13,2.04))
    blade.parent=wing_pivot
    for s in (-1,1):
        side='l' if s<0 else 'r';hinge=(s*.986,1.088,2.115)
        tip=bpy.data.objects.new('wing_tip_'+side,None);bpy.context.collection.objects.link(tip);tip.parent=wing_pivot;tip.location=v((s*.986,-.042,.075))
        tip.rotation_mode='QUATERNION';tip.rotation_quaternion=Quaternion(v((0,0,1)),s*math.radians(8))
        tip['aeroRole']='tip';tip['aeroStowPositionOffset']=[0,0,0];tip['aeroStowAxis']=[0,0,1];tip['aeroStowAngle']=-s*(pi/2+math.radians(8))
        points=[(s*.986,1.088,1.880),(s*.986,.958,1.900),(s*.986,.987,2.310),(s*.986,1.088,2.330)]
        fence=polygon_shell('wing_tapered_fence_'+side,points,'body',.004,(s,0,0),.001)
        for vert in fence.data.vertices:vert.co-=v(hinge)
        fence.parent=tip
        tube('wing_tip_hinge_'+side,[(0,0,-.218),(0,0,.210)],.006,'dark_alloy',tip,segments=8)
        for zz in [-.157,.155]:
            beam('wing_hinge_pedestal_'+side,(s*.976,-.025,.075+zz),(s*.986,-.036,.075+zz),.011,.012,'dark_alloy',wing_pivot)
        # A real short end cap joins the foil's lower skin to the hinge mount.
        # The moving fence folds underneath it, wholly below the aerofoil.
        points=[(s*.986,1.140+dy,2.115+dz) for dz,dy in [(-.235,-.010),(-.222,-.015),(-.135,-.021),(-.010,-.020),(.115,-.014),(.215,-.005)]]
        points.extend([(s*.986,1.094,2.330),(s*.986,1.094,1.880)])
        cap=polygon_shell('wing_fixed_lower_end_cap_'+side,points,'body',.004,(s,0,0),.001)
        for vert in cap.data.vertices:vert.co-=v((0,1.13,2.04))
        cap.parent=wing_pivot

    # Cut the stowed foil and under-folded fence envelope through quarter returns as well
    # as the deck. This inferred pocket is real negative space, not a hidden
    # wing or a blade translated through an intact shoulder sheet.
    cut_rows=[];a=math.radians(8)
    lower=[(-.241,-.010),(-.222,-.015),(-.135,-.021),(-.010,-.020),(.115,-.014),(.221,-.005)]
    for i in range(65):
        x=-.993+1.986*i/64;q=min(1,abs(x/.986));row=[]
        for dz,dy in lower:
            yy=-.005+.015*q*q+dy;zz=.075*q*q+dz
            row.append((x,.85+cos(a)*yy-sin(a)*zz-.052,2.04+sin(a)*yy+cos(a)*zz))
        cut_rows.append(row)
    ni=len(cut_rows);nj=len(lower);base=[p for row in cut_rows for p in row];n=len(base)
    verts=base+[(x,1.50,z) for x,y,z in base];faces=[]
    for i in range(ni-1):
        for j in range(nj-1):
            f=(i*nj+j,i*nj+j+1,(i+1)*nj+j+1,(i+1)*nj+j)
            faces.extend([tuple(reversed(f)),tuple(k+n for k in f)])
    boundary=list(range(nj))+[i*nj+nj-1 for i in range(1,ni)]+[(ni-1)*nj+j for j in range(nj-2,-1,-1)]+[i*nj for i in range(ni-2,0,-1)]
    for i,k in enumerate(boundary):
        j=boundary[(i+1)%len(boundary)];faces.append((k,j,j+n,k+n))
    cutter=mesh('wing_pocket_clearance_tool',verts,faces,'carbon')
    bm=bmesh.new();bm.from_mesh(cutter.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(cutter.data);bm.free()
    cut_parts=('rear_fender','rear_corner','rear_deck_','wing_pocket_sidewall','wing_pocket_endwall')
    for ob in list(objects):
        if ob==cutter or not any(key in ob.name for key in cut_parts):continue
        mod=ob.modifiers.new('Reconstructed stowed airfoil pocket','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        apply_modifier(ob,mod)
    objects.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)

    # Wide low-profile tires and swept five-pair aero blades from supplied front view.
    for side in (-1,1):
      for iz,z in enumerate(axles):
        name='wheel_'+('f' if iz==0 else 'r')+('l' if side<0 else 'r')
        carrier=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(carrier);carrier.location=v((side*.908,wheel_y,z));carrier.empty_display_size=.12
        pivot=bpy.data.objects.new(name.replace('wheel_','wheel_spin_'),None);bpy.context.collection.objects.link(pivot);pivot.parent=carrier;pivot.empty_display_size=.10
        n=96
        profile=[(-.151,.294),(-.153,.322),(-.148,.343),(-.135,.363),(-.115,.377),(-.091,.383),(-.075,.382),(-.070,.377),(-.065,.383),(-.031,.383),(-.027,.378),(-.023,.383),(.017,.383),(.021,.378),(.025,.383),(.062,.383),(.067,.377),(.073,.382),(.091,.383),(.115,.377),(.135,.363),(.148,.343),(.153,.322),(.151,.294),(-.151,.294)]
        verts=[(x,r*cos(2*pi*k/n),r*sin(2*pi*k/n)) for x,r in profile for k in range(n)]
        faces=[(j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k) for j in range(len(profile)-1) for k in range(n)]
        mesh(name+'_tire',verts,faces,'rubber',pivot,smooth=True)
        # The rim is an annular barrel; a solid disc must never fill spoke voids.
        prof=[(-.135,.294),(.145,.294),(.158,.286),(.156,.275),(.132,.274),(-.132,.282),(-.135,.294)]
        verts=[(x,r*cos(2*pi*k/n),r*sin(2*pi*k/n)) for x,r in prof for k in range(n)]
        mesh(name+'_annular_rim',verts,[(j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k) for j in range(len(prof)-1) for k in range(n)],'dark_alloy',pivot,smooth=True)
        ox=side*.153
        tube(name+'_diamond_cut_rim',[(ox,.288*cos(2*pi*k/112),.288*sin(2*pi*k/112)) for k in range(113)],.004,'alloy',pivot,segments=8)
        # Closed annular brake rotor with true ventilating holes, never a solid
        # circular plate filling all of the negative space behind the spokes.
        rn=72;rr=[.115,.157,.191,.231,.248];rv=[]
        for xx in [side*.042,side*.056]:
            for r in rr:rv.extend([(xx,r*cos(2*pi*k/rn),r*sin(2*pi*k/rn)) for k in range(rn)])
        stride=rn*len(rr);rf=[]
        def cell(j,k):
            """Keep annular rotor cells except the deliberately open ventilation holes."""
            return 0<=j<len(rr)-1 and not (j==2 and k%6==0)
        for j in range(len(rr)-1):
            for k in range(rn):
                if not cell(j,k):continue
                a=j*rn+k;b=j*rn+(k+1)%rn;c=(j+1)*rn+(k+1)%rn;d=(j+1)*rn+k
                rf.extend([(a,d,c,b),(a+stride,b+stride,c+stride,d+stride)])
                for aa,bb,neighbor in [(a,b,cell(j-1,k)),(d,c,cell(j+1,k)),(a,d,cell(j,(k-1)%rn)),(b,c,cell(j,(k+1)%rn))]:
                    if not neighbor:rf.append((aa,bb,bb+stride,aa+stride))
        mesh(name+'_ventilated_annular_rotor',rv,rf,'brake_carbon',pivot)
        # Machined concentric rings make the inset rotor legible in close-up.
        for r in (.228,.241):tube(name+'_rotor_score',[(side*.058,r*cos(2*pi*k/96),r*sin(2*pi*k/96)) for k in range(97)],.0009,'dark_alloy',pivot,segments=4)
        for k in range(5):
            a=k*2*pi/5+.17
            for fork in (-1,1):
                # Broad tapered fork with a sharp dark inset; five paired swept spokes.
                yz=[]
                for r,ang in [(.061,a+fork*.038),(.151,a+fork*.115),(.280,a+fork*.192),(.280,a+fork*.192+.226),(.145,a+fork*.045+.170),(.062,a+.150)]:
                    yz.append((r*cos(ang),r*sin(ang)))
                verts=[(xx,y,zz) for xx in [ox-side*.020,ox] for y,zz in yz];nn=len(yz)
                faces=[tuple(reversed(range(nn))),tuple(range(nn,2*nn))]+[(i,(i+1)%nn,(i+1)%nn+nn,i+nn) for i in range(nn)]
                mesh(name+'_swept_aero_blade',verts,faces,'dark_alloy',pivot,bevel=.003,smooth=False)
            aa=a+.127
            tube(name+'_blade_machined_edge',[(ox+side*.002,.080*cos(aa),.080*sin(aa)),(ox+side*.002,.275*cos(aa+.11),.275*sin(aa+.11))],.0023,'alloy',pivot,segments=6)
            # A dark aerodynamic insert sits between each silver fork pair.
            yz=[(.105*cos(a+.07),.105*sin(a+.07)),(.278*cos(a+.01),.278*sin(a+.01)),(.278*cos(a+.165),.278*sin(a+.165)),(.105*cos(a+.18),.105*sin(a+.18))]
            verts=[(xx,y,zz) for xx in [ox-side*.012,ox-side*.005] for y,zz in yz]
            mesh(name+'_blade_shadow',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'dark_alloy',pivot,bevel=.001)
        cylinder_x(name+'_hub',(ox,0,0),.071,.028,'dark_alloy',pivot,n=64)
        cylinder_x(name+'_center_cap',(ox+side*.019,0,0),.039,.007,'dark_alloy',pivot,n=48)
        for k in range(5):
            a=k*2*pi/5;cylinder_x(name+'_lug',(ox+side*.021,.055*cos(a),.055*sin(a)),.007,.007,'dark_alloy',pivot,n=10)
        # Calipers stay fixed relative to chassis, never spin with wheel geometry.
        box(name+'_fixed_brake_caliper',(side*.070,.024,.197),(.052,.142,.069),'dark_alloy',.016,carrier)
    return {'wheel_radius':radius,'wheel_centers':[(s*.908,wheel_y,z) for z in axles for s in (-1,1)],'body_envelope':'reference-proportioned, not manufacturer CAD','surface':surface,'polygon_shell':polygon_shell,'curve':curve}
