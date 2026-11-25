<?php
/**
 * Scan-level analytics: distribution (histogram, percentiles, std, CV), per-model stats,
 * daily stats (for SPC), model x day / model x hour counts and a range-level rejection summary.
 * ONE scan-level query feeds everything (cycle values already have the outlier filter applied).
 */
require_once __DIR__ . '/../config/queries.php';
require_once __DIR__ . '/rejections.php';

const MAX_SCAN_ROWS = 400000;

function r1x($v, int $d = 1) { return $v === null ? null : round((float)$v, $d); }

/** Linear-interpolated percentile of an ASCENDING array (same as Excel PERCENTILE.INC). */
function percentile_of(array $sorted, float $p): ?float
{
    $n = count($sorted);
    if ($n === 0) return null;
    if ($n === 1) return (float)$sorted[0];
    $pos = ($n - 1) * $p;
    $lo = (int)floor($pos); $hi = (int)ceil($pos);
    return $sorted[$lo] + ($sorted[$hi] - $sorted[$lo]) * ($pos - $lo);
}

/** n, mean, sample std, CV%, min/max and P10/P25/P50/P75/P90/P95. */
function describe_values(array $vals): array
{
    $n = count($vals);
    if ($n === 0) return ['n' => 0, 'mean' => null, 'std' => null, 'cv' => null, 'median' => null, 'p10' => null, 'p25' => null,
                          'p75' => null, 'p90' => null, 'p95' => null, 'min' => null, 'max' => null];
    sort($vals);
    $mean = array_sum($vals) / $n;
    $ss = 0.0;
    foreach ($vals as $v) $ss += ($v - $mean) ** 2;
    $std = $n > 1 ? sqrt($ss / ($n - 1)) : 0.0;
    return ['n' => $n, 'mean' => r1x($mean), 'std' => r1x($std), 'cv' => $mean > 0 ? r1x($std / $mean * 100) : null,
            'median' => r1x(percentile_of($vals, .5)), 'p10' => r1x(percentile_of($vals, .1)), 'p25' => r1x(percentile_of($vals, .25)),
            'p75' => r1x(percentile_of($vals, .75)), 'p90' => r1x(percentile_of($vals, .9)), 'p95' => r1x(percentile_of($vals, .95)),
            'min' => $vals[0], 'max' => $vals[$n - 1]];
}

/** Histogram bin width (seconds): smallest "nice" value giving <= ~30 bins up to P98. */
function nice_bin_width(float $maxVal, int $target = 30): int
{
    $raw = max(1.0, $maxVal / $target);
    foreach ([1, 2, 3, 5, 10, 15, 20, 30, 60, 120, 300] as $w) if ($w >= $raw) return $w;
    return 600;
}

function histogram_counts(array $vals, int $width, int $bins): array
{
    $c = array_fill(0, max(1, $bins), 0);
    $last = count($c) - 1;
    foreach ($vals as $v) { $i = intdiv((int)$v, $width); $c[$i > $last ? $last : $i]++; }
    return $c;
}

/**
 * Single pass over scan rows [MMId, 'YYYY-MM-DD', hour, cycle|null, isOutlier, rawCycle|null].
 */
function aggregate_scans(iterable $rows): array
{
    $A = ['all' => [], 'outCnt' => 0, 'outSec' => 0, 'scans' => 0, 'm' => [], 'd' => [], 'mh' => []];
    foreach ($rows as $r) {
        [$id, $d, $h, $c, $o, $raw] = $r;
        $id = (int)$id; $h = (int)$h; $A['scans']++;
        $m = &$A['m'][$id];
        $m ??= ['n' => 0, 'vals' => [], 'out' => 0, 'outSec' => 0, 'slots' => [], 'days' => []];
        $m['n']++; $m['slots'][$d . '-' . $h] = 1; $m['days'][$d] = ($m['days'][$d] ?? 0) + 1;
        $dd = &$A['d'][$d];
        $dd ??= ['n' => 0, 'vals' => [], 'out' => 0, 'outSec' => 0];
        $dd['n']++;
        $A['mh'][$id][$h] = ($A['mh'][$id][$h] ?? 0) + 1;
        if ($c !== null) { $c = (int)$c; $m['vals'][] = $c; $dd['vals'][] = $c; $A['all'][] = $c; }
        if ((int)$o === 1) {
            $s = (int)$raw; $m['out']++; $m['outSec'] += $s; $dd['out']++; $dd['outSec'] += $s; $A['outCnt']++; $A['outSec'] += $s;
        }
        unset($m, $dd);
    }
    return $A;
}

