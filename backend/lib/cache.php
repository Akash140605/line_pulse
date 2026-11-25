<?php
/**
 * Small file cache so repeated identical requests (live polling, several users, quick re-clicks) don't hit SQL Server.
 *  - ?refresh=1 bypasses it.
 *  - Requests for days that are already over (endDate / end / date before today) are kept for 6 hours: that data no longer changes.
 *  - Every response carries X-Cache (HIT / MISS) and Server-Timing (server time in ms) so delays can be seen in the browser's Network tab.
 *  - On a HIT no database connection is opened at all.
 *  - Answers that came from a local backup (lib/backup.php, line offline) are kept apart for a short time only
 *    (BACKUP_CACHE_TTL for one line, the normal TTL for all-lines screens) with their X-EMS-Backup header: an offline
 *    line no longer makes every poll of every screen read the backup again. A live answer of the same request removes it.
 */

require_once __DIR__ . '/clock.php';
require_once __DIR__ . '/snapshot.php';

/** Bump when a calculation changes, so results cached by the old code are never served again. */
const EMS_CACHE_VERSION = '2026-10-27-dhm-money';   // change when an answer's shape changes: old cached answers are then not used

function cache_file(): string
{
    $params = $_GET;
    unset($params['refresh'], $params['_'], $params['nobackup']);
    ksort($params);
    return sys_get_temp_dir() . '/ems_' . md5(EMS_CACHE_VERSION . basename($_SERVER['SCRIPT_NAME']) . http_build_query($params)) . '.json';
}

/** TTL in seconds: finished days are cached for 6 hours (or EMS_PAST_TTL of the script), anything that includes today uses the given TTL. */
function cache_ttl(int $ttl): int
{
    $today = ems_today();   // DB ka din (lib/clock.php), PC ki ghadi nahi
    foreach (['endDate', 'end', 'date'] as $k) {
        if (!empty($_GET[$k]) && is_string($_GET[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$k])) {
            return $_GET[$k] < $today ? max($ttl, defined('EMS_PAST_TTL') ? EMS_PAST_TTL : 6 * 3600) : $ttl;
        }
    }
    return $ttl;
}

function cache_headers(string $state): void
{
    if (headers_sent()) return;
    $t0 = $_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true);
    header('X-Cache: ' . $state);
    header('Server-Timing: app;dur=' . (int)round((microtime(true) - $t0) * 1000));
    header('Access-Control-Expose-Headers: X-Cache, Server-Timing, X-EMS-Backup');
}

/** Seconds an answer built from a line's local backup is shared (the backup only changes when the mirror copies). */
const BACKUP_CACHE_TTL = 45;
function cache_backup_file(): string { return cache_file() . '.bk'; }

/** A fresh answer that came from a backup: ['h' => X-EMS-Backup value, 'b' => body], or null. */
function cache_backup_hit(int $ttl): ?array
{
    if (!empty($_GET['refresh']) || !empty($_GET['nobackup'])) return null;
    $f = cache_backup_file();
    if (!is_file($f)) return null;
    // a finished day's backup answer saved while that day was still running: short life only (cache_ttl_for_file)
    if (cache_ttl(BACKUP_CACHE_TTL) > BACKUP_CACHE_TTL && cache_ttl_for_file(BACKUP_CACHE_TTL, (int)filemtime($f)) === BACKUP_CACHE_TTL) $ttl = BACKUP_CACHE_TTL;
    if ((time() - filemtime($f)) >= $ttl) return null;
    $j = json_decode((string)@file_get_contents($f), true);
    return (is_array($j) && isset($j['b']) && is_string($j['b'])) ? $j : null;
}

function cache_backup_store(string $body): void
{
    $h = function_exists('backup_header_value') && function_exists('backup_used') ? backup_header_value(backup_used()) : '';
    @file_put_contents(cache_backup_file(), json_encode(['h' => $h, 'b' => $body], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), LOCK_EX);
}

/** Send a stored backup answer with its X-EMS-Backup header (the screen still says "from backup"). */
function cache_backup_serve(array $j): void
{
    if (!headers_sent() && !empty($j['h'])) header('X-EMS-Backup: ' . $j['h']);
    cache_headers('HIT-BACKUP');
    echo $j['b'];
}

/**
 * One-line request whose line has a backup that stops before the period asked: no backup for this request
 * (lib/backup.php backup_stale_for) — the line is asked directly. Only on a cache miss (opens the local backup once).
 */
function cache_skip_stale_backup(): void
{
    if (!empty($_GET['nobackup']) || !function_exists('backup_stale_for')) return;
    try {
        $line = snap_request_line();
        if ($line > 0 && backup_stale_for($line, backup_request_from())) $_GET['nobackup'] = '1';
    } catch (Throwable $e) { /* no backup info: normal behaviour */ }
}

