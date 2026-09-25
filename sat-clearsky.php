<?php
/* sat-clearsky.php — Now's clear-sky reference, built ONCE on the server and shared.
 *
 * WHAT IT IS. For one satellite and one clock hour H: the second-warmest
 * infrared temperature per pixel over the frames at H on each of the last ten
 * days — exactly what js/cloud-now.js hourRef() builds on the phone. Built here,
 * every phone downloads one ~200 kB file instead of ten ~340 kB frames, and the
 * work is done once per satellite-hour for everyone instead of once per phone.
 * Measured on Bluehost 2026-09-23 (probe.php): ~1 s per frame, almost all of it
 * the fetch; decode and the pixel pass are milliseconds.
 *
 * THE PHONE FALLS BACK TO BUILDING IT ITSELF on any failure here, so this file
 * can only make Now faster, never blank.
 *
 * REQUEST   sat-clearsky.php?s=goes-east&h=2026-09-23T13
 * RESPONSE  gzip of int16 little-endian, 1024 x 566, row-major, north first;
 *           tenths of a degree C; -32768 = no data. Header X-Clearsky-Grid names
 *           the grid; the phone refuses a grid that is not its own.
 *
 * THE DECODE IS A COPY of tempOf()/buildCube() in js/cloud-now.js, tables
 * included. tools/checks/test_clearsky.js compares the two over every colour
 * they can meet. Change one, change both, run the test.
 *
 * Cache: sys_get_temp_dir()/satclearsky, one file per satellite-hour, built
 * under a lock so simultaneous first requests build it once. Files older than
 * three days are swept on each build.
 */

$W = 1024; $H = 566;
$BBOX = '-20037508.34278924,-11068715.659379493,20037508.34278924,11068715.65937949';
$GRID = $W . 'x' . $H . ':-180,180,-70,70';
$FRAMES = 10; $VERSION = '1';
$UA = 'ShadowChaser/1.0 (+https://followtheshadow.com)';

$SATS = array(
  'goes-east' => array('svc' => 'gibs', 'temp' => 'cmap', 'layer' => 'GOES-East_ABI_Band13_Clean_Infrared'),
  'goes-west' => array('svc' => 'gibs', 'temp' => 'cmap', 'layer' => 'GOES-West_ABI_Band13_Clean_Infrared'),
  'himawari'  => array('svc' => 'gibs', 'temp' => 'cmap', 'layer' => 'Himawari_AHI_Band13_Clean_Infrared'),
  'mtg'       => array('svc' => 'eum',  'temp' => 'mtg',  'layer' => 'mtg_fd:ir105_hrfi'),
  'iodc'      => array('svc' => 'eum',  'temp' => 'iodc', 'layer' => 'msg_iodc:ir108')
);

