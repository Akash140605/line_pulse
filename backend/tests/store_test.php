<?php
/**
 * Unit test for lib/store.php: shift / lunch rules, model targets, loss entries, who may write, and the locked file store.
 * No database needed.  Run:  php tests/store_test.php
 */
require_once __DIR__ . '/../lib/store.php';
$fail = 0;
function ok($n, $a, $b) { global $fail; if ($a !== $b) { $fail++; echo "FAIL $n: got " . json_encode($a) . " expected " . json_encode($b) . "\n"; } else echo "ok   $n\n"; }
function err(callable $f) { try { $f(); return null; } catch (InvalidArgumentException $e) { return $e->getMessage(); } }

// shift: two segments around lunch
ok('9:00 is read as 09:00', shift_clean(['start' => '9:00', 'end' => '21:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30'])['start'], '09:00');
ok('shift ok', shift_clean(['start' => '09:00', 'end' => '21:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30']),
   ['start' => '09:00', 'end' => '21:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30', 'breaks' => []]);
ok('shift without lunch', shift_clean(['start' => '08:30', 'end' => '17:00']), ['start' => '08:30', 'end' => '17:00', 'lunchStart' => null, 'lunchEnd' => null, 'breaks' => []]);
// tea breaks: kept sorted, inside the shift, not over lunch or each other
$L = ['start' => '09:00', 'end' => '21:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30'];
ok('breaks sorted + cleaned', shift_clean($L + ['breaks' => [['name' => 'Tea 2', 'start' => '17:00', 'end' => '17:10'], ['name' => ' <b>Tea</b> ', 'start' => '11:00', 'end' => '11:10']]])['breaks'],
   [['name' => 'bTea/b', 'start' => '11:00', 'end' => '11:10'], ['name' => 'Tea 2', 'start' => '17:00', 'end' => '17:10']]);
ok('break without name', shift_clean($L + ['breaks' => [['start' => '11:00', 'end' => '11:10']]])['breaks'][0]['name'], 'Break');
ok('break outside the shift', err(fn() => shift_clean($L + ['breaks' => [['start' => '08:50', 'end' => '09:10']]])), 'Break 1 must lie inside the shift');
ok('break over lunch', err(fn() => shift_clean($L + ['breaks' => [['start' => '13:20', 'end' => '13:40']]])), 'Break 1 overlaps lunch');
ok('break end before start', err(fn() => shift_clean($L + ['breaks' => [['start' => '11:10', 'end' => '11:00']]])), 'Break 1: end must be after start');
ok('breaks overlap', err(fn() => shift_clean($L + ['breaks' => [['name' => 'A', 'start' => '11:00', 'end' => '11:20'], ['name' => 'B', 'start' => '11:10', 'end' => '11:30']]])) !== null, true);
ok('too many breaks', err(fn() => shift_clean($L + ['breaks' => array_fill(0, 7, ['start' => '11:00', 'end' => '11:05'])])), 'At most 6 breaks a line');
ok('end before start', err(fn() => shift_clean(['start' => '21:00', 'end' => '09:00'])), 'Shift end must be after shift start');
ok('lunch outside the shift', err(fn() => shift_clean(['start' => '09:00', 'end' => '13:00', 'lunchStart' => '13:00', 'lunchEnd' => '13:30'])) !== null, true);
ok('lunch end before start', err(fn() => shift_clean(['start' => '09:00', 'end' => '21:00', 'lunchStart' => '13:30', 'lunchEnd' => '13:00'])), 'Lunch end must be after lunch start');
ok('only lunch start', err(fn() => shift_clean(['start' => '09:00', 'end' => '21:00', 'lunchStart' => '13:00'])), 'Give both lunch start and lunch end, or neither');
ok('bad time text', err(fn() => shift_clean(['start' => '9am', 'end' => '21:00'])) !== null, true);

// model targets (cycle in seconds per piece)
ok('target', target_clean(['mmId' => '12', 'cycle' => '14.456', 'model' => ' WT70 ', 'company' => 'SAMSUNG']), ['mmId' => 12, 'cycle' => 14.46, 'model' => 'WT70', 'company' => 'SAMSUNG', 'manual' => false]);
ok('target locked by the admin', target_clean(['mmId' => 12, 'cycle' => 15, 'manual' => true])['manual'], true);
ok('target removed (cycle empty)', target_clean(['mmId' => 12, 'cycle' => '']), ['mmId' => 12, 'cycle' => null]);
ok('target too small', err(fn() => target_clean(['mmId' => 12, 'cycle' => 0.5])) !== null, true);
ok('target bad model id', err(fn() => target_clean(['mmId' => 'x', 'cycle' => 14])) !== null, true);

