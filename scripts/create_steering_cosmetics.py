"""Author two original Roadster Rocket steering options, without editing the car.

Run: blender --background --python scripts/create_steering_cosmetics.py -- --render
Editable individual parts live in art/cosmetics; runtime GLBs use four draw batches.
Geometry is in existing steering_yoke local game metres: +Y up, +Z to driver.
The mount is identity: do not apply the Roadster scale or pivot translation twice.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from sanitize_blend_sources import save_portable
ART = ROOT / 'art/cosmetics'
OUT = ROOT / 'public/assets/cosmetics'
CAR = ROOT / 'public/assets/roadster.glb'
SOURCE_SHA = hashlib.sha256(CAR.read_bytes()).hexdigest()
for directory in (ART, OUT, ART / 'previews'):
    directory.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--render', action='store_true')
parser.add_argument('--render-only', action='store_true')
parser.add_argument('--samples', type=int, default=24)
parser.add_argument('--view', choices=['all', 'product', 'fitted'], default='all')
parser.add_argument('--variant', choices=['all', 'round', 'yoke'], default='all')
OPTIONS = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
MATERIALS = {}
PARTS = []
ORIGINAL_MESHES = ['steering_yoke_rc_' + key for key in ['black', 'carbon', 'ivory', 'liner', 'metal']]


def game(point):
    """Convert game XY steering plane to Blender XZ, retaining +Z driver depth."""
    return Vector((point[0], -point[2], point[1]))


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.unit_settings.system = 'METRIC'
    PARTS.clear()
    MATERIALS.clear()


def material(key, label, color, metallic, roughness):
    mat = bpy.data.materials.new('Roadster_Steering_' + label)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    MATERIALS[key] = mat
    return mat


def palette():
    # Oxblood/plum leather and rose thread are deliberate alternatives to the
    # older black/white/green/orange presentation, not emissive plastic highlights.
    material('leather', 'Oxblood_Leather', (.115, .018, .047), .02, .58)
    material('hub', 'Aubergine_Suede', (.030, .017, .035), .02, .76)
    material('metal', 'Brushed_Titanium', (.30, .25, .25), .79, .30)
    material('thread', 'Rose_Stitch', (.56, .075, .19), .12, .47)


def mesh(name, vertices, faces, finish, parent, smooth=False, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([game(v) for v in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    data.materials.append(MATERIALS[finish])
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    ob['original_geometry'] = True
    ob['cosmetic_part'] = True
    ob['part_function'] = name
    if bevel:
        modifier = ob.modifiers.new('Manufactured edge radius', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
        modifier.affect = 'EDGES'
        modifier = ob.modifiers.new('Face weighted shading', 'WEIGHTED_NORMAL')
        modifier.keep_sharp = True
    PARTS.append(ob)
    return ob


def polygon(name, outline, z0, z1, finish, parent, bevel=.002):
    count = len(outline)
    vertices = [(x, y, z) for z in (z0, z1) for x, y in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
    return mesh(name, vertices, faces, finish, parent, bevel=bevel)


def tube(name, path, radius, depth, finish, parent, sides=10, closed=False):
    """Make a watertight elliptical grip sweep with stable steering-plane frames."""
    count = len(path)
    vertices = []
    for i, point in enumerate(path):
        previous = Vector(path[(i - 1) % count] if closed else path[max(0, i - 1)])
        following = Vector(path[(i + 1) % count] if closed else path[min(count - 1, i + 1)])
        tangent = (following - previous).normalized()
        outward = Vector((tangent.y, -tangent.x, 0)).normalized()
        r = radius(i / max(1, count - 1)) if callable(radius) else radius
        vertices.extend(tuple(Vector(point) + outward * (r * math.cos(k * math.tau / sides)) + Vector((0, 0, depth * math.sin(k * math.tau / sides)))) for k in range(sides))
    faces = []
    for i in range(count if closed else count - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            c, d = ((i + 1) % count) * sides + (k + 1) % sides, ((i + 1) % count) * sides + k
            faces.append((a, b, c, d))
    if not closed:
        faces += [tuple(reversed(range(sides))), tuple((count - 1) * sides + k for k in range(sides))]
    return mesh(name, vertices, faces, finish, parent, smooth=True)


def smooth_path(knots, steps=5):
    """Sample a bounded Catmull-Rom path for hand-shaped yoke grips."""
    result = []
    for i in range(len(knots) - 1):
        a, b, c, d = [Vector(knots[max(0, min(len(knots) - 1, j))]) for j in (i - 1, i, i + 1, i + 2)]
        for k in range(steps):
            t = k / steps
            result.append(tuple(.5 * ((2 * b) + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t*t + (-a + 3 * b - 3 * c + d) * t*t*t)))
    result.append(knots[-1])
    return result


def root_node(name, label):
    root = bpy.data.objects.new('cosmetic_steering_' + name, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_size = .05
    root['cosmetic_id'] = 'steering_' + name
    root['label'] = label
    root['slot'] = 'cockpit.steering'
    root['attachment_parent'] = 'steering_yoke'
    root['attachment_frame'] = 'Existing steering_yoke local; identity transform'
    root['coordinate_convention'] = '+Y up, +Z toward driver; unscaled pivot-local metres'
    root['steering_axis'] = 'local Z; inherit original animated pivot'
    root['source_roadster_sha256'] = SOURCE_SHA
    root['hide_original_meshes'] = ORIGINAL_MESHES
    root['preserves_tablet_column_controls'] = True
    root['provenance'] = 'Original editable Blender-authored geometry; no external assets'
    return root


def hub_and_controls(root, label, compact=False):
    outline = [(-.059, .046), (-.043, .062), (.043, .062), (.059, .046), (.054, -.044), (.034, -.063), (-.034, -.063), (-.054, -.044)]
    polygon(label + ' cast central hub', outline, -.018, .017, 'hub', root, .007)
    polygon(label + ' stitched airbag pad', [(x*.91, y*.91) for x, y in outline], .016, .032, 'leather', root, .007)
    polygon(label + ' restrained titanium emblem', [(-.011,.012),(.010,.012),(.007,.007),(-.005,.007),(-.005,-.008),(-.010,-.008)], .032, .034, 'metal', root, .0006)
    for sign in (-1, 1):
        # Each control is an actual raised wheel-local part, not a texture decal.
        polygon(label + ' rear paddle', [(sign*.091,.067),(sign*.123,.065),(sign*.132,-.054),(sign*.105,-.065)], -.043, -.035, 'metal', root, .004)
        control = [(sign*.064,.027),(sign*.112,.040),(sign*.113,.010),(sign*.064,-.002)] if compact else [(sign*.064,.034),(sign*.116,.055),(sign*.116,.037),(sign*.064,.016)]
        polygon(label + ' thumb control inset', control, .011, .019, 'hub', root, .002)
        for k in range(2):
            x = sign*(.075 + .021*k)
            y = .013 if compact else .025 + (.075 + .021*k - .064)*.4
            polygon(label + ' control witness', [(x-.003,y),(x+.003,y),(x+.003,y+.003),(x-.003,y+.003)], .019, .0205, 'metal', root, .0004)


def round_wheel():
    root = root_node('round', 'Touring Round')
    radius = .169
    path = [(radius*math.cos(i*math.tau/72), radius*math.sin(i*math.tau/72), 0) for i in range(72)]
    # Thick palm zones and slender top/bottom preserve a genuinely circular rim.
    tube('Touring continuous circular leather rim', path, lambda t: .0175 + .005*(abs(math.cos(t*math.tau))**6), .023, 'leather', root, sides=12, closed=True)
    for sign in (-1, 1):
        outline = [(sign*.046,.039),(sign*.150,.081),(sign*.158,.052),(sign*.054,-.003)]
        polygon('Touring swept upper spoke', outline, -.014, .011, 'metal', root, .004)
        # Rose hand-stitching on the two grip seams, kept at thread scale.
        for j in range(16):
            angle = (-.62 + j*.082) + (math.pi if sign < 0 else 0)
            a = [(radius*math.cos(angle+q), radius*math.sin(angle+q), .0234) for q in (-.011,.011)]
            tube('Touring hand stitched grip', a, .00075, .0007, 'thread', root, 5)
    polygon('Touring lower spoke', [(-.023,-.045),(.023,-.045),(.027,-.155),(-.027,-.155)], -.013, .009, 'metal', root, .004)
    polygon('Touring lower spoke suede insert', [(-.009,-.068),(.009,-.068),(.010,-.145),(-.010,-.145)], .009, .012, 'hub', root, .002)
    # A physical 12-o'clock band with bounded width, not a bright full rim.
    top = [(radius*math.cos(a), radius*math.sin(a), .001) for a in [math.pi/2-.030+i*.010 for i in range(7)]]
    tube('Touring twelve oclock rose datum', top, .0184, .024, 'thread', root, 12)
    hub_and_controls(root, 'Touring')
    return root


def compact_yoke():
    root = root_node('yoke', 'Arc Compact Yoke')
    # Open upper centre, rounded continuous lower arc and generous finger grips.
    knots = [(-.177,.109,0),(-.194,.089,0),(-.201,.043,0),(-.200,-.043,0),(-.178,-.089,0),(-.123,-.118,0),(0,-.124,0),(.123,-.118,0),(.178,-.089,0),(.200,-.043,0),(.201,.043,0),(.194,.089,0),(.177,.109,0)]
    path = smooth_path(knots, 5)
    tube('Arc continuous sculpted open yoke', path, .022, .024, 'leather', root, 12)
    for sign in (-1, 1):
        polygon('Arc broad cantilever spoke', [(sign*.045,.039),(sign*.176,.052),(sign*.179,.008),(sign*.047,-.019)], -.015, .010, 'metal', root, .004)
        polygon('Arc lower diagonal brace', [(sign*.040,-.043),(sign*.130,-.108),(sign*.107,-.118),(sign*.024,-.059)], -.012, .008, 'metal', root, .003)
        # End caps read as restrained molded trim, with no unsupported floating bits.
        cap = [(sign*.177,.109,-.001),(sign*.178,.108,-.001)]
        tube('Arc titanium grip end cap', cap, .0228, .0248, 'metal', root, 12)
        for j in range(15):
            y = .069-j*.0095
            x = sign*(.200 - .008*max(0,(-y-.03)/.045))
            tube('Arc rose stitched inner grip', [(x-.0011,y+.0016,.0245),(x+.0011,y-.0016,.0245)], .0007, .00065, 'thread', root, 5)
    # Lower inset follows the open U contour, preserving visible air around hub.
    tube('Arc bottom titanium reveal', smooth_path([(-.11,-.118,.024),(0,-.124,.024),(.11,-.118,.024)], 9), .0024, .0014, 'metal', root, 6)
    hub_and_controls(root, 'Arc', True)
    return root


def export_asset(root, stem):
    scene = bpy.context.scene
    scene['source_script'] = 'scripts/create_steering_cosmetics.py'
    scene['authored_for'] = 'Current Roadster Rocket; original base is read-only fitting reference'
    scene['runtime_mount'] = 'Identity child of existing steering_yoke; inherits animation'
    editable = len(PARTS)
    save_portable(ART/(stem+'.blend'))
    # Evaluate edge bevels and batch only after saving individually editable parts.
    for ob in list(PARTS):
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        for modifier in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        # Clamp-overlap bevels can leave micron-sized cap wedges. Remove those
        # export-only degenerate triangles, keeping all visible manufactured edges.
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.calc_area() < 1e-9], context='FACES_ONLY')
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
    batches = []
    groups = [(key, [ob for ob in PARTS if ob.data.materials[0] == mat]) for key, mat in MATERIALS.items()]
    for key, group in groups:
        if not group:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for ob in group:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        ob = bpy.context.object
        ob.name = stem.replace('-', '_') + '_' + key
        batches.append(ob)
    bpy.context.view_layer.update()
    vertices = [ob.matrix_world @ vert.co for ob in batches for vert in ob.data.vertices]
    points = [(p.x,p.z,-p.y) for p in vertices]
    bounds = {'min':[min(p[i] for p in points) for i in range(3)], 'max':[max(p[i] for p in points) for i in range(3)]}
    triangles = sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in batches)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for ob in batches:
        ob.select_set(True)
    destination = OUT/(stem+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_selection=True, export_yup=True, export_extras=True, export_normals=True, export_apply=True, export_cameras=False, export_lights=False)
    result = {'id':root['cosmetic_id'],'asset':destination.name,'root':root.name,'editableSource':'art/cosmetics/'+stem+'.blend','editableParts':editable,'drawBatches':len(batches),'triangles':triangles,'boundsPivotLocalM':bounds,'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}
    print('STEERING_ASSET '+json.dumps(result), flush=True)
    return result


def import_glb(path):
    previous = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [ob for ob in bpy.data.objects if ob not in previous]


def stage():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = OPTIONS.samples
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.world.color = (.19,.19,.19)
    scene.view_settings.view_transform = 'AgX'
    for name, position, energy, color, size in [('Soft key',(-1,2,2),360,(1,.84,.90),3),('Cool fill',(2,1,1),220,(.80,.86,1),2),('Rim',(-1,1,-1),400,(1,.65,.78),2)]:
        data = bpy.data.lights.new(name,'AREA')
        data.energy, data.color, data.size = energy, color, size
        ob = bpy.data.objects.new(name,data)
        bpy.context.collection.objects.link(ob)
        ob.location = game(position)
        ob.rotation_euler = (-ob.location).to_track_quat('-Z','Y').to_euler()


def render(name, eye, target, lens):
    data = bpy.data.cameras.new('Inspection camera')
    cam = bpy.data.objects.new('Inspection camera',data)
    bpy.context.collection.objects.link(cam)
    cam.location = game(eye)
    cam.rotation_euler = (game(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    data.lens, data.clip_start = lens, .015
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.filepath = str(ART/'previews'/(name+'.png'))
    bpy.ops.render.render(write_still=True)


def previews():
    for stem in ('steering-round','steering-yoke'):
        if OPTIONS.variant != 'all' and stem != 'steering-' + OPTIONS.variant:
            continue
        if OPTIONS.view in ('all', 'product'):
            reset()
            import_glb(OUT/(stem+'.glb'))
            stage()
            render(stem+'-product',(.13,.11,1.05),(0,0,0),55)
        if OPTIONS.view == 'product':
            continue
        reset()
        car_objects = import_glb(CAR)
        pivot = next(ob for ob in car_objects if ob.name == 'steering_yoke')
        for ob in pivot.children:
            if ob.name in ORIGINAL_MESHES:
                ob.hide_render = True
        option = import_glb(OUT/(stem+'.glb'))
        root = next(ob for ob in option if ob.name.startswith('cosmetic_steering_'))
        root.parent = pivot
        root.location = (0,0,0)
        root.rotation_euler = (0,0,0)
        root.scale = (1,1,1)
        stage()
        render(stem+'-fitted',(-.425,1.02,.31),(-.36,.84,-.27),24)


if not OPTIONS.render_only:
    records = []
    for stem,builder in [('steering-round',round_wheel),('steering-yoke',compact_yoke)]:
        reset()
        palette()
        records.append(export_asset(builder(),stem))
    raw = CAR.read_bytes()
    length = int.from_bytes(raw[12:16], 'little')
    source = json.loads(raw[20:20+length])
    pivot = next(node for node in source['nodes'] if node.get('name') == 'steering_yoke')
    manifest = {'schemaVersion':1,'brand':'Roadster','cars':['rocket'],'sourceRoadsterSha256':SOURCE_SHA,'sourceScript':'scripts/create_steering_cosmetics.py','mount':{'parent':'steering_yoke','position':[0,0,0],'quaternion':[0,0,0,1],'scale':[1,1,1],'axis':'local Z','originalPivotTranslation':pivot['translation'],'originalPivotQuaternion':pivot.get('rotation',[0,0,0,1]),'hideOnlyOriginalMeshes':ORIGINAL_MESHES,'preserveOriginalPivot':True,'preserveStationaryColumnTabletAndControls':True},'coordinateConvention':'Existing steering_yoke local metres, +Y up, +Z towards driver; no runtime rescale','provenance':'Original authored Blender grip, hub, spokes, paddles, seam and trim geometry. No downloaded or purchased assets. Accepted Roadster used only for read-only fitting.','assets':records}
    (OUT/'steering-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (ART/'steering-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
if OPTIONS.render or OPTIONS.render_only:
    previews()
assert hashlib.sha256(CAR.read_bytes()).hexdigest() == SOURCE_SHA, 'Base Roadster must remain unchanged'
