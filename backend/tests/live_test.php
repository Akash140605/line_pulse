<?php
/**
 * Unit test for lib/live.php → live_from_rows(): the live board numbers of one line computed in PHP
 * from the day's scan rows (one DB query instead of four table scans).  Run:  php tests/live_test.php
 * Expected values follow the original SQL of live_lines.php:
 *   hours      = COUNT of valid scans per hour
 *   hourModels = per hour, per model, qty desc
 *   last scan  = newest valid scan (ScanDate, then ScanId)
 *   avgCycle   = AVG of gaps (ms / 1000) between consecutive valid scans of the SAME model, ordered by
 *                (ScanDate, ScanId), keeping gaps within [cmin, cmax]; rounded to 2 decimals
 */
require_once __DIR__ . '/../lib/live.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; $p = (is_float($a) || is_float($b)) ? abs($a - $b) < 0.0051 : $a === $b; if (!$p) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

// rows: [ScanId, 'Y-m-d H:i:s.mmm', MMId, Model|null, valid(1/0)]
$rows = [
    [10, '2026-10-24 09:00:00.000', 1, 'A', 1],
    [11, '2026-10-24 09:00:15.500', 1, 'A', 1],   // gap A 15.5
    [12, '2026-10-24 09:00:20.000', 2, 'B', 1],
    [13, '2026-10-24 09:00:30.000', 1, 'A', 1],   // gap A 14.5
    [14, '2026-10-24 09:00:31.000', 1, 'A', 0],   // rejected (Status FALSE) → ignored everywhere
    [15, '2026-10-24 10:05:00.000', 1, 'A', 1],   // gap A 3870 → outside window
    [16, '2026-10-24 10:05:12.000', 2, 'B', 1],   // gap B 3892 → outside
    [17, '2026-10-24 10:05:12.000', 3, null, 1],  // model missing in master
    [9,  '2026-10-24 10:05:12.000', 2, 'B', 1],   // same time as 16 but lower ScanId → ordered before 16 (gap 0 → below cmin)
];
$L = live_from_rows($rows, 1.0, 22.0);
ok('total = valid scans', $L['total'], 8);
ok('hours', $L['hours'], [['hour' => 9, 'quantity' => 4], ['hour' => 10, 'quantity' => 4]]);
$hm3 = fn($a) => array_map(fn($x) => ['hour' => $x['hour'], 'model' => $x['model'], 'qty' => $x['qty']], array_values($a));   // the original three fields
ok('hour 9 models, qty desc', $hm3(array_filter($L['hourModels'], fn($x) => $x['hour'] === 9)), [['hour' => 9, 'model' => 'A', 'qty' => 3], ['hour' => 9, 'model' => 'B', 'qty' => 1]]);
ok('hour 10 models: B 2, then A 1 and Unknown 1 (name order on ties)', $hm3(array_filter($L['hourModels'], fn($x) => $x['hour'] === 10)),
   [['hour' => 10, 'model' => 'B', 'qty' => 2], ['hour' => 10, 'model' => 'A', 'qty' => 1], ['hour' => 10, 'model' => 'Unknown model', 'qty' => 1]]);
ok('last scan = newest ScanDate, highest ScanId on a tie', [$L['lastScan'], $L['lastHour'], $L['model']], ['2026-10-24 10:05:12', 10, 'Unknown model']);
ok('avg cycle = (15.5 + 14.5) / 2', $L['avgCycle'], 15.0);
ok('cmax 3900 also takes the long gaps', live_from_rows($rows, 1.0, 3900.0)['avgCycle'], round((15.5 + 14.5 + 3870 + 3892) / 4, 2));
ok('cmin 15 drops the 14.5 s gap', live_from_rows($rows, 15.0, 22.0)['avgCycle'], 15.5);
$E = live_from_rows([], 1, 22);
ok('empty day', [$E['total'], $E['hours'], $E['lastScan'], $E['avgCycle']], [0, [], null, null]);
ok('first scan of the day (valid scans only; for the real cycle)', $L['firstScan'], '2026-10-24 09:00:00');
ok('empty day: no first scan', $E['firstScan'], null);
ok('only rejected scans → nothing', live_from_rows([[1, '2026-10-24 09:00:00.000', 1, 'A', 0]], 1, 22)['total'], 0);


