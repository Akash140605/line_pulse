<?php
/**
 * Activity log (20-11-2026): who logged in (and who tried), who logged out, which pages a login opened and every change a
 * login made — what, where, when and from which PC — for the admin (Setup → Activity log, api/activity.php).
 *
 * One line of JSON per event in data/activity/YYYY-MM.jsonl, appended under a lock. Only this data folder is written:
 * no database is opened here (the time is this PC's clock + the difference to the database clock that lib/clock.php
 * keeps on disk, and the "before / after" of a change is read from the JSON copies of the stores). Passwords, password
 * hashes and login keys are never written. TV screens are not logged (their login is left exactly as it is).
 *
 *   ev      login | login_fail | logout | view | change
 *   time    'Y-m-d H:i:s' (India time, as the database clock)
 *   user, name, role   the login (a failed login: the user ID only when such a login exists)
 *   ip, ua             the PC and its browser
 *   change: api, action, status (HTTP: 400 and more = refused / not saved), error, what [short lines], lines, dates
 *   view:   page, title, line            login_fail: why (wrong | unknown | off | throttled)
 */
declare(strict_types=1);
require_once __DIR__ . '/store.php';

const ACTIVITY_MAX_WHAT = 14;        // lines of "what" kept per change
const ACTIVITY_MAX_TEXT = 240;       // characters per line
const ACTIVITY_SKIP = ['activity.php'];   // its own notes (page opened, log out) are written by itself
const ACTIVITY_EVENTS = ['login', 'login_fail', 'logout', 'view', 'change', 'download', 'error'];   // error: a page that crashed in the browser (25-11-2026)

function activity_dir(): string { return store_dir() . '/activity'; }

/** India time of the database clock — from the difference lib/clock.php saved on disk (never asks the database) */
function activity_now(?int $at = null): string
{
    $off = 0;
    $f = function_exists('ems_clock_file') ? ems_clock_file() : ($GLOBALS['EMS_CLOCK_FILE'] ?? sys_get_temp_dir() . '/ems_clock_offset.json');   // same file as lib/clock.php
    $j = is_file($f) ? json_decode((string)@file_get_contents($f), true) : null;
    if (is_array($j) && isset($j['off']) && abs((int)$j['off']) <= 2 * 3600) $off = (int)$j['off'];
    $d = new DateTime('@' . (($at ?? time()) + $off));
    $d->setTimezone(new DateTimeZone('Asia/Kolkata'));
    return $d->format('Y-m-d H:i:s');
}

/** text for the log: no control characters or tags, trimmed, at most $max characters */
function activity_txt($v, int $max = ACTIVITY_MAX_TEXT): string
{
    if (is_array($v) || is_object($v)) return '';
    $s = trim(preg_replace('/\s+/u', ' ', strip_tags((string)$v)) ?? '');
    $s = preg_replace('/[\x00-\x1F\x7F]/u', '', $s) ?? '';
    return mb_strlen($s) > $max ? mb_substr($s, 0, $max - 1) . '…' : $s;
}

function activity_dmy(string $d): string { return preg_match('/^(\d{4})-(\d\d)-(\d\d)$/', $d, $m) ? "$m[3]-$m[2]-$m[1]" : activity_txt($d, 20); }
function activity_num($v): string { return is_numeric($v) ? rtrim(rtrim(number_format((float)$v, 2, '.', ''), '0'), '.') : '—'; }

/** the PC and browser of this request */
function activity_client(): array
{
    return ['ip' => activity_txt(function_exists('store_client_ip') ? store_client_ip() : ($_SERVER['REMOTE_ADDR'] ?? ''), 45) . (function_exists('store_remote') && store_remote() ? ' (remote)' : ''), 'ua' => activity_txt($_SERVER['HTTP_USER_AGENT'] ?? '', 200)];
}

/** the login of an event: {user, name, role} ([] = no login) */
function activity_who(?array $me): array
{
    if (!$me) return [];
    return ['user' => activity_txt($me['user'] ?? '', 40), 'name' => activity_txt($me['display'] ?? ($me['user'] ?? ''), 60), 'role' => activity_txt($me['role'] ?? '', 20)];
}

