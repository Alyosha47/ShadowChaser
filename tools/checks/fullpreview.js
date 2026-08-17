// Render the SHIPPED compose() over a real multi-satellite composite and save a PNG.
const fs=require('fs'),vm=require('vm');
const F=JSON.parse(fs.readFileSync(process.argv[2]));
const h=F.h,w=F.w,box=F.box;
let out=null;
const ctx={createImageData:(a,b)=>({data:new Uint8ClampedArray(a*b*4),width:a,height:b}),
           putImageData:(img)=>{out=img;}};
const sb={window:{},console,setTimeout,clearTimeout,Promise,Image:function(){},
  document:{createElement:()=>({getContext:()=>ctx})}};
vm.createContext(sb);
const src=fs.readFileSync('repo/js/satellite.js','utf8')
  .replace('window.Satellite = {','window.__T={compose:compose,bp:buildPalette,bc:buildCube,init:function(c){_ctx=c;}};\n  window.Satellite = {');
vm.runInContext(src,sb);
sb.window.__T.init(ctx); sb.window.__T.bp(); sb.window.__T.bc();
const SATS=sb.window.Satellite._sats();
const frames=F.frames.map(f=>({sat:SATS.find(s=>s.id===f.id),d:Buffer.from(f.data,'base64'),
  box:f.box,pw:f.pw,bg:{w:f.bg.w,h:f.bg.h,box:f.bg.box,T:new Float32Array(new Float64Array(
    Buffer.from(f.bg.T,'base64').buffer).map(x=>x))}}));
sb.window.__T.compose(box,w,h,frames);
// composite over pale grey and write a PNG via raw PPM -> pipe to python
const d=out.data; const buf=Buffer.alloc(w*h*3);
for(let i=0,p=0;i<w*h;i++,p+=4){const a=d[p+3]/255;
  for(let c=0;c<3;c++) buf[i*3+c]=Math.round(225*(1-a)+d[p+c]*a);}
fs.writeFileSync(process.argv[3],Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),buf]));
let lit=0,cols=0;
for(let i=0;i<w;i++){let any=false;for(let j=0;j<h;j++)if(d[(j*w+i)*4+3]>0){any=true;break;}if(!any)cols++;}
for(let p=3;p<d.length;p+=4) if(d[p]>0) lit++;
console.log(`drawn ${(lit/(w*h)*100).toFixed(0)}%  empty columns ${cols}/${w}`);
