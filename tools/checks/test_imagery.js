const fs=require('fs'),vm=require('vm');
let waiting=[], reqs=[];
function makeMap(){
  const layers={},sources={},handlers={};
  return {log:[],
    getLayer:i=>layers[i], getSource:i=>sources[i],
    addLayer:o=>{layers[o.id]=o;},
    addSource:(id,o)=>{sources[id]={setCoordinates(){},play(){},pause(){}};},
    removeLayer:i=>{delete layers[i];}, removeSource:i=>{delete sources[i];},
    setLayoutProperty(){}, getZoom:()=>2, getCenter:()=>({lng:-60,lat:15}),
    getCanvas:()=>({width:800,height:600}),
    getProjection:()=>({type:'globe'}),
    on:(e,f)=>{(handlers[e]=handlers[e]||[]).push(f);},
    off:(e,f)=>{handlers[e]=(handlers[e]||[]).filter(x=>x!==f);},
    live:()=>Object.keys(layers).length+'/'+Object.keys(sources).length};
}
const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},
           clearRect(){},drawImage(){},
           getImageData:(x,y,w,h)=>{const d=new Uint8ClampedArray(w*h*4);
             for(let i=0;i<w*h;i++){d[i*4]=40+(i%150);d[i*4+1]=60;d[i*4+2]=90;d[i*4+3]=255;}
             return {data:d};}};
const sb={window:{},console,setTimeout,clearTimeout,Promise,
  Image:function(){const s=this;Object.defineProperty(this,'src',{set(v){reqs.push(v);waiting.push(()=>s.onload&&s.onload());}});},
  document:{createElement:()=>({getContext:()=>ctx,width:0,height:0}),visibilityState:'visible',addEventListener(){}}};
sb.window.document=sb.document;
vm.createContext(sb);
vm.runInContext(fs.readFileSync('js/satellite.js','utf8'),sb);
vm.runInContext(fs.readFileSync('js/imagery.js','utf8'),sb);
const map=makeMap();
function settle(n){return new Promise(r=>{let t=0;const iv=setInterval(()=>{waiting.splice(0).forEach(f=>f());if(++t>n){clearInterval(iv);r();}},1);});}
(async()=>{
  const pr=sb.window.Imagery.on(map); await settle(120); await pr;
  console.log('after on():   layers/sources =',map.live(),' isOn',sb.window.Imagery.isOn());
  console.log('  frames drawn:',sb.window.Imagery.diagnose().frames,' missing:',sb.window.Imagery.missing().join(',')||'none');
  console.log('  requests issued:',reqs.length,' full-size:',reqs.filter(u=>!/WIDTH=64/.test(u)).length);
  sb.window.Imagery.off(); await settle(20);
  console.log('after off():  layers/sources =',map.live(),' isOn',sb.window.Imagery.isOn());

  let fail=0;
  const ok=(n,c)=>{console.log('  '+(c?'PASS':'FAIL')+' '+n); if(!c)fail++;};
  console.log('\nassertions');
  ok('the layer is torn down completely', map.live()==='0/0');
  ok('every satellite in view returned a frame', sb.window.Imagery.missing().length===0);
  ok('the frame search is done at 64x32, not full size',
     reqs.filter(u=>/WIDTH=64/.test(u)).length > reqs.filter(u=>!/WIDTH=64/.test(u)).length);
  ok('no request asks for EPSG:4326 — it returns blank with no error',
     !reqs.some(u=>/4326/.test(u)));
  ok('EUMETSAT stamps keep their milliseconds',
     reqs.filter(u=>/view\.eumetsat/.test(u)).every(u=>/00\.000Z/.test(u)));
  ok('GIBS stamps do not gain milliseconds',
     reqs.filter(u=>/gibs\./.test(u)).every(u=>!/\.\d{3}Z/.test(u)));
  ok('neither dateline edge is requested at exactly 180',
     !reqs.some(u=>/BBOX=-20037508\.34|,20037508\.34/.test(u)));
  ok('it depends on satellite.js through window, not a bare global',
     /window\.Satellite/.test(fs.readFileSync('js/imagery.js','utf8')));
  console.log('\n'+(fail?fail+' FAILURE(S)':'all pass'));
  process.exit(fail?1:0);
})();
