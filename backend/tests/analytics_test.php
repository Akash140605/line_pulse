<?php
require_once __DIR__ . '/../lib/analytics.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; $p = (is_float($a) || is_float($b)) ? abs($a - $b) < 0.051 : $a === $b; if (!$p) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

// percentile (Excel PERCENTILE.INC): 1..10
$s = range(1, 10);
ok('P50 of 1..10 = 5.5', percentile_of($s, .5), 5.5); ok('P90 = 9.1', percentile_of($s, .9), 9.1); ok('P10 = 1.9', percentile_of($s, .1), 1.9);
$d = describe_values([30, 40, 50, 60, 70]);
ok('mean', $d['mean'], 50.0); ok('sample std = sqrt(250)', $d['std'], 15.8); ok('CV = 31.6%', $d['cv'], 31.6); ok('median', $d['median'], 50.0); ok('n', $d['n'], 5);
ok('empty describe n', describe_values([])['n'], 0);
ok('bin width: 150s/30 -> 5', nice_bin_width(150.0), 5); ok('bin width: 20s -> 1', nice_bin_width(20.0), 1); ok('bin width: 900 -> 30', nice_bin_width(900.0), 30);
ok('hist counts', histogram_counts([1, 4, 5, 9, 10, 99], 5, 3), [2, 2, 2]); // 0-4:{1,4} 5-9:{5,9} overflow>=10:{10,99}

// aggregate: model 1 has 4 scans, 3 valid cycles + 1 outlier(3000s); model 2 has 1 scan
$rows = [[1, '2026-10-01', 9, null, 0, null], [1, '2026-10-01', 9, 40, 0, 40], [1, '2026-10-01', 9, 50, 0, 50], [1, '2026-10-01', 10, null, 1, 3000], [2, '2026-10-02', 9, null, 0, null]];
$A = aggregate_scans($rows);
ok('scans', $A['scans'], 5); ok('outlier count', $A['outCnt'], 1); ok('outlier sec', $A['outSec'], 3000); ok('valid cycle values', count($A['all']), 2);
$meta = [1 => ['Model' => 'A', 'ModelCode' => 'a'], 2 => ['Model' => 'B', 'ModelCode' => 'b']];
$rej = ['warning' => null, 'reasons' => [['reason' => 'Dup', 'qty' => 6], ['reason' => 'Wrong', 'qty' => 3], ['reason' => 'Other', 'qty' => 1]],
        'models' => [['mmId' => 1, 'model' => 'A', 'qty' => 5]], 'daily' => [['date' => '2026-10-01', 'qty' => 4]], 'hourly' => []];
$P = build_analytics_payload($A, $meta, $rej, ['startDate' => '2026-10-01', 'endDate' => '2026-10-02', 'outlier' => []], 3);
ok('overall mean', $P['overall']['mean'], 45.0); ok('model A qty', $P['models'][0]['qty'], 4); ok('model A mean', $P['models'][0]['mean'], 45.0);
ok('model A active slots (d1h9,d1h10)', $P['models'][0]['activeHours'], 2); ok('model A stoppage', $P['models'][0]['stoppageSec'], 3000);
ok('model B low volume (1<3)', $P['models'][1]['isLowVolume'], true); ok('daily rows', count($P['daily']), 2); ok('daily d1 qty', $P['daily'][0]['qty'], 4);
ok('modelDay A d1', $P['modelDay'][1]['2026-10-01'], 4); ok('modelHour A h9', $P['modelHour'][1][9], 3);
$R = $P['rejection'];
ok('rej total', $R['total'], 10); ok('rej pareto cum 60', $R['reasons'][0]['cumPct'], 60.0); ok('rej pareto cum 90', $R['reasons'][1]['cumPct'], 90.0); ok('rej pareto cum 100', $R['reasons'][2]['cumPct'], 100.0);
ok('rej model A rate = 5/(4+5)', $R['models'][0]['rate'], 55.56); ok('rej day rate = 4/(4+4)', $R['daily'][0]['rate'], 50.0); ok('overall rej rate = 10/(5+10)', $R['rate'], 66.67);
echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
