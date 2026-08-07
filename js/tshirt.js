/* ── T-shirt map — multi-eclipse poster from the saved log ──────────────
   Renders the umbral bands of the eclipses you've selected in the Log panel
   as a single flat map, and exports it as SVG or PNG.

   PORTED, NOT REWRITTEN. The projection maths, palettes, antimeridian split
   and band construction below are carried across VERBATIM from
   tshirt/umbral_paths.html, which was already working. Do not "tidy" them.

   Two things genuinely changed in the port:
     1. DATA SOURCE. The original fetched two .json.gz files from GitHub and
        gunzipped them in the browser. That is network-only and would break the
        offline promise, so this reads the app's already-precached chunks
        through loadChunk() instead. The DecompressionStream code is gone.
     2. SELECTION. The original listed a whole century for the user to tick
        through. Here the saved log IS the selection.

   Known quirks inherited from the original, left as they were because changing
   them is a behaviour change, not a port (see TODO #F1a):
     - buildBands pairs nSegs[i] with sSegs[i] by index under Math.min. If a
       band's north and south edges split into different segment counts at the
       antimeridian, pieces are dropped silently.
     - It requires BOTH umbra_n and umbra_s, so every one-limit eclipse
       (A+, Tn, As … ~187 of them) is excluded. */


/* Everything below is wrapped in an IIFE. The ported code declares top-level
   const PALETTES / PROJS / DEG / ROB / NE, and a duplicate top-level `const`
   in ANY other script is a fatal SyntaxError that takes the whole app down —
   not a shadowed variable. eclipse.js already has a DEG (function-scoped, so
   harmless today), which is exactly how close this is. Only the handful of
   entry points the markup and userlog.js call are exported. */
