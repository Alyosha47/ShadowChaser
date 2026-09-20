/* pathgen-worker.js — Follow the Shadow — https://followtheshadow.com
   Computes eclipse paths off the main thread, so the page never freezes.
   Message in:  { id, rec }   (rec: one Besselian record)
   Message out: { id, path }  or  { id, error } */
var v = (self.location.search.match(/[?&]v=([^&]+)/) || [])[1];
importScripts('pathgen.js' + (v ? '?v=' + v : ''));
console.warn = function () {};            /* validation notes are for the build tools, not the field */
self.onmessage = function (e) {
  var m = e.data;
  try { self.postMessage({ id: m.id, path: PathGen.eclipse_path(m.rec) }); }
  catch (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); }
};
