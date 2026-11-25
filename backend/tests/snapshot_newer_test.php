<?php
/**
 * Unit test: a line answered from an OLD SQL backup (mirror stopped) shows the newer last live read instead
 * (lib/snapshot.php snap_row_if_newer / snap_request_if_newer, lib/cache.php). No database is opened.
 * Run:  php tests/snapshot_newer_test.php
 */
$GLOBALS['EMS_NO_DB'] = true;   // the local backup copy is never asked (lib/backup.php backup_open)
$GLOBALS['EMS_BACKUP_INFO_DIR'] = sys_get_temp_dir() . '/ems_bi_none_' . getmypid();   // no kept backup facts: never the dashboard's own
$GLOBALS['EMS_BACKUP_USED'] = [];
require_once __DIR__ . '/../lib/cache.php';
$fail = 0;
function ok($n, $c, $e = '') { global $fail; if (!$c) { $fail++; echo "FAIL $n " . json_encode($e) . "\n"; } else echo "ok   $n\n"; }

// per line row (live_lines.php / all_lines.php)
$GLOBALS['EMS_BACKUP_USED'] = [];
snap_save_row('unitnew', 7, ['line' => '7', 'ok' => true, 'total' => 20, 'lastScan' => '2026-11-13 10:25:45', 'day' => '2026-11-13']);
$old = ['upTo' => '2026-10-27 10:02:00', 'syncedAt' => '2026-10-27 10:05:00'];
$r = snap_row_if_newer('unitnew', 7, '', $old);
ok('backup of 27-10, live read today → today\'s read shown', $r && $r['total'] === 20 && $r['day'] === '2026-11-13' && $r['backup']['kind'] === 'snapshot', $r);
ok('marked as snapshot in the header info', (backup_used()[7]['kind'] ?? '') === 'snapshot');
$GLOBALS['EMS_BACKUP_USED'] = [];
ok('backup newer than the read → backup kept', snap_row_if_newer('unitnew', 7, '', ['upTo' => '2099-01-01 00:00:00']) === null);
ok('no backup used → nothing', snap_row_if_newer('unitnew', 7, '', null) === null);
ok('already a snapshot → nothing', snap_row_if_newer('unitnew', 7, '', ['upTo' => '2000-01-01 00:00:00', 'kind' => 'snapshot']) === null);
ok('no saved read → nothing', snap_row_if_newer('unitnew', 8, '', $old) === null);
@unlink(snap_path(snap_row_key('unitnew', 7)));

// whole request (respond_cached)
$_SERVER['SCRIPT_NAME'] = '/api/unit_newer_' . getmypid() . '.php';
$_GET = ['line' => '1', 'start' => '2026-11-01', 'end' => '2026-11-13'];
@unlink(cache_file()); @unlink(cache_backup_file());
snap_save(snap_request_key(), '{"live":true}');
$GLOBALS['EMS_BACKUP_USED'] = [1 => $old];
ob_start(); respond_cached(fn() => ['fromBackup' => true], 20); $a = ob_get_clean();
ok('old backup → last live answer of the request', $a === '{"live":true}', $a);
ok('shared for a short time as a backup answer', is_file(cache_backup_file()));
@unlink(cache_backup_file());
$GLOBALS['EMS_BACKUP_USED'] = [1 => ['upTo' => '2099-01-01 00:00:00']];
ob_start(); respond_cached(fn() => ['fromBackup' => true], 20); $b = ob_get_clean();
ok('backup newer than the saved answer → backup answer', $b === '{"fromBackup":true}', $b);
@unlink(cache_file()); @unlink(cache_backup_file()); @unlink(snap_path(snap_request_key()));
echo $fail ? "$fail FAILED\n" : "all ok\n";
exit($fail ? 1 : 0);