function build_analytics_payload(array $A, array $meta, array $rejection, array $range, int $minQty): array
{
    $all = $A['all'];
    $overall = describe_values($all);
    $sorted = $all; sort($sorted);
    $p98 = percentile_of($sorted, .98) ?? 0;
    $w = nice_bin_width((float)$p98);
    $bins = $p98 > 0 ? (int)ceil($p98 / $w) + 1 : 1; // last bin = overflow (>= edge)
    $overall['histogram'] = ['width' => $w, 'counts' => histogram_counts($all, $w, $bins)];
    $overall['outlierGaps'] = $A['outCnt'];
    $overall['stoppageSec'] = $A['outSec'];
    $overall['scans'] = $A['scans'];

    $models = [];
    foreach ($A['m'] as $id => $m) {
        $st = describe_values($m['vals']);
        $mm = $meta[$id] ?? [];
        $models[] = array_merge(['mmId' => $id, 'model' => $mm['Model'] ?? "#$id", 'modelCode' => $mm['ModelCode'] ?? null,
            'qty' => $m['n'], 'isLowVolume' => $m['n'] < $minQty, 'activeHours' => count($m['slots']),
            'outlierGaps' => $m['out'], 'stoppageSec' => $m['outSec'],
            'histogram' => histogram_counts($m['vals'], $w, $bins)], $st);
    }
    usort($models, fn($a, $b) => $b['qty'] <=> $a['qty']);

    $daily = [];
    ksort($A['d']);
    foreach ($A['d'] as $d => $dd) {
        $daily[] = array_merge(['date' => $d, 'qty' => $dd['n'], 'outlierGaps' => $dd['out'], 'stoppageSec' => $dd['outSec']], describe_values($dd['vals']));
    }

    $modelDay = []; foreach ($A['m'] as $id => $m) $modelDay[$id] = $m['days'];

    // rejection: attach scan counts so rates can be computed (rejections / (good + rejections))
    $goodByModel = []; foreach ($A['m'] as $id => $m) $goodByModel[$id] = $m['n'];
    $rejection['_goodByModel'] = $goodByModel;
    $rejection['_goodByDay'] = array_map(fn($d) => $d['n'], $A['d']);

    return ['startDate' => $range['startDate'], 'endDate' => $range['endDate'], 'minQtyThreshold' => $minQty, 'outlier' => $range['outlier'],
            'overall' => $overall, 'models' => $models, 'daily' => $daily, 'modelDay' => $modelDay, 'modelHour' => $A['mh'], 'rejection' => finalize_rejection($rejection)];
}

function finalize_rejection(array $rej): array
{
    $goodM = $rej['_goodByModel'] ?? []; $goodD = $rej['_goodByDay'] ?? [];
    $total = array_sum(array_column($rej['reasons'], 'qty'));
    $good = array_sum($goodM);
    $cum = 0;
    foreach ($rej['reasons'] as &$r) { $cum += $r['qty']; $r['pct'] = $total ? round($r['qty'] * 100 / $total, 1) : 0; $r['cumPct'] = $total ? round($cum * 100 / $total, 1) : 0; }
    unset($r);
    foreach ($rej['models'] as &$m) { $g = $goodM[$m['mmId']] ?? 0; $m['good'] = $g; $m['rate'] = ($g + $m['qty']) > 0 ? round($m['qty'] * 100 / ($g + $m['qty']), 2) : 0; }
    unset($m);
    foreach ($rej['daily'] as &$d) { $g = $goodD[$d['date']] ?? 0; $d['good'] = $g; $d['rate'] = ($g + $d['qty']) > 0 ? round($d['qty'] * 100 / ($g + $d['qty']), 2) : 0; }
    unset($d);
    unset($rej['_goodByModel'], $rej['_goodByDay']);
    $rej['total'] = $total; $rej['good'] = $good; $rej['rate'] = ($good + $total) > 0 ? round($total * 100 / ($good + $total), 2) : 0;
    return $rej;
}

