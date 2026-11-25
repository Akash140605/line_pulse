<?php
// Activity log (lib/activity.php): events written and read back, the short "what" lines of a change (before → after),
// nothing secret in it, TV screens left out. Uses a temporary data folder and never a database.
declare(strict_types=1);
$GLOBALS['EMS_APPDB_OFF'] = true;                                   // never the SQL Server settings database
$GLOBALS['EMS_STORE_DIR'] = sys_get_temp_dir() . '/ems_activity_test_' . getmypid();
$GLOBALS['EMS_CLOCK_FILE'] = $GLOBALS['EMS_STORE_DIR'] . '/clock.json';
@mkdir($GLOBALS['EMS_STORE_DIR'], 0775, true);
file_put_contents($GLOBALS['EMS_CLOCK_FILE'], json_encode(['off' => 0, 'next' => time() + 900]));
require_once __DIR__ . '/../lib/activity.php';
$fail = 0;
function ok(string $n, bool $c, $info = '') { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $n . ($c ? '' : '  ' . json_encode($info, JSON_UNESCAPED_UNICODE)) . "\n"; if (!$c) $fail++; }

ok('time: India time Y-m-d H:i:s', (bool)preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/', activity_now()));
ok('time: +05:30 from UTC', activity_now(0) === '1970-01-01 05:30:00', activity_now(0));
ok('text: tags and control characters out, cut', activity_txt("<b>Hi</b>\x07 there   now", 9) === 'Hi there…', activity_txt("<b>Hi</b>\x07 there   now", 9));

// logins
$_SERVER['REMOTE_ADDR'] = '10.1.2.3'; $_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0';
activity_login('rahul', ['role' => 'management', 'display' => 'Rahul L1']);
activity_login('tv1', ['role' => 'tv', 'display' => 'TV screen']);                       // not written
activity_login_fail('rahul', 'wrong', ['role' => 'management', 'display' => 'Rahul L1']);
activity_login_fail('Admin1234', 'wrong', null);                                          // a password typed as user ID: never written
activity_login_fail('tv1', 'wrong', ['role' => 'tv']);                                    // not written
activity_write(['ev' => 'view', 'user' => 'rahul', 'name' => 'Rahul L1', 'role' => 'management', 'page' => 'oleview', 'title' => 'OLE Overview', 'line' => 'all']);
activity_write(['ev' => 'logout', 'user' => 'rahul', 'name' => 'Rahul L1', 'role' => 'management']);
$file = activity_dir() . '/' . substr(activity_now(), 0, 7) . '.jsonl';
$raw = (string)@file_get_contents($file);
ok('one line per event (TV left out)', substr_count($raw, "\n") === 5, substr_count($raw, "\n"));
ok('a typed text that is no user ID is not kept', strpos($raw, 'Admin1234') === false && strpos(strtolower($raw), 'admin1234') === false);
ok('IP and browser kept', strpos($raw, '10.1.2.3') !== false && strpos($raw, 'Chrome/131.0') !== false);
$today = substr(activity_now(), 0, 10);
$r = activity_read($today, $today);
ok('read back: newest first', array_column($r['events'], 'ev') === ['logout', 'view', 'login_fail', 'login_fail', 'login'], array_column($r['events'], 'ev'));
ok('failed login of an unknown ID: why unknown, no user', ($r['events'][2]['why'] ?? '') === 'unknown' && !isset($r['events'][2]['user']), $r['events'][2]);
$u = $r['users'][0] ?? [];
ok('per login: logins 1, failed 1, pages 1, last login', ($u['user'] ?? '') === 'rahul' && $u['logins'] === 1 && $u['fails'] === 1 && $u['views'] === 1 && $u['lastLogin'] !== null && $u['ips'] === ['10.1.2.3'], $u);
ok('filter: only failed logins', count(activity_read($today, $today, ['ev' => ['login_fail']])['events']) === 2);
ok('filter: user', count(activity_read($today, $today, ['user' => 'RAHUL'])['events']) === 4);
ok('filter: text', count(activity_read($today, $today, ['q' => 'overview'])['events']) === 1);
ok('another period: nothing', activity_read('2001-01-01', '2001-01-31')['events'] === []);
ok('counts of the period', $r['counts'] === ['login' => 1, 'login_fail' => 2, 'logout' => 1, 'view' => 1, 'change' => 0, 'refused' => 0, 'download' => 0, 'error' => 0], $r['counts']);
$lim = activity_read($today, $today, [], 2);
ok('limit: the newest 2, total and truncated', count($lim['events']) === 2 && $lim['total'] === 5 && $lim['truncated'] === true && $lim['events'][0]['ev'] === 'logout');

// a change of the OLE entry: before → after of the hour
store_file_write('ole_hourly', ['entries' => ['2026-10-28|2|10' => ['date' => '2026-10-28', 'line' => 2, 'hour' => 10, 'losses' => [['reason' => 'CARTON BOX SHORTAGE', 'dept' => 'Store', 'min' => 12, 'model' => 'WTT70DLIM5']]]]]);
$body = ['action' => 'save', 'entries' => [['date' => '2026-10-28', 'line' => 2, 'hour' => 10, 'losses' => [['reason' => 'CARTON BOX SHORTAGE', 'min' => 18, 'model' => 'WTT70DLIM5']]], ['date' => '2026-10-28', 'line' => 2, 'hour' => 11, 'rejects' => [['station' => 'FQC', 'reason' => 'Scratch', 'qty' => 2]]]]];
$before = activity_before('ole.php', $body, null);
store_file_write('ole_hourly', ['entries' => ['2026-10-28|2|10' => ['date' => '2026-10-28', 'line' => 2, 'hour' => 10, 'losses' => [['reason' => 'CARTON BOX SHORTAGE', 'dept' => 'Store', 'min' => 18, 'model' => 'WTT70DLIM5']]],
    '2026-10-28|2|11' => ['date' => '2026-10-28', 'line' => 2, 'hour' => 11, 'rejects' => [['station' => 'FQC', 'reason' => 'Scratch', 'qty' => 2, 'dept' => 'Quality']]]]]);
$w = activity_what('ole.php', 'save', $body, $before, null, true);
ok('OLE save: changed hour with what it was', ($w['what'][0] ?? '') === 'Line 2 · 28-10-2026 · 10:00: loss CARTON BOX SHORTAGE 18 min (WTT70DLIM5) (was: loss CARTON BOX SHORTAGE 12 min (WTT70DLIM5))', $w['what']);
ok('OLE save: a new hour', ($w['what'][1] ?? '') === 'Line 2 · 28-10-2026 · 11:00: rejection FQC · Scratch ×2', $w['what']);
ok('OLE save: lines and dates', $w['lines'] === ['2', '2'] && $w['dates'] === ['2026-10-28', '2026-10-28']);
$w = activity_what('ole.php', 'save', $body, $before, null, false);
ok('refused save: what was sent', ($w['what'][0] ?? '') === 'Line 2 · 28-10-2026 · 10:00: loss CARTON BOX SHORTAGE 18 min (WTT70DLIM5)', $w['what']);

// model master: added, removed, cycle changed
store_file_write('model_master', ['rows' => [['company' => 'VOLTAS', 'model' => 'WT70', 'cycle' => 20, 'lines' => [1]], ['company' => 'SAMSUNG', 'model' => 'OLD1', 'cycle' => 15, 'lines' => [2]]]]);
$before = activity_before('model_master.php', ['action' => 'save'], null);
store_file_write('model_master', ['rows' => [['company' => 'VOLTAS', 'model' => 'WT70', 'cycle' => 21, 'lines' => [1, 4]], ['company' => 'SAMSUNG', 'model' => 'NEW9', 'cycle' => 13, 'lines' => [3]]]]);
$w = activity_what('model_master.php', 'save', ['action' => 'save'], $before, null, true);
ok('master: counts', ($w['what'][0] ?? '') === 'Model master saved: 2 models — 1 added, 1 removed, 1 changed', $w['what']);
ok('master: the change of a model', in_array('WT70 (VOLTAS): cycle 20 → 21 s, lines 1 → 1, 4', $w['what'], true), $w['what']);
ok('master: added and removed', in_array('Added: NEW9', $w['what'], true) && in_array('Removed: OLD1', $w['what'], true), $w['what']);

// logins: never a hash or a password
store_file_write('users', ['users' => ['rahul' => ['hash' => '$2y$10$SECRETHASHVALUE', 'role' => 'management', 'display' => 'Rahul', 'lines' => [1], 'v' => 3]], 'enforce' => true]);
$b = ['action' => 'user', 'user' => 'rahul', 'display' => 'Rahul', 'lines' => [1, 2], 'pass' => 'NewPass123'];
$before = activity_before('auth.php', $b, null);
store_file_write('users', ['users' => ['rahul' => ['hash' => '$2y$10$OTHERHASH', 'role' => 'management', 'display' => 'Rahul', 'lines' => [1, 2], 'v' => 4]], 'enforce' => true]);
$w = activity_what('auth.php', 'user', $b, $before, null, true);
$all = json_encode($w);
ok('login changed: lines and "password set"', ($w['what'][0] ?? '') === 'Login rahul (Rahul): lines Line 1 → Line 1, 2; password set', $w['what']);
ok('never a password or a hash', strpos($all, 'NewPass123') === false && strpos($all, 'HASH') === false && strpos($all, '$2y$') === false);
$w = activity_what('auth.php', 'user', ['action' => 'user', 'user' => 'neha', 'display' => 'Neha QA', 'lines' => [3], 'dept' => 'Quality', 'pass' => 'Xyz12345'], ['users' => ['users' => []]], null, false);
ok('new login (not saved): what was asked', strpos($w['what'][0] ?? '', 'New login neha (Neha QA): name Neha QA, lines Line 3') === 0 && strpos(json_encode($w), 'Xyz12345') === false, $w['what']);
$w = activity_what('auth.php', 'password', ['action' => 'password', 'user' => 'rahul', 'new' => 'Secret999'], $before, null, true);
ok('password change: who, never the password', $w['what'] === ['Password changed for rahul (Rahul)'] && strpos(json_encode($w), 'Secret999') === false, $w['what']);

// screen setup: the target method of a line and the method by date
store_file_write('ui_settings', ['targetRule' => ['lines' => ['1' => ['method' => 'A', 'add' => 3, 'pct' => 10]], 'plan' => []], 'theme' => ['x' => 1]]);
$before = activity_before('ui_settings.php', ['action' => 'save'], null);
store_file_write('ui_settings', ['targetRule' => ['lines' => ['1' => ['method' => 'D', 'add' => 3, 'pct' => 10]], 'plan' => [['line' => 2, 'from' => '2026-11-21', 'method' => 'B', 'add' => 3, 'pct' => 12]]], 'theme' => ['x' => 1]]);
$w = activity_what('ui_settings.php', 'save', ['action' => 'save'], $before, null, true);
ok('setup: sections changed', ($w['what'][0] ?? '') === 'Setup saved: Target methods changed', $w['what']);
ok('setup: method of Line 1 and the method by date', in_array('Target method · Line 1: A → D (allowance 3 s)', $w['what'], true) && in_array('Target method by date · Line 2 from 21-11-2026: method B', $w['what'], true), $w['what']);

// targets of a line
store_file_write('line_settings', ['targets' => ['2' => ['77' => ['cycle' => 20, 'model' => 'WT70', 'company' => 'VOLTAS']]]]);
$b = ['action' => 'target', 'mmId' => 77, 'cycle' => 19.5, 'model' => 'WT70', 'company' => 'VOLTAS', 'manual' => true];
$before = activity_before('line_settings.php', $b, '2');
store_file_write('line_settings', ['targets' => ['2' => ['77' => ['cycle' => 19.5, 'model' => 'WT70', 'company' => 'VOLTAS', 'manual' => true]]]]);
$w = activity_what('line_settings.php', 'target', $b, $before, '2', true);
ok('target: before → after', ($w['what'][0] ?? '') === 'Target · Line 2 · WT70 (VOLTAS): 19.5 s locked (was: 20 s)' && $w['lines'] === ['2'], $w['what']);

// a refused change written with its status and message; an RCA evidence file; a TV change never
$e = ['ev' => 'change', 'user' => 'rahul', 'role' => 'management', 'api' => 'ole.php', 'action' => 'save', 'status' => 403, 'error' => 'This login cannot fill Line 3.'];
activity_write($e);
$r = activity_read($today, $today, ['refused' => true]);
ok('refused: listed with the failed logins', count($r['events']) === 3 && ($r['events'][0]['status'] ?? 0) === 403, array_column($r['events'], 'ev'));
ok('per login: 1 refused', (array_values(array_filter($r['users'], fn($x) => $x['user'] === 'rahul'))[0]['refused'] ?? 0) === 1);
$w = activity_what('files.php', 'upload', ['action' => 'upload', 'name' => 'photo.jpg', 'data' => str_repeat('A', 4096)], [], null, true);
ok('evidence file: name and size', $w['what'] === ['RCA evidence file "photo.jpg" (3 KB)'], $w['what']);
activity_write(['ev' => 'change', 'user' => 'tv1', 'role' => 'tv', 'api' => 'ole.php']);
ok('a TV login is never written', strpos((string)file_get_contents($file), 'tv1') === false);

// 25-11-2026: a page that crashed in the browser — its message and stack lines are listed and counted
activity_write(['ev' => 'error', 'user' => 'rahul', 'role' => 'management', 'page' => 'targetcheck', 'title' => 'Target Rule & Check', 'error' => "Cannot read properties of undefined (reading 'x')", 'what' => ['at a (app.js:1:2)']]);
$r = activity_read($today, $today, ['ev' => ['error']]);
ok('page error: listed with its message and stack', count($r['events']) === 1 && $r['events'][0]['page'] === 'targetcheck' && $r['events'][0]['what'] === ['at a (app.js:1:2)'], $r['events']);
ok('page error: counted', $r['counts']['error'] === 1, $r['counts']);
ok('page error: found by text', count(activity_read($today, $today, ['q' => 'reading \'x\''])['events']) === 1);

$rm = function ($d) use (&$rm) { foreach (glob("$d/*") ?: [] as $f) is_dir($f) ? $rm($f) : @unlink($f); @rmdir($d); };
$rm($GLOBALS['EMS_STORE_DIR']);
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
exit($fail ? 1 : 0);
