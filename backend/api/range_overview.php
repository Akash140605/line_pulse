<?php
/**
 * GET /api/range_overview.php?startDate=&endDate=[&companyId=&mmId=&minQty=&refresh=1]
 * Everything the range-level panels need in ONE request / ONE SQL query:
 * { daily, models, matrix }
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cube.php';
require_once __DIR__ . '/../lib/idle.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';

json_headers();
$range = get_range_params();
$minQty = get_min_qty_param();
respond_cached(function () use ($range, $minQty) {
    $pdo = snap_alive(fn () => get_db(), 25);   // 25-11-2026: a hung query gives up after 25 s (it held a server thread 120 s)
    $range = with_scan_ids($pdo, $range);
    $rows = fetch_cube($pdo, $range);
    $idle = distribute_idle(fetch_idle_intervals($pdo, $range));
    return [
        'outlier' => $range['outlier'],
        'daily'  => attach_idle_daily(build_daily_payload($rows, $range, $minQty), $idle),
        'models' => build_models_payload($rows, $range, $minQty),
        'matrix' => attach_idle_matrix(build_matrix_payload($rows, $minQty), $idle),
    ];
}, 25);