/** one event at the end of this month's file; never stops the work it records */
function activity_write(array $e): void
{
    try {
        if (in_array($e['role'] ?? '', ['tv'], true)) return;                     // TV screens are not logged
        $e = ['time' => activity_now()] + $e;
        if (isset($e['what'])) {
            $e['what'] = array_values(array_slice(array_filter(array_map(fn($w) => activity_txt($w), (array)$e['what']), fn($w) => $w !== ''), 0, ACTIVITY_MAX_WHAT));
            if (!$e['what']) unset($e['what']);
        }
        foreach (['lines', 'dates'] as $k) if (isset($e[$k])) { $e[$k] = array_values(array_slice(array_unique(array_map('strval', (array)$e[$k])), 0, 31)); if (!$e[$k]) unset($e[$k]); }
        $dir = activity_dir();
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) return;
        $line = json_encode($e, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if (!is_string($line)) return;
        @file_put_contents($dir . '/' . substr($e['time'], 0, 7) . '.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
    } catch (Throwable $x) { /* the log never breaks a login or a save */ }
}

/* ───────────── logins ───────────── */

/** a login that worked (not a TV screen) */
function activity_login(string $user, array $u): void
{
    if (($u['role'] ?? '') === 'tv') return;
    activity_write(['ev' => 'login'] + activity_who(['user' => $user, 'display' => $u['display'] ?? $user, 'role' => $u['role'] ?? '']) + activity_client());
}

/**
 * a login that did not work: why = wrong (password) | unknown (no such user ID) | off (switched off) | throttled.
 * The typed user ID is written only when such a login exists (a password typed into the user field is never kept).
 */
function activity_login_fail(string $typed, string $why, ?array $u): void
{
    if ($u && ($u['role'] ?? '') === 'tv') return;
    $who = $u ? activity_who(['user' => strtolower(trim($typed)), 'display' => $u['display'] ?? $typed, 'role' => $u['role'] ?? '']) : [];
    activity_write(['ev' => 'login_fail', 'why' => $u ? $why : ($why === 'throttled' ? 'throttled' : 'unknown')] + $who + activity_client());
}

/* ───────────── changes ───────────── */

/**
 * Watches one change (POST) of a login: the stores it touches are read before it runs, and when the answer is done the
 * event is written with its status — a refused or failed change too. Called by auth_guard (every API) and by auth.php.
 */
function activity_watch(?array $me, ?array $body = null): void
{
    static $on = false;
    if ($on || PHP_SAPI === 'cli') return;
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') return;
    $script = basename((string)($_SERVER['SCRIPT_NAME'] ?? ''));
    if ($script === '' || in_array($script, ACTIVITY_SKIP, true)) return;
    if ($me && ($me['role'] ?? '') === 'tv') return;
    $on = true;
    try {
        if ($body === null && $script !== 'files.php' && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) <= 2_500_000) {
            $j = json_decode((string)@file_get_contents('php://input'), true);
            $body = is_array($j) ? $j : null;
        }
        $line = isset($_GET['line']) && preg_match('/^\d{1,2}$/', (string)$_GET['line']) ? (string)(int)$_GET['line'] : null;
        $before = $body ? activity_before($script, $body, $line) : [];
    } catch (Throwable $x) { $before = []; $line = null; }
    register_shutdown_function(function () use ($me, $script, $body, $line, $before) {
        try {
            $status = (int)(http_response_code() ?: 200);
            $b = $body ?? (is_array($GLOBALS['body'] ?? null) ? $GLOBALS['body'] : []);
            $action = activity_txt($b['action'] ?? '', 30);
            $ok = $status < 400;
            $sum = activity_what($script, $action, $b, $before, $line, $ok);
            $e = ['ev' => 'change'] + activity_who($me) + ['api' => $script, 'action' => $action, 'status' => $status] + $sum;
            if (!$ok) $e['error'] = activity_txt($GLOBALS['EMS_FAIL_MSG'] ?? '', 200);
            activity_write($e + activity_client());
        } catch (Throwable $x) { /* never */ }
    });
}

/** what a change is about to replace — only the rows it touches (JSON copies of the stores; no database) */
function activity_before(string $script, array $b, ?string $line): array
{
    $action = (string)($b['action'] ?? '');
    switch ($script) {
        case 'ole.php':
            if ($action === 'save') return ['rows' => activity_pick(store_file_read('ole_hourly'), 'entries', activity_ole_keys($b))];
            if ($action === 'setup') return ['rows' => activity_pick(store_file_read('ole_setup'), 'setups', [activity_dl($b)])];
            if ($action === 'day') return ['rows' => activity_pick(store_file_read('ole_days'), 'days', [activity_dl($b)])];
            if ($action === 'kpi') return ['rows' => activity_pick(store_file_read('ole_kpi'), 'rows', [activity_dl($b)])];
            if ($action === 'rca') return ['rows' => activity_rca_pick(store_file_read('ole_rca')['items'] ?? [], (array)($b['items'] ?? []))];
            if ($action === 'reasons') return ['reasons' => store_file_read('ole_reasons')];
            return [];
        case 'line_settings.php': return $line ? ['ls' => activity_ls_part(store_file_read('line_settings'), $line)] : [];
        case 'model_master.php': return ['master' => activity_master_index(store_file_read('model_master'))];
        case 'ui_settings.php': return ['ui' => store_file_read('ui_settings')];
        case 'losses.php': return $line ? ['loss' => activity_loss_index(store_file_read('losses_line' . $line))] : [];
        case 'auth.php': return ['users' => activity_user_index(store_file_read('users'))];
    }
    return [];
}

/** the same rows after the change (read again only when it was saved) */
function activity_after(string $script, array $b, ?string $line): array
{
    return activity_before($script, $b, $line);
}