/* ---- the decode: a copy of js/cloud-now.js (see header) ------------------ */
$GREY_A = -0.38598; $GREY_B = 57.2375;
$CMAP = [[255,255,255,-91.6],[127,0,127,-90.6],[140,13,135,-89.6],[153,25,142,-88.6],[165,38,150,-87.6],[178,51,157,-86.6],[191,64,165,-85.6],[204,76,173,-84.6],[217,89,180,-83.6],[229,102,188,-82.6],[242,114,195,-81.6],[255,127,203,-80.6],[230,230,230,-79.6],[204,204,204,-78.6],[177,177,177,-77.6],[155,155,155,-76.6],[129,129,129,-75.6],[102,102,102,-74.6],[76,76,76,-73.6],[54,54,54,-72.6],[27,27,27,-71.6],[5,5,5,-70.6],[26,0,0,-69.6],[51,0,0,-68.6],[77,0,0,-67.6],[102,0,0,-66.6],[128,0,0,-65.6],[153,0,0,-64.6],[179,0,0,-63.6],[204,0,0,-62.6],[230,0,0,-61.6],[255,0,0,-60.6],[255,26,0,-59.6],[255,51,0,-58.6],[255,77,0,-57.6],[255,102,0,-56.6],[255,128,0,-55.6],[255,153,0,-54.6],[255,179,0,-53.6],[255,204,0,-52.6],[255,230,0,-51.6],[255,255,0,-50.6],[230,255,0,-49.6],[204,255,0,-48.6],[179,255,0,-47.6],[153,255,0,-46.6],[128,255,0,-45.6],[102,255,0,-44.6],[77,255,0,-43.6],[51,255,0,-42.6],[26,255,0,-41.6],[0,255,0,-40.6],[0,234,10,-39.6],[0,212,19,-38.6],[0,191,29,-37.6],[0,170,38,-36.6],[0,149,48,-35.6],[0,128,58,-34.6],[0,106,67,-33.6],[0,85,77,-32.6],[0,64,86,-31.6],[0,42,96,-30.9],[0,21,105,-30.4],[0,0,115,-29.9],[0,0,125,-29.4],[0,13,122,-28.9],[0,26,129,-28.4],[0,38,136,-27.9],[0,51,143,-27.4],[0,64,150,-26.9],[0,76,157,-26.4],[0,89,164,-25.9],[0,102,171,-25.4],[0,115,178,-24.9],[0,128,185,-24.4],[0,140,192,-23.9],[0,153,199,-23.4],[0,166,206,-22.9],[0,178,213,-22.4],[0,191,220,-21.9],[0,204,227,-21.4],[0,217,234,-20.9],[0,230,241,-20.4],[0,242,248,-19.9],[0,255,255,-19.4],[197,197,197,-18.9],[196,196,196,-18.4],[194,194,194,-17.9],[193,193,193,-17.4],[192,192,192,-16.9],[191,191,191,-16.4],[189,189,189,-15.9],[188,188,188,-15.3],[187,187,187,-14.8],[185,185,185,-14.3],[184,184,184,-13.8],[183,183,183,-13.3],[181,181,181,-12.8],[180,180,180,-12.3],[179,179,179,-11.8],[178,178,178,-11.3],[176,176,176,-10.8],[175,175,175,-10.3],[174,174,174,-9.8],[172,172,172,-9.3],[171,171,171,-8.8],[170,170,170,-8.3],[169,169,169,-7.8],[167,167,167,-7.3],[166,166,166,-6.8],[165,165,165,-6.3],[163,163,163,-5.8],[162,162,162,-5.3],[161,161,161,-4.8],[159,159,159,-4.3],[158,158,158,-3.8],[157,157,157,-3.4],[156,156,156,-2.9],[154,154,154,-2.4],[153,153,153,-1.9],[152,152,152,-1.4],[150,150,150,-0.9],[149,149,149,-0.3],[148,148,148,0.2],[147,147,147,0.7],[145,145,145,1.1],[144,144,144,1.6],[143,143,143,2.1],[141,141,141,2.6],[140,140,140,3.1],[139,139,139,3.6],[138,138,138,4.2],[136,136,136,4.7],[135,135,135,5.2],[134,134,134,5.7],[132,132,132,6.2],[131,131,131,6.7],[130,130,130,7.2],[128,128,128,7.7],[127,127,127,8.2],[126,126,126,8.7],[125,125,125,9.2],[123,123,123,9.7],[122,122,122,10.2],[121,121,121,10.7],[119,119,119,11.2],[118,118,118,11.7],[117,117,117,12.2],[116,116,116,12.7],[114,114,114,13.2],[113,113,113,13.7],[112,112,112,14.2],[110,110,110,14.7],[109,109,109,15.2],[108,108,108,15.7],[106,106,106,16.1],[105,105,105,16.6],[104,104,104,17.1],[103,103,103,17.6],[101,101,101,18.1],[100,100,100,18.6],[99,99,99,19.1],[97,97,97,19.6],[96,96,96,20.1],[95,95,95,20.6],[94,94,94,21.1],[92,92,92,21.6],[91,91,91,22.1],[90,90,90,22.6],[88,88,88,23.1],[87,87,87,23.6],[86,86,86,24.1],[84,84,84,24.6],[83,83,83,25.1],[82,82,82,25.6],[81,81,81,26.1],[79,79,79,26.6],[78,78,78,27.1],[77,77,77,27.6],[75,75,75,28.1],[74,74,74,28.6],[73,73,73,29.1],[72,72,72,29.6],[70,70,70,30.1],[69,69,69,30.6],[68,68,68,31.1],[66,66,66,31.6],[65,65,65,32.1],[64,64,64,32.6],[62,62,62,33.1],[61,61,61,33.6],[60,60,60,34.1],[59,59,59,34.6],[57,57,57,35.1],[56,56,56,35.6],[55,55,55,36.1],[53,53,53,36.6],[52,52,52,37.1],[51,51,51,37.6],[50,50,50,38.1],[48,48,48,38.6],[47,47,47,39.1],[46,46,46,39.6],[44,44,44,40.1],[43,43,43,40.6],[42,42,42,41.1],[41,41,41,41.6],[39,39,39,42.1],[38,38,38,42.6],[37,37,37,43.1],[35,35,35,43.6],[34,34,34,44.1],[33,33,33,44.6],[31,31,31,45.1],[30,30,30,45.6],[29,29,29,46.1],[28,28,28,46.6],[26,26,26,47.1],[25,25,25,47.6],[24,24,24,48.1],[22,22,22,48.6],[21,21,21,49.1],[20,20,20,49.6],[19,19,19,50.1],[17,17,17,50.6],[16,16,16,51.1],[15,15,15,51.6],[13,13,13,52.1],[12,12,12,52.6],[11,11,11,53.1],[9,9,9,53.6],[8,8,8,54.1],[7,7,7,54.6],[6,6,6,55.1],[4,4,4,55.6],[3,3,3,56.1],[2,2,2,56.6]];
$EUM_T = ['mtg'=>[23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,22.9,21.6,21.6,20.6,20.4,19.1,19.1,17.6,17.6,16.1,16.1,15.2,15.2,14.2,14.2,13.2,13.2,12.7,12.7,11.7,11.7,10.7,10.4,10.2,9.9,9.2,8.7,8.2,7.4,6.7,6.2,5.7,5.2,4.7,4.2,3.6,3.1,2.5,1.9,1.3,0.7,0.2,-0.1,-0.4,-0.7,-1.0,-1.3,-1.6,-1.9,-2.2,-2.5,-2.8,-3.1,-3.4,-3.7,-4.0,-4.4,-4.8,-5.1,-5.4,-5.8,-6.2,-6.5,-6.8,-7.2,-7.5,-7.8,-8.1,-8.4,-8.7,-9.0,-9.3,-9.7,-10.0,-10.3,-10.6,-10.9,-11.2,-11.5,-11.8,-13.0,-14.1,-15.2,-16.3,-17.4,-18.6,-19.7,-20.8,-21.9,-23.0,-24.2,-25.3,-26.4,-27.5,-28.6,-29.7,-30.9,-32.0,-33.1,-34.2,-35.3,-36.5,-37.6,-38.7,-39.8,-40.9,-42.0,-43.2,-44.3,-45.4,-46.5,-47.6,-48.8,-49.9,-51.0,-52.1,-53.2,-54.3,-55.5,-56.6,-57.7,-58.8,-59.9,-61.1,-62.2,-63.3,-64.4,-65.5,-66.7,-67.8,-68.9,-70.0,-71.1,-72.2,-73.4,-74.5,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6],'iodc'=>[23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,23.1,21.6,21.1,20.6,20.6,19.1,17.6,17.6,17.6,16.1,16.1,15.2,15.2,14.2,13.2,12.9,12.7,12.3,12.0,11.7,11.3,11.0,10.7,10.3,9.9,9.5,9.2,8.7,8.2,7.7,7.2,6.7,6.3,6.0,5.7,5.3,5.0,4.7,4.3,4.0,3.7,3.4,3.1,2.8,2.5,2.1,1.8,1.4,1.0,0.7,0.3,-0.1,-0.4,-0.6,-0.8,-1.0,-1.2,-1.3,-1.5,-1.7,-1.9,-2.0,-2.2,-2.4,-2.6,-2.8,-3.0,-3.3,-3.5,-3.8,-4.0,-4.3,-4.6,-4.8,-5.1,-5.3,-5.6,-5.8,-6.1,-6.3,-6.6,-6.8,-7.1,-7.3,-7.6,-7.8,-8.1,-8.3,-8.6,-8.8,-9.1,-9.3,-9.6,-9.8,-10.1,-10.3,-10.6,-11.4,-12.3,-13.1,-13.9,-14.8,-15.6,-16.4,-17.3,-18.1,-19.0,-19.8,-20.6,-21.5,-22.3,-23.1,-24.0,-24.8,-25.6,-26.5,-27.3,-28.1,-29.0,-29.8,-30.6,-31.5,-32.3,-33.2,-34.0,-34.8,-35.7,-36.5,-37.3,-38.2,-39.0,-39.8,-40.7,-41.5,-42.3,-43.2,-44.0,-44.9,-45.7,-46.5,-46.9,-47.3,-47.6,-48.0,-48.4,-48.8,-49.1,-49.5,-49.9,-50.2,-50.6,-51.0,-51.4,-51.7,-52.1,-52.5,-52.9,-53.2,-53.6,-54.0,-54.3,-54.7,-55.1,-55.5,-55.8,-56.2,-56.6,-57.0,-57.3,-57.7,-58.1,-58.5,-58.8,-59.2,-59.6,-59.9,-60.3,-60.7,-61.1,-61.4,-61.8,-62.2,-62.6,-62.9,-63.3,-63.7,-64.0,-64.4,-64.8,-65.2,-65.5,-65.9,-66.3,-66.7,-67.0,-67.4,-67.8,-68.1,-68.5,-68.9,-69.3,-69.6,-70.0,-70.4,-70.8,-71.1,-71.5,-71.9,-72.2,-72.6,-73.0,-73.4,-73.7,-74.1,-74.5,-74.9,-75.2,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6,-75.6]];

