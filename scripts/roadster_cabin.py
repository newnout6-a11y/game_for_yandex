"""Reference-led Roadster cabin: original, editable Blender geometry.

The five supplied interior photographs guide visible shapes and trim only. Hidden
seat/trim engineering is not asserted to be an OEM reconstruction. All dimensions
are in game metres (+X right, +Y up, -Z front). Call build_cabin(api) after the
host's geometry helpers exist. This module never clears, batches, exports, or
renders a scene, and never creates external glazing or a driver.

Small original tiled maps and a hand-drawn infotainment UI are generated with
NumPy into art/textures/roadster-cabin-*.png, packed in the .blend, and exported
by Blender's standard glTF material pipeline. No photograph is mapped onto the
car. Carbon, upholstery, roof apertures, seat shells and all controls have depth.
"""
import os
import math
from math import sin, cos, pi, sqrt
import bpy
import numpy as np
from mathutils import Vector


def _save_image(name, pixels, directory, noncolor=False):
    """Save and pack a deterministic original RGBA texture."""
    os.makedirs(directory, exist_ok=True)
    height, width = pixels.shape[:2]
    im = bpy.data.images.get(name)
    if im is None:
        im = bpy.data.images.new(name, width=width, height=height, alpha=True)
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(pixels[:, :, :3], 0, 1)
    im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = os.path.join(directory, name + '.png')
    im.file_format = 'PNG'
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    im.save()
    im.pack()
    return im


# Small block glyphs are deliberately drawn here, not taken from a product UI.
_GLYPHS = {
'A':['01110','10001','10001','11111','10001','10001','10001'],
'B':['11110','10001','10001','11110','10001','10001','11110'],
'C':['01111','10000','10000','10000','10000','10000','01111'],
'D':['11110','10001','10001','10001','10001','10001','11110'],
'E':['11111','10000','10000','11110','10000','10000','11111'],
'F':['11111','10000','10000','11110','10000','10000','10000'],
'G':['01111','10000','10000','10111','10001','10001','01110'],
'H':['10001','10001','10001','11111','10001','10001','10001'],
'I':['111','010','010','010','010','010','111'],
'K':['10001','10010','10100','11000','10100','10010','10001'],
'L':['10000','10000','10000','10000','10000','10000','11111'],
'M':['10001','11011','10101','10101','10001','10001','10001'],
'N':['10001','11001','10101','10011','10001','10001','10001'],
'O':['01110','10001','10001','10001','10001','10001','01110'],
'P':['11110','10001','10001','11110','10000','10000','10000'],
'R':['11110','10001','10001','11110','10100','10010','10001'],
'S':['01111','10000','10000','01110','00001','00001','11110'],
'T':['11111','00100','00100','00100','00100','00100','00100'],
'U':['10001','10001','10001','10001','10001','10001','01110'],
'V':['10001','10001','10001','10001','10001','01010','00100'],
'W':['10001','10001','10001','10101','10101','10101','01010'],
'Y':['10001','10001','01010','00100','00100','00100','00100'],
'0':['01110','10001','10001','10001','10001','10001','01110'],
'1':['010','110','010','010','010','010','111'],
'2':['01110','10001','00001','00010','00100','01000','11111'],
'3':['11110','00001','00001','01110','00001','00001','11110'],
'4':['00010','00110','01010','10010','11111','00010','00010'],
'5':['11111','10000','10000','11110','00001','00001','11110'],
'6':['01110','10000','10000','11110','10001','10001','01110'],
'7':['11111','00001','00010','00100','01000','01000','01000'],
'8':['01110','10001','10001','01110','10001','10001','01110'],
'9':['01110','10001','10001','01111','00001','00001','01110'],
'.':['0','0','0','0','0','1','1'], ':':['0','1','1','0','1','1','0'],
'-':['000','000','000','111','000','000','000'],
'%':['11001','11010','00100','01000','10110','00110','00000'],
}


