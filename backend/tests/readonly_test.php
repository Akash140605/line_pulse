<?php
/** The live line databases are never written: no data-changing SQL anywhere in the backend except the local backup copy. */
declare(strict_types=1);
require_once __DIR__ . '/../lib/readonly.php';

$fail = 0;
function ok(string $name, $got, $want): void
{
    global $fail;
    if ($got === $want) { echo "ok   $name\n"; return; }
    $fail++; echo "FAIL $name\n     got:  " . json_encode($got) . "\n     want: " . json_encode($want) . "\n";
}

// the pattern itself
$w = fn(string $s) => (bool)preg_match(RO_WRITE_SQL, $s);
ok('INSERT is caught', $w('INSERT INTO dbo.ScanStatus (a) VALUES (1)'), true);
ok('UPDATE … SET is caught', $w("UPDATE dbo.ScanStatus SET Status='X'"), true);
ok('DELETE FROM is caught', $w('DELETE FROM dbo.Tab_ModelMaster'), true);
ok('MERGE is caught', $w('MERGE dbo.T AS t USING s'), true);
ok('TRUNCATE / DROP / ALTER / CREATE are caught', [$w('TRUNCATE TABLE x'), $w('DROP TABLE x'), $w('ALTER TABLE x ADD y int'), $w('CREATE TABLE x (a int)')], [true, true, true, true]);
ok('stored procedures and dynamic SQL are caught', [$w('EXEC sp_rename'), $w('EXECUTE dbo.DoIt'), $w('sp_executesql @s')], [true, true, true]);
ok('SELECT … INTO (creates a table) is caught', $w('SELECT * INTO dbo.Copy FROM dbo.ScanStatus'), true);
ok('rights changes are caught', [$w('GRANT SELECT ON x TO y'), $w('DENY INSERT ON x TO y')], [true, true]);
ok('plain reads pass', [$w('SELECT COUNT(*) FROM dbo.ScanStatus s WHERE s.ScanDate >= ?'), $w('WITH a AS (SELECT 1 x) SELECT x FROM a'),
    $w('SELECT TOP 5 ISNULL(NULLIF(LTRIM(RTRIM(ErrorMessage)), \'\'), \'(no message)\') AS msg'), $w('$st->execute([$d]);')], [false, false, false, false]);
ok('SELECT … OVER (PARTITION BY) is a read', $w('LAG(ScanDate) OVER (PARTITION BY MMId ORDER BY ScanDate, ScanId)'), false);

// the whole backend
$bad = ro_scan_code(dirname(__DIR__));
ok('no SQL that changes a line database anywhere in the backend (only the local backup copy may write)', $bad, []);

// the local backup copy: its SQL builders run only on the local connection, and the local server is this PC
$mir = file(dirname(__DIR__) . '/lib/mirror.php');
$calls = array_filter($mir, fn($l) => preg_match('/mirror_(create|insert)_sql\(/', $l) && !preg_match('/^\s*function\s/', $l));
ok('backup SQL builders are run only on the local connection ($l)', array_values(array_filter($calls, fn($l) => strpos($l, '$l->') === false)), []);
ok('backup writes go to this PC only (localhost), never to a line server', (bool)preg_match("/const MIRROR_LOCAL_SERVER = 'localhost';/", implode('', $mir)), true);
ok('backup database names are separate from the line databases (EMS_Backup_Line<N>)', (bool)preg_match("/const MIRROR_DB_PREFIX = 'EMS_Backup_Line';/", implode('', $mir)), true);

// the settings database: this PC only, its own database name, never a line server
$app = implode('', file(dirname(__DIR__) . '/lib/appdb.php'));
ok('settings database is on this PC (localhost)', (bool)preg_match("/const APPDB_SERVER = 'localhost';/", $app), true);
ok('settings database has its own name (EMS_LinePulse_App)', (bool)preg_match("/const APPDB_NAME = 'EMS_LinePulse_App';/", $app), true);
ok('settings database code never touches a line connection ($pdo / $src)', (bool)preg_match('/\$(pdo|src)->/', $app), false);

// a planted write on a line connection is found
$tmp = sys_get_temp_dir() . '/ro_scan_' . getmypid();
@mkdir($tmp . '/api', 0777, true); @mkdir($tmp . '/lib', 0777, true);
file_put_contents("$tmp/api/x.php", "<?php\n\$pdo->exec(\"UPDATE dbo.ScanStatus SET Status = 'FALSE'\");\n// a comment about insert into is fine\n");
file_put_contents("$tmp/lib/mirror.php", "<?php\n\$l->exec(\"DELETE FROM \$full\");\n\$src->exec(\"DELETE FROM \$full\");\n");
ok('a write on a line connection is reported (file and line only)', ro_scan_code($tmp), ['api/x.php:2', 'lib/mirror.php:3']);
array_map('unlink', ["$tmp/api/x.php", "$tmp/lib/mirror.php"]); @rmdir("$tmp/api"); @rmdir("$tmp/lib"); @rmdir($tmp);

echo $fail ? "readonly_test: $fail FAILED\n" : "readonly_test: ALL OK\n";
exit($fail ? 1 : 0);