/* 5-bit RGB cube, only the COLOURED entries (temperature below -11.5) — see
   buildCube() for why. Same arithmetic, same tie-breaking (first wins). */
function build_cube() {
  global $CMAP;
  $col = array();
  foreach ($CMAP as $c) if ($c[3] < -11.5) $col[] = $c;
  $cube = array();
  for ($r = 0; $r < 32; $r++) for ($g = 0; $g < 32; $g++) for ($b = 0; $b < 32; $b++) {
    $R8 = $r * 8 + 4; $G8 = $g * 8 + 4; $B8 = $b * 8 + 4; $bi = -1; $bd = 1e9;
    foreach ($col as $k => $c) {
      $d = ($c[0] - $R8) * ($c[0] - $R8) + ($c[1] - $G8) * ($c[1] - $G8) + ($c[2] - $B8) * ($c[2] - $B8);
      if ($d < $bd) { $bd = $d; $bi = $k; }
    }
    $cube[($r << 10) | ($g << 5) | $b] = $bi < 0 ? -11.5 : $col[$bi][3];
  }
  return $cube;
}

function temp_of($temp, $r, $g, $b, &$cube) {
  global $GREY_A, $GREY_B, $EUM_T;
  if ($temp === 'cmap') {
    $mx = max($r, $g, $b); $mn = min($r, $g, $b);
    if ($mx - $mn <= 12) return $GREY_A * (($r + $g + $b) / 3) + $GREY_B;
    return $cube[(($r >> 3) << 10) | (($g >> 3) << 5) | ($b >> 3)];
  }
  $v = ($r + $g + $b) / 3;
  return $EUM_T[$temp][$v < 0 ? 0 : ($v > 255 ? 255 : (int) $v)];
}

