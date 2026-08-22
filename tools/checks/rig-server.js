/* THE RIG. A real browser, real MapLibre, the real modules, and /sat.php
   forwarded to the live proxy. Everything before this was validated against a
   flat Mercator mosaic at z3 assembled by a Python script — which cannot see
   the globe projection, cannot see MapLibre's tile handling, and could not see
   the half-opaque blue fallback tile that was painting slabs across a quarter of
   the planet at globe zoom.

     node tools/checks/rig-server.js &                 # serves the repo
     node tools/checks/rig-shot.js URL out.png W H     # screenshots it

   Chromium is not in the Ubuntu repos as a deb (snap only); a portable build
   from github.com/macchrome/linchrome works. The container proxy re-signs TLS,
   hence --ignore-certificate-errors — without it every GIBS request fails and
   three of four satellites report missing, which looks exactly like an
   application bug and is not one. */
const http = require('http'), fs = require('fs'), path = require('path'), https = require('https');
const ROOT = require('path').join(__dirname, '..', '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.webp':'image/webp', '.gz':'application/gzip', '.svg':'image/svg+xml' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/sat.php') {
    https.get('https://followtheshadow.com' + req.url, { rejectUnauthorized: false }, r => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/octet-stream' });
      r.pipe(res);
    }).on('error', e => { res.writeHead(502); res.end('proxy ' + e.message); });
    return;
  }
  const f = path.join(ROOT, u.pathname === '/' ? '/index.html' : u.pathname);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8899, '127.0.0.1', () => console.log('up'));