function activity_dl(array $b): string { return (string)($b['date'] ?? '') . '|' . (int)($b['line'] ?? 0); }
function activity_ole_keys(array $b): array
{
    $k = [];
    foreach (array_slice((array)($b['entries'] ?? []), 0, 500) as $e) { $e = (array)$e; $k[] = (string)($e['date'] ?? '') . '|' . (int)($e['line'] ?? 0) . '|' . (int)($e['hour'] ?? -1); }
    return array_values(array_unique($k));
}
function activity_pick(array $doc, string $field, array $keys): array
{
    $all = (array)($doc[$field] ?? []); $out = [];
    foreach ($keys as $k) $out[$k] = isset($all[$k]) ? (array)$all[$k] : null;
    return $out;
}
function activity_rca_pick(array $items, array $in): array
{
    $out = [];
    foreach (array_slice($in, 0, 100) as $it) {
        $it = (array)$it;
        $k = (string)($it['date'] ?? '') . '|' . (int)($it['line'] ?? 0) . '|' . (string)($it['kind'] ?? '') . '|' . strtolower(trim((string)($it['reason'] ?? '')));
        $out[$k] = null;
        foreach ($items as $ik => $r) {
            $r = (array)$r;
            if (($r['date'] ?? '') . '|' . (int)($r['line'] ?? 0) . '|' . ($r['kind'] ?? '') . '|' . strtolower((string)($r['reason'] ?? '')) === $k) $out[$k] = $r;
        }
    }
    return $out;
}
function activity_ls_part(array $d, string $L): array
{
    return ['shift' => $d['shift'][$L] ?? null, 'shiftAll' => $d['shift']['default'] ?? null, 'targets' => (array)($d['targets'][$L] ?? []), 'money' => $d['money'][$L] ?? null];
}
function activity_master_index(array $d): array
{
    $out = [];
    foreach ((array)($d['rows'] ?? []) as $r) {
        $r = (array)$r;
        $k = mb_strtoupper(trim((string)($r['company'] ?? '')) . '|' . preg_replace('/\s+/', '', (string)($r['model'] ?? '')));
        $out[$k] = ['company' => (string)($r['company'] ?? ''), 'model' => (string)($r['model'] ?? ''), 'cycle' => $r['cycle'] ?? null, 'lines' => array_map('intval', (array)($r['lines'] ?? [])), 'code' => (string)($r['code'] ?? '')];
    }
    return $out;
}
function activity_loss_index(array $d): array
{
    $out = [];
    foreach ((array)($d['entries'] ?? []) as $e) { $e = (array)$e; if (isset($e['id'])) $out[(string)$e['id']] = $e; }
    return $out;
}
/** the logins without anything secret (no hash, no key) */
function activity_user_index(array $d): array
{
    $out = [];
    foreach ((array)($d['users'] ?? []) as $name => $u) {
        $u = (array)$u;
        $out[(string)$name] = ['role' => (string)($u['role'] ?? ''), 'display' => (string)($u['display'] ?? $name), 'lines' => array_map('intval', (array)($u['lines'] ?? [])),
            'pages' => array_values(array_map('strval', (array)($u['pages'] ?? []))), 'oleEdit' => !empty($u['oleEdit']), 'dept' => (string)($u['dept'] ?? ''),
            'active' => !array_key_exists('active', $u) || !empty($u['active']), 'v' => (int)($u['v'] ?? 0)];
    }
    return ['users' => $out, 'enforce' => !empty($d['enforce'])];
}

/* ───────────── what a change did, in short lines ───────────── */

function activity_lines_text(array $l): string { $l = array_values(array_filter(array_map('intval', $l))); return $l ? 'Line ' . implode(', ', $l) : 'all lines'; }
function activity_hour(int $h): string { return sprintf('%02d:00', $h); }

/** one OLE hour in words: planned stops, losses, rejection, rework, note */
function activity_ole_text(?array $e): string
{
    if (!$e) return 'nothing';
    $p = [];
    foreach ((array)($e['stops'] ?? []) as $r) { $r = (array)$r; $p[] = 'planned stop ' . activity_txt($r['reason'] ?? '', 50) . ' ' . activity_num($r['min'] ?? null) . ' min' . (($r['model'] ?? '') !== '' ? ' (' . activity_txt($r['model'], 40) . ')' : ''); }
    foreach ((array)($e['losses'] ?? []) as $r) { $r = (array)$r; $p[] = 'loss ' . activity_txt($r['reason'] ?? '', 50) . ' ' . activity_num($r['min'] ?? null) . ' min' . (($r['model'] ?? '') !== '' ? ' (' . activity_txt($r['model'], 40) . ')' : ''); }
    foreach ((array)($e['rejects'] ?? []) as $r) { $r = (array)$r; $p[] = 'rejection ' . trim(activity_txt($r['station'] ?? '', 30) . ' · ' . activity_txt($r['reason'] ?? '', 50), ' ·') . ' ×' . activity_num($r['qty'] ?? null) . (($r['model'] ?? '') !== '' ? ' (' . activity_txt($r['model'], 40) . ')' : ''); }
    foreach ((array)($e['rework'] ?? []) as $r) { $r = (array)$r; $p[] = 'rework ' . trim(activity_txt($r['station'] ?? '', 30) . ' · ' . activity_txt($r['reason'] ?? '', 50), ' ·') . ' ×' . activity_num($r['qty'] ?? null) . (($r['model'] ?? '') !== '' ? ' (' . activity_txt($r['model'], 40) . ')' : ''); }
    if (!empty($e['noLoss'])) $p[] = 'no loss';
    if (trim((string)($e['note'] ?? '')) !== '') $p[] = 'note "' . activity_txt($e['note'], 60) . '"';
    return $p ? implode('; ', $p) : 'nothing';
}