// loss entries
$e = loss_clean(['date' => '2026-10-27', 'hour' => '10', 'minutes' => '15', 'reason' => ' Machine breakdown ', 'dept' => 'Maintenance', 'mmId' => '7', 'model' => 'WT70', 'from' => '10:05', 'to' => '10:20']);
ok('loss entry cleaned', [$e['hour'], $e['minutes'], $e['reason'], $e['mmId'], $e['from'], $e['to'], strlen($e['id']) === 16], [10, 15, 'Machine breakdown', 7, '10:05', '10:20', true]);
ok('loss keeps a given id', loss_clean(['id' => '1730000000abcd', 'date' => '2026-10-27', 'hour' => 9, 'minutes' => 5, 'reason' => 'Other'])['id'], '1730000000abcd');
ok('loss: whole line (no model)', loss_clean(['date' => '2026-10-27', 'hour' => 9, 'minutes' => 5, 'reason' => 'Other', 'mmId' => ''])['mmId'], null);
ok('loss: minutes 0 refused', err(fn() => loss_clean(['date' => '2026-10-27', 'hour' => 9, 'minutes' => 0, 'reason' => 'x'])), 'minutes must be 1–600');
ok('loss: reason required', err(fn() => loss_clean(['date' => '2026-10-27', 'hour' => 9, 'minutes' => 5, 'reason' => ' '])), 'reason is required');
ok('loss: hour 24 refused', err(fn() => loss_clean(['date' => '2026-10-27', 'hour' => 24, 'minutes' => 5, 'reason' => 'x'])), 'hour must be 0–23');
ok('loss: bad date', err(fn() => loss_clean(['date' => '27-10-2026', 'hour' => 9, 'minutes' => 5, 'reason' => 'x'])), 'date must be YYYY-MM-DD');
ok('loss: long text cut', mb_strlen(loss_clean(['date' => '2026-10-27', 'hour' => 9, 'minutes' => 5, 'reason' => 'x', 'remarks' => str_repeat('é', 500)])['remarks']), 300);

// who may write: plant network only, pages from local / plant addresses
ok('private ips', [store_private_ip('127.0.0.1'), store_private_ip('::1'), store_private_ip('192.168.1.20'), store_private_ip('10.0.0.5'), store_private_ip('172.16.3.4')], [true, true, true, true, true]);
ok('public ip refused', [store_private_ip('8.8.8.8'), store_private_ip('not-an-ip')], [false, false]);
ok('origins', [store_origin_ok(null), store_origin_ok('http://localhost:5173'), store_origin_ok('http://192.168.1.20:8080'), store_origin_ok('https://evil.example.com'), store_origin_ok('null')],
   [true, true, true, false, false]);

// ₹ rates
ok('money clean', money_clean(['pcValue' => '150', 'hourCost' => 12000.456, 'values' => ['12' => '220', '13' => '', '14' => 0]]),
   ['pcValue' => 150.0, 'hourCost' => 12000.46, 'values' => ['12' => 220.0]]);
ok('money empty = not set', money_clean([]), ['pcValue' => null, 'hourCost' => null, 'values' => []]);
ok('money negative refused', err(fn() => money_clean(['pcValue' => -5])), 'Value per piece must be a number from 0 to 10000000');
ok('money text refused', err(fn() => money_clean(['hourCost' => 'abc'])), 'Line cost per hour must be a number from 0 to 100000000');
ok('money bad model id refused', err(fn() => money_clean(['values' => ['x' => 5]])), 'Model values need model ids');

// file store: read default, locked update, reread
$GLOBALS['EMS_STORE_DIR'] = sys_get_temp_dir() . '/ems_store_test_' . getmypid();
ok('missing file → default', store_read('x_test', ['a' => 1]), ['a' => 1]);
store_update('x_test', fn($d) => $d + ['n' => ($d['n'] ?? 0) + 1]);
$r = store_update('x_test', fn($d) => ['n' => $d['n'] + 1]);
ok('update twice', [$r, store_read('x_test')], [['n' => 2], ['n' => 2]]);
// GET answers: ETag, and a short 304 when the browser already has this exact answer
$json = json_encode(['rows' => [['id' => 'a', 'model' => 'X']]]);
unset($_SERVER['HTTP_IF_NONE_MATCH']);
ob_start(); store_send($json); $full = ob_get_clean();
ok('full answer when the browser has nothing', $full, $json);
$tag = 'W/"' . substr(sha1($json), 0, 20) . '"';
$_SERVER['HTTP_IF_NONE_MATCH'] = $tag;
ob_start(); store_send($json); $none = ob_get_clean();
ok('same answer → nothing sent (304)', $none, '');
$_SERVER['HTTP_IF_NONE_MATCH'] = 'W/"old", ' . $tag;
ob_start(); store_send($json); $none2 = ob_get_clean();
ok('ETag in a list → 304', $none2, '');
$_SERVER['HTTP_IF_NONE_MATCH'] = 'W/"old"';
ob_start(); store_send($json); $chg = ob_get_clean();
ok('changed answer → sent again', $chg, $json);
unset($_SERVER['HTTP_IF_NONE_MATCH']);
ok('bad store name refused', (function () { try { store_path('../x'); return false; } catch (InvalidArgumentException $e) { return true; } })(), true);
array_map('unlink', glob($GLOBALS['EMS_STORE_DIR'] . '/*')); rmdir($GLOBALS['EMS_STORE_DIR']);

echo $fail ? "\n$fail FAILED\n" : "\nALL OK\n";
exit($fail ? 1 : 0);
