<?php
/**
 * Small shared store for the dashboard's own settings (NOT production data):
 *   data/line_settings.json  — shift / lunch window / tea breaks and model targets, per line
 *   data/losses_line<N>.json — loss register of a line
 * Every screen (office PC, TV, phone) reads the same values. The line databases are never written.
 *
 * Files are written under an exclusive lock and replaced in one step (write to a temp file, then rename),
 * so two people saving at once never leave a half-written file.
 */
declare(strict_types=1);

const STORE_DIR_DEFAULT = __DIR__ . '/../data';
// 25-11-2026: the plant's day when a line has no shift saved — lunch 13:00–13:30 and the tea break 18:30–18:45 (11.25 h, as
// the supervisors' morning entry and the plant's SAWM KPI file count it); every screen and report gets the same time
const SHIFT_DEFAULT = ['start' => '09:00', 'end' => '21:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30', 'breaks' => [['name' => 'Tea break', 'start' => '18:30', 'end' => '18:45']]];

function store_dir(): string { return $GLOBALS['EMS_STORE_DIR'] ?? STORE_DIR_DEFAULT; }

function store_path(string $name): string
{
    if (!preg_match('/^[a-z0-9_]+$/', $name)) throw new InvalidArgumentException('bad store name');
    return store_dir() . '/' . $name . '.json';
}

/* The settings are kept in SQL Server (lib/appdb.php, database EMS_LinePulse_App) when it answers; the JSON file of
 * every store is kept up to date beside it, so the screens go on when SQL Server is down. */
require_once __DIR__ . '/appdb.php';

/** JSON file: current content ($default when it does not exist yet). */
function store_file_read(string $name, array $default = []): array
{
    $f = store_path($name);
    if (!is_file($f)) return $default;
    $h = fopen($f, 'r');
    if (!$h) return $default;
    flock($h, LOCK_SH);
    $raw = stream_get_contents($h);
    flock($h, LOCK_UN); fclose($h);
    $j = json_decode((string)$raw, true);
    return is_array($j) ? $j : $default;
}

