const p=require('/home/claude/node_modules/puppeteer-core');
(async()=>{
  const url=process.argv[2], out=process.argv[3], w=+(process.argv[4]||900), h=+(process.argv[5]||1200);
  const b=await p.launch({executablePath:'/home/claude/chromium_150.0.7871.208_1.vaapi_linux/chrome',
    args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-certificate-errors']});
  const pg=await b.newPage();
  await pg.setViewport({width:w,height:h,deviceScaleFactor:1});
  const fails=[];
  pg.on('requestfailed',r=>fails.push('FAIL '+r.failure().errorText+' '+r.url().slice(0,110)));
  pg.on('response',r=>{ if(r.status()>=400) fails.push(r.status()+' '+r.url().slice(0,110)); });
  await pg.goto(url,{waitUntil:'domcontentloaded',timeout:60000}).catch(e=>console.log('goto:',e.message));
  await pg.waitForFunction('window.__ready===true',{timeout:75000}).catch(()=>console.log('NOT READY'));
  await new Promise(r=>setTimeout(r,3000));
  const diag=await pg.evaluate('JSON.stringify(Imagery.diagnose())').catch(e=>'diag err '+e.message);
  console.log('DIAG',diag);
  console.log('--- network problems (first 10) ---'); console.log([...new Set(fails)].slice(0,10).join('\n')||'none');
  await pg.screenshot({path:out});
  await b.close();
})();