(function () {

/* ── Palettes (verbatim) ───────────────────────────────────────────────── */
const PALETTES = {
  midnight:{
    bg:'#070911',panel:'#0a0d16',line:'#1a2030',ink:'#dde3ec',muted:'#7c8699',
    ocean:'#0b1020',land:'#1c2436','land-stroke':'#1c2436',graticule:'#141a2b',
    total:'#e8a04a',annular:'#ff7a3c',hybrid:'#9d8cff',
    blend:'screen','band-opacity':'.40'
  },
  blueprint:{
    bg:'#0a1428',panel:'#091020',line:'#1a2d50',ink:'#c8deff',muted:'#5a7aaa',
    /* land was #0a2040 — 1.01:1 against the ocean, i.e. invisible. Raised to
       1.63:1, still quiet but actually a landmass. */
    ocean:'#0d1f3c',land:'#1a4276','land-stroke':'#1a4276',graticule:'#1a2d50',
    total:'#ffffff',annular:'#ffe066',hybrid:'#00e5ff',
    blend:'screen','band-opacity':'.55'
  },
  mono:{
    bg:'#ffffff',panel:'#f5f5f5',line:'#dddddd',ink:'#111111',muted:'#666666',
    ocean:'#f0f0f0',land:'#d8d8d8','land-stroke':'#d8d8d8',graticule:'#cccccc',
    total:'#000000',annular:'#000000',hybrid:'#000000',
    blend:'normal','band-opacity':'.70'
  },
  tshirt:{
    bg:'#ffffff',panel:'#f0f0f0',line:'#cccccc',ink:'#1a237e',muted:'#5566aa',
    ocean:'#0d3b7a',land:'#4a7c3f','land-stroke':'#4a7c3f',graticule:'#0d47a1',
    total:'#cc2200',annular:'#cc2200',hybrid:'#cc2200',
    'label-color':'#ffd600',
    blend:'normal','band-opacity':'1.0','label-mode':'1'
  }
};

/* ── Projection maths (verbatim) ───────────────────────────────────────── */
//  PROJECTIONS 
const DEG=Math.PI/180;

const ROB=[
  [1.0000,0.0000],[0.9986,0.0620],[0.9954,0.1243],[0.9900,0.1863],
  [0.9822,0.2480],[0.9730,0.3094],[0.9600,0.3700],[0.9427,0.4305],
  [0.9216,0.4865],[0.8962,0.5416],[0.8679,0.5966],[0.8350,0.6482],
  [0.7986,0.6978],[0.7597,0.7366],[0.7186,0.7986],[0.6732,0.8428],
  [0.6213,0.8833],[0.5722,0.9216],[0.5322,0.9512]
];
function robInterp(lat){
  const a=Math.abs(lat),i=Math.min(Math.floor(a/5),17),t=(a-i*5)/5;
  const px=ROB[i][0]+(ROB[i+1][0]-ROB[i][0])*t;
  const py=(ROB[i][1]+(ROB[i+1][1]-ROB[i][1])*t)*(lat<0?-1:1);
  return[px,py];
}

const NE=[
  [1.0000,0.0000],[0.9988,0.0620],[0.9953,0.1240],[0.9894,0.1860],
  [0.9811,0.2480],[0.9703,0.3100],[0.9570,0.3720],[0.9409,0.4340],
  [0.9222,0.4958],[0.9003,0.5571],[0.8752,0.6176],[0.8467,0.6769],
  [0.8150,0.7346],[0.7800,0.7903],[0.7419,0.8435],[0.7007,0.8936],
  [0.6564,0.9394],[0.6088,0.9761],[0.5571,1.0000]
];
function neInterp(lat){
  const a=Math.abs(lat),i=Math.min(Math.floor(a/5),17),t=(a-i*5)/5;
  const px=NE[i][0]+(NE[i+1][0]-NE[i][0])*t;
  const py=(NE[i][1]+(NE[i+1][1]-NE[i][1])*t)*(lat<0?-1:1);
  return[px,py];
}

const PROJS={
  /* Equal Earth (Savric, Patterson & Jenny 2019): equal-area, and the least
     distorted-looking of the equal-area family. Closed form. */
  equalearth:{
    project(lon,lat){
      const A=[1.340264,-0.081106,0.000893,0.003796];
      const th=Math.asin(Math.sqrt(3)/2*Math.sin(lat*DEG));
      const t2=th*th, t6=t2*t2*t2;
      const y=th*(A[0]+A[1]*t2+t6*(A[2]+A[3]*t2));
      const x=lon*DEG*Math.cos(th)/(Math.sqrt(3)/2*(A[0]+3*A[1]*t2+t6*(7*A[2]+9*A[3]*t2)));
      return[x*57.29578,-y*57.29578];
    },
    viewBox:'-165 -85 330 170',
    frame(el){
      const pts=[],rp=[];
      for(let lat=-90;lat<=90;lat+=2){pts.push(this.project(180,lat).join(' '));}
      for(let lat=90;lat>=-90;lat-=2){rp.push(this.project(-180,lat).join(' '));}
      el.innerHTML='<path class="frame" d="M'+pts.concat(rp).join('L')+'Z"/>';
    },
    gratLines(){
      let g='';
      for(let lon=-150;lon<=150;lon+=30){const p=[];
        for(let lat=-90;lat<=90;lat+=3)p.push(this.project(lon,lat).join(' '));
        g+='<polyline class="graticule" points="'+p.join(' ')+'"/>';}
      for(let lat=-60;lat<=60;lat+=30){const p=[];
        for(let lon=-180;lon<=180;lon+=5)p.push(this.project(lon,lat).join(' '));
        g+='<polyline class="graticule" points="'+p.join(' ')+'"/>';}
      return g;
    },
    label:'Equal Earth'
  },
  sinusoidal:{
    project(lon,lat){return[lon*Math.cos(lat*DEG),-lat];},
    viewBox:'-185 -95 370 190',
    frame(el){
      const pts=[],rp=[];
      for(let lat=-90;lat<=90;lat+=2)pts.push((180*Math.cos(lat*DEG))+' '+(-lat));
      for(let lat=90;lat>=-90;lat-=2)rp.push((-180*Math.cos(lat*DEG))+' '+(-lat));
      el.innerHTML='<path class="frame" d="M'+pts.concat(rp).join('L')+'Z"/>';
    },
    gratLines(){
      let g='';
      for(let lon=-150;lon<=150;lon+=30){const p=[];
        for(let lat=-90;lat<=90;lat+=3)p.push((lon*Math.cos(lat*DEG))+' '+(-lat));
        g+='<polyline class="graticule" points="'+p.join(' ')+'"/>';}
      return g;
    },
    label:'Sinusoidal'
  },
  plate:{
    project(lon,lat){return[lon,-lat];},
    viewBox:'-180 -90 360 180',
    frame(el){el.innerHTML='<path class="frame" d="M-180 -90L180 -90L180 90L-180 90Z"/>';},
    gratLines(){
      let g='';
      for(let lon=-150;lon<=150;lon+=30) g+=`<line class="graticule" x1="${lon}" y1="-90" x2="${lon}" y2="90"/>`;
      for(let lat=-60;lat<=60;lat+=30) g+=`<line class="graticule" x1="-180" y1="${-lat}" x2="180" y2="${-lat}"/>`;
      return g;
    },
    label:'Plate Carree'
  },
  robinson:{
    project(lon,lat){const[px,py]=robInterp(lat);return[lon*px*0.8487,-py*1.3523*90];},
    viewBox:'-155 -118 310 236',
    frame(el){
      const pts=[];
      for(let lat=-90;lat<=90;lat+=2){const[px,py]=robInterp(lat);pts.push(180*px*0.8487+' '+(-py*1.3523*90));}
      const rpts=[];
      for(let lat=90;lat>=-90;lat-=2){const[px,py]=robInterp(lat);rpts.push((-180*px*0.8487)+' '+(-py*1.3523*90));}
      el.innerHTML=`<path class="frame" d="M${[...pts,...rpts].join('L')}Z"/>`;
    },
    gratLines(){
      let g='';
      for(let lon=-150;lon<=150;lon+=30){
        const pts=[];
        for(let lat=-90;lat<=90;lat+=5){const[px,py]=robInterp(lat);pts.push(`${(lon*px*0.8487).toFixed(2)},${(-py*1.3523*90).toFixed(2)}`);}
        g+=`<polyline class="graticule" points="${pts.join(' ')}" fill="none"/>`;
      }
      for(let lat=-60;lat<=60;lat+=30){
        const[px,py]=robInterp(lat);const y=(-py*1.3523*90).toFixed(2),x=(180*px*0.8487).toFixed(2);
        g+=`<line class="graticule" x1="${-x}" y1="${y}" x2="${x}" y2="${y}"/>`;
      }
      return g;
    },
    label:'Robinson'
  },
  mollweide:{
    project(lon,lat){
      /* PORT FIX (not in the original): the Newton step divides by
         2+2cos(2th), which is ZERO at th=+-pi/2 — so lat +-90 returned NaN and
         any band or graticule touching a pole produced a broken path. The
         solution there is exact (th = +-pi/2), so clamp instead of iterating. */
      const R=90/Math.sqrt(2);
      if(Math.abs(lat)>=90-1e-9){
        const th=(lat>0?1:-1)*Math.PI/2;
        return[0,-Math.SQRT2*Math.sin(th)*R];
      }
      let th=lat*DEG;const sinLat=Math.sin(lat*DEG);
      for(let i=0;i<10;i++){const dth=(2*th+Math.sin(2*th)-Math.PI*sinLat)/(2+2*Math.cos(2*th));th-=dth;if(Math.abs(dth)<1e-6)break;}
      return[2*Math.SQRT2*lon*DEG*Math.cos(th)/Math.PI*R,-Math.SQRT2*Math.sin(th)*R];
    },
    viewBox:'-182 -92 364 184',
    frame(el){
      const R=90/Math.sqrt(2),a=(2*Math.SQRT2*R).toFixed(2),b=(Math.SQRT2*R).toFixed(2);
      el.innerHTML=`<ellipse class="frame" cx="0" cy="0" rx="${a}" ry="${b}"/>`;
    },
    gratLines(){
      const wp=(lon,lat)=>{
        let th=lat*DEG;const sinLat=Math.sin(lat*DEG);
        for(let i=0;i<10;i++){const dth=(2*th+Math.sin(2*th)-Math.PI*sinLat)/(2+2*Math.cos(2*th));th-=dth;if(Math.abs(dth)<1e-6)break;}
        const R=90/Math.sqrt(2);
        return[2*Math.SQRT2*lon*DEG*Math.cos(th)/Math.PI*R,-Math.SQRT2*Math.sin(th)*R];
      };
      let g='';
      for(let lon=-150;lon<=150;lon+=30){const pts=[];for(let lat=-88;lat<=88;lat+=4){const[x,y]=wp(lon,lat);pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);}g+=`<polyline class="graticule" points="${pts.join(' ')}" fill="none"/>`;}
      for(let lat=-60;lat<=60;lat+=30){const pts=[];for(let lon=-180;lon<=180;lon+=5){const[x,y]=wp(lon,lat);pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);}g+=`<polyline class="graticule" points="${pts.join(' ')}" fill="none"/>`;}
      return g;
    },
    label:'Mollweide'
  },
  winkel:{
    project(lon,lat){
      const la=lat*DEG,lo=lon*DEG;
      const a=Math.acos(Math.max(-1,Math.min(1,Math.cos(la)*Math.cos(lo/2))));
      const sinc=a<1e-8?1:Math.sin(a)/a;
      return[(lo*2/Math.PI+2*Math.cos(la)*Math.sin(lo/2)/sinc)/2*57,-(la+Math.sin(la)/sinc)/2*57];
    },
    viewBox:'-183.07 -93.54 366.14 187.08',
    frame(el){
      // Pre-computed exact boundary for Winkel Tripel at scale=57
      const wp=(lon,lat)=>{const la=lat*DEG,lo=lon*DEG;const a=Math.acos(Math.max(-1,Math.min(1,Math.cos(la)*Math.cos(lo/2))));const sinc=a<1e-8?1:Math.sin(a)/a;return[(lo*2/Math.PI+2*Math.cos(la)*Math.sin(lo/2)/sinc)/2*57,-(la+Math.sin(la)/sinc)/2*57];};
      const pts=[];
      for(let lat=-90;lat<=90;lat+=2){const[x,y]=wp(180,lat);pts.push(`${x.toFixed(3)} ${y.toFixed(3)}`);}
      for(let lon=180;lon>=-180;lon-=2){const[x,y]=wp(lon,90);pts.push(`${x.toFixed(3)} ${y.toFixed(3)}`);}
      for(let lat=90;lat>=-90;lat-=2){const[x,y]=wp(-180,lat);pts.push(`${x.toFixed(3)} ${y.toFixed(3)}`);}
      for(let lon=-180;lon<=180;lon+=2){const[x,y]=wp(lon,-90);pts.push(`${x.toFixed(3)} ${y.toFixed(3)}`);}
      el.innerHTML=`<path class="frame" d="M${pts.join('L')}Z"/>`;
    },
    gratLines(){
      const wp=(lon,lat)=>{const la=lat*DEG,lo=lon*DEG;const a=Math.acos(Math.max(-1,Math.min(1,Math.cos(la)*Math.cos(lo/2))));const sinc=a<1e-8?1:Math.sin(a)/a;return[(lo*2/Math.PI+2*Math.cos(la)*Math.sin(lo/2)/sinc)/2*57,-(la+Math.sin(la)/sinc)/2*57];};
      let g='';
      for(let lon=-150;lon<=150;lon+=30){const pts=[];for(let lat=-88;lat<=88;lat+=4){const[x,y]=wp(lon,lat);pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);}g+=`<polyline class="graticule" points="${pts.join(' ')}" fill="none"/>`;}
      for(let lat=-60;lat<=60;lat+=30){const pts=[];for(let lon=-180;lon<=180;lon+=5){const[x,y]=wp(lon,lat);pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);}g+=`<polyline class="graticule" points="${pts.join(' ')}" fill="none"/>`;}
      return g;
    },
    label:'Winkel Tripel'
  },
  natearth:{
    project(lon,lat){const[px,py]=neInterp(lat);return[lon*px*0.87,-py*1.244*90];},
    viewBox:'-159 -114 318 228',
    frame(el){
      const pts=[];
      for(let lat=-90;lat<=90;lat+=2){const[px,py]=neInterp(lat);pts.push(180*px*0.87+' '+(-py*1.244*90));}
      const rpts=[];
      for(let lat=90;lat>=-90;lat-=2){const[px,py]=neInterp(lat);rpts.push((-180*px*0.87)+' '+(-py*1.244*90));}
      el.innerHTML=`<path class="frame" d="M${[...pts,...rpts].join('L')}Z"/>`;
    },
    gratLines(){
      let g='';
      for(let lon=-150;lon<=150;lon+=30){const pts=[];for(let lat=-90;lat<=90;lat+=5){const[px,py]=neInterp(lat);pts.push(`${(lon*px*0.87).toFixed(2)},${(-py*1.244*90).toFixed(2)}`);}g+=`<polyline class="graticule" points="${pts.join(' ')}" fill="none"/>`;}
      for(let lat=-60;lat<=60;lat+=30){const[px,py]=neInterp(lat);const y=(-py*1.244*90).toFixed(2),x=(180*px*0.87).toFixed(2);g+=`<line class="graticule" x1="${-x}" y1="${y}" x2="${x}" y2="${y}"/>`;}
      return g;
    },
    label:'Natural Earth'
  }
};

