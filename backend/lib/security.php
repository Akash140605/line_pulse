<?php
/**
 * API security (25-11-2026). The API answers only Line Pulse open in a browser of the plant — not a program that copies
 * the data (a script on another PC polled the live lines with a TV login and no page around it):
 *   1. the request must come from a Line Pulse page: its Origin / Referer is this server (any port), or this PC itself;
 *      a request with neither (curl, a Python / Node script) or from another site is refused (403)
 *   2. a PC the admin blocked (Setup → Security: IP address, or a range as 192.168.3.*) is refused
 *   3. a login the admin locked to its PCs (a TV login to its TV, the admin login to the admin PC) works only from those
 *   4. an office login (admin / management) is bound to the PC it logged in on — its key copied to another PC is refused
 *      (TV logins are not bound: a TV may get a new address and must keep its login)
 * Every refusal and every login (TV logins too) goes to the security log (Setup → Security), at most one line a minute
 * per PC and reason.
 */
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/alerts.php';   // the admin is told (bell + e-mail)

const SEC_LOG_MAX = 500;
const SEC_RATE_MAX = 900;   // API calls of one PC in one minute (a TV makes about 30, a busy office page a few hundred)

function sec_ip(): string { return store_client_ip(); }   // 25-11-2026: the visitor's own address through the remote door

/** Setup → Security saved (JSON file in the data folder) */
function sec_save(array $conf): void
{
    $lock = store_lock('security');
    try { store_file_write('security', $conf); } finally { store_unlock($lock); }
}

function sec_conf(): array
{
    // the admin's settings: { block: [ip|range], lock: { user: [ip|range] } } —
    // the JSON file only (read on every API call: never the database — the settings are saved here by Setup → Security)
    static $memo = null;
    if ($memo !== null) return $memo;
    $d = store_file_read('security', ['block' => [], 'lock' => []]);
    $list = fn($v) => array_values(array_slice(array_unique(array_filter(array_map(fn($x) => sec_clean_ip((string)$x), (array)$v))), 0, 100));
    $lock = [];
    foreach ((array)($d['lock'] ?? []) as $u => $ips) { $u = strtolower(trim((string)$u)); $l = $list($ips); if ($u !== '' && $l) $lock[$u] = $l; }
    return $memo = ['block' => $list($d['block'] ?? []), 'lock' => $lock];
}

/** an address or a range as the admin may write it: 192.168.3.71 · 192.168.3.* · ::1 ('' = not valid) */
function sec_clean_ip(string $s): string
{
    $s = strtolower(trim($s));
    if ($s === '') return '';
    if (filter_var($s, FILTER_VALIDATE_IP)) return $s;
    if (preg_match('/^(\d{1,3}\.){1,3}\*$/', $s)) return $s;
    return '';
}

/** $ip is one of the addresses / ranges of $list */
function sec_ip_in(string $ip, array $list): bool
{
    foreach ($list as $x) {
        if ($x === $ip) return true;
        if (substr($x, -1) === '*' && strncmp($ip, substr($x, 0, -1), strlen($x) - 1) === 0) return true;
    }
    return false;
}

