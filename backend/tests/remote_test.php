<?php
/**
 * 25-11-2026 remote access (Apache 127.0.0.1:8090 + Cloudflare tunnel): a request through the remote door is read only
 * (only a login / log out and the activity notes), uses the visitor's own address (Cloudflare's header, never
 * 127.0.0.1) for the throttle, the key and the logs, accepts only a page of the remote address itself, and tells the
 * admin of every remote login. Runs PHP's own server on a temporary data folder (never the real logins, never a database).
 * Run only on a test PC:  php tests/remote_test.php
 */
$fail = 0;
function ok($n, $pass, $detail = '') { global $fail; if (!$pass) $fail++; echo ($pass ? 'ok   ' : 'FAIL ') . $n . ($pass ? '' : " — $detail") . "\n"; }
$root = realpath(__DIR__ . '/..');
$dir = sys_get_temp_dir() . '/ems_remote_test_' . getmypid();
@mkdir($dir, 0775, true);
$GLOBALS['EMS_STORE_DIR'] = $dir; $GLOBALS['EMS_APPDB_OFF'] = true;
require_once $root . '/lib/store.php';
store_update('users', fn() => ['users' => [
    'qa' => ['hash' => password_hash('Qa-test-123', PASSWORD_DEFAULT), 'role' => 'management', 'display' => 'QA', 'v' => 1],
    'boss' => ['hash' => password_hash('Boss-test-123', PASSWORD_DEFAULT), 'role' => 'admin', 'display' => 'Boss', 'v' => 1],
], 'enforce' => true]);
// an alert is raised once per kind, PC and login in 10 minutes: the marks of an earlier run go first
foreach ([['203.0.113.7', 'qa'], ['203.0.113.8', 'boss'], ['192.0.2.51', 'boss']] as [$aip, $au]) @unlink(sys_get_temp_dir() . '/ems_alert_' . md5("remote-login|$aip|$au"));
$port = 18000 + random_int(0, 999);
// the router plays Apache's remote door: SetEnv LP_REMOTE 1 (the tunnel's Cloudflare header comes from the client here)
$router = "$dir/router.php";
file_put_contents($router, '<?php $GLOBALS["EMS_STORE_DIR"] = ' . var_export($dir, true) . '; $GLOBALS["EMS_APPDB_OFF"] = true; $_SERVER["LP_REMOTE"] = "1";'
    . ' $p = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH); $f = ' . var_export($root, true) . ' . $p;'
    . ' if (is_file($f) && substr($f, -4) === ".php") { chdir(dirname($f)); $_SERVER["SCRIPT_NAME"] = $p; require $f; return true; } http_response_code(404); echo "nf";');