var currentProj = 'natearth';
/* Central meridian. Rotation MUST happen before unwrapping and clipping — a
   band that didn't cross the seam at 0 may cross it at 150, and vice versa, so
   rotating at project time would tear things the clipper had already fixed. */
var currentLon0 = 0;
function rotLon(lon) { return ((lon - currentLon0 + 180) % 360 + 360) % 360 - 180; }
function rotRing(ring) {
  return ring.map(function (p) { return [rotLon(p[0]), p[1]]; });
}
var currentPalette = 'tshirt';

function pathFromPts(pts){
  if(!pts||pts.length<2)return'';
  return'M'+pts.map(p=>p[0].toFixed(2)+' '+p[1].toFixed(2)).join('L')+'Z';
}

function projectPiece(piece,proj){
  // Project piece; emit M at antimeridian jumps (>90 deg screen-space lon jump)
  const pts=piece.map(([lon,lat])=>proj.project(lon,lat));
  if(pts.length<2)return'';
  let d='M'+pts[0][0].toFixed(2)+' '+pts[0][1].toFixed(2);
  for(let i=1;i<pts.length;i++){
    // Check for antimeridian jump in source coords
    if(Math.abs(piece[i][0]-piece[i-1][0])>90){
      d+='Z M'+pts[i][0].toFixed(2)+' '+pts[i][1].toFixed(2);
    } else {
      d+='L'+pts[i][0].toFixed(2)+' '+pts[i][1].toFixed(2);
    }
  }
  return d+'Z';
}

function splitAndProject(lonlats){
  if(!lonlats||!lonlats.length)return[];
  const segs=[];let cur=[lonlats[0]];
  for(let i=1;i<lonlats.length;i++){
    if(Math.abs(lonlats[i][0]-lonlats[i-1][0])>90){if(cur.length>1)segs.push(cur);cur=[lonlats[i]];}
    else cur.push(lonlats[i]);
  }
  if(cur.length>1)segs.push(cur);
  const proj=PROJS[currentProj];
  return segs.map(seg=>seg.map(([lon,lat])=>proj.project(lon,lat)));
}

/* ── Antimeridian split + band construction (verbatim) ─────────────────── */
function splitEdge(pts){
  if(!pts||!pts.length)return[];
  const norm=lon=>{while(lon>180)lon-=360;while(lon<-180)lon+=360;return lon;};
  const segs=[];let cur=[[norm(pts[0][0]),pts[0][1]]];
  for(let i=1;i<pts.length;i++){
    const plon=norm(pts[i-1][0]),clon=norm(pts[i][0]);
    if(Math.abs(clon-plon)>180){if(cur.length>1)segs.push(cur);cur=[[clon,pts[i][1]]];}
    else cur.push([clon,pts[i][1]]);
  }
  if(cur.length>1)segs.push(cur);
  return segs;
}

