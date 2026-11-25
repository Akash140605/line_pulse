<?php
/** Unit test: answers built from a line's backup are shared for a short time (lib/cache.php). No database is opened. */
$GLOBALS['EMS_NO_DB'] = true;   // the local backup copy is never asked (lib/backup.php backup_open)
$GLOBALS['EMS_BACKUP_INFO_DIR'] = sys_get_temp_dir() . '/ems_bi_none_' . getmypid();   // no kept backup facts: never the dashboard's own
$GLOBALS['EMS_BACKUP_USED'] = [];
require_once __DIR__ . '/../lib/cache.php';
$fail = 0;
function ok($n, $c, $e = '') { global $fail; if (!$c) { $fail++; echo "FAIL $n " . json_encode($e) . "\n"; } else echo "ok   $n\n"; }
$_SERVER['SCRIPT_NAME'] = '/api/unit_cache_' . getmypid() . '.php';
$_GET = ['line' => '1', 'start' => '2099-01-01'];
// the cache files and the last-good copy (data/snapshots) of this test request are removed before and after
$clean = function () { @unlink(cache_file()); @unlink(cache_backup_file()); @unlink(snap_path(snap_request_key())); };
$clean();
$runs = 0;
$build = function () use (&$runs) { $runs++; return ['n' => $runs]; };
// line offline → answered from its backup
$GLOBALS['EMS_BACKUP_USED'] = [1 => ['upTo' => '2026-11-12 19:04:00', 'syncedAt' => '2026-11-13 09:00:00']];
ob_start(); respond_cached($build, 20); $a = ob_get_clean();
ok('first answer built', $runs === 1 && $a === '{"n":1}', $a);
ok('not in the live cache', !is_file(cache_file()));
ok('kept as a backup answer', is_file(cache_backup_file()));
ob_start(); respond_cached($build, 20); $b = ob_get_clean();
ok('second request: shared, not built again', $runs === 1 && $b === '{"n":1}', [$runs, $b]);
// the line is back: next build (after the backup copy is stale) is live and removes the backup copy
touch(cache_backup_file(), time() - 3600); clearstatcache();
$GLOBALS['EMS_BACKUP_USED'] = [];
ob_start(); respond_cached($build, 20); $c = ob_get_clean();
ok('line back: built live', $runs === 2 && $c === '{"n":2}', $c);
ok('backup copy removed', !is_file(cache_backup_file()));
ok('live answer cached', is_file(cache_file()));
$clean();
echo $fail ? "$fail FAILED\n" : "all ok\n";
exit($fail ? 1 : 0);
