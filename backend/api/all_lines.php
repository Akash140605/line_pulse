<?php
/**
 * all_lines.php — production of ALL lines in one response, for the "Main" view.
 *
 * GET params
 *   start, end   YYYY-MM-DD (required, max 400 days apart)
 *   date         focus day for the hourly part (default: latest day that has scans on any line)
 *   cmin, cmax   valid cycle window in seconds (default 1 .. 22), only used for the cycle-time columns
 *   only=hourly  return just the hourly breakdown of `date` (fast, used when a day is clicked)
 *
 * Per line, besides the totals: dailyCo [{d, c, q}] and hourlyCo [{h, c, q}] = the same quantities split by company
 * (company title), so the Main view can filter one or several companies without asking the server again.
 * dhm [[date, hour, mmId, qty]] + mmCo {mmId: company}: quantity per day, clock hour and model, for the model-wise
 * day target and the loss in ₹ per line and day (Main view).
 *
 * One dead / unreachable line never breaks the others: it is returned with ok=false and an error text.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
@set_time_limit(300);
@ini_set('memory_limit', '1024M');

require_once __DIR__ . '/../lib/auth.php';
auth_guard();   // login check (see lib/auth.php)
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/cache.php';
require_once __DIR__ . '/../lib/scanid.php';
json_headers();

$ymd = '/^\d{4}-\d{2}-\d{2}$/';
$start = $_GET['start'] ?? ''; $end = $_GET['end'] ?? '';
if (!preg_match($ymd, $start) || !preg_match($ymd, $end)) { http_response_code(400); echo json_encode(['error' => 'start and end (YYYY-MM-DD) are required']); exit; }
$span = (strtotime($end) - strtotime($start)) / 86400;
if ($span < 0 || $span > 400) { http_response_code(400); echo json_encode(['error' => 'Date range must be between 0 and 400 days']); exit; }

$focusReq = (isset($_GET['date']) && preg_match($ymd, $_GET['date'])) ? $_GET['date'] : '';
$only = $_GET['only'] ?? '';
$cmin = max(0.0, min(600.0, (float)($_GET['cmin'] ?? 1)));
$cmax = max(1.0, min(3600.0, (float)($_GET['cmax'] ?? 22)));
// lineOnly=N: just that line (the browser asks for the lines in parallel, so the slowest line sets the wait, not the sum)
$lineOnly = (isset($_GET['lineOnly']) && isset(LINES[(int)$_GET['lineOnly']])) ? (int)$_GET['lineOnly'] : 0;
// a finished period's production never changes — its copy is kept 7 days (was 6 h), so the first opening of
// the day (any PC) does not rebuild the whole month; Refresh (refresh=1) still rebuilds it. Backup / offline answers are never kept.
if (!defined('EMS_PAST_TTL')) define('EMS_PAST_TTL', 7 * 86400);
cache_or_capture($end >= ems_today() && $span < 1 ? 15 : 60, false);   // today: a fresh answer every 15 s (screens poll every 20 s); snapshots per line row below

const VALID = "(s.Status IS NULL OR LTRIM(RTRIM(UPPER(s.Status))) <> 'FALSE')";
const IN_RANGE = "s.ScanDate >= CAST(:start AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:end AS DATE))";

/** Company of each model: one row per MMId (TOP 1), so a duplicate master row can never double a count. */
const CO_APPLY = "OUTER APPLY (SELECT TOP 1 c.CompanyTitle FROM dbo.Tab_ModelMaster m
                              INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId WHERE m.MMId = a.MMId) co";
const NO_CO = '(no company)';

/** Hourly quantity of one day: totals [{h, q}] and per company [{h, c, q}]. */
function hourly_for(PDO $pdo, string $d, string $lineKey): array {
    [$idSql, $idP] = scan_id_sql(with_scan_ids($pdo, ['startDate' => $d, 'endDate' => $d], $lineKey));
    $st = $pdo->prepare("WITH a AS (SELECT DATEPART(hour, s.ScanDate) AS h, s.MMId, COUNT(*) AS q FROM dbo.ScanStatus s
                         WHERE " . VALID . " AND s.ScanDate >= CAST(:d AS DATE) AND s.ScanDate < DATEADD(DAY, 1, CAST(:d2 AS DATE))$idSql
                         GROUP BY DATEPART(hour, s.ScanDate), s.MMId)
                         SELECT a.h, co.CompanyTitle AS c, SUM(a.q) AS q FROM a " . CO_APPLY . "
                         GROUP BY a.h, co.CompanyTitle ORDER BY a.h");
    $st->execute([':d' => $d, ':d2' => $d] + $idP);
    $tot = []; $co = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
        $h = (int)$r['h']; $q = (int)$r['q'];
        $tot[$h] = ($tot[$h] ?? 0) + $q;
        $co[] = ['h' => $h, 'c' => trim((string)($r['c'] ?? '')) ?: NO_CO, 'q' => $q];
    }
    ksort($tot);
    $o = [];
    foreach ($tot as $h => $q) $o[] = ['h' => $h, 'q' => $q];
    return ['hourly' => $o, 'hourlyCo' => $co];
}