function activity_setup_text(?array $s): string
{
    if (!$s) return 'nothing';
    $t = 'M/P ' . activity_num($s['mp'] ?? null) . ', shift ' . activity_txt($s['start'] ?? '', 5) . '–' . activity_txt($s['end'] ?? '', 5);
    if (($s['lunchStart'] ?? '') !== '') $t .= ', lunch ' . activity_txt($s['lunchStart'], 5) . '–' . activity_txt($s['lunchEnd'] ?? '', 5);
    $n = count((array)($s['breaks'] ?? []));
    if ($n) $t .= ", $n break" . ($n > 1 ? 's' : '');
    return $t;
}

function activity_kpi_text(?array $r): string
{
    if (!$r) return 'nothing';
    $names = ['osd' => 'OS&D ₹', 'bom' => 'BOM ₹', 'otPlan' => 'OT planned', 'otUnplan' => 'OT unplanned', 'wo7' => 'WO >7 days', 'trc3' => 'TRC ₹', 'wip7' => 'WIP ₹', 'dismantle' => 'dismantled'];
    $p = [];
    foreach ($names as $k => $n) if (isset($r[$k]) && $r[$k] !== '' && $r[$k] !== null) $p[] = "$n " . activity_num($r[$k]);
    if (trim((string)($r['note'] ?? '')) !== '') $p[] = 'note "' . activity_txt($r['note'], 60) . '"';
    return $p ? implode(', ', $p) : 'nothing';
}

function activity_rca_text(?array $r): string
{
    if (!$r) return 'nothing';
    $t = ucfirst((string)($r['status'] ?? 'submitted'));
    if (($r['rootCause'] ?? '') !== '') $t .= ' — root cause "' . activity_txt($r['rootCause'], 70) . '"';
    if (($r['action'] ?? '') !== '') $t .= ', action "' . activity_txt($r['action'], 60) . '"';
    if (($r['owner'] ?? '') !== '') $t .= ', owner ' . activity_txt($r['owner'], 30);
    if (($r['targetDate'] ?? '') !== '') $t .= ', target ' . activity_dmy((string)$r['targetDate']);
    if (is_array($r['evidence'] ?? null) && $r['evidence']) $t .= ', ' . count($r['evidence']) . ' evidence file' . (count($r['evidence']) > 1 ? 's' : '');
    return $t;
}

/** "before → now" of one row; same text before and after: unchanged */
function activity_change(string $head, string $old, string $new, bool $existed): string
{
    if (!$existed) return "$head: $new";
    if ($old === $new) return "$head: $new (no change)";
    if ($new === 'nothing') return "$head: cleared (was: $old)";
    return "$head: $new (was: $old)";
}

/**
 * The short lines of one change: { what: [...], lines: [...], dates: [...] }.
 * Saved ($ok): before → after of the rows it touched; refused or failed: what was sent.
 */
