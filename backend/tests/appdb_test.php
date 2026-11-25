<?php
/**
 * lib/appdb.php + lib/store.php (19-11-2026): the settings in a database (SQL Server at the plant; SQLite here), the JSON
 * file kept beside it, the first copy from JSON, history, and saves made while the database was down.
 * Run:  php tests/appdb_test.php
 */
declare(strict_types=1);
$dir = sys_get_temp_dir() . '/appdb_test_' . getmypid();
@mkdir($dir, 0777, true);
$GLOBALS['EMS_STORE_DIR'] = $dir;
$GLOBALS['EMS_APPDB_DSN'] = 'sqlite:' . $dir . '/app.db';
$GLOBALS['EMS_APPDB_DOWN_FILE'] = $dir . '/down.json';
require_once __DIR__ . '/../lib/store.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }
$db = new PDO($GLOBALS['EMS_APPDB_DSN']);
$row = fn($n) => $db->query("SELECT Doc, Rev FROM AppStore WHERE Name = " . $db->quote($n))->fetch(PDO::FETCH_NUM) ?: null;
$hist = fn($n) => (int)$db->query("SELECT COUNT(*) FROM AppStoreHistory WHERE Name = " . $db->quote($n))->fetchColumn();

// 1) first start: an existing JSON file is copied into the database
file_put_contents("$dir/model_master.json", json_encode(['rows' => [['model' => 'A', 'cycle' => 20]]]));
ok('read: the JSON file of before', store_read('model_master'), ['rows' => [['model' => 'A', 'cycle' => 20]]]);
ok('…and it is now in the database (rev 1)', [json_decode($row('model_master')[0], true), (int)$row('model_master')[1]], [['rows' => [['model' => 'A', 'cycle' => 20]]], 1]);

// 2) a save goes to the database, the old version to the history, and the JSON copy follows
store_update('model_master', function ($d) { $d['rows'][] = ['model' => 'B', 'cycle' => 30]; return $d; });
ok('save: database has 2 models, rev 2', [count(json_decode($row('model_master')[0], true)['rows']), (int)$row('model_master')[1]], [2, 2]);
ok('save: the earlier version is in the history', $hist('model_master'), 1);
ok('save: the JSON copy is the same', json_decode(file_get_contents("$dir/model_master.json"), true), json_decode($row('model_master')[0], true));

// 3) the database is the source: a JSON file changed by hand does not win over it (checked once a minute)
file_put_contents("$dir/model_master.json", json_encode(['rows' => []]));
touch("$dir/model_master.indb", time() - 120);
ok('read comes from the database (and repairs the copy)', [count(store_read('model_master')['rows']), count(json_decode(file_get_contents("$dir/model_master.json"), true)['rows'])], [2, 2]);
// a change made in SSMS shows after the minute
$db->exec("UPDATE AppStore SET Doc = '{\"rows\":[]}' WHERE Name = 'model_master'");
ok('within the minute: the JSON copy (fast, no database)', count(store_read('model_master')['rows']), 2);
touch("$dir/model_master.indb", time() - 120);
ok('after the minute: the database change', count(store_read('model_master')['rows']), 0);
store_update('model_master', fn($d) => ['rows' => [['model' => 'A'], ['model' => 'B']]]);

// 4) a new store with no file: default, then a save creates the row
ok('new store: default', store_read('ole_rca', ['x' => 0]), ['x' => 0]);
store_update('ole_rca', fn($d) => ['x' => 1], ['x' => 0]);
ok('new store saved', json_decode($row('ole_rca')[0], true), ['x' => 1]);

// 5) a refused change (validation) saves nothing
try { store_update('ole_rca', function ($d) { throw new InvalidArgumentException('no'); }); } catch (InvalidArgumentException $e) { }
ok('refused change: nothing saved', [json_decode($row('ole_rca')[0], true), (int)$row('ole_rca')[1]], [['x' => 1], 1]);

// 6) history keeps only the last APPDB_KEEP versions
for ($i = 0; $i < APPDB_KEEP + 5; $i++) store_update('ole_days', fn($d) => ['n' => ($d['n'] ?? 0) + 1]);
ok('history trimmed to ' . APPDB_KEEP, $hist('ole_days'), APPDB_KEEP);
ok('…latest value', store_read('ole_days'), ['n' => APPDB_KEEP + 5]);

// 7) SQL Server down: the save goes to JSON + .pending, and is copied in when it answers again
$GLOBALS['EMS_APPDB_DSN'] = 'sqlite:/nonexistent_dir_xyz/app.db';     // cannot open → down
@unlink($GLOBALS['EMS_APPDB_DOWN_FILE']);
// a fresh PHP run would make a new connection; here the test runs the fallback part on its own
(function () use ($dir) {
    $cur = store_file_read('ole_rca', []);
    store_file_write('ole_rca', ['x' => 99]);
    touch(store_pending_file('ole_rca'));
})();
$GLOBALS['EMS_APPDB_DSN'] = 'sqlite:' . $dir . '/app.db';
ok('pending save: read copies the JSON into the database', store_read('ole_rca'), ['x' => 99]);
ok('…database has it, pending mark gone', [json_decode($row('ole_rca')[0], true), is_file("$dir/ole_rca.pending")], [['x' => 99], false]);

// 8) admin info: no password, the stores listed
$info = appdb_info();
ok('info: names of the stores', array_column($info['stores'], 'Name'), ['model_master', 'ole_days', 'ole_rca']);

array_map('unlink', glob("$dir/*") ?: []); @rmdir($dir);
echo $fail ? "appdb_test: $fail FAILED\n" : "appdb_test: ALL OK\n";
exit($fail ? 1 : 0);
