/* paths.js — Follow the Shadow — https://followtheshadow.com
 *
 * Eclipse paths, computed on the device by pathgen.js from the Besselian
 * elements the app already holds, so every eclipse in the catalogue has its path
 * offline. A computed path is kept in IndexedDB (keyed by catalogue number and
 * PathGen.VERSION, so an engine update recomputes), and in memory for the
 * session.
 *
 *   loadPath(entry)       -> Promise<path | null>   one eclipse's path
 *   loadPathChunk(entry)  -> Promise<{cat_no: path} | null>
 *                            the old interface (callers used to pick one eclipse
 *                            out of a century file); same shape, one eclipse
 *   warmPaths(entries)    compute and cache in idle time, one at a time
 *
 * While a path the user is waiting for is being computed, the map status reads
 * "Calculating eclipse path…" and the load bar runs.
 */

var PATH_DB = 'sc-paths', PATH_STORE = 'paths';
var PATH_BUSY_MSG = 'Calculating eclipse path\u2026';
var _pathMem = {}, _pathPend = {}, _pathBusyN = 0;

function _pathKey(entry) { return String(Math.round(entry.cat_no)) + '|' + PathGen.VERSION; }

/* ── device cache (IndexedDB) ────────────────────────────────────────────── */
var _pathDBp = null;
function _pathDB() {
  if (_pathDBp) return _pathDBp;
  _pathDBp = new Promise(function (resolve) {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    var rq;
    try { rq = indexedDB.open(PATH_DB, 1); } catch (e) { resolve(null); return; }
    rq.onupgradeneeded = function () { rq.result.createObjectStore(PATH_STORE); };
    rq.onerror = function () { resolve(null); };
    rq.onsuccess = function () {
      var db = rq.result;
      /* drop paths computed by an older engine */
      try {
        var cur = db.transaction(PATH_STORE, 'readwrite').objectStore(PATH_STORE).openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) return;
          if (String(c.key).split('|')[1] !== PathGen.VERSION) c.delete();
          c.continue();
        };
      } catch (e) { /* a failed tidy-up is harmless */ }
      resolve(db);
    };
  });
  return _pathDBp;
}
function _pathGet(k) {
  return _pathDB().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var rq = db.transaction(PATH_STORE).objectStore(PATH_STORE).get(k);
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  });
}
function _pathPut(k, v) {
  _pathDB().then(function (db) {
    if (!db) return;
    try { db.transaction(PATH_STORE, 'readwrite').objectStore(PATH_STORE).put(v, k); } catch (e) { /* cache is optional */ }
  });
}

/* ── computation: Web Workers, or the main thread if workers fail ──────────
   TWO workers: one for what the user asked for, one for background warm-up.
   With one, a selection queued behind a warm-up job (2.4 s extra, measured);
   now it never waits, and on a multi-core device the two run in parallel. */
var _pgWorkers = { fg: null, bg: null }, _pgSeq = 0, _pgWait = {};
function _pgMainThread(rec, what) {
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      try { resolve(what === 'mag' ? PathGen.eclipse_magnitude_curves(rec) : PathGen.eclipse_path(rec)); }
      catch (e) { reject(e); }
    }, 0);
  });
}
function _pgWorker(lane) {
  if (_pgWorkers[lane] === null) {
    try {
      var w = new Worker('js/pathgen-worker.js?v=' + BUILD);
      w.onmessage = function (e) {
        var job = _pgWait[e.data.id];
        if (!job) return;
        delete _pgWait[e.data.id];
        if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.path);
      };
      w.onerror = function () {                 /* this worker failed: finish its jobs here */
        _pgWorkers[lane] = false;
        Object.keys(_pgWait).forEach(function (id) {
          var job = _pgWait[id];
          if (job.lane !== lane) return;
          delete _pgWait[id];
          _pgMainThread(job.rec, job.what).then(job.resolve, job.reject);
        });
      };
      _pgWorkers[lane] = w;
    } catch (e) { _pgWorkers[lane] = false; }
  }
  return _pgWorkers[lane];
}
function _pgPending(lane) {
  return Object.keys(_pgWait).some(function (id) { return _pgWait[id].lane === lane; });
}
function _pgCompute(rec, what, background) {
  /* A request the user is waiting for stops any background job outright (the
     warm-up retries it later): on a single core two workers only take turns,
     and a selection waited ~2.4 s behind a warm-up job. */
  if (!background && _pgWorkers.bg && _pgPending('bg')) {
    _pgWorkers.bg.terminate(); _pgWorkers.bg = null;
    Object.keys(_pgWait).forEach(function (id) {
      if (_pgWait[id].lane !== 'bg') return;
      var job = _pgWait[id]; delete _pgWait[id];
      job.reject(new Error('preempted'));
    });
  }
  var lane = background ? 'bg' : 'fg', w = _pgWorker(lane);
  if (!w) return _pgMainThread(rec, what);
  return new Promise(function (resolve, reject) {
    var id = ++_pgSeq;
    _pgWait[id] = { resolve: resolve, reject: reject, rec: rec, what: what, lane: lane };
    w.postMessage({ id: id, rec: rec, what: what });
  });
}

