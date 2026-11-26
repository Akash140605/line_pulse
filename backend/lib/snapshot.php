<?php
/**
 * Last-good copy ("snapshot") of every answer, kept on this PC in backend/data/snapshots/.
 *
 * Why: when a line's SQL Server cannot be reached and the SQL backup copy (lib/backup.php, EMS_Backup_Line<N>)
 * is not there or not complete, the screen would show only "Line offline". With a snapshot it shows the
 * last numbers that were read from the line, clearly marked as old (same X-EMS-Backup header as the SQL backup,
 * with "kind":"snapshot" and the time the data was read).
 *
 *  - Written only from LIVE answers (never from a backup or another snapshot), only when the answer is good.
 *  - Used only when the line cannot be reached (network / timeout / login errors) — never for a query error.
 *  - Nothing is written to any database; the files are plain JSON in the data folder (web access denied).
 *  - Files older than SNAP_KEEP_DAYS are removed now and then.
 */
require_once __DIR__ . '/clock.php';
require_once __DIR__ . '/backup.php';

const SNAP_KEEP_DAYS = 10;
const SNAP_MAX_BYTES = 8 * 1024 * 1024;   // bigger answers (very long periods) are not kept

function snap_dir(): string
{
    $d = __DIR__ . '/../data/snapshots';
    if (!is_dir($d)) @mkdir($d, 0775, true);
    return $d;
}

/** Error text that means "the line could not be reached" (not a mistake in a query). */
function snap_is_offline_error(string $msg): bool
{
    return (bool)preg_match('/SQLSTATE\[(08001|08S01|08S02|08004|HYT00|HYT01|28000)\]|Physical connection is not usable|TCP Provider|Named Pipes|timed? ?out|timeout expired|not reachable|could not open a connection|network-related|server was not found|No connection could be made|Login failed|Communication link failure|offline/i', $msg);
}

function snap_path(string $key): string
{
    return snap_dir() . '/' . preg_replace('/[^A-Za-z0-9_.-]/', '_', $key) . '.json';
}

/** Saves a good live answer (JSON text). Returns true when written. */
function snap_save(string $key, string $json): bool
{
    if ($json === '' || strlen($json) > SNAP_MAX_BYTES || ($json[0] !== '{' && $json[0] !== '[') || strncmp($json, '{"error"', 8) === 0) return false;
    $f = snap_path($key);
    $tmp = $f . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) return false;
    if (!@rename($tmp, $f)) { @unlink($tmp); return false; }
    if (mt_rand(1, 200) === 1) snap_prune();
    return true;
}

/** [json text, savedAt 'Y-m-d H:i:s' in DB time] or null. */
function snap_load(string $key): ?array
{
    $f = snap_path($key);
    if (!is_file($f)) return null;
    $json = @file_get_contents($f);
    if ($json === false || $json === '') return null;
    return [$json, date('Y-m-d H:i:s', filemtime($f) + ems_clock_offset())];
}

function snap_prune(): void
{
    $limit = time() - SNAP_KEEP_DAYS * 86400;
    foreach (glob(snap_dir() . '/*.json') ?: [] as $f) if (@filemtime($f) < $limit) @unlink($f);
    foreach (glob(snap_dir() . '/*.tmp') ?: [] as $f) if (@filemtime($f) < time() - 3600) @unlink($f);
}

/** Line a single-line request is for. */
function snap_request_line(): int
{
    if (function_exists('current_line')) { try { return (int)current_line(); } catch (Throwable $e) {} }
    return max(1, (int)($_GET['line'] ?? 1));
}

/** Snapshot key of the current request (same parameters as the response cache, without refresh/_). */
function snap_request_key(): string
{
    $p = $_GET;
    unset($p['refresh'], $p['_'], $p['nobackup']);
    ksort($p);
    return 'req_' . basename($_SERVER['SCRIPT_NAME'] ?? 'x', '.php') . '_' . md5(http_build_query($p));
}

/**
 * Tells the screen (X-EMS-Backup header, kind "snapshot") that $line is shown from a snapshot.
 * $upTo = newest scan in it when known, else the time it was read.
 */
