<?php
/**
 * Builds the core "ScanDiff" CTE: every successful scan, with its actual
 * cycle time = seconds since the previous successful scan of the SAME MODEL
 * ON THE SAME DAY (partitioned by day, so a midnight gap is never a cycle).
 *
 * Returns ['sql' => "...CTE...", 'params' => [...]] — start your own SELECT
 * with 'sql' and merge 'params' into execute().
 */
/** Shared FROM/WHERE for every scan query (status filter + date range + company/model filters). */
function scan_base(array $filters): array
{
    $params = [':startDate' => $filters['startDate'], ':endDate' => $filters['endDate']];
    $extra = '';
    if (!empty($filters['companyId'])) { $extra .= ' AND m.CompanyId = :companyId'; $params[':companyId'] = $filters['companyId']; }
    if (!empty($filters['mmId']))      { $extra .= ' AND s.MMId = :mmId';           $params[':mmId'] = $filters['mmId']; }
    // optional clustered-key range (lib/scanid.php): lets SQL Server seek; the ScanDate filter below still decides
    if (isset($filters['idLo'])) { $extra .= ' AND s.ScanId >= :idLo'; $params[':idLo'] = $filters['idLo']; }
    if (isset($filters['idHi']) && $filters['idHi'] !== null) { $extra .= ' AND s.ScanId < :idHi'; $params[':idHi'] = $filters['idHi']; }

    $from = "
            FROM dbo.ScanStatus s
            INNER JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
            INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId
            WHERE (s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')
              AND s.ScanDate >= CAST(:startDate AS DATE)
              AND s.ScanDate <  DATEADD(DAY, 1, CAST(:endDate AS DATE))
              $extra";
    return ['from' => $from, 'params' => $params];
}

/**
 * Builds the core "ScanDiff" CTE: every successful scan, with its actual cycle time = seconds since the
 * previous successful scan of the SAME MODEL ON THE SAME DAY (ties broken by ScanId). Gaps that fail the
 * outlier rule get CycleSeconds = NULL (RawCycleSeconds keeps the gap, IsOutlier = 1).
 */
function build_scan_diff_cte(array $filters): array
{
    $b = scan_base($filters);
    $ok = outlier_condition($filters['outlier'] ?? default_outlier());

    $sql = "
        WITH ScanRaw AS (
            SELECT
                s.ScanId, s.MMId, m.Model, m.ModelCode, m.CompanyId, c.CompanyTitle, s.ScanDate,
                CAST(s.ScanDate AS DATE) AS ScanDay,
                DATEPART(HOUR, s.ScanDate) AS HourSlot,
                DATEDIFF(
                    SECOND,
                    LAG(s.ScanDate) OVER (
                        PARTITION BY s.MMId, CAST(s.ScanDate AS DATE)
                        ORDER BY s.ScanDate, s.ScanId
                    ),
                    s.ScanDate
                ) AS CycleSeconds
            {$b['from']}
        ),
        ScanMed AS (
            SELECT r.*,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.CycleSeconds) OVER (PARTITION BY r.MMId, r.ScanDay) AS MedCycle
            FROM ScanRaw r
        ),
        ScanDiff AS (
            SELECT ScanId, MMId, Model, ModelCode, CompanyId, CompanyTitle, ScanDate, ScanDay, HourSlot,
                   CASE WHEN CycleSeconds IS NOT NULL AND ($ok) THEN CycleSeconds END AS CycleSeconds,
                   CycleSeconds AS RawCycleSeconds,
                   CASE WHEN CycleSeconds IS NOT NULL AND NOT ($ok) THEN 1 ELSE 0 END AS IsOutlier
            FROM ScanMed
        )
    ";
    return ['sql' => $sql, 'params' => $b['params']];
}

/**
 * LINE-LEVEL idle intervals: gaps between consecutive scans of ANY selected model on the same day that are
 * outliers (auto: > N x median line gap, fixed: > max s) AND at least idleMin seconds. Overlapping per-model gaps
 * (e.g. one lunch break seen by 5 models) therefore count ONCE. Returns [start, end, seconds] rows.
 */
function idle_query(array $filters): array
{
    $b = scan_base($filters);
    $o = $filters['outlier'] ?? default_outlier();
    $idle = (int)$o['idle'];
    $cap = $o['mode'] === 'fixed' ? 'Gap > ' . (int)$o['max']
         : ($o['mode'] === 'auto' ? 'Gap > CASE WHEN MedGap * ' . number_format((float)$o['mult'], 2, '.', '') . ' < 20 THEN 20 WHEN MedGap * ' . number_format((float)$o['mult'], 2, '.', '') . ' > ' . max(20, (int)($o['max'] ?? 300)) . ' THEN ' . max(20, (int)($o['max'] ?? 300)) . ' ELSE MedGap * ' . number_format((float)$o['mult'], 2, '.', '') . ' END' : '1 = 0');
    $sql = "
        WITH ScanLine AS (
            SELECT s.ScanDate,
                   LAG(s.ScanDate) OVER (PARTITION BY CAST(s.ScanDate AS DATE) ORDER BY s.ScanDate, s.ScanId) AS PrevDate
            {$b['from']}
        ),
        ScanGap AS (
            SELECT ScanDate, PrevDate, DATEDIFF(SECOND, PrevDate, ScanDate) AS Gap FROM ScanLine
        ),
        ScanGapMed AS (
            SELECT ScanDate, PrevDate, Gap,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY Gap) OVER (PARTITION BY CAST(ScanDate AS DATE)) AS MedGap
            FROM ScanGap
        )
        SELECT CONVERT(VARCHAR(19), PrevDate, 120) AS S, CONVERT(VARCHAR(19), ScanDate, 120) AS E, Gap
        FROM ScanGapMed
        WHERE PrevDate IS NOT NULL AND ($cap) AND Gap >= $idle
        ORDER BY ScanDate
    ";
    return ['sql' => $sql, 'params' => $b['params']];
}

function default_outlier(): array { return ['mode' => 'auto', 'mult' => 3.0, 'max' => 300, 'min' => 1, 'idle' => 60]; }

/**
 * Keeps only MMIds whose TOTAL scan count in the range is >= :minQty, so
 * low-volume/rework models stay out of cycle AVG/MIN/MAX but still count
 * in quantity totals. Needs ScanDiff in scope and :minQty bound.
 */
function reliable_model_filter(): string
{
    return "MMId IN (SELECT MMId FROM ScanDiff GROUP BY MMId HAVING COUNT(*) >= :minQty)";
}

/**
 * SQL predicate: "this gap is a valid cycle time". Values are cast to numbers here
 * (never raw user input), so they are safe to inline.
 */
function outlier_condition(array $o): string
{
    $min = (int)$o['min'];
    $c = "CycleSeconds >= $min";
    if ($o['mode'] === 'fixed') {
        $c .= ' AND CycleSeconds <= ' . (int)$o['max'];
    } elseif ($o['mode'] === 'auto') {
        $m = number_format((float)$o['mult'], 2, '.', '');
        $floor = 20; // never cut below 20 s, so very fast lines don't lose normal cycles
        // Ceiling: a model with only 2-3 scans in a day has a median of hours, so "N x median" alone would
        // accept a 4-hour gap as a cycle. The max setting (default 300 s) is an absolute upper limit in auto mode too.
        $ceil = max($floor, (int)($o['max'] ?? 300));
        $c .= " AND CycleSeconds <= CASE WHEN MedCycle * $m < $floor THEN $floor WHEN MedCycle * $m > $ceil THEN $ceil ELSE MedCycle * $m END";
    }
    return $c;
}