/* Original signature was buildBands(all, yearMin, yearMax) — the year window
   was the selection. It now takes the records already chosen from the log, so
   the only filtering left is "is this drawable as a band". */

/* ── The corridor is a RIBBON, not a polygon ───────────────────────────
   Everything before this treated the umbral corridor as one closed polygon:
   north limb out, south limb back. That forces you to reason globally about
   winding number, antimeridian crossings and polar caps, and every one of those
   needs a threshold that is wrong for some eclipse. It produced, in order: torn
   bands, wedges to the seam, caps flooding the pole, and an even-odd annulus
   with a hand-tuned trigger.

   The corridor is not one polygon. At each instant the umbra spans from the
   south limit to the north limit, so the swept region is a ribbon of QUADS:
   [n(t), n(t+1), s(t+1), s(t)]. Each quad is a few degrees across. It cannot
   wrap the globe, cannot enclose a pole, cannot wind. Emitting every quad as a
   subpath of ONE path with nonzero fill unions them into the corridor, and the
   only case left to handle is a quad that straddles the seam — which is local
   and trivial.

   No thresholds. No special cases for poles. */

/* Squared distance in a locally-flat frame — longitude compressed by latitude,
   so "nearest" means nearest on the globe, not nearest in raw degrees. */
function ptGap(a, b) {
  var dLon = b[0] - a[0];
  while (dLon >  180) dLon -= 360;
  while (dLon < -180) dLon += 360;
  var k = Math.cos((a[1] + b[1]) / 2 * DEG);
  var x = dLon * k, y = b[1] - a[1];
  return x * x + y * y;
}

/* Pair the two limbs by TIME, not by proximity.

   Both limbs are sampled in time order along the same eclipse, so the vertex
   opposite n(t) is s(t) — the normalised index IS the time parameter. An
   earlier version paired by nearest distance instead, which fails exactly where
   it matters: near a pole the true partner across the corridor is a few degrees
   away but at a completely different longitude, while some non-corresponding
   point is closer in space. That collapsed the corridor near the pole, drawing
   31 degrees of longitude at latitude 89 where the geometry demands 237.

   Where the two limbs cover different spans — a limb running off the disc is
   shorter than its partner — time pairing gives implausible pairs, and those
   are caught by the physical width bound in emitQuad rather than by trying to
   be clever here. */
function limbAt(limb, f) {
  var x = f * (limb.length - 1);
  var i = Math.min(limb.length - 2, Math.max(0, Math.floor(x)));
  var t = x - i, a = limb[i], b = limb[i + 1];
  var dLon = b[0] - a[0];
  while (dLon >  180) dLon -= 360;
  while (dLon < -180) dLon += 360;
  return [a[0] + dLon * t, a[1] + (b[1] - a[1]) * t];
}

/* ── Repairing the pole ────────────────────────────────────────────────
   Cross-sections degenerate near a pole: for 2015-03-20 the last pair sits at
   longitude -53 and +111 — 164 degrees apart, though only 3.7 degrees apart on
   the globe. Any quad joining them is a long thin sliver, which is the notch at
   the tip and the centreline escaping through it.

   The CENTRELINE never degenerates: it is a smooth track all the way up. So
   where the cross-section misbehaves, keep the centreline and rebuild the pair
   as centre +- half the last good width, offset PERPENDICULAR to the track.

   This is the cartoon part, and it is deliberate: the poster is a print, not a
   navigation chart. Away from the pole the real limbs are used unchanged, so
   the band is exact everywhere it can be. */

/* Bearing from a to b, degrees clockwise from north. */
function bearing(a, b) {
  var la1 = a[1]*DEG, la2 = b[1]*DEG, dl = (b[0]-a[0])*DEG;
  var y = Math.sin(dl)*Math.cos(la2);
  var x = Math.cos(la1)*Math.sin(la2) - Math.sin(la1)*Math.cos(la2)*Math.cos(dl);
  return Math.atan2(y, x) / DEG;
}

/* Point `d` degrees of great circle from `p` along `brg`. */
function offsetPt(p, brg, d) {
  var la = p[1]*DEG, lo = p[0]*DEG, ad = d*DEG, th = brg*DEG;
  var la2 = Math.asin(Math.sin(la)*Math.cos(ad) + Math.cos(la)*Math.sin(ad)*Math.cos(th));
  var lo2 = lo + Math.atan2(Math.sin(th)*Math.sin(ad)*Math.cos(la),
                            Math.cos(ad) - Math.sin(la)*Math.sin(la2));
  return [lo2/DEG, la2/DEG];
}

function pairWalk(nLimb, sLimb) {
  var steps = Math.max(nLimb.length, sLimb.length) - 1;
  if (steps < 1) return [];
  var pairs = [];
  for (var i = 0; i <= steps; i++) {
    var f = i / steps;
    pairs.push([limbAt(nLimb, f), limbAt(sLimb, f)]);
  }
  pairs = repairDegenerate(pairs, centreOf(pairs));
  /* Drop the final cross-section when it was reconstructed. It is the most
     extreme one — the very tip of the track — and its outer corner is what
     leaves a V-notch in the band's edge. One step is ~0.02 degrees of track;
     losing it is invisible, keeping it is not. */
  if (pairs.length > 3 && pairs[pairs.length - 1].rebuilt) pairs.pop();
  return pairs;
}

/* The track's own centreline, from the midpoint of each cross-section. Used
   only where the cross-section is sane; that is exactly where the midpoint is
   trustworthy. */
function centreOf(pairs) {
  return pairs.map(function (pr) {
    var d = pr[1][0] - pr[0][0];
    while (d >  180) d -= 360;
    while (d < -180) d += 360;
    return [pr[0][0] + d/2, (pr[0][1] + pr[1][1]) / 2];
  });
}

/* A cross-section is degenerate when its two ends are far apart in longitude
   while being close on the globe — the signature of straddling the pole. */
function isDegenerate(pr) {
  var d = Math.abs(pr[0][0] - pr[1][0]);
  while (d > 180) d = 360 - d;
  return d > 60 && angSep(pr[0], pr[1]) < MAX_CORRIDOR_DEG;
}

