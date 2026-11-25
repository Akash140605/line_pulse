<?php
/**
 * Unit test for lib/backup.php (offline fallback to the local backup copy). No database needed.
 * Run:  php tests/backup_test.php
 */
require_once __DIR__ . '/../lib/backup.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

$info = ['upTo' => '2026-10-26 10:02:09', 'syncedAt' => '2026-10-26 10:05:00', 'rows' => 165539, 'ready' => true];

// when may a request be answered from the backup?
ok('line offline + backup with data → backup', backup_should_fallback(true, [], $info), true);
ok('caller forbids it (mirror sync, tests) → no', backup_should_fallback(false, [], $info), false);
ok('?nobackup=1 → no', backup_should_fallback(true, ['nobackup' => '1'], $info), false);
ok('no backup database → no', backup_should_fallback(true, [], null), false);
ok('backup database still empty → no', backup_should_fallback(true, [], ['upTo' => null, 'syncedAt' => null, 'rows' => 0]), false);
ok('first copy still running (not ready) → no', backup_should_fallback(true, [], ['ready' => false] + $info), false);
ok('old info without "ready" → no', backup_should_fallback(true, [], array_diff_key($info, ['ready' => 1])), false);

// when is a backup complete? (scans in backup, scans on the line at the last copy, models, companies)
ok('ready: all copied', backup_ready(1556592, 1556592, 120, 15), true);
ok('ready: line scanned a few more since the last copy (≥ 99 %)', backup_ready(1550000, 1556592, 120, 15), true);
ok('not ready: first copy at 2 %', backup_ready(30000, 1556592, 120, 15), false);
ok('not ready: never copied (no source count)', backup_ready(30000, null, 120, 15), false);
ok('not ready: model table missing', backup_ready(1556592, 1556592, null, 15), false);
ok('not ready: company table empty', backup_ready(1556592, 1556592, 120, 0), false);
ok('not ready: empty backup', backup_ready(0, 0, 120, 15), false);

// header sent to the browser: which lines came from the backup and how old the data is
ok('header: one line', backup_header_value([3 => $info]), '{"3":{"upTo":"2026-10-26 10:02:09","syncedAt":"2026-10-26 10:05:00"}}');
ok('header: several lines, sorted', backup_header_value([4 => $info, 2 => $info]),
   '{"2":{"upTo":"2026-10-26 10:02:09","syncedAt":"2026-10-26 10:05:00"},"4":{"upTo":"2026-10-26 10:02:09","syncedAt":"2026-10-26 10:05:00"}}');
ok('header: plain ASCII only (HTTP header safe)', (bool)preg_match('/^[\x20-\x7e]+$/', backup_header_value([1 => $info])), true);
ok('header: nothing from backup → empty', backup_header_value([]), '');

// a row for one line of the overview screens
ok('row info for a line served from backup', backup_row_info([3 => $info], 3), ['upTo' => '2026-10-26 10:02:09', 'syncedAt' => '2026-10-26 10:05:00']);
ok('row info for a live line → null', backup_row_info([3 => $info], 4), null);

// results built from the backup must never be stored in the response cache (they would hide live data later)
ok('cache allowed when everything was live', backup_cache_allowed([]), true);
ok('cache refused when any line came from backup', backup_cache_allowed([2 => $info]), false);

// facts of a backup are kept 2 minutes in the temp folder: the check does not open this PC's SQL Server every request
$GLOBALS['EMS_NO_DB'] = true;   // backup_open() never connects in this test
$GLOBALS['EMS_BACKUP_INFO_DIR'] = sys_get_temp_dir() . '/ems_bi_test_' . getmypid(); @mkdir($GLOBALS['EMS_BACKUP_INFO_DIR']);   // never the dashboard's files
$L = 19; $f = backup_info_file($L);
file_put_contents($f, json_encode(['at' => time(), 'info' => ['upTo' => '2026-10-27 10:02:00', 'syncedAt' => '2026-10-27 10:05:00', 'rows' => 5, 'ready' => true]]));
ok('kept facts used: backup of 27-10 is old for 17-11', backup_stale_for($L, '2026-11-17'), true);
ok('kept facts used: backup of 27-10 is fine for 27-10', backup_stale_for($L, '2026-10-27'), false);
file_put_contents($f, json_encode(['at' => time() - BACKUP_INFO_TTL - 5, 'info' => ['upTo' => '2026-10-27 10:02:00']]));
ok('facts older than 2 min: asked again (no backup here → not old)', backup_stale_for($L, '2026-11-17'), false);
file_put_contents($f, json_encode(['at' => time(), 'info' => null]));
ok('kept "no backup": not old, no connection', backup_stale_for($L, '2026-11-17'), false);
@unlink($f);
backup_info($L);
ok('a test never writes the facts file', is_file($f), false);
ok('a day text that is not a date: not old', backup_stale_for($L, 'x'), false);
@rmdir($GLOBALS['EMS_BACKUP_INFO_DIR']);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
