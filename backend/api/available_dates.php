<?php
/**
 * GET /api/available_dates.php[?companyId=&mmId=]
 * Distinct dates that actually have scan data — used to build sensible
 * date-range presets (data here is historical, so "today" is usually empty).
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';

json_headers();
cache_or_capture(120);
$pdo = get_db();

$companyId = (isset($_GET['companyId']) && $_GET['companyId'] !== '') ? (int)$_GET['companyId'] : null;
$mmId      = (isset($_GET['mmId']) && $_GET['mmId'] !== '') ? (int)$_GET['mmId'] : null;

$sql = "
    SELECT CAST(s.ScanDate AS DATE) AS ScanDay, COUNT(*) AS Quantity
    FROM dbo.ScanStatus s
    INNER JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
    WHERE (s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')
";
$params = [];
if ($companyId) { $sql .= " AND m.CompanyId = :companyId"; $params[':companyId'] = $companyId; }
if ($mmId)      { $sql .= " AND s.MMId = :mmId"; $params[':mmId'] = $mmId; }
$sql .= " GROUP BY CAST(s.ScanDate AS DATE) ORDER BY ScanDay DESC";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode(array_map(fn($r) => [
    'date'     => (new DateTime($r['ScanDay']))->format('Y-m-d'),
    'quantity' => (int)$r['Quantity'],
], $rows));
