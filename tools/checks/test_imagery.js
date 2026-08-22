// Drives Imagery.on()/off() against a fake MapLibre map and a fake network.
// The module now adds RASTER SOURCES instead of compositing pixels, so this
// checks the wiring: what is asked of the network, and what lands on the map.
const fs=require('fs'),vm=require('vm');
let fails=0,total=0;
function ok(name,cond){total++;if(!cond)fails++;console.log('  '+(cond?'PASS':'FAIL')+' '+name);}

function makeMap(){
  const sources={},layers={},order=[];
  return {sources,layers,order,
    addSource(id,cfg){sources[id]=cfg;},
    removeSource(id){delete sources[id];},
    getSource(id){return sources[id];},
    addLayer(cfg){layers[cfg.id]=cfg;order.push(cfg.id);},
    removeLayer(id){delete layers[id];const i=order.indexOf(id);if(i>=0)order.splice(i,1);},
    getLayer(id){return layers[id];},
    live(){return Object.keys(layers).length+'/'+Object.keys(sources).length;}};
}

// blankFor: layers the fake service should answer with a too-small body, which
// is how an unpublished frame actually presents (measured 116-334 bytes).
let reqs=[],blankFor=null;
function fakeFetch(u){
  reqs.push(u);
  const blank=blankFor&&blankFor.test(u);
  return Promise.resolve({ok:true,blob:()=>Promise.resolve({size:blank?200:50000})});
}

// A real browser supplies both of these; the module needs location.origin to
// make the proxy path absolute, and maplibregl to register the retry protocol.
const protocols={};
const sb={console,setTimeout,clearTimeout,Promise,fetch:fakeFetch,
          atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,ArrayBuffer,
          window:{location:{origin:'https://followtheshadow.com'},
                  maplibregl:{addProtocol:(p,fn)=>{protocols[p]=fn;}}},
          document:{createElement:()=>({getContext:()=>({})})}};
sb.window.window=sb.window;
vm.createContext(sb);
vm.runInContext(fs.readFileSync('js/cloud-photo.js','utf8'),sb);
const I=sb.window.Imagery;

