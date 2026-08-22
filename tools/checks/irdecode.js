/* Decode a REAL infrared tile through the shipped tempOf() and report what the
   coldest pixels actually become. Written because "the coldest cores read as
   clear sky" has been diagnosed twice from the shape of the code and been wrong
   both times; this answers it with numbers.

   node tools/checks/irdecode.js [layer] [z] [y] [x] [ISO]
   Defaults to a Himawari tile over the west Pacific at the newest frame it finds. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const sb = { console, setTimeout, clearTimeout, Promise, fetch, window: {},
  document: { createElement: () => ({ getContext: () => ({
    createImageData: () => ({ data: [] }), drawImage() {}, getImageData: () => ({ data: [] }) }) }) } };
sb.window.window = sb.window;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/cloud-now.js'), 'utf8'), sb);
const S = sb.window.Satellite;
S._buildCube();

const a = process.argv.slice(2);
const LAYER = a[0] || 'Himawari_AHI_Band13_Clean_Infrared';
const Z = a[1] || '4', Y = a[2] || '6', X = a[3] || '13';
const LVL = /Himawari/.test(LAYER) ? 6 : 7;

function isoBack(min) {
  const t = new Date(Date.now() - min * 60000);
  t.setUTCSeconds(0, 0); t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10);
  return t.toISOString().replace(/\.\d+Z$/, 'Z');
}

(async () => {
  let buf = null, used = null;
  for (let m = 30; m <= 180 && !buf; m += 10) {
    const iso = a[4] || isoBack(m);
    const u = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + LAYER +
              '/default/' + iso + '/GoogleMapsCompatible_Level' + LVL +
              '/' + Z + '/' + Y + '/' + X + '.png';
    const r = await fetch(u).catch(() => null);
    if (r && r.ok) { buf = Buffer.from(await r.arrayBuffer()); used = iso; }
    if (a[4]) break;
  }
  if (!buf) { console.log('no frame found'); process.exit(1); }

  /* Decode the PNG without a dependency: shell out to python's PIL, which the
     other checks already rely on. */
  fs.writeFileSync('/tmp/_ir.png', buf);
  const { execSync } = require('child_process');
  const px = JSON.parse(execSync(
    'python3 -c "' +
    'from PIL import Image; import numpy as np, json; ' +
    "a=np.array(Image.open('/tmp/_ir.png').convert('RGB')).astype(int).reshape(-1,3); " +
    'print(json.dumps(a.tolist()))"', { maxBuffer: 1 << 28 }).toString());

  const T = px.map(([r, g, b]) => S._tempOf({ temp: 'cmap' }, [r, g, b, 255], 0));
  const sat = px.map(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b));
  const grey = T.filter((_, i) => sat[i] <= 12), col = T.filter((_, i) => sat[i] > 12);
  const mn = Math.min(...T), mx = Math.max(...T);
  const warmColour = T.filter((t, i) => sat[i] > 12 && t > -12).length;

  console.log(LAYER + '  ' + used + '  z' + Z + '/' + Y + '/' + X);
  console.log('  grey pixels    %s%%  T %s .. %s',
    (100 * grey.length / T.length).toFixed(1), Math.min(...grey).toFixed(1), Math.max(...grey).toFixed(1));
  console.log('  coloured       %s%%  T %s .. %s',
    (100 * col.length / T.length).toFixed(1), Math.min(...col).toFixed(1), Math.max(...col).toFixed(1));
  console.log('  overall        T %s .. %s', mn.toFixed(1), mx.toFixed(1));
  console.log('');
  console.log('  A COLOURED pixel is cold BY CONSTRUCTION, so any decoding warmer');
  console.log('  than -12C is a decode fault, and is what punches holes in cores.');
  console.log('  coloured pixels decoding warmer than -12C: ' + warmColour +
              (warmColour ? '   <-- FAULT' : '   ok'));
})();
