"""Render packed garage sources with an optional existing car as a scale reference.
This never changes source .blend files, production GLBs or transport assets.
Example: blender -b -t 2 --python art/garage/render_previews.py -- --tiers 1 4 --samples 24 --width 1152
"""
import bpy, os, argparse, sys
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
p=argparse.ArgumentParser();p.add_argument('--tiers',nargs='+',type=int,default=[1,2,3,4]);p.add_argument('--samples',type=int,default=48);p.add_argument('--width',type=int,default=1440);p.add_argument('--threads',type=int,default=2);p.add_argument('--empty',action='store_true');p.add_argument('--reverse',action='store_true');args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
for tier in args.tiers:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'art','garage','tier%d.blend'%tier))
    if not args.empty:bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'public','assets','roadster.glb'))
    sc=bpy.context.scene;sc.render.threads_mode='FIXED';sc.render.threads=args.threads;sc.cycles.samples=args.samples;sc.cycles.use_denoising=False;sc.render.resolution_x=args.width;sc.render.resolution_y=round(args.width*900/1440);sc.render.resolution_percentage=100
    if args.reverse:
        # Stay between the accepted precision-tier lift posts for this review
        # camera; production runtime uses the authored obstacle contract.
        sc.camera.location=Vector((2.8,-5.8,3.6) if tier==2 else (5.7,-5.3,3.25));target=Vector((0,3.3,1.3))
        sc.camera.rotation_euler=(target-sc.camera.location).to_track_quat('-Z','Y').to_euler();sc.camera.data.lens=25
    suffix=('-reverse' if args.reverse else '')+('-empty' if args.empty else '')
    sc.render.filepath=os.path.join(ROOT,'art','garage','previews','tier%d%s.png'%(tier,suffix));bpy.ops.render.render(write_still=True)
