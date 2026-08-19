# Fetch a real multi-satellite PICTURE composite for one view, exactly as
# js/imagery.js builds it, and save the frames for photopreview.js.
import sys, json, math, base64, datetime, io, urllib.request, urllib.parse
import numpy as np
from PIL import Image
R=6378137.0
def mY(l): return R*math.log(math.tan(math.pi/4+math.radians(l)/2))
def invY(y): return math.degrees(2*math.atan(math.exp(y/R))-math.pi/2)
GIBS='https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi'
EUM='https://view.eumetsat.int/geoserver/wms'
SATS=[{'id':'goes-east','lon':-75.2,'svc':'gibs','step':10,'layer':'GOES-East_ABI_GeoColor','fmt':'image/jpeg'},
      {'id':'goes-west','lon':-137.0,'svc':'gibs','step':10,'layer':'GOES-West_ABI_GeoColor','fmt':'image/jpeg'},
      {'id':'mtg','lon':0.0,'svc':'eum','step':10,'layer':'mtg_fd:rgb_geocolour','fmt':'image/png'},
      {'id':'iodc','lon':45.5,'svc':'eum','step':15,'layer':'msg_iodc:rgb_natural','fmt':'image/png'},
      {'id':'himawari','lon':140.7,'svc':'gibs','step':10,'layer':'Himawari_AHI_Band3_Red_Visible_1km','fmt':'image/png'}]
CUT=0.16
def wAt(sl,lon,lat):
    d=abs(((lon-sl+540)%360)-180)*math.pi/180
    c=math.cos(d)*math.cos(math.radians(lat))-CUT
    return c**3 if c>0 else 0.0
def fetch(sat,bx,pw,ph,mins):
    now=datetime.datetime.now(datetime.timezone.utc)
    bbox=','.join('%f'%v for v in (R*math.radians(bx['w']),mY(bx['s']),R*math.radians(bx['e']),mY(bx['n'])))
    for k in range(0,8):
        t=now-datetime.timedelta(minutes=mins+sat['step']*k)
        t=t.replace(second=0,microsecond=0,minute=t.minute//sat['step']*sat['step'])
        iso=t.strftime('%Y-%m-%dT%H:%M:00')+('.000Z' if sat['svc']=='eum' else 'Z')
        u=((GIBS if sat['svc']=='gibs' else EUM)+'?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
           '&LAYERS='+urllib.parse.quote(sat['layer'])+'&STYLES=&CRS=EPSG:3857&FORMAT='+sat['fmt']
           +('&TRANSPARENT=TRUE' if sat['fmt']=='image/png' else '')
           +'&WIDTH=%d&HEIGHT=%d&BBOX=%s&TIME=%s'%(pw,ph,bbox,iso))
        try: a=np.array(Image.open(io.BytesIO(urllib.request.urlopen(u,timeout=90).read())).convert('RGBA'))
        except Exception: continue
        v=a[...,:3].mean(2)[a[...,3]>250]
        if v.size>50 and (v.max()-v.min())>12: return a,iso
    return None,None
lon,lat,z,outp=float(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3]),sys.argv[4]
W=1024; wpx=512*2**z; m=1.3
r=wpx/(2*math.pi); aH=math.degrees(math.asin(min(1,(745/2)/r))); aV=math.degrees(math.asin(min(1,(700/2)/r)))
span=max(745/wpx*360*m, 2*aH/max(0.25,math.cos(math.radians(lat)))*m)
ys=max(mY(-85),mY(lat)-(mY(min(85,lat+aV))-mY(max(-85,lat-aV)))/2*m)
yn=min(mY(85),mY(lat)+(mY(min(85,lat+aV))-mY(max(-85,lat-aV)))/2*m)
box={'w':lon-span/2,'e':lon+span/2,'s':invY(ys),'n':invY(yn)}
H=max(256,min(1024,int(round(W*(mY(box['n'])-mY(box['s']))/(R*math.radians(box['e']-box['w']))))))
EPS=(box['e']-box['w'])/W
if box['e']>180: parts=[{**box,'e':180.0-EPS},{**box,'w':-180.0+EPS,'e':box['e']-360}]
elif box['w']<-180: parts=[{**box,'w':box['w']+360,'e':180.0-EPS},{**box,'w':-180.0+EPS}]
else: parts=[box]
out={'box':box,'w':W,'h':H,'frames':[]}
for part in parts:
    mid=(part['w']+part['e'])/2; la=(part['s']+part['n'])/2
    for sat in SATS:
        if not (wAt(sat['lon'],mid,la)>0 or wAt(sat['lon'],part['w'],la)>0 or wAt(sat['lon'],part['e'],la)>0): continue
        pw=max(64,int(round((part['e']-part['w'])/(box['e']-box['w'])*W)))
        a,iso=fetch(sat,part,pw,H,10)
        if a is None: print('  MISSING',sat['id']); continue
        out['frames'].append({'id':sat['id'],'lon':sat['lon'],'pw':pw,'box':part,'iso':iso,
                              'data':base64.b64encode(a.astype(np.uint8).tobytes()).decode()})
print('view',json.dumps(box),' %dx%d  parts %d  frames %d'%(W,H,len(parts),len(out['frames'])))
json.dump(out,open(outp,'w'))
