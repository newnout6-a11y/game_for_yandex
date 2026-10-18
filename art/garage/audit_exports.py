"""Read-only geometry, material-budget and car-clearance audit of garage GLBs."""
import json, struct, os, hashlib
import numpy as np
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def matrix(node):
    if 'matrix' in node: return np.asarray(node['matrix']).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1]); r=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    m=np.eye(4);m[:3,:3]=r@np.diag(node.get('scale',[1,1,1]));m[:3,3]=node.get('translation',[0,0,0]);return m

def audit(tier):
    path=os.path.join(ROOT,'public','assets','garage','tier%d.glb'%tier);data=open(path,'rb').read(); size,kind=struct.unpack_from('<II',data,12);j=json.loads(data[20:20+size]); offset=20+size; bsize,bkind=struct.unpack_from('<II',data,offset); blob=data[offset+8:offset+8+bsize]
    def accessor(i):
        a=j['accessors'][i];bv=j['bufferViews'][a['bufferView']];dt={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]; start=bv.get('byteOffset',0)+a.get('byteOffset',0);stride=bv.get('byteStride',n*np.dtype(dt).itemsize)
        return np.ndarray((a['count'],n),dtype=dt,buffer=blob,offset=start,strides=(stride,np.dtype(dt).itemsize)).copy()
    positions=[];violations=[];degenerate=[];triangles=0;batches=0
    def walk(index,parent):
        nonlocal triangles,batches
        node=j['nodes'][index]; mat=parent@matrix(node)
        if 'mesh' in node:
            for p in j['meshes'][node['mesh']]['primitives']:
                batches+=1;local=accessor(p['attributes']['POSITION']).astype(np.float64);idx=accessor(p['indices']).reshape(-1,3)
                t=local[idx];ab=t[:,1]-t[:,0];ac=t[:,2]-t[:,0];bc=t[:,2]-t[:,1]
                longest=np.maximum.reduce([np.einsum('ij,ij->i',e,e) for e in (ab,ac,bc)]);cross=np.cross(ab,ac);cross_squared=np.einsum('ij,ij->i',cross,cross)
                collapsed=cross_squared<=longest**2*1e-16
                if collapsed.any(): degenerate.append({'node':node.get('name'),'triangles':int(collapsed.sum()),'exact_zero':int((cross_squared==0).sum())})
                v=(mat@np.c_[local,np.ones(len(local))].T).T[:,:3]; positions.append(v);triangles+=len(idx);t=v[idx];lo=t.min(axis=1);hi=t.max(axis=1)
                hit=(lo[:,0]<1.999)&(hi[:,0]>-1.999)&(lo[:,1]<2.4)&(hi[:,1]>.03)&(lo[:,2]<3.599)&(hi[:,2]>-3.599)
                if hit.any(): violations.append({'node':node.get('name'), 'triangles':int(hit.sum())})
        for c in node.get('children',[]):walk(c,mat)
    scene=j['scenes'][j.get('scene',0)]
    for index in scene['nodes']:walk(index,np.eye(4))
    vertices=np.concatenate(positions); result={'tier':tier,'glb_bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'primitives':batches,'triangles':triangles,'materials':len(j.get('materials',[])),'embedded_images':len(j.get('images',[])),'cameras':len(j.get('cameras',[])),'runtime_lights':len(j.get('extensions',{}).get('KHR_lights_punctual',{}).get('lights',[])),'bounds_m':{'min':np.round(vertices.min(axis=0),5).tolist(),'max':np.round(vertices.max(axis=0),5).tolist()},'root_present':any(n.get('name')=='GARAGE_TIER_%02d'%tier for n in j['nodes']),'car_envelope_violations':violations,'degenerate_triangles':degenerate,'degenerate_relative_cross_squared_threshold':1e-16}
    result['passed']=triangles<=100000 and batches<=40 and result['root_present'] and not violations and not degenerate and result['cameras']==0 and result['runtime_lights']==0
    return result

reports=[]
for tier in range(1,5):
    path=os.path.join(ROOT,'public','assets','garage','tier%d.glb'%tier)
    if os.path.exists(path): reports.append(audit(tier))
with open(os.path.join(ROOT,'art','garage','export-audit.json'),'w') as f:json.dump(reports,f,indent=2)
print(json.dumps(reports,indent=2))
if any(not r['passed'] for r in reports):raise SystemExit(1)