function activity_what(string $script, string $action, array $b, array $before, ?string $line, bool $ok): array
{
    $what = []; $lines = []; $dates = [];
    $after = $ok && $before ? activity_after($script, $b, $line) : [];
    try {
        switch ($script) {
            case 'ole.php':
                if ($action === 'save') {
                    foreach (array_slice((array)($b['entries'] ?? []), 0, 60) as $e) {
                        $e = (array)$e; $d = (string)($e['date'] ?? ''); $l = (int)($e['line'] ?? 0); $h = (int)($e['hour'] ?? -1);
                        $k = "$d|$l|$h"; $lines[] = $l; $dates[] = $d;
                        $head = "Line $l · " . activity_dmy($d) . ' · ' . activity_hour($h);
                        $old = $before['rows'][$k] ?? null;
                        $new = $ok ? ($after['rows'][$k] ?? null) : $e;
                        $what[] = $ok ? activity_change($head, activity_ole_text($old), activity_ole_text($new), $old !== null) : "$head: " . activity_ole_text($e);
                    }
                } elseif (in_array($action, ['setup', 'day', 'kpi'], true)) {
                    $d = (string)($b['date'] ?? ''); $l = (int)($b['line'] ?? 0); $k = "$d|$l"; $lines[] = $l; $dates[] = $d;
                    $head = ['setup' => 'Morning entry', 'day' => 'Whole day', 'kpi' => 'KPI entry'][$action] . " · Line $l · " . activity_dmy($d);
                    $old = $before['rows'][$k] ?? null; $new = $ok ? ($after['rows'][$k] ?? null) : $b;
                    if ($action === 'setup') $txt = fn($r) => !empty($b['clear']) && $r === $b ? 'cleared' : activity_setup_text($r);
                    elseif ($action === 'day') $txt = fn($r) => $r && (!array_key_exists('off', $r) || !empty($r['off'])) ? 'line off all day — ' . activity_txt($r['reason'] ?? '', 40) . (($r['note'] ?? '') !== '' ? ' ("' . activity_txt($r['note'], 50) . '")' : '') : 'line working (not off)';
                    else $txt = fn($r) => activity_kpi_text($r);
                    $what[] = $ok ? activity_change($head, $txt($old), $txt($new), $old !== null) : "$head: " . $txt($b);
                } elseif ($action === 'rca') {
                    foreach (array_slice((array)($b['items'] ?? []), 0, 30) as $it) {
                        $it = (array)$it; $d = (string)($it['date'] ?? ''); $l = (int)($it['line'] ?? 0); $lines[] = $l; $dates[] = $d;
                        $k = "$d|$l|" . ($it['kind'] ?? '') . '|' . strtolower(trim((string)($it['reason'] ?? '')));
                        $kind = ['stop' => 'planned stop', 'loss' => 'loss', 'reject' => 'rejection', 'rework' => 'rework'][$it['kind'] ?? ''] ?? (string)($it['kind'] ?? '');
                        $head = "RCA · Line $l · " . activity_dmy($d) . " · $kind " . activity_txt($it['reason'] ?? '', 50);
                        $old = $before['rows'][$k] ?? null; $new = $ok ? ($after['rows'][$k] ?? null) : $it;
                        $what[] = $ok ? activity_change($head, activity_rca_text($old), activity_rca_text($new), $old !== null) : "$head: " . activity_rca_text($it);
                    }
                } elseif ($action === 'reasons') {
                    $names = ['stop' => 'planned stops', 'loss' => 'losses', 'reject' => 'rejection', 'rework' => 'rework', 'station' => 'quality stations'];
                    $old = (array)($before['reasons'] ?? []); $new = $ok ? (array)($after['reasons'] ?? []) : (array)($b['reasons'] ?? []);
                    foreach ($names as $k => $n) {
                        $o = array_map(fn($r) => (string)(((array)$r)['reason'] ?? ''), (array)($old[$k] ?? [])); $w = array_map(fn($r) => (string)(((array)$r)['reason'] ?? ''), (array)($new[$k] ?? []));
                        $add = array_values(array_diff($w, $o)); $del = array_values(array_diff($o, $w));
                        if ($add || $del || !$old) $what[] = "Reason list $n: " . count($w) . ' reasons' . ($add ? '; added ' . implode(', ', array_slice($add, 0, 6)) . (count($add) > 6 ? ' …' : '') : '') . ($del && $old ? '; removed ' . implode(', ', array_slice($del, 0, 6)) . (count($del) > 6 ? ' …' : '') : '');
                    }
                    if (!$what) $what[] = 'Reason lists saved (no reason added or removed)';
                }
                break;

            case 'line_settings.php':
                $L = $line ?? '?'; $lines[] = $L;
                $o = $before['ls'] ?? []; $n = $after['ls'] ?? [];
                $shiftTxt = fn($s) => $s ? activity_txt($s['start'] ?? '', 5) . '–' . activity_txt($s['end'] ?? '', 5) . (($s['lunchStart'] ?? null) ? ', lunch ' . activity_txt($s['lunchStart'], 5) . '–' . activity_txt($s['lunchEnd'] ?? '', 5) : '') : 'standard';
                if ($action === 'shift') {
                    $all = !empty($b['allLines']);
                    $new = $ok ? ($all ? ($n['shiftAll'] ?? null) : ($n['shift'] ?? null)) : (array)($b['shift'] ?? []);
                    $what[] = activity_change('Shift · ' . ($all ? 'every line' : "Line $L"), $shiftTxt($o['shift'] ?? ($o['shiftAll'] ?? null)), $shiftTxt($new), $ok);
                } elseif ($action === 'target' || $action === 'targets') {
                    $items = $action === 'target' ? [$b] : (array)($b['items'] ?? []);
                    foreach (array_slice($items, 0, 40) as $t) {
                        $t = (array)$t; $mm = (string)($t['mmId'] ?? '');
                        $name = activity_txt(($t['model'] ?? '') !== '' ? $t['model'] : "#$mm", 50) . (($t['company'] ?? '') !== '' ? ' (' . activity_txt($t['company'], 30) . ')' : '');
                        $ot = $o['targets'][$mm] ?? null; $nt = $ok ? ($n['targets'][$mm] ?? null) : (($t['cycle'] ?? null) === null || $t['cycle'] === '' ? null : $t);
                        $tx = fn($x) => $x ? activity_num($x['cycle'] ?? null) . ' s' . (!empty($x['manual']) ? ' locked' : '') . ((($x['source'] ?? '') === 'master') ? ' from the master' : '') : 'no target';
                        $what[] = activity_change("Target · Line $L · $name", $tx($ot), $tx($nt), $ot !== null || $ok);
                    }
                    if (count($items) > 40) $what[] = '… and ' . (count($items) - 40) . ' more targets';
                } elseif ($action === 'money') {
                    $m = $ok ? ($n['money'] ?? []) : (array)($b['money'] ?? []); $om = $o['money'] ?? null;
                    $tx = fn($x) => $x ? '₹/piece ' . activity_num($x['pcValue'] ?? null) . ', ₹/hour ' . activity_num($x['hourCost'] ?? null) . ', ' . count((array)($x['values'] ?? [])) . ' model values' : 'not set';
                    $what[] = activity_change('₹ rates · ' . (!empty($b['allLines']) ? 'every line' : "Line $L"), $tx($om), $tx($m), $om !== null);
                }
                break;

            case 'model_master.php':
                if (!$ok) { $what[] = 'Model master: ' . count((array)($b['rows'] ?? [])) . ' models sent'; break; }
                $o = (array)($before['master'] ?? []); $n = (array)($after['master'] ?? []);
                $add = array_diff_key($n, $o); $del = array_diff_key($o, $n); $chg = [];
                foreach ($n as $k => $r) {
                    if (!isset($o[$k])) continue;
                    $p = [];
                    if ((string)($o[$k]['cycle'] ?? '') !== (string)($r['cycle'] ?? '')) $p[] = 'cycle ' . activity_num($o[$k]['cycle']) . ' → ' . activity_num($r['cycle']) . ' s';
                    if ($o[$k]['lines'] !== $r['lines']) $p[] = 'lines ' . (implode(', ', $o[$k]['lines']) ?: '—') . ' → ' . (implode(', ', $r['lines']) ?: '—');
                    if ($o[$k]['code'] !== $r['code']) $p[] = 'code ' . ($o[$k]['code'] ?: '—') . ' → ' . ($r['code'] ?: '—');
                    if ($p) $chg[] = activity_txt($r['model'], 50) . ' (' . activity_txt($r['company'], 30) . '): ' . implode(', ', $p);
                }
                $what[] = 'Model master saved: ' . count($n) . ' models — ' . count($add) . ' added, ' . count($del) . ' removed, ' . count($chg) . ' changed';
                foreach (array_slice($chg, 0, 8) as $c) $what[] = $c;
                if ($add) $what[] = 'Added: ' . implode(', ', array_map(fn($r) => activity_txt($r['model'], 40), array_slice(array_values($add), 0, 8))) . (count($add) > 8 ? ' …' : '');
                if ($del) $what[] = 'Removed: ' . implode(', ', array_map(fn($r) => activity_txt($r['model'], 40), array_slice(array_values($del), 0, 8))) . (count($del) > 8 ? ' …' : '');
                break;

            case 'ui_settings.php':
                if ($action === 'reset') { $what[] = 'Setup put back to the standard setup'; break; }
                if (!$ok) { $what[] = 'Setup save tried'; break; }
                $o = (array)($before['ui'] ?? []); $n = (array)($after['ui'] ?? []);
                $names = ['management' => 'Management view', 'admin' => 'Admin view', 'folders' => 'Menu folders', 'brand' => 'Name', 'theme' => 'Theme', 'hpr' => 'Loss ₹ & HPR', 'ole' => 'OLE formulas', 'targetRule' => 'Target methods'];
                $ch = [];
                foreach ($names as $k => $t) if (json_encode($o[$k] ?? null) !== json_encode($n[$k] ?? null)) $ch[] = $t;
                $what[] = $ch ? 'Setup saved: ' . implode(', ', $ch) . ' changed' : 'Setup saved (nothing changed)';
                $or = (array)($o['targetRule'] ?? []); $nr = (array)($n['targetRule'] ?? []);
                foreach ((array)($nr['lines'] ?? []) as $l => $x) {
                    $ox = $or['lines'][$l] ?? null; $x = (array)$x;
                    if (!$ox || ($ox['method'] ?? '') !== ($x['method'] ?? '') || (string)($ox['add'] ?? '') !== (string)($x['add'] ?? '') || (string)($ox['pct'] ?? '') !== (string)($x['pct'] ?? ''))
                        $what[] = "Target method · Line $l: " . ($ox ? ($ox['method'] ?? '?') . ' → ' : '') . ($x['method'] ?? '?') . ' (allowance ' . activity_num($x['add'] ?? null) . ' s' . (($x['method'] ?? '') === 'B' ? ', ' . activity_num($x['pct'] ?? null) . ' %' : '') . ')';
                }
                $pk = fn($p) => (((array)$p)['line'] ?? '') . '|' . (((array)$p)['from'] ?? '') . '|' . (((array)$p)['method'] ?? '');
                $op = array_map($pk, (array)($or['plan'] ?? [])); $np = (array)($nr['plan'] ?? []);
                foreach ($np as $p) { $p = (array)$p; if (!in_array($pk($p), $op, true)) { $what[] = 'Target method by date · Line ' . ($p['line'] ?? '?') . ' from ' . activity_dmy((string)($p['from'] ?? '')) . ': method ' . ($p['method'] ?? '?'); $lines[] = $p['line'] ?? ''; } }
                foreach ((array)($or['plan'] ?? []) as $p) { $p = (array)$p; if (!in_array($pk($p), array_map($pk, $np), true)) $what[] = 'Target method by date removed · Line ' . ($p['line'] ?? '?') . ' from ' . activity_dmy((string)($p['from'] ?? '')); }
                foreach (['management' => 'Management view', 'admin' => 'Admin view'] as $k => $t) {
                    $on = fn($x) => array_values(array_map(fn($p) => (string)(((array)$p)['id'] ?? ''), array_filter((array)(((array)($x[$k] ?? []))['pages'] ?? []), fn($p) => !empty(((array)$p)['on']))));
                    $a = array_diff($on($n), $on($o)); $r = array_diff($on($o), $on($n));
                    if ($a) $what[] = "$t: pages on — " . implode(', ', array_slice($a, 0, 10));
                    if ($r) $what[] = "$t: pages off — " . implode(', ', array_slice($r, 0, 10));
                }
                break;

            case 'losses.php':
                $L = $line ?? '?'; $lines[] = $L;
                $tx = fn($e) => $e ? activity_dmy((string)($e['date'] ?? '')) . ' ' . activity_hour((int)($e['hour'] ?? 0)) . ' · ' . activity_txt($e['reason'] ?? '', 50) . ' ' . activity_num($e['minutes'] ?? null) . ' min' . (($e['dept'] ?? '') !== '' ? ' (' . activity_txt($e['dept'], 30) . ')' : '') : 'nothing';
                if ($action === 'save') { $e = (array)($b['entry'] ?? []); $old = $before['loss'][(string)($e['id'] ?? '')] ?? null; $dates[] = $e['date'] ?? ''; $what[] = activity_change("Loss register · Line $L", $tx($old), $tx($e), $old !== null); }
                elseif ($action === 'delete') { $old = $before['loss'][(string)($b['id'] ?? '')] ?? null; $what[] = "Loss register · Line $L: deleted " . $tx($old); }
                elseif ($action === 'import') $what[] = "Loss register · Line $L: " . count((array)($b['entries'] ?? [])) . ' entries imported';
                break;

            case 'files.php':
                if ($action === 'upload') $what[] = 'RCA evidence file "' . activity_txt($b['name'] ?? '', 80) . '"' . (isset($b['data']) ? ' (' . max(1, (int)round(strlen((string)$b['data']) * 0.75 / 1024)) . ' KB)' : '');
                elseif ($action === 'avatar') $what[] = !empty($b['clear']) ? 'Own picture removed' : (isset($b['preset']) ? 'Own picture: ' . activity_txt($b['preset'], 10) : 'Own picture: a photo');
                break;

            case 'auth.php':
                $u = strtolower(trim((string)($b['user'] ?? '')));
                $o = (array)(($before['users'] ?? [])['users'][$u] ?? []); $nAll = (array)(($after['users'] ?? [])['users'] ?? []); $n = (array)($nAll[$u] ?? []);
                $nm = fn($x, $id) => $id . (($x['display'] ?? '') !== '' && ($x['display'] ?? '') !== $id ? ' (' . activity_txt($x['display'], 40) . ')' : '');
                if ($action === 'password') $what[] = 'Password changed for ' . $nm($o, $u ?: '?');
                elseif ($action === 'userremove' || $action === 'tvremove') $what[] = ($action === 'tvremove' ? 'TV login ' : 'Login ') . $nm($o, $u) . ' removed';
                elseif ($action === 'active') $what[] = 'Login ' . $nm($o, $u) . (!empty($b['on']) ? ' switched on' : ' switched off');
                elseif ($action === 'enforce') $what[] = 'Server protection ' . (!empty($b['on']) ? 'on (every page needs a login)' : 'off');
                elseif ($action === 'tvuser') $what[] = ($o ? 'TV login ' . $u . ': password changed' : 'New TV login ' . $u);
                elseif ($action === 'user') {
                    $src = $ok && $n ? $n : ['display' => (string)($b['display'] ?? ''), 'lines' => array_map('intval', (array)($b['lines'] ?? [])), 'pages' => (array)($b['pages'] ?? []), 'oleEdit' => !empty($b['oleEdit']), 'dept' => (string)($b['dept'] ?? ''), 'active' => !array_key_exists('active', $b) || !empty($b['active'])];
                    $desc = fn($x) => [
                        'name' => (string)($x['display'] ?? ''),
                        'lines' => activity_lines_text((array)($x['lines'] ?? [])),
                        'pages' => ($p = (array)($x['pages'] ?? [])) ? implode(', ', array_slice($p, 0, 12)) . (count($p) > 12 ? ' …' : '') : 'as Management view',
                        'fills OLE' => !empty($x['oleEdit']) ? 'yes' : 'no',
                        'RCA dept' => ($x['dept'] ?? '') !== '' ? (string)$x['dept'] : '—',
                        'on' => !empty($x['active']) ? 'yes' : 'no',
                    ];
                    if (!$o) $what[] = 'New login ' . $nm($src, $u) . ': ' . implode(', ', array_map(fn($k, $v) => "$k $v", array_keys($desc($src)), $desc($src)));
                    else {
                        $a = $desc($o); $c = $desc($src); $p = [];
                        foreach ($c as $k => $v) if ($a[$k] !== $v) $p[] = "$k {$a[$k]} → $v";
                        if (($b['pass'] ?? '') !== '') $p[] = 'password set';
                        $what[] = 'Login ' . $nm($src, $u) . ': ' . ($p ? implode('; ', $p) : 'saved (nothing changed)');
                    }
                }
                break;
        }
    } catch (Throwable $x) {
        if (!$what) $what[] = 'Change of ' . $script . ($action !== '' ? " ($action)" : '');
    }
    $lines = array_values(array_filter(array_map(fn($l) => (string)$l, $lines), fn($l) => $l !== '' && $l !== '0' && $l !== '?'));
    $dates = array_values(array_filter(array_map('strval', $dates), fn($d) => (bool)preg_match('/^\d{4}-\d\d-\d\d$/', $d)));
    return ['what' => $what, 'lines' => $lines, 'dates' => $dates];
}