/* ── the "Calculating eclipse path…" indicator ───────────────────────────── */
function _pathBusy(d) {
  _pathBusyN = Math.max(0, _pathBusyN + d);
  if (window.scLoading) window.scLoading(d);
  if (typeof setMapStatus !== 'function') return;
  if (_pathBusyN > 0) setMapStatus(PATH_BUSY_MSG);
  else if (typeof _mapStatusTransient !== 'undefined' && _mapStatusTransient === PATH_BUSY_MSG) setMapStatus(null);
}

/* ── public ──────────────────────────────────────────────────────────────── */
function loadPath(entry, quiet) {
  if (!entry || entry.cat_no == null || !entry._chunk || typeof PathGen === 'undefined') return Promise.resolve(null);
  var k = _pathKey(entry);
  if (_pathMem[k]) return Promise.resolve(_pathMem[k]);
  if (_pathPend[k]) return _pathPend[k];
  var shown = false;
  var p = _pathGet(k).then(function (hit) {
    if (hit) return hit;
    if (!quiet) { shown = true; _pathBusy(+1); }
    return loadChunk(entry._chunk).then(function (recs) {
      var cat = Math.round(entry.cat_no), rec = null;
      for (var i = 0; i < recs.length; i++)
        if (Math.round(parseFloat(recs[i].cat_no)) === cat) { rec = recs[i]; break; }
      if (!rec) return null;
      return _pgCompute(JSON.parse(JSON.stringify(rec)), 'path', !!quiet).then(function (path) {
        if (path) _pathPut(k, path);
        return path;
      });
    });
  }).then(function (path) {
    if (shown) _pathBusy(-1);
    if (path) _pathMem[k] = path;
    delete _pathPend[k];
    return path;
  }, function (err) {
    if (shown) _pathBusy(-1);
    delete _pathPend[k];
    if (!(err && err.message === 'preempted'))        /* a paused warm-up is not an error */
      console.error('Eclipse path could not be computed', entry.cat_no, err);
    return null;
  });
  _pathPend[k] = p;
  return p;
}

/* The equal-magnitude curves (0.2/0.4/0.6/0.8, N and S) for one eclipse. They
   cost about as much as the rest of the path, so they are computed SECOND — the
   map draws the path, then asks for these — and cached on their own. Silent: the
   path is already on screen. */
var _magMem = {}, _magPend = {};
function loadMagCurves(entry) {
  if (!entry || entry.cat_no == null || !entry._chunk || typeof PathGen === 'undefined'
      || !PathGen.eclipse_magnitude_curves) return Promise.resolve(null);
  var k = 'mag:' + _pathKey(entry);
  if (_magMem[k]) return Promise.resolve(_magMem[k]);
  if (_magPend[k]) return _magPend[k];
  var p = _pathGet(k).then(function (hit) {
    if (hit) return hit;
    return loadChunk(entry._chunk).then(function (recs) {
      var cat = Math.round(entry.cat_no), rec = null;
      for (var i = 0; i < recs.length; i++)
        if (Math.round(parseFloat(recs[i].cat_no)) === cat) { rec = recs[i]; break; }
      if (!rec) return null;
      return _pgCompute(JSON.parse(JSON.stringify(rec)), 'mag').then(function (mc) {
        if (mc) _pathPut(k, mc);
        return mc;
      });
    });
  }).then(function (mc) { if (mc) _magMem[k] = mc; delete _magPend[k]; return mc; },
          function (err) { delete _magPend[k]; console.error('Magnitude curves could not be computed', entry.cat_no, err); return null; });
  _magPend[k] = p;
  return p;
}

function loadPathChunk(entry) {
  return loadPath(entry).then(function (path) {
    if (!path) return null;
    var o = {};
    o[String(Math.round(entry.cat_no))] = path;
    return o;
  });
}

/* Compute and cache in the background, one eclipse at a time, only when the
   browser is idle — the eclipses in the user's log and the next few upcoming. */
function warmPaths(entries) {
  var list = (entries || []).filter(Boolean).slice(), tries = new Map();
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 300); };
  (function next() {
    if (!list.length) return;
    /* never while the user is waiting for something */
    if (_pgPending('fg')) { setTimeout(next, 500); return; }
    var e = list.shift();
    idle(function () {
      loadPath(e, true).then(function (p) {
        /* preempted (or failed): try again later, but only once more */
        var n = (tries.get(e) || 0) + 1;
        tries.set(e, n);
        if (!p && n < 2) list.push(e);
        next();
      });
    });
  })();
}
