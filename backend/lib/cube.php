<?php
/**
 * "Cube" = ONE SQL query returning scan stats per (day, hour, model).
 * Every dashboard number (hourly, daily, model-wise, matrix) is derived
 * from it in PHP, so each screen needs a single DB round-trip instead of
 * 4-10 queries that each re-computed the LAG window.
 * Averages are weighted (SUM/COUNT) so results equal AVG over raw scans.
 */
require_once __DIR__ . '/../config/queries.php';

/** SQL + params of the cube query (separate so tests can run the exact SQL on another engine). */
function cube_query(array $range): array
{
    $cte = build_scan_diff_cte($range);
    $sql = $cte['sql'] . "
        SELECT CONVERT(VARCHAR(10), ScanDay, 23) AS D, HourSlot AS H, MMId,
               MAX(Model) AS Model, MAX(ModelCode) AS ModelCode, MAX(CompanyTitle) AS CompanyTitle,
               COUNT(*) AS Qty, SUM(CAST(CycleSeconds AS BIGINT)) AS CycSum, COUNT(CycleSeconds) AS CycCnt,
               MIN(CycleSeconds) AS CycMin, MAX(CycleSeconds) AS CycMax,
               SUM(IsOutlier) AS OutCnt, SUM(CASE WHEN IsOutlier = 1 THEN CAST(RawCycleSeconds AS BIGINT) ELSE 0 END) AS OutSec
        FROM ScanDiff
        GROUP BY ScanDay, HourSlot, MMId
    ";
    return ['sql' => $sql, 'params' => $cte['params']];
}

function fetch_cube(PDO $pdo, array $range): array
{
    $q = cube_query($range);
    $st = $pdo->prepare($q['sql']);
    $st->execute($q['params']);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['H'] = (int)$r['H']; $r['MMId'] = (int)$r['MMId']; $r['Qty'] = (int)$r['Qty']; $r['CycCnt'] = (int)$r['CycCnt'];
        $r['CycSum'] = (float)$r['CycSum'];
        $r['OutCnt'] = (int)$r['OutCnt']; $r['OutSec'] = (float)$r['OutSec'];
        $r['CycMin'] = $r['CycMin'] === null ? null : (int)$r['CycMin'];
        $r['CycMax'] = $r['CycMax'] === null ? null : (int)$r['CycMax'];
    }
    return $rows;
}

function group_rows(array $rows, callable $key): array
{
    $o = [];
    foreach ($rows as $r) $o[$key($r)][] = $r;
    return $o;
}

function model_totals(array $rows): array
{
    $t = [];
    foreach ($rows as $r) $t[$r['MMId']] = ($t[$r['MMId']] ?? 0) + $r['Qty'];
    return $t;
}

/** MMIds whose total qty in $rows is >= minQty (reliable for cycle-time stats). */
function reliable_set(array $rows, int $minQty): array
{
    $s = [];
    foreach (model_totals($rows) as $id => $q) if ($q >= $minQty) $s[$id] = true;
    return $s;
}

function summarize(array $rows, array $reliable): array
{
    $qty = 0; $rel = 0; $cs = 0.0; $cc = 0; $min = null; $max = null; $models = []; $oc = 0; $os = 0.0;
    foreach ($rows as $r) {
        $qty += $r['Qty']; $models[$r['MMId']] = true; $oc += $r['OutCnt']; $os += $r['OutSec'];
        if (!isset($reliable[$r['MMId']])) continue;
        $rel += $r['Qty']; $cs += $r['CycSum']; $cc += $r['CycCnt'];
        if ($r['CycMin'] !== null) $min = $min === null ? $r['CycMin'] : min($min, $r['CycMin']);
        if ($r['CycMax'] !== null) $max = $max === null ? $r['CycMax'] : max($max, $r['CycMax']);
    }
    return ['qty' => $qty, 'excluded' => $qty - $rel, 'models' => count($models),
            'avg' => $cc > 0 ? round($cs / $cc, 1) : null, 'min' => $min, 'max' => $max,
            'cc' => $cc, 'outGaps' => $oc, 'outSec' => (int)round($os)];
}

function hour_label(int $h): string { return sprintf('%02d:00-%02d:00', $h, ($h + 1) % 24); }

/** 24 hour rows for one day's rows. $withModels adds the per-hour model list. */
function hour_rows(array $dayRows, array $reliable, int $minQty, bool $withModels = false): array
{
    $byHour = group_rows($dayRows, fn($r) => $r['H']);
    $totals = $withModels ? model_totals($dayRows) : [];
    $out = [];
    for ($h = 0; $h < 24; $h++) {
        $rs = $byHour[$h] ?? [];
        $s = summarize($rs, $reliable);
        $row = [
            'hour' => $h, 'label' => hour_label($h), 'quantity' => $s['qty'], 'excludedQuantity' => $s['excluded'],
            'avgActualCycleSeconds' => $s['avg'], 'minActualCycleSeconds' => $s['min'], 'maxActualCycleSeconds' => $s['max'],
            'theoreticalCycleSeconds' => $s['qty'] > 0 ? round(3600 / $s['qty'], 1) : null, 'distinctModels' => $s['models'],
            'cycleSamples' => $s['cc'], 'outlierGaps' => $s['outGaps'], 'outlierSeconds' => $s['outSec'],
        ];
        if ($withModels) {
            usort($rs, fn($a, $b) => $b['Qty'] <=> $a['Qty']);
            $row['models'] = array_map(fn($r) => [
                'mmId' => $r['MMId'], 'model' => $r['Model'], 'modelCode' => $r['ModelCode'], 'quantity' => $r['Qty'],
                'isLowVolume' => ($totals[$r['MMId']] ?? 0) < $minQty,
            ], $rs);
        }
        $out[] = $row;
    }
    return $out;
}

