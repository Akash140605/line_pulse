<?php
/**
 * GET /api/day_overview.php?date=YYYY-MM-DD[&companyId=&mmId=&minQty=&refresh=1]
 * Focus-day data in ONE request: { hourly, rejection }
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cube.php';
require_once __DIR__ . '/../lib/idle.php';
require_once __DIR__ . '/../lib/rejections.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';

json_headers();
$range = get_range_params();
$minQty = get_min_qty_param();
respond_cached(function () use ($range, $minQty) {
    $pdo = snap_query_timeout(get_db(), 25);   // 25-11-2026: a hung query gives up after 25 s (it held a server thread 120 s)
    $range = with_scan_ids($pdo, $range);
    $rows = fetch_cube($pdo, $range);
    $hourly = attach_idle_hourly(build_hourly_payload($rows, $range['startDate'], $minQty), distribute_idle(fetch_idle_intervals($pdo, $range)));
    return [
        'outlier' => $range['outlier'],
        'hourly'    => $hourly,
        'rejection' => build_rejection_payload($pdo, $range, $hourly['totalQuantity']),
    ];
}, 8);