/* CLI: `php sat-clearsky.php decode-table` prints the decode of every colour the
   test needs, one per line, for tools/checks/test_clearsky.js. */
if (PHP_SAPI === 'cli') {
  if (isset($argv[1]) && $argv[1] === 'decode-table') {
    $cube = build_cube();
    for ($r = 0; $r < 256; $r += 3) for ($g = 0; $g < 256; $g += 3) for ($b = 0; $b < 256; $b += 3)
      echo temp_of('cmap', $r, $g, $b, $cube), "\n";
    foreach (array('mtg', 'iodc') as $t) for ($v = 0; $v < 256; $v++) echo temp_of($t, $v, $v, $v, $cube), "\n";
  }
  exit;
}

/* ---- request ------------------------------------------------------------- */
function fail($code, $msg) { http_response_code($code); header('Content-Type: text/plain'); header('Cache-Control: no-store'); exit($msg); }
$s = isset($_GET['s']) ? $_GET['s'] : '';
$h = isset($_GET['h']) ? $_GET['h'] : '';
if (!isset($SATS[$s])) fail(400, 'bad s');
if (!preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})$/', $h, $m)) fail(400, 'bad h');
$hour = gmmktime((int) $m[4], 0, 0, (int) $m[2], (int) $m[3], (int) $m[1]);
if ($hour > time() + 7200 || $hour < time() - 3 * 86400) fail(400, 'h out of range');
$sat = $SATS[$s];

$dir = sys_get_temp_dir() . '/satclearsky';
if (!is_dir($dir)) @mkdir($dir, 0700, true);
$key = $dir . '/' . $s . '_' . gmdate('YmdH', $hour) . '_v' . $VERSION . '.gz';

function send($file, $grid, $complete) {
  header('Content-Type: application/octet-stream');
  header('X-Clearsky-Grid: ' . $grid);
  /* A reference missing today's frame (not yet published when it was built)
     is rebuilt later on the server; the phone should not hold it long either. */
  header('Cache-Control: public, max-age=' . ($complete ? 86400 : 900));
  header('Content-Length: ' . filesize($file));
  readfile($file);
  exit;
}
/* A cached file is good until the hour's last frame could still be missing:
   the ".partial" twin marks a build that lacked a frame, and it expires. */
function fresh($key) {
  if (!is_file($key)) return false;
  if (!is_file($key . '.partial')) return true;
  return (time() - filemtime($key)) < 900;
}
if (fresh($key)) send($key, $GRID, !is_file($key . '.partial'));

