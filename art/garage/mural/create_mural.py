"""Original hand-authored 'Rose Velocity' wall painting, no source photographs.
Rebuild with Python/Pillow/NumPy: python art/garage/mural/create_mural.py.
SVG preserves the individually authored strokes; PNG adds seeded spray/grit wear.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import random, json, hashlib, re
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[3]
ART=Path(__file__).resolve().parent
OUT=ROOT/'public/assets/garage/original-rose-velocity-mural.png'
rng=random.Random(27519)
parts=['''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512"><title>Rose Velocity</title><desc>Original wall-scale aerosol study: a low coupe breaks into feathered flight trails and a looping road. Hand-authored paths in plum, rose and magenta; no text, logos, stock images or characters.</desc>''']
def path(d,fill='none',stroke=None,width=1,opacity=1):
    parts.append(f'<path d="{d}" fill="{fill}"'+(f' stroke="{stroke}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"' if stroke else '')+f' opacity="{opacity}"/>')
# Loose first-pass brush mass, deliberately asymmetric and open at the edges.
path('M 102,339 L 194,258 L 295,218 L 335,169 L 420,164 L 504,115 L 572,178 L 676,145 L 791,201 L 944,254 L 904,360 L 823,391 L 702,419 L 587,398 L 457,433 L 351,393 L 219,408 Z','#512443',opacity=.80)
path('M 114,333 C 213,255 316,260 400,223 C 493,179 538,137 640,174 C 728,209 782,235 921,255',stroke='#a33070',width=66,opacity=.8)
path('M 144,388 C 304,398 383,367 482,386 C 660,420 803,364 908,322',stroke='#96386f',width=47,opacity=.8)
# Wings made from swept road marks, not a repeated ornament or brand emblem.
path('M 218,321 C 289,237 322,191 434,91 L 405,188 L 549,85 L 495,196 L 633,108 L 546,226 L 646,182 L 577,273 Z','#371c42',stroke='#371c42',width=19)
path('M 228,318 C 295,237 347,186 418,124 L 390,216 L 516,127 L 465,229 L 586,147 L 514,251 L 594,224 L 546,273 Z','#e95c97')
path('M 260,293 C 314,235 332,219 381,173 L 367,242 L 458,188 L 434,257 L 522,215',stroke='#f3a0bc',width=10)
path('M 297,306 L 405,228 L 393,273 L 488,235 L 454,289',stroke='#af376d',width=19)
# A single winding roadway under the body becomes the motion gesture.
path('M 91,392 C 249,357 341,467 513,405 C 645,358 677,245 877,322 C 932,344 924,386 966,389',stroke='#3d1c43',width=39)
path('M 91,390 C 249,355 341,465 513,403 C 645,356 677,243 877,320 C 932,342 924,384 966,387',stroke='#cb467f',width=21)
path('M 128,386 C 269,383 349,445 491,406 M 554,381 C 593,349 623,313 666,296 M 730,291 C 784,291 827,305 868,320',stroke='#ef9ab7',width=5)
# Original coupe silhouette: nose, canopy, shoulder and undercut painted as broad cuts.
path('M 186,314 L 276,284 L 386,275 L 462,215 Q 498,200 540,210 L 642,253 L 832,274 L 907,315 L 888,351 L 796,369 L 310,385 L 207,352 Z','#351a3a',stroke='#351a3a',width=17)
path('M 192,313 L 282,291 L 398,283 L 471,223 Q 501,214 539,222 L 641,263 L 826,284 L 889,314 L 826,333 L 672,324 L 529,348 L 344,351 L 263,362 L 211,344 Z','#d9578f')
path('M 411,283 L 478,231 Q 504,222 532,231 L 599,261 L 570,278 Z','#54244a')
path('M 426,281 L 481,236 L 522,235 L 472,279 Z','#a74274')
path('M 208,314 L 325,304 L 385,290 M 614,273 L 824,293 L 861,310 M 386,329 L 555,316 L 635,287',stroke='#f4a6bd',width=10)
path('M 294,363 C 434,362 505,338 644,337 L 802,345 L 861,332',stroke='#a32864',width=14)
path('M 727,298 L 820,302 L 846,314 L 775,315 Z','#f3a1b6')
path('M 831,323 L 885,317 L 877,333 L 829,342 Z','#64244f')
# Irregular tyre/orbit contours, intentionally not perfectly machined circles.
path('M 323,321 C 282,317 260,343 258,371 C 254,408 278,422 310,415 C 344,410 365,382 361,352 C 358,335 344,323 323,321 Z','#311932',stroke='#f08aaf',width=8)
path('M 319,341 C 299,336 280,354 278,375 C 277,393 288,403 305,397 C 328,391 342,370 338,353 C 336,348 329,342 319,341 Z','#a63f74',stroke='#e66c9c',width=7)
path('M 310,353 L 295,382 L 322,366 Z','#f19dbb')
path('M 764,316 C 729,311 697,334 689,367 C 681,398 700,417 733,412 C 767,405 791,377 795,352 C 799,330 783,318 764,316 Z','#341a38',stroke='#ef7faa',width=8)
path('M 754,337 C 733,333 714,351 709,372 C 705,391 715,400 733,394 C 754,389 771,370 773,352 C 773,343 766,339 754,337 Z','#ac4079',stroke='#ee8eb3',width=7)
path('M 749,347 L 727,383 L 758,366 Z','#f3a2c0')
# Loose paint pen highlights, corrections and shoulder-line breaks.
path('M 194,300 L 155,281 L 250,280 M 185,343 L 132,354 M 397,304 L 522,295 M 606,305 L 663,299 M 500,331 L 563,323',stroke='#ef8bb2',width=5)
path('M 161,243 L 281,232 M 118,270 L 236,253 M 144,222 L 220,216 M 734,227 L 892,261 M 806,212 L 941,250',stroke='#cb4c87',width=12)
path('M 142,241 L 246,231 M 795,221 L 925,253',stroke='#f09cb7',width=4)
path('M 623,137 L 642,112 M 647,146 L 679,127 M 660,168 L 696,161',stroke='#b74a87',width=8)
# Aerosol drips track gravity; cropped ends and random flecks avoid tiled wallpaper.
for x,y,length,width in [(205,350,50,3),(236,366,51,5),(378,376,67,4),(432,386,46,3),(573,387,51,4),(638,350,56,3),(821,360,44,4),(853,345,53,2),(892,292,31,2)]:
    path(f'M {x},{y} Q {x-2},{y+length*.4} {x+1},{y+length}',stroke=rng.choice(['#9e3368','#ca4c84','#e3719e']),width=width,opacity=.9)
    parts.append(f'<circle cx="{x+1}" cy="{y+length}" r="{width*.65}" fill="#be477d"/>')
for i in range(145):
    x=rng.uniform(90,968);y=rng.uniform(105,447)
    if rng.random()<.65 and 230<x<835 and 180<y<394:continue
    r=rng.choice([.6,1,1.3,1.8,2.5,3.7])
    parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{rng.choice(["#82305e","#d5518e","#ec89af","#b13b76"])}" opacity="{rng.uniform(.35,.9):.3f}"/>')
parts.append('</svg>')
svg='\n'.join(parts)+'\n'; (ART/'rose-velocity.svg').write_text(svg)
# Rasterize our small absolute SVG path vocabulary directly, without external tools.
S=2; im=Image.new('RGBA',(1024*S,512*S))
def rgba(hex,opacity=1):
    return tuple(int(hex[i:i+2],16) for i in (1,3,5))+(round(255*opacity),)
def subpaths(data):
    tokens=re.findall(r'[MLCQZ]|[-+]?(?:\d*\.)?\d+',data); i=0; paths=[]; pts=[]; current=(0,0)
    while i<len(tokens):
        cmd=tokens[i];i+=1
        if cmd=='Z':
            if pts:pts.append(pts[0])
            paths.append(pts);pts=[];continue
        count={'M':2,'L':2,'C':6,'Q':4}[cmd];v=list(map(float,tokens[i:i+count]));i+=count
        if cmd=='M':
            if pts:paths.append(pts)
            current=tuple(v);pts=[current]
        elif cmd=='L':current=tuple(v);pts.append(current)
        else:
            p0=np.array(current);p1=np.array(v[:2]);p2=np.array(v[2:4]);p3=np.array(v[4:6]) if cmd=='C' else None
            for t in np.linspace(0,1,34)[1:]:
                p=(1-t)**3*p0+3*(1-t)**2*t*p1+3*(1-t)*t*t*p2+t**3*p3 if cmd=='C' else (1-t)**2*p0+2*(1-t)*t*p1+t*t*p2
                pts.append(tuple(p))
            current=tuple(p3 if cmd=='C' else p2)
    if pts:paths.append(pts)
    return paths
for el in ET.fromstring(svg):
    kind=el.tag.rsplit('}',1)[-1];a=el.attrib
    if kind not in ('path','circle'):continue
    layer=Image.new('RGBA',im.size);d=ImageDraw.Draw(layer);opacity=float(a.get('opacity',1))
    if kind=='circle':
        x,y,r=[float(a[k])*S for k in ('cx','cy','r')];d.ellipse((x-r,y-r,x+r,y+r),fill=rgba(a['fill'],opacity))
    else:
        for points in subpaths(a['d']):
            points=[(round(x*S),round(y*S)) for x,y in points]
            if a.get('fill','none')!='none':d.polygon(points,fill=rgba(a['fill'],opacity))
            if 'stroke' in a:
                width=round(float(a.get('stroke-width',1))*S);color=rgba(a['stroke'],opacity)
                d.line(points,fill=color,width=width,joint='curve')
                for x,y in [points[0],points[-1]]:d.ellipse((x-width/2,y-width/2,x+width/2,y+width/2),fill=color)
    im=Image.alpha_composite(im,layer)
w,h=im.size
# Low-density overspray around the independently readable paint silhouette.
alpha=im.getchannel('A');halo=alpha.filter(ImageFilter.GaussianBlur(10))
back=Image.new('RGBA',im.size,(142,39,98,0));back.putalpha(halo.point(lambda v:int(v*.19)))
im=Image.alpha_composite(back,im)
a=np.asarray(im).copy();nr=np.random.default_rng(27519)
noise=nr.uniform(0,1,(h,w));weather=nr.normal(.94,.09,(h,w)); weather=np.clip(weather,.48,1)
# Porous concrete pinholes and irregular chips, always transparent to real wall.
weather[noise>.981]*=.12
chip=Image.new('L',(w,h),255);d=ImageDraw.Draw(chip)
for i in range(1350):
    x=rng.randrange(w);y=rng.randrange(h);rx=rng.choice([1,1,1,2,3]);ry=rng.choice([1,2,3,4])
    d.ellipse((x-rx,y-ry,x+rx,y+ry),fill=rng.randint(0,95))
weather*=np.asarray(chip)/255
a[:,:,3]=(a[:,:,3]*weather).astype('uint8')
# Slight paint-pigment variation rather than uniform digital fill.
factor=nr.normal(1,.027,(h,w,1));a[:,:,:3]=np.clip(a[:,:,:3]*factor,0,255).astype('uint8')
im=Image.fromarray(a).resize((1024,512),Image.Resampling.LANCZOS)
OUT.parent.mkdir(parents=True,exist_ok=True);im.save(OUT,optimize=True)
# Review copy on neutral wall colour; production stays transparent.
preview=Image.new('RGBA',im.size,(66,65,67,255));preview.alpha_composite(im);preview.convert('RGB').save(ART/'rose-velocity-preview.jpg',quality=94)
manifest={'title':'Rose Velocity','authoring':'Original hand-authored SVG paths with deterministic aerosol, porosity and chips.','source':'art/garage/mural/create_mural.py','editable_vector':'art/garage/mural/rose-velocity.svg','texture':'public/assets/garage/original-rose-velocity-mural.png','size_px':[1024,512],'palette':['plum','magenta','rose','blush'],'seed':27519,'external_assets':[],'text_or_logos':False,'license':'Original project artwork; no third-party content.','files':[]}
for p in [Path(__file__),ART/'rose-velocity.svg',OUT]:
    b=p.read_bytes();manifest['files'].append({'path':str(p.relative_to(ROOT)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
(ART/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