function repairDegenerate(pairs, centre) {
  /* Rebuild a few steps BEFORE the first degenerate one as well. Switching
     construction abruptly leaves a notch in the band's edge where the measured
     cross-section and the reconstructed one don't line up; easing in over a few
     steps hides the join. */
  var bad = pairs.map(isDegenerate);
  for (var i = 0; i < bad.length; i++) {
    if (!bad[i]) continue;
    for (var k = Math.max(0, i - 4); k < i; k++) bad[k] = true;
    break;
  }
  /* Last width measured on a well-behaved cross-section, carried forward.
     Width changes slowly along a track, so this is a good approximation
     exactly where the measurement itself has broken down. */
  var lastW = null, out = [];
  for (var i = 0; i < pairs.length; i++) {
    if (!bad[i]) {
      lastW = angSep(pairs[i][0], pairs[i][1]);
      out.push(pairs[i]);
      continue;
    }
    if (lastW === null) { out.push(pairs[i]); continue; }  /* nothing to go on */

    /* Rebuild as centre +- half the carried width, square to the track. */
    var c  = centre[i];
    var pv = centre[Math.max(0, i - 1)], nx = centre[Math.min(centre.length - 1, i + 1)];
    var brg = bearing(pv, nx);
    var pr2 = [offsetPt(c, brg - 90, lastW / 2), offsetPt(c, brg + 90, lastW / 2)];
    pr2.rebuilt = true;      /* so the midline can stop before this section */
    out.push(pr2);
  }
  return out;
}

/* Put a quad's longitudes in one local frame: no vertex more than 180 from the
   first. A quad spanning the seam then has vertices outside +-180, which the
   strip emitter deals with. */
function localFrame(q) {
  var base = q[0][0];
  return q.map(function (p) {
    var lon = p[0];
    while (lon - base >  180) lon -= 360;
    while (lon - base < -180) lon += 360;
    return [lon, p[1]];
  });
}

/* Emit a quad into every 360-strip it touches, shifted into +-180 each time. A
   quad wholly inside one strip yields itself; one straddling the seam yields it
   in both, each correctly placed. Vertices past the edge are drawn past it and
   hidden by the map clip — exact for a shape this small, and it avoids needing
   a polygon clipper at all. */
function quadStrips(q) {
  var lons = q.map(function (p) { return p[0]; });
  var kMin = Math.floor((Math.min.apply(null, lons) + 180) / 360);
  var kMax = Math.floor((Math.max.apply(null, lons) + 180) / 360);
  var out = [];
  for (var k = kMin; k <= kMax; k++) {
    out.push(q.map(function (p) { return [p[0] - 360 * k, p[1]]; }));
  }
  return out;
}

/* The ribbon: one quad per step of the paired walk. */
function ribbonQuads(nLimb, sLimb, outPairs) {
  var pairs = pairWalk(nLimb, sLimb);
  if (outPairs) pairs.forEach(function (pr) { outPairs.push(pr); });
  var quads = [];

  for (var i = 1; i < pairs.length; i++) {
    var a = pairs[i - 1], b = pairs[i];

    /* Near a pole the track's longitude changes very fast — a single time step
       can move 100 degrees — so one step becomes a very wide quad. An earlier
       version DROPPED those as suspected bad pairings, which is what left the
       gap at the top of the map: the guard was eating real geometry.
       Subdivide instead. The step is genuine, it just needs more quads to
       follow the curve, and the sub-quads stay narrow so every ribbon property
       still holds. */
    var q0   = localFrame([a[0], b[0], b[1], a[1]]);
    var lons = q0.map(function (p) { return p[0]; });
    var span = Math.max.apply(null, lons) - Math.min.apply(null, lons);
    var subs = Math.max(1, Math.ceil(span / 15));

    /* Cap the subdivision: a step needing more than this is not a fast polar
       crossing, it is a pairing that genuinely went wrong, and drawing it would
       be worse than leaving it out. */
    if (subs > 40) continue;

    for (var k = 0; k < subs; k++) {
      var t0 = k / subs, t1 = (k + 1) / subs;
      var nA = lerpPt(a[0], b[0], t0), nB = lerpPt(a[0], b[0], t1);
      var sA = lerpPt(a[1], b[1], t0), sB = lerpPt(a[1], b[1], t1);
      emitQuad(nA, nB, sB, sA, quads);
    }
  }
  return quads;
}

/* One step of the ribbon.

   Normally this is a single quad between the two limbs. The exception is when
   the corridor SPANS A POLE: at the same instant the north and south limits are
   then on opposite sides of it, so their longitudes differ by ~180 and a flat
   quad joining them sweeps right across the map instead of passing over the
   top. Detect it locally — wide in longitude, and both limbs at high latitude —
   and emit two quads, each running from its own limb up to the pole. They meet
   there, which is exactly how the corridor closes on the globe.

   No global reasoning: this only ever looks at the four corners in hand. */
/* The widest path in Espenak's catalogue is 1419 km — 12.8 degrees of great
   circle. So two limb points further apart than this CANNOT be opposite sides
   of the same corridor: the pairing has failed, usually because one limb only
   exists for part of the track (-1790-09-08 has a north limit spanning latitude
   77.8-90 with 91 points against a south limit spanning 28.1-84.5 with 578).
   Drawing a quad across that invents a corridor that isn't there. A physical
   bound taken from the data, not a tuned threshold. */
var MAX_CORRIDOR_DEG = 14;

function emitQuad(nA, nB, sB, sA, out) {
  var push = function (q) {
    quadStrips(localFrame(q)).forEach(function (piece) { out.push(piece); });
  };

  /* Is the corridor spanning the pole here? Not a latitude threshold — ask the
     geometry. An umbral corridor is at most a few hundred kilometres wide, so
     if the two limits are CLOSE on the globe yet far apart in longitude, the
     only way that can be true is that the pole lies between them. Anything
     else — a wide longitude gap with a correspondingly large real distance —
     is a bad pairing, not a polar crossing, and must not be capped. */
  var sep = angSep(nA, sA);          /* true angular separation, degrees */
  if (sep > MAX_CORRIDOR_DEG) return;              /* not a corridor here */

  /* The corridor is drawn only where the two limbs actually are. It is NOT
     extended up to the pole, even on the steps where the umbra genuinely covers
     it: filling to latitude 90 emits a quad per step at its own longitudes, and
     consecutive steps don't abut, so the result is a striped bar across the top
     of an equirectangular map — worse than showing nothing there.
     This follows the precedent already set in map.js, which drops polar ovals
     with the note "omitting is honest". The band is exact everywhere the limbs
     exist; above them it simply stops. */
  push([nA, nB, sB, sA]);
}