// company + running model (rows may carry the company as 6th column; older 5-column rows still work)
$co = [
    [1, '2026-10-24 09:00:00.000', 7, 'WT70', 1, 'SAMSUNG '],
    [2, '2026-10-24 09:00:14.000', 7, 'WT70', 1, 'SAMSUNG '],   // gap 14
    [3, '2026-10-24 09:00:20.000', 8, 'V1', 1, 'VOLTAS'],
    [4, '2026-10-24 09:00:30.000', 7, 'WT70', 1, 'SAMSUNG '],   // gap 16
    [5, '2026-10-24 09:00:42.000', 7, 'WT70', 1, 'SAMSUNG '],   // gap 12
    [6, '2026-10-24 09:00:43.000', 7, 'WT70', 0, 'SAMSUNG '],   // rejected
];
$C = live_from_rows($co, 1.0, 22.0);
ok('company of the last scan (trimmed)', [$C['model'], $C['mmId'], $C['company']], ['WT70', 7, 'SAMSUNG']);
ok('hourModels carry mmId + company', $C['hourModels'][0], ['hour' => 9, 'model' => 'WT70', 'qty' => 4, 'mmId' => 7, 'company' => 'SAMSUNG']);
ok('running model: qty, first / last scan', [$C['running']['qty'], $C['running']['firstScan'], $C['running']['lastScan']], [4, '2026-10-24 09:00:00', '2026-10-24 09:00:42']);
ok('running model: own average cycle (14+16+12)/3', $C['running']['avgCycle'], 14.0);
ok('running model: current cycle = median of its last gaps', $C['running']['currentCycle'], 14.0);
// the continuous run of the running model (16-11-2026): since the line last changed to it, every gap kept (long stops too)
ok('running model: current run starts after the other model (scan 4), 2 pieces', [$C['running']['runFirst'], $C['running']['runQty']], ['2026-10-24 09:00:30', 2]);
$run = [
    [1, '2026-11-16 09:00:00.000', 8, 'V1', 1, 'VOLTAS'],
    [2, '2026-11-16 09:01:00.000', 7, 'WT70', 1, 'SAMSUNG'],
    [3, '2026-11-16 09:01:15.000', 7, 'WT70', 1, 'SAMSUNG'],
    [4, '2026-11-16 09:06:15.000', 7, 'WT70', 1, 'SAMSUNG'],   // a 300 s stop inside the run: kept for the run, out of avgCycle
    [5, '2026-11-16 09:06:30.000', 7, 'WT70', 1, 'SAMSUNG'],
];
$RN = live_from_rows($run, 1.0, 22.0);
ok('run: from the first WT70 after V1, 4 pieces', [$RN['running']['runFirst'], $RN['running']['runQty']], ['2026-11-16 09:01:00', 4]);
ok('run: the 22 s average still leaves the stop out (15 + 15) / 2', $RN['running']['avgCycle'], 15.0);
ok('one model all day: the run is the whole day', [$C2 = live_from_rows(array_slice($run, 1), 1, 22)['running']['runFirst'], live_from_rows(array_slice($run, 1), 1, 22)['running']['runQty']], ['2026-11-16 09:01:00', 4]);
ok('running model: valid cycles', $C['running']['validCycles'], 3);
ok('old 5-column rows: company null, running still found', [$L['company'], $L['running']['model'] ?? null], [null, 'Unknown model']);
ok('median helper', [live_median([3, 1, 2]), live_median([4, 1, 3, 2]), live_median([])], [2.0, 2.5, null]);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