(async function(){
  const map=makeMap();
  await I.on(map);

  console.log('after on():   layers/sources = '+map.live()+'  isOn '+I.isOn());
  console.log('  requests: '+reqs.length+'  missing: '+(I.missing().join(', ')||'none'));

  const sats=I._sats();
  /* ONE LAYER PER SATELLITE IS NO LONGER TRUE. A disc whose span crosses the
     antemeridian cannot be given one west/east bounds pair, so it is added as
     two sources with real bounds. Widening it to the whole world instead was
     the bug this replaced: GOES-West painted Asia and the Indian Ocean with
     limb smear it cannot see. So count PARTS, grouped by satellite. */
  const partsOf=id=>Object.keys(map.layers)
     .filter(k=>k==='photo-lyr-'+id||k.indexOf('photo-lyr-'+id+'-')===0);
  /* Worst picture first: the greyscale infrared disc is added before the
     true-colour ones so they cover it. */
  const greyIds=sats.filter(s=>s.grey).map(s=>s.id);
  const isGrey=k=>greyIds.some(g=>k==='photo-src-'+g||k.indexOf('photo-src-'+g+'-')===0);
  const ranked=sats.slice().sort((a,b)=>(b.grey?1:0)-(a.grey?1:0));
  const groups=ranked.map(s=>partsOf(s.id));
  const nParts=groups.reduce((a,g)=>a+g.length,0);
  const mtgParts=partsOf('mtg').length;   /* counted while it is still up */
  /* THE FALLBACK TILE MUST BE INVISIBLE. It shipped for months as a half-opaque
     BLUE pixel while the comment beside it said "transparent" — and MapLibre
     stretches a 1x1 tile across the whole tile, so at globe zoom every exhausted
     retry painted a translucent blue slab across a quarter of the planet.
     Decode it and look at the alpha; reading the comment is not enough. */
  (()=>{
    const m=/CLEAR_PNG\s*=\s*'([^']*)'\s*\+\s*'([^']*)'/.exec(
      fs.readFileSync('js/cloud-photo.js','utf8'));
    if(!m){ ok('CLEAR_PNG is present and readable', false); return; }
    const buf=Buffer.from(m[1]+m[2],'base64');
    ok('the fallback tile is a PNG', buf.slice(1,4).toString()==='PNG');
    /* Walk the chunks to the IDAT, inflate, and read the single pixel. */
    const zlib=require('zlib');
    let off=8, ihdr=null, idat=[];
    while(off<buf.length){
      const len=buf.readUInt32BE(off), typ=buf.slice(off+4,off+8).toString();
      if(typ==='IHDR') ihdr={w:buf.readUInt32BE(off+8),h:buf.readUInt32BE(off+12),
                             depth:buf[off+16],color:buf[off+17]};
      if(typ==='IDAT') idat.push(buf.slice(off+8,off+8+len));
      off+=12+len;
    }
    const raw=zlib.inflateSync(Buffer.concat(idat));
    ok('the fallback tile is 1x1 RGBA', ihdr && ihdr.w===1 && ihdr.h===1 && ihdr.color===6,
       JSON.stringify(ihdr));
    /* raw = [filter byte, R, G, B, A] */
    ok('THE FALLBACK TILE IS FULLY TRANSPARENT', raw[4]===0,
       'alpha='+raw[4]+' rgb='+raw[1]+','+raw[2]+','+raw[3]);
  })();

  ok('every satellite draws, as one part or two',
     groups.every(g=>g.length>=1)&&Object.keys(map.sources).length===nParts);
  ok('every source is a raster source',
     Object.values(map.sources).every(s=>s.type==='raster'));

  // The whole point of the rewrite: MapLibre does the tiling. Each service gets
  // the template IT supports — GIBS the cached WMTS path, EUMETSAT WMS-by-bbox.
  const tpl=id=>map.sources['photo-src-'+id].tiles[0];
  ok('GIBS uses the CACHED wmts path, not the per-tile wms renderer',
     ['goes-east','goes-west'].every(id=>
       /\/wmts\/epsg3857\/best\//.test(tpl(id))&&!/wms\.cgi/.test(tpl(id))));
  // Without a retry one transient 404 leaves a permanent hole: MapLibre does not
  // re-request a failed tile, and GIBS drops roughly one in five.
  ok('tiles go through the retrying protocol, not raw https',
     Object.values(map.sources).every(x=>/^sctile:\/\//.test(x.tiles[0])));
  ok('the proxy path is made absolute, or the protocol cannot fetch it',
     !/^sctile:\/\/\//.test(tpl('mtg')));
  ok('GIBS templates carry {z}/{y}/{x} in WMTS row/col order',
     ['goes-east','goes-west'].every(id=>/\/\{z\}\/\{y\}\/\{x\}\.png$/.test(tpl(id))));
  // EUMETSAT is out of the live list while their GetMap sends no CORS header.
  ok('EUMETSAT tiles go through the same-origin proxy, never cross-origin',
     Object.values(map.sources).filter(x=>/[?&]s=eum/.test(x.tiles[0])).length===1 &&
     !Object.values(map.sources).some(x=>/^https?:\/\/view\.eumetsat/.test(x.tiles[0])));
  // The daily polar mosaic is OFF. It loaded first and complete, so the picture
  // snapped to a clean planet and was then overpainted disc by disc as the live
  // layers streamed in — the same map redrawn three times over.
  ok('no stale global base is installed',!map.getSource('photo-src-viirs'));
  ok('every layer on the map is a LIVE geostationary disc',
     map.order.every(id=>sats.some(s=>id.indexOf('photo-lyr-'+s.id)===0)));
  /* Between them the discs must reach all the way round. A slot with no
     satellite is a blank vertical slice from pole to pole — leaving Himawari
     out cost 70E to 153E: China, Japan, Australia and half the Indian Ocean. */
  ok('the discs cover every longitude, with no blank slice',(()=>{
     const iv=Object.values(map.sources).map(x=>[x.bounds[0],x.bounds[2]])
        .sort((a,b)=>a[0]-b[0]);
     let at=-180;
     for(const [w,e] of iv){ if(w>at+1e-6) return false; if(e>at) at=e; }
     return at>=180-1e-6;
  })());
  /* The greyscale disc must sit UNDER every colour disc, or it covers pixels a
     better product could have drawn — a whole hemisphere of Asia and the
     Pacific went grey that way. */
  ok('the greyscale disc is painted first, so colour covers it',
     !greyIds.length || greyIds.some(g=>map.order[0].indexOf('photo-lyr-'+g)===0));
  // EUMETSAT tiles are 512 because each one is a cold PHP render on shared
  // hosting; a quarter as many is the difference between usable and 75 seconds.
  ok('tileSize matches what the template actually requests',
     Object.values(map.sources).every(x=>
       /[?&]s=eum/.test(x.tiles[0])
         ? (x.tileSize===512 && /[?&]w=512&h=512/.test(x.tiles[0]))
         : x.tileSize===256));
  ok('every source caps maxzoom, so zooming past the source cannot spray 404s',
     Object.values(map.sources).every(s=>typeof s.maxzoom==='number'&&s.maxzoom>0));
  ok('each disc is bounded, so it never requests tiles it cannot see',
     Object.values(map.sources).every(s=>Array.isArray(s.bounds)&&s.bounds.length===4));
  ok('no request asks for EPSG:4326 — it returns blank with no error',
     !reqs.some(u=>/4326/.test(u)));
  ok('paint order is fixed, so overlaps resolve the same way every time',
     map.order.join(',')===[].concat.apply([],groups).join(','));

  /* The discs are clipped at the midpoint between neighbouring nadirs, so every
     longitude is drawn by whichever satellite sees it most squarely and NO TWO
     EXTENTS OVERLAP. Meteosat sitting on top of GOES-East out to 70W — its own
     worst limb over its neighbour's best pixels — was the band of mismatched
     patches down the Atlantic. */
  const spans=Object.keys(map.sources).filter(k=>!isGrey(k))
     .map(k=>[map.sources[k].bounds[0],map.sources[k].bounds[2]])
     .sort((a,b)=>a[0]-b[0]);
  ok('no two colour discs overlap, so neither puts its limb over the other',
     spans.every((b,i)=>i===0||b[0]>=spans[i-1][1]-1e-6));

  // A disc whose frames are all unpublished must be REPORTED, not left silently
  // blank: a hole in the picture reads as clear sky.
  reqs=[];blankFor=/s=eum&l=mtg_fd/;
  await I.invalidate();
  ok('a satellite with no published frame is reported missing',
     I.missing().length===1&&/Meteosat/.test(I.missing()[0]));
  ok('and it gets no layer on the map',!map.getLayer('photo-lyr-mtg'));
  ok('the others still draw',
     Object.keys(map.layers).length===nParts-mtgParts);

  ok('it walked back through several frames before giving up',
     reqs.filter(u=>/s=eum&l=mtg_fd/.test(u)).length>=8);

  blankFor=null;
  await I.invalidate();
  ok('a satellite that returns is restored on the next refresh',
     !!map.getLayer('photo-lyr-mtg')&&I.missing().length===0);

  const before=map.sources['photo-src-goes-east'].tiles[0];
  ok('shownTime reports a frame',!!I.shownTime());
  ok('diagnose names the layer per slot, so a hole names its own cause',
     I.diagnose().slots.length===sats.length&&I.diagnose().slots.every(s=>!!s.layer));

  I.off();
  ok('the layer is torn down completely',map.live()==='0/0'&&!I.isOn());
  // WMTS carries the frame time in the PATH, not a TIME= query parameter. The
  // point stands either way: the URL must change when the frame does, or
  // MapLibre keeps serving the cached picture forever.
  ok('rebuilding uses a fresh URL, or MapLibre serves the cached picture forever',
     typeof before==='string'&&/\/default\/[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(before));

  console.log('\n'+(fails?fails+' FAILURE(S)':'all pass'));
  process.exit(fails?1:0);
})();
