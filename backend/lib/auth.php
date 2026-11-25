<?php
/**
 * Login for the dashboard: three roles.
 *   admin       — every page, can change targets, ₹ rates, shift, loss register, users
 *   management  — live lines, all lines summary with export, target comparison (read only); a management login
 *                 can be limited to some lines ("lines": [1, 2]) — e.g. a Line 1 & 2 login, a Line 3 & 4 login
 *   tv          — only the live line animation in TV mode (read only), for the screens at the lines
 *
 * Users live in data/users.json (password hashes only, never the passwords). A login returns a signed token
 * (HMAC-SHA256 with data/auth_secret.key) that the browser sends in the X-EMS-Auth header on every request.
 * Changing a password makes that user's older tokens invalid.
 *
 * Server protection ("enforce") can be switched on by the admin; while it is off, requests without a token are
 * still answered (so an old dashboard build keeps working until `npm run build` is done). A token that is sent
 * is always checked, and every change (POST) needs the admin role once a token is used.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') ini_set('display_errors', '0');   // php.ini has display_errors=On: a warning would break the JSON answer (it still goes to the log)
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/activity.php';
require_once __DIR__ . '/security.php';   // 25-11-2026: only Line Pulse pages, blocked PCs, logins locked to their PCs   // 20-11-2026: logins and changes are written to the activity log for the admin

const AUTH_ROLES = ['admin', 'management', 'tv'];

/** A TV login name: 2–20 lower-case letters, digits, - or _ . */
function auth_tv_name(string $u): ?string
{
    $u = strtolower(trim($u));
    return preg_match('/^[a-z0-9_-]{2,20}$/', $u) ? $u : null;
}
const AUTH_TTL = 7 * 24 * 3600;          // a login lasts 7 days on that browser
const AUTH_TV_TTL = 5 * 365 * 24 * 3600; // old TV links (key in the address) were made for 5 years — refused since 16-11-2026 (every screen logs in)
const AUTH_MAX_FAILS = 8;                // wrong passwords per IP …
const AUTH_FAIL_WINDOW = 600;            // … within 10 minutes → wait

function auth_b64(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function auth_unb64(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/** Secret key for the tokens (created once, kept in the protected data folder). */
function auth_secret(): string
{
    $f = store_dir() . '/auth_secret.key';
    if (is_file($f)) { $k = (string)file_get_contents($f); if (strlen($k) >= 32) return $k; }
    if (!is_dir(store_dir())) @mkdir(store_dir(), 0775, true);
    $k = bin2hex(random_bytes(32));
    file_put_contents($f, $k, LOCK_EX);
    return $k;
}

/** { users: { name: {hash, role, display, v} }, enforce: bool } */
function auth_data(): array
{
    $d = store_read('users', ['users' => [], 'enforce' => false]);
    $d['users'] = (array)($d['users'] ?? []);
    $d['enforce'] = !empty($d['enforce']);
    return $d;
}

function auth_token_make(string $user, array $u, ?int $now = null, int $ttl = AUTH_TTL): array
{
    $now = $now ?? time();
    $claims = ['u' => $user, 'r' => $u['role'], 'v' => (int)($u['v'] ?? 1), 'exp' => $now + $ttl];
    // 25-11-2026: an office login is bound to the PC it logged in on (a TV login is not: a TV may get a new address)
    if (($u['role'] ?? '') !== 'tv' && PHP_SAPI !== 'cli') $claims['ip'] = sec_ip_tag();
    $p = auth_b64(json_encode($claims));
    return ['token' => $p . '.' . auth_b64(hash_hmac('sha256', $p, auth_secret(), true)), 'exp' => $claims['exp']];
}

/** Claims of a valid token, or null (bad signature, expired, unknown user, password changed). */
function auth_token_check(string $token, ?int $now = null): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 2 || strlen($token) > 600) return null;
    [$p, $s] = $parts;
    if (!hash_equals(auth_b64(hash_hmac('sha256', $p, auth_secret(), true)), $s)) return null;
    $c = json_decode(auth_unb64($p), true);
    if (!is_array($c) || ($c['exp'] ?? 0) < ($now ?? time())) return null;
    // no login without typing (16-11-2026): a key that lives longer than a normal login (the old TV links) is refused
    if (($c['exp'] ?? 0) - ($now ?? time()) > AUTH_TTL + 86400) return null;
    $u = auth_data()['users'][$c['u'] ?? ''] ?? null;
    if (!$u || (int)($u['v'] ?? 1) !== (int)($c['v'] ?? 0) || $u['role'] !== ($c['r'] ?? '')) return null;
    if (!auth_user_active($u)) return null;                                     // switched off by the admin
    // 25-11-2026: an office key is bound to the PC it was made on — a key copied to another PC, or an older key without
    // its PC (made before this rule), is refused: log in once more
    if (($u['role'] ?? '') !== 'tv' && PHP_SAPI !== 'cli' && (!isset($c['ip']) || !hash_equals((string)$c['ip'], sec_ip_tag()))) return null;
    return ['user' => $c['u'], 'role' => $u['role'], 'display' => $u['display'] ?? $c['u'], 'exp' => $c['exp']] + auth_user_info($u);
}

