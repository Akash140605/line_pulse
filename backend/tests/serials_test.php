<?php
/** Carton & serial report (23-11-2026): one read-only SELECT, the answer shaped for the screen. */
declare(strict_types=1);
require_once __DIR__ . '/../lib/scanid.php';
require_once __DIR__ . '/../lib/readonly.php';
require_once __DIR__ . '/../lib/serials.php';

$fail = 0;
function ok(string $name, $got, $want): void
{
    global $fail;
    if ($got === $want) { echo "ok   $name\n"; return; }
    $fail++; echo "FAIL $name\n     got:  " . json_encode($got) . "\n     want: " . json_encode($want) . "\n";
}

[$sql, $p] = serials_sql(['idLo' => 100, 'idHi' => 900], 20000);
ok('reads only (no data-changing SQL)', (bool)preg_match(RO_WRITE_SQL, $sql), false);
ok('good scans only, the day, after an id, oldest first', [str_contains($sql, "<> 'FALSE'"), str_contains($sql, ':d1'), str_contains($sql, ':d2'), str_contains($sql, 'ScanId > :after'), str_contains($sql, 'ORDER BY s.ScanId')], [true, true, true, true, true]);
ok('the columns of the report', [str_contains($sql, 's.ProductBarcode'), str_contains($sql, 's.CartonBarcode'), str_contains($sql, 's.ComponentBarcode')], [true, true, true]);
ok('id range for a fast seek', [$p, str_contains($sql, 's.ScanId >= :idLo'), str_contains($sql, 's.ScanId < :idHi')], [[':idLo' => 100, ':idHi' => 900], true, true]);
ok('TOP is a whole number, capped', [str_contains(serials_sql([], 999999)[0], 'TOP 50000'), str_contains(serials_sql([], -5)[0], 'TOP 1 ')], [true, true]);
[$sql2, $p2] = serials_sql(['idLo' => 5, 'idHi' => null], 10);
ok('today: no upper id', [$p2, str_contains($sql2, ':idHi')], [[':idLo' => 5], false]);

$raw = [
    ['ScanId' => '11', 'MMId' => '589', 'Model' => '70DLIM 5 ', 'ModelCode' => '1200751', 'CompanyTitle' => 'VOLTAS', 'ComponentBarcode' => 'C1', 'ProductBarcode' => ' 2008SN001 ', 'CartonBarcode' => 'CT001', 'ScanDate' => '2026-11-22 09:01:29'],
    ['ScanId' => '12', 'MMId' => '589', 'Model' => '70DLIM 5', 'ModelCode' => null, 'CompanyTitle' => 'VOLTAS', 'ComponentBarcode' => null, 'ProductBarcode' => '2008SN002', 'CartonBarcode' => null, 'ScanDate' => '2026-11-22 09:01:43.000'],
];
$j = serials_shape($raw, '2026-11-22', 2, 2, 0);
ok('rows: trimmed text, empty for NULL, time to the second', $j['rows'][1], ['id' => 12, 'at' => '2026-11-22 09:01:43', 'mmId' => 589, 'model' => '70DLIM 5', 'code' => '', 'company' => 'VOLTAS', 'serial' => '2008SN002', 'carton' => '', 'component' => '']);
ok('first row', [$j['rows'][0]['serial'], $j['rows'][0]['model'], $j['rows'][0]['carton']], ['2008SN001', '70DLIM 5', 'CT001']);
ok('count, last id, more when the limit was reached', [$j['count'], $j['lastId'], $j['more'], $j['line'], $j['date']], [2, 12, true, 2, '2026-11-22']);
$e = serials_shape([], '2026-11-22', 1, 20000, 77);
ok('nothing new: last id stays', [$e['count'], $e['lastId'], $e['more']], [0, 77, false]);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
