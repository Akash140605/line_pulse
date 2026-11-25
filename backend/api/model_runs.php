<?php
/**
 * model_runs.php — ordered scan sequence of ONE model, with the line-wide context needed for the
 * "continuous run" cycle method (Std Cycle page, method B).
 *
 * GET params
 *   start, end   YYYY-MM-DD (required, max 400 days apart)
 *   mmId         required, the model
 *   line         1..4 (handled by db.php)
 *
 * Returns rows as compact arrays:  [ "YYYY-MM-DD", hour, gapSec|null, rework ]
 *   gapSec  = seconds since this model's previous scan on the same line/day (null = first piece of the day)
 *   rework  = number of OTHER models' scans on the line between that previous piece and this one
 *
 * Same scan definition as the rest of the dashboard (FALSE scans excluded). Day boundaries follow the
 * other endpoints: a run never crosses midnight. All run / rework / break rules are applied in the browser
 * (utils/stdCycle.js), so changing a setting never needs a new request.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
@set_time_limit(300);
@ini_set('memory_limit', '1024M');

require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';
json_headers();

$ymd = '/^\d{4}-\d{2}-\d{2}$/';
$start = $_GET['start'] ?? ''; $end = $_GET['end'] ?? '';
if (!preg_match($ymd, $start) || !preg_match($ymd, $end)) { http_response_code(400); echo json_encode(['error' => 'start and end (YYYY-MM-DD) are required']); exit; }
$span = (strtotime($end) - strtotime($start)) / 86400;
if ($span < 0 || $span > 400) { http_response_code(400); echo json_encode(['error' => 'Date range must be between 0 and 400 days']); exit; }

$mmId = (int)($_GET['mmId'] ?? 0);
if ($mmId <= 0) { http_response_code(400); echo json_encode(['error' => 'mmId is required']); exit; }

cache_or_capture(120);
$pdo = get_db();
[$idSql, $idP] = scan_id_sql(with_scan_ids($pdo, ['startDate' => $start, 'endDate' => $end]));

try {
    // x  : every valid scan of the LINE, numbered per day (rn) — this is what makes "other model" scans countable
    // y  : for the selected model only, previous piece's rn and time  ->  rework = rn - prevRn - 1
    $sql = "
WITH x AS (
    SELECT s.MMId, s.ScanDate, CAST(s.ScanDate AS DATE) AS d,
           ROW_NUMBER() OVER (PARTITION BY CAST(s.ScanDate AS DATE) ORDER BY s.ScanDate, s.ScanId) AS rn
    FROM dbo.ScanStatus s
    WHERE (s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')
      AND s.ScanDate >= CAST(:start AS DATE)
      AND s.ScanDate <  DATEADD(DAY, 1, CAST(:end AS DATE))$idSql
), y AS (
    SELECT MMId, ScanDate, d, rn,
           LAG(rn)       OVER (PARTITION BY MMId, d ORDER BY rn) AS prevRn,
           LAG(ScanDate) OVER (PARTITION BY MMId, d ORDER BY rn) AS prevDate
    FROM x
)
SELECT CONVERT(char(10), d, 23) AS d,
       DATEPART(hour, ScanDate) AS h,
       CASE WHEN prevDate IS NULL THEN NULL
            ELSE CAST(DATEDIFF(millisecond, prevDate, ScanDate) AS float) / 1000.0 END AS gap,
       CASE WHEN prevRn IS NULL THEN 0 ELSE rn - prevRn - 1 END AS rework
FROM y
WHERE MMId = :mid
ORDER BY d, rn";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':start' => $start, ':end' => $end, ':mid' => $mmId] + $idP);

    $rows = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $rows[] = [
            $r['d'],
            (int)$r['h'],
            $r['gap'] === null ? null : round((float)$r['gap'], 1),
            (int)$r['rework'],
        ];
    }

    $meta = null;
    $q = $pdo->prepare("SELECT m.Model, m.ModelCode, c.CompanyTitle FROM dbo.Tab_ModelMaster m
                        INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId WHERE m.MMId = :mid");
    $q->execute([':mid' => $mmId]);
    if ($m = $q->fetch(PDO::FETCH_ASSOC)) $meta = $m;

    echo json_encode([
        'range'       => ['start' => $start, 'end' => $end],
        'mmId'        => $mmId,
        'model'       => $meta['Model'] ?? ('Model ' . $mmId),
        'modelCode'   => $meta['ModelCode'] ?? null,
        'company'     => $meta['CompanyTitle'] ?? null,
        'count'       => count($rows),
        'columns'     => ['d', 'h', 'gap', 'rework'],
        'rows'        => $rows,
        'generatedAt' => ems_iso(),
    ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed: ' . $e->getMessage()]);
}
