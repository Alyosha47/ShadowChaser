<?php
/* sat.php — same-origin satellite imagery proxy for followtheshadow.com
 *
 * WHY THIS EXISTS. Now reads pixels out of the imagery to decode infrared into a
 * temperature, and reading pixels cross-origin requires the provider to send
 * access-control-allow-origin. On 2026-08-20 EUMETSAT stopped sending it on
 * GetMap: the byte-identical URL that carried the header the previous evening
 * returned none, on every endpoint, with and without an Origin header. Nothing
 * client-side can conjure it back, and central Africa went blank in Now.
 *
 * Fetched from followtheshadow.com this file is SAME-ORIGIN, so the browser
 * never applies CORS. What the upstream sends, or stops sending, is irrelevant.
 *
 * IT TAKES WMS PARAMETERS, NOT A URL. Two earlier shapes were refused by
 * Bluehost's mod_security before ever reaching PHP — a full URL in ?u= (it
 * matches on the scheme) and a long base64 blob in ?q= (it matches on the
 * opaque payload; a short ?q=abc passed, so it was the blob, not the file).
 * Ordinary short parameters look like ordinary traffic. They also mean this
 * CANNOT be aimed anywhere: the host and path are chosen here, not supplied.
 *
 * NOT a tile server: no ingest, no reprojection, no storage beyond a file cache.
 */

$SERVICES = array(
  'eum'  => 'https://view.eumetsat.int/geoserver/wms',
  'gibs' => 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi'
);

/* Layers must be named explicitly. An arbitrary LAYERS value would let anyone
   use this to trawl either service through your domain. */
$LAYERS = array(
  'mtg_fd:ir105_hrfi',
  'mtg_fd:rgb_geocolour',
  'msg_iodc:ir108',
  'msg_iodc:rgb_natural',
  'GOES-East_ABI_Band13_Clean_Infrared',
  'GOES-West_ABI_Band13_Clean_Infrared',
  'Himawari_AHI_Band13_Clean_Infrared',
  'GOES-East_ABI_GeoColor',
  'GOES-West_ABI_GeoColor',
  'Himawari_AHI_Band3_Red_Visible_1km'
);

function bad($code, $msg) { http_response_code($code); header('Content-Type: text/plain'); exit($msg); }

$s = isset($_GET['s']) ? $_GET['s'] : '';
$l = isset($_GET['l']) ? $_GET['l'] : '';
$b = isset($_GET['b']) ? $_GET['b'] : '';
$t = isset($_GET['t']) ? $_GET['t'] : '';
$w = isset($_GET['w']) ? (int) $_GET['w'] : 0;
$h = isset($_GET['h']) ? (int) $_GET['h'] : 0;

if (!isset($SERVICES[$s]))              bad(400, 'bad s');
if (!in_array($l, $LAYERS, true))       bad(400, 'bad l');
$findOnly = (isset($_GET['f']) && $_GET['f'] === 'newest');
if (!$findOnly) {
  if (!preg_match('/^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$/', $b)) bad(400, 'bad b');
  if (!preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z)?$/', $t)) bad(400, 'bad t');
  if ($w < 1 || $w > 2048 || $h < 1 || $h > 2048) bad(400, 'bad size');
}

/* ?f=newest — RESOLVE THE FRAME TIME SERVER-SIDE, and return it as text.
   The client used to probe eight candidate timestamps in parallel to find the
   newest published frame. Direct to GIBS that is one round trip and fine. Through
   this proxy it is eight PHP processes per satellite, sixteen for the two
   Meteosat discs, and shared hosting runs only a handful at once — so they
   queue, and Now took ~15s to draw. Done here it is ONE request, and the answer
   is cached, so the second viewer pays nothing.
   The client still fetches the image itself; this only answers "which frame". */
if (isset($_GET['f']) && $_GET['f'] === 'newest') {
  $step = ($s === 'eum' && strpos($l, 'iodc') !== false) ? 900 : 600;
  $ms   = ($s === 'eum') ? '.000Z' : 'Z';

  $ckey = $dirN = sys_get_temp_dir() . '/satcache';
  if (!is_dir($dirN)) { @mkdir($dirN, 0700, true); }
  $nkey = $dirN . '/t_' . sha1($s . '|' . $l);
  if (is_file($nkey) && (time() - filemtime($nkey)) < 240) {
    header('Content-Type: text/plain');
    header('X-Sat-Cache: hit');
    readfile($nkey);
    exit;
  }

  $now = (int) (floor(time() / $step) * $step);
  for ($k = 0; $k < 8; $k++) {
    $iso = gmdate('Y-m-d\\TH:i:s', $now - $k * $step) . $ms;
    $try = $SERVICES[$s]
         . '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
         . '&LAYERS=' . rawurlencode($l)
         . '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE'
         . '&WIDTH=64&HEIGHT=32&BBOX=0%2C-1000000%2C1000000%2C1000000'
         . '&TIME=' . rawurlencode($iso);
    $c = curl_init($try);
    curl_setopt_array($c, array(
      CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 20,
      CURLOPT_USERAGENT => 'ShadowChaser/1.0 (+https://followtheshadow.com)'
    ));
    $bd = curl_exec($c);
    $ct2 = (string) curl_getinfo($c, CURLINFO_CONTENT_TYPE);
    curl_close($c);
    if ($bd !== false && strpos($ct2, 'image/') === 0 && strlen($bd) > 900) {
      @file_put_contents($nkey, $iso, LOCK_EX);
      header('Content-Type: text/plain');
      header('X-Sat-Cache: miss');
      echo $iso;
      exit;
    }
  }
  header('Content-Type: text/plain');
  http_response_code(404);
  exit('none');
}

$u = $SERVICES[$s]
   . '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
   . '&LAYERS=' . rawurlencode($l)
   . '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE'
   . '&WIDTH=' . $w . '&HEIGHT=' . $h
   . '&BBOX=' . rawurlencode($b)
   . '&TIME=' . rawurlencode($t);

/* A published frame is immutable — the same TIME always yields the same image —
   so caching costs nothing in accuracy and spares both your bandwidth and the
   upstream. 15 min is longer than any frame cadence but short enough that a
   mis-cached failure clears itself. */
$dir = sys_get_temp_dir() . '/satcache';
if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
$key = $dir . '/' . sha1($u);
$TTL = 900;

if (is_file($key) && (time() - filemtime($key)) < $TTL) {
  header('Content-Type: image/png');
  header('Cache-Control: public, max-age=300');
  header('X-Sat-Cache: hit');
  readfile($key);
  exit;
}

$ch = curl_init($u);
curl_setopt_array($ch, array(
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS      => 3,
  CURLOPT_CONNECTTIMEOUT => 10,
  CURLOPT_TIMEOUT        => 45,
  CURLOPT_USERAGENT      => 'ShadowChaser/1.0 (+https://followtheshadow.com)'
));
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ct   = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err  = curl_error($ch);
curl_close($ch);

if ($body === false || $code < 200 || $code >= 300) {
  bad($code >= 400 ? $code : 502, 'upstream ' . $code . ($err !== '' ? ' ' . $err : ''));
}

/* Only cache real imagery. A WMS ServiceException is a 200 with an XML body;
   caching one would pin the failure in place for the whole TTL. */
if (strpos($ct, 'image/') === 0 && strlen($body) > 1500) {
  @file_put_contents($key, $body, LOCK_EX);
}

header('Content-Type: ' . ($ct !== '' ? $ct : 'image/png'));
header('Cache-Control: public, max-age=300');
header('X-Sat-Cache: miss');
echo $body;
