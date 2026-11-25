<?php
/**
 * model_control.php — raw scan-to-scan gaps per model per day, for the Control Charts page.
 *
 * GET params
 *   start, end   YYYY-MM-DD (required, max 400 days apart)
 *   companyId    optional
 *   mmId         optional
 *   cap          optional, seconds (default 3600). Gaps above the cap are only counted ("o"), not sent.
 *
 * Same scan definition as the rest of the dashboard (scan_base): FALSE scans excluded,
 * gap = time between two consecutive scans of the SAME model on the SAME day.
 * All outlier / min / max logic is applied in the browser.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
@set_time_limit(300);
@ini_set('memory_limit', '1024M');

header('Content-Type: application/json; charset=utf-8');
// 25-11-2026: no "Access-Control-Allow-Origin: *" — auth_guard() sends it only to a Line Pulse page
// CORS preflight and login: auth_guard() below

function out($data, int $code = 200): void {
    http_response_code($code);
    if (!defined('EMS_CAPTURE') && function_exists('ob_gzhandler') && !ini_get('zlib.output_compression')) { ob_start('ob_gzhandler'); }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

// A fatal error (memory / timeout) would otherwise return an empty body => "Failed to fetch".
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true) && !headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        // (no "*": the error goes to the Line Pulse page only — auth_cors already sent its header)
        echo json_encode(['error' => 'PHP fatal: ' . $e['message']]);
    }
});

require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';
cache_or_capture(120);

$pdo = null;
try { $pdo = get_db(); } catch (Throwable $e) { out(['error' => 'Database connection failed: ' . $e->getMessage()], 500); }

$ymd = '/^\d{4}-\d{2}-\d{2}$/';
$start = $_GET['start'] ?? ''; $end = $_GET['end'] ?? '';
if (!preg_match($ymd, $start) || !preg_match($ymd, $end)) out(['error' => 'start and end (YYYY-MM-DD) are required'], 400);
$days = (strtotime($end) - strtotime($start)) / 86400;
if ($days < 0 || $days > 400) out(['error' => 'Date range must be between 0 and 400 days'], 400);

$companyId = isset($_GET['companyId']) && $_GET['companyId'] !== '' ? (int)$_GET['companyId'] : null;
$mmId      = isset($_GET['mmId']) && $_GET['mmId'] !== '' ? (int)$_GET['mmId'] : null;
$cap       = max(60, min(14400, (int)($_GET['cap'] ?? 3600)));

$extra = ''; $params = [':start' => $start, ':end' => $end];
if ($companyId !== null) { $extra .= ' AND m.CompanyId = :cid'; $params[':cid'] = $companyId; }
if ($mmId !== null)      { $extra .= ' AND s.MMId = :mid';      $params[':mid'] = $mmId; }
[$idSql, $idP] = scan_id_sql(with_scan_ids($pdo, ['startDate' => $start, 'endDate' => $end]));
$extra .= $idSql; $params += $idP;

try {
    $sql = "
WITH x AS (
    SELECT s.MMId, s.ScanDate, CAST(s.ScanDate AS DATE) AS d,
           LAG(s.ScanDate) OVER (PARTITION BY s.MMId, CAST(s.ScanDate AS DATE) ORDER BY s.ScanDate, s.ScanId) AS prevDate
    FROM dbo.ScanStatus s
    INNER JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
    INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId
    WHERE (s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')
      AND s.ScanDate >= CAST(:start AS DATE)
      AND s.ScanDate <  DATEADD(DAY, 1, CAST(:end AS DATE))
      $extra
)
SELECT MMId, CONVERT(char(10), d, 23) AS d, DATEPART(hour, ScanDate) AS h,
       CASE WHEN prevDate IS NULL THEN NULL
            ELSE CAST(DATEDIFF(millisecond, prevDate, ScanDate) AS float) / 1000.0 END AS gap
FROM x
ORDER BY MMId, d, ScanDate";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $acc = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $m = (int)$r['MMId']; $d = $r['d'];
        if (!isset($acc[$m][$d])) $acc[$m][$d] = ['q' => 0, 'o' => 0, 'h' => [], 'g' => []];
        $acc[$m][$d]['q']++;
        if ($r['gap'] !== null) {
            $g = round((float)$r['gap'], 1);
            if ($g > $cap) { $acc[$m][$d]['o']++; }
            else { $acc[$m][$d]['g'][] = $g; $acc[$m][$d]['h'][] = (int)$r['h']; }
        }
    }

    $meta = [];
    $q2 = $pdo->query("SELECT m.MMId, m.Model, m.ModelCode, c.CompanyId, c.CompanyTitle
                       FROM dbo.Tab_ModelMaster m INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId");
    while ($m = $q2->fetch(PDO::FETCH_ASSOC)) $meta[(int)$m['MMId']] = $m;

    $models = [];
    foreach ($acc as $id => $daysMap) {
        $mt = $meta[$id] ?? [];
        $models[] = [
            'mmId' => $id, 'model' => $mt['Model'] ?? ('Model ' . $id), 'modelCode' => $mt['ModelCode'] ?? null,
            'companyId' => $mt['CompanyId'] ?? null, 'company' => $mt['CompanyTitle'] ?? null,
            'days' => (object)$daysMap,
        ];
    }
    out(['range' => ['start' => $start, 'end' => $end], 'cap' => $cap, 'generatedAt' => ems_iso(), 'models' => $models]);
} catch (Throwable $e) {
    out(['error' => 'Query failed: ' . $e->getMessage()], 500);
}