function snap_mark_used(int $line, string $savedAt, ?string $upTo = null): array
{
    $info = ['upTo' => $upTo ?: $savedAt, 'syncedAt' => $savedAt, 'kind' => 'snapshot'];
    backup_mark_used($line, $info);
    return $info;
}

/** True when this request already used the SQL backup or a snapshot for some line. */
function snap_any_fallback(): bool
{
    return !empty($GLOBALS['EMS_BACKUP_USED']);
}

/* ── per-line rows of the all-lines answers (live_lines.php, all_lines.php) ── */

function snap_row_key(string $kind, int $line, string $variant = ''): string
{
    return $kind . '_line' . $line . ($variant !== '' ? '_' . md5($variant) : '');
}

/** Saves one good row of a line. */
function snap_save_row(string $kind, int $line, array $row, string $variant = ''): void
{
    if (empty($row['ok']) || !empty($row['backup'])) return;
    $j = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($j !== false) snap_save(snap_row_key($kind, $line, $variant), $j);
}

/** The saved row of a line, marked as snapshot, or null. */
function snap_row(string $kind, int $line, string $variant = ''): ?array
{
    $s = snap_load(snap_row_key($kind, $line, $variant));
    if (!$s) return null;
    $row = json_decode($s[0], true);
    if (!is_array($row)) return null;
    $info = snap_mark_used($line, $s[1], $row['lastScan'] ?? null);
    $row['ok'] = true;
    $row['error'] = null;
    $row['backup'] = ['upTo' => $info['upTo'], 'syncedAt' => $info['syncedAt'], 'kind' => 'snapshot'];
    $row['snapshot'] = true;
    return $row;
}

/* ── a line that does not answer: skip it for a short time, so one dead line never slows the others ── */

const SNAP_DOWN_SECONDS = 60;

function snap_down_file(int $line): string { return sys_get_temp_dir() . '/ems_down_line' . $line . '.json'; }

/** Error text of a line that failed in the last SNAP_DOWN_SECONDS, else null. */
function snap_line_down(int $line): ?string
{
    $f = snap_down_file($line);
    if (!is_file($f)) return null;
    $j = json_decode((string)@file_get_contents($f), true);
    if (!is_array($j) || ($j['until'] ?? 0) < time()) return null;
    return (string)($j['error'] ?? 'offline');
}

/**
 * A line that HANGS (the failed attempt took $seconds ≥ SNAP_HANG_SECONDS) is skipped for SNAP_DOWN_SECONDS, so the
 * other requests do not wait for it again and again (each waiting request also blocks one of the browser's few
 * connections, which makes every screen slow). A quick failure (a dropped packet) is not marked: the next poll asks again.
 */
const SNAP_HANG_SECONDS = 8;
function snap_mark_down(int $line, string $error, float $seconds = 99): void
{
    if ($seconds < SNAP_HANG_SECONDS) return;
    @file_put_contents(snap_down_file($line), json_encode(['until' => time() + SNAP_DOWN_SECONDS, 'error' => substr($error, 0, 400)]), LOCK_EX);
}

function snap_mark_up(int $line): void { if (is_file(snap_down_file($line))) @unlink(snap_down_file($line)); }

/** Every query of this connection gives up after $sec seconds (a line that hangs then counts as offline). */
/**
 * 26-11-2026: a database connection that died while it waited in the driver's pool ("SMux Provider: Physical connection
 * is not usable", 08S02 / 08S01 / communication link failure). It fails every query until it is dropped, and the page
 * said "Line N is not answering" again and again.
 */
function snap_is_broken_link(string $msg): bool
{
    return (bool)preg_match('/SQLSTATE\[(08S02|08S01)\]|Physical connection is not usable|Communication link failure|existing connection was forcibly closed|connection is broken/i', $msg);
}

/**
 * Opens a connection ($connect returns a PDO), sets the query timeout and checks it with SELECT 1. A dead pooled
 * connection is noted in the error log and opened once more (the driver has dropped the dead one by then).
 * Any other error is left to the real query (which reports it as before).
 */