/* Angular separation between two lon/lat points, in degrees. */
function angSep(a, b) {
  var la1 = a[1] * DEG, la2 = b[1] * DEG, dl = (b[0] - a[0]) * DEG;
  var c = Math.sin(la1) * Math.sin(la2)
        + Math.cos(la1) * Math.cos(la2) * Math.cos(dl);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/* Interpolate between two lon/lat points, taking the short way round in
   longitude so a pair either side of the seam doesn't sweep the world. */
function lerpPt(a, b, t) {
  var dLon = b[0] - a[0];
  while (dLon >  180) dLon -= 360;
  while (dLon < -180) dLon += 360;
  return [a[0] + dLon * t, a[1] + (b[1] - a[1]) * t];
}

function buildBands(records){
  const typeMap={T:'total',A:'annular',H:'hybrid'};
  return records
    .filter(r=>'TAH'.includes((r.type||'')[0])&&
               r.umbra_n&&r.umbra_s&&r.umbra_n[0]&&r.umbra_s[0])
    .map(r=>{
      const nRaw=r.umbra_n[0], sRaw=r.umbra_s[0];
      if(nRaw.length<2||sRaw.length<2)return null;
      /* Where the CENTRELINE runs closer to the pole than either limb, the limb
         data has simply stopped — both limbs end at their own poleward extreme
         and the corridor carries on past them. Left alone, the map shows a
         centreline reaching the top with no band around it. Extend each limb
         along its own final longitude to the pole so the ribbon closes the gap;
         the quads stay contiguous, so no striping. */
      /* NOT extended to the pole. Appending points along each limb's final
         longitude was tried (both limbs run to latitude 90): in projections
         where the pole is a point the two extensions converge, leaving a ragged
         notch at the tip and a pinch the centreline shows through. The band is
         drawn only where the limb data actually is; the centreline is trimmed
         to match, below, so nothing is left hanging. */
      /* One quad per time step. No unwrapping, no ring assembly, no polar caps,
         no annulus, no thresholds — see the ribbon note above. */
      const pairs=[];
      const pieces=ribbonQuads(rotRing(nRaw), rotRing(sRaw), pairs);
      if(!pieces.length)return null;
      const date=`${r.year}-${String(r.month).padStart(2,'0')}-${String(r.day).padStart(2,'0')}`;
      /* The centreline is the RIBBON'S OWN midline — the midpoint of each
         cross-section — not the separately-supplied centreline track. Drawn
         from the same pairs that build the band, it is inside it by
         construction, so it can never poke out at the tip. (It coincides with
         the supplied centreline wherever the cross-sections are real, which is
         everywhere except the polar tail.) The two end points are dropped so
         the line stops just short of the band's blunt end rather than touching
         it. */
      /* Stop the midline before the rebuilt section. Through the polar tail the
         cross-sections are reconstructed rather than measured, and the midline
         there swings as the construction takes over — a visible hook at the
         tip. The band still runs to the end; the line just doesn't chase it
         into the part that is drawn rather than computed. */
      let lastReal=pairs.length;
      while(lastReal>0 && pairs[lastReal-1].rebuilt) lastReal--;
      const mid=centreOf(pairs.slice(0,lastReal));
      const clSegs=mid.length>4
        ? splitEdge(mid.slice(1,-1)).filter(x=>x.length>1)
        : null;
      return{id:r.cat_no||date,date,year:r.year,
             type:typeMap[r.type[0]]||'total',pieces,clSegs};
    })
    .filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
}



/* ── Data: the app's precached chunks, not the network ─────────────────── */

/* The log gives us catalogue entries; the bands need PATH records, which live
   in data/paths chunks. map.js ALREADY has loadPathChunk(entry) — with the
   DecompressionStream handling and its own cache — so this uses it rather than
   growing a second loader. (An earlier draft of this file defined its own
   loadPathChunk, which would have silently overwritten map.js's, since both are
   plain globals. Standing rule: use the existing API.)

   Group by chunk so a log spanning three centuries costs three loads, not one
   per eclipse. */
function tsLoadPathRecords(rows) {
  var byChunk = {};
  rows.forEach(function (r) {
    var ck = r.rec && r.rec._chunk;
    if (!ck) return;
    (byChunk[ck] = byChunk[ck] || []).push(r);
  });

  var keys = Object.keys(byChunk);
  if (!keys.length) return Promise.resolve([]);

  return Promise.all(keys.map(function (ck) {
    var sample = byChunk[ck][0].rec;
    return loadPathChunk(sample).then(function (paths) {
      if (!paths) return [];
      return byChunk[ck].map(function (r) { return paths[r.key] || null; })
                        .filter(Boolean);
    }).catch(function () { return []; });
  })).then(function (groups) {
    return groups.reduce(function (a, b) { return a.concat(b); }, []);
  });
}

/* ── Render ────────────────────────────────────────────────────────────
   Ported from renderMap() in tshirt/umbral_paths.html. An earlier draft of this
   file wrote its own renderer and lost LAND, CENTRELINES and DATE LABELS, and
   mangled Plate Carree by using splitAndProject/pathFromPts (which closes every
   segment with Z) instead of projectPiece (which breaks the path with M at an
   antimeridian jump and closes once). Use projectPiece for band pieces. */

/* Land comes from the app's own precached land.geojson.gz — the same polygons
   the offline globe draws — rather than the 1.9 MB the original embedded. It is
   pre-clipped to a 5-degree grid (see map.js), which suits reprojection well:
   short polygons distort less. */
function tsLandRings(basemap) {
  var out = [];
  if (!basemap || !basemap.land || !basemap.land.features) return out;
  basemap.land.features.forEach(function (f) {
    var g = f.geometry;
    if (!g) return;
    if (g.type === 'Polygon')            out.push(g.coordinates[0]);
    else if (g.type === 'MultiPolygon')  g.coordinates.forEach(function (poly) { out.push(poly[0]); });
  });
  return out;
}

/* A quad is four projected points, closed. quadStrips has already placed it in
   the right strip, so there is no seam logic at draw time. */
function quadPath(q, proj) {
  var d = '', p;
  for (var i = 0; i < q.length; i++) {
    p = proj.project(q[i][0], q[i][1]);
    if (!isFinite(p[0]) || !isFinite(p[1])) return '';
    d += (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
  }
  return d + 'Z';
}

function tsRenderSVG(bands, projName, palName, land, marks) {
  var proj = PROJS[projName] || PROJS.natearth;
  var pal  = PALETTES[palName] || PALETTES.tshirt;
  currentProj = projName;

  /* The frame path serves THREE purposes in the original, and I had only used
     one of them:
       1. filled, it is the ocean (a globe silhouette in every projection);
       2. as a clipPath, it stops bands and land spilling outside the disc —
          without it every wrapping band streaks across the whole canvas, which
          is the "broken paths" symptom;
       3. as a visible outline it is DISABLED (.frame{display:none} in the
          original's CSS), as is the graticule. I drew both. */
  var holder = document.createElement('div');
  proj.frame(holder);
  var frameEl = holder.firstElementChild;
  if (frameEl) { frameEl.removeAttribute('class'); frameEl.removeAttribute('style'); }
  var clipShape = frameEl ? frameEl.outerHTML : '';

  var oceanEl = frameEl ? frameEl.cloneNode(true) : null;
  if (oceanEl) { oceanEl.setAttribute('class', 'ocean'); }
  var ocean = oceanEl ? oceanEl.outerHTML : '';

  var landHTML = (land || []).map(function (ring) {
    var d = '';
    splitAndProject(rotRing(ring)).forEach(function (seg) { d += pathFromPts(seg); });
    return d ? '<path class="land" d="' + d + '"/>' : '';
  }).join('');

  var bandHTML = '', clHTML = '', labelDefs = '', labels = '';
  var OFFSETS = [50, 35, 65, 42, 58];   /* stagger so dense regions don't stack */

  bands.forEach(function (b, i) {
    /* Every quad of a band in ONE path element. Nonzero fill unions them, so
       the shared edges between adjacent quads don't show as seams when the
       palette uses fill-opacity below 1. */
    var dAll = '';
    b.pieces.forEach(function (pc) { dAll += quadPath(pc, proj); });
    if (dAll) bandHTML += '<path class="band" fill="' + pal[b.type] + '" d="'
                        + dAll + '"><title>' + b.date + '</title></path>';

    if (!b.clSegs || !b.clSegs.length) return;
    var best = null, bestLen = 0;
    b.clSegs.forEach(function (seg) {
      var pts = seg.map(function (p) { return proj.project(p[0], p[1]); });
      if (pts.length < 2) return;
      clHTML += '<path class="cline" d="M'
              + pts.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join('L')
              + '"/>';
      var len = 0;
      for (var k = 1; k < pts.length; k++)
        len += Math.hypot(pts[k][0]-pts[k-1][0], pts[k][1]-pts[k-1][1]);
      if (len > bestLen) { bestLen = len; best = pts; }
    });
    if (!best || bestLen < 12) return;

    var lo = Math.floor(best.length * 0.3), hi = Math.ceil(best.length * 0.7);
    var win = best.slice(lo, hi);
    if (win.length < 2) win = best;
    if (win[win.length-1][0] < win[0][0]) win = win.slice().reverse();
    var id = 'tsl' + i;
    labelDefs += '<path id="' + id + '" fill="none" stroke="none" d="M'
               + win.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join('L')
               + '"/>';
    labels += '<text class="lbl"><textPath href="#' + id + '" startOffset="'
            + OFFSETS[i % OFFSETS.length] + '%" text-anchor="middle">'
            + b.date + '</textPath></text>';
  });

  var markHTML = (marks || []).map(function (m) {
    var p = proj.project(rotLon(m[0]), m[1]);
    if (!isFinite(p[0]) || !isFinite(p[1])) return '';
    return '<circle class="mark" cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="1.2"/>';
  }).join('');

  var lc = pal['label-color'] || '#ffd600';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + proj.viewBox + '"'
       + ' preserveAspectRatio="xMidYMid meet">'
       + '<defs><clipPath id="tsClip">' + clipShape + '</clipPath>' + labelDefs + '</defs>'
       + '<style>'
       +   '.ocean{fill:' + pal.ocean + ';stroke:none}'
       +   '.land{fill:' + pal.land + ';stroke:none}'
       /* mix-blend-mode is per-palette and is what makes overlapping bands
          build up instead of flatly occluding each other. */
       +   '.band{stroke:none;mix-blend-mode:' + (pal.blend || 'normal')
       +        ';fill-opacity:' + (pal['band-opacity'] || 1) + '}'
       +   '.cline{fill:none;stroke:' + lc + ';stroke-width:0.24;stroke-linecap:round}'
       +   '.mark{fill:' + lc + ';stroke:' + pal.bg + ';stroke-width:0.4}'
       +   '.lbl{fill:' + lc + ';font-family:monospace;font-size:2.5px;'
       +        'font-weight:600;letter-spacing:0.05em}'
       + '</style>'
       + '<g>' + ocean + '</g>'
       + '<g clip-path="url(#tsClip)">' + landHTML + '</g>'
       + '<g clip-path="url(#tsClip)">' + bandHTML + clHTML + '</g>'
       + '<g clip-path="url(#tsClip)">' + labels + markHTML + '</g>'
       + '</svg>';
}

/* ── Sheet ─────────────────────────────────────────────────────────────── */

var _tsBands = null, _tsLand = null, _tsMarks = null, _tsRecs = null;

function tsOpen() {
  var rows = (typeof scLogRows === 'function') ? scLogRows() : [];
  var picked = rows.filter(function (r) { return scLogPicked(r.key); });
  if (!picked.length) picked = rows;          /* nothing ticked: use them all */

  var sheet = document.getElementById('tshirt-sheet');
  var body  = document.getElementById('tshirt-canvas');
  if (!sheet || !body) return;

  sheet.classList.add('open');
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', tsKeydown);
  tsAttachSwipe();
  tsAttachZoom();
  tsResetZoom();
  body.innerHTML = '<div class="ts-wait">Building\u2026</div>';

  /* Locations the user saved, one dot each. */
  _tsMarks = picked.filter(function (r) { return r.entry && r.entry.loc; })
                   .map(function (r) { return r.entry.loc; });

  Promise.all([
    tsLoadPathRecords(picked),
    (typeof loadBasemapData === 'function') ? loadBasemapData() : Promise.resolve(null)
  ]).then(function (res) {
    _tsRecs  = res[0];
    _tsLand  = tsLandRings(res[1]);
    _tsBands = buildBands(_tsRecs);
    if (!_tsBands.length) {
      body.innerHTML = '<div class="ts-wait">Nothing to draw \u2014 the selected '
        + 'eclipses have no umbral band (partials, and a handful of grazers, '
        + 'have none).</div>';
      return;
    }
    tsRedraw();
  });
}

function tsRedraw() {
  var body = document.getElementById('tshirt-canvas');
  if (!body || !_tsBands) return;
  var proj = document.getElementById('ts-proj').value;
  var pal  = document.getElementById('ts-theme').value;
  var lon0 = parseFloat(document.getElementById('ts-centre').value) || 0;
  /* Rotation changes the seam, so the bands must be REBUILT, not just
     redrawn — clipping happens at build time. */
  if (lon0 !== currentLon0) { currentLon0 = lon0; if (_tsRecs) _tsBands = buildBands(_tsRecs); }
  body.innerHTML = tsRenderSVG(_tsBands, proj, pal, _tsLand, _tsMarks);
  tsApplyZoom();     /* keep the current zoom across a projection change */
  body.style.background = (PALETTES[pal] || {}).bg || 'transparent';
  var n = document.getElementById('ts-count');
  if (n) n.textContent = _tsBands.length + ' band' + (_tsBands.length === 1 ? '' : 's');
}

function tsClose() {
  var sheet = document.getElementById('tshirt-sheet');
  if (sheet) sheet.classList.remove('open');
  document.body.classList.remove('sheet-open');
  document.removeEventListener('keydown', tsKeydown);
}

/* Escape closes it, as with any dialog. */
function tsKeydown(e) {
  if (e.key === 'Escape' || e.key === 'Esc') tsClose();
}

/* ── Pinch-zoom the poster ──────────────────────────────────────────────
   The app disables page zoom globally (user-scalable=no on the viewport meta,
   so the map doesn't fight the browser), which also freezes the poster at one
   size. This gives the sheet its own zoom: pinch to scale, drag to pan, double
   tap to reset. It only ever transforms the SVG inside .sheet-content, so it
   cannot affect the page.

   Deliberately not a library: two touches and a transform is the whole job. */
var _tsZoom = { k: 1, x: 0, y: 0 };

function tsApplyZoom() {
  var svg = document.querySelector('#tshirt-canvas svg');
  if (!svg) return;
  svg.style.transformOrigin = '50% 50%';
  svg.style.transform = 'translate(' + _tsZoom.x + 'px,' + _tsZoom.y + 'px) scale(' + _tsZoom.k + ')';
}

function tsResetZoom() {
  _tsZoom = { k: 1, x: 0, y: 0 };
  tsApplyZoom();
}

function tsAttachZoom() {
  var el = document.getElementById('tshirt-canvas');
  if (!el || el.dataset.zoom) return;
  el.dataset.zoom = '1';

  var start = null, lastTap = 0;

  var dist = function (t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  };
  var mid = function (t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  };

  el.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      start = { d: dist(e.touches), k: _tsZoom.k,
                m: mid(e.touches), x: _tsZoom.x, y: _tsZoom.y };
    } else if (e.touches.length === 1 && _tsZoom.k > 1) {
      start = { pan: true, sx: e.touches[0].clientX, sy: e.touches[0].clientY,
                x: _tsZoom.x, y: _tsZoom.y };
    } else {
      /* Double tap resets — the usual way out of a zoom. */
      var now = Date.now();
      if (now - lastTap < 320) { tsResetZoom(); lastTap = 0; }
      else lastTap = now;
      start = null;
    }
  }, { passive: true });

  el.addEventListener('touchmove', function (e) {
    if (!start) return;
    if (start.pan && e.touches.length === 1) {
      _tsZoom.x = start.x + (e.touches[0].clientX - start.sx);
      _tsZoom.y = start.y + (e.touches[0].clientY - start.sy);
      tsApplyZoom();
      e.preventDefault();                 /* don't let it scroll or dismiss */
      return;
    }
    if (e.touches.length === 2) {
      var k = start.k * (dist(e.touches) / start.d);
      _tsZoom.k = Math.max(1, Math.min(8, k));
      var m = mid(e.touches);
      _tsZoom.x = start.x + (m.x - start.m.x);
      _tsZoom.y = start.y + (m.y - start.m.y);
      if (_tsZoom.k === 1) { _tsZoom.x = 0; _tsZoom.y = 0; }
      tsApplyZoom();
      e.preventDefault();
    }
  }, { passive: false });

  el.addEventListener('touchend', function () { start = null; }, { passive: true });
}

