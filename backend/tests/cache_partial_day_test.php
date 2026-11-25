<?php
/** Unit test (21-11-2026): a finished day's cached answer saved while that day was still running is not kept for hours. No database. */
$GLOBALS['EMS_NO_DB'] = true;
$GLOBALS['EMS_BACKUP_INFO_DIR'] = sys_get_temp_dir() . '/ems_bi_none_' . getmypid();
$GLOBALS['EMS_BACKUP_USED'] = [];
require_once __DIR__ . '/../lib/cache.php';
$fail = 0;
function ok($n, $c, $e = '') { global $fail; if (!$c) { $fail++; echo "FAIL $n " . json_encode($e) . "\n"; } else echo "ok   $n\n"; }
$_SERVER['SCRIPT_NAME'] = '/api/unit_cache_pd_' . getmypid() . '.php';
$off = ems_clock_offset();
$today = ems_today();
$y = date('Y-m-d', strtotime($today . ' -1 day'));
$_GET = ['line' => '1', 'start' => $y, 'end' => $y];
$f = cache_file();
$at = fn($ymdHis) => strtotime($ymdHis) - $off;   // a DB-clock time as a file time
file_put_contents($f, '{"x":1}');
// saved yesterday 18:15 (the day still running): too old for the short TTL → not used
touch($f, $at("$y 18:15:00")); clearstatcache();
ok('partial day (saved before the day ended, > 60 s ago): read again', cache_hit(60) === null);
touch($f, time() - 10); clearstatcache();
ok('saved 10 s ago: used', cache_hit(60) === $f);
// saved after the day ended (today 00:30 or later): the long TTL of a finished day
touch($f, max($at("$today 00:30:00"), time() - 3 * 3600)); clearstatcache();
ok('whole day (saved after it ended): kept for hours', cache_ttl_for_file(60, filemtime($f)) > 60 && cache_hit(60) === $f, [cache_ttl_for_file(60, filemtime($f)), date('c', filemtime($f))]);
// today's request: the given TTL as before
$_GET = ['line' => '1', 'start' => $today, 'end' => $today];
ok('today: short TTL', cache_ttl_for_file(15, time()) === 15);
@unlink($f);
echo $fail ? "$fail FAILED\n" : "all ok\n";
exit($fail ? 1 : 0);