/** Path of a fresh cached copy, or null. */
function cache_hit(int $ttl): ?string
{
    if (!empty($_GET['refresh'])) return null;
    $f = cache_file();
    if (!is_file($f)) return null;
    return (time() - filemtime($f)) < cache_ttl_for_file($ttl, (int)filemtime($f)) ? $f : null;
}

/**
 * 21-11-2026: the long TTL of a finished day holds only for an answer saved AFTER that day ended. An answer saved while the
 * day was still running (e.g. at 18:15, the day's last two hours still to come) is part of a day, not the whole day: it
 * keeps the short TTL and is read again — yesterday no longer shows 0 pieces after 18:15 for the rest of the cache time.
 */
function cache_ttl_for_file(int $ttl, int $savedAt): int
{
    $t = cache_ttl($ttl);
    if ($t <= $ttl) return $t;
    $end = '';
    foreach (['endDate', 'end', 'date'] as $k) {
        if (!empty($_GET[$k]) && is_string($_GET[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$k])) { $end = $_GET[$k]; break; }
    }
    $savedDay = date('Y-m-d', $savedAt + (function_exists('ems_clock_offset') ? ems_clock_offset() : 0));
    return ($end !== '' && $savedDay <= $end) ? $ttl : $t;
}

/**
 * A request that ends with a server error (5xx) is noted in the temp folder (ems_api_errors.log, under 256 KB):
 * the page, the line, the error text and how it ended — at most once in 10 minutes for the same error, so the log
 * stays small. The line pages that fail at night (lines switched off) can then be read and fixed. Nothing else changes.
 */
function cache_note_error(string $how, string $msg): void
{
    $script = basename((string)($_SERVER['SCRIPT_NAME'] ?? '?'));
    $line = preg_replace('/[^0-9a-z,]/i', '', (string)($_GET['line'] ?? '-'));
    $msg = (string)preg_replace('/\s+/', ' ', mb_substr($msg, 0, 300));
    $dir = $GLOBALS['EMS_ERR_DIR'] ?? sys_get_temp_dir();   // tests use their own folder
    $seen = $dir . '/ems_err_' . substr(md5($script . $how . preg_replace('/\d+/', 'N', $msg)), 0, 12) . '.seen';
    if (is_file($seen) && (int)@filemtime($seen) > time() - 600) return;
    @touch($seen);
    $log = $dir . '/ems_api_errors.log';
    if (is_file($log) && (int)@filesize($log) > 256 * 1024) @rename($log, $log . '.old');
    @file_put_contents($log, date('Y-m-d H:i:s') . " $script line=$line $how: $msg\n", FILE_APPEND | LOCK_EX);
}

