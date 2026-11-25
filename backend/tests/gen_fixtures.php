<?php
// Builds the frontend test fixtures (frontend/tests/fixtures/*.json): realistic API answers made by the REAL backend
// code from synthetic scans (no database).  usage: php gen_fixtures.php <outdir>
require_once __DIR__ . '/../lib/cube.php';
require_once __DIR__ . '/../lib/analytics.php';
require_once __DIR__ . '/../lib/idle.php';
$out = $argv[1] ?? '/tmp/fx'; @mkdir($out, 0777, true);
mt_srand(11);
$models = [1 => ['WT70C3000RR', '1N57', 38, 40], 2 => ['WT65R2200LL', '1HUK', 55, 30], 3 => ['WT75B3200RR', '13WU', 90, 6]];
$cube = []; $scans = [];
foreach ($models as $id => [$name, $code, $base, $perHr]) foreach (range(1, 5) as $day) foreach (range(9, 20) as $h) {
    if ($h === 13) continue;
    $d = sprintf('2026-10-%02d', $day); $q = $perHr + mt_rand(-4, 4); $cs = 0; $cc = 0; $min = null; $max = null; $oc = 0; $os = 0;
    for ($i = 0; $i < $q; $i++) {
        $c = $i === 0 ? null : max(2, $base + mt_rand(-8, 8)); $o = 0; $raw = $c;
        if ($i === 4 && $h === 11 && $day === 3) { $c = null; $o = 1; $raw = 2400; $oc++; $os += 2400; }
        if ($c !== null) { $cs += $c; $cc++; $min = $min === null ? $c : min($min, $c); $max = $max === null ? $c : max($max, $c); }
        $scans[] = [$id, $d, $h, $c, $o, $raw];
    }
    $cube[] = ['D' => $d, 'H' => $h, 'MMId' => $id, 'Model' => $name, 'ModelCode' => $code, 'CompanyTitle' => 'SAMSUNG', 'Qty' => $q,
               'CycSum' => (float)$cs, 'CycCnt' => $cc, 'CycMin' => $min, 'CycMax' => $max, 'OutCnt' => $oc, 'OutSec' => (float)$os];
}
$range = ['startDate' => '2026-10-01', 'endDate' => '2026-10-05', 'companyId' => null, 'mmId' => null, 'outlier' => ['mode' => 'auto', 'mult' => 3.0, 'max' => 300, 'min' => 1]];
$day5 = array_values(array_filter($cube, fn($r) => $r['D'] === '2026-10-05'));
$rejDay = ['warning' => null, 'from' => '2026-10-05', 'to' => '2026-10-05',
    'summary' => ['totalRejections' => 7, 'totalAttempts' => 1100, 'successfulQty' => 1093, 'rejectionRate' => 0.64],
    'hourly' => array_map(fn($h) => ['hour' => $h, 'label' => sprintf('%02d:00-%02d:00', $h, ($h + 1) % 24), 'rejectionQty' => $h === 11 ? 4 : ($h === 15 ? 3 : 0)], range(0, 23)),
    'models' => [['mmId' => 1, 'model' => 'WT70C3000RR', 'modelCode' => '1N57', 'rejectionQty' => 7]],
    'reasons' => [['reason' => 'Duplicate scan', 'rejectionQty' => 5], ['reason' => 'Wrong model', 'rejectionQty' => 2]],
    'recent' => [['fsId' => 1, 'mmId' => 1, 'model' => 'WT70C3000RR', 'modelCode' => '1N57', 'barcode' => 'ABC123', 'reason' => 'Duplicate scan', 'dateTime' => '2026-10-05 11:05:10', 'hour' => 11, 'label' => '11:00-12:00']]];
$idle = distribute_idle([['2026-10-05 12:59:30', '2026-10-05 13:44:10', 2680], ['2026-10-03 11:10:00', '2026-10-03 11:50:00', 2400], ['2026-10-05 15:20:00', '2026-10-05 15:26:00', 360]]);
$w = fn($n, $d) => file_put_contents("$out/$n.json", json_encode($d));
$w('range_overview', ['outlier' => $range['outlier'], 'daily' => attach_idle_daily(build_daily_payload($cube, $range, 10), $idle), 'models' => build_models_payload($cube, $range, 10), 'matrix' => attach_idle_matrix(build_matrix_payload($cube, 10), $idle)]);
$w('day_overview', ['outlier' => $range['outlier'], 'hourly' => attach_idle_hourly(build_hourly_payload($day5, '2026-10-05', 10), $idle), 'rejection' => $rejDay]);
$meta = []; foreach ($models as $id => [$n, $c]) $meta[$id] = ['Model' => $n, 'ModelCode' => $c];
$rej = ['warning' => null, 'reasons' => [['reason' => 'Duplicate scan', 'qty' => 12], ['reason' => 'Wrong model', 'qty' => 5]], 'models' => [['mmId' => 1, 'model' => 'WT70C3000RR', 'qty' => 9], ['mmId' => 2, 'model' => 'WT65R2200LL', 'qty' => 8]],
        'daily' => [['date' => '2026-10-01', 'qty' => 4], ['date' => '2026-10-03', 'qty' => 13]], 'hourly' => array_map(fn($h) => ['hour' => $h, 'qty' => $h === 11 ? 11 : 0], range(0, 23))];
$w('analytics', attach_idle_analytics(build_analytics_payload(aggregate_scans($scans), $meta, $rej, $range, 10), $idle));
$w('companies', [['CompanyId' => 1, 'CompanyTitle' => 'SAMSUNG'], ['CompanyId' => 2, 'CompanyTitle' => 'LG']]);
$w('models', array_map(fn($id, $m) => ['mmId' => $id, 'model' => $m[0], 'modelCode' => $m[1], 'companyId' => 1, 'companyTitle' => 'SAMSUNG'], array_keys($models), array_values($models)));
$w('available_dates', array_map(fn($d) => ['date' => sprintf('2026-10-%02d', $d), 'quantity' => 1000], [5, 4, 3, 2, 1]));
$w('hour_detail', ['date' => '2026-10-05', 'minQtyThreshold' => 10, 'hour' => 10, 'label' => '10:00-11:00', 'totalQuantity' => 76, 'theoreticalCycleSeconds' => 47.4,
    'models' => [['mmId' => 1, 'model' => 'WT70C3000RR', 'modelCode' => '1N57', 'companyTitle' => 'SAMSUNG', 'quantity' => 40, 'isLowVolume' => false, 'avgActualCycleSeconds' => 38.2, 'minActualCycleSeconds' => 30, 'maxActualCycleSeconds' => 46, 'theoreticalCycleSeconds' => 90]],
    'scans' => [['scanId' => 1, 'mmId' => 1, 'model' => 'WT70C3000RR', 'modelCode' => '1N57', 'scanDate' => '2026-10-05 10:00:05', 'cycleSeconds' => null, 'isOutlier' => false],
                ['scanId' => 2, 'mmId' => 1, 'model' => 'WT70C3000RR', 'modelCode' => '1N57', 'scanDate' => '2026-10-05 10:00:45', 'cycleSeconds' => 40, 'isOutlier' => false]]]);
echo "fixtures -> $out\n";