$proc = proc_open(escapeshellarg(PHP_BINARY) . " -S 127.0.0.1:$port " . escapeshellarg($router), [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
const HOST = 'line-pulse-test.trycloudflare.com';
function call(int $port, string $path, array $h = [], ?string $post = null): array {
    $h += ['Host' => HOST, 'Referer' => 'https://' . HOST . '/ems-dashboard/frontend/dist/', 'CF-Connecting-IP' => '203.0.113.7'];
    $hdr = ''; foreach ($h as $k => $v) if ($v !== null) $hdr .= "$k: $v\r\n";
    $o = ['ignore_errors' => true, 'timeout' => 20, 'header' => $hdr];
    if ($post !== null) { $o['method'] = 'POST'; $o['content'] = $post; $o['header'] .= "Content-Type: application/json\r\nX-EMS-Write: 1\r\n"; }
    $body = @file_get_contents("http://127.0.0.1:$port/api/$path", false, stream_context_create(['http' => $o]));
    preg_match('#HTTP/\S+\s+(\d+)#', $http_response_header[0] ?? '', $m);
    return [(int)($m[1] ?? 0), json_decode((string)$body, true)];
}
$login = fn($u, $p, $ip = '203.0.113.7', $extra = []) => call($port, 'auth.php', $extra + ['CF-Connecting-IP' => $ip, 'Origin' => 'https://' . HOST], json_encode(['action' => 'login', 'user' => $u, 'pass' => $p]));

// a login locked to its plant PCs: refused through the remote door until its list says "remote"
store_file_write('security', ['block' => [], 'lock' => ['boss' => ['192.168.2.50']]]);
[$st] = call($port, 'auth.php', ['CF-Connecting-IP' => '203.0.113.9', 'Origin' => 'https://' . HOST], json_encode(['action' => 'login', 'user' => 'boss', 'pass' => 'Boss-test-123']));
ok('a login locked to plant PCs is refused from outside', $st === 403, "HTTP $st");
store_file_write('security', ['block' => [], 'lock' => ['boss' => ['192.168.2.50', 'remote']]]);
[$st] = call($port, 'auth.php', ['CF-Connecting-IP' => '203.0.113.9', 'Origin' => 'https://' . HOST], json_encode(['action' => 'login', 'user' => 'boss', 'pass' => 'Boss-test-123']));
ok('… and works when its list says "remote"', $st === 200, "HTTP $st");
store_file_write('security', ['block' => ['remote'], 'lock' => []]);
[$st] = call($port, 'auth.php', ['CF-Connecting-IP' => '203.0.113.9', 'Origin' => 'https://' . HOST], json_encode(['action' => 'login', 'user' => 'qa', 'pass' => 'Qa-test-123']));
ok('"remote" in the blocked list closes the remote door', $st === 403, "HTTP $st");
store_file_write('security', ['block' => [], 'lock' => []]);

[$st] = call($port, 'ui_settings.php', ['Referer' => null]);
ok('no page around it → 403', $st === 403, "HTTP $st");
[$st] = $login('qa', 'Qa-test-123', '203.0.113.7', ['Origin' => 'https://evil.example', 'Referer' => 'https://evil.example/']);
ok('a login from another site → 403', $st === 403, "HTTP $st");
[$st, $j] = $login('qa', 'Qa-test-123');
$tok = (string)($j['token'] ?? '');
ok('login through the remote door works', $st === 200 && $tok !== '', "HTTP $st " . json_encode($j));
[$st] = call($port, 'ui_settings.php', ['X-EMS-Auth' => $tok]);
ok('reading works', $st === 200, "HTTP $st");
[, $jb] = $login('boss', 'Boss-test-123', '203.0.113.8');
[$st, $j] = call($port, 'ui_settings.php', ['X-EMS-Auth' => (string)($jb['token'] ?? ''), 'CF-Connecting-IP' => '203.0.113.8'], json_encode(['action' => 'save', 'ui' => []]));
ok('even the admin cannot save a setting: read only', $st === 403 && str_contains((string)($j['error'] ?? ''), 'read only'), "HTTP $st " . json_encode($j));
[$st] = call($port, 'ole.php', ['X-EMS-Auth' => $tok], json_encode(['action' => 'save']));
ok('a loss / quality entry is refused', $st === 403, "HTTP $st");
[$st, $j] = call($port, 'auth.php', ['X-EMS-Auth' => $tok], json_encode(['action' => 'password', 'old' => 'Qa-test-123', 'new' => 'Changed-123']));
ok('a password change is refused', $st === 403, "HTTP $st " . json_encode($j));
[$st] = call($port, 'activity.php', ['X-EMS-Auth' => $tok], json_encode(['action' => 'view', 'page' => 'dash', 'title' => 'Dashboard']));
ok('activity notes still go', $st === 200, "HTTP $st");
[$st] = call($port, 'ui_settings.php', ['X-EMS-Auth' => $tok, 'CF-Connecting-IP' => '198.51.100.9']);
ok('the key copied to another visitor address → refused', $st === 401 || $st === 403, "HTTP $st");
$act = (string)@file_get_contents(glob("$dir/activity/*.jsonl")[0] ?? '');
ok('activity log has the visitor address (not 127.0.0.1), marked remote', str_contains($act, '203.0.113.7 (remote)') && !str_contains($act, '"ip":"127.0.0.1"'), substr($act, 0, 300));
$al = json_encode(store_file_read('security_alerts', ['list' => []]));
ok('the admin is told of the remote login (one alert per login, PC and 10 minutes)', str_contains($al, 'remote-login') && str_contains($al, '(remote access)'), substr($al, 0, 300));
// the wrong-password throttle counts the visitor's own address
for ($i = 0; $i < 8; $i++) $login('boss', 'wrong-' . $i, '192.0.2.50');
[$st] = $login('boss', 'Boss-test-123', '192.0.2.50');
ok('many wrong passwords from one visitor → that visitor waits (429)', $st === 429, "HTTP $st");
[$st] = $login('boss', 'Boss-test-123', '192.0.2.51');
ok('another visitor is not held up by it', $st === 200, "HTTP $st");

proc_terminate($proc);
$rm = function ($d) use (&$rm) { foreach (glob("$d/*") ?: [] as $f) is_dir($f) ? $rm($f) : @unlink($f); @rmdir($d); };
$rm($dir);
echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
