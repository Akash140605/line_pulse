<?php
// Login tokens, password rules and the login throttle (lib/auth.php). Uses a temporary data folder.
declare(strict_types=1);
$GLOBALS['EMS_STORE_DIR'] = sys_get_temp_dir() . '/ems_auth_test_' . getmypid();
require_once __DIR__ . '/../lib/auth.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }

store_update('users', fn() => ['users' => [
    'admin' => ['hash' => password_hash('Admin123', PASSWORD_DEFAULT), 'role' => 'admin', 'display' => 'Admin', 'v' => 1],
    'management' => ['hash' => password_hash('Mgmt1234', PASSWORD_DEFAULT), 'role' => 'management', 'display' => 'Management', 'v' => 1],
], 'enforce' => false]);

$t = auth_token_make('management', auth_data()['users']['management']);
$me = auth_token_check($t['token']);
ok('valid token → user and role', [$me['user'], $me['role']], ['management', 'management']);
ok('token lasts 7 days', $t['exp'] - time() >= AUTH_TTL - 5, true);
ok('expired token refused', auth_token_check($t['token'], time() + AUTH_TTL + 10), null);
[$p, $s] = explode('.', $t['token']);
$forged = auth_b64(json_encode(['u' => 'management', 'r' => 'admin', 'v' => 1, 'exp' => time() + 999])) . '.' . $s;
ok('changed role in the token refused', auth_token_check($forged), null);
// 24-11-2026: renewal (api/auth.php GET): a login older than a day gets a fresh 7-day token; the fresh one is valid and later
$old = auth_token_make('management', auth_data()['users']['management'], time() - 2 * 86400);
$oc = auth_token_check($old['token']);
ok('2-day-old login still valid and due for renewal', [$oc !== null, ((int)$oc['exp'] - time()) < AUTH_TTL - 86400], [true, true]);
$new = auth_token_make('management', auth_data()['users']['management']);
ok('renewed token valid and later', [auth_token_check($new['token']) !== null, $new['exp'] > $old['exp']], [true, true]);
ok('garbage refused', [auth_token_check('abc'), auth_token_check('a.b.c'), auth_token_check('')], [null, null, null]);

// a password change (v + 1) ends older logins
store_update('users', function ($d) { $d['users']['management']['v'] = 2; return $d; });
ok('old token after password change refused', auth_token_check($t['token']), null);
$t2 = auth_token_make('management', auth_data()['users']['management']);
ok('new token works', auth_token_check($t2['token'])['user'], 'management');

// role change in users.json also ends the token
store_update('users', function ($d) { $d['users']['management']['role'] = 'admin'; return $d; });
ok('role changed on the server → old token refused', auth_token_check($t2['token']), null);

ok('password rules', [auth_password_problem('short1'), auth_password_problem('longenough'), auth_password_problem('12345678'), auth_password_problem('Good1234')],
   ['Password must have at least 8 characters', 'Password needs at least one letter and one digit', 'Password needs at least one letter and one digit', null]);

// throttle: 8 wrong passwords in 10 minutes from one IP
$now = time();
for ($i = 0; $i < 7; $i++) auth_note_fail('10.0.0.9', $now);
ok('7 fails: still allowed', auth_throttled('10.0.0.9', $now), false);
auth_note_fail('10.0.0.9', $now);
ok('8 fails: wait', auth_throttled('10.0.0.9', $now), true);
ok('other IP not affected', auth_throttled('10.0.0.10', $now), false);
ok('after 10 minutes allowed again', auth_throttled('10.0.0.9', $now + AUTH_FAIL_WINDOW + 1), false);

