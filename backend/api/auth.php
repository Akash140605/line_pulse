<?php
/**
 * auth.php — login, current user, passwords, server protection.
 *
 * GET                       (header X-EMS-Auth)  → { user, role, display, exp, enforce }
 * GET  ?users=1             (admin)              → { users: [{user, role, display}], enforce }
 * POST {action:'login', user, pass}              → { token, exp, user, role, display }
 * POST {action:'password', user, new, old?}      admin: any user; others: own password with the old one
 * POST {action:'enforce', on: true|false}        (admin) protect every API with the login
 * GET  ?security=1 (admin) · POST {action:'security', block:[ip|range], lock:{user:[ip|range]}}   (admin, 25-11-2026: lib/security.php)
 * POST {action:'tvuser', user, pass}              (admin) create a TV login (role tv: only the live line animation)
 * POST {action:'tvremove', user}                  (admin) remove a TV login
 * POST {action:'tvlink', user}                    switched off (16-11-2026): every TV logs in with its TV login
 * POST {action:'user', user, display, lines, oleEdit?, pass?} (admin) create a management login (read only; dept = writes the RCA of that department; oleEdit = may fill
 *                                                  the OLE entries of its lines) or change its name / lines;
 *                                                  lines [1,2] = only Line 1 & 2, [] = all lines; pass needed for a new login
 * POST {action:'userremove', user}                (admin) remove a management login
 * POST {action:'active', user, on}                (admin) switch a management or TV login off / on (off: cannot log in, open logins end)
 *      'user' also takes pages: [ids] (the pages this login may open, [] = Setup → Management view) and active
 * POSTs come only from the plant network with the X-EMS-Write header (same rule as the other settings).
 * 20-11-2026: logins, failed logins and every change made here are written to the activity log (lib/activity.php,
 * Setup → Activity log) — never a password. TV screens are not logged.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/clock.php';   // times in DB time (the PC clock can be wrong)

auth_cors();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }
$body = store_begin();
header('Cache-Control: no-store');
$tok = (string)($_SERVER['HTTP_X_EMS_AUTH'] ?? '');
$me = $tok !== '' ? auth_token_check($tok) : null;
sec_check($me);   // 25-11-2026: Line Pulse page only, blocked PCs, logins locked to their PCs (lib/security.php)

if ($body === null) {
    if (!$me) auth_fail(401, 'Please log in.');
    // 25-11-2026: the security alerts of the admin (bell + Setup → Security) and the e-mail settings
    if (!empty($_GET['alerts'])) {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin sees the security alerts.');
        $l = alert_list();
        echo json_encode(['alerts' => array_slice($l, 0, 200), 'unread' => count(array_filter($l, fn($a) => empty($a['read']))), 'mail' => mail_public()], JSON_UNESCAPED_UNICODE);
        exit;
    }
    // 25-11-2026: Setup → Security — the blocked PCs, the logins locked to their PCs and the security log (admin)
    if (!empty($_GET['security'])) {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can see the security settings.');
        $log = array_reverse((array)(store_file_read('security_log', ['log' => []])['log'] ?? []));
        $c = sec_conf(); $c['lock'] = (object)$c['lock'];
        echo json_encode(['conf' => $c, 'log' => array_slice($log, 0, 300), 'you' => sec_ip(), 'server' => (string)($_SERVER['SERVER_ADDR'] ?? '')], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if (!empty($_GET['users'])) {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can see the users.');
        $d = auth_data();
        $list = [];
        foreach ($d['users'] as $name => $u) $list[] = ['user' => $name, 'role' => $u['role'], 'display' => $u['display'] ?? $name, 'active' => auth_user_active($u),
            'lastLogin' => $u['lastLogin'] ?? null, 'createdAt' => $u['createdAt'] ?? null, 'changedAt' => $u['changedAt'] ?? null] + auth_user_info($u);
        echo json_encode(['users' => $list, 'enforce' => $d['enforce']]);
        exit;
    }
    // 24-11-2026: a screen that stays open (the TVs) keeps its login — a login older than a day gets a fresh 7-day token
    // here (the screen asks every few hours); a screen switched off for more than 7 days still logs in again
    $out = $me + ['enforce' => auth_data()['enforce']];
    if ((int)($me['exp'] ?? 0) - time() < AUTH_TTL - 86400) {
        $u = auth_data()['users'][$me['user']] ?? null;
        if ($u && auth_user_active($u)) $out['renew'] = auth_token_make((string)$me['user'], $u);
    }
    echo json_encode($out);
    exit;
}

$action = (string)($body['action'] ?? '');
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
try {
    if ($action === 'login') {
        // 20-11-2026: every login (and every failed one) goes to the activity log — never the password (lib/activity.php)
        $user = strtolower(trim((string)($body['user'] ?? '')));
        sec_check(null, $user);                                    // a login locked to its PCs cannot log in elsewhere
        if (auth_throttled($ip)) { activity_login_fail($user, 'throttled', (store_file_read('users')['users'] ?? [])[$user] ?? null); auth_fail(429, 'Too many wrong passwords. Wait 10 minutes and try again.'); }
        $pass = (string)($body['pass'] ?? '');
        $u = auth_data()['users'][$user] ?? null;
        if (!$u || !password_verify($pass, (string)$u['hash'])) {
            auth_note_fail($ip);
            if (auth_throttled($ip)) alert_raise('login-fail', 'User ID tried: ' . ($u ? $user : '(not a login)'), $u ? $user : '', $ip);
            elseif ($u && ($u['role'] ?? '') === 'admin') alert_raise('login-fail', 'Wrong password for the admin login', $user, $ip);
            activity_login_fail($user, $u ? 'wrong' : 'unknown', $u);
            usleep(400000);                                        // slows guessing down
            auth_fail(401, 'Wrong user ID or password.');
        }
        if (!auth_user_active($u)) { activity_login_fail($user, 'off', $u); auth_fail(403, 'This login is switched off. Ask the admin.'); }
        $t = auth_token_make($user, $u);
        try { store_update('users', function (array $d) use ($user) { if (isset($d['users'][$user])) $d['users'][$user]['lastLogin'] = ems_now(); return $d; }); } catch (Throwable $e) { /* not important */ }
        activity_login($user, $u);
        // 25-11-2026: the admin login on a PC it was never used on → alert
        if (($u['role'] ?? '') === 'admin') {
            $seen = array_filter((array)(store_file_read('security_log', ['log' => []])['log'] ?? []), fn($e) => ($e['ev'] ?? '') === 'login' && ($e['user'] ?? '') === $user);
            if ($seen && !array_filter($seen, fn($e) => ($e['ip'] ?? '') === $ip)) alert_raise('admin-new-pc', 'Admin login from ' . $ip, $user, $ip);
        }
        sec_note('login', 'ok', $user, (string)($u['role'] ?? ''));   // the security log has every login, TV logins too
        echo json_encode(['token' => $t['token'], 'exp' => $t['exp'], 'user' => $user, 'role' => $u['role'], 'display' => $u['display'] ?? $user] + auth_user_info($u));
        exit;
    }
    if (!$me) auth_fail(401, 'Please log in.');
    activity_watch($me, $body);                                    // password, logins, protection → activity log (who did what)
    if ($action === 'password') {
        $user = strtolower(trim((string)($body['user'] ?? $me['user'])));
        $new = (string)($body['new'] ?? '');
        if ($me['role'] !== 'admin') {
            if ($user !== $me['user']) auth_fail(403, 'You can change only your own password.');
            $cur = auth_data()['users'][$user] ?? null;
            if (!$cur || !password_verify((string)($body['old'] ?? ''), (string)$cur['hash'])) auth_fail(403, 'The current password is not right.');
        }
        if ($p = auth_password_problem($new)) store_fail(400, $p);
        $d = store_update('users', function (array $d) use ($user, $new) {
            if (!isset($d['users'][$user])) throw new InvalidArgumentException('Unknown user');
            $d['users'][$user]['hash'] = password_hash($new, PASSWORD_DEFAULT);
            $d['users'][$user]['v'] = (int)($d['users'][$user]['v'] ?? 1) + 1;   // older logins of this user end
            $d['users'][$user]['changedAt'] = ems_now();
            return $d;
        });
        $out = ['ok' => true, 'user' => $user];
        if ($user === $me['user']) { $t = auth_token_make($user, $d['users'][$user]); $out += ['token' => $t['token'], 'exp' => $t['exp']]; }
        echo json_encode($out);
        exit;
    }
    if ($action === 'tvlink') {
        // 16-11-2026: no more TV links (opening without a login) — every TV logs in with its TV login
        store_fail(400, 'TV links are switched off: log the TV in with its TV login (user ID + password).');
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        $user = auth_tv_name((string)($body['user'] ?? ''));
        $u = $user ? (auth_data()['users'][$user] ?? null) : null;
        if (!$u || ($u['role'] ?? '') !== 'tv') store_fail(400, 'Create the TV login first.');
        $t = auth_token_make($user, $u, null, AUTH_TV_TTL);
        echo json_encode(['ok' => true, 'user' => $user, 'key' => $t['token'], 'exp' => $t['exp']]);
        exit;
    }
    if ($action === 'tvuser' || $action === 'tvremove') {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        $user = auth_tv_name((string)($body['user'] ?? ''));
        if (!$user) store_fail(400, 'TV login name: 2–20 letters, digits, - or _');
        $cur = auth_data()['users'][$user] ?? null;
        if ($cur && ($cur['role'] ?? '') !== 'tv') store_fail(400, 'This name belongs to an admin or management login.');
        if ($action === 'tvremove') {
            store_update('users', function (array $d) use ($user) { unset($d['users'][$user]); return $d; });
            echo json_encode(['ok' => true, 'user' => $user]);
            exit;
        }
        $pass = (string)($body['pass'] ?? '');
        if ($p = auth_password_problem($pass)) store_fail(400, $p);
        store_update('users', function (array $d) use ($user, $pass) {
            $v = (int)($d['users'][$user]['v'] ?? 0) + 1;
            $d['users'][$user] = ['hash' => password_hash($pass, PASSWORD_DEFAULT), 'role' => 'tv', 'display' => 'TV screen', 'v' => $v, 'changedAt' => ems_now()];
            return $d;
        });
        echo json_encode(['ok' => true, 'user' => $user, 'role' => 'tv']);
        exit;
    }
    if ($action === 'user' || $action === 'userremove') {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        $user = auth_tv_name((string)($body['user'] ?? ''));
        if (!$user) store_fail(400, 'User ID: 2–20 letters, digits, - or _');
        $cur = auth_data()['users'][$user] ?? null;
        if ($cur && ($cur['role'] ?? '') !== 'management') store_fail(400, 'This user ID belongs to an admin or TV login.');
        if ($action === 'userremove') {
            if (!$cur) store_fail(400, 'Unknown user');
            store_update('users', function (array $d) use ($user) { unset($d['users'][$user]); return $d; });
            echo json_encode(['ok' => true, 'user' => $user]);
            exit;
        }
        $display = mb_substr(trim(strip_tags((string)($body['display'] ?? ''))), 0, 40);
        $lines = auth_clean_lines($body['lines'] ?? []);
        $oleEdit = array_key_exists('oleEdit', $body) ? !empty($body['oleEdit']) : null;   // null = keep
        $dept = array_key_exists('dept', $body) ? mb_substr(trim(strip_tags((string)$body['dept'])), 0, 40) : null;   // department for the RCA; null = keep
        $pages = array_key_exists('pages', $body) ? auth_user_pages(['role' => 'management', 'pages' => (array)$body['pages']]) : null;   // [] = pages of Setup; null = keep
        $active = array_key_exists('active', $body) ? !empty($body['active']) : null;
        $pass = (string)($body['pass'] ?? '');
        if (!$cur && $pass === '') store_fail(400, 'Give a password for the new login');
        if ($pass !== '' && ($p = auth_password_problem($pass))) store_fail(400, $p);
        store_update('users', function (array $d) use ($user, $display, $lines, $pass, $oleEdit, $dept, $pages, $active) {
            $u = $d['users'][$user] ?? ['role' => 'management', 'v' => 0];
            $u['role'] = 'management';
            $u['display'] = $display !== '' ? $display : ($u['display'] ?? $user);
            $u['lines'] = array_map('intval', $lines);
            if ($oleEdit !== null) $u['oleEdit'] = $oleEdit;
            if ($dept !== null) $u['dept'] = $dept;
            if ($pages !== null) $u['pages'] = $pages;
            if ($active !== null) $u['active'] = $active;
            if (empty($u['createdAt'])) $u['createdAt'] = ems_now();
            if ($pass !== '') { $u['hash'] = password_hash($pass, PASSWORD_DEFAULT); $u['v'] = (int)($u['v'] ?? 0) + 1; $u['changedAt'] = ems_now(); }
            $d['users'][$user] = $u;
            return $d;
        });
        echo json_encode(['ok' => true, 'user' => $user, 'role' => 'management', 'lines' => $lines, 'oleEdit' => auth_ole_edit(auth_data()['users'][$user] ?? []), 'dept' => auth_user_dept(auth_data()['users'][$user] ?? [])]);
        exit;
    }
    if ($action === 'active') {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        $user = auth_tv_name((string)($body['user'] ?? ''));
        $cur = $user ? (auth_data()['users'][$user] ?? null) : null;
        if (!$cur) store_fail(400, 'Unknown user');
        if (($cur['role'] ?? '') === 'admin') store_fail(400, 'An admin login cannot be switched off.');
        $on = !empty($body['on']);
        store_update('users', function (array $d) use ($user, $on) { $d['users'][$user]['active'] = $on; return $d; });
        echo json_encode(['ok' => true, 'user' => $user, 'active' => $on]);
        exit;
    }
    if (in_array($action, ['alertsRead', 'mailSave', 'mailTest'], true)) {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        if ($action === 'alertsRead') { alert_mark_read(array_map('strval', (array)($body['ids'] ?? [])), !empty($body['all'])); echo json_encode(['ok' => true]); exit; }
        if ($action === 'mailSave') { $pub = mail_save($body); sec_note('change', 'alert e-mail settings', (string)$me['user'], (string)$me['role']); echo json_encode(['ok' => true, 'mail' => $pub]); exit; }
        try { mail_send(mail_conf(), 'Line Pulse: test alert', "This is a test of the Line Pulse security alerts.\r\nSent by {$me['user']} at " . alert_time() . ".\r\n"); }
        catch (Throwable $e) { echo json_encode(['ok' => false, 'error' => $e->getMessage()]); exit; }
        echo json_encode(['ok' => true]); exit;
    }
    if ($action === 'security') {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        $block = array_values(array_filter(array_map(fn($x) => sec_clean_ip((string)$x), (array)($body['block'] ?? []))));
        $lock = [];
        foreach ((array)($body['lock'] ?? []) as $u => $ips) {
            $u = strtolower(trim((string)$u));
            $l = array_values(array_filter(array_map(fn($x) => sec_clean_ip((string)$x), (array)$ips)));
            if ($u !== '' && $l) $lock[$u] = $l;
        }
        // the admin cannot shut himself out: his own PC is never blocked, and a lock on his login keeps this PC
        if (sec_ip_in(sec_ip(), $block)) throw new InvalidArgumentException('That would block this PC (' . sec_ip() . ') — the one you are using.');
        if (isset($lock[$me['user']]) && !sec_ip_in(sec_ip(), $lock[$me['user']])) throw new InvalidArgumentException('Your own login must keep this PC (' . sec_ip() . ') in its list.');
        sec_save(['block' => $block, 'lock' => $lock]);
        sec_note('change', 'security settings', (string)$me['user'], (string)$me['role']);
        alert_raise('security', 'Blocked: ' . (implode(', ', $block) ?: 'none') . ' · locked logins: ' . (implode(', ', array_keys($lock)) ?: 'none'), (string)$me['user']);
        echo json_encode(['ok' => true, 'conf' => ['block' => $block, 'lock' => (object)$lock]]);
        exit;
    }
    if ($action === 'enforce') {
        if ($me['role'] !== 'admin') auth_fail(403, 'Only the admin can do this.');
        $on = !empty($body['on']);
        // 25-11-2026: protection stays on — every API needs a login (lib/auth.php auth_guard)
        if (!$on) throw new InvalidArgumentException('Server protection stays on: no data is given without a login.');
        store_update('users', function (array $d) use ($on) { $d['enforce'] = $on; return $d; });
        echo json_encode(['ok' => true, 'enforce' => $on]);
        exit;
    }
    store_fail(400, 'action must be login, password, enforce, security, alertsRead, mailSave, mailTest, user, userremove, active, tvuser, tvremove or tvlink');
} catch (InvalidArgumentException $e) {
    store_fail(400, $e->getMessage());
} catch (Throwable $e) {
    store_fail(500, 'Could not save: ' . $e->getMessage());
}
