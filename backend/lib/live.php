<?php
/**
 * Live board numbers of one line, computed in PHP from the focus day's scan rows.
 * One indexed-friendly query per line replaces four separate scans of dbo.ScanStatus
 * (hourly count, hour × model, last scan, LAG average) — same results, a fraction of the DB time.
 */

const LIVE_VALID = "(s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')";

/** All scans of one day: [ScanId, 'Y-m-d H:i:s.mmm', MMId, Model|null, valid 1/0, Company|null]. */
function fetch_live_rows(PDO $pdo, string $day, string $lineKey = ''): array
{
    [$idSql, $idP] = function_exists('with_scan_ids') ? scan_id_sql(with_scan_ids($pdo, ['startDate' => $day, 'endDate' => $day], $lineKey)) : ['', []];
    $st = $pdo->prepare("SELECT s.ScanId, CONVERT(char(23), s.ScanDate, 121) AS t, s.MMId, m.Model,
                                CASE WHEN " . LIVE_VALID . " THEN 1 ELSE 0 END AS ok, c.CompanyTitle
                         FROM dbo.ScanStatus s LEFT JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
                         LEFT JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId
                         WHERE s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))$idSql");
    $st->execute([':d' => $day, ':d2' => $day] + $idP);
    return $st->fetchAll(PDO::FETCH_NUM);
}

/** Newest scan day of the line, found from the end of the clustered key (ScanId) instead of MAX(ScanDate) over the whole table. */
function latest_scan_day(PDO $pdo): string
{
    $d = $pdo->query("SELECT CONVERT(char(10), MAX(t.ScanDate), 23) FROM (SELECT TOP 200 s.ScanDate FROM dbo.ScanStatus s WHERE " . LIVE_VALID . " ORDER BY s.ScanId DESC) t")->fetchColumn();
    return $d ?: '';
}

function live_ms(string $t): float
{
    // 'Y-m-d H:i:s.mmm' → epoch seconds with milliseconds
    $sec = strtotime(substr($t, 0, 19));
    $ms = strlen($t) > 20 ? (int)substr($t, 20, 3) : 0;
    return $sec + $ms / 1000;
}

/** Median of a list of numbers (null for an empty list). */
function live_median(array $v): ?float
{
    if (!$v) return null;
    sort($v);
    $n = count($v);
    return $n % 2 ? (float)$v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2;
}

/**
 * Live numbers of one line from the day's scan rows.
 *  hours, hourModels (with mmId + company), total, first and last scan (time, hour, model, mmId, company), avgCycle of the day.
 *  running = the model of the last scan: today's qty, first/last scan, its own average cycle and the median of its
 *            last 20 valid gaps ("current cycle": how fast it runs right now), and its current continuous run
 *            (runFirst / runQty: since the line last changed to this model — no gap taken out, for the actual cycle).
 */
function live_from_rows(array $rows, float $cmin, float $cmax): array
{
    $out = ['total' => 0, 'hours' => [], 'hourModels' => [], 'lastScan' => null, 'firstScan' => null, 'lastHour' => null, 'model' => null,
            'mmId' => null, 'company' => null, 'avgCycle' => null, 'running' => null];
    $hours = []; $hm = []; $meta = []; $byModel = []; $last = null; $first = null; $seq = [];
    foreach ($rows as $r) {
        [$id, $t, $mm, $model, $ok] = $r;
        if ((int)$ok !== 1) continue;
        $co = isset($r[5]) && $r[5] !== null ? trim((string)$r[5]) : null;
        $id = (int)$id; $h = (int)substr($t, 11, 2); $name = $model ?? 'Unknown model';
        $out['total']++;
        $hours[$h] = ($hours[$h] ?? 0) + 1;
        $hm[$h][$name] = ($hm[$h][$name] ?? 0) + 1;
        $meta[$name] = ['mmId' => $mm === null ? null : (int)$mm, 'company' => $co ?: null];
        $byModel[(int)$mm][] = [$t, $id];
        $seq[] = [$t, $id, $mm === null ? null : (int)$mm];
        if ($first === null || $t < $first) $first = $t;
        if ($last === null || $t > $last[0] || ($t === $last[0] && $id > $last[1])) $last = [$t, $id, $h, $name, $mm === null ? null : (int)$mm, $co ?: null];
    }
    ksort($hours);
    foreach ($hours as $h => $q) $out['hours'][] = ['hour' => $h, 'quantity' => $q];
    ksort($hm);
    foreach ($hm as $h => $models) {
        uksort($models, fn($a, $b) => ($models[$b] <=> $models[$a]) ?: strcmp((string)$a, (string)$b));
        foreach ($models as $name => $q) $out['hourModels'][] = ['hour' => $h, 'model' => (string)$name, 'qty' => $q,
            'mmId' => $meta[$name]['mmId'] ?? null, 'company' => $meta[$name]['company'] ?? null];
    }
    if ($last) {
        $out['firstScan'] = $first === null ? null : substr($first, 0, 19);
        $out['lastScan'] = substr($last[0], 0, 19); $out['lastHour'] = $last[2]; $out['model'] = $last[3];
        $out['mmId'] = $last[4]; $out['company'] = $last[5];
    }
    $sum = 0.0; $n = 0;
    foreach ($byModel as $mm => $scans) {
        usort($scans, fn($a, $b) => strcmp($a[0], $b[0]) ?: ($a[1] <=> $b[1]));
        $gaps = [];
        for ($i = 1, $c = count($scans); $i < $c; $i++) {
            $g = round(live_ms($scans[$i][0]) - live_ms($scans[$i - 1][0]), 3);
            if ($g >= $cmin && $g <= $cmax) { $sum += $g; $n++; $gaps[] = $g; }
        }
        if ($last && $last[4] !== null && (int)$mm === $last[4]) {
            $out['running'] = [
                'mmId' => $last[4], 'model' => $last[3], 'company' => $last[5], 'qty' => count($scans),
                'firstScan' => substr($scans[0][0], 0, 19), 'lastScan' => substr($scans[count($scans) - 1][0], 0, 19),
                'validCycles' => count($gaps),
                'avgCycle' => $gaps ? round(array_sum($gaps) / count($gaps), 2) : null,
                'currentCycle' => ($m = live_median(array_slice($gaps, -20))) === null ? null : round($m, 2),
            ];
        }
    }
    // the running model's continuous run: back from the last scan while the line kept making this model
    if ($out['running'] !== null && $seq) {
        usort($seq, fn($a, $b) => strcmp($a[0], $b[0]) ?: ($a[1] <=> $b[1]));
        $k = count($seq) - 1; $runQty = 0;
        while ($k >= 0 && $seq[$k][2] === $out['running']['mmId']) { $runQty++; $k--; }
        $out['running']['runFirst'] = substr($seq[$k + 1][0], 0, 19);
        $out['running']['runQty'] = $runQty;
    }
    $out['avgCycle'] = $n ? round($sum / $n, 2) : null;
    return $out;
}