function scan_rows_query(array $range): array
{
    $cte = build_scan_diff_cte($range);
    return ['sql' => $cte['sql'] . "SELECT TOP " . MAX_SCAN_ROWS . " MMId, CONVERT(VARCHAR(10), ScanDay, 23), HourSlot, CycleSeconds, IsOutlier, RawCycleSeconds FROM ScanDiff", 'params' => $cte['params']];
}

function fetch_scan_rows(PDO $pdo, array $range): Generator
{
    $q = scan_rows_query($range);
    $st = $pdo->prepare($q['sql']);
    $st->execute($q['params']);
    while ($r = $st->fetch(PDO::FETCH_NUM)) yield $r;
}

function fetch_model_meta(PDO $pdo): array
{
    $o = [];
    foreach ($pdo->query("SELECT MMId, Model, ModelCode FROM dbo.Tab_ModelMaster")->fetchAll(PDO::FETCH_ASSOC) as $r) $o[(int)$r['MMId']] = $r;
    return $o;
}

/** Rejections over the whole range: by reason / model / day / hour (rates are added in finalize_rejection). */
function fetch_rejection_range(PDO $pdo, array $range): array
{
    $out = ['warning' => null, 'reasons' => [], 'models' => [], 'daily' => [], 'hourly' => []];
    $table = detect_false_table($pdo);
    if (!$table) { $out['warning'] = 'False-scan table not found'; return $out; }

    $where = 'f.ErrorDateTime >= CAST(:a AS DATE) AND f.ErrorDateTime < DATEADD(DAY, 1, CAST(:b AS DATE))';
    $p = [':a' => $range['startDate'], ':b' => $range['endDate']];
    if ($range['companyId']) { $where .= ' AND m.CompanyId = :c'; $p[':c'] = $range['companyId']; }
    if ($range['mmId'])      { $where .= ' AND f.MMId = :mm';     $p[':mm'] = $range['mmId']; }
    $from = "FROM $table f LEFT JOIN dbo.Tab_ModelMaster m ON m.MMId = f.MMId WHERE $where";
    $q = function (string $sel, string $grp) use ($pdo, $from, $p) {
        // ", $grp" breaks ties (same count) in a fixed order, so the line and its backup list them identically
        $s = $pdo->prepare("SELECT $sel AS K, COUNT(*) AS C $from GROUP BY $grp ORDER BY C DESC, $grp");
        $s->execute($p);
        return $s->fetchAll(PDO::FETCH_ASSOC);
    };
    $reasonExpr = "COALESCE(NULLIF(LTRIM(RTRIM(f.ErrorMessage)), ''), 'Unknown')";
    foreach ($q($reasonExpr, $reasonExpr) as $r) $out['reasons'][] = ['reason' => $r['K'], 'qty' => (int)$r['C']];
    $meta = fetch_model_meta($pdo);
    foreach ($q('f.MMId', 'f.MMId') as $r) { $id = (int)$r['K']; $out['models'][] = ['mmId' => $id, 'model' => $meta[$id]['Model'] ?? "#$id", 'qty' => (int)$r['C']]; }
    foreach ($q("CONVERT(VARCHAR(10), CAST(f.ErrorDateTime AS DATE), 23)", "CAST(f.ErrorDateTime AS DATE)") as $r) $out['daily'][] = ['date' => $r['K'], 'qty' => (int)$r['C']];
    usort($out['daily'], fn($a, $b) => strcmp($a['date'], $b['date']));
    $hours = array_fill(0, 24, 0);
    foreach ($q('DATEPART(HOUR, f.ErrorDateTime)', 'DATEPART(HOUR, f.ErrorDateTime)') as $r) $hours[(int)$r['K']] = (int)$r['C'];
    foreach ($hours as $h => $c) $out['hourly'][] = ['hour' => $h, 'qty' => $c];
    return $out;
}