/** the request comes from a Line Pulse page (this server's address on any port, or this PC itself) */
function sec_from_app(): bool
{
    if (PHP_SAPI === 'cli') return true;
    if (strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')) === 'cross-site') return false;
    $src = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($src === '' || $src === 'null') $src = (string)($_SERVER['HTTP_REFERER'] ?? '');
    if ($src === '' || $src === 'null') return false;
    $h = strtolower((string)parse_url($src, PHP_URL_HOST));
    if ($h === '') return false;
    $h = trim($h, '[]');
    $me = strtolower((string)preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')));
    $me = trim($me, '[]');
    $server = strtolower((string)($_SERVER['SERVER_ADDR'] ?? ''));
    if ($h === $me || ($server !== '' && $h === $server)) return true;
    // the server PC itself (localhost) — only when the request really comes from this PC
    $local = ['localhost', '127.0.0.1', '::1'];
    return in_array($h, $local, true) && in_array(sec_ip(), ['127.0.0.1', '::1', $server], true);
}

/** one line in the security log (refusals: at most one a minute per PC and reason) */
function sec_note(string $ev, string $why, string $user = '', string $role = ''): void
{
    try {
        $ip = sec_ip();
        if ($ev === 'refused') {
            $mark = sys_get_temp_dir() . '/ems_sec_' . md5($ip . '|' . $why . '|' . $user);
            if (is_file($mark) && filemtime($mark) > time() - 60) return;
            @touch($mark);
        }
        $path = (string)strtok((string)($_SERVER['REQUEST_URI'] ?? ''), '?');
        $e = ['time' => function_exists('activity_now') ? activity_now() : date('Y-m-d H:i:s'), 'ev' => $ev, 'why' => $why, 'ip' => mb_substr($ip, 0, 45),
            'user' => mb_substr($user, 0, 40), 'role' => $role, 'api' => mb_substr(basename($path), 0, 40), 'ua' => mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 160),
            'ref' => mb_substr((string)($_SERVER['HTTP_REFERER'] ?? ''), 0, 120)];
        if ($ev === 'refused') alert_raise($why, 'API ' . basename($path) . ($user !== '' ? " · login $user" : ''), $user, $ip);
        // a JSON file in the data folder (not the database: a log line must never slow a request down)
        $lock = store_lock('security_log');
        try {
            $l = (array)(store_file_read('security_log', ['log' => []])['log'] ?? []); $l[] = $e;
            store_file_write('security_log', ['log' => array_slice($l, -SEC_LOG_MAX)]);
        } finally { store_unlock($lock); }
    } catch (Throwable $x) { /* the log never breaks a request */ }
}

/**
 * The checks of every API call ($me = the login of the call, null = none). $loginUser = the user ID of a login being
 * made (auth.php). Refuses with 403 and the reason; returns quietly when the call may go on.
 */
function sec_check(?array $me, string $loginUser = ''): void
{
    if (PHP_SAPI === 'cli') return;
    $ip = sec_ip();
    $c = sec_conf();
    $user = $me['user'] ?? $loginUser;
    if (!sec_rate_ok($ip)) { sec_note('refused', 'too-many', (string)$user); auth_fail(429, 'Too many requests from this PC. Wait a minute.'); }
    if (sec_ip_in($ip, $c['block'])) { sec_note('refused', 'blocked', (string)$user); auth_fail(403, 'This PC is blocked by the admin.'); }
    if (!sec_from_app()) { sec_note('refused', 'no-page', (string)$user); auth_fail(403, 'Direct API calls are not allowed — open Line Pulse in the browser.'); }
    $lock = $c['lock'][strtolower((string)$user)] ?? [];
    if ($user !== '' && $lock && !sec_ip_in($ip, $lock)) { sec_note('refused', 'locked', (string)$user); auth_fail(403, 'This login works only on its own PC. Ask the admin.'); }
}

/** at most SEC_RATE_MAX calls a minute per PC (a counter file per PC and minute in the temp folder) */
function sec_rate_ok(string $ip): bool
{
    if ($ip === '' || in_array($ip, ['127.0.0.1', '::1'], true)) return true;   // this PC (backup jobs, tests)
    try {
        $f = sys_get_temp_dir() . '/ems_rate_' . md5($ip) . '_' . intdiv(time(), 60);
        $h = @fopen($f, 'c+');
        if (!$h) return true;
        flock($h, LOCK_EX);
        $n = (int)stream_get_contents($h) + 1;
        ftruncate($h, 0); rewind($h); fwrite($h, (string)$n);
        flock($h, LOCK_UN); fclose($h);
        if ($n === 1) foreach ((array)glob(sys_get_temp_dir() . '/ems_rate_*') as $old) {   // the counters of past minutes
            if ((int)substr(strrchr((string)$old, '_'), 1) < intdiv(time(), 60) - 1) @unlink($old);
        }
        return $n <= SEC_RATE_MAX;
    } catch (Throwable $e) { return true; }
}

/** the PC a key was made on: a short hash of its address (office logins only) */
function sec_ip_tag(?string $ip = null): string { return substr(hash('sha256', 'ems-ip|' . ($ip ?? sec_ip())), 0, 12); }
