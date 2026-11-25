<?php
/**
 * GET /api/hour_detail.php?date=YYYY-MM-DD&hour=8[&companyId=&mmId=&minQty=]
 *
 * Drill-down for one hour of one day: every scan with its actual
 * cycle time, plus a per-model breakdown (qty, min/max/avg actual,
 * theoretical) for just that hour.
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/queries.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';

json_headers();
$range = get_range_params();
$minQty = get_min_qty_param();
$hour = isset($_GET['hour']) ? (int)$_GET['hour'] : null;

if ($hour === null || $hour < 0 || $hour > 23) {
    http_response_code(400);
    echo json_encode(['error' => 'hour is required and must be 0-23']);
    exit;
}

cache_or_capture(20);
$pdo = get_db();
$range = with_scan_ids($pdo, $range);
$cte = build_scan_diff_cte($range);

// range-total per model, to flag low-volume/rework models in this hour's list
$dayTotalStmt = $pdo->prepare($cte['sql'] . "SELECT MMId, COUNT(*) AS RangeQty FROM ScanDiff GROUP BY MMId");
$dayTotalStmt->execute($cte['params']);
$rangeQtyByModel = [];
foreach ($dayTotalStmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $rangeQtyByModel[(int)$r['MMId']] = (int)$r['RangeQty'];
}

// per-model breakdown for this hour
$modelStmt = $pdo->prepare($cte['sql'] . "
    SELECT
        MMId, Model, ModelCode, CompanyTitle,
        COUNT(*) AS Quantity,
        AVG(CAST(CycleSeconds AS FLOAT)) AS AvgActualCycleSeconds,
        MIN(CycleSeconds) AS MinActualCycleSeconds,
        MAX(CycleSeconds) AS MaxActualCycleSeconds
    FROM ScanDiff
    WHERE HourSlot = :hourSlot
    GROUP BY MMId, Model, ModelCode, CompanyTitle
    ORDER BY Quantity DESC
");
$modelStmt->execute($cte['params'] + [':hourSlot' => $hour]);
$modelRows = $modelStmt->fetchAll(PDO::FETCH_ASSOC);

$models = array_map(function ($r) use ($rangeQtyByModel, $minQty) {
    $qty = (int)$r['Quantity'];
    $mmId = (int)$r['MMId'];
    return [
        'mmId'                    => $mmId,
        'model'                   => $r['Model'],
        'modelCode'               => $r['ModelCode'],
        'companyTitle'            => $r['CompanyTitle'],
        'quantity'                => $qty,
        'isLowVolume'             => ($rangeQtyByModel[$mmId] ?? 0) < $minQty,
        'avgActualCycleSeconds'   => $r['AvgActualCycleSeconds'] !== null ? round((float)$r['AvgActualCycleSeconds'], 1) : null,
        'minActualCycleSeconds'   => $r['MinActualCycleSeconds'],
        'maxActualCycleSeconds'   => $r['MaxActualCycleSeconds'],
        'theoreticalCycleSeconds' => $qty > 0 ? round(3600 / $qty, 1) : null,
    ];
}, $modelRows);

// raw scan-by-scan list for this hour
$scanStmt = $pdo->prepare($cte['sql'] . "
    SELECT ScanId, MMId, Model, ModelCode, ScanDate, RawCycleSeconds AS CycleSeconds, IsOutlier
    FROM ScanDiff
    WHERE HourSlot = :hourSlot
    ORDER BY ScanDate
");
$scanStmt->execute($cte['params'] + [':hourSlot' => $hour]);

$scans = array_map(fn($r) => [
    'scanId'       => (int)$r['ScanId'],
    'mmId'         => (int)$r['MMId'],
    'model'        => $r['Model'],
    'modelCode'    => $r['ModelCode'],
    'scanDate'     => $r['ScanDate'],
    'cycleSeconds' => $r['CycleSeconds'] !== null ? (int)$r['CycleSeconds'] : null, // raw gap (drawer has its own filters)
    'isOutlier'    => (int)$r['IsOutlier'] === 1,
], $scanStmt->fetchAll(PDO::FETCH_ASSOC));

$totalQty = array_sum(array_column($models, 'quantity'));

echo json_encode([
    'date'                    => $range['startDate'],
    'minQtyThreshold'         => $minQty,
    'hour'                    => $hour,
    'label'                   => sprintf('%02d:00-%02d:00', $hour, ($hour + 1) % 24),
    'totalQuantity'           => $totalQty,
    'theoreticalCycleSeconds' => $totalQty > 0 ? round(3600 / $totalQty, 1) : null,
    'models'                  => $models,
    'scans'                   => $scans,
]);