$lock = @fopen($key . '.lock', 'c');
if (!$lock) fail(503, 'no lock');
flock($lock, LOCK_EX);                       /* others wait here while one builds */
if (fresh($key)) { flock($lock, LOCK_UN); send($key, $GRID, !is_file($key . '.partial')); }
@set_time_limit(90);

/* ---- fetch the frames, in parallel --------------------------------------- */
$UP = array('eum' => 'https://view.eumetsat.int/geoserver/wms',
            'gibs' => 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi');
$mh = curl_multi_init(); $hs = array(); $wanted = 0;
for ($n = 0; $n < $FRAMES; $n++) {
  $t = $hour - $n * 86400;
  if ($t > time()) continue;                 /* today's, for an hour not yet reached */
  $wanted++;
  $iso = gmdate('Y-m-d\TH:i:s', $t) . ($sat['svc'] === 'eum' ? '.000Z' : 'Z');
  $u = $UP[$sat['svc']] . '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
     . '&LAYERS=' . rawurlencode($sat['layer'])
     . '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE'
     . '&WIDTH=' . $W . '&HEIGHT=' . $H . '&BBOX=' . rawurlencode($BBOX) . '&TIME=' . rawurlencode($iso);
  $c = curl_init($u);
  curl_setopt_array($c, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 45, CURLOPT_USERAGENT => $UA));
  curl_multi_add_handle($mh, $c); $hs[$n] = $c;
}
do { $st = curl_multi_exec($mh, $running); if ($running) curl_multi_select($mh, 1.0); }
while ($running && $st === CURLM_OK);

/* ---- second-warmest per pixel -------------------------------------------- */
$cube = ($sat['temp'] === 'cmap') ? build_cube() : null;
$N = $W * $H;
$best = array_fill(0, $N, -999.0); $second = $best;
$used = 0; $todayOk = false;
foreach ($hs as $n => $c) {
  $body = curl_multi_getcontent($c);
  $code = (int) curl_getinfo($c, CURLINFO_HTTP_CODE);
  $ct = (string) curl_getinfo($c, CURLINFO_CONTENT_TYPE);
  curl_multi_remove_handle($mh, $c); curl_close($c);
  if ($code !== 200 || strpos($ct, 'image/') !== 0 || !$body) continue;
  $im = @imagecreatefromstring($body);
  if (!$im) continue;
  if (!imageistruecolor($im)) imagepalettetotruecolor($im);
  if (imagesx($im) !== $W || imagesy($im) !== $H) { imagedestroy($im); continue; }
  $used++; if ($n === 0) $todayOk = true;
  $i = 0;
  for ($y = 0; $y < $H; $y++) {
    for ($x = 0; $x < $W; $x++, $i++) {
      $p = imagecolorat($im, $x, $y);
      /* The phone skips alpha < 250; GD stores 127 - (alpha >> 1), so <= 2. */
      if ((($p >> 24) & 0x7F) > 2) continue;
      $t = temp_of($sat['temp'], ($p >> 16) & 0xFF, ($p >> 8) & 0xFF, $p & 0xFF, $cube);
      if ($t > $best[$i]) { $second[$i] = $best[$i]; $best[$i] = $t; }
      elseif ($t > $second[$i]) $second[$i] = $t;
    }
  }
  imagedestroy($im);
}
curl_multi_close($mh);
if (!$used) { flock($lock, LOCK_UN); fail(502, 'no frames'); }

/* ---- write --------------------------------------------------------------- */
$out = '';
for ($i = 0; $i < $N; $i++) {
  $v = $second[$i] < -900 ? $best[$i] : $second[$i];
  $out .= pack('v', $v < -900 ? 32768 : ((int) round($v * 10)) & 0xFFFF);
}
$tmp = $key . '.tmp' . getmypid();
file_put_contents($tmp, gzencode($out, 6));
rename($tmp, $key);
/* Only TODAY's frame can still turn up (published late, or not yet due); a day
   missing from the archive never will. So only a build without today's frame
   is provisional — it expires in 15 min and is rebuilt. */
$provisional = isset($hs[0]) ? !$todayOk : ($hour <= time() + 7200 && $hour > time() - 3600);
if ($provisional) @touch($key . '.partial'); else @unlink($key . '.partial');
foreach ((array) glob($dir . '/*') as $f) if (is_file($f) && time() - filemtime($f) > 3 * 86400) @unlink($f);
flock($lock, LOCK_UN);
header('X-Clearsky-Frames: ' . $used . '/' . $wanted);
send($key, $GRID, !$provisional);
