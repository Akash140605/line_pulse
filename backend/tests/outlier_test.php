<?php
/**
 * Unit test: the outlier rule (config/queries.php → outlier_condition) is executed for real on SQLite,
 * so the generated SQL text AND its meaning are both checked.  Run:  php tests/outlier_test.php
 */
require_once __DIR__ . '/../config/queries.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

$db = new PDO('sqlite::memory:');
/** true = the gap is a valid cycle (kept), false = outlier */
function valid(PDO $db, array $o, $cycle, $median): bool {
    $sql = 'SELECT CASE WHEN ' . outlier_condition($o) . ' THEN 1 ELSE 0 END FROM (SELECT :c AS CycleSeconds, :m AS MedCycle)';
    $st = $db->prepare($sql); $st->bindValue(':c', $cycle, PDO::PARAM_INT); $st->bindValue(':m', $median, PDO::PARAM_INT); $st->execute();
    return (int)$st->fetchColumn() === 1;
}
$auto = ['mode' => 'auto', 'mult' => 3, 'max' => 300, 'min' => 1];

// normal day: median 15 s → limit 45 s
ok('auto: 15 s with median 15 is valid', valid($db, $auto, 15, 15), true);
ok('auto: 45 s = 3 x median is valid', valid($db, $auto, 45, 15), true);
ok('auto: 46 s > 3 x median is an outlier', valid($db, $auto, 46, 15), false);
ok('auto: double scan 0 s is dropped (min 1)', valid($db, $auto, 0, 15), false);
// fast line: 3 x median below 20 s → floor 20 s
ok('auto floor: 19 s valid when median 5 (limit 20)', valid($db, $auto, 19, 5), true);
ok('auto floor: 21 s outlier when median 5', valid($db, $auto, 21, 5), false);
// BUG seen on Line 2 (17-10-2026): a model with only 2 scans that day → median = the gap itself (16 673 s)
ok('auto ceiling: 16673 s gap is NOT a cycle even when the median is 16673', valid($db, $auto, 16673, 16673), false);
ok('auto ceiling: 7646 s gap with median 249 is NOT a cycle', valid($db, $auto, 7646, 249), false);
ok('auto ceiling: 300 s is still allowed when 3 x median is larger', valid($db, $auto, 300, 249), true);
ok('auto ceiling: 301 s is an outlier when 3 x median is larger', valid($db, $auto, 301, 249), false);
ok('auto ceiling follows the max setting (600)', valid($db, ['max' => 600] + $auto, 500, 249), true);
ok('auto ceiling never below the 20 s floor (max 5)', valid($db, ['max' => 5] + $auto, 18, 5), true);
// fixed / off unchanged
$fixed = ['mode' => 'fixed', 'mult' => 3, 'max' => 300, 'min' => 2];
ok('fixed: 300 valid', valid($db, $fixed, 300, 15), true);
ok('fixed: 301 outlier', valid($db, $fixed, 301, 15), false);
ok('fixed: 1 s below min 2 dropped', valid($db, $fixed, 1, 15), false);
$off = ['mode' => 'off', 'mult' => 3, 'max' => 300, 'min' => 0];
ok('off: 16673 valid', valid($db, $off, 16673, 15), true);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
