<?php
/**
 * HTTP test of input validation, no database needed: starts PHP's built-in server on the backend folder,
 * sends bad parameters to every endpoint and expects a clean HTTP 400 with a JSON {"error": ...}.
 * (Bug found 24-10-2026: a bad date gave HTTP 500 because gzip output was started twice.)
 * 25-11-2026: the security layer first (no page / another site / no login / forged key refused), then the bad
 * parameters with a test login made in a temporary data folder. Run only on a test PC:  php tests/input_test.php
 */
$fail = 0;
function ok($n, $pass, $detail = '') { global $fail; if (!$pass) $fail++; echo ($pass ? 'ok   ' : 'FAIL ') . $n . ($pass ? '' : " — $detail") . "\n"; }

$port = 18000 + random_int(0, 999);
$root = realpath(__DIR__ . '/..');
// 25-11-2026: a temporary data folder (never the real logins, never the SQL settings database) and a router that
// points the API at it; a test login is made there, then the API is called as Line Pulse in the browser calls it.
$dir = sys_get_temp_dir() . '/ems_input_test_' . getmypid();
@mkdir($dir, 0775, true);
$GLOBALS['EMS_STORE_DIR'] = $dir; $GLOBALS['EMS_APPDB_OFF'] = true;
require_once $root . '/lib/store.php';
store_update('users', fn() => ['users' => ['qa' => ['hash' => password_hash('Qa-test-123', PASSWORD_DEFAULT), 'role' => 'admin', 'display' => 'QA', 'v' => 1]], 'enforce' => true]);
$router = "$dir/router.php";
file_put_contents($router, '<?php $GLOBALS["EMS_STORE_DIR"] = ' . var_export($dir, true) . '; $GLOBALS["EMS_APPDB_OFF"] = true;'
    . ' $p = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH); $f = ' . var_export($root, true) . ' . $p;'
    . ' if (is_file($f) && substr($f, -4) === ".php") { chdir(dirname($f)); $_SERVER["SCRIPT_NAME"] = $p; require $f; return true; } http_response_code(404); echo "nf";');
$cmd = escapeshellarg(PHP_BINARY) . " -S 127.0.0.1:$port " . escapeshellarg($router);
$proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
$APP = "http://127.0.0.1:$port/frontend/dist/";

function call(int $port, string $path, array $h = [], ?string $post = null): array {
    $hdr = ''; foreach ($h as $k => $v) $hdr .= "$k: $v\r\n";
    $o = ['ignore_errors' => true, 'timeout' => 20, 'header' => $hdr];
    if ($post !== null) { $o['method'] = 'POST'; $o['content'] = $post; $o['header'] .= "Content-Type: application/json\r\n"; }
    $body = @file_get_contents("http://127.0.0.1:$port/api/$path", false, stream_context_create(['http' => $o]));
    preg_match('#HTTP/\S+\s+(\d+)#', $http_response_header[0] ?? '', $m);
    $enc = ''; $acao = '';
    foreach ($http_response_header ?? [] as $x) { if (stripos($x, 'Content-Encoding:') === 0) $enc = trim(substr($x, 17)); if (stripos($x, 'Access-Control-Allow-Origin:') === 0) $acao = trim(substr($x, 28)); }
    if ($enc === 'gzip' && $body !== false) $body = gzdecode($body);
    return [(int)($m[1] ?? 0), json_decode((string)$body, true), $enc, $acao];
}

// security first: no page, another site, no login
[$st] = call($port, 'analytics.php?line=2&startDate=2026-10-01&endDate=2026-10-02');
ok('no Line Pulse page (a script) → 403', $st === 403, "HTTP $st");
[$st, , , $acao] = call($port, 'analytics.php?line=2&startDate=2026-10-01&endDate=2026-10-02', ['Origin' => 'http://evil.example', 'Referer' => 'http://evil.example/']);
ok('another site → 403, no CORS answer', $st === 403 && $acao === '', "HTTP $st ACAO '$acao'");
[$st] = call($port, 'analytics.php?line=2&startDate=2026-10-01&endDate=2026-10-02', ['Referer' => $APP]);
ok('from the page but not logged in → 401', $st === 401, "HTTP $st");
[$st] = call($port, 'analytics.php?line=2&startDate=2026-10-01&endDate=2026-10-02', ['Referer' => $APP, 'X-EMS-Auth' => 'forged.token']);
ok('a forged key → 401', $st === 401, "HTTP $st");
[$st] = call($port, 'auth.php', ['Referer' => $APP, 'X-EMS-Write' => '1'], json_encode(['action' => 'login', 'user' => 'qa', 'pass' => 'wrong']));
ok('wrong password → 401', $st === 401, "HTTP $st");
[$st, $j] = call($port, 'auth.php', ['Referer' => $APP, 'X-EMS-Write' => '1'], json_encode(['action' => 'login', 'user' => 'qa', 'pass' => 'Qa-test-123']));
$tok = (string)($j['token'] ?? '');
ok('login of the test user', $st === 200 && $tok !== '', "HTTP $st " . json_encode($j));
[$st] = call($port, 'activity.php', ['Referer' => $APP, 'X-EMS-Write' => '1', 'X-EMS-Auth' => $tok], json_encode(['action' => 'error', 'page' => 'targetcheck', 'title' => 'T', 'message' => 'boom', 'stack' => "a\nb", 'build' => 'x']));
ok('page error note accepted', $st === 200, "HTTP $st");
[$st] = call($port, 'activity.php', ['Referer' => $APP, 'X-EMS-Write' => '1', 'X-EMS-Auth' => $tok], json_encode(['action' => 'nonsense']));
ok('unknown activity action → 400', $st === 400, "HTTP $st");

// bad parameters with a valid login: a clean 400 with an error text (never 500). Needs config/db.php (its helpers
// read the parameters): a PC without it (a test copy) skips this part.
if (!is_file($root . '/config/db.php')) { echo "skip bad parameters: no config/db.php here\n"; goto done; }
$bad = [
    'analytics.php?line=2&startDate=abc&endDate=2026-10-24',
    'analytics.php?line=2&startDate=2026-10-01&endDate=2026/10/24',
    'range_overview.php?line=2&startDate=2026-10-01&endDate=bad',
    'day_overview.php?line=2&date=24-10-2026',
    'hour_detail.php?line=2&date=xx&hour=9',
    'all_lines.php?start=2020-01-01&end=2026-01-01',
    'all_lines.php?start=&end=2026-01-01',
    'model_runs.php?line=2&start=2026-10-01&end=2026-10-02',
];
foreach ([true, false] as $gzip) {
    foreach ($bad as $p) {
        [$st, $j] = call($port, $p, ['Referer' => $APP, 'X-EMS-Auth' => $tok, 'Accept-Encoding' => $gzip ? 'gzip' : 'identity']);
        ok(($gzip ? '[gzip] ' : '[plain] ') . "$p → 400 + error text", $st === 400 && is_array($j) && !empty($j['error']), "HTTP $st " . json_encode($j));
    }
}
[$st, $j, $enc] = call($port, 'analytics.php?line=2&startDate=abc&endDate=2026-10-24', ['Referer' => $APP, 'X-EMS-Auth' => $tok, 'Accept-Encoding' => 'gzip']);
ok('gzip is used when the browser accepts it', $enc === 'gzip', "Content-Encoding '$enc'");
done:

proc_terminate($proc);
$rm = function ($d) use (&$rm) { foreach (glob("$d/*") ?: [] as $f) is_dir($f) ? $rm($f) : @unlink($f); @rmdir($d); };
$rm($dir);
echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
