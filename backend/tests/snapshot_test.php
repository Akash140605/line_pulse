<?php
/**
 * Unit test for lib/snapshot.php (last good copy shown when a line is offline). No database needed.
 * Run:  php tests/snapshot_test.php
 */
require_once __DIR__ . '/../lib/snapshot.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

// which errors mean "line not reachable"
ok('TCP timeout → offline', snap_is_offline_error('SQLSTATE[08001]: [Microsoft][ODBC Driver 17 for SQL Server]TCP Provider: Timeout error [258].'), true);
ok('login failed → offline', snap_is_offline_error('SQLSTATE[28000]: Login failed for user'), true);
ok('login timeout → offline', snap_is_offline_error('SQLSTATE[HYT00]: Login timeout expired'), true);
ok('query mistake → not offline', snap_is_offline_error('SQLSTATE[42S02]: Invalid object name dbo.Foo'), false);
ok('bad input → not offline', snap_is_offline_error('start and end (YYYY-MM-DD) are required'), false);

// save / load
$key = 'unit_' . getmypid();
ok('error answers are not kept', snap_save($key, '{"error":"x"}'), false);
ok('non JSON is not kept', snap_save($key, 'Fatal error'), false);
ok('good answer kept', snap_save($key, '{"a":1}'), true);
$s = snap_load($key);
ok('loaded back', $s[0], '{"a":1}');
ok('saved time in DB time format', (bool)preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', $s[1]), true);
ok('missing → null', snap_load('nope_' . getmypid()), null);
@unlink(snap_path($key));

// rows of the all-lines answers
$GLOBALS['EMS_BACKUP_USED'] = [];
snap_save_row('unit', 3, ['line' => '3', 'ok' => true, 'total' => 120, 'lastScan' => '2026-11-03 08:41:10', 'day' => '2026-11-03']);
snap_save_row('unit', 3, ['line' => '3', 'ok' => false, 'total' => 0]);                       // a failed row never replaces a good one
snap_save_row('unit', 3, ['line' => '3', 'ok' => true, 'total' => 5, 'backup' => ['upTo' => 'x']]); // nor a backup row
$r = snap_row('unit', 3);
ok('row: good one kept', $r['total'], 120);
ok('row: marked ok + snapshot', [$r['ok'], $r['snapshot'], $r['backup']['kind']], [true, true, 'snapshot']);
ok('row: data up to its last scan', $r['backup']['upTo'], '2026-11-03 08:41:10');
ok('row: header data for the screen', array_keys($GLOBALS['EMS_BACKUP_USED']), [3]);
ok('header carries kind snapshot', json_decode(backup_header_value($GLOBALS['EMS_BACKUP_USED']), true)['3']['kind'], 'snapshot');
ok('row of another period → none', snap_row('unit', 3, 'other-period'), null);
@unlink(snap_path(snap_row_key('unit', 3)));


// a dead line is skipped for a short time
@unlink(snap_down_file(97));
ok('line not marked → asked', snap_line_down(97), null);
snap_mark_down(97, 'SQLSTATE[08001]: TCP Provider: Timeout error');
ok('just failed → skipped, with its error', snap_line_down(97), 'SQLSTATE[08001]: TCP Provider: Timeout error');
snap_mark_up(97);
ok('answered again → asked', snap_line_down(97), null);
snap_mark_down(97, 'SQLSTATE[08001]: dropped', 0.4);
ok('a quick failure (dropped packet) is not skipped: asked again next time', snap_line_down(97), null);

// no snapshot yet: the newest good row from the live_lines cache files still on this PC
$tmp = sys_get_temp_dir() . '/snaprec_' . getmypid(); @mkdir($tmp);
file_put_contents("$tmp/ems_a.json", json_encode(['focus' => '2026-11-02', 'findDayMs' => 3, 'lines' => [['line' => '96', 'ok' => true, 'total' => 812, 'lastScan' => '2026-11-02 20:58:00']]]));
touch("$tmp/ems_a.json", time() - 3600);
file_put_contents("$tmp/ems_b.json", json_encode(['focus' => '2026-11-03', 'findDayMs' => 3, 'lines' => [['line' => '96', 'ok' => false, 'total' => 0]]]));
file_put_contents("$tmp/ems_c.json", json_encode(['models' => []]));
$GLOBALS['EMS_BACKUP_USED'] = [];
@unlink(snap_path(snap_row_key('live', 96)));
$r = snap_recover_live_row(96, $tmp);
ok('recovered: last good row (failed newer row skipped)', [$r['total'] ?? null, $r['day'] ?? null], [812, '2026-11-02']);
ok('recovered row is marked as snapshot', [$r['snapshot'] ?? null, $r['backup']['upTo'] ?? null], [true, '2026-11-02 20:58:00']);
ok('kept as the snapshot from now on', snap_row('live', 96)['total'] ?? null, 812);
@unlink(snap_path(snap_row_key('live', 96)));
ok('nothing found → not searched again for 10 min', snap_recover_live_row(95, $tmp) === null && snap_recover_live_row(95, $tmp) === null && is_file("$tmp/ems_recover_line95.tried"), true);
array_map('unlink', glob("$tmp/*")); @rmdir($tmp);

echo $fail ? "FAILED $fail\n" : "ALL OK\n";
exit($fail ? 1 : 0);
