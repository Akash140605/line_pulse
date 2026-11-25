<?php
/**
 * GET /api/models.php[?companyId=]
 * Model list for the filter dropdown, optionally narrowed to one company.
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';

json_headers();
cache_or_capture(600);
$pdo = get_db();

$companyId = (isset($_GET['companyId']) && $_GET['companyId'] !== '') ? (int)$_GET['companyId'] : null;

$sql = "
    SELECT m.MMId, m.Model, m.ModelCode, m.CompanyId, c.CompanyTitle
    FROM dbo.Tab_ModelMaster m
    INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId
    WHERE m.BlockStatus = 0
";
$params = [];
if ($companyId) {
    $sql .= " AND m.CompanyId = :companyId";
    $params[':companyId'] = $companyId;
}
$sql .= " ORDER BY m.Model";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

echo json_encode(array_map(fn($r) => [
    'mmId'         => (int)$r['MMId'],
    'model'        => $r['Model'],
    'modelCode'    => $r['ModelCode'],
    'companyId'    => (int)$r['CompanyId'],
    'companyTitle' => $r['CompanyTitle'],
], $stmt->fetchAll(PDO::FETCH_ASSOC)));
