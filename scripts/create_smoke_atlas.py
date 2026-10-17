"""Original shaded cold-gas/smoke sprite source. Blender 4.x, no external assets.
Run: blender --background --factory-startup --python scripts/create_smoke_atlas.py
Then: python3 scripts/pack_smoke_atlas.py
Eight independently lit procedural-volume variants, rendered against transparent film.
"""
import bpy, math, os, json
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'art', 'smoke')
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.device='CPU'; scene.cycles.samples=int(os.environ.get('SMOKE_SAMPLES','24'))
scene.cycles.use_denoising=False
scene.cycles.volume_step_rate=.5; scene.cycles.volume_max_steps=256
scene.cycles.max_bounces=6; scene.cycles.volume_bounces=2
scene.render.resolution_x=256; scene.render.resolution_y=256; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'; scene.render.image_settings.color_depth='8'
scene.render.film_transparent=True; scene.render.threads_mode='FIXED'; scene.render.threads=4
scene.view_settings.view_transform='Standard'; scene.view_settings.look='None'; scene.view_settings.exposure=0; scene.view_settings.gamma=1
scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.6,.7,.85,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35

mat=bpy.data.materials.new('Original turbulent cold gas volume');mat.use_nodes=True
n=mat.node_tree.nodes; l=mat.node_tree.links; n.clear()
out=n.new('ShaderNodeOutputMaterial');vol=n.new('ShaderNodeVolumePrincipled');l.new(vol.outputs['Volume'],out.inputs['Volume'])
vol.inputs['Color'].default_value=(.84,.9,.97,1);vol.inputs['Anisotropy'].default_value=.16
tex=n.new('ShaderNodeTexCoord');center=n.new('ShaderNodeVectorMath');center.operation='SUBTRACT';center.inputs[1].default_value=(.5,.5,.5);l.new(tex.outputs['Generated'],center.inputs[0])
# Broad irregular silhouette from a warped radial density field, not a sphere mesh.
noise=n.new('ShaderNodeTexNoise');noise.noise_dimensions='4D';noise.inputs['Scale'].default_value=4.2;noise.inputs['Detail'].default_value=4.2;noise.inputs['Roughness'].default_value=.72;noise.inputs['Distortion'].default_value=.38;l.new(tex.outputs['Generated'],noise.inputs['Vector'])
warp=n.new('ShaderNodeVectorMath');warp.operation='SUBTRACT';warp.inputs[1].default_value=(.5,.5,.5);l.new(noise.outputs['Color'],warp.inputs[0])
scale=n.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.38;l.new(warp.outputs['Vector'],scale.inputs[0])
add=n.new('ShaderNodeVectorMath');add.operation='ADD';l.new(center.outputs['Vector'],add.inputs[0]);l.new(scale.outputs['Vector'],add.inputs[1])
length=n.new('ShaderNodeVectorMath');length.operation='LENGTH';l.new(add.outputs['Vector'],length.inputs[0])
falloff=n.new('ShaderNodeMapRange');falloff.interpolation_type='SMOOTHERSTEP';falloff.inputs['From Min'].default_value=.08;falloff.inputs['From Max'].default_value=.49;falloff.inputs['To Min'].default_value=1;falloff.inputs['To Max'].default_value=0;l.new(length.outputs['Value'],falloff.inputs['Value'])
cloud=n.new('ShaderNodeValToRGB');cloud.color_ramp.elements[0].position=.47;cloud.color_ramp.elements[0].color=(0,0,0,1);cloud.color_ramp.elements[1].position=.66;cloud.color_ramp.elements[1].color=(1,1,1,1);l.new(noise.outputs['Fac'],cloud.inputs['Fac'])
density=n.new('ShaderNodeMath');density.operation='MULTIPLY';l.new(falloff.outputs['Result'],density.inputs[0]);l.new(cloud.outputs['Color'],density.inputs[1])
strength=n.new('ShaderNodeMath');strength.operation='MULTIPLY';strength.inputs[1].default_value=3.7;l.new(density.outputs['Value'],strength.inputs[0]);l.new(strength.outputs['Value'],vol.inputs['Density'])
bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,0));puff=bpy.context.object;puff.name='Original_noise_warped_volume';puff.data.materials.append(mat)
# Soft broad key, sky fill and a restrained rim produce volume, never fire/glow.
def light(name,location,power,size,color):
    """Add an origin-facing disk area light to the procedural smoke scene.

    Location and emitter size use native Blender scene units (+Z up), not the
    vehicle game-axis conversion. Power is watts and color is normalized RGB;
    link the lamp and set its orientation in place, returning None.
    """
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=location;ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()
light('Broad daylight key',(-3,-4,5),320,4,(1,.97,.91))
light('Sky fill',(4,-2,1.5),210,5,(.78,.88,1))
light('Soft volume rim',(1,3,3),260,3,(.92,.97,1))
bpy.ops.object.camera_add(location=(0,-5,.3));camera=bpy.context.object;camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.45;scene.camera=camera
for frame in range(int(os.environ.get('SMOKE_START','0')),int(os.environ.get('SMOKE_FRAMES','8'))):
    noise.inputs['W'].default_value=2.13+frame*2.37
    puff.rotation_euler=(.12*math.sin(frame),.09*math.cos(frame),frame*.71)
    puff.scale=(1.0+.1*math.sin(frame*2),1,.92+.11*math.cos(frame))
    scene.render.filepath=os.path.join(OUT,f'puff-{frame:02d}.png')
    bpy.ops.render.render(write_still=True)
    print('SMOKE_FRAME',frame,flush=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'original-cold-gas-volume.blend'))
with open(os.path.join(OUT,'provenance.json'),'w') as f:json.dump({'author':'Original project artwork','source':'Blender procedural volume; no external media, models, addons or licensed source images','script':'scripts/create_smoke_atlas.py','variants':8,'tile_px':256,'renderer':'Blender Cycles CPU','samples':scene.cycles.samples},f,indent=2)
