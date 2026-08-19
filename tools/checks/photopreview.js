// Run the SHIPPED compose() from js/imagery.js over a real picture composite.
const fs=require('fs'),path=require('path'),vm=require('vm');
const F=JSON.parse(fs.readFileSync(process.argv[2]));
const box=F.box,w=F.w,h=F.h;
const frames=F.frames.map(f=>({sat:{lon:f.lon,id:f.id},d:Buffer.from(f.data,'base64'),box:f.box,pw:f.pw}));
let src=fs.readFileSync(path.join(__dirname,'../../js/imagery.js'),'utf8')
  .replace('window.Imagery = {','window.__T={compose:compose,init:function(c){_ctx=c;}};\n  window.Imagery = {');
const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
           putImageData:(img)=>{out=img;}};
let out=null;
const sb={window:{Satellite:{_weightAt:()=>1,_viewBox:()=>box}},console,setTimeout,clearTimeout,Promise,
          Image:function(){},document:{createElement:()=>({getContext:()=>ctx})}};
vm.createContext(sb);vm.runInContext(src,sb);
sb.window.__T.init(ctx);
const painted=sb.window.__T.compose(box,w,h,frames);
const o=out.data;
let empty=0;
for(let x=0;x<w;x++){let any=false;for(let y=0;y<h;y++) if(o[(y*w+x)*4+3]>0){any=true;break;} if(!any)empty++;}
console.log('painted '+(100*painted).toFixed(0)+'%  empty columns '+empty+'/'+w);
const buf=Buffer.alloc(w*h*3);
for(let i=0;i<w*h;i++){const a=o[i*4+3]/255;
  buf[i*3]=o[i*4]*a+8*(1-a); buf[i*3+1]=o[i*4+1]*a+8*(1-a); buf[i*3+2]=o[i*4+2]*a+8*(1-a);}
fs.writeFileSync(process.argv[3],Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),buf]));