/** A login switched off by the admin cannot log in (its open logins end at once). Admins are always on. */
function auth_user_active(array $u): bool { return ($u['role'] ?? '') === 'admin' || !array_key_exists('active', $u) || !empty($u['active']); }

/** Pages a management login may open ([] = the pages of Setup → Management view). */
function auth_user_pages(array $u): array
{
    if (($u['role'] ?? '') !== 'management') return [];
    $out = [];
    foreach ((array)($u['pages'] ?? []) as $p) { $p = (string)$p; if (preg_match('/^[a-z]{2,20}$/', $p) && !in_array($p, $out, true)) $out[] = $p; }
    return $out;
}

/** What the screen needs to know of a login (also in the users list for the admin). */
function auth_user_info(array $u): array
{
    return ['lines' => auth_user_lines($u), 'oleEdit' => auth_ole_edit($u), 'dept' => auth_user_dept($u), 'pages' => auth_user_pages($u)];
}

/**
 * Lines a login may see: [] = every line. Only management logins are limited (admin and TV see every line).
 * Stored as "lines": [1, 2] in users.json; read on every request, so a change by the admin works at once.
 */
function auth_user_lines(array $u): array
{
    if (($u['role'] ?? '') !== 'management') return [];
    $out = [];
    foreach ((array)($u['lines'] ?? []) as $l) { $n = (int)$l; if ($n >= 1 && $n <= 20 && !in_array((string)$n, $out, true)) $out[] = (string)$n; }
    sort($out);
    return $out;
}

/** Department of a management login (it writes the RCA of the losses of that department), '' = none. */
function auth_user_dept(array $u): string { return ($u['role'] ?? '') === 'management' ? mb_substr(trim(strip_tags((string)($u['dept'] ?? ''))), 0, 40) : ''; }

/** A management login that the admin allowed to fill the OLE entries (stoppage, rejection, rework) of its lines. */
function auth_ole_edit(array $u): bool { return ($u['role'] ?? '') === 'management' && !empty($u['oleEdit']); }

/** Cleans a list of line numbers sent by the admin; [] = all lines. */
function auth_clean_lines($v): array
{
    $out = [];
    foreach ((array)$v as $l) { $n = filter_var($l, FILTER_VALIDATE_INT); if ($n !== false && $n >= 1 && $n <= 20 && !in_array((string)$n, $out, true)) $out[] = (string)$n; }
    sort($out);
    return $out;
}

/**
 * Keeps a line-limited login to its lines:
 *  - a request for one line (?line= or ?lineOnly=) of another line is refused (403);
 *  - a single-line request without ?line= gets the login's first line;
 *  - the all-lines answers (all_lines.php, live_lines.php) leave the other lines out (auth_line_ok) and get their own cache key.
 */
