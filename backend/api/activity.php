<?php
/**
 * activity.php (20-11-2026) — the activity log for the admin (lib/activity.php): who logged in, who tried, who logged
 * out, which pages a login opened and every change it made.
 *
 *   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD[&user=ID][&ev=login,login_fail,logout,view,change][&q=text][&refused=1][&limit=N]
 *        (admin) → { from, to, events: [newest first], total, truncated, users: [per login over the whole period] }
 *   POST { action:'view', page, title, line }   a page opened by this login (not a TV screen)
 *   POST { action:'download', report, file, range, line, kind }   a report downloaded (25-11-2026)
 *   POST { action:'error', page, title, message, stack, build }   a page crashed in the browser (25-11-2026)
 *   POST { action:'logout' }                    this login ends on this PC (sent with its key just before it is dropped)
 * Kept in backend/data/activity (one file a month) — no database is used.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
$me = auth_guard('view', true);
require_once __DIR__ . '/../lib/activity.php';

$body = store_begin();
if ($body === null) {
    if (!$me || ($me['role'] ?? '') !== 'admin') store_fail(403, 'Only the admin can see the activity log.');
    $ymd = '/^\d{4}-\d{2}-\d{2}$/';
    $to = (string)($_GET['to'] ?? substr(activity_now(), 0, 10));
    $from = (string)($_GET['from'] ?? $to);
    if (!preg_match($ymd, $from) || !preg_match($ymd, $to) || $from > $to) store_fail(400, 'from and to must be dates (YYYY-MM-DD), from not after to');
    if ((strtotime($to) - strtotime($from)) / 86400 > 366) store_fail(400, 'At most one year at a time');
    $ev = array_values(array_filter(explode(',', (string)($_GET['ev'] ?? ''))));
    $limit = max(50, min(5000, (int)($_GET['limit'] ?? 2000)));
    $r = activity_read($from, $to, ['user' => (string)($_GET['user'] ?? ''), 'ev' => $ev, 'q' => (string)($_GET['q'] ?? ''), 'refused' => !empty($_GET['refused'])], $limit);
    echo json_encode(['from' => $from, 'to' => $to] + $r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
if (!$me) store_fail(401, 'Please log in.');
if (($me['role'] ?? '') === 'tv') { echo json_encode(['ok' => true, 'skipped' => 'tv']); exit; }   // TV screens are not logged
$action = (string)($body['action'] ?? '');
if ($action === 'view') {
    $page = (string)($body['page'] ?? '');
    if (!preg_match('/^[a-z]{2,20}$/', $page)) store_fail(400, 'page must be a page id');
    $e = ['ev' => 'view'] + activity_who($me) + ['page' => $page, 'title' => activity_txt($body['title'] ?? '', 60)];
    $line = (string)($body['line'] ?? '');
    if (preg_match('/^(all|\d{1,2})$/', $line)) $e['line'] = $line;
    activity_write($e + activity_client());
    echo json_encode(['ok' => true]);
    exit;
}
// 25-11-2026: a report / Excel / screen downloaded — which one, of which days and lines (Setup → Activity log);
// many downloads by one login in 10 minutes → a security alert for the admin
if ($action === 'download') {
    $e = ['ev' => 'download'] + activity_who($me) + ['title' => activity_txt($body['report'] ?? '', 80), 'file' => activity_txt($body['file'] ?? '', 120),
        'range' => activity_txt($body['range'] ?? '', 60), 'kind' => activity_txt($body['kind'] ?? 'excel', 12)];
    $line = (string)($body['line'] ?? '');
    if (preg_match('/^(all|\d{1,2}([ ,&]+\d{1,2})*)$/', $line)) $e['line'] = $line;
    activity_write($e + activity_client());
    try {
        $f = sys_get_temp_dir() . '/ems_dl_' . md5((string)($me['user'] ?? '')) . '_' . intdiv(time(), 600);
        $n = (int)@file_get_contents($f) + 1; @file_put_contents($f, (string)$n, LOCK_EX);
        if ($n === 15) alert_raise('bulk-download', "$n downloads in 10 minutes · last: " . ($e['title'] ?: $e['file']) . ($e['range'] ? " ({$e['range']})" : ''), (string)($me['user'] ?? ''));
    } catch (Throwable $x) { /* never stops the download note */ }
    echo json_encode(['ok' => true]);
    exit;
}
// 25-11-2026: a page that crashed in the browser — the message and where, so the admin (Setup → Activity log → Page errors)
// sees the exact error without asking for a screenshot. At most 20 notes per login in 10 minutes.
if ($action === 'error') {
    $page = (string)($body['page'] ?? '');
    if (!preg_match('/^[a-z]{0,20}$/', $page)) $page = '';
    $f = sys_get_temp_dir() . '/ems_err_' . md5((string)($me['user'] ?? '')) . '_' . intdiv(time(), 600);
    $n = (int)@file_get_contents($f) + 1; @file_put_contents($f, (string)$n, LOCK_EX);
    if ($n > 20) { echo json_encode(['ok' => true, 'skipped' => 'many']); exit; }
    $stack = array_slice(array_values(array_filter(array_map('trim', explode("\n", (string)($body['stack'] ?? ''))))), 0, 6);
    $e = ['ev' => 'error'] + activity_who($me) + ['page' => $page, 'title' => activity_txt($body['title'] ?? '', 60), 'error' => activity_txt($body['message'] ?? '', 200),
        'build' => activity_txt($body['build'] ?? '', 20), 'what' => array_map(fn($x) => activity_txt($x, 160), $stack)];
    activity_write($e + activity_client());
    echo json_encode(['ok' => true]);
    exit;
}
if ($action === 'logout') {
    activity_write(['ev' => 'logout'] + activity_who($me) + activity_client());
    echo json_encode(['ok' => true]);
    exit;
}
store_fail(400, "action must be 'view', 'download', 'error' or 'logout'");
