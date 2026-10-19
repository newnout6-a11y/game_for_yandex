"""Read-only zero-after-NUL audit of actual SDNA image path fields, not workspace substring checks."""
import struct,math,re,json,hashlib
from pathlib import Path
P=Path(__file__).resolve().parent/'toy-racecar.blend';raw=P.read_bytes();assert raw[:9]==b'BLENDER-v'
blocks=[];off=12
while off<len(raw):
 code,size,addr,sdna,count=struct.unpack_from('<4sIQII',raw,off);blocks.append((code,off+24,size,sdna,count));off+=24+size
 if code==b'ENDB':break
_,at,size,_,_=next(b for b in blocks if b[0]==b'DNA1');d=raw[at:at+size];o=8;n=struct.unpack_from('<I',d,o)[0];o+=4;names=[]
for _ in range(n):q=d.index(0,o);names.append(d[o:q].decode());o=q+1
o=(o+3)//4*4;assert d[o:o+4]==b'TYPE';o+=4;n=struct.unpack_from('<I',d,o)[0];o+=4;types=[]
for _ in range(n):q=d.index(0,o);types.append(d[o:q].decode());o=q+1
o=(o+3)//4*4;assert d[o:o+4]==b'TLEN';o+=4;sizes=struct.unpack_from('<'+'H'*len(types),d,o);o+=2*len(types);o=(o+3)//4*4;assert d[o:o+4]==b'STRC';o+=4;n=struct.unpack_from('<I',d,o)[0];o+=4;structs=[]
for _ in range(n):
 ti,nf=struct.unpack_from('<HH',d,o);o+=4;fields=[];offset=0
 for __ in range(nf):
  ft,fn=struct.unpack_from('<HH',d,o);o+=4;name=names[fn];length=math.prod(int(v) for v in re.findall(r'\[(\d+)\]',name));width=(8 if '*'in name else sizes[ft])*length
  fields.append((offset,types[ft],name,width));offset+=width
 structs.append((types[ti],sizes[ti],fields))
results=[]
for code,at,size,si,count in blocks:
 if code in [b'DNA1',b'ENDB',b'TEST',b'REND'] or si>=len(structs):continue
 name,stride,fields=structs[si];target={'Image':'name[1024]','ImagePackedFile':'filepath[1024]'}.get(name)
 if not target:continue
 field=next(f for f in fields if f[2]==target);offset,ctype,label,width=field;assert ctype=='char' and width==1024
 for i in range(count):
  data=raw[at+i*stride+offset:at+i*stride+offset+width];nul=data.index(0);tail=data[nul+1:];assert len(data)==1024 and all(v==0 for v in tail),(name,label,i)
  active=data[:nul].decode();assert not active or (active.startswith('//') and '/' not in active[2:]),active
  results.append({'struct':name,'field':label,'active':active,'unused_tail_bytes':len(tail),'nonzero_tail_bytes':0})
assert sum(r['struct']=='Image' and bool(r['active']) for r in results)==2
assert sum(r['struct']=='ImagePackedFile' for r in results)==2
out={'source_sha256':hashlib.sha256(raw).hexdigest(),'read_only':True,'method':'SDNA field offsets and complete zero-after-NUL validation; no hardcoded workspace string search','checked_fields':results}
(P.parent/'path-string-tail-proof.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
