import sys, json, math, base64, datetime
import numpy as np
from calib import goes, eum, box as mkbox
R=6378137.0; CUT=0.16
def mY(l): return R*math.log(math.tan(math.pi/4+l*math.pi/360))
def iY(y): return math.degrees(2*math.atan(math.exp(y/R))-math.pi/2)
SATS=[dict(id='goes-east',lon=-75.2,svc='gibs',step=10,layer='GOES-East_ABI_Band13_Clean_Infrared'),
      dict(id='goes-west',lon=-137.0,svc='gibs',step=10,layer='GOES-West_ABI_Band13_Clean_Infrared'),
      dict(id='mtg',lon=0.0,svc='eum',step=10,layer='mtg_fd:ir105_hrfi'),
      dict(id='iodc',lon=45.5,svc='eum',step=15,layer='msg_iodc:ir108'),
      dict(id='himawari',lon=140.7,svc='gibs',step=10,layer='Himawari_AHI_Band13_Clean_Infrared')]
GA,GB=-0.38598,57.2375
cm=np.array(json.load(open('cmap.json')),float); cold=cm[cm[:,3]<-11.5]
EUM_T={k:np.array(v) for k,v in json.load(open('eum_temp_lut.json')).items()}
def temp(sat,a):
    r=a[...,0].astype(int); g=a[...,1].astype(int); b=a[...,2].astype(int)
    if sat['svc']=='eum' or sat['id'] in ('mtg','iodc'):
        key='mtg' if sat['id']=='mtg' else 'iodc'
        return EUM_T[key][np.clip((r+g+b)//3,0,255)]
    mx=np.maximum(np.maximum(r,g),b); mn=np.minimum(np.minimum(r,g),b)
    grey=(mx-mn)<=12
    f=np.stack([r,g,b],-1).reshape(-1,3).astype(float)
    d=((f[:,None,:]-cold[None,:,:3])**2).sum(2)
    return np.where(grey,GA*((r+g+b)/3.0)+GB,cold[d.argmin(1),3].reshape(r.shape))
def fetch(sat,bx,pw,ph,mins):
    now=datetime.datetime.utcnow()
    b=(R*math.radians(bx['w']),mY(bx['s']),R*math.radians(bx['e']),mY(bx['n']),pw,ph)
    for k in range(0,7):
        t=(now-datetime.timedelta(minutes=mins+sat['step']*k))
        t=t.replace(second=0,microsecond=0,minute=t.minute//sat['step']*sat['step'])
        iso=t.strftime("%Y-%m-%dT%H:%M:00"+(".000Z" if sat['svc']=='eum' else "Z"))
        try: a=(goes(b,iso,sat['layer']) if sat['svc']=='gibs' else eum(b,iso,sat['layer']))
        except Exception: continue
        if (a[...,3]>250).mean()>0.02: return a
    return None
def wAt(sl,lon,lat):
    d=abs(((lon-sl+540)%360)-180)*math.pi/180
    c=math.cos(math.radians(lat))*math.cos(d)-CUT
    return c**3 if c>0 else 0
lng,lat0=float(sys.argv[1]),float(sys.argv[2]); W,H=1400,900
z=float(sys.argv[3])
worldPx=512*2**z; m=1+2*0.15
lonSpan=W/worldPx*360*m; ySpan=H/worldPx*2*mY(85.0511287798066)*m
if lonSpan>=355: box={'w':-180,'e':180,'s':-85.05,'n':85.05}
else:
    yc=mY(max(-85.05,min(85.05,lat0)))
    box={'w':lng-lonSpan/2,'e':lng+lonSpan/2,
         's':iY(max(mY(-85.05),yc-ySpan/2)),'n':iY(min(mY(85.05),yc+ySpan/2))}
w=1024; h=int(round(w*(mY(box['n'])-mY(box['s']))/(R*math.radians(box['e']-box['w']))))
h=min(h,1024)
parts=[]
if box['e']>180: parts=[{'w':box['w'],'e':180.0,'s':box['s'],'n':box['n']},{'w':-180.0,'e':box['e']-360,'s':box['s'],'n':box['n']}]
elif box['w']<-180: parts=[{'w':box['w']+360,'e':180.0,'s':box['s'],'n':box['n']},{'w':-180.0,'e':box['e'],'s':box['s'],'n':box['n']}]
else: parts=[box]
bgbox={'w':-180.0,'e':180.0,'s':-70.0,'n':70.0}
bw=1024; bh=int(round(bw*(mY(70)-mY(-70))/(R*math.radians(360))))
BG={}
out={'w':w,'h':h,'box':box,'frames':[]}
for part in parts:
    ws=[]
    for sat in SATS:
        mx=0
        for lo in np.linspace(part['w'],part['e'],7):
            for la in np.linspace(part['s'],part['n'],7): mx=max(mx,wAt(sat['lon'],lo,la))
        ws.append((mx,sat))
    ws.sort(key=lambda x:-x[0]); tot=sum(x[0] for x in ws); acc=0; keep=[]
    for mx,sat in ws:
        if mx<=0: break
        keep.append(sat); acc+=mx
        if tot-acc<=tot*0.05: break
    for sat in keep:
        pw=max(64,int(round((part['e']-part['w'])/(box['e']-box['w'])*w)))
        a=fetch(sat,part,pw,h,10)
        if a is None: continue
        if sat['id'] not in BG:
            st=[]
            for day in (1,2,3,4):
                bgf=fetch(sat,bgbox,bw,bh,10+day*1440)
                if bgf is not None: st.append(np.where(bgf[...,3]>250,temp(sat,bgf),-999.0))
            if not st: continue
            S=np.sort(np.stack(st),axis=0); sec=S[-2] if len(st)>1 else S[-1]
            sec=np.where(sec<-900,S[-1],sec)
            BG[sat['id']]={'w':bw,'h':bh,'box':bgbox,
                'T':base64.b64encode(sec.astype(np.float64).tobytes()).decode()}
        out['frames'].append({'id':sat['id'],'pw':pw,'box':part,
            'data':base64.b64encode(a.astype(np.uint8).tobytes()).decode(),'bg':BG[sat['id']]})
json.dump(out,open(sys.argv[4],'w'))
print("view %s  %dx%d  parts %d  frames %d"%(json.dumps({k:round(v,1) for k,v in box.items()}),w,h,len(parts),len(out['frames'])))
