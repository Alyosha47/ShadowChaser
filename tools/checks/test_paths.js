const ROOT = require('path').join(__dirname, '..', '..');  /* repo root, wherever this is run from */
/* Exercise js/paths.js with the real engine (js/pathgen.js) and real Besselian
   data: paths computed on the device, the worker route and its fallback, the
   in-memory and IndexedDB caches, and the "Calculating eclipse path…" status. */
const fs = require('fs'), vm = require('vm');
const R = ROOT + '/';
let fails = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  — ' + detail));
  if (!cond) fails++;
}

const CHUNK = '2001_2100';
const RECS = JSON.parse(fs.readFileSync(R + 'data/besselian/' + CHUNK + '.json', 'utf8'));
const REC_2024 = RECS.find(r => r.year === 2024 && r.month === 4 && r.day === 8);
const ENTRY_2024 = { year: 2024, month: 4, day: 8, cat_no: REC_2024.cat_no, _chunk: CHUNK };

/* Minimal IndexedDB: the calls paths.js makes (open, get, put, cursor delete). */
function fakeIndexedDB(store) {
  function req(result) { const r = { result }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; }
  const os = {
    get: k => req(store.has(k) ? JSON.parse(store.get(k)) : undefined),
    put: (v, k) => { store.set(k, JSON.stringify(v)); return req(k); },
    openCursor: () => {
      const keys = [...store.keys()]; let i = 0; const r = {};
      const step = () => { r.result = i < keys.length ? { key: keys[i], delete: () => store.delete(keys[i]), continue: () => { i++; setTimeout(step, 0); } } : null;
                           r.onsuccess && r.onsuccess(); };
      setTimeout(step, 0); return r;
    }
  };
  const db = { transaction: () => ({ objectStore: () => os }), createObjectStore: () => os };
  return { open: () => { const r = { result: db }; setTimeout(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); }, 0); return r; } };
}

/* A fresh page: the engine, the loader, and shims for what they lean on. */
function page(opts) {
  opts = opts || {};
  const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, String, Array };
  ctx.window = ctx; ctx.self = ctx;
  ctx.BUILD = 'test';
  ctx.statusLog = []; ctx.loadCalls = 0; ctx.computeCalls = 0;
  ctx.setMapStatus = function (m) { ctx.statusLog.push(m); ctx._mapStatusTransient = m || null; };
  ctx._mapStatusTransient = null;
  ctx.scLoading = function () {};
  ctx.loadChunk = function (key) { ctx.loadCalls++; return Promise.resolve(key === CHUNK ? JSON.parse(JSON.stringify(RECS)) : []); };
  if (opts.idb) ctx.indexedDB = opts.idb;
  if (opts.Worker) ctx.Worker = opts.Worker;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(R + 'js/pathgen.js', 'utf8'), ctx);
  const real = ctx.PathGen.eclipse_path;
  ctx.PathGen.eclipse_path = function (rec) { ctx.computeCalls++; return real(rec); };
  if (opts.version) ctx.PathGen.VERSION = opts.version;
  vm.runInContext(fs.readFileSync(R + 'js/paths.js', 'utf8'), ctx);
  return ctx;
}

(async function () {
  const expected = JSON.stringify(require(R + 'js/pathgen.js').eclipse_path(JSON.parse(JSON.stringify(REC_2024))));

  console.log('1. computed on the device (no worker, no IndexedDB)');
  let w = page();
  let p = await w.loadPath(ENTRY_2024);
  ok('returns the engine\'s path', p && JSON.stringify(p) === expected);
  ok('the path has both umbral limits and a centreline', p && p.umbra_n.length && p.umbra_s.length && p.centreline.length);
  ok('status showed "Calculating eclipse path…"', w.statusLog[0] === 'Calculating eclipse path\u2026', JSON.stringify(w.statusLog));
  ok('status cleared afterwards', w.statusLog[w.statusLog.length - 1] === null, JSON.stringify(w.statusLog));
  const n1 = w.computeCalls;
  await w.loadPath(ENTRY_2024);
  ok('second request comes from memory (no recompute)', w.computeCalls === n1, w.computeCalls);

  console.log('2. the old interface');
  const chunk = await w.loadPathChunk(ENTRY_2024);
  const key = String(Math.round(REC_2024.cat_no));
  ok('loadPathChunk gives { cat_no: path }', chunk && Object.keys(chunk).join() === key && JSON.stringify(chunk[key]) === expected);
  ok('unknown eclipse → null', (await w.loadPath({ cat_no: 1, _chunk: 'nope' })) === null);
  ok('no entry → null', (await w.loadPath(null)) === null);

  console.log('3. background warm-up is silent');
  w = page();
  await w.loadPath(ENTRY_2024, true);
  ok('quiet load shows no status', w.statusLog.length === 0, JSON.stringify(w.statusLog));

  console.log('4. the worker route');
  function FakeWorker() {
    const me = this;
    this.postMessage = function (m) {
      setTimeout(() => { let out; try { out = { id: m.id, path: me.ctx.PathGen.eclipse_path(m.rec) }; } catch (e) { out = { id: m.id, error: String(e) }; }
                         me.onmessage({ data: out }); }, 0);
    };
  }
  w = page({ Worker: function () { const f = new FakeWorker(); f.ctx = w; return f; } });
  p = await w.loadPath(ENTRY_2024);
  ok('path computed via the worker', p && JSON.stringify(p) === expected);

  console.log('5. a crashing worker falls back to the main thread');
  function BrokenWorker() { const me = this; this.postMessage = function () { setTimeout(() => me.onerror({}), 0); }; }
  w = page({ Worker: BrokenWorker });
  p = await w.loadPath(ENTRY_2024);
  ok('path still computed', p && JSON.stringify(p) === expected);

  console.log('6. the device cache (IndexedDB) survives a reload');
  const store = new Map();
  w = page({ idb: fakeIndexedDB(store) });
  await w.loadPath(ENTRY_2024);
  await new Promise(r => setTimeout(r, 20));
  ok('stored under cat_no|VERSION', [...store.keys()].some(k => k === key + '|' + w.PathGen.VERSION), JSON.stringify([...store.keys()]));
  const w2 = page({ idb: fakeIndexedDB(store) });
  p = await w2.loadPath(ENTRY_2024);
  ok('a new page reads it without computing', w2.computeCalls === 0 && JSON.stringify(p) === expected, w2.computeCalls);
  ok('and shows no status', w2.statusLog.length === 0, JSON.stringify(w2.statusLog));

  console.log('7. a new engine version recomputes and drops the old entry');
  const w3 = page({ idb: fakeIndexedDB(store), version: 'next' });
  await w3.loadPath(ENTRY_2024);
  await new Promise(r => setTimeout(r, 20));
  ok('recomputed', w3.computeCalls === 1, w3.computeCalls);
  ok('old version\'s entry deleted', ![...store.keys()].some(k => k.endsWith('|' + w.PathGen.VERSION)), JSON.stringify([...store.keys()]));

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
