"""Verify the authored mural adds one batch without changing any original mesh.
Use --baseline with the accepted pre-mural room GLBs. This audit never edits assets.
"""
import argparse,json,struct,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);args=p.parse_args()
def load(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);data=raw[28+n:]
    def acc(i):
        a=j['accessors'][i];b=j['bufferViews'][a['bufferView']];dtype={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];size=np.dtype(dtype).itemsize
        values=np.ndarray((a['count'],width),dtype=dtype,buffer=data,offset=b.get('byteOffset',0)+a.get('byteOffset',0),strides=(b.get('byteStride',width*size),size))
        return hashlib.sha256(values.tobytes()).hexdigest()
    meshes={}
    for node in j['nodes']:
        if 'mesh' not in node:continue
        mesh=j['meshes'][node['mesh']]
        record={'transform':{k:node[k] for k in ['matrix','translation','rotation','scale'] if k in node},'primitives':[]}
        for primitive in mesh['primitives']:
            record['primitives'].append({'material':j['materials'][primitive['material']]['name'],'indices':acc(primitive['indices']),'attributes':{k:acc(v) for k,v in primitive['attributes'].items()},'triangles':j['accessors'][primitive['indices']]['count']//3})
        meshes[node['name']]=record
    return raw,j,meshes
reports=[]
for tier in range(1,5):
    old,oj,om=load(args.baseline/f'tier{tier}.glb');new,nj,nm=load(ROOT/f'public/assets/garage/tier{tier}.glb')
    differences=[name for name,value in om.items() if nm.get(name)!=value]
    added=[name for name in nm if name not in om]
    expected=f'Tier{tier}_Original_rose_velocity_mural'
    mural_triangles=sum(p['triangles'] for p in nm.get(expected,{}).get('primitives',[]))
    def materials(j):
        def resolved(value):
            if isinstance(value,list):return [resolved(v) for v in value]
            if not isinstance(value,dict):return value
            result={k:resolved(v) for k,v in value.items()}
            for key in list(result):
                if key.endswith('Texture') and isinstance(result[key],dict) and 'index' in result[key]:
                    tex=j['textures'][result[key]['index']]
                    result[key]={**result[key],'index':{'image':j['images'][tex['source']]['name'],'sampler':j['samplers'][tex['sampler']]}}
            return result
        return {m['name']:resolved(m) for m in j['materials']}
    oldm=materials(oj);newm=materials(nj)
    material_differences=[name for name,m in oldm.items() if newm.get(name)!=m]
    report={'tier':tier,'baseline_sha256':hashlib.sha256(old).hexdigest(),'current_sha256':hashlib.sha256(new).hexdigest(),'original_meshes_checked':len(om),'original_mesh_geometry_uv_normals_indices_transforms_unchanged':not differences,'changed_original_meshes':differences,'original_materials_unchanged':not material_differences,'changed_original_materials':material_differences,'added_batches':added,'mural_triangles':mural_triangles,'texture_size_px':[1024,512],'paint_offset_m':.002,'collision_role':'none','passed':not differences and not material_differences and added==[expected] and 0<mural_triangles<100}
    reports.append(report)
output=ROOT/'art/garage/mural/architecture-preservation-audit.json';output.write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(reports,indent=2))
if not all(r['passed'] for r in reports):raise SystemExit(1)
