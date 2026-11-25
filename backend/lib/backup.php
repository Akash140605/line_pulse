<?php
/**
 * Offline fallback: when a line's SQL Server cannot be reached, the dashboard reads the local backup copy
 * (this PC's SQL Server, database EMS_Backup_Line<N>, kept up to date by admin/mirror_sync.php).
 *
 *  - Every response that used a backup carries the header  X-EMS-Backup: {"<line>":{"upTo":"…","syncedAt":"…"}}
 *    (upTo = time of the newest scan in the backup, syncedAt = last copy run) so the screen can say so.
 *  - Such responses are never stored in the response cache, so live data is shown as soon as the line is back.
 *  - ?nobackup=1 turns the fallback off for one request; the mirror sync and the tests never use it.
 *  - Only a COMPLETE backup is used: the first full copy of the scans has finished and the model and company
 *    tables are there. While a line is copied for the first time, a short drop of the line shows "offline"
 *    instead of a half-copied backup (which would give errors or wrong totals).
 */
require_once __DIR__ . '/mirror.php';

const BACKUP_FALLBACK = true;

/** Lines answered from the backup during this request: [line => info]. */
function backup_used(): array { return $GLOBALS['EMS_BACKUP_USED'] ?? []; }

function backup_should_fallback(bool $allowed, array $get, ?array $info): bool
{
    if (!$allowed || !BACKUP_FALLBACK || !empty($get['nobackup'])) return false;
    return $info !== null && !empty($info['rows']) && !empty($info['upTo']) && !empty($info['ready']);
}

/** 99 %: rows scanned on the line after the last copy run are not missing data, so a small gap is allowed. */
const BACKUP_READY_SHARE = 0.99;

/**
 * Is the backup complete enough to stand in for the line?
 *  $localScans  = scans in the backup, $sourceScans = scans the line had at the last copy run (null = never copied fully),
 *  $models / $companies = rows in the backup's model and company tables (null = table missing).
 */
function backup_ready(int $localScans, ?int $sourceScans, ?int $models, ?int $companies): bool
{
    if ($localScans <= 0 || $sourceScans === null || $sourceScans <= 0) return false;
    if (!$models || !$companies) return false;
    return $localScans >= $sourceScans * BACKUP_READY_SHARE;
}

function backup_header_value(array $used): string
{
    if (!$used) return '';
    ksort($used);
    $o = [];
    foreach ($used as $line => $i) $o[(string)$line] = ['upTo' => $i['upTo'] ?? null, 'syncedAt' => $i['syncedAt'] ?? null] + (isset($i['kind']) ? ['kind' => $i['kind']] : []);
    return json_encode($o, JSON_UNESCAPED_SLASHES);
}

function backup_row_info(array $used, int $line): ?array
{
    return isset($used[$line]) ? ['upTo' => $used[$line]['upTo'] ?? null, 'syncedAt' => $used[$line]['syncedAt'] ?? null] + (isset($used[$line]['kind']) ? ['kind' => $used[$line]['kind']] : []) : null;
}

function backup_cache_allowed(array $used): bool { return !$used; }