ok('secret key kept', strlen(auth_secret()) >= 32 && auth_secret() === auth_secret(), true);
array_map('unlink', glob($GLOBALS['EMS_STORE_DIR'] . '/*')); rmdir($GLOBALS['EMS_STORE_DIR']);
ok('tv is a role', in_array('tv', AUTH_ROLES, true), true);
ok('tv login name rules', [auth_tv_name(' TV-Line3 '), auth_tv_name('x'), auth_tv_name('a b'), auth_tv_name('tv_1')], ['tv-line3', null, null, 'tv_1']);
store_update('users', function ($d) { $d['users']['tv'] = ['hash' => password_hash('Tv123456', PASSWORD_DEFAULT), 'role' => 'tv', 'display' => 'TV screen', 'v' => 1]; return $d; });
$tt = auth_token_make('tv', auth_data()['users']['tv']);
ok('tv token → role tv', auth_token_check($tt['token'])['role'], 'tv');
$k = auth_token_make('tv', auth_data()['users']['tv'], null, AUTH_TV_TTL);
ok('old TV link key (5 years) refused: every screen logs in', [$k['exp'] - time() > 4 * 365 * 24 * 3600, auth_token_check($k['token'])], [true, null]);
ok('a normal TV login still works', auth_token_check(auth_token_make('tv', auth_data()['users']['tv'])['token'])['role'], 'tv');
store_update('users', function ($d) { $d['users']['tv']['v'] = 2; return $d; });
ok('TV login ends when the TV login is reset', auth_token_check($tt['token']), null);
// line-limited management logins
ok('lines: only management is limited, cleaned and sorted', [auth_user_lines(['role' => 'management', 'lines' => [2, '1', 1, 99, 'x']]), auth_user_lines(['role' => 'admin', 'lines' => [1]]), auth_user_lines(['role' => 'management'])], [['1', '2'], [], []]);
ok('clean lines from the admin', auth_clean_lines(['4', 3, 'a', 0, 3]), ['3', '4']);
$_SERVER['SCRIPT_NAME'] = '/api/day_overview.php';
$_GET = ['line' => '2']; auth_line_scope(['role' => 'management', 'lines' => ['1', '2']]);
ok('own line allowed', [auth_line_ok(2), auth_line_ok(3), $_GET['line']], [true, false, '2']);
$_GET = []; auth_line_scope(['role' => 'management', 'lines' => ['3', '4']]);
ok('no line asked → first own line', $_GET['line'], '3');
$_GET = ['line' => '1', 'lineOnly' => '3']; auth_line_scope(['role' => 'management', 'lines' => ['3', '4']], 'all_lines.php');
ok('all-lines answer: own cache key, line=1 not refused there', [$_GET['_scope'], auth_line_ok(1), auth_line_ok(4)], ['3,4', false, true]);
$_GET = []; auth_line_scope(['role' => 'management', 'lines' => []]);
ok('unlimited login sees every line', [auth_line_ok(1), auth_line_ok(4), isset($_GET['line'])], [true, true, false]);
auth_line_scope(null);
ok('no login (protection off) sees every line', auth_line_ok(3), true);
// switched off by the admin → its token ends; pages of a login
store_update('users', function ($d) { $d['users']['m2'] = ['hash' => password_hash('Mgmt1234', PASSWORD_DEFAULT), 'role' => 'management', 'display' => 'M2', 'v' => 1, 'pages' => ['dash', 'rca', 'BAD!', 'rca'], 'lines' => [3]]; return $d; });
$t3 = auth_token_make('m2', auth_data()['users']['m2']);
ok('login with its pages and lines', [auth_token_check($t3['token'])['pages'], auth_token_check($t3['token'])['lines']], [['dash', 'rca'], ['3']]);
store_update('users', function ($d) { $d['users']['m2']['active'] = false; return $d; });
ok('switched off → token refused', auth_token_check($t3['token']), null);
ok('admin is always active', auth_user_active(['role' => 'admin', 'active' => false]), true);
store_update('users', function ($d) { $d['users']['m2']['active'] = true; return $d; });
ok('switched on again → token works', auth_token_check($t3['token'])['user'], 'm2');
// remove the temporary data folder
$rm = function (string $d) use (&$rm) { foreach (array_diff(scandir($d) ?: [], ['.', '..']) as $f) { $p = "$d/$f"; is_dir($p) ? $rm($p) : @unlink($p); } @rmdir($d); };
$rm($GLOBALS['EMS_STORE_DIR']);
echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
