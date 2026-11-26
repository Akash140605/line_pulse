<?php
/**
 * GET /api/window_counts.php?startDate=&endDate=&from=HH:MM&to=HH:MM[&companyId=&mmId=&line=N]
 * Scans inside a time-of-day window (e.g. the lunch break 13:00–13:30), per day and clock hour.
 * The hourly matrix uses it to show the lunch window as its own row next to the worked part of that hour.
 * Same scan definition as the matrix (scan_base): FALSE scans excluded, same company / model filter.
 *   → { from, to, days: { "YYYY-MM-DD": { "13": 4 } } }
 */
require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/queries.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';

json_headers();
$range = get_range_params();
$hm = function (string $k): string {
    $v = (string)($_GET[$k] ?? '');
    if (!preg_match('/^(\d{1,2}):([0-5]\d)$/', $v, $m) || (int)$m[1] > 23) {
        http_response_code(400);
        echo json_encode(['error' => "$k must be a time HH:MM"]);
        exit;
    }
    return sprintf('%02d:%02d:00', (int)$m[1], (int)$m[2]);
};
$from = $hm('from'); $to = $hm('to');
if ($to <= $from) { http_response_code(400); echo json_encode(['error' => 'to must be after from']); exit; }

respond_cached(function () use ($range, $from, $to) {
    $pdo = snap_alive(fn () => get_db(), 25);   // 25-11-2026: a hung query gives up after 25 s (it held a server thread 120 s)
    $range = with_scan_ids($pdo, $range);
    $b = scan_base($range);
    $st = $pdo->prepare("SELECT CONVERT(char(10), CAST(s.ScanDate AS DATE), 23) AS d, DATEPART(hour, s.ScanDate) AS h, COUNT(*) AS q
                         {$b['from']}
                           AND CAST(s.ScanDate AS time) >= CAST(:wFrom AS time) AND CAST(s.ScanDate AS time) < CAST(:wTo AS time)
                         GROUP BY CAST(s.ScanDate AS DATE), DATEPART(hour, s.ScanDate)");
    $st->execute($b['params'] + [':wFrom' => $from, ':wTo' => $to]);
    $days = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) $days[$r['d']][(string)(int)$r['h']] = (int)$r['q'];
    return ['from' => substr($from, 0, 5), 'to' => substr($to, 0, 5), 'days' => (object)$days];
}, 25);
