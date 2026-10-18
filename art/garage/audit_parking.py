"""Audit proposed runtime parking volumes against authored triangles. No GLBs edited.
Envelopes cover maximum 5.62 m length, 2.18 m width and a conservative 2.6 m height.
Approved display counts are 1/2/3/3. There are no transverse foreground bays.
"""
import os,json,math
path=os.path.join(os.path.dirname(__file__),'audit_exports.py')
source=open(path).read().split('reports=[]')[0]
source=source.replace('def audit(tier):','def audit(tier, envelope):')
source=source.replace("hit=(lo[:,0]<1.999)&(hi[:,0]>-1.999)&(lo[:,1]<2.4)&(hi[:,1]>.03)&(lo[:,2]<3.599)&(hi[:,2]>-3.599)","xmin,xmax,zmin,zmax=envelope; hit=(lo[:,0]<xmax)&(hi[:,0]>xmin)&(lo[:,1]<2.6)&(hi[:,1]>.03)&(lo[:,2]<zmax)&(hi[:,2]>zmin)")
ns={'__file__':path};exec(source,ns)
slots={2:[{'id':'left','x':-6.2,'z':-.8,'rotationY':0}],3:[{'id':'left','x':-6.2,'z':-.8,'rotationY':0},{'id':'right','x':6.2,'z':-.8,'rotationY':0}],4:[{'id':'left','x':-6.2,'z':-.8,'rotationY':0},{'id':'right','x':6.2,'z':-.8,'rotationY':0}]}
results=[]
for tier,parks in slots.items():
    for p in parks:
        transverse=abs(p['rotationY'])>1;hx=2.81 if transverse else 1.09;hz=1.09 if transverse else 2.81
        env=[p['x']-hx,p['x']+hx,p['z']-hz,p['z']+hz];r=ns['audit'](tier,env)
        results.append({'tier':tier,**p,'y':0,'bounds_xz':env,'maximum_length':5.62,'maximum_width':2.18,'tested_height':2.6,'authored_geometry_conflicts':r['car_envelope_violations'],'passed':not r['car_envelope_violations']})
o={'scope':'Geometry clearance only. Does not establish camera composition, vehicle access/turning routes, dynamic doors, or simultaneous instantiation in runtime.','extra_slots':results,'tier4_note':'Approved counts are 1/2/3/3, including the central selected car. Insert other actually owned cars into the side bays. No foreground parking is authorized or required.'}
json.dump(o,open(os.path.join(os.path.dirname(__file__),'parking-envelope-audit.json'),'w'),indent=2);print(json.dumps(o,indent=2))
if any(not r['passed'] for r in results):raise SystemExit(1)
