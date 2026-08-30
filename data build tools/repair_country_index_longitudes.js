/* repair_country_index_longitudes.js
 *
 * ONE-OFF REPAIR, run 2026-08-29. Kept for the record; you should not need it
 * again, because gen_country_index.js now has the fix (see bandWindows()).
 *
 * THE BUG. The umbral corridor was built as un.concat(us.reversed()), but
 * gen_eclipse_paths unwraps each limit along its own track, so a path crossing
 * the antimeridian can return the north limit at 176..356 and the south limit
 * at -179..-5 — one corridor written two ways. Concatenated raw, that polygon
 * spans -179..356: a ring around the planet, which every country intersects.
 *
 * WHAT IT COST. 2453-09-03 was flagged as central in 108 countries including
 * ANDORRA, where the eclipse is a 59.8% partial and there is no totality
 * anywhere along its longitude. So "andorra total" returned it.
 *
 * SCOPE. Only eclipses whose band spans over 300 deg of longitude can be
 * affected: 109 of 10,262. This script repairs exactly those and leaves every
 * other row byte-identical. Central entries went 1,918 -> 367.
 *
 * ⚠ Countries LOSING the central flag are re-sampled, not just re-signed. The
 * bug synthesised their magnitude (mag = row[i] || 100%), so the stored value
 * is not trustworthy and the real obscuration has to be recomputed. That uses
 * the generator's own gridFor(), which falls back to the vertex mean of the
 * largest ring for countries smaller than the grid step — a hand-rolled 3 deg
 * grid returns zero points for Andorra (0.24 deg tall) and silently deletes it.
 *
 * ⚠ STILL BROKEN AFTER THIS, and not fixed here: two eclipses still claim 55
 * and 42 central countries. Their paths encircle a pole, and a corridor that
 * wraps 360 deg of longitude around the pole cannot be represented as a simple
 * lon/lat polygon at all. That needs a spherical containment test.
 */
const fs=require('fs'), zlib=require('zlib'), path=require('path');
const src=fs.readFileSync('data build tools/gen_country_index.js','utf8');
eval(src.slice(src.indexOf('function ptInRings'), src.indexOf('/* --------------------------------------------------------------- inputs */')));
eval(src.slice(src.indexOf('function gridFor'), src.indexOf('/* --------------------------------------------------------------- worker */')));
const E=require('/home/claude/ShadowChaser/js/eclipse.js');
const BUCKET=5, FLOOR=20;

const cg=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/basemap/countries.geojson.gz')).toString());
const ringsOf=g=>g.type==='Polygon'?g.coordinates:(g.type==='MultiPolygon'?g.coordinates.reduce((a,p)=>a.concat(p),[]):[]);
const idxFile='data/country_index.json.gz';
const payload=JSON.parse(zlib.gunzipSync(fs.readFileSync(idxFile)).toString());
const NAMES=payload.names;
// map each country feature to its slot in payload.names
const COUNTRIES=cg.features.map(f=>{
  const rings=ringsOf(f.geometry);
  let w=180,e=-180,s=90,n=-90;
  rings.forEach(r=>r.forEach(p=>{if(p[0]<w)w=p[0];if(p[0]>e)e=p[0];if(p[1]<s)s=p[1];if(p[1]>n)n=p[1];}));
  const names=(f.properties&&f.properties.names)||[];
  let slot=-1;
  for(const nm of names){ const k=NAMES.indexOf(String(nm).toLowerCase()); if(k>=0){slot=k;break;} }
  return {rings,bbox:{w,e,s,n},slot};
}).filter(c=>c.slot>=0);
console.log('countries matched to index slots:', COUNTRIES.length, 'of', cg.features.length);

/* bandWindows() and bandHits() come from the generator, eval'd above. */

let repaired=0, before=0, after=0, details=[];
for(const f of fs.readdirSync('data/paths').filter(x=>/\.gz$/.test(x))){
  const century=f.replace('paths_','').replace('.json.gz','');
  const paths=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/paths/'+f)).toString());
  const bFile='data/besselian/'+century+'.json';
  if(!fs.existsSync(bFile)) continue;
  const bess={}; JSON.parse(fs.readFileSync(bFile,'utf8')).forEach(r=>bess[String(r.cat_no)]=r);
  for(const key in paths){
    const p=paths[key];
    const un=p.umbra_n&&p.umbra_n[0], us=p.umbra_s&&p.umbra_s[0];
    if(!un||!us||un.length<2||us.length<2) continue;
    const lons=un.map(x=>x[0]).concat(us.map(x=>x[0]));
    if(Math.max(...lons)-Math.min(...lons)<=300) continue;
    const row=payload.index[p.cat_no]; if(!row) continue;
    const rec=bess[String(p.cat_no)]; if(!rec) continue;

    const oldCentral=Object.keys(row).filter(k=>row[k]<0).map(Number);
    const ws=bandWindows(un,us);
    const newCentral=COUNTRIES.filter(C=>bandHits(ws,C)).map(C=>C.slot);
    before+=oldCentral.length; after+=newCentral.length;

    /* Re-sample any country losing its central flag: its stored magnitude may
       have been synthesised by the bug (mag = row || 100%) and is not trustworthy. */
    const losing=oldCentral.filter(i=>newCentral.indexOf(i)<0);
    for(const i of losing){
      const C=COUNTRIES.find(c=>c.slot===i);
      if(!C){ delete row[i]; continue; }
      /* Use the GENERATOR's own gridFor: it falls back to the vertex mean of
         the largest ring when a country is smaller than the grid step, which
         is exactly the case for Andorra (0.24 deg tall against a 3 deg grid).
         A hand-rolled grid silently returns zero points and deletes the row. */
      let best=0;
      const g=gridFor(C, 3, 4000);
      for(const [la,lo] of g){
        const r=E.computeEclipse(rec,la,lo,0);
        if(r&&r.visible&&r.osc>best) best=r.osc;
      }
      /* refine around the best node, same two passes as the generator */
      if(best>0){
        let bLat=0,bLon=0;
        for(const [la,lo] of g){ const r=E.computeEclipse(rec,la,lo,0);
          if(r&&r.visible&&r.osc===best){bLat=la;bLon=lo;break;} }
        for(let d=0; d<2; d++){
          const step=3/Math.pow(2,d+1);
          for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
            if(!dx&&!dy) continue;
            const la=bLat+dy*step, lo=bLon+dx*step;
            if(!ptInRings(C.rings,lo,la)) continue;
            const rr=E.computeEclipse(rec,la,lo,0);
            if(rr&&rr.visible&&rr.osc>best) best=rr.osc;
          }
        }
      }
      if(best>=FLOOR) row[i]=Math.round(best/BUCKET); else delete row[i];
    }
    for(const i of newCentral) row[i]=-Math.abs(row[i]||Math.round(100/BUCKET));
    repaired++;
    if(oldCentral.length-newCentral.length>20)
      details.push(rec.year+'-'+rec.month+'-'+rec.day+': '+oldCentral.length+' -> '+newCentral.length);
  }
}
console.log('eclipses repaired:',repaired);
console.log('central entries:',before,'->',after);
console.log(details.slice(0,10).join('\n'));
payload.__meta.repaired='2026-08-29 longitude-convention fix, '+repaired+' eclipses';
fs.writeFileSync(idxFile, zlib.gzipSync(JSON.stringify(payload),{level:9}));
console.log('written', idxFile, (fs.statSync(idxFile).size/1024).toFixed(0)+' KB');