/** JSON file: write in one step (temp file, then rename). */
function store_file_write(string $name, array $new): void
{
    $f = store_path($name);
    $tmp = $f . '.tmp' . getmypid();
    if (file_put_contents($tmp, json_encode($new, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) throw new RuntimeException('cannot write');
    if (!@rename($tmp, $f)) { @copy($tmp, $f); @unlink($tmp); }
}

function store_pending_file(string $name): string { return store_dir() . '/' . $name . '.pending'; }

/**
 * The database row of a store, brought up to date first: a store not in the database yet is copied from its JSON file
 * (the first start), and a save made while SQL Server was down (.pending) is copied in now. Inside a transaction.
 */
function store_db_current(PDO $a, string $name, array $default): array
{
    $row = appdb_get($a, $name, true);
    $pending = is_file(store_pending_file($name));
    if (!$row || $pending) {
        $f = store_path($name);
        if (is_file($f)) {
            $doc = store_file_read($name, $default);
            $rev = appdb_put($a, $name, $doc, $row);
            $row = ['doc' => $doc, 'rev' => $rev];
        }
    }
    return $row ?: ['doc' => $default, 'rev' => 0];
}

function store_synced_file(string $name): string { return store_dir() . '/' . $name . '.indb'; }
const STORE_RECHECK_SECONDS = 60;   // the JSON copy is compared with the database at most once a minute per store

/**
 * Current content of a store ($default when it does not exist yet).
 * Fast path: the JSON copy, which every save writes right after the database (one web server) — the database is asked
 * at most once a minute per store (a change made in SSMS shows within a minute), at the first start (copy JSON → database)
 * and after a save made while SQL Server was down (.pending).
 */
function store_read(string $name, array $default = []): array
{
    if (appdb_configured()) {
        $mark = store_synced_file($name);
        $fresh = is_file($mark) && time() - (int)@filemtime($mark) < STORE_RECHECK_SECONDS && !is_file(store_pending_file($name)) && is_file(store_path($name));
        if (!$fresh && ($a = appdb())) {
            try {
                $lock = store_lock($name);
                try {
                    appdb_begin($a);
                    $cur = store_db_current($a, $name, $default);
                    appdb_commit($a);
                } catch (Throwable $e) { appdb_rollback($a); throw $e; } finally { store_unlock($lock); }
                @unlink(store_pending_file($name));
                if ($cur['rev'] > 0) {
                    $file = store_file_read($name, []);
                    if ($file !== $cur['doc']) { try { store_file_write($name, $cur['doc']); } catch (Throwable $e) { /* the copy only */ } }
                    @touch($mark);
                }
                return $cur['doc'];
            } catch (Throwable $e) { /* SQL Server stopped answering: the JSON file */ }
        }
    }
    return store_file_read($name, $default);
}

function store_lock(string $name)
{
    $dir = store_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) throw new RuntimeException('data folder cannot be created');
    $lock = fopen($dir . '/' . $name . '.lock', 'c');
    if (!$lock) throw new RuntimeException('lock file cannot be opened');
    flock($lock, LOCK_EX);
    return $lock;
}
function store_unlock($lock): void { flock($lock, LOCK_UN); fclose($lock); }

/** Read – change – write under one exclusive lock. $fn gets the current data and returns the new data. */
function store_update(string $name, callable $fn, array $default = []): array
{
    $lock = store_lock($name);
    try {
        $a = appdb();
        if ($a) {
            $saved = false;
            try {
                appdb_begin($a);
                $cur = store_db_current($a, $name, $default);
                $new = $fn($cur['doc']);
                appdb_put($a, $name, $new, $cur['rev'] > 0 ? $cur : null);
                appdb_commit($a);
                $saved = true;
            } catch (InvalidArgumentException | DomainException $e) {
                appdb_rollback($a); throw $e;              // a refused change (validation): nothing saved
            } catch (Throwable $e) {
                appdb_rollback($a);                         // SQL Server failed: save in the JSON file and mark it
            }
            if ($saved) {
                @unlink(store_pending_file($name));
                try { store_file_write($name, $new); @touch(store_synced_file($name)); } catch (Throwable $e) { /* the copy only */ }
                return $new;
            }
        }
        $cur = store_file_read($name, $default);
        $new = $fn($cur);
        store_file_write($name, $new);
        if (appdb_configured()) { @touch(store_pending_file($name)); @unlink(store_synced_file($name)); }   // copied into SQL Server when it answers again
        return $new;
    } finally {
        store_unlock($lock);
    }
}

/* ───────────── validation ───────────── */

function store_hm(?string $v): ?int
{
    if ($v === null || $v === '') return null;
    if (!preg_match('/^(\d{1,2}):([0-5]\d)$/', trim($v), $m) || (int)$m[1] > 24) return null;
    $min = (int)$m[1] * 60 + (int)$m[2];
    return $min <= 1440 ? $min : null;
}

/** Shift with an optional lunch window. Returns the clean shift or throws with a readable message. */
function shift_clean(array $s): array
{
    $st = store_hm($s['start'] ?? null); $en = store_hm($s['end'] ?? null);
    if ($st === null || $en === null) throw new InvalidArgumentException('Shift start and end must be times like 09:00');
    if ($en <= $st) throw new InvalidArgumentException('Shift end must be after shift start');
    $ls = store_hm($s['lunchStart'] ?? null); $le = store_hm($s['lunchEnd'] ?? null);
    if (($ls === null) !== ($le === null)) throw new InvalidArgumentException('Give both lunch start and lunch end, or neither');
    if ($ls !== null) {
        if ($le <= $ls) throw new InvalidArgumentException('Lunch end must be after lunch start');
        if ($ls <= $st || $le >= $en) throw new InvalidArgumentException('Lunch must lie inside the shift (two segments: before and after lunch)');
    }
    $fmt = fn($m) => sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    // tea breaks and other fixed breaks: inside the shift, not over lunch or each other, at most 6 (no working time, like lunch)
    $breaks = [];
    $raw = $s['breaks'] ?? [];
    if (!is_array($raw)) throw new InvalidArgumentException('Breaks must be a list');
    if (count($raw) > 6) throw new InvalidArgumentException('At most 6 breaks a line');
    foreach (array_values($raw) as $i => $b) {
        $b = (array)$b; $n = $i + 1;
        $a = store_hm(isset($b['start']) ? (string)$b['start'] : null); $z = store_hm(isset($b['end']) ? (string)$b['end'] : null);
        if ($a === null || $z === null) throw new InvalidArgumentException("Break $n: start and end must be times like 11:00");
        if ($z <= $a) throw new InvalidArgumentException("Break $n: end must be after start");
        if ($a < $st || $z > $en) throw new InvalidArgumentException("Break $n must lie inside the shift");
        if ($ls !== null && $a < $le && $z > $ls) throw new InvalidArgumentException("Break $n overlaps lunch");
        $name = mb_substr(trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', (string)($b['name'] ?? '')) ?? ''), 0, 30);
        $breaks[] = ['name' => $name !== '' ? $name : 'Break', 'start' => $fmt($a), 'end' => $fmt($z), '_a' => $a, '_z' => $z];
    }
    usort($breaks, fn($p, $q) => $p['_a'] <=> $q['_a']);
    for ($i = 1; $i < count($breaks); $i++) if ($breaks[$i]['_a'] < $breaks[$i - 1]['_z']) throw new InvalidArgumentException('Two breaks overlap (' . $breaks[$i - 1]['name'] . ' and ' . $breaks[$i]['name'] . ')');
    $breaks = array_map(fn($b) => ['name' => $b['name'], 'start' => $b['start'], 'end' => $b['end']], $breaks);
    return ['start' => $fmt($st), 'end' => $fmt($en), 'lunchStart' => $ls === null ? null : $fmt($ls), 'lunchEnd' => $le === null ? null : $fmt($le), 'breaks' => $breaks];
}

/** One model target: target cycle in seconds per piece (pieces per hour = 3600 ÷ cycle). */
function target_clean(array $t): array
{
    $mm = filter_var($t['mmId'] ?? null, FILTER_VALIDATE_INT);
    if ($mm === false || $mm < 0) throw new InvalidArgumentException('mmId must be a model id');
    $cycle = $t['cycle'] ?? null;
    if ($cycle === null || $cycle === '') return ['mmId' => $mm, 'cycle' => null];
    if (!is_numeric($cycle) || (float)$cycle < 1 || (float)$cycle > 3600) throw new InvalidArgumentException('Target cycle must be between 1 and 3600 seconds');
    return ['mmId' => $mm, 'cycle' => round((float)$cycle, 2),
            'model' => mb_substr(trim((string)($t['model'] ?? '')), 0, 120), 'company' => mb_substr(trim((string)($t['company'] ?? '')), 0, 120),
            'manual' => !empty($t['manual'])]   // manual = locked by the admin: wins over the automatic Method A + 3 s target
         + (($t['source'] ?? '') === 'master' ? ['source' => 'master'] : []);   // set from the model master (Model master page)
}

/**
 * Rupee rates of a line, used to convert lost production into money:
 *   pcValue  ₹ per piece (value of one piece not made; default for every model)
 *   hourCost ₹ per line-hour (manpower + overhead of the line for one hour)
 *   values   { mmId: ₹ per piece } for models with their own value
 * Empty / 0 = not set.
 */
function money_clean(array $m): array
{
    $num = function ($v, string $what, float $max) {
        if ($v === null || $v === '') return null;
        if (!is_numeric($v) || (float)$v < 0 || (float)$v > $max) throw new InvalidArgumentException("$what must be a number from 0 to " . number_format($max, 0, '.', ''));
        return (float)$v > 0 ? round((float)$v, 2) : null;
    };
    $out = ['pcValue' => $num($m['pcValue'] ?? null, 'Value per piece', 10000000), 'hourCost' => $num($m['hourCost'] ?? null, 'Line cost per hour', 100000000), 'values' => []];
    $vals = (array)($m['values'] ?? []);
    if (count($vals) > 5000) throw new InvalidArgumentException('Too many model values');
    foreach ($vals as $mm => $v) {
        if (filter_var($mm, FILTER_VALIDATE_INT) === false || (int)$mm < 0) throw new InvalidArgumentException('Model values need model ids');
        $x = $num($v, 'Model value per piece', 10000000);
        if ($x !== null) $out['values'][(string)(int)$mm] = $x;
    }
    return $out;
}

/** One loss entry. Returns the clean entry or throws. */
function loss_clean(array $e): array
{
    $d = (string)($e['date'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !strtotime($d)) throw new InvalidArgumentException('date must be YYYY-MM-DD');
    $h = filter_var($e['hour'] ?? null, FILTER_VALIDATE_INT);
    if ($h === false || $h < 0 || $h > 23) throw new InvalidArgumentException('hour must be 0–23');
    $min = filter_var($e['minutes'] ?? null, FILTER_VALIDATE_INT);
    if ($min === false || $min < 1 || $min > 600) throw new InvalidArgumentException('minutes must be 1–600');
    $reason = trim((string)($e['reason'] ?? ''));
    if ($reason === '') throw new InvalidArgumentException('reason is required');
    $mm = $e['mmId'] ?? null;
    $mm = ($mm === null || $mm === '') ? null : filter_var($mm, FILTER_VALIDATE_INT);
    if ($mm === false) throw new InvalidArgumentException('mmId must be a model id');
    $from = store_hm($e['from'] ?? null); $to = store_hm($e['to'] ?? null);
    $fmt = fn($m) => $m === null ? null : sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    $id = preg_match('/^[A-Za-z0-9_-]{4,40}$/', (string)($e['id'] ?? '')) ? (string)$e['id'] : bin2hex(random_bytes(8));
    $cut = fn($k, $n) => mb_substr(trim((string)($e[$k] ?? '')), 0, $n);
    return ['id' => $id, 'date' => $d, 'hour' => $h, 'minutes' => $min, 'reason' => mb_substr($reason, 0, 120),
            'dept' => $cut('dept', 80), 'person' => $cut('person', 80), 'mmId' => $mm, 'model' => $cut('model', 120),
            'remarks' => $cut('remarks', 300), 'from' => $fmt($from), 'to' => $fmt($to)];
}

/* ───────────── who may write ───────────── */

/** Private / local network address? (writes are only accepted from the plant network) */
function store_private_ip(string $ip): bool
{
    if ($ip === '::1' || $ip === '127.0.0.1') return true;
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false
        && filter_var($ip, FILTER_VALIDATE_IP) !== false;
}

/** Browser origin of the page that sends the change: none (curl), or a page on a local / plant address. */
function store_origin_ok(?string $origin): bool
{
    if ($origin === null || $origin === '') return true;     // not sent by a browser page (curl, same-origin GET)
    if ($origin === 'null') return false;                    // sandboxed / file page
    $host = parse_url($origin, PHP_URL_HOST);
    if (!$host) return false;
    if ($host === 'localhost' || substr($host, -6) === '.local' || substr($host, -10) === '.localhost') return true;
    return filter_var($host, FILTER_VALIDATE_IP) !== false && store_private_ip($host);
}

/** Common start of the two settings endpoints: headers, preflight, method and network checks. Returns the JSON body for POST. */
function store_begin(): ?array
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    // 25-11-2026: only a Line Pulse page of this server gets the header (lib/security.php sec_from_app)
    if ($origin && store_origin_ok($origin) && (!function_exists('sec_from_app') || sec_from_app())) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-EMS-Write, X-EMS-Auth');
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($m === 'OPTIONS') { http_response_code(204); exit; }
    if ($m === 'GET') return null;
    if ($m !== 'POST') store_fail(405, 'Only GET and POST');
    if (!store_private_ip($_SERVER['REMOTE_ADDR'] ?? '')) store_fail(403, 'Changes are accepted only from the plant network');
    if (!store_origin_ok($origin)) store_fail(403, 'Changes are accepted only from the dashboard');
    if (($_SERVER['HTTP_X_EMS_WRITE'] ?? '') !== '1') store_fail(403, 'Missing X-EMS-Write header');
    $raw = file_get_contents('php://input');
    if (strlen((string)$raw) > 2_000_000) store_fail(413, 'Request too large');
    $j = json_decode((string)$raw, true);
    if (!is_array($j)) store_fail(400, 'Body must be JSON');
    return $j;
}

/**
 * GET answer of a settings file. It goes gzip-compressed (the model master: 230 KB → about 25 KB) and with an ETag:
 * the browser keeps its copy and asks again every time, and when nothing changed it gets a short "304 Not Modified"
 * instead of the whole file (the model master alone was 500 MB a day across the screens).
 */
function store_send($json): void
{
    if (!is_string($json)) store_fail(500, 'The answer could not be made');   // json_encode failed
    $tag = 'W/"' . substr(sha1($json), 0, 20) . '"';
    if (!headers_sent()) {
        header('Cache-Control: no-cache');   // always checked with the server, so a change shows at once (as no-store did)
        header('ETag: ' . $tag);
    }
    $asked = array_map('trim', explode(',', (string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')));
    if (in_array($tag, $asked, true)) { if (!headers_sent()) http_response_code(304); return; }
    if (strlen($json) > 1024 && function_exists('ob_gzhandler') && !ini_get('zlib.output_compression')
        && !in_array('ob_gzhandler', ob_list_handlers(), true)) ob_start('ob_gzhandler');
    echo $json;
}

function store_fail(int $code, string $msg): void
{
    $GLOBALS['EMS_FAIL_MSG'] = $msg;   // the activity log notes why a change was not saved (lib/activity.php)
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
