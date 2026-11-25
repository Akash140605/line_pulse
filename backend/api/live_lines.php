<?php
/**
 * live_lines.php — live numbers of ALL lines in one call (polled every few seconds by the Main page).
 *
 * GET params
 *   date         focus day (default: the latest day that has scans on any line, normally today)
 *   cmin, cmax   valid cycle window in seconds for the average cycle (default 1 .. 22)
 *
 * Per line: hourly quantity of the day, per-hour model breakdown, total, last scan time + model,
 * average valid cycle. A dead line is returned with ok=false; the others still work.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
@set_time_limit(60);

require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/live.php';
require_once __DIR__ . '/../lib/scanid.php';
json_headers();
header('Cache-Control: no-store, no-cache, must-revalidate');

$ymd = '/^\d{4}-\d{2}-\d{2}$/';
$focusReq = (isset($_GET['date']) && preg_match($ymd, $_GET['date'])) ? $_GET['date'] : '';
$cmin = max(0.0, min(600.0, (float)($_GET['cmin'] ?? 1)));
$cmax = max(1.0, min(3600.0, (float)($_GET['cmax'] ?? 22)));
$lo = sprintf('%.3F', $cmin); $hi = sprintf('%.3F', $cmax);
// engine=sql: the original four-query SQL path, kept only so the integration test can compare both answers
$legacy = ($_GET['engine'] ?? '') === 'sql';
// lineOnly=N: just that line — the browser asks the four line servers in parallel, so a slow or dead line never holds up the others
$lineOnly = (isset($_GET['lineOnly']) && isset(LINES[(int)$_GET['lineOnly']])) ? (int)$_GET['lineOnly'] : 0;
$LINES_ASKED = $lineOnly ? [$lineOnly => LINES[$lineOnly]] : LINES;
$LINES_ASKED = array_filter($LINES_ASKED, fn($id) => auth_line_ok((int)$id), ARRAY_FILTER_USE_KEY);   // a line-limited login (lib/auth.php)
cache_or_capture(4, false); // per line row snapshots below; live screen polls every few seconds; several viewers share one result
const VALID = "(s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')";

$maxDay = [];
$downErr = [];   // lines that failed in this request: not asked again below
$latest = '';
$tDay = microtime(true);
foreach ($focusReq ? [] : $LINES_ASKED as $id => $cfg) { // a requested day needs no lookup
    $tl = microtime(true);
    try {
        $pdo = snap_query_timeout(connect_line($id, !backup_stale_for((int)$id, $focusReq ?: ems_today())), 15);   // 25-11-2026: gives up after 15 s → the line's last good row   // a backup older than the day asked has nothing of it
        $d = $legacy ? $pdo->query("SELECT CONVERT(char(10), MAX(s.ScanDate), 23) FROM dbo.ScanStatus s WHERE " . VALID)->fetchColumn()
                     : latest_scan_day($pdo);
        $maxDay[$id] = $d ?: '';
        if ($d && $d > $latest && !isset(backup_used()[$id])) $latest = $d;
    } catch (Throwable $e) {
        $maxDay[$id] = null;
        if (snap_is_offline_error($e->getMessage())) {
            $downErr[$id] = $e->getMessage();   // not asked a second time in this request
        }
    }
}
$focus = $focusReq ?: ($latest ?: ems_today());
$dayMs = (int)round((microtime(true) - $tDay) * 1000);

$lines = [];
foreach ($LINES_ASKED as $id => $cfg) {
    $row = ['line' => (string)$id, 'name' => $cfg['name'], 'ok' => true, 'error' => null,
            'total' => 0, 'hours' => [], 'hourModels' => [],
            'lastScan' => null, 'lastHour' => null, 'model' => null, 'avgCycle' => null, 'ms' => null];
    $t0 = microtime(true);
    try {
        if (isset($downErr[$id])) throw new RuntimeException($downErr[$id]);
        $pdo = snap_query_timeout(connect_line($id, !backup_stale_for((int)$id, $focusReq ?: ems_today())), 15);   // 25-11-2026: gives up after 15 s → the line's last good row
        // line offline → answered from the local backup: show its last production day (unless a day was asked for)
        $row['backup'] = backup_row_info(backup_used(), $id);
        $day = $focus;
        // the backup copy stopped before the last live read of this line (mirror not running): show that newer read
        if ($row['backup'] && ($snap = snap_row_if_newer('live', $id, $focusReq, $row['backup']))) {
            $snap['ms'] = (int)round((microtime(true) - $t0) * 1000);
            $lines[] = $snap;
            continue;
        }
        if ($row['backup'] && !$focusReq) {
            $day = $maxDay[$id] ?: latest_scan_day($pdo);
            $row['day'] = $day;
        }
        if (!$legacy) {
            // one query for the day, everything else computed in PHP (lib/live.php)
            $row = array_merge($row, live_from_rows(fetch_live_rows($pdo, $day, (string)$id), $cmin, $cmax));
            $row['ms'] = (int)round((microtime(true) - $t0) * 1000);
            // last good live row of the line: shown if the line goes offline later (lib/snapshot.php)
            if (!$row['backup'] && !$legacy) { snap_save_row('live', $id, $row + ['day' => $day]); snap_save_row('live', $id, $row + ['day' => $day], $day); }
            $lines[] = $row;
            continue;
        }

        // hourly quantity (every valid scan counts, no model join)
        $st = $pdo->prepare("SELECT DATEPART(hour, s.ScanDate) AS h, COUNT(*) AS q FROM dbo.ScanStatus s
                             WHERE " . VALID . " AND s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))
                             GROUP BY DATEPART(hour, s.ScanDate) ORDER BY h");
        $st->execute([':d' => $focus, ':d2' => $focus]);
        while ($r = $st->fetch(PDO::FETCH_ASSOC)) { $row['hours'][] = ['hour' => (int)$r['h'], 'quantity' => (int)$r['q']]; $row['total'] += (int)$r['q']; }

        if ($row['total'] > 0) {
            // model + qty per hour (LEFT JOIN: scans whose model is missing in the master still show up)
            $st = $pdo->prepare("SELECT DATEPART(hour, s.ScanDate) AS h, ISNULL(m.Model, 'Unknown model') AS Model, COUNT(*) AS q
                                 FROM dbo.ScanStatus s LEFT JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
                                 WHERE " . VALID . " AND s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))
                                 GROUP BY DATEPART(hour, s.ScanDate), ISNULL(m.Model, 'Unknown model')
                                 ORDER BY h, q DESC");
            $st->execute([':d' => $focus, ':d2' => $focus]);
            while ($r = $st->fetch(PDO::FETCH_ASSOC)) $row['hourModels'][] = ['hour' => (int)$r['h'], 'model' => $r['Model'], 'qty' => (int)$r['q']];

            // last scan: time, hour, model
            $st = $pdo->prepare("SELECT TOP 1 CONVERT(char(19), s.ScanDate, 120) AS t, DATEPART(hour, s.ScanDate) AS h, ISNULL(m.Model, 'Unknown model') AS Model
                                 FROM dbo.ScanStatus s LEFT JOIN dbo.Tab_ModelMaster m ON m.MMId = s.MMId
                                 WHERE " . VALID . " AND s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))
                                 ORDER BY s.ScanDate DESC, s.ScanId DESC");
            $st->execute([':d' => $focus, ':d2' => $focus]);
            if ($r = $st->fetch(PDO::FETCH_ASSOC)) { $row['lastScan'] = $r['t']; $row['lastHour'] = (int)$r['h']; $row['model'] = $r['Model']; }

            // average valid cycle (gap between consecutive scans of the same model)
            $st = $pdo->prepare("
WITH x AS (
    SELECT s.ScanDate,
           LAG(s.ScanDate) OVER (PARTITION BY s.MMId ORDER BY s.ScanDate, s.ScanId) AS prevDate
    FROM dbo.ScanStatus s
    WHERE " . VALID . " AND s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))
)
SELECT AVG(g) FROM (SELECT CAST(DATEDIFF(millisecond, prevDate, ScanDate) AS float) / 1000.0 AS g FROM x WHERE prevDate IS NOT NULL) q
WHERE g >= $lo AND g <= $hi");
            $st->execute([':d' => $focus, ':d2' => $focus]);
            $a = $st->fetchColumn();
            $row['avgCycle'] = ($a === false || $a === null) ? null : round((float)$a, 2);
        }
    } catch (Throwable $e) {
        $row['ok'] = false; $row['error'] = $e->getMessage();
        // line offline and no SQL backup: its last good live row (of the asked day, else the newest one)
        if (!$legacy && snap_is_offline_error($row['error'])) {
            $snap = $focusReq ? snap_row('live', $id, $focusReq) : (snap_row('live', $id) ?? snap_recover_live_row($id));
            if ($snap) { $snap['offlineError'] = $row['error']; $row = $snap; }
        }
    }
    $row['ms'] = (int)round((microtime(true) - $t0) * 1000);
    $lines[] = $row;
}

echo json_encode(['focus' => $focus, 'today' => ems_today(), 'generatedAt' => ems_iso(), 'clockOffset' => ems_clock_offset(), 'findDayMs' => $dayMs, 'lines' => $lines],
                 JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);