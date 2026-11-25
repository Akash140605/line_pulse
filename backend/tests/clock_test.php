<?php
/** Unit test for lib/clock.php: a line server clock that is far off (wrong date / hours) is not used. No database needed. */
$GLOBALS['EMS_CLOCK_FILE'] = sys_get_temp_dir() . '/ems_clock_test_' . getmypid() . '.json';   // never the dashboard's own file
require_once __DIR__ . '/../lib/clock.php';
$fail = 0;
function ok($n, $c, $e = '') { global $fail; if (!$c) { $fail++; echo "FAIL $n " . json_encode($e) . "\n"; } else echo "ok   $n\n"; }
$GLOBALS['DBNOW'] = date('Y-m-d H:i:s', time() + 180);
function db_now(&$src) { $src = 'test'; return $GLOBALS['DBNOW']; }
@unlink(ems_clock_file());
ok('3 min difference: the DB clock is used', abs(ems_clock_offset(true) - 180) <= 2, ems_clock_offset());
$GLOBALS['DBNOW'] = date('Y-m-d H:i:s', time() - 17 * 86400 + 3600);   // a line PC set to another date
ok('17 days off: this PC clock is used', ems_clock_offset(true) === 0, ems_clock_offset());
ok('today = this PC day', ems_today() === date('Y-m-d'), ems_today());
file_put_contents(ems_clock_file(), json_encode(['off' => -17 * 86400, 'next' => time() + 600]));   // saved by an older version
$GLOBALS['DBNOW'] = 'x';
ok('a far-off offset saved earlier is not used', ems_clock_offset(true) === 0 || ems_clock_offset() === 0, ems_clock_offset());
@unlink(ems_clock_file());
// India time for every date() (php.ini of the plant PC says Europe/Berlin: saved times were 4 h 30 min behind)
ok('time zone is India', date_default_timezone_get() === 'Asia/Kolkata', date_default_timezone_get());
ok('00:30 India is already the new day', date('Y-m-d H:i', strtotime('2026-11-17 19:00:00 UTC')) === '2026-11-18 00:30', date('Y-m-d H:i', strtotime('2026-11-17 19:00:00 UTC')));
ok('DB clock text read as India time (offset small, not 4 h 30 min)', abs(strtotime('2026-11-18 08:00:00') - strtotime('2026-11-18T02:30:00Z')) === 0);
ok('clock file of this test is its own', strpos(ems_clock_file(), 'ems_clock_test_') !== false);
echo $fail ? "$fail FAILED\n" : "all ok\n";
exit($fail ? 1 : 0);
