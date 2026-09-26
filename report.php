<?php
/* report.php — the app's line home (2026-09-25).
 *
 *   GET  ?ping=1   204, nothing else. The app's "am I online?" second opinion when
 *                  Esri is unreachable (map.js probeConnectivity / checkEsri).
 *   GET  ?test=1   Sends a test email now (at most once an hour) and says whether
 *                  PHP accepted it. "Accepted" is not "delivered": check the inbox.
 *   POST (JSON)    {what:'esri'|'osm', reason, basemap, build, ua} from map.js when
 *                  that tile provider refuses us. Logged always; emailed at most
 *                  once a day per provider.
 *
 * sw.js never caches .php, so every call reaches this file.
 */

const REPORT_TO = 'app@followtheshadow.com';     /* already public (About page, manual) */
const MAIL_FROM = 'noreply@followtheshadow.com';
const ALERT_GAP = 86400;                          /* one alert email per day */
const TEST_GAP  = 3600;                           /* one test email per hour */

header('Cache-Control: no-store');

function stamp_file($name) { return sys_get_temp_dir() . '/followtheshadow-' . $name; }

function due($name, $gap) {
    $f = stamp_file($name);
    $last = is_readable($f) ? (int) @file_get_contents($f) : 0;
    if (time() - $last < $gap) return false;
    @file_put_contents($f, (string) time());
    return true;
}

function send_mail($subject, $body) {
    $headers = 'From: ' . MAIL_FROM . "\r\n" .
               "Content-Type: text/plain; charset=UTF-8\r\n";
    return @mail(REPORT_TO, $subject, $body, $headers);
}

if (isset($_GET['ping'])) { http_response_code(204); exit; }

if (isset($_GET['test'])) {
    header('Content-Type: text/plain; charset=UTF-8');
    if (!due('test', TEST_GAP)) { echo "A test was sent less than an hour ago. Try later.\n"; exit; }
    $ok = send_mail('followtheshadow: test email',
                    "This is the test from report.php?test=1.\n" .
                    "If you are reading it, Esri alerts will reach you.\n");
    echo $ok ? "PHP accepted the email. Now check your inbox (and spam) for 'followtheshadow: test email'.\n"
             : "FAILED: this server would not send email from PHP.\n";
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode(file_get_contents('php://input', false, null, 0, 4096), true);
    $names = ['esri' => 'Esri', 'osm' => 'OpenStreetMap'];
    $what  = is_array($in) ? ($in['what'] ?? '') : '';
    if (!isset($names[$what])) { http_response_code(400); exit; }
    $name  = $names[$what];
    $clean = function ($k) use ($in) {
        return substr(preg_replace('/[^\x20-\x7E]/', '', (string) ($in[$k] ?? '')), 0, 200);
    };
    $line = $name . ' fallback: reason=' . $clean('reason') . ' basemap=' . $clean('basemap') .
            ' build=' . $clean('build') . ' ua=' . $clean('ua');
    error_log('followtheshadow ' . $line);
    if (due($what, ALERT_GAP)) {
        $stand = ($what === 'esri')
            ? "Topo zoomed out now uses OpenStreetMap, and Sat uses Sentinel-2 cloudless.\n" .
              "If this keeps happening: get the free ArcGIS Location Platform key (TODO.md).\n"
            : "Street now uses Esri Street instead.\n" .
              "If this keeps happening: OSM may have blocked the site (see their tile usage policy).\n";
        send_mail('followtheshadow: ' . $name . ' maps failing — stand-in in use',
                  "A visitor's app could not use the " . $name . " map tiles and switched to a stand-in.\n" .
                  $stand . "\n" . $line . "\n\n" .
                  "More reports are logged in the server error log; emails are limited to one a day.\n");
    }
    http_response_code(204);
    exit;
}

http_response_code(405);
