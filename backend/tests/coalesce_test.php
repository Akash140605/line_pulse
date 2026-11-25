<?php
/**
 * 25-11-2026 single flight (lib/cache.php cache_wait_for_other): 8 screens ask for the same answer in the same moment —
 * only one reads the "database" (a slow script here, never a real database); the others get its answer (X-Cache: SHARED).
 * Runs PHP's own server with several workers on a temporary folder. Run only on a test PC:  php tests/coalesce_test.php
 */
$fail = 0;
function ok($n, $pass, $detail = '') { global $fail; if (!$pass) $fail++; echo ($pass ? 'ok   ' : 'FAIL ') . $n . ($pass ? '' : " — $detail") . "\n"; }
if (!function_exists('curl_multi_init')) { echo "skip: no curl\nALL OK\n"; exit(0); }
$root = realpath(__DIR__ . '/..');
$dir = sys_get_temp_dir() . '/ems_coalesce_' . getmypid();
@mkdir($dir, 0775, true);
file_put_contents("$dir/clock.json", json_encode(['off' => 0, 'next' => time() + 900]));
$tag = bin2hex(random_bytes(4));
// the "endpoint": cached 4 s like the live screens; each real read counts itself and takes a second (a slow database)
file_put_contents("$dir/slow.php", '<?php $GLOBALS["EMS_STORE_DIR"] = ' . var_export($dir, true) . '; $GLOBALS["EMS_APPDB_OFF"] = true; $GLOBALS["EMS_CLOCK_FILE"] = ' . var_export("$dir/clock.json", true) . ';'
    . ' require ' . var_export("$root/lib/cache.php", true) . '; $_SERVER["SCRIPT_NAME"] = "/slow_' . $tag . '.php";'
    . ' cache_or_capture(4, false); $c = ' . var_export("$dir/count.txt", true) . '; $h = fopen($c, "c+"); flock($h, LOCK_EX); $n = (int)stream_get_contents($h) + 1; ftruncate($h, 0); rewind($h); fwrite($h, (string)$n); flock($h, LOCK_UN); fclose($h);'
    . ' $sl = (float)@file_get_contents(' . var_export("$dir/sleep.txt", true) . '); usleep((int)(($sl > 0 ? $sl : 1) * 1000000)); header("Content-Type: application/json"); echo json_encode(["reads" => $n, "v" => $_GET["v"] ?? ""]);');
// 8 separate servers on the same folder: 8 requests really at the same time, as Apache's threads
$base = 19000 + random_int(0, 900); $procs = [];
for ($k = 0; $k < 8; $k++) $procs[] = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . ($base + $k), "$dir/slow.php"], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pp, $dir);
for ($k = 0; $k < 8; $k++) for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $base + $k); $i++) usleep(100000);
$port = $base;
function many(int $port, int $n, string $q): array {
    $mh = curl_multi_init(); $hs = [];
    for ($i = 0; $i < $n; $i++) { $h = curl_init('http://127.0.0.1:' . ($port + $i % 8) . "/?$q"); curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 20]); curl_multi_add_handle($mh, $h); $hs[] = $h; }
    do { curl_multi_exec($mh, $run); curl_multi_select($mh, 0.05); } while ($run);
    $out = [];
    foreach ($hs as $h) { $r = curl_multi_getcontent($h); [$head, $body] = array_pad(explode("\r\n\r\n", (string)$r, 2), 2, ''); preg_match('/X-Cache: (\w+)/', $head, $m); preg_match('/X-Cache-Wait: (\w+)/', $head, $w); $out[] = ['wait' => $w[1] ?? '', 'cache' => $m[1] ?? '', 'body' => json_decode($body, true), 'code' => curl_getinfo($h, CURLINFO_HTTP_CODE)]; curl_multi_remove_handle($mh, $h); }
    return $out;
}
$t0 = microtime(true);
$r = many($port, 8, 'v=a');
$took = microtime(true) - $t0;
$reads = (int)@file_get_contents("$dir/count.txt");
ok('8 at once: one database read', $reads === 1, "reads $reads · " . json_encode(array_column($r, 'cache')));
ok('all 8 answered (200) with the same answer', count(array_filter($r, fn($x) => $x['code'] === 200 && ($x['body']['reads'] ?? 0) === 1)) === 8, json_encode($r));
ok('7 of them waited for it and shared it', count(array_filter($r, fn($x) => $x['wait'] !== '')) === 7, json_encode(array_map(fn($x) => $x['cache'] . '/' . $x['wait'], $r)));
ok('no extra waiting: about one read long', $took < 3.0, round($took, 2) . ' s');
$r2 = many($port, 3, 'v=b');
ok('another answer is read on its own', (int)@file_get_contents("$dir/count.txt") === 2, (string)@file_get_contents("$dir/count.txt"));
$r3 = many($port, 4, 'v=a');
ok('within the cache time: plain hits, no read', (int)@file_get_contents("$dir/count.txt") === 2 && count(array_filter($r3, fn($x) => $x['cache'] === 'HIT')) === 4, json_encode(array_column($r3, 'cache')));
// the database hangs (12 s) right when the answer runs out: the next screen gets the last answer after the wait (8 s),
// it does not send one more query to the struggling database
sleep(5);                                            // the 4 s answer of v=a has run out
file_put_contents("$dir/sleep.txt", '12');
$mh = curl_multi_init(); $hs = [];
foreach ([0, 1] as $i) { $h = curl_init('http://127.0.0.1:' . ($base + $i) . '/?v=a'); curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 30]); curl_multi_add_handle($mh, $h); $hs[] = $h; if ($i === 0) { curl_multi_exec($mh, $run); usleep(300000); } }
$t0 = microtime(true); $done = [];
do { curl_multi_exec($mh, $run); curl_multi_select($mh, 0.05); while ($info = curl_multi_info_read($mh)) { $done[(int)array_search($info['handle'], $hs, true)] = microtime(true) - $t0; } } while ($run);
$cs = [(string)curl_multi_getcontent($hs[0]), (string)curl_multi_getcontent($hs[1])];
$st = array_values(array_filter([0, 1], fn($i) => str_contains($cs[$i], 'X-Cache: STALE')));
$sk = $st[0] ?? -1; $mk = 1 - max(0, $sk);
ok('slow database: one screen gets the last answer (STALE)', count($st) === 1 && str_contains($cs[$sk], '"reads":1'), json_encode(array_map(fn($c) => substr($c, 0, 60), $cs)));
ok('… after the wait, long before the slow query ends', $sk >= 0 && ($done[$sk] ?? 99) < 10 && ($done[$sk] ?? 0) + 2 < ($done[$mk] ?? 0), json_encode($done));
ok('… and only the first one went to the database', (int)@file_get_contents("$dir/count.txt") === 3, (string)@file_get_contents("$dir/count.txt"));
foreach ($procs as $pr) proc_terminate($pr);
foreach (glob(sys_get_temp_dir() . '/ems_*.json*') ?: [] as $f) if (str_contains((string)@file_get_contents($f, false, null, 0, 200), '"reads"')) @unlink($f);
$rm = function ($d) use (&$rm) { foreach (glob("$d/*") ?: [] as $f) is_dir($f) ? $rm($f) : @unlink($f); @rmdir($d); };
$rm($dir);
echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