/* ───────────── reading (the admin's page) ───────────── */

/**
 * Events of the days from … to (newest first) with the filters: user (login ID), ev (list), q (text in what / page / area).
 * → { events, total, truncated, users: [per login over the whole period: logins, fails, changes, refused, views, last …],
 *     counts: { login, login_fail, logout, view, change, refused, download, error } of the whole period (every login) }
 */
function activity_read(string $from, string $to, array $f = [], int $limit = 2000): array
{
    $users = []; $events = []; $total = 0;
    $counts = ['login' => 0, 'login_fail' => 0, 'logout' => 0, 'view' => 0, 'change' => 0, 'refused' => 0, 'download' => 0, 'error' => 0];
    $evs = array_values(array_intersect((array)($f['ev'] ?? []), ACTIVITY_EVENTS));
    $user = strtolower(trim((string)($f['user'] ?? '')));
    $q = mb_strtolower(trim((string)($f['q'] ?? '')));
    $refused = !empty($f['refused']);
    $months = [];
    for ($m = substr($from, 0, 7); $m <= substr($to, 0, 7) && count($months) < 40; $m = date('Y-m', strtotime("$m-01 +1 month"))) $months[] = $m;
    foreach ($months as $m) {
        $file = activity_dir() . "/$m.jsonl";
        if (!is_file($file)) continue;
        $h = @fopen($file, 'r');
        if (!$h) continue;
        flock($h, LOCK_SH);
        while (($ln = fgets($h)) !== false) {
            $e = json_decode($ln, true);
            if (!is_array($e) || !isset($e['time'], $e['ev'])) continue;
            $day = substr((string)$e['time'], 0, 10);
            if ($day < $from || $day > $to) continue;
            $id = (string)($e['user'] ?? '');
            $bad = $e['ev'] === 'change' && (int)($e['status'] ?? 200) >= 400;
            if (isset($counts[$e['ev']])) $counts[$bad ? 'refused' : $e['ev']]++;
            if ($id !== '') {
                $s = $users[$id] ?? ['user' => $id, 'name' => '', 'role' => '', 'logins' => 0, 'fails' => 0, 'changes' => 0, 'refused' => 0, 'views' => 0, 'lastLogin' => null, 'lastSeen' => null, 'ips' => []];
                if (($e['name'] ?? '') !== '') $s['name'] = (string)$e['name'];
                if (($e['role'] ?? '') !== '') $s['role'] = (string)$e['role'];
                $k = ['login' => 'logins', 'login_fail' => 'fails', 'view' => 'views'][$e['ev']] ?? null;
                if ($k) $s[$k]++;
                if ($e['ev'] === 'change') { if ((int)($e['status'] ?? 200) >= 400) $s['refused']++; else $s['changes']++; }
                if ($e['ev'] === 'login') $s['lastLogin'] = $e['time'];
                if ($e['ev'] !== 'login_fail') $s['lastSeen'] = $e['time'];
                if (($e['ip'] ?? '') !== '' && !in_array($e['ip'], $s['ips'], true) && count($s['ips']) < 8) $s['ips'][] = (string)$e['ip'];
                $users[$id] = $s;
            }
            if ($evs && !in_array($e['ev'], $evs, true)) continue;
            if ($user !== '' && strtolower($id) !== $user) continue;
            if ($refused && !($e['ev'] === 'change' && (int)($e['status'] ?? 200) >= 400) && $e['ev'] !== 'login_fail') continue;
            if ($q !== '') {
                $hay = mb_strtolower(implode(' ', [$id, $e['name'] ?? '', $e['api'] ?? '', $e['action'] ?? '', $e['page'] ?? '', $e['title'] ?? '', $e['error'] ?? '', $e['ip'] ?? '', implode(' ', (array)($e['what'] ?? []))]));
                if (strpos($hay, $q) === false) continue;
            }
            $total++;
            $events[] = $e;
            if (count($events) > $limit * 2) $events = array_slice($events, -$limit);   // keep the newest only
        }
        flock($h, LOCK_UN); fclose($h);
    }
    $events = array_reverse(array_slice($events, -$limit));
    uasort($users, fn($a, $b) => strcmp((string)($b['lastSeen'] ?? ''), (string)($a['lastSeen'] ?? '')));
    return ['events' => $events, 'total' => $total, 'truncated' => $total > count($events), 'users' => array_values($users), 'counts' => $counts];
}
