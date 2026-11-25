<?php
/** GET /api/companies.php — company list for the filter dropdown. */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';

json_headers();
respond_cached(function () {
    $pdo = get_db();

$stmt = $pdo->query("
    SELECT CompanyId, CompanyTitle
    FROM dbo.Tab_CompanyMaster
    WHERE BlockStatus = 0
    ORDER BY CompanyTitle
");
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}, 600);