/* Swipe DOWN on the sheet to dismiss — the gesture people already expect from
   an iOS sheet, and on a phone the backdrop is only the top ~12% of the screen,
   so tapping outside is a poor target. Only fires on a clear downward drag
   started outside the map itself, so it can't fight panning or the selects. */
function tsAttachSwipe() {
  var body = document.querySelector('#tshirt-sheet .sheet-body');
  if (!body || body.dataset.swipe) return;
  body.dataset.swipe = '1';
  var y0 = null;
  body.addEventListener('touchstart', function (e) {
    /* Ignore drags that begin on a control, and any drag while the poster is
       zoomed in — there a one-finger drag is a pan, not a dismiss. */
    if (e.target.closest('select, button, input')) { y0 = null; return; }
    if (_tsZoom.k > 1) { y0 = null; return; }
    y0 = e.touches[0].clientY;
  }, { passive: true });
  body.addEventListener('touchend', function (e) {
    if (y0 === null) return;
    var dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if (dy > 90) tsClose();
  }, { passive: true });
}


/* ── Export ────────────────────────────────────────────────────────────── */

function tsSvgText() {
  var el = document.querySelector('#tshirt-canvas svg');
  return el ? el.outerHTML : null;
}

function tsExportSVG() {
  var txt = tsSvgText();
  if (!txt) return;
  tsDownload(new Blob([txt], { type: 'image/svg+xml' }), 'svg');
}