$lines = []; $latest = '';
$snapVariant = implode('|', [$start, $end, $focusReq, $only, $cmin, $cmax]);

foreach (LINES as $id => $cfg) {
    if ($lineOnly && $id !== $lineOnly) continue;
    if (!auth_line_ok((int)$id)) continue;   // a line-limited login (lib/auth.php)
    $row = ['line' => (string)$id, 'name' => $cfg['name'], 'ok' => true, 'error' => null,
            'daily' => [], 'hourly' => [], 'dailyCo' => [], 'hourlyCo' => [], 'dhm' => [], 'mmCo' => (object)[], 'models' => [], 'rejections' => ['total' => 0, 'top' => []]];
    $tl = microtime(true);
    try {
        // a backup that stops before the period has nothing of it: ask the line itself (lib/backup.php)
        $pdo = snap_alive(fn () => connect_line($id, !backup_stale_for((int)$id, $start)), 25);   // a slow line gives up after 25 s: its last good answer (snapshot) or "not answering" is shown instead of a screen that waits
        $row['backup'] = backup_row_info(backup_used(), $id); // null = live line server
        // backup copy older than the last live answer of this line for the same period: show that answer
        if ($row['backup'] && ($snap = snap_row_if_newer('all', $id, $snapVariant, $row['backup']))) { $lines[] = $snap; continue; }

        if ($only === 'hourly') {
            $row = array_merge($row, hourly_for($pdo, $focusReq ?: $end, (string)$id));
            $lines[] = $row; continue;
        }

        [$idSql, $idP] = scan_id_sql(with_scan_ids($pdo, ['startDate' => $start, 'endDate' => $end], (string)$id));

        // 1) quantity per day × clock hour × model, with the model's company. From it: daily totals, dailyCo and
        //    dhm [[date, hour, mmId, qty], …] + mmCo {mmId: company}, which the Main view uses for the model-wise day target
        //    (hour by hour, like the line page) and the ₹ loss per line and day.
        $st = $pdo->prepare("WITH a AS (SELECT CAST(s.ScanDate AS DATE) AS d, DATEPART(hour, s.ScanDate) AS h, s.MMId, COUNT(*) AS q
                             FROM dbo.ScanStatus s WHERE " . VALID . " AND " . IN_RANGE . $idSql . "
                             GROUP BY CAST(s.ScanDate AS DATE), DATEPART(hour, s.ScanDate), s.MMId)
                             SELECT CONVERT(char(10), a.d, 23) AS d, a.h, a.MMId AS m, co.CompanyTitle AS c, a.q FROM a " . CO_APPLY . "
                             ORDER BY a.d, a.h");
        $st->execute([':start' => $start, ':end' => $end] + $idP);
        $dm = []; $dco = []; $row['dhm'] = []; $row['mmCo'] = [];
        while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
            $d = $r['d']; $q = (int)$r['q']; $c = trim((string)($r['c'] ?? '')) ?: NO_CO; $m = (int)$r['m'];
            if (!isset($dm[$d])) $dm[$d] = ['d' => $d, 'q' => 0, 'rej' => 0];
            $dm[$d]['q'] += $q;
            $dco[$d . "\t" . $c] = ($dco[$d . "\t" . $c] ?? 0) + $q;
            $row['dhm'][] = [$d, (int)$r['h'], $m, $q];
            $row['mmCo'][(string)$m] = $c;
            if ($d > $latest) $latest = $d;
        }
        foreach ($dco as $k => $q) { [$d, $c] = explode("\t", $k, 2); $row['dailyCo'][] = ['d' => $d, 'c' => $c, 'q' => $q]; }
        $row['mmCo'] = (object)$row['mmCo'];

        // 2) rejections (table may be missing on a line -> ignored)
        try {
            $ft = FALSE_SCAN_TABLE;
            $st = $pdo->prepare("SELECT CONVERT(char(10), CAST(ErrorDateTime AS DATE), 23) AS d, COUNT(*) AS n FROM $ft
                                 WHERE ErrorDateTime >= CAST(:start AS DATE) AND ErrorDateTime < DATEADD(DAY, 1, CAST(:end AS DATE))
                                 GROUP BY CAST(ErrorDateTime AS DATE)");
            $st->execute([':start' => $start, ':end' => $end]);
            while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
                $d = $r['d'];
                if (!isset($dm[$d])) $dm[$d] = ['d' => $d, 'q' => 0, 'rej' => 0];
                $dm[$d]['rej'] = (int)$r['n']; $row['rejections']['total'] += (int)$r['n'];
            }
            $st = $pdo->prepare("SELECT TOP 5 ISNULL(NULLIF(LTRIM(RTRIM(ErrorMessage)), ''), '(no message)') AS msg, COUNT(*) AS n FROM $ft
                                 WHERE ErrorDateTime >= CAST(:start AS DATE) AND ErrorDateTime < DATEADD(DAY, 1, CAST(:end AS DATE))
                                 GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(ErrorMessage)), ''), '(no message)') ORDER BY n DESC");
            $st->execute([':start' => $start, ':end' => $end]);
            while ($r = $st->fetch(PDO::FETCH_ASSOC)) $row['rejections']['top'][] = ['msg' => $r['msg'], 'n' => (int)$r['n']];
        } catch (Throwable $e) { /* no false-scan table on this line */ }

        ksort($dm);
        $row['daily'] = array_values($dm);

        // 3) per model: quantity + cycle statistics inside the valid window
        $lo = sprintf('%.3F', $cmin); $hi = sprintf('%.3F', $cmax);
        $sql = "