def _make_maps(directory):
    """Create small game-portable material maps, including real normal maps."""
    rng = np.random.default_rng(41)
    yy, xx = np.mgrid[0:256, 0:256]
    # A 2x2 twill weave, four crossing bundles, with eight fine filaments each.
    bx, by = xx // 32, yy // 32
    over = ((bx - by) % 4) < 2
    across = np.where(over, yy % 32, xx % 32)
    along = np.where(over, xx, yy)
    ridge = np.sin((across + .5) / 32 * pi) ** .65
    fiber = .5 + .5 * np.cos(across * 2 * pi / 4)
    # Near-black carbon is a dielectric resin composite, not dark blue metal.
    # These linear albedo values retain visible bundles without washing out in
    # the game's bright image-based lighting. Normal-map relief stays unchanged.
    val = .010 + .013 * ridge + .003 * fiber + .0018 * np.sin(along * pi / 64)
    val += rng.normal(0, .0006, val.shape)
    carbon = np.stack([val * .92, val * .98, val * 1.05], axis=2)
    relief = ridge * .55 + fiber * .06
    gy, gx = np.gradient(relief)
    normal = np.stack([-gx * .75, -gy * .75, np.ones_like(gx)], axis=2)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    leather_noise = rng.normal(0, 1, (256, 256))
    leather_noise = (leather_noise + np.roll(leather_noise, 1, 0) + np.roll(leather_noise, 1, 1)) / 3
    leather = np.stack([.82 + leather_noise * .014, .825 + leather_noise * .013, .80 + leather_noise * .014], axis=2)
    # Precisely staggered microperforations, tiled at an 80 mm repeat.
    holes = (((xx + (yy // 16 % 2) * 8) % 16 - 8) ** 2 + (yy % 16 - 8) ** 2) < 1.8
    perforated = leather.copy()
    perforated[holes] *= .53
    suede_noise = rng.normal(0, 1, (256, 256))
    suede_cloud = np.zeros_like(suede_noise)
    for shift in range(1, 9):
        suede_cloud += np.roll(np.roll(suede_noise, shift * 5, 0), shift * 3, 1)
    suede_cloud = suede_cloud / 8 + .7 * np.sin(xx * .043) * np.sin(yy * .051)
    nap = .255 + .017 * suede_noise + .027 * suede_cloud
    suede = np.stack([nap * .92, nap * .96, nap], axis=2)
    ramp = np.linspace(0, 1, 128)[None, :, None]
    glow = np.exp(-ramp * 7.5)
    door = np.tile(np.array([.82,.825,.8]) * (1-glow*.56) + np.array([.40,.005,.012])*glow*.56, (8,1,1))
    ambient = np.tile(np.array([.35,.003,.008])*glow, (8,1,1))
    return {
        'door': _save_image('roadster-cabin-door-ambient-diffuse', door, directory),
        'door_emission': _save_image('roadster-cabin-door-ambient-glow', ambient, directory),
        'carbon': _save_image('roadster-cabin-carbon-twill', carbon, directory),
        'carbon_normal': _save_image('roadster-cabin-carbon-normal', normal * .5 + .5, directory, True),
        'leather': _save_image('roadster-cabin-ivory-grain', leather, directory),
        'perforated': _save_image('roadster-cabin-ivory-perforated', perforated, directory),
        'suede': _save_image('roadster-cabin-suede-nap', suede, directory),
        'ui': _save_image('roadster-cabin-original-ui', _screen_art(), directory),
    }


def _screen_art():
    """Original 16:10 cockpit UI with a consistent orthographic side-profile diagram; all layout positions are texture pixels, not perspective geometry."""
    w, h = 1024, 640
    canvas = np.zeros((h, w, 3), dtype=np.float32)
    gy = np.linspace(0, 1, h)[:, None, None]
    canvas[:] = np.array([.022, .027, .034]) + gy * np.array([.006, .004, .004])
    def rect(x0, y0, x1, y1, color):
        """Overwrite an axis-aligned pixel rectangle in the enclosing RGB UI canvas; clip its bounds to the image."""
        canvas[max(0,int(y0)):min(h,int(y1)), max(0,int(x0)):min(w,int(x1))] = color
    def poly(points, color):
        """Rasterize a closed UI polygon from pixel XY vertices into the canvas using scanline spans; return nothing."""
        pts = np.array(points, dtype=float)
        for y in range(max(0, int(pts[:, 1].min())), min(h, int(pts[:, 1].max())+1)):
            hits = []
            for a, b in zip(pts, np.roll(pts, -1, axis=0)):
                if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                    hits.append(a[0] + (y-a[1])*(b[0]-a[0])/(b[1]-a[1]))
            hits.sort()
            for a, b in zip(hits[0::2], hits[1::2]):
                rect(a, y, b+1, y+1, color)
    def line(points, color, width=2):
        """Stroke consecutive pixel XY points into the UI canvas with a square brush of the requested pixel width."""
        for a, b in zip(points, points[1:]):
            n = max(1, int(max(abs(b[0]-a[0]), abs(b[1]-a[1]))))
            for t in np.linspace(0, 1, n+1):
                x, y = np.array(a)*(1-t)+np.array(b)*t
                rect(x-width/2, y-width/2, x+width/2+1, y+width/2+1, color)
    def ellipse(cx, cy, rx, ry, color):
        """Fill a UI ellipse whose center and radii are pixels, modifying the enclosing RGB canvas in place."""
        for y in range(max(0,int(cy-ry)), min(h,int(cy+ry+1))):
            dx = rx*sqrt(max(0, 1-((y-cy)/ry)**2))
            rect(cx-dx,y,cx+dx,y+1,color)
    def text(x,y,value,scale=2,color=(.66,.69,.71)):
        """Draw the module's original bitmap glyphs at pixel XY with integer pixel scaling and advance each character."""
        for ch in value:
            glyph = _GLYPHS.get(ch)
            if glyph:
                for j,row in enumerate(glyph):
                    for i,b in enumerate(row):
                        if b=='1': rect(x+i*scale,y+j*scale,x+(i+1)*scale,y+(j+1)*scale,color)
                x += (len(glyph[0])+2)*scale
            else:x += 4*scale
    white=(.74,.77,.80); muted=(.33,.36,.39); red=(.76,.045,.055)
    text(34,27,'ROADSTER',3,white)
    text(718,29,'82%',2,white); text(857,29,'10:24',2,white)
    rect(34,65,990,67,(.11,.12,.13))
    text(34,94,'0',10,(.86,.87,.89)); text(38,182,'KM/H',2,muted)
    text(34,243,'P',3,red); text(75,243,'R N D',2,muted)
    text(34,306,'RANGE',2,muted); text(34,338,'620 KM',3,white)
    text(34,405,'READY',2,(.38,.62,.46))
    # One orthographic profile: both wheels share a baseline and radius, and
    # every body/glazing edge belongs to that same projection. This intentionally
    # avoids a fake perspective rendering with mismatched axles or sheared panels.
    # The diagram is original status artwork, not a photographed dashboard UI.
    rect(251,93,253,479,(.10,.115,.13))
    ellipse(632,398,301,18,(.009,.012,.016))
    wheel_y=366;wheel_r=39
    for x in [440,823]:ellipse(x,wheel_y,wheel_r+4,wheel_r+4,(.007,.009,.012))
    body=[(326,348),(355,327),(423,309),(511,301),(564,254),
          (685,247),(748,270),(807,300),(878,312),(921,333),
          (931,364),(897,383),(361,383),(327,367)]
    poly(body,(.35,.38,.41))
    poly([(327,349),(449,343),(551,332),(784,332),(923,345),
          (931,364),(897,383),(361,383),(327,367)],(.20,.23,.26))
    poly([(426,311),(515,305),(559,266),(574,257),(682,252),
          (741,275),(783,302),(758,309),(540,313)],(.095,.12,.15))
    poly([(533,302),(572,263),(619,260),(619,302)],(.032,.055,.075))
    poly([(628,259),(680,257),(734,278),(770,300),(628,302)],(.022,.039,.054))
    line([(353,328),(423,312),(514,305),(564,254),(685,247),
          (748,270),(807,300),(878,312)],(.58,.62,.65),3)
    line([(547,317),(543,365),(743,365),(761,317)],(.10,.13,.16),2)
    line([(723,323),(748,323)],(.54,.58,.61),3)
    line([(337,348),(382,344)],(.83,.91,.96),4)
    line([(901,330),(920,336)],red,4)
    line([(342,370),(397,370)],(.025,.035,.045),6)
    line([(868,372),(911,365)],(.025,.035,.045),6)
    line([(486,378),(778,378)],(.08,.10,.12),5)
    # Grounded wheel silhouettes, circular spokes and consistent arch gaps.
    for x in [440,823]:
        ellipse(x,wheel_y,wheel_r+3,wheel_r+3,(.012,.016,.021))
        ellipse(x,wheel_y,wheel_r,wheel_r,(.023,.030,.039))
        ellipse(x,wheel_y,27,27,(.39,.43,.47))
        ellipse(x,wheel_y,23,23,(.048,.063,.079))
        for a in np.linspace(0,2*pi,10,endpoint=False):
            line([(x+8*cos(a),wheel_y+8*sin(a)),
                  (x+25*cos(a+.12),wheel_y+25*sin(a+.12))],(.48,.53,.57),3)
        ellipse(x,wheel_y,6,6,(.39,.44,.48))
    text(350,177,'VEHICLE STATUS',2,muted)
    text(350,212,'PARKED',3,white)
    text(370,460,'VEHICLE',2,white); text(550,460,'CHARGING',2,muted); text(760,460,'CONTROLS',2,muted)
    rect(369,482,477,485,red)
    rect(34,519,990,521,(.12,.13,.14))
    text(43,557,'21.0',3,white); text(208,561,'AUTO',2,muted)
    text(425,557,'SPORT',3,red); text(724,561,'AC',2,white); text(854,557,'21.0',3,white)
    return canvas


def build_cabin(api):
    """Build cabin geometry using the host helper dictionary; return metadata.

    Static parts are tagged by material_group for the host's existing batching.
    Steering children must be batched per material under steering_yoke, not
    into the static shell. In exported game coordinates its spin axis is local
    Z (positive rotation is clockwise viewed from the rear). The pivot has a
    identity rest orientation; child geometry is parent-local.
    """
    mesh, box, tube, beam = (api[k] for k in ('mesh','box','tube','beam'))
    extrude_xy, v, material, M, objects = (api[k] for k in ('extrude_xy','v','material','M','objects'))
    root = api.get('ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    maps = _make_maps(os.path.join(root,'art','textures'))
    first_object = len(objects)
    seat_count = int(api.get('CABIN_SEAT_COUNT', 1))
    if seat_count not in (1, 2):
        raise ValueError('CABIN_SEAT_COUNT must be 1 (Rocket) or 2 (road reference).')
    seat_sides = [-1] if seat_count == 1 else [-1, 1]
    vessel_metadata = None

    def newmat(key,name,color,metal=0,rough=.5,emission=0,texture=None,normal=None):
        """Create a Principled material, register it in M, and return it; optional original image and tangent-normal nodes remain glTF-portable."""
        M[key] = material(name,color,metal,rough,emission)
        bs = M[key].node_tree.nodes.get('Principled BSDF')
        if texture:
            node=M[key].node_tree.nodes.new('ShaderNodeTexImage'); node.name='RC_Original_BaseColor'; node.label='Original tiled material / UI'; node.image=maps[texture]
            node.interpolation='Linear'; node.extension='REPEAT'
            M[key].node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
            if emission:M[key].node_tree.links.new(node.outputs['Color'],bs.inputs['Emission Color'])
        if normal:
            tex=M[key].node_tree.nodes.new('ShaderNodeTexImage'); tex.name='RC_Twill_Normal_Image'; tex.image=maps[normal]
            n=M[key].node_tree.nodes.new('ShaderNodeNormalMap'); n.name='RC_Twill_Normal'; n.inputs['Strength'].default_value=.38
            M[key].node_tree.links.new(tex.outputs['Color'],n.inputs['Color']); M[key].node_tree.links.new(n.outputs['Normal'],bs.inputs['Normal'])
        return M[key]
    newmat('rc_carbon','RC_2x2_Twill_Carbon',(.019,.020,.022),.04,.42,texture='carbon',normal='carbon_normal')
    carbon_bs=M['rc_carbon'].node_tree.nodes.get('Principled BSDF')
    carbon_bs.inputs['Specular IOR Level'].default_value=.28
    carbon_bs.inputs['Coat Weight'].default_value=.18
    carbon_bs.inputs['Coat Roughness'].default_value=.30
    carbon_bs.inputs['Coat IOR'].default_value=1.45
    newmat('rc_ivory','RC_Ivory_Grained_Leather',(.82,.825,.8),0,.57,texture='leather')
    newmat('rc_perforated','RC_Ivory_Microperforated_Leather',(.82,.825,.8),0,.62,texture='perforated')
    newmat('rc_suede','RC_Graphite_Alcantara',(.23,.24,.25),0,.91,texture='suede')
    newmat('rc_liner','RC_Charcoal_Roof_Alcantara',(.045,.05,.06),0,.96)
    newmat('rc_black','RC_Soft_Black_Polymer',(.012,.016,.022),0,.55)
    newmat('rc_metal','RC_Satin_Control_Alloy',(.42,.46,.49),.85,.28)
    newmat('rc_stitch','RC_Ivory_Double_Stitch',(.64,.66,.63),0,.8)
    newmat('rc_red','RC_Red_Indirect_Ambient',(.62,.006,.012),.08,.38,.7)
    newmat('rc_door_ambient','RC_Ivory_With_Indirect_Red_Spill',(.82,.825,.8),0,.62,texture='door')
    em=M['rc_door_ambient'].node_tree.nodes.new('ShaderNodeTexImage');em.name='RC_Baked_Indirect_Red_Spill';em.image=maps['door_emission'];em.extension='EXTEND'
    bs=M['rc_door_ambient'].node_tree.nodes.get('Principled BSDF');M['rc_door_ambient'].node_tree.links.new(em.outputs['Color'],bs.inputs['Emission Color']);bs.inputs['Emission Strength'].default_value=.65
    newmat('rc_console_glass','RC_Dark_Console_Touch_Glass',(.006,.008,.012),0,.43)
    M['rc_console_glass'].node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.12
    newmat('rc_ui','RC_Original_Landscape_UI',(.02,.025,.03),.02,.32,.45,texture='ui')
    # User-requested separate right camera monitor, not the central tablet UI.
    newmat('right_rear_display','RC_Right_Rear_Camera',(.006,.009,.012),0,.55)
    M['right_rear_display'].use_backface_culling=True
    # Texture-space density is in repeats per metre, not object-scale guesses.
    density={'rc_carbon':16,'rc_ivory':10,'rc_perforated':12.5,'rc_suede':5}

    def closed_surface(name, front, rows, cols, mat, thickness=.015, parent=None):
        """Thicken a row-major game-space metre grid along +Z, cap its boundary, and return a registered smooth mesh under the optional parent."""
        # A grid skin with real backing and boundary returns, not a decal sheet.
        n=len(front); back=[(x,y,z+thickness) for x,y,z in front]
        faces=[]
        for j in range(rows-1):
            for i in range(cols-1):
                a=j*cols+i; faces.extend([(a,a+1,a+cols+1,a+cols),(n+a+cols,n+a+cols+1,n+a+1,n+a)])
        boundary=list(range(cols))+[j*cols+cols-1 for j in range(1,rows)]+list(range((rows-1)*cols+cols-2,(rows-1)*cols-1,-1))+[j*cols for j in range(rows-2,0,-1)]
        faces += [(a,b,b+n,a+n) for a,b in zip(boundary,boundary[1:]+boundary[:1])]
        return mesh(name,front+back,faces,mat,parent,smooth=True)

    def interp(table,t,column):
        """Interpolate one column of a station table using its ascending metre-valued first column, clamping beyond either endpoint."""
        for a,b in zip(table,table[1:]):
            if a[0] <= t <= b[0]:
                f=(t-a[0])/(b[0]-a[0]); return a[column]*(1-f)+b[column]*f
        return table[0][column] if t<table[0][0] else table[-1][column]

    def loft_back(name,cx,table,mat,ymin=None,ymax=None,pad=.025,thickness=.025,nu=24,nv=28):
        """Build and return a padded seat-back mesh from Y/half-width/center-Z metre stations; its crowned front and real backing share a closed boundary."""
        lo=table[0][0] if ymin is None else ymin; hi=table[-1][0] if ymax is None else ymax
        verts=[]
        for j in range(nv+1):
            y=lo+(hi-lo)*j/nv; width=interp(table,y,1); zz=interp(table,y,2)
            for i in range(nu+1):
                u=-1+2*i/nu
                # Concave wrap at edges plus convex upholstered center crown.
                z=zz-.080*abs(u)**3-pad*(1-u*u)*sin(pi*j/nv)**.55
                if 'Carbon_Sculpted_Shell' in name and .931<y<1.003 and abs(u)<.76:
                    z+=.046*(1-(abs(u)/.76)**4)
                verts.append((cx+u*width,y,z))
        return closed_surface(name,verts,nv+1,nu+1,mat,thickness)

    def soft_rail(name,stations,mat,n=12):
        """Loft a closed rounded rail through game-space X/Y/Z/half-width/half-height metre stations with n radial samples; return its registered mesh."""
        # Elliptic rounded loft: (x,y,z,halfwidth,halfheight), ends softly capped.
        verts=[]
        for x,y,z,w,h in stations:
            for k in range(n):
                a=2*pi*k/n; verts.append((x+w*cos(a),y+h*sin(a),z))
        faces=[tuple(reversed(range(n))),tuple((len(stations)-1)*n+k for k in range(n))]
        faces += [(j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k) for j in range(len(stations)-1) for k in range(n)]
        return mesh(name,verts,faces,mat,smooth=True)

    def rounded_rect(hw,hh,r,n=5):
        """Return a counterclockwise rounded rectangle loop in local planar units from half-extents, radius, and per-corner subdivisions."""
        pts=[]
        for cx,cy,a in [(hw-r,hh-r,0),(-hw+r,hh-r,pi/2),(-hw+r,-hh+r,pi),(hw-r,-hh+r,3*pi/2)]:
            for k in range(n+1):
                t=a+k*pi/(2*n); pts.append((cx+r*cos(t),cy+r*sin(t)))
        return pts

    def ring(name,outer,inner,transform,depth,mat,parent=None):
        """Return a closed ring with a true aperture from matched planar loops; transform maps local coordinates and extrusion depth in metres into game XYZ."""
        # Matched, clockwise ring loops with a true open center and rear return.
        n=len(outer); verts=[]
        for d,loop in [(0,outer),(0,inner),(depth,outer),(depth,inner)]:
            verts += [transform(a,b,d) for a,b in loop]
        faces=[]
        for i in range(n):
            j=(i+1)%n
            faces.extend([(i,j,n+j,n+i),(2*n+j,2*n+i,3*n+i,3*n+j),(i,2*n+i,2*n+j,j),(n+j,3*n+j,3*n+i,n+i)])
        return mesh(name,verts,faces,mat,parent,smooth=True)

    def ribbon(name,points,width,mat,axis='x',parent=None):
        """Return a parent-local game-space belt ribbon of metre width, adding and applying a 4 mm solidify modifier; axis chooses its cross-web direction."""
        verts=[]
        for p in points:
            if axis=='x': verts.extend([(p[0]-width/2,p[1],p[2]),(p[0]+width/2,p[1],p[2])])
            else:verts.extend([(p[0],p[1]-width/2,p[2]),(p[0],p[1]+width/2,p[2])])
        faces=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(points)-1)]
        ob=mesh(name,verts,faces,mat,parent)
        mod=ob.modifiers.new('Actual belt webbing thickness','SOLIDIFY');mod.thickness=.004
        bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);ob.select_set(False)
        return ob

    def label(name,text,center,size,mat,parent=None,slant=.16):
        """Create centered shallow lettering at a game-space metre position, convert the built-in font to a registered mesh, and return it with its material tag."""
        # Real shallow raised lettering, not an imported logo or photograph.
        curve=bpy.data.curves.new(name,'FONT');curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER';curve.size=size;curve.space_character=1.04;curve.shear=slant;curve.extrude=.00025;curve.resolution_u=2
        ob=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(ob);ob.location=v(center)
        ob.rotation_euler=(pi/2,0,pi);curve.materials.append(M[mat]);ob.parent=parent
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH');ob=bpy.context.object;ob.select_set(False)
        ob['material_group']=mat;objects.append(ob);return ob

    def yoke_sweep(name, points, radial, depth, mat, parent):
        """Return a smooth parent-local yoke sweep through game-XY metre points, using stable planar frames and separate radial/depth ellipse radii."""
        # Parallel frames keep the planar square yoke free of tube-frame twists.
        pts=[Vector(p) for p in points]; smooth=[]
        for i in range(len(pts)-1):
            a=pts[max(0,i-1)];b=pts[i];c=pts[i+1];d=pts[min(len(pts)-1,i+2)]
            for k in range(5):
                t=k/5; smooth.append((2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)*.5)
        smooth.append(pts[-1]);verts=[];n=14
        for i,p in enumerate(smooth):
            tangent=(smooth[min(i+1,len(smooth)-1)]-smooth[max(0,i-1)]).normalized()
            side=Vector((-tangent.y,tangent.x,0))
            for k in range(n):
                a=k*2*pi/n; q=p+side*(radial*cos(a))+Vector((0,0,depth*sin(a)));verts.append(tuple(q))
        faces=[tuple(reversed(range(n))),tuple((len(smooth)-1)*n+k for k in range(n))]+[(i*n+k,i*n+(k+1)%n,(i+1)*n+(k+1)%n,(i+1)*n+k) for i in range(len(smooth)-1) for k in range(n)]
        return mesh(name,verts,faces,mat,parent,smooth=True)

    # Floor and lower rear bulkhead: enclosed but with separate sculpted footwells.
    box('RC_Carpet_Floor',(0,.304,.12),(1.52,.052,1.78),'rc_liner',.025)
    for s in [-1,1]:
        box('RC_Fitted_Footwell_Mat',(s*.43,.337,-.20),(.49,.012,.78),'rc_black',.04)
        for k in range(9):
            tube('RC_Footwell_Mat_Rib',[(s*.43-.20+k*.05,.345,-.56),(s*.43-.20+k*.05,.345,.16)],.0016,'rc_liner',segments=4)
    # Curved double-skin bulkhead follows the low rear glass line.
    back_profile=[(-.74,.37),(-.74,.87),(-.63,.91),(-.32,.944),(.32,.944),(.63,.91),(.74,.87),(.74,.37)]
    extrude_xy('RC_Rear_Carbon_Bulkhead',back_profile,1.005,1.055,'rc_carbon',.018)
    box('RC_Bulkhead_Upper_Suede',(0,.880,1.00),(1.15,.10,.028),'rc_liner',.035)
    # Toe board closes the cabin behind the pedals instead of leaving an open void.
    # A continuous 12 mm bulkhead closes the toe-board AND the upper dash cavity.
    # The old .66 m-high toe board left a 15 mm sightline to the brake rotor.
    # This return meets the unchanged dashboard rear edge, while its closest
    # point to the front axle remains z=-.779: outside the steered tire volume.
    fw=[(-.75,.31,-.77),(.75,.31,-.77),(-.75,.66,-.67),(.75,.66,-.67),(-.75,.825,-.767),(.75,.825,-.767)]
    fv=fw+[(x,y,z-.012) for x,y,z in fw]
    ff=[(0,1,3,2),(2,3,5,4),(6,8,9,7),(8,10,11,9),
        (0,6,7,1),(4,5,11,10),(0,2,8,6),(2,4,10,8),(1,7,9,3),(3,9,11,5)]
    mesh('RC_Continuous_Firewall_Bulkhead',fv,ff,'rc_black')
    # Physical kick panels return the bulkhead into the floor and door-card noses.
    # They are structural interior surfaces, not detached occluders or glass.
    kick=[(.31,-.77),(.31,-.43),(.655,-.43),(.790,-.47),(.825,-.767),(.66,-.67)]
    for side in [-1,1]:
        kv=[(side*x,y,z) for x in [.748,.760] for y,z in kick];n=len(kick)
        kf=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh('RC_Closed_Footwell_Kick_Panel',kv,kf,'rc_liner')
    # Individual molded bucket seats, reclined instead of flat upright slabs.
    seat_profile=[(.415,.195,.470),(.48,.205,.500),(.59,.175,.550),(.72,.180,.610),(.84,.235,.665),(.89,.248,.695),(.94,.188,.729),(.995,.125,.765),(1.08,.116,.800),(1.145,.085,.824),(1.162,.055,.830)]
    front_profile=[(.440,.174,.449),(.50,.181,.476),(.60,.152,.530),(.73,.160,.585),(.84,.215,.640),(.89,.222,.670),(.936,.154,.708)]
    for s in seat_sides:
        cx=s*.43; suffix='L' if s<0 else 'R'
        loft_back('RC_Seat_'+suffix+'_Carbon_Sculpted_Shell',cx,seat_profile,'rc_carbon',pad=.007,thickness=.027,nu=26,nv=40)
        loft_back('RC_Seat_'+suffix+'_Perforated_Back',cx,front_profile,'rc_perforated',pad=.030,thickness=.021,nu=24,nv=28)
        # Upper headrest is a padded separate cap, with a recessed trapezoid below.
        head_profile=[(.994,.103,.735),(1.02,.111,.750),(1.09,.100,.778),(1.14,.071,.794),(1.15,.041,.801)]
        loft_back('RC_Seat_'+suffix+'_Integrated_Headrest',cx,head_profile,'rc_ivory',pad=.021,thickness=.026,nu=18,nv=20)
        # Pale molded shoulder struts visibly connect the headrest around its inset.
        for a in [-1,1]:
            vv=[(cx+a*.153,.934,.710),(cx+a*.126,.941,.727),(cx+a*.100,.994,.747),(cx+a*.113,1.008,.744)]
            vv += [(x,y,z+.018) for x,y,z in vv]
            mesh('RC_Seat_'+suffix+'_Ivory_Headrest_Strut',vv,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'rc_ivory',bevel=.004,smooth=True)
        outer=[(-.120,.940),(.120,.940),(.101,.995),(-.101,.995)]
        inner=[(-.102,.948),(.102,.948),(.088,.986),(-.088,.986)]
        ring('RC_Seat_'+suffix+'_Harness_Aperture_Bezel',outer,inner,lambda x,y,d:(cx+x,y,.735+(y-.94)*.48+d),.026,'rc_ivory')
        plaque=[(cx-.102,.947),(cx+.102,.947),(cx+.088,.986),(cx-.088,.986)]
        pv=[(x,y,.740+(y-.94)*.48+d) for d in [0,.009] for x,y in plaque]
        mesh('RC_Seat_'+suffix+'_Recessed_Roadster_Inset',pv,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'rc_black',bevel=.002)
        label('RC_Seat_'+suffix+'_ROADSTER','ROADSTER',(cx,.965,.748),.022,'rc_red')
        # Actual tapered kidney bolsters, with suede central panels and white seam.
        for a in [-1,1]:
            t=[(.49,.167,.474,.034,.027),(.55,.182,.491,.042,.044),(.66,.187,.535,.052,.061),(.76,.199,.577,.052,.066),(.825,.217,.615,.041,.044),(.855,.224,.636,.023,.018)]
            verts=[]
            for y,xx,z,w,dep in t:
                for k in range(16):
                    ang=k*2*pi/16;verts.append((cx+a*(xx+w*cos(ang)),y,z+dep*sin(ang)))
            faces=[tuple(reversed(range(16))),tuple((len(t)-1)*16+k for k in range(16))]+[(j*16+k,j*16+(k+1)%16,(j+1)*16+(k+1)%16,(j+1)*16+k) for j in range(len(t)-1) for k in range(16)]
            mesh('RC_Seat_'+suffix+'_Suede_Kidney_Bolster',verts,faces,'rc_suede',smooth=True)
            tube('RC_Seat_'+suffix+'_Back_Double_Seam',[(cx+a*(xx-w*.68),y,z-dep*.72-.001) for y,xx,z,w,dep in t],.0013,'rc_stitch',segments=5)
            tube('RC_Seat_'+suffix+'_Shell_Edge_Piping',[(cx+a*interp(seat_profile,y,1),y,interp(seat_profile,y,2)-.079) for y in np.linspace(.44,1.15,40)],.0023,'rc_black',segments=6)
        # Full deep seat pan: rounded front waterfall and upturned lateral wings.
        verts=[]; rows=25; cols=27
        for j in range(rows):
            t=j/(rows-1);z=-.145+t*.64
            for i in range(cols):
                u=-1+2*i/(cols-1);x=cx+u*(.197+.017*sin(pi*t))
                y=.411+.014*cos(pi*t)+.050*abs(u)**3-.019*sin(pi*t)*(1-u*u)
                verts.append((x,y,z))
        # Cushion backing along Y, unlike the predominantly vertical back pads.
        n=len(verts);vs=verts+[(x,y-.047,z) for x,y,z in verts];fs=[]
        for j in range(rows-1):
            for i in range(cols-1):
                q=j*cols+i;fs += [(q,q+cols,q+cols+1,q+1),(n+q+1,n+q+cols+1,n+q+cols,n+q)]
        boundary=list(range(cols))+[j*cols+cols-1 for j in range(1,rows)]+list(range((rows-1)*cols+cols-2,(rows-1)*cols-1,-1))+[j*cols for j in range(rows-2,0,-1)]
        fs += [(a,b,b+n,a+n) for a,b in zip(boundary,boundary[1:]+boundary[:1])]
        mesh('RC_Seat_'+suffix+'_Sculpted_Cushion',vs,fs,'rc_perforated',smooth=True)
        soft_rail('RC_Seat_'+suffix+'_Carbon_Base_Pan',[(cx,.365,-.13,.17,.015),(cx,.359,-.09,.22,.028),(cx,.350,.30,.225,.027),(cx,.365,.49,.19,.028)],'rc_carbon',20)
        for a in [-1,1]:
            stations=[(cx+a*.193,.447,-.14,.021,.018),(cx+a*.213,.474,-.06,.044,.045),(cx+a*.229,.493,.14,.045,.055),(cx+a*.222,.486,.34,.045,.050),(cx+a*.195,.455,.49,.030,.027)]
            soft_rail('RC_Seat_'+suffix+'_Ivory_Thigh_Bolster',stations,'rc_ivory',16)
            tube('RC_Seat_'+suffix+'_Cushion_Stitch',[(x-a*w*.65,y+h*.72,z) for x,y,z,w,h in stations],.00125,'rc_stitch',segments=5)
        # Slender sculpted white elbow pads, distinct from the black center spine.
        stations=[(s*.176,.546,-.015,.044,.020),(s*.174,.584,.05,.054,.028),(s*.176,.610,.27,.055,.034),(s*.181,.607,.52,.054,.034),(s*.192,.564,.71,.041,.020)]
        soft_rail('RC_Seat_'+suffix+'_Floating_Inner_Armrest',stations,'rc_ivory',20)
        mesh('RC_Seat_'+suffix+'_Suede_Armrest_Inner_Web',[(s*.19,.55,.02),(s*.19,.575,.48),(s*.20,.49,.65),(s*.20,.424,.42),(s*.19,.425,.05)],[(0,1,2,3,4)],'rc_suede')
        # Flat seatbelt webbing follows outboard trim; no tube pretending to be belt.
        ribbon('RC_Seat_'+suffix+'_Three_Point_Belt',[(cx+s*.16,1.038,.780),(cx+s*.225,.85,.705),(cx+s*.239,.68,.625),(cx+s*.225,.49,.44)],.034,'rc_black')
        box('RC_Seat_'+suffix+'_Upper_Belt_Anchor',(cx+s*.16,1.038,.781),(.049,.024,.017),'rc_black',.006)
        bx=cx-s*.205
        box('RC_Seat_'+suffix+'_Buckle_Housing',(bx,.465,.345),(.043,.062,.073),'rc_black',.013)
        box('RC_Seat_'+suffix+'_Red_Buckle_Release',(bx,.494,.330),(.028,.012,.037),'red',.004)
        box('RC_Seat_'+suffix+'_Belt_Tongue',(cx+s*.227,.66,.602),(.046,.057,.008),'rc_metal',.006)
        box('RC_Seat_'+suffix+'_Belt_Tongue_Opening',(cx+s*.227,.665,.596),(.025,.026,.005),'rc_black',.004)
        # Rail sliders and fore/aft release are partly visible beside the seat pan.
        for a in [-1,1]:beam('RC_Seat_Runner',(cx+a*.135,.328,-.09),(cx+a*.135,.328,.50),.027,.022,'rc_metal')

    # Narrow floating carbon spine below a tilted phone/console pad, not a block.
    spine=[(-.075,.34),(-.096,.46),(-.080,.56),(.080,.56),(.096,.46),(.075,.34)]
    extrude_xy('RC_Narrow_Center_Spine',spine,-.34,.90,'rc_carbon',.015)
    soft_rail('RC_Center_Storage_Lid',[(0,.552,.30,.080,.012),(0,.56,.38,.085,.018),(0,.56,.72,.085,.018),(0,.535,.84,.06,.01)],'rc_black',16)
    # Tilted polished bezel physically cantilevered off the center spine.
    console_transform=lambda x,t,d:(x,.596-t*.44+d,-.14+t)
    outer=rounded_rect(.083,.154,.018,6); inner=rounded_rect(.069,.138,.012,6)
    ring('RC_Floating_Console_Alloy_Bezel',outer,inner,console_transform,-.025,'rc_metal')
    ring('RC_Floating_Console_Carbon_Return',rounded_rect(.091,.162,.022,6),outer,lambda x,t,d:console_transform(x,t,d-.012),-.025,'rc_carbon')
    pv=[console_transform(x,t,.001) for x,t in inner]
    mesh('RC_Console_Glass',pv,[tuple(range(len(pv)))],'rc_console_glass')
    # Secondary controls remain real geometry, on a much smaller portrait display.
    for j in range(4):
        y=.596-(-.095+j*.055)*.44+.004; z=-.14-.095+j*.055
        box('RC_Console_Touch_Control',(0,y,z),(.095,.0018,.002),'rc_metal',.0006)
    tube('RC_Console_Drive_Accent',[console_transform(-.049,.103,.004),console_transform(.049,.103,.004)],.0016,'rc_red',segments=5)

    # Inset doors: substantial ivory frame, black pocket, red indirect contour.
    for s in [-1,1]:
        x=s*.785
        outer=[(-.62,.40),(-.63,.76),(-.40,.805),(.66,.805),(.91,.63),(.82,.42)]
        vv=[(x+d*s,y,z) for d in [0,.025] for z,y in outer];n=len(outer)
        ff=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh('RC_Door_Inner_Carbon_Shell',vv,ff,'rc_carbon',bevel=.014)
        # Ring points are in (Z,Y), intentionally asymmetrical to match the photo.
        o=[(-.575,.555),(-.59,.65),(-.49,.748),(.57,.765),(.77,.668),(.61,.545)]
        inn=[(-.415,.570),(-.428,.633),(-.345,.690),(.535,.719),(.623,.660),(.515,.591)]
        arc=ring('RC_Door_Sculpted_Ivory_Arc',o,inn,lambda z,y,d:(x-s*(.013+d),y,z),.022,'rc_door_ambient')
        uv=arc.data.uv_layers.new(name='RC_Indirect_Ambient_Gradient')
        for face in arc.data.polygons:
            for li in face.loop_indices:
                vi=arc.data.loops[li].vertex_index; uv.data[li].uv=(1.0 if (vi//len(o)) in (0,2) else 0.0,.5)
        mesh('RC_Door_Recessed_Suede_Insert',[(x-s*.009,y,z) for z,y in inn],[tuple(range(len(inn)))],'rc_black')
        # A broad dark red diffuser and narrow bright lip produce restrained glow.
        redpath=[(-.414,.579),(-.429,.625),(-.398,.663),(-.346,.696),(-.10,.706),(.17,.714),(.42,.722),(.535,.725),(.602,.686)]
        tube('RC_Door_Ambient_Red_Diffuser',[(x-s*.037,y,z) for z,y in redpath],.0030,'red',segments=8)
        tube('RC_Door_Ambient_Red_Light',[(x-s*.044,y+.002,z) for z,y in redpath],.0014,'rc_red',segments=6)
        tube('RC_Door_Lower_Red_Return',[(x-s*.038,.574,-.36),(x-s*.038,.574,.34),(x-s*.038,.596,.53)],.0020,'rc_red',segments=6)
        soft_rail('RC_Door_Padded_Armrest',[(s*.735,.504,-.36,.023,.016),(s*.730,.516,-.24,.037,.023),(s*.733,.521,.35,.043,.026),(s*.750,.542,.56,.023,.012)],'rc_liner',16)
        tube('RC_Door_Carbon_Window_Ledge',[(s*.786,.782,-.56),(s*.777,.790,.15),(s*.756,.792,.72)],.018,'rc_carbon',segments=10)
        # Recessed pocket with a slim pull handle and tactile release switch.
        box('RC_Door_Pull_Recess',(s*.746,.639,-.329),(.023,.053,.147),'rc_black',.014)
        beam('RC_Door_Alloy_Pull',(s*.731,.638,-.385),(s*.731,.638,-.285),.012,.013,'rc_metal')
        box('RC_Door_Window_Switch',(s*.710,.540,-.13),(.032,.008,.055),'rc_black',.004)

    # Dashboard top is sculpted around a wide open instrument binnacle notch.
    stations=[(-.76,.786,-.426),(-.65,.797,-.435),(-.59,.804,-.478),(-.52,.812,-.513),(-.34,.812,-.513),(-.25,.798,-.458),(-.18,.786,-.411),(.25,.786,-.406),(.62,.799,-.440),(.76,.783,-.465)]
    verts=[]
    for x,y,z in stations:
        verts += [(x,.825,-.767),(x,.830,-.686),(x,y+.018,z-.045),(x,y,z),(x,y-.031,z-.014)]
    faces=[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(len(stations)-1) for j in range(4)]
    mesh('RC_Dash_Sculpted_Alcantara_Upper',verts,faces,'rc_liner',smooth=True)
    tube('RC_Dash_Upper_Carbon_Piping',[(x,y+.003,z) for x,y,z in stations],.0080,'rc_carbon',segments=8)
    tube('RC_Dash_Silver_Instrument_Surround',[(x,y+.006,z+.006) for x,y,z in stations[:7]],.0035,'rc_metal',segments=6)
    # Carbon lower blade has depth and a horizontal full-width vent slot above it.
    fascia=[(-.755,.755,-.454),(-.22,.756,-.407),(.23,.756,-.407),(.76,.755,-.464),(.71,.629,-.526),(.23,.663,-.489),(-.22,.663,-.489),(-.71,.629,-.516)]
    mesh('RC_Dash_Lower_Carbon_Blade',fascia,[(0,1,6,7),(1,2,5,6),(2,3,4,5)],'rc_carbon')
    for xa,xb,z in [(-.745,-.24,-.436),(.255,.744,-.443)]:
        box('RC_Dash_Recessed_Air_Vent',((xa+xb)/2,.745,z),((xb-xa),.040,.018),'rc_black',.009)
        for k in range(3):
            beam('RC_Dash_Vent_Horizontal_Louver',(xa+.014,.733+k*.010,z+.012),(xb-.014,.733+k*.010,z+.012),.004,.003,'rc_carbon')
        beam('RC_Dash_Vent_Alloy_Line',(xa+.015,.765,z+.012),(xb-.015,.765,z+.012),.0025,.0025,'rc_metal')
    # Functional-looking footwell pedals with transverse rubber grip ribs.
    for xx,w in [(-.49,.078),(-.345,.045)]:
        ob=box('RC_Pedal_Brushed_Alloy',(xx,.397,-.637),(w,.114,.025),'rc_metal',.008)
        for k in range(6):box('RC_Pedal_Rubber_Grip',(xx,.351+k*.018,-.619),(w*.76,.004,.006),'rc_black',.001)
        beam('RC_Pedal_Lever',(xx,.440,-.651),(xx,.490,-.704),.019,.020,'rc_black')
    box('RC_Driver_Dead_Pedal',(-.665,.390,-.601),(.07,.13,.026),'rc_carbon',.008)

    # Steering column fixed shroud and local, animatable closed-square yoke.
    tube('RC_Steering_Column_Lower',[(-.43,.681,-.558),(-.43,.730,-.405),(-.43,.779,-.252)],.054,'rc_black',segments=20)
    tube('RC_Steering_Column_Carbon_Collar',[(-.43,.747,-.352),(-.43,.779,-.252)],.061,'rc_carbon',segments=20)
    pivot=bpy.data.objects.new('steering_yoke',None);bpy.context.collection.objects.link(pivot);pivot.location=v((-.43,.795,-.205));pivot.empty_display_size=.055
    pivot['animation_role']='player_steering_yoke';pivot['game_local_spin_axis']='Z';pivot['preserve_rest_quaternion']=True
    def local_poly(name,poly,z0,z1,mat,bevel=.003):
        """Extrude a metre-valued game-XY polygon between local Z planes under steering_yoke and return the tagged control mesh."""
        return extrude_xy(name,poly,z0,z1,mat,bevel,pivot)
    hub=[(-.075,.065),(-.056,.084),(.057,.084),(.078,.061),(.065,-.066),(.045,-.087),(-.046,-.087),(-.064,-.063)]
    local_poly('RC_Yoke_Sculpted_Central_Hub',hub,-.040,.022,'rc_black',.013)
    local_poly('RC_Yoke_Leather_Airbag_Pad',[(x*.88,y*.89) for x,y in hub],.018,.030,'rc_liner',.009)
    for s in [-1,1]:
        path=[(s*.069,.099,0),(s*.117,.123,0),(s*.170,.127,0),(s*.194,.111,0),(s*.205,.083,0),(s*.209,.025,0),(s*.208,-.049,0),(s*.194,-.091,0),(s*.164,-.112,0),(s*.101,-.113,0),(s*.070,-.090,0)]
        # Squared perimeter has flat long sides, restrained corner radii, an open center.
        yoke_sweep('RC_Yoke_Closed_Squared_Carbon_Frame',path,.023,.019,'rc_carbon',pivot)
        grip=path[2:10]
        yoke_sweep('RC_Yoke_Ivory_Outer_Grip',[(x+s*.014,y,z+.003) for x,y,z in grip],.012,.019,'rc_ivory',pivot)
        yoke_sweep('RC_Yoke_Grip_Inner_Black_Seam',[(x+s*.002,y,z+.022) for x,y,z in grip],.0012,.0012,'rc_black',pivot)
        top=[(s*.064,.042),(s*.088,.089),(s*.165,.106),(s*.156,.059)]
        lower=[(s*.061,-.018),(s*.160,-.058),(s*.144,-.088),(s*.064,-.061)]
        local_poly('RC_Yoke_Upper_Alloy_Spoke',top,-.007,.014,'rc_metal',.004)
        local_poly('RC_Yoke_Lower_Alloy_Spoke',lower,-.011,.012,'rc_metal',.004)
        inset=[(s*.073,.046),(s*.094,.082),(s*.156,.097),(s*.150,.061)]
        local_poly('RC_Yoke_Control_Pad',inset,.015,.021,'rc_black',.002)
        # A real recessed thumb roller plus separate touch pads on the lower spoke.
        tube('RC_Yoke_Thumb_Roller',[(s*.107,.064,.028),(s*.133,.073,.028)],.005,'rc_metal',pivot,segments=10)
        for k in range(5):
            a=.108+k*.005;box('RC_Yoke_Roller_Knurl',(s*a,.064+(a-.107)*.346,.029),(.0015,.009,.008),'rc_black',.0005,pivot)
        local_poly('RC_Yoke_Lower_Control_Pad',[(s*.068,-.025),(s*.153,-.059),(s*.139,-.080),(s*.068,-.059)],.014,.019,'rc_black',.002)
        for k in range(2):
            box('RC_Yoke_Control_Marker',(s*(.102+k*.022),-.048-k*.009,.022),(.007,.002,.002),'rc_metal',.0005,pivot)
        # Broad rear paddles remain separate objects under the steering pivot.
        local_poly('RC_Yoke_Rear_Paddle',[(s*.095,.065),(s*.135,.074),(s*.153,-.063),(s*.113,-.075)],-.044,-.036,'rc_metal',.006)
    # The reference's dark top/bottom bridges close the squared perimeter.
    tube('RC_Yoke_Dark_Upper_Bridge',[(-.071,.100,-.006),(-.040,.091,-.006),(.040,.091,-.006),(.071,.100,-.006)],.012,'rc_black',pivot,segments=10)
    tube('RC_Yoke_Dark_Lower_Bridge',[(-.075,-.091,-.005),(-.038,-.104,-.005),(.038,-.104,-.005),(.075,-.091,-.005)],.012,'rc_carbon',pivot,segments=10)
    # Subtle embossed center mark, not a giant painted decal.
    local_poly('RC_Yoke_Center_Top_Mark',[(-.016,.014),(.016,.014),(.011,.009),(-.011,.009)],.031,.032,'rc_black',.0005)
    local_poly('RC_Yoke_Center_Stem_Mark',[(-.003,.010),(.003,.010),(.002,-.012),(-.002,-.012)],.031,.032,'rc_black',.0004)

    # Driver-readable floating display, revised for the single-seat/vessel bay.
    # The old 1.72:1 face stretched a 16:10 UI and its low right-hand placement
    # lost usable pixels behind the vessel. Use a true rigid plane, zero roll,
    # exact texture aspect and a clear sight corridor above the yoke/right grip.
    # Zero yaw aligns its top edge with the dash; a small true rake faces up
    # toward the driver without shearing the image or intersecting the mirror.
    yaw=0.0;rake=math.radians(7)
    screen_c=Vector((.040,.925,-.300))
    screen_right=Vector((cos(yaw),0,-sin(yaw)))
    screen_up=Vector((-sin(yaw)*sin(rake),cos(rake),-cos(yaw)*sin(rake)))
    screen_normal=screen_right.cross(screen_up).normalized()
    def display_transform(x,y,d):
        """Return game XYZ metres for orthonormal screen-local horizontal, vertical and normal-depth coordinates; preserves lengths, right angles and the 16:10 UI aspect."""
        return tuple(screen_c+screen_right*x+screen_up*y+screen_normal*d)
    outer=rounded_rect(.186,.120,.011,7);inner=rounded_rect(.1775,.1115,.005,7)
    ring('RC_Landscape_Tablet_Carbon_Housing',outer,inner,display_transform,-.020,'rc_black')
    ring('RC_Landscape_Tablet_Satin_Edge',rounded_rect(.187,.121,.011,7),outer,lambda x,y,d:display_transform(x,y,d-.005),-.003,'rc_metal')
    back=[display_transform(x,y,-.021) for x,y in outer]
    mesh('RC_Tablet_Closed_Back',back,[tuple(range(len(back)))],'rc_carbon')
    # Exact 352 x 220 mm active area maps the complete 1024 x 640 texture once.
    pts=[display_transform(-.176,-.110,.001),display_transform(.176,-.110,.001),
         display_transform(.176,.110,.001),display_transform(-.176,.110,.001)]
    screen=mesh('RC_Original_Infotainment_Display',pts,[(0,1,2,3)],'rc_ui')
    screen['display_role']='driver_readable_main_ui'
    screen['active_aspect_ratio']=1.6
    screen['orthonormal_plane']=True
    uv=screen.data.uv_layers.new(name='RC_UI_UV')
    for loop,co in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
    # Broad short deck mount touches the actual dash and the housing rear, rather
    # than leaving a floating plate or a stalk pointed at the obsolete position.
    box('RC_Tablet_Dash_Mount_Foot',(.040,.789,-.403),(.108,.012,.052),'rc_black',.007)
    beam('RC_Tablet_Cantilever_Mount',(.040,.795,-.407),display_transform(0,-.074,-.024),.066,.027,'rc_black')
    beam('RC_Tablet_Mount_Rear_Brace',display_transform(-.056,-.074,-.023),display_transform(.056,-.074,-.023),.018,.013,'rc_black')
    display_metadata={
        'center_game_m':list(screen_c),'right_game':list(screen_right),
        'up_game':list(screen_up),'normal_game':list(screen_normal),
        'active_dimensions_m':[.352,.220],'texture_dimensions_px':[1024,640],
        'yaw_degrees':0,'rake_degrees':7,'roll_degrees':0,
        'reference_eye_game_m':[-.43,1.04,.33],
        'tested_eye_box_min_game_m':[-.48,1.00,.25],
        'tested_eye_box_max_game_m':[-.32,1.08,.40],
        'visibility_eye_grid':[5,5,5],'visibility_screen_grid':[9,7],
        'inspection_eye_game_m':[-.32,1.08,.35],
        'visibility_probe_count_per_steering_pose':7938,
        'visibility_steering_angles_radians':[-1.2,0,1.2],
        'visibility_probe_count':23814,
        'ui_artwork':'Original orthographic side-profile status graphic; no factory software or live telemetry claim.'
    }

    # Original game addition requested by the user: a separate small right-side
    # rear-camera monitor. Its actual surface faces the fixed authored driver eye.
    # The central tablet, passenger vessel and exterior right pod stay unchanged.
    rear_c=Vector((.600,1.040,-.540))
    rear_eye=Vector((-.43,1.04,.33))
    rear_n=(rear_eye-rear_c).normalized()
    rear_r=Vector((rear_n.z,0,-rear_n.x)).normalized()
    rear_u=rear_n.cross(rear_r).normalized()
    def rear_display_transform(x,y,d):
        """Map the independent right monitor's orthonormal plane into game metres."""
        return tuple(rear_c+rear_r*x+rear_u*y+rear_n*d)
    rear_outer=rounded_rect(.095,.051,.004,5)
    rear_inner=rounded_rect(.0905,.0455,.0005,5)
    ring('RC_Right_Rear_Display_Bezel',rear_outer,rear_inner,
         rear_display_transform,-.007,'rc_black')
    rear_back=[rear_display_transform(x,y,-.007) for x,y in rear_outer]
    mesh('RC_Right_Rear_Display_Closed_Back',rear_back,
         [tuple(reversed(range(len(rear_back))))],'rc_black')
    rear_pts=[rear_display_transform(x,y,.0008)
              for x,y in [(-.090,-.045),(.090,-.045),(.090,.045),(-.090,.045)]]
    rear_screen=mesh('RC_Right_Rear_Camera_Active_Display',rear_pts,
                     [(0,1,2,3)],'right_rear_display')
    rear_screen['authored_normals']=True
    rear_screen.data.normals_split_custom_set([tuple(v(rear_n))]*4)
    rear_screen['rightRearDisplay']={
        'point':list(rear_c+rear_n*.0008),'normal':list(rear_n),
        'right':list(rear_r),'up':list(rear_u),'active_dimensions_m':[.180,.090],
        'reference_eye_game_m':list(rear_eye),'uv_origin':'top_left_in_gltf',
        'purpose':'Original user-requested right rear-camera display; not factory placement evidence'
    }
    rear_screen['display_role']='separate_right_rear_camera'
    rear_screen['active_aspect_ratio']=2.0
    uv=rear_screen.data.uv_layers.new(name='RC_Right_Rear_Camera_UV')
    for loop,co in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=co
    # A short physical bracket joins the BACK of the screen to the unchanged
    # right A-pillar centerline. Both endpoints overlap their supported parts.
    t=.70
    pillar_anchor=Vector((.775,.836,-1.180))*(1-t)**2+Vector((.718,1.035,-.735))*2*t*(1-t)+Vector((.653,1.176,-.293))*t*t
    beam('RC_Right_Rear_Display_A_Pillar_Bracket',tuple(pillar_anchor),
         rear_display_transform(.066,.031,-.006),.012,.010,'rc_black')
    # Real shallow, original bezel lettering; no canvas or central-UI overlay.
    name='RC_Right_Rear_Display_Label'
    curve=bpy.data.curves.new(name,'FONT');curve.body='RIGHT REAR';curve.align_x='CENTER';curve.align_y='CENTER'
    curve.size=.0032;curve.extrude=.00010;curve.resolution_u=2
    rear_label=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(rear_label)
    curve.materials.append(M['rc_metal'])
    bpy.ops.object.select_all(action='DESELECT');rear_label.select_set(True);bpy.context.view_layer.objects.active=rear_label
    bpy.ops.object.convert(target='MESH');rear_label=bpy.context.object;rear_label.select_set(False)
    for vertex in rear_label.data.vertices:
        p=vertex.co.copy();vertex.co=v(rear_display_transform(p.x,p.y-.0482,p.z+.0003))
    rear_label['material_group']='rc_metal';objects.append(rear_label)

    # The longer profile-matched windshield has a real closed interior cowl
    # between its base and the unchanged dashboard, not an empty gap.
    cowl=[]
    for z,y in [(-1.187,.842),(-1.030,.839),(-.865,.832),(-.767,.825)]:
        cowl.extend([(x,y+.004*(1-(x/.775)**2),z) for x in np.linspace(-.775,.775,17)])
    cfaces=[(j*17+i,j*17+i+1,(j+1)*17+i+1,(j+1)*17+i) for j in range(3) for i in range(16)]
    mesh('RC_Windshield_Closed_Cowl_Return',cowl,cfaces,'rc_liner',smooth=True)
    tube('RC_Windshield_Base_Inner_Seal',[(-.773,.842,-1.182),(0,.848,-1.182),(.773,.842,-1.182)],.006,'rc_black',segments=8)

    # Dark suede roof liner is an OPEN ring, not an opaque ceiling over the glass.
    roof_outer=rounded_rect(.686,.550,.102,10);roof_inner=rounded_rect(.532,.365,.091,10)
    def roof_transform(x,z,d):
        """Map roof-local X/Z and vertical depth metres to the extended canopy's bowed game-space liner surface; return one XYZ point."""
        z+=.245;u=max(0,min(1,(z+.305)/1.10));return (x,1.175+.026*max(0,1-(x/.686)**2)+.007*sin(pi*u)+d,z)
    ring('RC_Roof_Liner_With_True_Aperture',roof_outer,roof_inner,roof_transform,-.026,'rc_liner')
    rr=[roof_transform(x,z,-.030) for x,z in roof_inner];tube('RC_Roof_Aperture_Inset_Bezel',rr+[rr[0]],.006,'rc_black',segments=8)
    for s in [-1,1]:
        pillar=[]
        for t in np.linspace(0,1,25):
            a=Vector((s*.775,.836,-1.180));b=Vector((s*.718,1.035,-.735));c=Vector((s*.653,1.176,-.293))
            pillar.append(tuple(a*(1-t)**2+b*2*t*(1-t)+c*t*t))
        tube('RC_Windshield_Inner_A_Pillar',pillar,.023,'rc_liner',segments=12)
        tube('RC_Roof_Inner_Side_Rail',[(s*.653,1.176,-.293),(s*.661,1.184,.25),(s*.665,1.176,.795)],.023,'rc_liner',segments=12)
        box('RC_Recessed_Sunvisor',(s*.343,1.165,-.245),(.435,.028,.171),'rc_black',.028)
        box('RC_Sunvisor_Suede_Inset',(s*.343,1.148,-.247),(.376,.006,.126),'rc_liner',.018)
        box('RC_Sunvisor_Small_Handle',(s*.343,1.142,-.191),(.090,.005,.013),'rc_black',.003)
    box('RC_Overhead_Center_Console',(0,1.171,-.228),(.142,.035,.20),'rc_liner',.018)
    box('RC_Overhead_Recessed_Control',(0,1.149,-.226),(.045,.005,.049),'rc_black',.004)
    # Compact faceted interior mirror, mounted beneath the front header.
    beam('RC_Rearview_Mirror_Stem',(0,1.165,-.320),(0,1.091,-.469),.026,.024,'rc_black')
    # The user's functional mirror request requires a physically aimed pane,
    # not a fixed rear-camera image. Aim the existing small bezel toward the
    # driver and a clear rear-glazing sightline; this is reconstructed mounting,
    # not a claim of factory placement. Its stem and all dashboard parts stay.
    mirror_origin=Vector((-.00022,1.04328,-.4892))
    mirror_center=mirror_origin+Vector((0,.025,0))
    # Aim the reflected center ray level through the rear glazing rather than
    # upward into sky above following traffic. Pane, bezel and rear bracket
    # share this physical rotation; the accepted 25 mm lift stays unchanged.
    mirror_normal=((Vector((-.43,1.04,.33))-mirror_center).normalized()+Vector((0,0,1))).normalized()
    mirror_rotation=Vector((0,0,1)).rotation_difference(mirror_normal)
    def mirror_transform(point):
        """Rotate the existing mirror assembly about its reflective face center."""
        return tuple(mirror_center+mirror_rotation@(Vector(point)-mirror_origin))
    for s in [-1,1]:beam('RC_Rearview_Triangular_Bracket',(0,1.115,-.431),mirror_transform((s*.083,1.047,-.515)),.009,.008,'rc_metal')
    mirror=[(-.118,1.064),(.118,1.064),(.094,1.022),(-.095,1.022)]
    bezel=extrude_xy('RC_Faceted_Rearview_Mirror',mirror,-.517,-.490,'rc_black',.004)
    for vertex in bezel.data.vertices:
        q=vertex.co;point=mirror_transform((q.x,q.z,-q.y));vertex.co=Vector((point[0],-point[2],point[1]))
    points=[mirror_transform((x*.88,(y-1.044)*.72+1.044,-.4892)) for x,y in mirror]
    api['mirror_pane']('center',points,mirror_normal)

    # Bring tall seat portions forward beneath the actual descending rear glazing.
    # The confirmed one-seat Rocket packaging remains a reconstruction, not an
    # unsupported claim that the two-seat reference establishes its exact location.
    for ob in objects[first_object:]:
        if ob.name.startswith('RC_Seat_'):
            if '_ROADSTER' in ob.name:
                ob.location.y += .174*min(1.0,max(0.0,(ob.location.z-.48)/.54))
                continue
            for vt in ob.data.vertices:
                y=vt.co.z
                if y>.48:
                    amount=min(1.0,(y-.48)/.54)
                    vt.co.y += .174*amount
    # Hagerty's original interview description establishes an additional nominal
    # 400 L vessel in the Rocket passenger-seat space. Its visible shape, supports,
    # dimensions and hose routing below are ORIGINAL APPROXIMATE PACKAGING, not
    # factory CAD or certified pressure-vessel engineering. Nominal source capacity
    # is deliberately separate from the measured closed outer mesh volume.
    if seat_count == 1:
        vessel_first=len(objects)
        vcx,vcy=.405,.765
        radius=.325
        cylinder_front,cylinder_back=-.080,.780
        dome_length=.200
        radial_segments=56
        # Circular barrel with smooth ellipsoidal end domes and unique pole verts.
        profile=[]
        for k in range(1,9):
            a=(pi/2)*k/8
            profile.append((cylinder_front-dome_length*cos(a),radius*sin(a)))
        profile.append((cylinder_back,radius))
        for k in range(1,8):
            a=(pi/2)*k/8
            profile.append((cylinder_back+dome_length*sin(a),radius*cos(a)))
        vv=[(vcx,vcy,cylinder_front-dome_length)]
        for z,r in profile:
            vv.extend((vcx+r*cos(2*pi*k/radial_segments),vcy+r*sin(2*pi*k/radial_segments),z) for k in range(radial_segments))
        rear_pole=len(vv);vv.append((vcx,vcy,cylinder_back+dome_length))
        vf=[(0,1+(k+1)%radial_segments,1+k) for k in range(radial_segments)]
        for j in range(len(profile)-1):
            a=1+j*radial_segments;b=a+radial_segments
            vf.extend((a+k,a+(k+1)%radial_segments,b+(k+1)%radial_segments,b+k) for k in range(radial_segments))
        last=1+(len(profile)-1)*radial_segments
        vf.extend((last+k,last+(k+1)%radial_segments,rear_pole) for k in range(radial_segments))
        vessel=mesh('RC_Rocket_Passenger_Vessel_Approximate',vv,vf,'rc_carbon',smooth=True)
        # Volume is computed from this actual triangulated outer mesh, not a box
        # or asserted internal capacity. Authored game units are metres before
        # the exporter applies its final uniform 4.7 m vehicle normalization.
        volume=0.0
        for face in vf:
            a=Vector(vv[face[0]])
            for k in range(1,len(face)-1):
                volume+=a.dot(Vector(vv[face[k]]).cross(Vector(vv[face[k+1]])))/6
        volume=abs(volume)
        vessel['measured_outer_mesh_volume_m3']=volume
        vessel['source_nominal_capacity_liters']=400
        vessel['uv_already_authored']=True
        uv=vessel.data.uv_layers.new(name='RC_Vessel_Continuous_Twill_UV')
        circumference=2*pi*radius
        for face in vessel.data.polygons:
            angles=[]
            for li in face.loop_indices:
                vi=vessel.data.loops[li].vertex_index
                angles.append(None if vi in (0,rear_pole) else ((vi-1)%radial_segments)/radial_segments)
            known=[a for a in angles if a is not None]
            seam=bool(known and max(known)-min(known)>.5)
            adjusted=[a+1 if seam and a is not None and a<.5 else a for a in angles]
            pole_u=sum(a for a in adjusted if a is not None)/len(known)
            for li,u in zip(face.loop_indices,adjusted):
                vi=vessel.data.loops[li].vertex_index
                uv.data[li].uv=((pole_u if u is None else u)*circumference*16,vv[vi][2]*16)
        # Two thin restraint bands with black isolation strips. No spare duplicate
        # barrel or high-resolution nested shells are hidden inside the visible one.
        for z in [.035,.625]:
            angles=[2*pi*k/48 for k in range(48)]
            ring('RC_Rocket_Vessel_Band_Isolator',
                 [(vcx+.329*cos(a),vcy+.329*sin(a)) for a in angles],
                 [(vcx+.326*cos(a),vcy+.326*sin(a)) for a in angles],
                 lambda x,y,d,zz=z:(x,y,zz+d),.052,'rc_black')
            ring('RC_Rocket_Vessel_Retaining_Band',
                 [(vcx+.333*cos(a),vcy+.333*sin(a)) for a in angles],
                 [(vcx+.329*cos(a),vcy+.329*sin(a)) for a in angles],
                 lambda x,y,d,zz=z:(x,y,zz+.009+d),.034,'rc_metal')
            # Real crescent cradle beneath each band: inner/outer arcs, front/back
            # skins and closed end returns. It rests on short feet above the floor.
            arc=[7*pi/6+(2*pi/3)*k/24 for k in range(25)]
            cv=[]
            for zz,r in [(z-.012,.334),(z-.012,.356),(z+.064,.334),(z+.064,.356)]:
                cv.extend((vcx+r*cos(a),vcy+r*sin(a),zz) for a in arc)
            n=len(arc);cf=[]
            for k in range(n-1):
                cf.extend([(k,k+1,n+k+1,n+k),(2*n+k,3*n+k,3*n+k+1,2*n+k+1),
                           (k,2*n+k,2*n+k+1,k+1),(n+k+1,3*n+k+1,3*n+k,n+k)])
            cf.extend([(0,n,3*n,2*n),(n-1,3*n-1,4*n-1,2*n-1)])
            mesh('RC_Rocket_Vessel_Cradle_Saddle',cv,cf,'rc_black',smooth=True)
            foot_base=.347 if z<.2 else .3305
            box('RC_Rocket_Vessel_Cradle_Foot',(vcx,foot_base+.0205,z+.026),(.56,.041,.133),'rc_black',.009)
            for side in [-1,1]:
                beam('RC_Rocket_Vessel_Cradle_Web',(vcx+side*.205,foot_base+.039,z+.026),(vcx+side*.205,.480,z+.026),.032,.055,'rc_black')
                box('RC_Rocket_Vessel_Foot_Fastener',(vcx+side*.245,foot_base+.0445,z+.026),(.020,.008,.022),'rc_metal',.004)
            # A small band closure on the upper inboard quarter remains accessible.
            a=2.25
            box('RC_Rocket_Vessel_Band_Closure',(vcx+.337*cos(a),vcy+.337*sin(a),z+.026),(.050,.024,.065),'rc_metal',.006)
        # Modest neck/valve and protected hose: visual service fittings only. No
        # operating pressure, safety rating or functional plumbing is asserted.
        tube('RC_Rocket_Vessel_Neck',[(vcx,vcy,-.278),(vcx,vcy,-.326)],.026,'rc_metal',segments=16)
        box('RC_Rocket_Vessel_Valve_Block',(vcx,vcy,-.334),(.052,.042,.046),'rc_black',.008)
        tube('RC_Rocket_Vessel_Valve_Cap',[(vcx,vcy+.016,-.336),(vcx,vcy+.041,-.336)],.017,'rc_metal',segments=12)
        tube('RC_Rocket_Vessel_Protected_Hose',[(vcx+.021,vcy-.012,-.336),(.464,.706,-.330),(.485,.569,-.311),(.501,.443,-.301),(.544,.399,-.205),(.606,.390,.150),(.607,.390,.610)],.010,'rc_black',segments=8)
        for x,z in [(.552,-.16),(.606,.15),(.607,.58)]:
            clip_base=.347 if z<.19 else .3305
            box('RC_Rocket_Vessel_Hose_Clip_Foot',(x,(clip_base+.380)/2,z),(.030,.380-clip_base,.020),'rc_black',.003)
            box('RC_Rocket_Vessel_Hose_Clip',(x,.390,z),(.040,.020,.025),'rc_black',.004)
        vessel_metadata={
            'evidence_url':'https://www.youtube.com/watch?v=22rvpUecLts',
            'source_nominal_capacity_liters':400,
            'evidence_scope':'Additional vessel occupies the passenger-seat space; nominal capacity only.',
            'approximate_packaging_reconstruction':True,
            'not_factory_cad_or_certified_engineering':True,
            'measured_outer_mesh_volume_m3':volume,
            'measured_volume_is_not_usable_capacity':True,
            'authored_outer_dimensions_m':[radius*2,radius*2,cylinder_back-cylinder_front+2*dome_length],
            'placement_game_xyz_m':[vcx,vcy,(cylinder_front+cylinder_back)/2],
            'scale_note':'Outer mesh volume is before final uniform vehicle scale; multiply by assetScale cubed.'
        }
        for ob in objects[vessel_first:]:
            ob['approximate_packaging_reconstruction']=True
            ob['not_factory_cad_or_certified_engineering']=True
            ob['reference_role']='Rocket passenger-space vessel and original reconstructed supports'
            ob['evidence_url']=vessel_metadata['evidence_url']
            ob['evidence_scope']=vessel_metadata['evidence_scope']
        vessel['source_nominal_capacity_liters']=400

    # Add coherent metric UVs to every tiled material using dominant face axes.
    # These explicit mesh UVs survive static material batching and glTF export.
    for ob in objects[first_object:]:
        mat=ob.get('material_group');scale=density.get(mat)
        if scale is None or ob.type!='MESH' or ob.get('uv_already_authored'):continue
        uv=ob.data.uv_layers.get('RC_Metric_UV') or ob.data.uv_layers.new(name='RC_Metric_UV')
        for face in ob.data.polygons:
            normal=face.normal;axis=max(range(3),key=lambda k:abs(normal[k]))
            axes=[k for k in range(3) if k!=axis]
            for li in face.loop_indices:
                co=ob.data.vertices[ob.data.loops[li].vertex_index].co
                uv.data[li].uv=(co[axes[0]]*scale,co[axes[1]]*scale)
        if not ob.get('approximate_packaging_reconstruction'):
            ob['reference_role']='reference-led editable cabin geometry'
    tri_count=sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in objects[first_object:] if ob.type=='MESH')
    metadata={'steering_pivot':pivot.name,'steering_game_axis':'Z','triangles':tri_count,'materials':[k for k in M if k.startswith('rc_')],'texture_directory':os.path.join(root,'art','textures'),'seat_count':seat_count,'passenger_pressure_vessel':vessel_metadata,'driver_display':display_metadata,'layout_evidence':'Rocket single seat and passenger-space additional vessel are source-supported; vessel shape, mounts and exact dimensions are approximate packaging reconstruction, not factory CAD or certified engineering'}
    pivot['cabin_triangle_count']=tri_count
    print('ROADSTER_CABIN_STATS',metadata)
    return metadata