/* PNG at 4x the viewBox, which is enough for print at poster size. Drawn via an
   Image from a blob URL — a data: URL trips CSP on some hosts. */
function tsExportPNG() {
  var txt = tsSvgText();
  if (!txt) return;
  var el  = document.querySelector('#tshirt-canvas svg');
  var vb  = (el.getAttribute('viewBox') || '0 0 360 180').split(/\s+/).map(Number);
  var w   = Math.round(vb[2] * 4), h = Math.round(vb[3] * 4);

  var url = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
  var img = new Image();
  img.onload = function () {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var pal = PALETTES[document.getElementById('ts-theme').value] || {};
    if (pal.bg) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    c.toBlob(function (b) { if (b) tsDownload(b, 'png'); });
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
    if (typeof setStatus === 'function') setStatus('Could not render the PNG.', true);
  };
  img.src = url;
}

function tsDownload(blob, ext) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'umbral-paths.' + ext;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}


  /* ── Exports ─────────────────────────────────────────────────────────
     Referenced by onclick= in index.html and by userlog.js. Nothing else
     from this module is reachable, deliberately. */
  window.tsOpen      = tsOpen;
  window.tsClose     = tsClose;
  window.tsRedraw    = tsRedraw;
  window.tsExportSVG = tsExportSVG;
  window.tsExportPNG = tsExportPNG;
  window.tsResetZoom = tsResetZoom;

  /* Test seam: the checks assert that every <option> in the sheet resolves to
     a real palette and projection. Read-only. */
  window._tsInternals = { PALETTES: PALETTES, PROJS: PROJS,
                          buildBands: buildBands, splitEdge: splitEdge,
                          renderSVG: tsRenderSVG, landRings: tsLandRings,
                          projectPiece: projectPiece,
                          ribbonQuads: ribbonQuads, pairWalk: pairWalk,
                          quadStrips: quadStrips,
                          setLon0: function(v){ currentLon0 = v; } };
})();