const AUTH_MULTI_LINE = ['all_lines.php', 'live_lines.php', 'ole.php', 'ui_settings.php', 'auth.php'];
function auth_line_scope(?array $me, ?string $script = null): void
{
    $GLOBALS['EMS_LINES_ALLOWED'] = null;
    if (!$me || empty($me['lines'])) return;
    $ok = array_map('intval', $me['lines']);
    $GLOBALS['EMS_LINES_ALLOWED'] = $ok;
    $script = $script ?? basename((string)($_SERVER['SCRIPT_NAME'] ?? ''));
    $refuse = fn(int $n) => auth_fail(403, "This login can see only Line " . implode(' & ', $ok) . " (not Line $n).");
    if (isset($_GET['lineOnly']) && $_GET['lineOnly'] !== '' && !in_array((int)$_GET['lineOnly'], $ok, true)) $refuse((int)$_GET['lineOnly']);
    if (in_array($script, AUTH_MULTI_LINE, true)) { $_GET['_scope'] = implode(',', $ok); return; }   // own cache key
    if (!isset($_GET['line']) || $_GET['line'] === '') $_GET['line'] = (string)$ok[0];
    elseif (!in_array((int)$_GET['line'], $ok, true)) $refuse((int)$_GET['line']);
}

/** True when the logged-in user may see line $id (always true for admin, TV and unlimited logins). */
function auth_line_ok(int $id): bool
{
    $a = $GLOBALS['EMS_LINES_ALLOWED'] ?? null;
    return $a === null || in_array($id, $a, true);
}

function auth_cors(): void
{
    if (headers_sent()) return;
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    // 25-11-2026: no "*" any more — only a Line Pulse page of this server (another site's page cannot read the API)
    if ($origin && store_origin_ok($origin) && sec_from_app()) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-EMS-Write, X-EMS-Auth');
    header('Access-Control-Max-Age: 600');
}

function auth_fail(int $code, string $msg): void
{
    if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
    $GLOBALS['EMS_FAIL_MSG'] = $msg;                              // the activity log notes why a change was refused
    http_response_code($code);
    echo json_encode(['error' => $msg, 'auth' => $code === 401 ? 'login' : 'denied']);
    exit;
}

/**
 * First line of every API: answers the CORS preflight, checks the login and the role.
 * $need = 'view' (any logged-in user) or 'admin'; $postOk = true lets the endpoint check POSTs of other roles itself. Returns the user (or null when protection is off and no token came).
 */
function auth_guard(string $need = 'view', bool $postOk = false): ?array
{
    if (PHP_SAPI === 'cli') return null;                          // command-line jobs (backup sync, tests)
    auth_cors();
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($m === 'OPTIONS') { http_response_code(204); exit; }
    $tok = (string)($_SERVER['HTTP_X_EMS_AUTH'] ?? '');
    $me = $tok !== '' ? auth_token_check($tok) : null;
    if ($tok !== '' && !$me) auth_fail(401, 'Your login has expired. Please log in again.');
    sec_check($me);                                               // 25-11-2026: Line Pulse page, blocked PC, login locked to its PCs (lib/security.php)
    if ($m === 'POST') activity_watch($me);                       // every change (also a refused one) → activity log (lib/activity.php)
    if (!$me) {
        auth_fail(401, 'Please log in.');                          // 25-11-2026: always — no data without a login (protection cannot be switched off)
    }
    // $postOk: the endpoint itself decides who may change what (ole.php: line logins allowed by the admin)
    if (($need === 'admin' || ($m === 'POST' && !$postOk)) && $me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
    auth_line_scope($me);
    return $me;
}

/* ───────────── login throttle ───────────── */

function auth_throttled(string $ip, ?int $now = null): bool
{
    $now = $now ?? time();
    $f = store_read('auth_fail');
    $list = array_filter((array)($f[$ip] ?? []), fn($t) => $t > $now - AUTH_FAIL_WINDOW);
    return count($list) >= AUTH_MAX_FAILS;
}

function auth_note_fail(string $ip, ?int $now = null): void
{
    $now = $now ?? time();
    store_update('auth_fail', function (array $d) use ($ip, $now) {
        foreach ($d as $k => $list) { $d[$k] = array_values(array_filter((array)$list, fn($t) => $t > $now - AUTH_FAIL_WINDOW)); if (!$d[$k]) unset($d[$k]); }
        $d[$ip][] = $now;
        return $d;
    });
}

/** Password rules: 8–72 characters, at least one letter and one digit. Returns an error text or null. */
function auth_password_problem(string $p): ?string
{
    if (strlen($p) < 8) return 'Password must have at least 8 characters';
    if (strlen($p) > 72) return 'Password is too long (max 72 characters)';
    if (!preg_match('/[A-Za-z]/', $p) || !preg_match('/\d/', $p)) return 'Password needs at least one letter and one digit';
    return null;
}
