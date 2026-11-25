<?php
/**
 * GET /api/analytics.php?startDate=&endDate=[&companyId=&mmId=&minQty=&outlier*=&refresh=1]
 * Distribution / per-model / daily-SPC / pareto data for the analytics pages.
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/analytics.php';
require_once __DIR__ . '/../lib/idle.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';

json_headers();
$range = get_range_params();
$minQty = get_min_qty_param();
respond_cached(function () use ($range, $minQty) {
    $pdo = snap_query_timeout(get_db(), 25);   // 25-11-2026: a hung query gives up after 25 s (it held a server thread 120 s)
    $range = with_scan_ids($pdo, $range);
    $agg = aggregate_scans(fetch_scan_rows($pdo, $range));
    $payload = build_analytics_payload($agg, fetch_model_meta($pdo), fetch_rejection_range($pdo, $range), $range, $minQty);
    return attach_idle_analytics($payload, distribute_idle(fetch_idle_intervals($pdo, $range)));
}, 30);
