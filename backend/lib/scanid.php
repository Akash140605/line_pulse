<?php
require_once __DIR__ . '/clock.php';
/**
 * Fast date ranges on tables WITHOUT a ScanDate index.
 *
 * dbo.ScanStatus is clustered on ScanId (primary key) and ScanId grows with time, so the first scan of a day
 * can be found with ~25 index seeks (binary search) instead of reading millions of rows. Every range query then
 * gets "ScanId >= lo AND ScanId < hi" IN ADDITION to its normal ScanDate filter: the date filter still decides
 * which rows count, the id range only lets SQL Server seek. Boundaries are cached per line and day.
 *
 * Safety: this relies on ScanId growing with time (checked on the live data when it was added: counts with and
 * without the id range were equal). Switch off with SCANID_RANGE = false, or per request with ?noid=1.
 */
const SCANID_RANGE = true;

/**
 * First id at which ScanDate >= $boundary ('Y-m-d H:i:s'), or $maxId + 1 when no such row.
 * $probe(int $id) returns [firstIdAtOrAfter, 'Y-m-d H:i:s'] or null when no row has ScanId >= $id.
 */
function scan_id_search(callable $probe, int $minId, int $maxId, string $boundary): int
{
    $lo = $minId; $hi = $maxId + 1;
    while ($lo < $hi) {
        $mid = intdiv($lo + $hi, 2);
        $r = $probe($mid);
        if ($r === null || $r[1] >= $boundary) { $hi = $mid; }
        else { $lo = max($mid, (int)$r[0]) + 1; }
    }
    return $lo;
}

/** [lo, hi|null] for the days start..end. No upper limit when the range reaches today (scans keep arriving). */
function scan_id_bounds_from(callable $probe, int $minId, int $maxId, string $start, string $end, string $today): array
{
    $lo = scan_id_search($probe, $minId, $maxId, $start . ' 00:00:00');
    $hi = null;
    if ($end < $today) $hi = scan_id_search($probe, $minId, $maxId, date('Y-m-d', strtotime("$end +1 day")) . ' 00:00:00');
    return [$lo, $hi];
}

/** Cached boundary for one line + day start. */
function scan_id_cached(PDO $pdo, string $key, string $boundary, callable $compute, int $maxId): int
{
    $file = sys_get_temp_dir() . '/ems_sid_' . md5($key . '|' . $boundary) . '.txt';
    if (is_file($file)) { $v = (int)@file_get_contents($file); if ($v > 0) return $v; }
    $v = $compute();
    // cache only real boundaries (a row exists at/after it) — "nothing yet today" must be recomputed later
    if ($v <= $maxId) @file_put_contents($file, (string)$v, LOCK_EX);
    return $v;
}

/** Adds idLo / idHi to a range (startDate, endDate) for the line behind $pdo. Never throws: on any problem the range is returned unchanged. */
function with_scan_ids(PDO $pdo, array $range, string $lineKey = ''): array
{
    if (!SCANID_RANGE || !empty($_GET['noid'])) return $range;
    try {
        $mm = $pdo->query("SELECT MIN(ScanId) AS lo, MAX(ScanId) AS hi FROM dbo.ScanStatus")->fetch(PDO::FETCH_ASSOC);
        if (!$mm || $mm['lo'] === null || !is_numeric($mm['lo'])) return $range;
        $minId = (int)$mm['lo']; $maxId = (int)$mm['hi'];
        $st = $pdo->prepare("SELECT TOP 1 ScanId, CONVERT(char(19), ScanDate, 120) FROM dbo.ScanStatus WHERE ScanId >= :id ORDER BY ScanId");
        $probe = function (int $id) use ($st) { $st->execute([':id' => $id]); $r = $st->fetch(PDO::FETCH_NUM); $st->closeCursor(); return $r ? [(int)$r[0], $r[1]] : null; };
        $key = $lineKey !== '' ? $lineKey : (string)current_line();
        $today = ems_today();   // DB ka din, PC ki ghadi nahi
        $first = fn(string $day) => scan_id_cached($pdo, $key, $day, fn() => scan_id_search($probe, $minId, $maxId, $day . ' 00:00:00'), $maxId);
        $range['idLo'] = $first($range['startDate']);
        $range['idHi'] = $range['endDate'] < $today ? $first(date('Y-m-d', strtotime($range['endDate'] . ' +1 day'))) : null;
    } catch (Throwable $e) {
        unset($range['idLo'], $range['idHi']);
    }
    return $range;
}

/** SQL fragment + params for the id range of $range (empty when not set). */
function scan_id_sql(array $range, string $alias = 's'): array
{
    $sql = ''; $p = [];
    if (isset($range['idLo'])) { $sql .= " AND $alias.ScanId >= :idLo"; $p[':idLo'] = $range['idLo']; }
    if (isset($range['idHi']) && $range['idHi'] !== null) { $sql .= " AND $alias.ScanId < :idHi"; $p[':idHi'] = $range['idHi']; }
    return [$sql, $p];
}