WITH x AS (
    SELECT s.MMId, s.ScanDate, CAST(s.ScanDate AS DATE) AS d,
           LAG(s.ScanDate) OVER (PARTITION BY s.MMId, CAST(s.ScanDate AS DATE) ORDER BY s.ScanDate, s.ScanId) AS prevDate
    FROM dbo.ScanStatus s
    WHERE " . VALID . " AND " . IN_RANGE . $idSql . "
), g AS (
    SELECT MMId, d, CASE WHEN prevDate IS NULL THEN NULL
                         ELSE CAST(DATEDIFF(millisecond, prevDate, ScanDate) AS float) / 1000.0 END AS gap
    FROM x
)
SELECT g.MMId, m.Model, m.ModelCode, c.CompanyTitle,
       COUNT(*) AS qty, COUNT(DISTINCT g.d) AS days,
       SUM(CASE WHEN g.gap >= $lo AND g.gap <= $hi THEN 1 ELSE 0 END) AS validCycles,
       AVG(CASE WHEN g.gap >= $lo AND g.gap <= $hi THEN g.gap END) AS avgCycle,
       SUM(CASE WHEN g.gap > $hi THEN 1 ELSE 0 END) AS aboveMax
FROM g
INNER JOIN dbo.Tab_ModelMaster m ON m.MMId = g.MMId
INNER JOIN dbo.Tab_CompanyMaster c ON c.CompanyId = m.CompanyId
GROUP BY g.MMId, m.Model, m.ModelCode, c.CompanyTitle
ORDER BY qty DESC";
        $st = $pdo->prepare($sql);
        $st->execute([':start' => $start, ':end' => $end] + $idP);
        while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
            $row['models'][] = [
                'mmId' => (int)$r['MMId'], 'model' => $r['Model'], 'modelCode' => $r['ModelCode'], 'company' => $r['CompanyTitle'],
                'qty' => (int)$r['qty'], 'days' => (int)$r['days'], 'validCycles' => (int)$r['validCycles'],
                'avgCycle' => $r['avgCycle'] === null ? null : round((float)$r['avgCycle'], 2), 'aboveMax' => (int)$r['aboveMax'],
            ];
        }
    } catch (Throwable $e) {
        $row['ok'] = false; $row['error'] = $e->getMessage();
        cache_note_error("line $id not answering", $row['error']);   // 26-11-2026: the reason is kept (ems_api_errors.log)
        // line offline and no SQL backup: the last good answer of this line for the same period (lib/snapshot.php)
        if (snap_is_offline_error($row['error'])) {
            if ($snap = snap_row('all', $id, $snapVariant)) { $snap['offlineError'] = $row['error']; $row = $snap; }
        }
    }
    $lines[] = $row;
}

$focus = $focusReq ?: ($latest ?: $end);
if ($only !== 'hourly') {
    foreach ($lines as &$ln) {
        if (!$ln['ok'] || !empty($ln['snapshot'])) continue;
        try { $ln = array_merge($ln, hourly_for(connect_line((int)$ln['line']), $focus, (string)$ln['line'])); } catch (Throwable $e) { /* leave empty */ }
    }
    unset($ln);
}
// keep the good live rows: shown for this period if the line goes offline later
foreach ($lines as $ln) if (empty($ln['snapshot'])) snap_save_row('all', (int)$ln['line'], $ln, $snapVariant);

echo json_encode(['range' => ['start' => $start, 'end' => $end], 'focus' => $focus, 'cmin' => $cmin, 'cmax' => $cmax,
                  'generatedAt' => ems_iso(), 'lines' => $lines], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
