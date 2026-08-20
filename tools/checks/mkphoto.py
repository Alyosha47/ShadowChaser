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
      {'id':'iodc','lon':45.5,'svc':'eum','step':15,'layer':'msg_iodc:rgb_natural','fmt':'image/png',
       'alt':{'layer':'msg_iodc:rgb_eview','fmt':'image/png','desat':True}},
      {'id':'himawari','lon':140.7,'svc':'gibs','step':10,'layer':'Himawari_AHI_Band3_Red_Visible_1km','fmt':'image/png',
       'alt':{'layer':'Himawari_AHI_Band13_Clean_Infrared','fmt':'image/png'}}]

# NIGHT ALTERNATES must be listed here too. BG_FRAMES was once changed in the
# module and not in the harness, so the shipped configuration had never been
# through the harness at all (START-HERE s6). The same trap applies to fmt:
# compose() gates its off-disc black test on image/jpeg, so a frame that does
# not carry its fmt exercises the WRONG branch and the harness silently proves
# nothing.
CUT=0.16
def wAt(sl,lon,lat):
    d=abs(((lon-sl+540)%360)-180)*math.pi/180
    c=math.cos(d)*math.cos(math.radians(lat))-CUT
    return c**3 if c>0 else 0.0
def variants(sat):
    # Mirrors vlist() in js/imagery.js: primary first, night alternate only after
    # the primary has come back blank across the WHOLE window.
    vs=[{'layer':sat['layer'],'fmt':sat['fmt'],'desat':False}]
    if sat.get('alt'):
        a=sat['alt']; vs.append({'layer':a['layer'],'fmt':a['fmt'],'desat':bool(a.get('desat'))})
    return vs
def fetch(sat,bx,pw,ph,mins):
    vs=variants(sat)
    pick=_probe(sat,vs,mins)
    for i in range(pick,len(vs)):
        a,iso=fetch1(sat,vs[i],bx,pw,ph,mins,False)
        if a is not None: return a,iso,vs[i]
    return None,None,None

_PICK={}
def _probe(sat,vs,mins):
    # One decision per satellite, taken over its NADIR box, cached — the module's
    # probe() is keyed on sat.id for the same reason. Deciding per part is what
    # put a hard seam down the antemeridian.
    if sat['id'] in _PICK: return _PICK[sat['id']]
    nb={'w':sat['lon']-10,'e':sat['lon']+10,'s':-5,'n':5}
    pick=0
    for i,v in enumerate(vs):
        a,iso=fetch1(sat,v,nb,64,32,mins,i+1<len(vs))
        if a is not None: pick=i; break
    _PICK[sat['id']]=pick
    return pick
def fetch1(sat,v,bx,pw,ph,mins,more_variants=False):
    now=datetime.datetime.now(datetime.timezone.utc)
    bbox=','.join('%f'%v2 for v2 in (R*math.radians(bx['w']),mY(bx['s']),R*math.radians(bx['e']),mY(bx['n'])))
    for k in range(0,8):
        t=now-datetime.timedelta(minutes=mins+sat['step']*k)
        t=t.replace(second=0,microsecond=0,minute=t.minute//sat['step']*sat['step'])
        iso=t.strftime('%Y-%m-%dT%H:%M:00')+('.000Z' if sat['svc']=='eum' else 'Z')
        u=((GIBS if sat['svc']=='gibs' else EUM)+'?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
           '&LAYERS='+urllib.parse.quote(v['layer'])+'&STYLES=&CRS=EPSG:3857&FORMAT='+v['fmt']
           +('&TRANSPARENT=TRUE' if v['fmt']=='image/png' else '')
           +'&WIDTH=%d&HEIGHT=%d&BBOX=%s&TIME=%s'%(pw,ph,bbox,iso))
        try: a=np.array(Image.open(io.BytesIO(urllib.request.urlopen(u,timeout=90).read())).convert('RGBA'))
        except Exception: continue
        q=a[...,:3].mean(2)[a[...,3]>250]
        # Mirrors hasContent(): spread AND lit-fraction, the latter only while an
        # alternate remains. Without it a terminator frame passes on one lit
        # sliver and the disc composites black.
        dark_ok = True
        if q.size and more_variants:
            dark_ok = (q<4).mean() <= 0.40
        if q.size>50 and (q.max()-q.min())>12 and dark_ok:
            if v.get('desat'):
                # MAX channel, matching desaturate() in the module — luminance
                # crushes rgb_eview to near-black and compose() then drops it.
                g=a[...,:3].max(2); a[...,0]=g; a[...,1]=g; a[...,2]=g
            return a,iso
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
        a,iso,used=fetch(sat,part,pw,H,10)
        if a is None: print('  MISSING',sat['id']); continue
        if used['layer']!=sat['layer']: print('  ALT',sat['id'],'->',used['layer'])
        out['frames'].append({'id':sat['id'],'lon':sat['lon'],'pw':pw,'box':part,'iso':iso,
                              'layer':used.get('layer'),'fmt':used.get('fmt'),
                              'desat':bool(used.get('desat')),
                              'data':base64.b64encode(a.astype(np.uint8).tobytes()).decode()})
print('view',json.dumps(box),' %dx%d  parts %d  frames %d'%(W,H,len(parts),len(out['frames'])))
json.dump(out,open(outp,'w'))
