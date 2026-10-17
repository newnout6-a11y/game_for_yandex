"""Pack original Blender renders as a padded straight-alpha game atlas and QA preview."""
from pathlib import Path
import json, hashlib
from PIL import Image, ImageFilter, ImageDraw
ROOT=Path(__file__).resolve().parents[1]; SOURCE=ROOT/'art'/'smoke'
TILE=256; COLUMNS=4; ROWS=2
atlas=Image.new('RGBA',(TILE*COLUMNS,TILE*ROWS),(225,235,242,0))
for frame in range(COLUMNS*ROWS):
    image=Image.open(SOURCE/f'puff-{frame:02d}.png').convert('RGBA')
    # A subpixel reconstruction filter removes Monte Carlo grain, not silhouette
    # detail. Blender's PNG writer supplies straight alpha. Extend empty texel
    # RGB with pale gas color to prevent black filtering halos in the runtime.
    image=image.filter(ImageFilter.GaussianBlur(.65))
    pixels=image.load()
    for y in range(TILE):
        for x in range(TILE):
            r,g,b,a=pixels[x,y]
            if a==0:pixels[x,y]=(225,235,242,0)
            elif a<4:pixels[x,y]=(225,235,242,a)
    atlas.paste(image,((frame%COLUMNS)*TILE,(frame//COLUMNS)*TILE))
output=ROOT/'public'/'assets'/'cold-gas-smoke-atlas.png';atlas.save(output,optimize=True)
preview=Image.new('RGB',(1024,640),(48,56,64));draw=ImageDraw.Draw(preview)
for y in range(0,640,32):
    for x in range(0,1024,32):
        if (x//32+y//32)%2:draw.rectangle((x,y,x+31,y+31),fill=(59,67,75))
preview.paste(atlas,(0,64),atlas)
draw.text((24,20),'ORIGINAL BLENDER VOLUME | 8 SHADING / TURBULENCE VARIANTS | RGBA',fill=(235,242,248))
draw.text((24,602),'Transparent smoke atlas. No external photo, model or texture. 1024 x 512 runtime asset.',fill=(235,242,248))
preview.save(SOURCE/'smoke-atlas-preview.jpg',quality=95)
metadata=json.loads((SOURCE/'provenance.json').read_text());metadata.update({'runtime_asset':'public/assets/cold-gas-smoke-atlas.png','atlas_px':[1024,512],'file_bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'alpha':'straight RGBA, transparent edges, pale RGB bleed prevents black halos'})
(SOURCE/'provenance.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
