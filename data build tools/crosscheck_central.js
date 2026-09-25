#!/usr/bin/env node
/* crosscheck_central.js — check data/central_countries.json.gz for one eclipse
   against an independent method: js/eclipse.js (the app's own local-circumstances
   code, not the Python generator) evaluated on every country-boundary vertex and
   on a grid inside each country. Prints the claimed and found counts and every
   disagreement (MISSED = eclipse.js finds central, data does not; EXTRA = the
   reverse). The grid is coarse (<= 0.5 deg), so an EXTRA on a sliver or a path
   end is expected; a MISSED is a real finding. Written 2026-09-23 (HANDOFF §15).
     node "data build tools/crosscheck_central.js" <cat_no>        (repo root) */
const fs=require('fs'),zlib=require('zlib'),E=require(require('path').join(__dirname, '../js/eclipse.js'));
const cat=+process.argv[2];
const idx=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/')+'index.json'));const row=idx.find(r=>r.cat_no===cat);
const rec=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/')+'besselian/'+row._chunk+'.json')).find(r=>r.cat_no===cat);
const geo=JSON.parse(zlib.gunzipSync(fs.readFileSync(require('path').join(__dirname,'../data/')+'basemap/countries.geojson.gz')));
const cc=JSON.parse(zlib.gunzipSync(fs.readFileSync(require('path').join(__dirname,'../data/')+'central_countries.json.gz'))).central[String(cat)];
const names=JSON.parse(zlib.gunzipSync(fs.readFileSync(require('path').join(__dirname,'../data/')+'country_index.json.gz'))).names;
const claimed=new Set(cc.map(i=>names[i]));
const central=(lat,lon)=>{const r=E.computeEclipse(rec,lat,lon,0);return r&&r.visible&&r.durCentral>0;};
function rings(g){return g.type==='Polygon'?[g.coordinates]:g.coordinates;}
function inRing(x,y,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if(((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}return c;}
const out=[];
for(const f of geo.features){
  const nm=(f.properties.names||[''])[0];
  let hit=false, tested=0;
  for(const poly of rings(f.geometry)){
    const outer=poly[0]; let w=1e9,e=-1e9,s=1e9,n=-1e9;
    for(const [x,y] of outer){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y);}
    for(const [x,y] of outer){tested++; if(central(y,x)){hit=true;break;}}   // boundary vertices
    if(hit)break;
    const st=Math.max(0.05,Math.min(0.5,(e-w)/40));
    for(let y=s;y<=n&&!hit;y+=st)for(let x=w;x<=e;x+=st){ if(!inRing(x,y,outer))continue; tested++; if(central(y,x)){hit=true;break;} }
    if(hit)break;
  }
  const c=claimed.has(nm);
  if(hit||c) out.push((hit===c?'  ok ':(hit?' MISSED':' EXTRA'))+' '+nm);
}
console.log('cat',cat,row.year,row.month,row.day,'claimed',claimed.size,'  found',out.filter(l=>!l.includes('EXTRA')).length);
out.filter(l=>!l.startsWith('  ok')).forEach(l=>console.log(l));
