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

/* ── computation: a background worker, or the main thread if workers fail ── */
var _pgWorker = null, _pgSeq = 0, _pgWait = {};
function _pgMainThread(rec) {
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      try { resolve(PathGen.eclipse_path(rec)); } catch (e) { reject(e); }
    }, 0);
  });
}
function _pgCompute(rec) {
  if (_pgWorker === null) {
    try {
      _pgWorker = new Worker('js/pathgen-worker.js?v=' + BUILD);
      _pgWorker.onmessage = function (e) {
        var w = _pgWait[e.data.id];
        if (!w) return;
        delete _pgWait[e.data.id];
        if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.path);
      };
      _pgWorker.onerror = function () {        /* the worker itself failed: finish its jobs here */
        _pgWorker = false;
        Object.keys(_pgWait).forEach(function (id) {
          var w = _pgWait[id]; delete _pgWait[id];
          _pgMainThread(w.rec).then(w.resolve, w.reject);
        });
      };
    } catch (e) { _pgWorker = false; }
  }
  if (!_pgWorker) return _pgMainThread(rec);
  return new Promise(function (resolve, reject) {
    var id = ++_pgSeq;
    _pgWait[id] = { resolve: resolve, reject: reject, rec: rec };
    _pgWorker.postMessage({ id: id, rec: rec });
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
      return _pgCompute(JSON.parse(JSON.stringify(rec))).then(function (path) {
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
    console.error('Eclipse path could not be computed', entry.cat_no, err);
    return null;
  });
  _pathPend[k] = p;
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
  var list = (entries || []).filter(Boolean).slice();
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 300); };
  (function next() {
    if (!list.length) return;
    var e = list.shift();
    idle(function () { loadPath(e, true).then(next, next); });
  })();
}
