// Assemble a real tile mosaic exactly as MapLibre would, by RUNNING the shipped
// imagery.js against a fake map and the real network, then fetching the tile
// templates it installed.
//
//   node tools/checks/tilepreview.js Z X0 X1 Y0 Y1 out.png
//
// It duplicates NO logic. An earlier version re-implemented the frame walk-back
// here, missed the night fallback the module had, and reported a satellite as
// missing that the module would have drawn — the harness proving something the
// shipped code does not do is the oldest trap in this project (START-HERE s6).
const fs=require('fs'),vm=require('vm'),{execFileSync}=require('child_process');
const [Z,X0,X1,Y0,Y1,OUT]=process.argv.slice(2);
const z=+Z,x0=+X0,x1=+X1,y0=+Y0,y1=+Y1;

function makeMap(){
  const sources={},layers={},order=[];
  return {sources,layers,order,
    addSource(id,c){sources[id]=c;},removeSource(id){delete sources[id];},
    getSource(id){return sources[id];},
    addLayer(c){layers[c.id]=c;order.push(c.id);},
    removeLayer(id){delete layers[id];const i=order.indexOf(id);if(i>=0)order.splice(i,1);},
    getLayer(id){return layers[id];}};
}

const sb={console,setTimeout,clearTimeout,Promise,fetch,window:{},
          document:{createElement:()=>({getContext:()=>({})})}};
sb.window.window=sb.window;vm.createContext(sb);
vm.runInContext(fs.readFileSync('js/imagery.js','utf8'),sb);
const I=sb.window.Imagery;

const R=20037508.342789244;
function bbox(z,x,y){const n=2**z,s=2*R/n;
  return [-R+x*s,R-(y+1)*s,-R+(x+1)*s,R-y*s].map(v=>v.toFixed(1)).join(',');}
function lonOf(x,z){return x/(2**z)*360-180;}

(async function(){
  const map=makeMap();
  await I.on(map);
  for(const s of I.diagnose().slots){
    console.log((s.iso?'  ok   ':'  MISS ')+s.sat.padEnd(10)+' '+(s.layer||'')+
                (s.alt?'   [ALT]':'')+'  '+(s.iso||''));
  }

  const files=[];
  // Paint in the order the module added the layers, so the mosaic resolves
  // overlaps the same way the map will.
  for(const lyrId of map.order){
    const src=map.layers[lyrId].source, tpl=map.sources[src].tiles[0];
    const b=map.sources[src].bounds;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      // honour the source's bounds, as MapLibre does
      if(b){const l0=lonOf(x,z),l1=lonOf(x+1,z);if(l1<b[0]||l0>b[2])continue;}
      const u=tpl.replace('{bbox-epsg-3857}',bbox(z,x,y));
      const r=await fetch(u).catch(()=>null);
      if(!r||!r.ok)continue;
      const buf=Buffer.from(await r.arrayBuffer());
      if(buf.length<300)continue;
      const f=`/tmp/t_${lyrId}_${x}_${y}.png`;
      fs.writeFileSync(f,buf);
      // honour raster-saturation, or the preview shows confetti the map will not
      const sat=(map.layers[lyrId].paint||{})['raster-saturation'];
      files.push([f,x-x0,y-y0,sat===-1?1:0]);
    }
  }
  console.log('tiles kept: '+files.length);
  fs.writeFileSync('/tmp/tiles.json',JSON.stringify({w:(x1-x0+1)*256,h:(y1-y0+1)*256,files}));
  execFileSync('python3',['-c',`
from PIL import Image
import json
m=json.load(open('/tmp/tiles.json'))
c=Image.new('RGBA',(m['w'],m['h']),(0,0,0,255))
for f,x,y,grey in m['files']:
    t=Image.open(f).convert('RGBA')
    if grey:
        r,g,b,a=t.split()
        l=Image.merge('RGB',(r,g,b)).convert('L')
        t=Image.merge('RGBA',(l,l,l,a))
    c.alpha_composite(t,(x*256,y*256))
c.convert('RGB').save('${OUT}')
print('wrote ${OUT}',c.size)
`],{stdio:'inherit'});
})();