function build_hourly_payload(array $dayRows, string $date, int $minQty): array
{
    $hours = hour_rows($dayRows, reliable_set($dayRows, $minQty), $minQty, true);
    $total = array_sum(array_column($hours, 'quantity'));
    $active = count(array_filter($hours, fn($h) => $h['quantity'] > 0));
    $s = summarize($dayRows, reliable_set($dayRows, $minQty));
    return ['date' => $date, 'minQtyThreshold' => $minQty, 'totalQuantity' => $total, 'activeHours' => $active,
            'avgQtyPerActiveHour' => $active > 0 ? round($total / $active, 1) : 0,
            'dayAvgActualCycleSeconds' => $s['avg'], 'dayTheoreticalCycleSeconds' => $total > 0 && $active > 0 ? round($active * 3600 / $total, 1) : null,
            'outlierGaps' => $s['outGaps'], 'outlierSeconds' => $s['outSec'], 'hours' => $hours];
}

function build_daily_payload(array $rows, array $range, int $minQty): array
{
    $reliable = reliable_set($rows, $minQty);
    $byDay = group_rows($rows, fn($r) => $r['D']);
    $days = [];
    for ($c = new DateTime($range['startDate']), $e = new DateTime($range['endDate']); $c <= $e; $c->modify('+1 day')) {
        $k = $c->format('Y-m-d');
        $rs = $byDay[$k] ?? [];
        $s = summarize($rs, $reliable);
        $ah = count(array_unique(array_column($rs, 'H')));
        $days[] = ['date' => $k, 'quantity' => $s['qty'], 'distinctModels' => $s['models'], 'activeHours' => $ah,
                   'avgActualCycleSeconds' => $s['avg'], 'outlierGaps' => $s['outGaps'], 'outlierSeconds' => $s['outSec'],
                   'theoreticalCycleSeconds' => $s['qty'] > 0 && $ah > 0 ? round($ah * 3600 / $s['qty'], 1) : null];
    }
    return ['startDate' => $range['startDate'], 'endDate' => $range['endDate'],
            'totalQuantity' => array_sum(array_column($days, 'quantity')), 'days' => $days];
}

function build_models_payload(array $rows, array $range, int $minQty): array
{
    $models = [];
    foreach (group_rows($rows, fn($r) => $r['MMId']) as $id => $rs) {
        $s = summarize($rs, [$id => true]);
        $hourly = [];
        foreach (group_rows($rs, fn($r) => $r['H']) as $h => $hs) {
            $q = array_sum(array_column($hs, 'Qty'));
            $hourly[] = ['hour' => $h, 'quantity' => $q, 'theoreticalCycleSeconds' => round(3600 / $q, 1)];
        }
        usort($hourly, fn($a, $b) => $a['hour'] <=> $b['hour']);
        $slots = count(array_unique(array_map(fn($r) => $r['D'] . '-' . $r['H'], $rs)));
        $models[] = [
            'mmId' => $id, 'model' => $rs[0]['Model'], 'modelCode' => $rs[0]['ModelCode'], 'companyTitle' => $rs[0]['CompanyTitle'],
            'quantity' => $s['qty'], 'activeHours' => $slots, 'isLowVolume' => $s['qty'] < $minQty,
            'avgActualCycleSeconds' => $s['avg'], 'minActualCycleSeconds' => $s['min'], 'maxActualCycleSeconds' => $s['max'],
            'outlierGaps' => $s['outGaps'], 'stoppageSeconds' => $s['outSec'],
            'avgTheoreticalCycleSeconds' => $hourly ? round(array_sum(array_column($hourly, 'theoreticalCycleSeconds')) / count($hourly), 1) : null,
            'hourly' => $hourly,
        ];
    }
    usort($models, fn($a, $b) => $b['quantity'] <=> $a['quantity']);
    return ['startDate' => $range['startDate'], 'endDate' => $range['endDate'], 'minQtyThreshold' => $minQty,
            'models' => array_values(array_filter($models, fn($m) => !$m['isLowVolume'])),
            'lowVolumeModels' => array_values(array_filter($models, fn($m) => $m['isLowVolume']))];
}

/** day => 24 hour rows (no model lists) — powers the hourly matrix; low-volume rule applied per day. */
function build_matrix_payload(array $rows, int $minQty): array
{
    $out = [];
    foreach (group_rows($rows, fn($r) => $r['D']) as $d => $rs) {
        $hours = hour_rows($rs, reliable_set($rs, $minQty), $minQty);
        // 23-11-2026: the models of each hour of THIS day ([mmId, pieces]) — the matrix works out each cell's target from
        // the models really made in it (as the line screens do), not from the mix of the whole period
        $mix = [];
        foreach ($rs as $r) {
            $q = (int)($r['Qty'] ?? 0);
            if ($q > 0) $mix[(int)$r['H']][] = [(int)$r['MMId'], $q];
        }
        foreach ($hours as $i => $h) if (isset($mix[$h['hour']])) $hours[$i]['mix'] = $mix[$h['hour']];
        $out[$d] = ['hours' => $hours];
    }
    return $out;
}