/** Build-and-cache for endpoints that return an array. Open the database INSIDE $build so a cache hit never connects. */
function respond_cached(callable $build, int $ttl = 20): void
{
    // the answer goes gzip-compressed when the browser accepts it (line pages poll these every few seconds)
    if (PHP_SAPI !== 'cli' && function_exists('ob_gzhandler') && !ini_get('zlib.output_compression') && !in_array('ob_gzhandler', ob_list_handlers(), true)) {
        ob_start('ob_gzhandler');
    }
    if ($f = cache_hit($ttl)) {
        cache_headers('HIT');
        readfile($f);
        return;
    }
    cache_skip_stale_backup();
    if ($b = cache_backup_hit(max(BACKUP_CACHE_TTL, cache_ttl($ttl)))) { cache_backup_serve($b); return; }
    // The connection code (config/db.php) answers "Database connection failed (Line N)" with a 500 by itself and ends
    // the request, so the check in the catch below never saw it: at night (lines switched off) every poll of the line
    // pages failed. Here, at the end of such a request, the last good copy of the same request is sent instead —
    // marked as a snapshot (X-EMS-Backup), exactly like the check below does.
    $GLOBALS['EMS_ERR_SEEN'] = false;
    if (!ob_get_level()) ob_start();   // keeps such an answer in the buffer until the end, so it can still be replaced
    $snapKey = snap_request_key();     // taken now: the connection code may change the request's parameters
    register_shutdown_function(function () use ($snapKey) {
        $code = http_response_code();
        if (!is_int($code) || $code < 500 || !empty($GLOBALS['EMS_ERR_SEEN'])) return;
        $out = ob_get_level() ? (string)ob_get_contents() : '';
        $s = snap_is_offline_error($out) ? snap_load($snapKey) : null;
        if ($s && ob_get_level() && !headers_sent()) {
            ob_clean();
            http_response_code(200);
            snap_mark_used(snap_request_line(), $s[1]);
            cache_headers('SNAPSHOT');
            echo $s[0];
            return;
        }
        $why = !$s ? 'no last good copy' : (headers_sent() ? 'answer already sent' : 'no buffer');
        cache_note_error("ended $code ($why)", $out);
    });
    try {
        $data = $build();
    } catch (Throwable $e) {
        $GLOBALS['EMS_ERR_SEEN'] = true;
        // line not reachable and no SQL backup: answer with the last good copy of this same request (lib/snapshot.php)
        $offline = snap_is_offline_error($e->getMessage());
        if ($offline && ($s = snap_load(snap_request_key()))) {
            snap_mark_used(snap_request_line(), $s[1]);
            cache_headers('SNAPSHOT');
            echo $s[0];
            return;
        }
        cache_note_error($offline ? 'offline, no last good copy' : 'error (not an offline error)', $e->getMessage());
        throw $e;
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    // answers built from a local backup (line offline) are not stored: live data must show as soon as the line is back
    $good = $json !== false && !(is_array($data) && isset($data['error']));
    if ($good && (!function_exists('backup_used') || backup_cache_allowed(backup_used()))) {
        @file_put_contents(cache_file(), $json, LOCK_EX);
        snap_save(snap_request_key(), $json);
        if (is_file(cache_backup_file())) @unlink(cache_backup_file());   // the line is back: no backup answer any more
    } elseif ($good && ($s = snap_request_if_newer())) {
        // the backup copy is older than the last live answer of this request (mirror not running): show that answer
        snap_mark_used(snap_request_line(), $s[1]);
        cache_backup_store($s[0]);
        cache_headers('SNAPSHOT');
        echo $s[0];
        return;
    } elseif ($good) {
        cache_backup_store($json);
    } elseif (is_array($data) && isset($data['error']) && snap_is_offline_error((string)$data['error']) && ($s = snap_load(snap_request_key()))) {
        snap_mark_used(snap_request_line(), $s[1]);
        cache_headers('SNAPSHOT');
        echo $s[0];
        return;
    }
    cache_headers('MISS');
    echo $json;
}

/**
 * For scripts that print their own JSON and exit: serve a fresh copy and exit, or capture what the script prints
 * (only a 200 JSON response is stored). Call it after the request parameters are validated.
 */
function cache_or_capture(int $ttl, bool $snapshot = true): void
{
    if (!defined('EMS_CAPTURE')) define('EMS_CAPTURE', true);
    // compress the response (also cache hits) unless a gzip buffer is already running; php.ini output_buffering may already have opened a plain buffer
    if (function_exists('ob_gzhandler') && !ini_get('zlib.output_compression') && !in_array('ob_gzhandler', ob_list_handlers(), true)) {
        ob_start('ob_gzhandler');
    }
    if ($f = cache_hit($ttl)) {
        cache_headers('HIT');
        readfile($f);
        exit;
    }
    if ($snapshot) cache_skip_stale_backup();   // all-lines scripts decide per line (connect_line(…, allow))
    // all-lines screens ($snapshot false) keep a backup answer only for their own short TTL: the live lines stay live
    if ($b = cache_backup_hit($snapshot ? max(BACKUP_CACHE_TTL, cache_ttl($ttl)) : cache_ttl($ttl))) { cache_backup_serve($b); exit; }
    cache_headers('MISS');
    $file = cache_file();
    $snapKey = $snapshot ? snap_request_key() : null;   // all-lines scripts keep a snapshot per line row instead
    $all = '';
    ob_start(function (string $buf, int $phase) use ($file, $snapKey, &$all) {
        $all .= $buf;
        if (!($phase & PHP_OUTPUT_HANDLER_FINAL)) return '';   // hold everything until the end, so an error can still be replaced
        $isJson = $all !== '' && ($all[0] === '{' || $all[0] === '[');
        $isErr = !$isJson || strncmp($all, '{"error"', 8) === 0 || http_response_code() >= 400;
        if (!$isErr && http_response_code() === 200 && (!function_exists('backup_used') || backup_cache_allowed(backup_used()))) {
            @file_put_contents($file, $all, LOCK_EX);
            if ($snapKey) snap_save($snapKey, $all);
            if (is_file($file . '.bk')) @unlink($file . '.bk');   // the line is back
            return $all;
        }
        if (!$isErr && http_response_code() === 200 && $snapKey && !headers_sent() && ($s = snap_request_if_newer())) {
            // the backup copy is older than the last live answer of this request (mirror not running): show that answer
            snap_mark_used(snap_request_line(), $s[1]);
            header('X-Cache: SNAPSHOT');
            cache_backup_store($s[0]);
            return $s[0];
        }
        if (!$isErr && http_response_code() === 200) {   // answered (partly) from a backup: shared for a short time
            cache_backup_store($all);
            return $all;
        }
        // line not reachable: the last good copy of this same request, marked as snapshot
        if ($isErr && $snapKey && snap_is_offline_error($all) && ($s = snap_load($snapKey)) && !headers_sent()) {
            http_response_code(200);
            snap_mark_used(snap_request_line(), $s[1]);
            header('X-Cache: SNAPSHOT');
            return $s[0];
        }
        return $all;
    });
}
