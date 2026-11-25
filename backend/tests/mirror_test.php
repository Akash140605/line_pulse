<?php
/**
 * Unit test for lib/mirror.php (pure parts: column types, CREATE TABLE text, batch size, insert SQL).
 * Run:  php tests/mirror_test.php
 */
require_once __DIR__ . '/../lib/mirror.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

// column metadata as read from sys.columns (max_length in bytes)
$col = fn($name, $type, $len = 0, $prec = 0, $scale = 0, $null = 1, $ident = 0) => ['name' => $name, 'type' => $type, 'max_length' => $len, 'precision' => $prec, 'scale' => $scale, 'is_nullable' => $null, 'is_identity' => $ident];

ok('varchar(200)', mirror_col_type($col('A', 'varchar', 200)), 'varchar(200)');
ok('varchar(max)', mirror_col_type($col('A', 'varchar', -1)), 'varchar(max)');
ok('nvarchar(50) = 100 bytes', mirror_col_type($col('A', 'nvarchar', 100)), 'nvarchar(50)');
ok('nvarchar(max)', mirror_col_type($col('A', 'nvarchar', -1)), 'nvarchar(max)');
ok('numeric(9) on disk = numeric(18,0)', mirror_col_type($col('A', 'numeric', 9, 18, 0)), 'numeric(18,0)');
ok('decimal(10,2)', mirror_col_type($col('A', 'decimal', 9, 10, 2)), 'decimal(10,2)');
ok('int', mirror_col_type($col('A', 'int', 4, 10)), 'int');
ok('datetime', mirror_col_type($col('A', 'datetime', 8)), 'datetime');
ok('datetime2(3)', mirror_col_type($col('A', 'datetime2', 7, 23, 3)), 'datetime2(3)');
ok('char(10)', mirror_col_type($col('A', 'char', 10)), 'char(10)');
ok('varbinary(max)', mirror_col_type($col('A', 'varbinary', -1)), 'varbinary(max)');
ok('unknown type falls back to nvarchar(max)', mirror_col_type($col('A', 'geography', -1)), 'nvarchar(max)');

$cols = [$col('ScanId', 'numeric', 9, 18, 0, 0), $col('MMId', 'int', 4, 10), $col('ProductBarcode', 'varchar', 200), $col('ScanDate', 'datetime', 8)];
$sql = mirror_create_sql('dbo', 'ScanStatus', $cols, ['ScanId']);
ok('CREATE TABLE has every column', substr_count($sql, '[ScanId] numeric(18,0) NOT NULL') === 1 && strpos($sql, '[ProductBarcode] varchar(200) NULL') !== false, true);
ok('…and the primary key, clustered', strpos($sql, 'PRIMARY KEY CLUSTERED ([ScanId])') !== false, true);
ok('…only when the table does not exist', strpos($sql, "IF OBJECT_ID(N'[dbo].[ScanStatus]') IS NULL") === 0, true);
ok('identity is not copied (values are inserted as they are)', strpos(mirror_create_sql('dbo', 'T', [$col('Id', 'int', 4, 10, 0, 0, 1)], ['Id']), 'IDENTITY') === false, true);
ok('names with ] are escaped', mirror_q('a]b'), '[a]]b]');

ok('batch: 2100-parameter limit with 7 columns → 290 rows', mirror_batch_rows(7), 290);
ok('batch: never more than 1000 rows (SQL Server VALUES limit)', mirror_batch_rows(1), 1000);
ok('batch: very wide table still ≥ 1 row', mirror_batch_rows(5000), 1);

$ins = mirror_insert_sql('dbo', 'ScanStatus', ['ScanId', 'MMId'], 3);
ok('multi-row insert', $ins, 'INSERT INTO [dbo].[ScanStatus] ([ScanId],[MMId]) VALUES (?,?),(?,?),(?,?)');

ok('chunked copy needs one numeric key column', mirror_can_chunk([$col('ScanId', 'numeric', 9, 18)], ['ScanId']), true);
ok('…an int key works too', mirror_can_chunk([$col('Id', 'int', 4, 10)], ['Id']), true);
ok('…a text key or two key columns do not', [mirror_can_chunk([$col('K', 'varchar', 20)], ['K']), mirror_can_chunk([$col('A', 'int', 4), $col('B', 'int', 4)], ['A', 'B'])], [false, false]);
ok('local database name per line', mirror_db_name(3), 'EMS_Backup_Line3');


// one copy run per line at a time
$dir = sys_get_temp_dir();
$a = mirror_lock(97, $dir);
ok('lock: first run gets the lock', $a !== null, true);
ok('lock: second run of the same line is refused', mirror_lock(97, $dir) === null, true);
$b = mirror_lock(98, $dir);
ok('lock: another line is not blocked', $b !== null, true);
mirror_unlock($a);
$c = mirror_lock(97, $dir);
ok('lock: free again after the first run ends', $c !== null, true);
mirror_unlock($b); mirror_unlock($c);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
