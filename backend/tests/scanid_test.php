<?php
/**
 * Unit test for lib/scanid.php → scan_id_search(): binary search on the clustered key (ScanId) for the first
 * scan at/after a date-time, so date-range queries can seek instead of scanning a table that has no
 * ScanDate index.  Run:  php tests/scanid_test.php
 */
require_once __DIR__ . '/../lib/scanid.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

/** Table as [ScanId => 'Y-m-d H:i:s'] with gaps in the ids (deleted rows), sorted by id. */
function table(array $t): array { ksort($t); return $t; }
function prober(array $t, int &$calls): callable {
    return function (int $id) use ($t, &$calls) { $calls++; foreach ($t as $k => $v) if ($k >= $id) return [$k, $v]; return null; };
}
$T = table([
    100 => '2026-10-21 08:59:00', 101 => '2026-10-21 20:59:59',
    105 => '2026-10-22 08:00:00', 106 => '2026-10-22 08:00:00', 109 => '2026-10-22 21:00:00',
    200 => '2026-10-24 09:00:00', 201 => '2026-10-24 09:00:01',
]);
$c = 0; $p = prober($T, $c);
$first = fn($b) => scan_id_search($p, 100, 201, $b);
ok('boundary before all rows → min id', $first('2026-10-01 00:00:00'), 100);
ok('first scan of 22-10 (ids 102-104 deleted) → 102 or 105, never past 105', $first('2026-10-22 00:00:00') <= 105 && $first('2026-10-22 00:00:00') > 101, true);
ok('range [first(22-10), first(23-10)) holds exactly the 22-10 rows', array_keys(array_filter($T, fn($v, $k) => $k >= $first('2026-10-22 00:00:00') && $k < $first('2026-10-23 00:00:00'), ARRAY_FILTER_USE_BOTH)), [105, 106, 109]);
ok('no rows on 23-10 → start(23-10) = start(24-10)', $first('2026-10-23 00:00:00') === $first('2026-10-24 00:00:00'), true);
ok('range for 24-10 holds 200 and 201', array_keys(array_filter($T, fn($v, $k) => $k >= $first('2026-10-24 00:00:00'), ARRAY_FILTER_USE_BOTH)), [200, 201]);
ok('boundary after all rows → max id + 1', $first('2026-10-25 00:00:00'), 202);
ok('exact time of a row is included', array_key_first(array_filter($T, fn($v, $k) => $k >= $first('2026-10-21 20:59:59'), ARRAY_FILTER_USE_BOTH)), 101);
$c = 0; scan_id_search($p, 1, 50000000, '2026-10-22 00:00:00');
ok('about log2(id range) probes (≤ 40 for 50 million ids)', $c <= 40, true);
ok('single-row table', scan_id_search(prober([7 => '2026-10-01 10:00:00'], $c), 7, 7, '2026-10-01 00:00:00'), 7);
ok('empty table (min > max) → min', scan_id_search(fn($id) => null, 1, 0, '2026-10-01 00:00:00'), 1);

// bounds for a date range: [first scan of start day, first scan of the day after end)
$b = scan_id_bounds_from($p, 100, 201, '2026-10-22', '2026-10-22', '2026-10-24');
ok('bounds of a finished day have an upper limit', [$b[0] > 101 && $b[0] <= 105, $b[1] > 109 && $b[1] <= 200], [true, true]);
$b = scan_id_bounds_from($p, 100, 201, '2026-10-22', '2026-10-24', '2026-10-24');
ok('a range that reaches today has no upper limit (new scans keep coming)', $b[1], null);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