/** Connection to the backup of $line plus its age, or null when there is no usable backup. */
function backup_open(int $line): ?array
{
    static $pool = [];
    if (!empty($GLOBALS['EMS_NO_DB'])) return null;   // unit tests: never open a database
    if (array_key_exists($line, $pool)) return $pool[$line];
    $pool[$line] = null;
    try {
        $pdo = new PDO('sqlsrv:Server=' . MIRROR_LOCAL_SERVER . ';Database=' . mirror_db_name($line) . ';TrustServerCertificate=true;LoginTimeout=3', null, null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        backup_query_limit($pdo, BACKUP_INFO_QUERY_SEC);   // the small info queries below: never hang the request
        if ($pdo->query("SELECT OBJECT_ID(N'dbo.ScanStatus')")->fetchColumn() === null) return null;
        $last = $pdo->query("SELECT TOP 1 CONVERT(char(19), ScanDate, 120) FROM dbo.ScanStatus ORDER BY ScanId DESC")->fetchColumn();
        $rows = (int)$pdo->query("SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'dbo.ScanStatus') AND p.index_id IN (0, 1)")->fetchColumn();
        $synced = null; $source = null;
        try {
            $synced = $pdo->query("SELECT CONVERT(char(19), MAX(LastSync), 120) FROM dbo._MirrorState")->fetchColumn() ?: null;
            $v = $pdo->query("SELECT SourceRows FROM dbo._MirrorState WHERE TableName = N'dbo.ScanStatus'")->fetchColumn();
            $source = ($v === false || $v === null) ? null : (int)$v;
        } catch (Throwable $e) {}
        $count = function (string $t) use ($pdo): ?int {
            if ($pdo->query("SELECT OBJECT_ID(N'$t')")->fetchColumn() === null) return null;
            return (int)$pdo->query("SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID(N'$t') AND p.index_id IN (0, 1)")->fetchColumn();
        };
        $ready = backup_ready($rows, $source, $count('dbo.Tab_ModelMaster'), $count('dbo.Tab_CompanyMaster'));
        backup_query_limit($pdo, 0);                       // the real backup queries: no extra limit (as before)
        $pool[$line] = ['pdo' => $pdo, 'info' => ['upTo' => $last ?: null, 'syncedAt' => $synced, 'rows' => $rows, 'ready' => $ready]];
    } catch (Throwable $e) {
        $pool[$line] = null;
    }
    return $pool[$line];
}

/** Seconds each info query of backup_open() may take. */
const BACKUP_INFO_QUERY_SEC = 10;
function backup_query_limit(PDO $pdo, int $sec): void
{
    if (defined('PDO::SQLSRV_ATTR_QUERY_TIMEOUT')) { try { $pdo->setAttribute(PDO::SQLSRV_ATTR_QUERY_TIMEOUT, $sec); } catch (Throwable $e) {} }
}

/**
 * Facts of a line's backup (upTo, syncedAt, rows, ready) — or null: no usable backup — kept BACKUP_INFO_TTL seconds
 * in the temp folder. The backup changes only when the copy run (admin/mirror_sync.php) works, so the check below
 * no longer opens this PC's SQL Server on every request: once in 2 minutes per line instead of thousands of times a day.
 */
const BACKUP_INFO_TTL = 120;
function backup_info_file(int $line): string { return ($GLOBALS['EMS_BACKUP_INFO_DIR'] ?? sys_get_temp_dir()) . '/ems_backup_info_line' . $line . '.json'; }   // tests: own folder
function backup_info(int $line): ?array
{
    $f = backup_info_file($line);
    $j = is_file($f) ? json_decode((string)@file_get_contents($f), true) : null;
    if (is_array($j) && array_key_exists('info', $j) && (int)($j['at'] ?? 0) > time() - BACKUP_INFO_TTL) {
        return is_array($j['info']) ? $j['info'] : null;
    }
    $b = backup_open($line);
    $info = is_array($b['info'] ?? null) ? $b['info'] : null;
    if (empty($GLOBALS['EMS_NO_DB'])) @file_put_contents($f, json_encode(['at' => time(), 'info' => $info]), LOCK_EX);
    return $info;
}

/**
 * The local backup of $line stops BEFORE $from (its copy run has not run since): it holds nothing of the period asked,
 * so it must not stand in for the line — the screen would show "0 pcs / closed" for days that had production.
 * Then the line is asked directly (or, when it really is down, the last good live answer / an honest error is shown).
 */
function backup_stale_for(int $line, string $from): bool
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $from)) return false;
    $u = substr((string)(backup_info($line)['upTo'] ?? ''), 0, 10);
    return $u !== '' && $u < substr($from, 0, 10);
}

/** First day a request asks for (startDate / start / date), else today. */
function backup_request_from(): string
{
    foreach (['startDate', 'start', 'date'] as $k) {
        if (!empty($_GET[$k]) && is_string($_GET[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$k])) return $_GET[$k];
    }
    return function_exists('ems_today') ? ems_today() : date('Y-m-d');
}

/** Records that $line is answered from the backup and (re)sends the header. */
function backup_mark_used(int $line, array $info): void
{
    $GLOBALS['EMS_BACKUP_USED'][$line] = $info;
    if (!headers_sent()) {
        header('X-EMS-Backup: ' . backup_header_value($GLOBALS['EMS_BACKUP_USED']));
        header('Access-Control-Expose-Headers: X-Cache, Server-Timing, X-EMS-Backup');
    }
}