function snap_alive(callable $connect, int $sec): PDO
{
    $pdo = snap_query_timeout($connect(), $sec);
    try {
        $st = $pdo->query('SELECT 1');
        if ($st !== false) $st->fetchColumn();
        return $pdo;
    } catch (Throwable $e) {
        if (!snap_is_broken_link($e->getMessage())) return $pdo;
        if (function_exists('cache_note_error')) cache_note_error('dead connection, connected again', $e->getMessage());
        $pdo = null;
        return snap_query_timeout($connect(), $sec);
    }
}

function snap_query_timeout(PDO $pdo, int $sec): PDO
{
    if (defined('PDO::SQLSRV_ATTR_QUERY_TIMEOUT')) { try { $pdo->setAttribute(PDO::SQLSRV_ATTR_QUERY_TIMEOUT, $sec); } catch (Throwable $e) {} }
    return $pdo;
}

/**
 * No snapshot of a live row yet (e.g. the line was already offline when this version was installed):
 * look for the newest good row of the line in the response cache files of live_lines.php that are still on this PC.
 * The row found is saved as the line's snapshot. Returns the snapshot row (marked) or null.
 */
function snap_recover_live_row(int $line, string $dir = '', int $maxFiles = 600): ?array
{
    $dir = $dir !== '' ? $dir : sys_get_temp_dir();
    $tried = $dir . '/ems_recover_line' . $line . '.tried';
    if (is_file($tried) && @filemtime($tried) > time() - 600) return null;   // looked less than 10 min ago and found nothing
    @touch($tried);
    $files = glob($dir . '/ems_*.json') ?: [];
    usort($files, fn($a, $b) => @filemtime($b) <=> @filemtime($a));
    $limit = time() - 14 * 86400;
    $n = 0;
    foreach ($files as $f) {
        if (++$n > $maxFiles) break;
        $mt = @filemtime($f);
        if ($mt === false || $mt < $limit || @filesize($f) > 4 * 1024 * 1024) continue;
        $txt = @file_get_contents($f);
        if ($txt === false || strpos($txt, '"findDayMs"') === false) continue;   // only live_lines.php answers
        $j = json_decode($txt, true);
        foreach ((array)($j['lines'] ?? []) as $row) {
            if ((string)($row['line'] ?? '') !== (string)$line || empty($row['ok']) || !empty($row['backup']) || empty($row['total'])) continue;
            $row['day'] = $row['day'] ?? ($j['focus'] ?? substr((string)($row['lastScan'] ?? ''), 0, 10));
            $json = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
            if ($json === false) return null;
            $key = snap_row_key('live', $line);
            if (!snap_save($key, $json)) return null;
            @touch(snap_path($key), $mt);   // its age is the age of the data, not now
            return snap_row('live', $line);
        }
    }
    return null;
}

/* ── the SQL backup is older than the last live read: show the newer one ── */

/**
 * A line answered from the SQL backup (lib/backup.php) whose copy stopped at $backup['upTo'] (e.g. the mirror has not
 * run for days) while this PC read the line live AFTER that: the live read is newer, so its saved row is shown instead.
 * Returns the snapshot row (marked as snapshot) or null (no backup used, or the backup is newer / as new).
 */
function snap_row_if_newer(string $kind, int $line, string $variant, ?array $backup): ?array
{
    if (!$backup || ($backup['kind'] ?? '') === 'snapshot') return null;
    $s = snap_load(snap_row_key($kind, $line, $variant));
    if (!$s) return null;
    $upTo = (string)($backup['upTo'] ?? '');
    if ($upTo !== '' && $s[1] <= $upTo) return null;
    return snap_row($kind, $line, $variant);
}

/**
 * Same for a whole request (single-line screens): the backup used for it is older than the last live answer of this
 * same request → [json text, savedAt] of that answer, else null.
 */
function snap_request_if_newer(): ?array
{
    $min = null;
    foreach (backup_used() as $i) {
        if (($i['kind'] ?? '') === 'snapshot') continue;
        $u = (string)($i['upTo'] ?? '');
        if ($min === null || $u < $min) $min = $u;
    }
    if ($min === null) return null;
    $s = snap_load(snap_request_key());
    return ($s && $s[1] > $min) ? $s : null;
}
